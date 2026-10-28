import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CloudDataSource,
  CloudSession,
  CloudSnapshot,
  ConnectionUpload,
  EventUpload,
  GpsUpload,
  ImuThreshold,
  SessionObserver,
  GpsPoint,
  CloudThresholdEvent,
  CloudConnection,
} from "../domain/cloud";
import { normalizeEvents, normalizeGps } from "../domain/cloudRecords";

export type RealtimeState = "connecting" | "subscribed" | "error" | "closed";
const PAGE_SIZE = 1000;
function failure(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

/** Every request is made with the current authenticated user's JWT; RLS is authoritative. */
export class CloudRepository {
  constructor(readonly client: SupabaseClient) {}

  async listSessions(): Promise<CloudSession[]> {
    const rows: CloudSession[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const { data, error } = await this.client
        .from("driving_sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .order("id")
        .range(start, start + PAGE_SIZE - 1);
      failure(error, "Load sessions");
      rows.push(...((data ?? []) as CloudSession[]));
      if ((data?.length ?? 0) < PAGE_SIZE) return rows;
    }
  }
  private async sessionRows<T>(
    table: string,
    sessionId: string,
    order: string,
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      let query = this.client
        .from(table)
        .select("*")
        .eq("session_id", sessionId)
        .order(order);
      if (order === "recorded_at") query = query.order("sequence");
      const { data, error } = await query.range(start, start + PAGE_SIZE - 1);
      failure(error, `Load ${table}`);
      rows.push(...((data ?? []) as T[]));
      if ((data?.length ?? 0) < PAGE_SIZE) return rows;
    }
  }
  async createSession(label: string, source: CloudDataSource): Promise<string> {
    const { data, error } = await this.client.rpc("create_driving_session", {
      p_label: label,
      p_data_source: source,
    });
    failure(error, "Create session");
    if (typeof data !== "string")
      throw new Error(
        "Create session returned no session ID. Check the installed database migration.",
      );
    return data;
  }
  async finishSession(sessionId: string): Promise<void> {
    const { error } = await this.client.rpc("finish_driving_session", {
      p_session_id: sessionId,
    });
    failure(error, "Finish session");
  }
  async loadSnapshot(sessionId: string): Promise<CloudSnapshot> {
    const [
      sessionResult,
      gps,
      events,
      connectionResult,
      thresholds,
      observers,
    ] = await Promise.all([
      this.client
        .from("driving_sessions")
        .select("*")
        .eq("id", sessionId)
        .single(),
      this.sessionRows<GpsPoint>("gps_points", sessionId, "recorded_at"),
      this.sessionRows<CloudThresholdEvent>(
        "threshold_events",
        sessionId,
        "recorded_at",
      ),
      this.client
        .from("connection_status")
        .select("*")
        .eq("session_id", sessionId)
        .order("sequence", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.sessionRows<ImuThreshold>("imu_thresholds", sessionId, "imu_id"),
      this.sessionRows<SessionObserver>(
        "session_observers",
        sessionId,
        "user_id",
      ),
    ]);
    failure(sessionResult.error, "Load driving session");
    failure(connectionResult.error, "Load connection status");
    if (!sessionResult.data)
      throw new Error("Session not found or access is no longer available.");
    return {
      session: sessionResult.data as CloudSession,
      gps: normalizeGps(gps),
      events: normalizeEvents(events),
      connection: connectionResult.data as CloudConnection | null,
      thresholds,
      observers,
    };
  }
  /** Realtime notifications invalidate persisted state; reconnecting must reload the snapshot. */
  watchSession(
    sessionId: string,
    onChange: () => void,
    onStatus: (state: RealtimeState) => void,
  ): () => void {
    let closed = false;
    onStatus("connecting");
    const channel = this.client.channel(
      `session:${sessionId}:${crypto.randomUUID()}`,
    );
    const changed = () => {
      if (!closed) onChange();
    };
    for (const table of [
      "gps_points",
      "threshold_events",
      "connection_status",
      "imu_thresholds",
    ]) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `session_id=eq.${sessionId}`,
        },
        changed,
      );
    }
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "driving_sessions",
        filter: `id=eq.${sessionId}`,
      },
      changed,
    );
    channel.subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        onStatus("subscribed");
        onChange();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        onStatus("error");
      else if (status === "CLOSED") onStatus("closed");
    });
    return () => {
      if (closed) return;
      closed = true;
      void this.client.removeChannel(channel);
    };
  }
  async setThresholds(
    sessionId: string,
    thresholds: Array<Pick<ImuThreshold, "imu_id" | "t1" | "t2">>,
  ): Promise<void> {
    const { error } = await this.client.rpc("set_imu_thresholds", {
      p_session_id: sessionId,
      p_thresholds: thresholds,
    });
    failure(error, "Save IMU thresholds");
  }
  async shareSession(sessionId: string, email: string): Promise<void> {
    const { error } = await this.client.rpc("share_session", {
      p_session_id: sessionId,
      p_email: email,
    });
    failure(error, "Share session");
  }
  async revokeObserver(sessionId: string, userId: string): Promise<void> {
    const { error } = await this.client.rpc("revoke_session_observer", {
      p_session_id: sessionId,
      p_user_id: userId,
    });
    failure(error, "Revoke observer");
  }
  async ingestGps(sessionId: string, points: GpsUpload[]): Promise<void> {
    const { error } = await this.client.rpc("ingest_gps", {
      p_session_id: sessionId,
      p_points: points,
    });
    failure(error, "Upload GPS");
  }
  async ingestEvents(sessionId: string, events: EventUpload[]): Promise<void> {
    const { error } = await this.client.rpc("ingest_threshold_events", {
      p_session_id: sessionId,
      p_events: events,
    });
    failure(error, "Upload threshold events");
  }
  async ingestConnection(
    sessionId: string,
    status: ConnectionUpload,
  ): Promise<void> {
    const { error } = await this.client.rpc("ingest_connection", {
      p_session_id: sessionId,
      p_status: status,
    });
    failure(error, "Upload connection status");
  }
}
