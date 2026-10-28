/** Explicit opt-in: writes one clearly labeled simulated session to the configured project. */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, expect, it, vi } from "vitest";
import { Outbox, Uploader, type Drive, type Sql } from "../src/outbox";
import { gpsPayload, parseEvent, type EventPacket } from "../src/protocol";
vi.mock("react-native-ble-plx", () => ({
  BleManager: vi.fn(),
  State: { PoweredOn: "PoweredOn" },
}));
import { SimulatedBle } from "../src/ble";
function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing ${name}; never hardcode live credentials`);
  return value;
}
if (process.env.MSD_LIVE_VALIDATION !== "1")
  throw new Error(
    "Set MSD_LIVE_VALIDATION=1 to authorize labeled simulated test records",
  );
const url = required("VITE_SUPABASE_URL"),
  key = required("VITE_SUPABASE_PUBLISHABLE_KEY");
if (
  key.startsWith("sb_secret_") ||
  (!key.startsWith("sb_publishable_") &&
    JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role !==
      "anon")
)
  throw new Error("Only public publishable/anon keys allowed");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const owner = createClient(url, key, options),
  observer = createClient(url, key, options),
  anon = createClient(url, key, options);
let sessionId: string | undefined,
  source: SimulatedBle | undefined,
  db: DatabaseSync | undefined;
async function ok<T extends { data: unknown; error: unknown }>(
  promise: PromiseLike<T>,
): Promise<NonNullable<T["data"]>> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as NonNullable<T["data"]>;
}
afterAll(async () => {
  await source?.stop();
  db?.close();
  if (sessionId)
    await owner.rpc("finish_driving_session", { p_session_id: sessionId });
  await Promise.all([
    owner.auth.signOut({ scope: "local" }),
    observer.auth.signOut({ scope: "local" }),
  ]);
});
it("verifies live accuracy migration and actual simulated BLE/outbox/RPC/dashboard storage compatibility", async () => {
  const auth = await ok(
    owner.auth.signInWithPassword({
      email: required("MSD_TEST_EMAIL"),
      password: required("MSD_TEST_PASSWORD"),
    }),
  );
  await ok(
    observer.auth.signInWithPassword({
      email: required("MSD_OBSERVER_EMAIL"),
      password: required("MSD_OBSERVER_PASSWORD"),
    }),
  );
  const label = `PR #3 SOFTWARE VALIDATION — SIMULATED ${new Date().toISOString()}`;
  sessionId = await ok(
    owner.rpc("create_driving_session", {
      p_label: label,
      p_data_source: "simulated",
    }),
  );
  console.log(`Created labeled simulated validation session ${sessionId}`);
  const session = await ok(
    owner.from("driving_sessions").select("*").eq("id", sessionId).single(),
  );
  const drive: Drive = {
    id: sessionId!,
    owner: auth.user!.id,
    source: "simulated",
    startedAt: session.started_at,
    stopped: false,
    device: "",
    service: "",
    characteristic: "",
  };
  mkdirSync("../work", { recursive: true });
  const path = `../work/live-outbox-${sessionId}.db`;
  const open = async () => {
    db = new DatabaseSync(path);
    const sql: Sql = {
      execAsync: async (s) => {
        db!.exec(s);
      },
      runAsync: async (s, ...p) => db!.prepare(s).run(...p),
      getFirstAsync: async <T>(s: string, ...p: (string | number | null)[]) =>
        (db!.prepare(s).get(...p) as T) ?? null,
    };
    const box = new Outbox(sql);
    await box.init();
    return box;
  };
  let box = await open();
  await box.saveDrive(drive);
  const emitted: EventPacket[] = [];
  const writes: Promise<unknown>[] = [];
  source = new SimulatedBle(randomUUID);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Simulator did not emit all three IMUs")),
      15000,
    );
    source!.start(
      (packet) => {
        emitted.push(parseEvent(packet));
        writes.push(box.enqueue(drive, "event", { ...packet }, packet.id));
        if (emitted.length === 3) {
          clearTimeout(timeout);
          void source!.stop().then(resolve);
        }
      },
      (connected) => {
        if (connected)
          writes.push(
            box.enqueue(
              drive,
              "connection",
              { recorded_at: new Date().toISOString(), connected: true },
              "connected",
            ),
          );
      },
    );
  });
  await Promise.all(writes);
  expect(emitted.map((e) => e.imu_id)).toEqual([1, 2, 3]);
  const fix = {
    timestamp: Date.now(),
    coords: {
      latitude: 37.7793,
      longitude: -122.4193,
      accuracy: 4.25,
      speed: 8,
      heading: 140,
    },
  };
  const point = gpsPayload(fix, randomUUID());
  await box.enqueue(drive, "gps", point, String(fix.timestamp));
  // Legacy uploader omits accuracy. Distinct source time/identity, unchanged RPC.
  await box.enqueue(
    drive,
    "gps",
    {
      id: randomUUID(),
      recorded_at: new Date().toISOString(),
      latitude: 37.7794,
      longitude: -122.4194,
      speed_kph: null,
      heading: null,
    },
    "legacy",
  );
  const pending = await box.count();
  expect(pending).toBe(6);
  db!.close();
  box = await open();
  expect(await box.count()).toBe(pending);
  let loseResponse = true;
  let committedName = "";
  const transport = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const result = await owner.rpc(name, args);
      if (!result.error && loseResponse) {
        loseResponse = false;
        committedName = name;
        throw new Error("TEST: committed response lost");
      }
      return result;
    },
  };
  await expect(new Uploader(box, transport).flush(drive.owner)).rejects.toThrow(
    "committed response lost",
  );
  expect(await box.count()).toBe(pending);
  expect(committedName).toBe("ingest_connection");
  db!.close();
  box = await open();
  await new Uploader(box, owner).flush(drive.owner);
  expect(await box.count()).toBe(0);
  const events = await ok(
    owner
      .from("threshold_events")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence"),
  );
  expect(events).toHaveLength(3);
  for (let i = 0; i < 3; i++) {
    const { recorded_at, ...payload } = emitted[i];
    expect(events[i]).toMatchObject({ ...payload, sequence: i + 1 });
    expect(Date.parse(events[i].recorded_at)).toBe(Date.parse(recorded_at));
  }
  expect(
    await box.enqueue(drive, "event", { ...emitted[0] }, emitted[0].id),
  ).toBe(false);
  // Direct server replay must also deduplicate events, independently of local receipts.
  await ok(
    owner.rpc("ingest_threshold_events", {
      p_session_id: sessionId,
      p_events: [{ ...emitted[0], sequence: 1 }],
    }),
  );
  const gps = await ok(
    owner
      .from("gps_points")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence"),
  );
  expect(gps).toHaveLength(2);
  const { recorded_at, ...gpsFields } = point;
  expect(gps[0]).toMatchObject({ ...gpsFields, sequence: 1 });
  expect(Date.parse(gps[0].recorded_at)).toBe(
    Date.parse(recorded_at as string),
  );
  expect(gps[1].accuracy_m).toBeNull();
  const invalid = await owner.rpc("ingest_gps", {
    p_session_id: sessionId,
    p_points: [{ ...point, id: randomUUID(), sequence: 3, accuracy_m: -1 }],
  });
  expect(invalid.error).toBeTruthy();
  const invalidInfinity = await owner.rpc("ingest_gps", {
    p_session_id: sessionId,
    p_points: [
      { ...point, id: randomUUID(), sequence: 3, accuracy_m: "Infinity" },
    ],
  });
  expect(invalidInfinity.error).toBeTruthy();
  // First-write wins includes accuracy and source timestamp.
  await ok(
    owner.rpc("ingest_gps", {
      p_session_id: sessionId,
      p_points: [{ ...point, sequence: 1, accuracy_m: 999 }],
    }),
  );
  await ok(
    owner.rpc("share_session", {
      p_session_id: sessionId,
      p_email: required("MSD_OBSERVER_EMAIL"),
    }),
  );
  const visible = await ok(
    observer.from("threshold_events").select("*").eq("session_id", sessionId),
  );
  expect(visible).toHaveLength(3);
  const denied = await observer.rpc("ingest_connection", {
    p_session_id: sessionId,
    p_status: {
      sequence: 99,
      recorded_at: new Date().toISOString(),
      connected: true,
    },
  });
  expect(denied.error).toBeTruthy();
  const anonymous = await anon
    .from("gps_points")
    .select("*")
    .eq("session_id", sessionId);
  expect(anonymous.error || anonymous.data?.length === 0).toBeTruthy();
  await box.end(drive, new Date().toISOString());
  await new Uploader(box, owner).flush(drive.owner);
  const finished = await ok(
    owner.from("driving_sessions").select("*").eq("id", sessionId).single(),
  );
  expect(finished.ended_at).not.toBeNull();
  expect(finished.data_source).toBe("simulated");
  const finalGps = await ok(
    observer
      .from("gps_points")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence"),
  );
  expect(finalGps[0].accuracy_m).toBe(4.25);
  expect(finalGps).toHaveLength(2);
  const finalEvents = await ok(
    observer.from("threshold_events").select("*").eq("session_id", sessionId),
  );
  expect(finalEvents).toHaveLength(3);
  const connections = await ok(
    observer
      .from("connection_status")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence"),
  );
  expect(connections.map((c) => c.connected)).toEqual([true, false]);
  writeFileSync(
    "../work/live-validation.json",
    JSON.stringify(
      {
        validatedAt: new Date().toISOString(),
        project: new URL(url).hostname,
        sessionId,
        label,
        source: "simulated",
        gpsFixtures: 2,
        imuIds: [1, 2, 3],
        thresholdEvents: 3,
        connectionObservations: 2,
        accuracyMetres: 4.25,
        legacyAccuracy: null,
        negativeAndInfiniteAccuracyRejected: true,
        firstWriteWins: true,
        queueRestartAndLostResponseRecovery: true,
        observerReadAndWriteIsolation: true,
        endedAt: finished.ended_at,
        nativePhoneTested: false,
      },
      null,
      2,
    ) + "\n",
  );
});
