-- MSD Stage 2: authenticated, owner-controlled ingestion and shared read-only observation.
-- No raw continuous IMU samples are stored here; the ESP32 retains those locally.

create table public.driving_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  label text not null check (char_length(trim(label)) between 1 and 120),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  data_source text not null check (data_source in ('simulated', 'device')),
  created_at timestamptz not null default now(),
  check (isfinite(started_at) and (ended_at is null or (isfinite(ended_at) and ended_at >= started_at)))
);

create table public.session_observers (
  session_id uuid not null references public.driving_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table public.gps_points (
  id uuid primary key,
  session_id uuid not null references public.driving_sessions(id) on delete cascade,
  sequence bigint not null check (sequence between 0 and 9007199254740991),
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  received_at timestamptz not null default now(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  speed_kph double precision check (speed_kph >= 0 and speed_kph < 'Infinity'::double precision),
  heading double precision check (heading >= 0 and heading < 360),
  unique (session_id, sequence)
);

create table public.threshold_events (
  id uuid primary key,
  session_id uuid not null references public.driving_sessions(id) on delete cascade,
  sequence bigint not null check (sequence between 0 and 9007199254740991),
  imu_id smallint not null check (imu_id between 1 and 3),
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  received_at timestamptz not null default now(),
  severity text not null check (severity in ('warning', 'critical')),
  magnitude double precision check (magnitude >= 0 and magnitude < 'Infinity'::double precision),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  t1 double precision not null check (t1 > 0),
  t2 double precision not null check (t2 > t1 and t2 <= 10),
  check ((latitude is null) = (longitude is null)),
  -- Snapshot thresholds are part of the event, never reclassified on a later settings edit.
  check (magnitude is null or
    (severity = 'warning' and magnitude >= t1 and magnitude <= t2) or
    (severity = 'critical' and magnitude > t2)),
  unique (session_id, sequence)
);

create table public.connection_status (
  session_id uuid not null references public.driving_sessions(id) on delete cascade,
  sequence bigint not null check (sequence between 0 and 9007199254740991),
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  received_at timestamptz not null default now(),
  connected boolean not null,
  primary key (session_id, sequence)
);

create table public.imu_thresholds (
  session_id uuid not null references public.driving_sessions(id) on delete cascade,
  imu_id smallint not null check (imu_id between 1 and 3),
  t1 double precision not null check (t1 > 0),
  t2 double precision not null check (t2 > t1 and t2 <= 10),
  updated_at timestamptz not null default now(),
  primary key (session_id, imu_id)
);

create index driving_sessions_owner_time on public.driving_sessions(owner_id, started_at desc);
create index session_observers_user on public.session_observers(user_id, session_id);
create index gps_points_session_time on public.gps_points(session_id, recorded_at, sequence);
create index threshold_events_session_time on public.threshold_events(session_id, recorded_at, sequence);
create index connection_status_session_sequence on public.connection_status(session_id, sequence desc);

-- These narrow helpers run under their fixed owner with an empty search path to avoid
-- recursive membership policies and malicious schema/function substitution.
create function public.can_read_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists(select 1 from public.driving_sessions s where s.id = p_session_id and s.owner_id = auth.uid())
    or exists(select 1 from public.session_observers o where o.session_id = p_session_id and o.user_id = auth.uid())
  );
$$;

create function public.require_owned_session(p_session_id uuid)
returns public.driving_sessions language plpgsql security definer set search_path = '' as $$
declare v_session public.driving_sessions;
begin
  select * into v_session from public.driving_sessions where id = p_session_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Session not owned by authenticated user' using errcode = '42501'; end if;
  return v_session;
end;
$$;

create function public.validate_telemetry_time(p_session public.driving_sessions, p_recorded_at timestamptz)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_recorded_at is null or not isfinite(p_recorded_at)
    or p_recorded_at < p_session.started_at
    or p_recorded_at > now() + interval '60 seconds'
    or (p_session.ended_at is not null and p_recorded_at > p_session.ended_at) then
    raise exception 'Telemetry timestamp is outside the session bounds' using errcode = '22023';
  end if;
end;
$$;

alter table public.driving_sessions enable row level security;
alter table public.session_observers enable row level security;
alter table public.gps_points enable row level security;
alter table public.threshold_events enable row level security;
alter table public.connection_status enable row level security;
alter table public.imu_thresholds enable row level security;

create policy session_read on public.driving_sessions for select to authenticated using (public.can_read_session(id));
create policy observer_read on public.session_observers for select to authenticated using (public.can_read_session(session_id));
create policy gps_read on public.gps_points for select to authenticated using (public.can_read_session(session_id));
create policy event_read on public.threshold_events for select to authenticated using (public.can_read_session(session_id));
create policy connection_read on public.connection_status for select to authenticated using (public.can_read_session(session_id));
create policy thresholds_read on public.imu_thresholds for select to authenticated using (public.can_read_session(session_id));

revoke all on public.driving_sessions, public.session_observers, public.gps_points, public.threshold_events, public.connection_status, public.imu_thresholds from anon, authenticated;
grant select on public.driving_sessions, public.session_observers, public.gps_points, public.threshold_events, public.connection_status, public.imu_thresholds to authenticated;

create function public.create_driving_session(p_label text, p_data_source text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.driving_sessions(owner_id, label, data_source)
    values (auth.uid(), trim(p_label), p_data_source) returning id into v_id;
  insert into public.imu_thresholds(session_id, imu_id, t1, t2)
    select v_id, n, 0.8, 1.8 from generate_series(1, 3) n;
  return v_id;
end;
$$;

create function public.finish_driving_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_owned_session(p_session_id);
  -- The owner-row lock serializes finishing with ingestion. Preserve already accepted
  -- source records even when the phone clock was within the allowed +60s tolerance.
  update public.driving_sessions set ended_at = greatest(now(),
    (select max(recorded_at) from public.gps_points where session_id = p_session_id),
    (select max(recorded_at) from public.threshold_events where session_id = p_session_id),
    (select max(recorded_at) from public.connection_status where session_id = p_session_id))
    where id = p_session_id and ended_at is null;
end;
$$;

create function public.ingest_gps(p_session_id uuid, p_points jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session public.driving_sessions; v_point jsonb; v_time timestamptz;
begin
  v_session := public.require_owned_session(p_session_id);
  if jsonb_typeof(p_points) is distinct from 'array' or jsonb_array_length(p_points) not between 1 and 100 then
    raise exception 'GPS batch must contain 1 to 100 points' using errcode = '22023';
  end if;
  for v_point in select value from jsonb_array_elements(p_points) loop
    v_time := (v_point->>'recorded_at')::timestamptz;
    perform public.validate_telemetry_time(v_session, v_time);
    insert into public.gps_points(id, session_id, sequence, recorded_at, latitude, longitude, speed_kph, heading)
      values ((v_point->>'id')::uuid, p_session_id, (v_point->>'sequence')::bigint, v_time,
        (v_point->>'latitude')::double precision, (v_point->>'longitude')::double precision,
        (v_point->>'speed_kph')::double precision, (v_point->>'heading')::double precision)
      on conflict do nothing;
  end loop;
end;
$$;

create function public.ingest_threshold_events(p_session_id uuid, p_events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session public.driving_sessions; v_event jsonb; v_time timestamptz;
begin
  v_session := public.require_owned_session(p_session_id);
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) not between 1 and 100 then
    raise exception 'Event batch must contain 1 to 100 events' using errcode = '22023';
  end if;
  for v_event in select value from jsonb_array_elements(p_events) loop
    v_time := (v_event->>'recorded_at')::timestamptz;
    perform public.validate_telemetry_time(v_session, v_time);
    insert into public.threshold_events(id, session_id, sequence, imu_id, recorded_at, severity, magnitude, latitude, longitude, t1, t2)
      values ((v_event->>'id')::uuid, p_session_id, (v_event->>'sequence')::bigint, (v_event->>'imu_id')::smallint,
        v_time, v_event->>'severity', (v_event->>'magnitude')::double precision,
        (v_event->>'latitude')::double precision, (v_event->>'longitude')::double precision,
        (v_event->>'t1')::double precision, (v_event->>'t2')::double precision)
      on conflict do nothing;
  end loop;
end;
$$;

create function public.ingest_connection(p_session_id uuid, p_status jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session public.driving_sessions; v_time timestamptz;
begin
  v_session := public.require_owned_session(p_session_id);
  if jsonb_typeof(p_status) is distinct from 'object' then
    raise exception 'Connection packet must be an object' using errcode = '22023';
  end if;
  v_time := (p_status->>'recorded_at')::timestamptz;
  perform public.validate_telemetry_time(v_session, v_time);
  insert into public.connection_status(session_id, sequence, recorded_at, connected)
    values (p_session_id, (p_status->>'sequence')::bigint, v_time, (p_status->>'connected')::boolean)
    on conflict do nothing;
end;
$$;

create function public.set_imu_thresholds(p_session_id uuid, p_thresholds jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session public.driving_sessions; v_threshold jsonb;
begin
  v_session := public.require_owned_session(p_session_id);
  if v_session.ended_at is not null then raise exception 'Session is already finished' using errcode = '22023'; end if;
  if jsonb_typeof(p_thresholds) is distinct from 'array' or jsonb_array_length(p_thresholds) <> 3 then
    raise exception 'Exactly three IMU thresholds are required' using errcode = '22023';
  end if;
  if (select count(distinct (value->>'imu_id')::smallint) from jsonb_array_elements(p_thresholds)) <> 3 then
    raise exception 'IMU identifiers must be unique' using errcode = '22023';
  end if;
  for v_threshold in select value from jsonb_array_elements(p_thresholds) loop
    insert into public.imu_thresholds(session_id, imu_id, t1, t2)
      values(p_session_id, (v_threshold->>'imu_id')::smallint, (v_threshold->>'t1')::double precision, (v_threshold->>'t2')::double precision)
      on conflict(session_id, imu_id) do update set t1 = excluded.t1, t2 = excluded.t2, updated_at = now();
  end loop;
end;
$$;

create function public.share_session(p_session_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform public.require_owned_session(p_session_id);
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if v_user is null then raise exception 'Observer must first register and confirm their email' using errcode = '22023'; end if;
  insert into public.session_observers(session_id, user_id) values (p_session_id, v_user) on conflict do nothing;
end;
$$;

create function public.revoke_session_observer(p_session_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_owned_session(p_session_id);
  delete from public.session_observers where session_id = p_session_id and user_id = p_user_id;
end;
$$;

-- Supabase exposes SQL functions as RPC routes: PUBLIC must not retain default execute.
revoke all on function public.can_read_session(uuid), public.require_owned_session(uuid), public.validate_telemetry_time(public.driving_sessions,timestamptz), public.create_driving_session(text,text), public.finish_driving_session(uuid), public.ingest_gps(uuid,jsonb), public.ingest_threshold_events(uuid,jsonb), public.ingest_connection(uuid,jsonb), public.set_imu_thresholds(uuid,jsonb), public.share_session(uuid,text), public.revoke_session_observer(uuid,uuid) from public, anon, authenticated;
grant execute on function public.can_read_session(uuid), public.create_driving_session(text,text), public.finish_driving_session(uuid), public.ingest_gps(uuid,jsonb), public.ingest_threshold_events(uuid,jsonb), public.ingest_connection(uuid,jsonb), public.set_imu_thresholds(uuid,jsonb), public.share_session(uuid,text), public.revoke_session_observer(uuid,uuid) to authenticated;

-- Realtime INSERT/UPDATE delivery uses the authenticated observer SELECT policies.
-- Membership is intentionally not published: Supabase DELETE notifications cannot
-- apply row-level checks and would expose its composite (session,user) primary key.
-- Shared-data clients recheck membership on reconnect and periodic authorized fetches.
do $$
declare v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach v_table in array array['driving_sessions','gps_points','threshold_events','connection_status','imu_thresholds'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
