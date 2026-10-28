import type { Payload, Stream } from "./protocol";
export interface Sql {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    ...params: (string | number | null)[]
  ): Promise<unknown>;
  getFirstAsync<T>(
    sql: string,
    ...params: (string | number | null)[]
  ): Promise<T | null>;
}
export interface Drive {
  id: string;
  owner: string;
  source: "simulated" | "device";
  startedAt: string;
  stopped: boolean;
  background?: boolean;
  device: string;
  service: string;
  characteristic: string;
}
export interface Entry {
  rowid: number;
  session: string;
  owner: string;
  stream: Stream;
  payload: string;
}
/** All writers (including headless location tasks) use this one serialized connection. */
export class Outbox {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly db: Sql) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  async init() {
    await this.db
      .execAsync(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sequences (session TEXT, stream TEXT, value INTEGER NOT NULL, PRIMARY KEY(session,stream));
      CREATE TABLE IF NOT EXISTS receipts (session TEXT, stream TEXT, source TEXT, PRIMARY KEY(session,stream,source));
      CREATE TABLE IF NOT EXISTS outbox (session TEXT NOT NULL, owner TEXT NOT NULL, stream TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS errors (time TEXT NOT NULL, message TEXT NOT NULL);`);
  }
  drive(): Promise<Drive | null> {
    return this.serial(async () => {
      const row = await this.db.getFirstAsync<{ value: string }>(
        "SELECT value FROM state WHERE key='drive'",
      );
      return row ? JSON.parse(row.value) : null;
    });
  }
  saveDrive(drive: Drive) {
    return this.serial(async () => {
      await this.db.runAsync(
        "INSERT OR REPLACE INTO state VALUES ('drive',?)",
        JSON.stringify(drive),
      );
    });
  }
  private async append(
    drive: Drive,
    stream: Stream,
    payload: Payload,
    source: string,
  ) {
    const seen = await this.db.getFirstAsync(
      "SELECT 1 FROM receipts WHERE session=? AND stream=? AND source=?",
      drive.id,
      stream,
      source,
    );
    if (seen) return false;
    const row = await this.db.getFirstAsync<{ value: number }>(
      "SELECT value FROM sequences WHERE session=? AND stream=?",
      drive.id,
      stream,
    );
    const sequence = (row?.value ?? 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error("Sequence exhausted");
    await this.db.runAsync(
      "INSERT OR REPLACE INTO sequences VALUES (?,?,?)",
      drive.id,
      stream,
      sequence,
    );
    await this.db.runAsync(
      "INSERT INTO receipts VALUES (?,?,?)",
      drive.id,
      stream,
      source,
    );
    await this.db.runAsync(
      "INSERT INTO outbox VALUES (?,?,?,?)",
      drive.id,
      drive.owner,
      stream,
      JSON.stringify({ ...payload, sequence }),
    );
    return true;
  }
  private transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      await this.db.execAsync("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        await this.db.execAsync("COMMIT");
        return result;
      } catch (e) {
        await this.db.execAsync("ROLLBACK");
        throw e;
      }
    });
  }
  enqueue(drive: Drive, stream: Stream, payload: Payload, source: string) {
    return this.transaction(() => this.append(drive, stream, payload, source));
  }
  end(drive: Drive, time: string) {
    return this.transaction(async () => {
      await this.append(
        drive,
        "connection",
        { recorded_at: time, connected: false },
        "end",
      );
      await this.append(drive, "finish", {}, "finish");
      await this.db.runAsync(
        "INSERT OR REPLACE INTO state VALUES ('drive',?)",
        JSON.stringify({ ...drive, stopped: true }),
      );
    });
  }
  next(owner: string) {
    return this.serial(() =>
      this.db.getFirstAsync<Entry>(
        "SELECT rowid,* FROM outbox WHERE owner=? ORDER BY rowid LIMIT 1",
        owner,
      ),
    );
  }
  ack(rowid: number) {
    return this.serial(async () => {
      await this.db.runAsync("DELETE FROM outbox WHERE rowid=?", rowid);
    });
  }
  count() {
    return this.serial(
      async () =>
        (await this.db.getFirstAsync<{ n: number }>(
          "SELECT count(*) AS n FROM outbox",
        ))!.n,
    );
  }
  async error(message: string) {
    await this.serial(async () => {
      await this.db.runAsync(
        "INSERT INTO errors VALUES (?,?)",
        new Date().toISOString(),
        message,
      );
    });
  }
  async lastError() {
    return this.serial(
      async () =>
        (
          await this.db.getFirstAsync<{ message: string }>(
            "SELECT message FROM errors ORDER BY rowid DESC LIMIT 1",
          )
        )?.message ?? "",
    );
  }
}
export interface Rpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: unknown }>;
}
export class Uploader {
  private active: Promise<void> | null = null;
  constructor(
    private box: Outbox,
    private client: Rpc,
  ) {}
  flush(owner: string): Promise<void> {
    if (this.active) return this.active;
    this.active = this.drain(owner).finally(() => {
      this.active = null;
    });
    return this.active;
  }
  private async drain(owner: string) {
    // Bound each pass to avoid monopolizing the JS runtime; the scheduler resumes it.
    for (let i = 0; i < 100; i++) {
      const row = await this.box.next(owner);
      if (!row) return;
      const data = JSON.parse(row.payload);
      const name = {
        gps: "ingest_gps",
        event: "ingest_threshold_events",
        connection: "ingest_connection",
        finish: "finish_driving_session",
      }[row.stream];
      const args: Record<string, unknown> = { p_session_id: row.session };
      if (row.stream === "gps") args.p_points = [data];
      if (row.stream === "event") args.p_events = [data];
      if (row.stream === "connection") args.p_status = data;
      const { error } = await this.client.rpc(name, args);
      if (error) throw error; // Never discard rejected packets or rewrite their identity/time.
      await this.box.ack(row.rowid);
    }
  }
}
