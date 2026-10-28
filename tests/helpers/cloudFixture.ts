import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import type {
  CloudConnection,
  CloudSession,
  CloudThresholdEvent,
  GpsPoint,
  ImuThreshold,
  SessionObserver,
} from "../../src/domain/cloud";

// An in-process test double for the public Supabase API. No test credential is
// trusted by a real project, and this module is never imported by the app.
export const OWNER_ID = "10000000-0000-4000-8000-000000000001";
export const OBSERVER_ID = "10000000-0000-4000-8000-000000000002";
export const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const now = () => new Date().toISOString();
function token(id: string) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.browser-test-signature`;
}
function user(id: string) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: id === OBSERVER_ID ? "observer@example.test" : "owner@example.test",
    email_confirmed_at: now(),
    created_at: now(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
  };
}
function userFromAuthorization(header: string | undefined) {
  try {
    return JSON.parse(
      Buffer.from(
        (header ?? "").replace(/^Bearer /, "").split(".")[1],
        "base64url",
      ).toString(),
    ).sub as string;
  } catch {
    return null;
  }
}
type Binding = {
  id: number;
  event: string;
  schema: string;
  table: string;
  filter?: string;
};
type Socket = {
  route: WebSocketRoute;
  topic: string;
  joinRef: string | null;
  bindings: Binding[];
};
export class CloudFixture {
  readonly sessions: CloudSession[];
  readonly gps: GpsPoint[];
  readonly events: CloudThresholdEvent[];
  readonly connections: CloudConnection[];
  readonly thresholds: ImuThreshold[];
  readonly observers: SessionObserver[];
  readonly requests: Array<{
    path: string;
    method: string;
    body: unknown;
    userId: string | null;
  }> = [];
  private sockets = new Set<Socket>();
  failSnapshots = false;

  constructor() {
    const timestamp = now();
    this.sessions = [
      {
        id: SESSION_ID,
        owner_id: OWNER_ID,
        label: "Shared test drive",
        started_at: new Date(Date.now() - 60_000).toISOString(),
        ended_at: null,
        data_source: "simulated",
        created_at: timestamp,
      },
    ];
    this.gps = [
      this.point(1, 37.7793, -122.4193),
      this.point(2, 37.7791, -122.419),
    ];
    this.events = [
      {
        id: "40000000-0000-4000-8000-000000000001",
        session_id: SESSION_ID,
        sequence: 1,
        imu_id: 2,
        recorded_at: timestamp,
        received_at: timestamp,
        severity: "critical",
        magnitude: 2.14,
        latitude: 37.7791,
        longitude: -122.419,
        t1: 0.8,
        t2: 1.8,
      },
    ];
    this.connections = [
      {
        session_id: SESSION_ID,
        sequence: 1,
        recorded_at: timestamp,
        received_at: timestamp,
        connected: true,
      },
    ];
    this.thresholds = ([1, 2, 3] as const).map((imu_id) => ({
      session_id: SESSION_ID,
      imu_id,
      t1: 0.8,
      t2: 1.8,
      updated_at: timestamp,
    }));
    this.observers = [
      { session_id: SESSION_ID, user_id: OBSERVER_ID, created_at: timestamp },
    ];
  }
  point(
    sequence: number,
    latitude: number,
    longitude: number,
    recordedAt = now(),
  ): GpsPoint {
    return {
      id: `30000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      session_id: SESSION_ID,
      sequence,
      recorded_at: recordedAt,
      received_at: now(),
      latitude,
      longitude,
      speed_kph: 32,
      heading: 130,
    };
  }
  canRead(id: string | null, sessionId: string) {
    return (
      !!id &&
      (this.sessions.some(
        (session) => session.id === sessionId && session.owner_id === id,
      ) ||
        this.observers.some(
          (observer) =>
            observer.session_id === sessionId && observer.user_id === id,
        ))
    );
  }
  emit(table: string, record: Record<string, unknown>) {
    for (const socket of this.sockets) {
      const ids = socket.bindings
        .filter(
          (binding) =>
            binding.table === table &&
            (!binding.filter ||
              binding.filter.endsWith(`.${record.session_id ?? record.id}`)),
        )
        .map((binding) => binding.id);
      if (!ids.length) continue;
      try {
        socket.route.send(
          JSON.stringify([
            socket.joinRef,
            null,
            socket.topic,
            "postgres_changes",
            {
              ids,
              data: {
                schema: "public",
                table,
                type: "INSERT",
                commit_timestamp: now(),
                columns: [],
                record,
                old_record: {},
                errors: null,
              },
            },
          ]),
        );
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
  addGps(point: GpsPoint) {
    this.gps.push(point);
    this.emit("gps_points", point as unknown as Record<string, unknown>);
  }
  addEvent(event: CloudThresholdEvent) {
    this.events.push(event);
    this.emit("threshold_events", event as unknown as Record<string, unknown>);
  }
  get socketCount() {
    return this.sockets.size;
  }

  async install(context: BrowserContext) {
    await context.route("https://msd-test.supabase.co/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const id = userFromAuthorization(request.headers().authorization);
      let body: Record<string, unknown> = {};
      try {
        body = request.postDataJSON() ?? {};
      } catch {
        /* GET and empty POST */
      }
      this.requests.push({
        path: url.pathname,
        method: request.method(),
        body,
        userId: id,
      });
      const respond = (payload: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-expose-headers": "content-range",
            "content-range": "0-0/*",
          },
          body: JSON.stringify(payload),
        });
      if (request.method() === "OPTIONS") return respond(null, 200);
      if (url.pathname === "/auth/v1/token") {
        if (String(body.password).startsWith("wrong"))
          return respond(
            {
              error: "invalid_grant",
              error_description: "Invalid login credentials",
              msg: "Invalid login credentials",
            },
            400,
          );
        const actor =
          body.email === "observer@example.test" ? OBSERVER_ID : OWNER_ID;
        return respond({
          access_token: token(actor),
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: `fixture-refresh-${actor}`,
          user: user(actor),
        });
      }
      if (url.pathname === "/auth/v1/user")
        return id
          ? respond(user(id))
          : respond({ msg: "Not authenticated" }, 401);
      if (url.pathname === "/auth/v1/signup")
        return respond({ user: user(OWNER_ID), session: null });
      if (url.pathname === "/auth/v1/logout") return respond(null);
      if (!id)
        return respond(
          { message: "Authentication required", code: "42501" },
          401,
        );
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const rpc = url.pathname.split("/").at(-1);
        if (rpc === "create_driving_session") {
          const sessionId = crypto.randomUUID();
          const timestamp = now();
          this.sessions.push({
            id: sessionId,
            owner_id: id,
            label: String(body.p_label),
            started_at: timestamp,
            ended_at: null,
            data_source:
              body.p_data_source === "device" ? "device" : "simulated",
            created_at: timestamp,
          });
          for (const imu_id of [1, 2, 3] as const)
            this.thresholds.push({
              session_id: sessionId,
              imu_id,
              t1: 0.8,
              t2: 1.8,
              updated_at: timestamp,
            });
          return respond(sessionId);
        }
        const sessionId = String(body.p_session_id);
        const session = this.sessions.find((item) => item.id === sessionId);
        if (session?.owner_id !== id)
          return respond(
            { message: "Only the session owner may write", code: "42501" },
            403,
          );
        if (rpc === "finish_driving_session") {
          session.ended_at ??= now();
          this.emit(
            "driving_sessions",
            session as unknown as Record<string, unknown>,
          );
        }
        if (rpc === "ingest_gps")
          for (const point of body.p_points as Omit<
            GpsPoint,
            "session_id" | "received_at"
          >[]) {
            if (
              this.gps.some(
                (old) =>
                  old.id === point.id ||
                  (old.session_id === sessionId &&
                    old.sequence === point.sequence),
              )
            )
              continue;
            this.addGps({
              ...point,
              session_id: sessionId,
              received_at: now(),
            });
          }
        if (rpc === "ingest_threshold_events")
          for (const event of body.p_events as Omit<
            CloudThresholdEvent,
            "session_id" | "received_at"
          >[]) {
            if (
              this.events.some(
                (old) =>
                  old.id === event.id ||
                  (old.session_id === sessionId &&
                    old.sequence === event.sequence),
              )
            )
              continue;
            this.addEvent({
              ...event,
              session_id: sessionId,
              received_at: now(),
            });
          }
        if (rpc === "ingest_connection") {
          const status = {
            ...(body.p_status as Omit<
              CloudConnection,
              "session_id" | "received_at"
            >),
            session_id: sessionId,
            received_at: now(),
          };
          this.connections.push(status);
          this.emit("connection_status", status);
        }
        if (rpc === "set_imu_thresholds")
          for (const value of body.p_thresholds as Array<{
            imu_id: number;
            t1: number;
            t2: number;
          }>) {
            const threshold = this.thresholds.find(
              (old) =>
                old.session_id === sessionId && old.imu_id === value.imu_id,
            );
            if (threshold) {
              Object.assign(threshold, value, { updated_at: now() });
              this.emit(
                "imu_thresholds",
                threshold as unknown as Record<string, unknown>,
              );
            }
          }
        if (rpc === "share_session") {
          if (
            !this.observers.some(
              (observer) =>
                observer.session_id === sessionId &&
                observer.user_id === OBSERVER_ID,
            )
          )
            this.observers.push({
              session_id: sessionId,
              user_id: OBSERVER_ID,
              created_at: now(),
            });
        }
        if (rpc === "revoke_session_observer") {
          const index = this.observers.findIndex(
            (observer) =>
              observer.session_id === sessionId &&
              observer.user_id === body.p_user_id,
          );
          if (index >= 0) this.observers.splice(index, 1);
        }
        return respond(null);
      }
      // Use a terminal access failure here: PostgREST intentionally retries 503,
      // which would test SDK backoff rather than the dashboard's failed-read path.
      if (this.failSnapshots)
        return respond({ message: "Fixture session access unavailable" }, 403);
      const table = url.pathname.split("/").at(-1);
      const sessionFilter = url.searchParams
        .get("session_id")
        ?.replace(/^eq\./, "");
      const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");
      let rows: unknown[] = [];
      if (table === "driving_sessions")
        rows = this.sessions.filter(
          (row) =>
            this.canRead(id, row.id) && (!idFilter || row.id === idFilter),
        );
      if (table === "gps_points")
        rows = this.gps.filter(
          (row) =>
            this.canRead(id, row.session_id) &&
            (!sessionFilter || row.session_id === sessionFilter),
        );
      if (table === "threshold_events")
        rows = this.events.filter(
          (row) =>
            this.canRead(id, row.session_id) &&
            (!sessionFilter || row.session_id === sessionFilter),
        );
      if (table === "connection_status")
        rows = this.connections
          .filter(
            (row) =>
              this.canRead(id, row.session_id) &&
              (!sessionFilter || row.session_id === sessionFilter),
          )
          .sort((a, b) => b.sequence - a.sequence);
      if (table === "imu_thresholds")
        rows = this.thresholds.filter(
          (row) =>
            this.canRead(id, row.session_id) &&
            (!sessionFilter || row.session_id === sessionFilter),
        );
      if (table === "session_observers")
        rows = this.observers.filter(
          (row) =>
            this.canRead(id, row.session_id) &&
            (!sessionFilter || row.session_id === sessionFilter),
        );
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      rows = rows.slice(offset, offset + limit);
      if (
        request.headers().accept?.includes("application/vnd.pgrst.object+json")
      )
        return rows.length === 1
          ? respond(rows[0])
          : respond({ message: "No rows found", code: "PGRST116" }, 406);
      return respond(rows);
    });
    await context.routeWebSocket(
      "wss://msd-test.supabase.co/realtime/v1/**",
      (route) => {
        const socket: Socket = {
          route,
          topic: "",
          joinRef: null,
          bindings: [],
        };
        route.onMessage((raw) => {
          const parsed = JSON.parse(String(raw));
          const arrayProtocol = Array.isArray(parsed);
          const [joinRef, ref, topic, event, payload] = arrayProtocol
            ? parsed
            : [
                parsed.join_ref,
                parsed.ref,
                parsed.topic,
                parsed.event,
                parsed.payload,
              ];
          if (event === "phx_join") {
            socket.topic = topic;
            socket.joinRef = joinRef;
            socket.bindings = (payload.config?.postgres_changes ?? []).map(
              (binding: Binding, index: number) => ({
                ...binding,
                id: index + 1,
              }),
            );
            this.sockets.add(socket);
            const reply = {
              status: "ok",
              response: { postgres_changes: socket.bindings },
            };
            route.send(
              JSON.stringify(
                arrayProtocol
                  ? [joinRef, ref, topic, "phx_reply", reply]
                  : {
                      join_ref: joinRef,
                      ref,
                      topic,
                      event: "phx_reply",
                      payload: reply,
                    },
              ),
            );
          } else if (event === "heartbeat" || event === "phx_leave") {
            const reply = { status: "ok", response: {} };
            route.send(
              JSON.stringify(
                arrayProtocol
                  ? [joinRef, ref, topic, "phx_reply", reply]
                  : {
                      join_ref: joinRef,
                      ref,
                      topic,
                      event: "phx_reply",
                      payload: reply,
                    },
              ),
            );
            if (event === "phx_leave") this.sockets.delete(socket);
          }
        });
        route.onClose(() => this.sockets.delete(socket));
      },
    );
    await context.route(/https:\/\/tile\.openstreetmap\.org\//, (route) =>
      route.abort(),
    );
  }
}
