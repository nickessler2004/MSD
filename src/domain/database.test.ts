import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const observer = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const unconfirmed = "44444444-4444-4444-8444-444444444444";
let db: PGlite;

async function asUser<T>(
  user: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    user ?? "",
  ]);
  try {
    return await operation();
  } finally {
    await db.exec("reset role");
  }
}
async function createSession(user = owner, source = "simulated") {
  const result = await asUser(user, () =>
    db.query<{ id: string }>(
      "select public.create_driving_session($1, $2) as id",
      ["Cloud test drive", source],
    ),
  );
  const id = result.rows[0].id;
  // Historical source times allow deterministic delayed/reordered packet assertions.
  await db.query(
    "update public.driving_sessions set started_at = now() - interval '5 minutes' where id = $1",
    [id],
  );
  const row = await db.query<{ started_at: Date }>(
    "select started_at from public.driving_sessions where id=$1",
    [id],
  );
  return { id, start: new Date(row.rows[0].started_at).getTime() };
}
const at = (session: { start: number }, seconds: number) =>
  new Date(session.start + seconds * 1000).toISOString();
const gps = (session: { start: number }, sequence: number, extra = {}) => ({
  id: crypto.randomUUID(),
  sequence,
  recorded_at: at(session, sequence),
  latitude: 37.77,
  longitude: -122.41,
  speed_kph: 32,
  heading: 90,
  ...extra,
});
const event = (session: { start: number }, sequence: number, extra = {}) => ({
  id: crypto.randomUUID(),
  sequence,
  imu_id: 1,
  recorded_at: at(session, sequence),
  severity: "warning",
  magnitude: 1.8,
  latitude: null,
  longitude: null,
  t1: 0.8,
  t2: 1.8,
  ...extra,
});
async function ingestGps(sessionId: string, points: unknown[], user = owner) {
  return asUser(user, () =>
    db.query("select public.ingest_gps($1,$2::jsonb)", [
      sessionId,
      JSON.stringify(points),
    ]),
  );
}
async function ingestEvents(
  sessionId: string,
  events: unknown[],
  user = owner,
) {
  return asUser(user, () =>
    db.query("select public.ingest_threshold_events($1,$2::jsonb)", [
      sessionId,
      JSON.stringify(events),
    ]),
  );
}
async function count(table: string, user: string) {
  const result = await asUser(user, () =>
    db.query<{ count: number }>(
      `select count(*)::int as count from public.${table}`,
    ),
  );
  return result.rows[0].count;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261021000100_msd_cloud.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261028000100_gps_accuracy.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 30_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate public.driving_sessions,auth.users cascade;",
  );
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values ($1,'owner@example.com',now()),($2,'observer@example.com',now()),($3,'outsider@example.com',now()),($4,'unconfirmed@example.com',null)",
    [owner, observer, outsider, unconfirmed],
  );
});

