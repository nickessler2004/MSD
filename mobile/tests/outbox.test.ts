import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Outbox, Uploader, type Drive, type Sql } from "../src/outbox";
const drive: Drive = {
  id: "session",
  owner: "owner",
  source: "simulated",
  startedAt: new Date().toISOString(),
  stopped: false,
  device: "",
  service: "",
  characteristic: "",
};
let dir: string, db: DatabaseSync, box: Outbox;
function open() {
  db = new DatabaseSync(join(dir, "queue.db"));
  const sql: Sql = {
    execAsync: async (s) => {
      db.exec(s);
    },
    runAsync: async (s, ...p) => db.prepare(s).run(...p),
    getFirstAsync: async <T>(s: string, ...p: (string | number | null)[]) =>
      (db.prepare(s).get(...p) as T) ?? null,
  };
  box = new Outbox(sql);
  return box.init();
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "msd-"));
  await open();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
it("survives process reopen with stable payload, counters and acknowledged BLE receipts", async () => {
  await box.saveDrive(drive);
  await box.enqueue(drive, "event", { id: "event1", imu_id: 1 }, "event1");
  const first = await box.next("owner");
  db.close();
  await open();
  expect(await box.drive()).toEqual(drive);
  expect(await box.next("owner")).toEqual(first);
  await box.ack(first!.rowid);
  expect(
    await box.enqueue(drive, "event", { id: "event1", imu_id: 1 }, "event1"),
  ).toBe(false);
  await box.enqueue(drive, "event", { id: "event2", imu_id: 3 }, "event2");
  expect(JSON.parse((await box.next("owner"))!.payload).sequence).toBe(2);
});
it("serializes concurrent writes and shares event sequence across all IMUs", async () => {
  await Promise.all(
    [1, 2, 3].map((imu) =>
      box.enqueue(drive, "event", { imu_id: imu }, String(imu)),
    ),
  );
  await box.enqueue(drive, "gps", {}, "gps");
  const rows = db
    .prepare("select stream,payload from outbox order by rowid")
    .all();
  expect(rows.map((r) => JSON.parse(r.payload as string).sequence)).toEqual([
    1, 2, 3, 1,
  ]);
});
it("rolls back identity and sequence if storage fails", async () => {
  db.exec(
    "CREATE TRIGGER full BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'disk full'); END;",
  );
  await expect(box.enqueue(drive, "event", {}, "event1")).rejects.toThrow(
    "disk full",
  );
  db.exec("DROP TRIGGER full");
  await box.enqueue(drive, "event", {}, "event1");
  expect(JSON.parse((await box.next("owner"))!.payload).sequence).toBe(1);
});
it("retries an ambiguous committed RPC with identical identity and prevents cloud duplicates", async () => {
  await box.enqueue(
    drive,
    "event",
    { id: "stable", recorded_at: "2026-10-28T12:00:00.000Z" },
    "stable",
  );
  const cloud = new Map<string, unknown>();
  const calls: unknown[] = [];
  let lost = true;
  const client = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      cloud.set("stable", args);
      if (lost) {
        lost = false;
        throw new Error("response lost");
      }
      return { error: null };
    }),
  };
  const uploader = new Uploader(box, client);
  await expect(uploader.flush("owner")).rejects.toThrow();
  expect(await box.count()).toBe(1);
  db.close();
  await open();
  await new Uploader(box, client).flush("owner");
  expect(calls[0]).toEqual(calls[1]);
  expect(cloud.size).toBe(1);
  expect(await box.count()).toBe(0);
});
it("retains rejected rows, fences owner uploads and prevents overlapping drains", async () => {
  await box.enqueue(drive, "gps", {}, "fix");
  const client = {
    rpc: vi.fn(async () => ({ error: { message: "unauthorized" } })),
  };
  const uploader = new Uploader(box, client);
  await uploader.flush("other");
  expect(client.rpc).not.toHaveBeenCalled();
  const a = uploader.flush("owner"),
    b = uploader.flush("owner");
  expect(a).toBe(b);
  await expect(a).rejects.toEqual({ message: "unauthorized" });
  expect(await box.count()).toBe(1);
});
it("finishes after pending telemetry and atomically persists stopped state", async () => {
  await box.saveDrive(drive);
  await box.enqueue(drive, "gps", { id: "fix" }, "fix");
  await box.end(drive, new Date().toISOString());
  db.close();
  await open();
  expect((await box.drive())!.stopped).toBe(true);
  const names: string[] = [];
  await new Uploader(box, {
    rpc: async (name) => {
      names.push(name);
      return { error: null };
    },
  }).flush("owner");
  expect(names).toEqual([
    "ingest_gps",
    "ingest_connection",
    "finish_driving_session",
  ]);
});
it("rolls back stopped state and final connection if finish enqueue fails", async () => {
  await box.saveDrive(drive);
  db.exec(
    "CREATE TRIGGER full BEFORE INSERT ON outbox WHEN NEW.stream='finish' BEGIN SELECT RAISE(ABORT,'disk full'); END;",
  );
  await expect(box.end(drive, new Date().toISOString())).rejects.toThrow();
  expect((await box.drive())!.stopped).toBe(false);
  expect(await box.count()).toBe(0);
});
