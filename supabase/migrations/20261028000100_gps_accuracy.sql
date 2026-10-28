-- Additive Stage 3 change: preserve OS horizontal GPS accuracy in metres.
-- Old clients may omit it; source time, identity, ownership and retry rules are unchanged.
alter table public.gps_points add column accuracy_m double precision
  check (accuracy_m >= 0 and accuracy_m < 'Infinity'::double precision);

create or replace function public.ingest_gps(p_session_id uuid, p_points jsonb)
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
    insert into public.gps_points(id, session_id, sequence, recorded_at, latitude, longitude, speed_kph, heading, accuracy_m)
      values ((v_point->>'id')::uuid, p_session_id, (v_point->>'sequence')::bigint, v_time,
        (v_point->>'latitude')::double precision, (v_point->>'longitude')::double precision,
        (v_point->>'speed_kph')::double precision, (v_point->>'heading')::double precision, (v_point->>'accuracy_m')::double precision)
      on conflict do nothing;
  end loop;
end;
$$;