describe("Supabase migration and RPC security in PostgreSQL", () => {
  it("preserves GPS accuracy, accepts legacy packets and retains first-write retry semantics", async () => {
    const session = await createSession();
    const point = gps(session, 1, { accuracy_m: 4.25 });
    await ingestGps(session.id, [point]);
    await ingestGps(session.id, [{ ...point, accuracy_m: 99 }]);
    await ingestGps(session.id, [gps(session, 2)]);
    const result = await asUser(owner, () =>
      db.query<{ accuracy_m: number | null }>(
        "select accuracy_m from gps_points order by sequence",
      ),
    );
    expect(result.rows).toEqual([{ accuracy_m: 4.25 }, { accuracy_m: null }]);
    await expect(
      ingestGps(session.id, [gps(session, 3, { accuracy_m: -1 })]),
    ).rejects.toThrow();
    await expect(
      ingestGps(session.id, [gps(session, 3, { accuracy_m: "Infinity" })]),
    ).rejects.toThrow();
  });
  it("creates an owned session with exactly three IMUs and immutable provenance", async () => {
    const session = await createSession();
    const result = await asUser(owner, () =>
      db.query<{ owner_id: string; data_source: string }>(
        "select owner_id,data_source from public.driving_sessions",
      ),
    );
    expect(result.rows).toEqual([
      { owner_id: owner, data_source: "simulated" },
    ]);
    const thresholds = await asUser(owner, () =>
      db.query<{ imu_id: number; t1: number; t2: number }>(
        "select imu_id,t1,t2 from public.imu_thresholds where session_id=$1 order by imu_id",
        [session.id],
      ),
    );
    expect(thresholds.rows).toEqual(
      [1, 2, 3].map((imu_id) => ({ imu_id, t1: 0.8, t2: 1.8 })),
    );
    await expect(
      asUser(owner, () =>
        db.query(
          "update public.driving_sessions set owner_id=$1,data_source='device' where id=$2",
          [outsider, session.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(owner, () =>
        db.query("delete from public.driving_sessions where id=$1", [
          session.id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("denies anonymous reads and RPCs and isolates other authenticated owners", async () => {
    const session = await createSession();
    await ingestGps(session.id, [gps(session, 1)]);
    for (const table of [
      "driving_sessions",
      "session_observers",
      "gps_points",
      "threshold_events",
      "connection_status",
      "imu_thresholds",
    ]) {
      await expect(
        asUser(null, () => db.query(`select * from public.${table}`)),
      ).rejects.toThrow(/permission denied/i);
      expect(await count(table, outsider)).toBe(0);
    }
    await expect(
      asUser(null, () =>
        db.query("select public.create_driving_session('Anonymous','device')"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ingestGps(session.id, [gps(session, 2)], outsider),
    ).rejects.toThrow(/not owned/i);
    await expect(
      asUser(outsider, () =>
        db.query("select public.finish_driving_session($1)", [session.id]),
      ),
    ).rejects.toThrow(/not owned/i);
    await expect(
      asUser(owner, () =>
        db.query("select public.require_owned_session($1)", [session.id]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("shares a session read-only with a confirmed account and revokes access", async () => {
    const session = await createSession();
    await ingestGps(session.id, [gps(session, 1)]);
    await ingestEvents(session.id, [event(session, 1)]);
    await asUser(owner, () =>
      db.query("select public.share_session($1,'OBSERVER@example.com')", [
        session.id,
      ]),
    );
    expect(await count("driving_sessions", observer)).toBe(1);
    expect(await count("gps_points", observer)).toBe(1);
    expect(await count("threshold_events", observer)).toBe(1);
    expect(await count("imu_thresholds", observer)).toBe(3);
    await expect(
      ingestGps(session.id, [gps(session, 2)], observer),
    ).rejects.toThrow(/not owned/i);
    await expect(
      asUser(observer, () =>
        db.query("select public.share_session($1,'outsider@example.com')", [
          session.id,
        ]),
      ),
    ).rejects.toThrow(/not owned/i);
    await expect(
      asUser(owner, () =>
        db.query("select public.share_session($1,'unconfirmed@example.com')", [
          session.id,
        ]),
      ),
    ).rejects.toThrow(/confirm/i);
    await asUser(owner, () =>
      db.query("select public.revoke_session_observer($1,$2)", [
        session.id,
        observer,
      ]),
    );
    expect(await count("driving_sessions", observer)).toBe(0);
    expect(await count("gps_points", observer)).toBe(0);
    expect(await count("threshold_events", observer)).toBe(0);
  });

  it("preserves first-write-wins GPS history for duplicate and out-of-order packets", async () => {
    const session = await createSession();
    const first = gps(session, 1);
    const third = gps(session, 3);
    const second = gps(session, 2);
    await ingestGps(session.id, [third, first, second]);
    await ingestGps(session.id, [
      first,
      { ...first, id: crypto.randomUUID(), latitude: 1 },
    ]);
    const result = await asUser(owner, () =>
      db.query<{
        sequence: number;
        latitude: number;
        received_at: Date;
        recorded_at: Date;
      }>(
        "select sequence::int,latitude,received_at,recorded_at from public.gps_points where session_id=$1 order by recorded_at,sequence",
        [session.id],
      ),
    );
    expect(result.rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(result.rows.every((row) => row.latitude === 37.77)).toBe(true);
    expect(
      result.rows.every(
        (row) =>
          new Date(row.received_at).getTime() >
          new Date(row.recorded_at).getTime(),
      ),
    ).toBe(true);
    await expect(
      asUser(owner, () =>
        db.query(
          "update public.gps_points set latitude=0 where session_id=$1",
          [session.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(owner, () =>
        db.query("delete from public.gps_points where session_id=$1", [
          session.id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(owner, () =>
        db.query(
          "insert into public.gps_points(id,session_id,sequence,recorded_at,latitude,longitude) values(gen_random_uuid(),$1,4,now(),0,0)",
          [session.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("records all three IMUs, handles sparse events and preserves exact threshold snapshots", async () => {
    const session = await createSession();
    const packets = [
      event(session, 1, { imu_id: 1, magnitude: 0.8 }),
      event(session, 2, { imu_id: 2, magnitude: 1.8 }),
      event(session, 3, { imu_id: 3, magnitude: 1.801, severity: "critical" }),
      event(session, 4, { imu_id: 3, magnitude: null, severity: "critical" }),
    ];
    await ingestEvents(session.id, [
      packets[2],
      packets[0],
      packets[3],
      packets[1],
    ]);
    await ingestEvents(session.id, [
      packets[0],
      { ...packets[0], id: crypto.randomUUID(), magnitude: 1.2 },
    ]);
    const result = await asUser(owner, () =>
      db.query<{
        imu_id: number;
        magnitude: number | null;
        t1: number;
        t2: number;
        severity: string;
      }>(
        "select imu_id,magnitude,t1,t2,severity from public.threshold_events where session_id=$1 order by sequence",
        [session.id],
      ),
    );
    expect(result.rows).toEqual([
      { imu_id: 1, magnitude: 0.8, t1: 0.8, t2: 1.8, severity: "warning" },
      { imu_id: 2, magnitude: 1.8, t1: 0.8, t2: 1.8, severity: "warning" },
      { imu_id: 3, magnitude: 1.801, t1: 0.8, t2: 1.8, severity: "critical" },
      { imu_id: 3, magnitude: null, t1: 0.8, t2: 1.8, severity: "critical" },
    ]);
    await asUser(owner, () =>
      db.query("select public.set_imu_thresholds($1,$2::jsonb)", [
        session.id,
        JSON.stringify([1, 2, 3].map((imu_id) => ({ imu_id, t1: 2, t2: 3 }))),
      ]),
    );
    const unchanged = await asUser(owner, () =>
      db.query<{ t1: number; t2: number }>(
        "select t1,t2 from public.threshold_events where session_id=$1",
        [session.id],
      ),
    );
    expect(
      unchanged.rows.every((row) => row.t1 === 0.8 && row.t2 === 1.8),
    ).toBe(true);
    await expect(
      ingestEvents(session.id, [
        event(session, 5, { magnitude: 1.8, severity: "critical" }),
      ]),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      ingestEvents(session.id, [event(session, 6, { imu_id: 4 })]),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      ingestEvents(session.id, [
        event(session, 7, { latitude: 37.7, longitude: null }),
      ]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("updates exactly three thresholds atomically and denies observer configuration writes", async () => {
    const session = await createSession();
    const valid = [1, 2, 3].map((imu_id) => ({ imu_id, t1: 1, t2: 2 }));
    await asUser(owner, () =>
      db.query("select public.set_imu_thresholds($1,$2::jsonb)", [
        session.id,
        JSON.stringify(valid),
      ]),
    );
    for (const invalid of [
      valid.slice(0, 2),
      [valid[0], valid[0], valid[2]],
      [valid[0], { ...valid[0], imu_id: "01" }, valid[2]],
      [valid[0], { imu_id: 2, t1: 5, t2: 2 }, valid[2]],
    ]) {
      await expect(
        asUser(owner, () =>
          db.query("select public.set_imu_thresholds($1,$2::jsonb)", [
            session.id,
            JSON.stringify(invalid),
          ]),
        ),
      ).rejects.toThrow();
    }
    const saved = await asUser(owner, () =>
      db.query<{ t1: number; t2: number }>(
        "select t1,t2 from public.imu_thresholds where session_id=$1",
        [session.id],
      ),
    );
    expect(saved.rows).toEqual([
      { t1: 1, t2: 2 },
      { t1: 1, t2: 2 },
      { t1: 1, t2: 2 },
    ]);
    await expect(
      asUser(outsider, () =>
        db.query("select public.set_imu_thresholds($1,$2::jsonb)", [
          session.id,
          JSON.stringify(valid),
        ]),
      ),
    ).rejects.toThrow(/not owned/i);
  });

  it("keeps reordered connection status history and selects current state by highest sequence", async () => {
    const session = await createSession();
    for (const [sequence, connected] of [
      [3, false],
      [1, true],
      [2, true],
      [3, true],
    ] as const) {
      await asUser(owner, () =>
        db.query("select public.ingest_connection($1,$2::jsonb)", [
          session.id,
          JSON.stringify({
            sequence,
            connected,
            recorded_at: at(session, sequence),
          }),
        ]),
      );
    }
    const result = await asUser(owner, () =>
      db.query<{ sequence: number; connected: boolean }>(
        "select sequence::int,connected from public.connection_status where session_id=$1 order by sequence desc",
        [session.id],
      ),
    );
    expect(result.rows).toEqual([
      { sequence: 3, connected: false },
      { sequence: 2, connected: true },
      { sequence: 1, connected: true },
    ]);
    await expect(
      asUser(owner, () =>
        db.query(
          "update public.connection_status set connected=true where session_id=$1",
          [session.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("accepts delayed telemetry recorded before session end and rejects packets outside its bounds", async () => {
    const session = await createSession();
    await asUser(owner, () =>
      db.query("select public.finish_driving_session($1)", [session.id]),
    );
    await ingestGps(session.id, [gps(session, 10)]);
    await ingestEvents(session.id, [event(session, 10)]);
    await expect(
      ingestGps(session.id, [
        gps(session, 11, { recorded_at: at(session, -1) }),
      ]),
    ).rejects.toThrow(/bounds/i);
    await expect(
      ingestGps(session.id, [
        gps(session, 12, {
          recorded_at: new Date(Date.now() + 30_000).toISOString(),
        }),
      ]),
    ).rejects.toThrow(/bounds/i);
    const before = await db.query<{ ended_at: Date }>(
      "select ended_at from public.driving_sessions where id=$1",
      [session.id],
    );
    await asUser(owner, () =>
      db.query("select public.finish_driving_session($1)", [session.id]),
    );
    const after = await db.query<{ ended_at: Date }>(
      "select ended_at from public.driving_sessions where id=$1",
      [session.id],
    );
    expect(after.rows[0].ended_at).toEqual(before.rows[0].ended_at);
  });

  it("keeps accepted clock-tolerant records inside the final session bounds", async () => {
    const session = await createSession();
    const recordedAt = new Date(Date.now() + 30_000).toISOString();
    await ingestGps(session.id, [gps(session, 1, { recorded_at: recordedAt })]);
    await asUser(owner, () =>
      db.query("select public.finish_driving_session($1)", [session.id]),
    );
    const result = await asUser(owner, () =>
      db.query<{ ended_at: Date }>(
        "select ended_at from public.driving_sessions where id=$1",
        [session.id],
      ),
    );
    expect(new Date(result.rows[0].ended_at).getTime()).toBeGreaterThanOrEqual(
      Date.parse(recordedAt),
    );
  });

  it("rejects bad batches, invalid GPS and future source times without partial writes", async () => {
    const session = await createSession();
    await expect(ingestGps(session.id, [])).rejects.toThrow(/1 to 100/i);
    await expect(
      ingestGps(
        session.id,
        Array.from({ length: 101 }, (_, i) => gps(session, i)),
      ),
    ).rejects.toThrow(/1 to 100/i);
    await expect(
      ingestGps(session.id, [
        gps(session, 1),
        gps(session, 2, { latitude: 100 }),
      ]),
    ).rejects.toThrow(/check constraint/i);
    expect(await count("gps_points", owner)).toBe(0);
    await expect(
      ingestGps(session.id, [
        gps(session, 1, {
          recorded_at: new Date(Date.now() + 120_000).toISOString(),
        }),
      ]),
    ).rejects.toThrow(/bounds/i);
    await expect(
      ingestGps(session.id, [gps(session, 1, { sequence: 9007199254740992 })]),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      ingestGps(session.id, [gps(session, 1, { speed_kph: "NaN" })]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("enables RLS on all tables and excludes sensitive membership DELETE keys from Realtime", async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname",
    );
    expect(rls.rows).toHaveLength(6);
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
    const publication = await db.query(
      "select tablename from pg_publication_tables where pubname='supabase_realtime'",
    );
    expect(publication.rows).toHaveLength(5);
    expect(publication.rows).not.toContainEqual({
      tablename: "session_observers",
    });
  });
});
