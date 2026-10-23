import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudRepository } from "./cloudRepository";
import { assertPublicSupabaseKeys, getSupabaseConfig } from "./supabase";
import type { CloudSession, GpsPoint } from "../domain/cloud";

type Query = {
  table: string;
  operations: Array<{ name: string; args: unknown[] }>;
};
function mockClient(
  resolve: (query: Query) => {
    data: unknown;
    error: { message: string } | null;
  },
) {
  const queries: Query[] = [];
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const client = {
    rpc,
    from(table: string) {
      const query: Query = { table, operations: [] };
      queries.push(query);
      const builder = {
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(resolve(query)).then(onFulfilled, onRejected);
        },
      } as Record<string, unknown>;
      for (const name of [
        "select",
        "eq",
        "order",
        "range",
        "single",
        "maybeSingle",
        "limit",
      ])
        builder[name] = (...args: unknown[]) => {
          query.operations.push({ name, args });
          return builder;
        };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries, rpc };
}
const session: CloudSession = {
  id: "a",
  owner_id: "owner",
  label: "Drive",
  started_at: "2026-10-21T00:00:00Z",
  ended_at: null,
  data_source: "simulated",
  created_at: "2026-10-21T00:00:00Z",
};
const gps = (sequence: number): GpsPoint => ({
  id: `gps-${sequence}`,
  session_id: "a",
  sequence,
  recorded_at: new Date(1700000000000 + sequence * 1000).toISOString(),
  received_at: new Date(1700000000000 + sequence * 1000 + 1).toISOString(),
  latitude: 37,
  longitude: -122,
  speed_kph: 30,
  heading: 0,
});

describe("public Supabase configuration", () => {
  const publicKey = "sb_publishable_public_key_for_tests";
  const config = (
    key = publicKey,
    url = "https://example-project.supabase.co",
  ) =>
    getSupabaseConfig({
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_PUBLISHABLE_KEY: key,
    });
  it("keeps cloud mode inert until real public configuration is supplied", () => {
    expect(getSupabaseConfig({}).ready).toBe(false);
    expect(config(publicKey, "https://your-project.supabase.co").ready).toBe(
      false,
    );
    expect(config().ready).toBe(true);
    expect(config(publicKey, "http://127.0.0.1:54321").ready).toBe(true);
    expect(config(publicKey, "http://example-project.supabase.co").ready).toBe(
      false,
    );
    expect(
      config(publicKey, "https://user:password@example-project.supabase.co")
        .ready,
    ).toBe(false);
  });
  it("blocks privileged keys at build time even if configuration is otherwise missing or another public key takes precedence", () => {
    expect(() =>
      assertPublicSupabaseKeys({
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_log",
      }),
    ).toThrow("frontend build");
    const secretJwt = `header.${btoa(JSON.stringify({ role: "service_role" }))}.signature`;
    expect(() =>
      assertPublicSupabaseKeys({
        VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
        VITE_SUPABASE_ANON_KEY: secretJwt,
      }),
    ).toThrow("frontend build");
    expect(() => assertPublicSupabaseKeys({})).not.toThrow();
  });
  it("rejects secret/service-role keys and accepts only legacy anon JWTs", () => {
    const jwt = (role: string) =>
      `header.${btoa(JSON.stringify({ role })).replace(/=/g, "")}.signature`;
    expect(config("sb_secret_not_for_browser").ready).toBe(false);
    expect(config(jwt("service_role")).ready).toBe(false);
    expect(config(jwt("authenticated")).ready).toBe(false);
    expect(config(jwt("anon")).ready).toBe(true);
    expect(config("malformed-token").ready).toBe(false);
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: "https://example-project.supabase.co",
        VITE_SUPABASE_ANON_KEY: jwt("anon"),
      }).ready,
    ).toBe(true);
  });
});

describe("authenticated cloud repository", () => {
  it("loads more than a PostgREST default page and scopes every telemetry table to the session", async () => {
    const points = Array.from({ length: 1002 }, (_, i) => gps(i));
    const mock = mockClient((query) => {
      if (query.table === "driving_sessions")
        return { data: session, error: null };
      if (query.table === "connection_status")
        return { data: null, error: null };
      const range = query.operations.find((op) => op.name === "range")
        ?.args as number[];
      return {
        data:
          query.table === "gps_points"
            ? points.slice(range[0], range[1] + 1)
            : [],
        error: null,
      };
    });
    const snapshot = await new CloudRepository(mock.client).loadSnapshot("a");
    expect(snapshot.gps).toHaveLength(1002);
    expect(snapshot.gps.at(-1)?.sequence).toBe(1001);
    expect(snapshot.connection).toBeNull();
    for (const query of mock.queries.filter(
      (q) => q.table !== "driving_sessions",
    ))
      expect(query.operations).toContainEqual({
        name: "eq",
        args: ["session_id", "a"],
      });
    expect(mock.queries.filter((q) => q.table === "gps_points")).toHaveLength(
      2,
    );
    expect(
      mock.queries.find((q) => q.table === "connection_status")?.operations,
    ).toContainEqual({
      name: "order",
      args: ["sequence", { ascending: false }],
    });
  });
  it("preserves source-time route order under repeated/out-of-order deliveries", async () => {
    const mock = mockClient((query) => ({
      data:
        query.table === "driving_sessions"
          ? session
          : query.table === "connection_status"
            ? null
            : query.table === "gps_points"
              ? [gps(3), gps(1), gps(2), gps(2)]
              : [],
      error: null,
    }));
    expect(
      (await new CloudRepository(mock.client).loadSnapshot("a")).gps.map(
        (p) => p.sequence,
      ),
    ).toEqual([1, 2, 3]);
  });
  it("surfaces permission failures instead of returning an empty successful history", async () => {
    const mock = mockClient(() => ({
      data: null,
      error: { message: "permission denied" },
    }));
    await expect(
      new CloudRepository(mock.client).listSessions(),
    ).rejects.toThrow("permission denied");
    await expect(
      new CloudRepository(mock.client).loadSnapshot("a"),
    ).rejects.toThrow("permission denied");
  });
  it("paginates the session list as well as telemetry records", async () => {
    const sessions = Array.from({ length: 1001 }, (_, i) => ({
      ...session,
      id: String(i),
    }));
    const mock = mockClient((query) => {
      const range = query.operations.find((op) => op.name === "range")!
        .args as number[];
      return { data: sessions.slice(range[0], range[1] + 1), error: null };
    });
    expect(await new CloudRepository(mock.client).listSessions()).toHaveLength(
      1001,
    );
  });
  it("writes only through authenticated ingestion/sharing/threshold RPCs with session scope", async () => {
    const mock = mockClient(() => ({ data: [], error: null }));
    mock.rpc.mockResolvedValue({ data: "new-session" as never, error: null });
    const repository = new CloudRepository(mock.client);
    expect(await repository.createSession("Test drive", "simulated")).toBe(
      "new-session",
    );
    await repository.ingestGps("a", [
      {
        id: "gps",
        sequence: 1,
        recorded_at: session.started_at,
        latitude: 37,
        longitude: -122,
        speed_kph: null,
        heading: null,
      },
    ]);
    await repository.ingestEvents("a", []);
    await repository.ingestConnection("a", {
      sequence: 1,
      recorded_at: session.started_at,
      connected: true,
    });
    await repository.setThresholds("a", [{ imu_id: 1, t1: 0.8, t2: 1.8 }]);
    await repository.shareSession("a", "observer@example.com");
    await repository.revokeObserver("a", "observer");
    await repository.finishSession("a");
    expect(mock.rpc.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "create_driving_session",
      "ingest_gps",
      "ingest_threshold_events",
      "ingest_connection",
      "set_imu_thresholds",
      "share_session",
      "revoke_session_observer",
      "finish_driving_session",
    ]);
    expect(mock.rpc).toHaveBeenCalledWith("share_session", {
      p_session_id: "a",
      p_email: "observer@example.com",
    });
    expect(mock.queries).toEqual([]);
  });
  it("reloads on subscribed/reconnected notifications and removes listeners on cleanup", () => {
    const handlers: Array<{
      filter: Record<string, unknown>;
      callback: () => void;
    }> = [];
    let statusCallback: (status: string) => void = () => {};
    const channel = {
      on: vi.fn(
        (
          _event: string,
          filter: Record<string, unknown>,
          callback: () => void,
        ) => {
          handlers.push({ filter, callback });
          return channel;
        },
      ),
      subscribe: vi.fn((callback: (status: string) => void) => {
        statusCallback = callback;
        return channel;
      }),
    };
    const client = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
    } as unknown as SupabaseClient;
    const changed = vi.fn();
    const status = vi.fn();
    const stop = new CloudRepository(client).watchSession("a", changed, status);
    expect(status).toHaveBeenCalledWith("connecting");
    expect(handlers).toHaveLength(5);
    expect(
      handlers
        .filter((h) => h.filter.table !== "driving_sessions")
        .every((h) => h.filter.filter === "session_id=eq.a"),
    ).toBe(true);
    statusCallback("SUBSCRIBED");
    handlers[0].callback();
    expect(changed).toHaveBeenCalledTimes(2);
    statusCallback("CHANNEL_ERROR");
    expect(status).toHaveBeenLastCalledWith("error");
    stop();
    stop();
    handlers[0].callback();
    statusCallback("SUBSCRIBED");
    expect(changed).toHaveBeenCalledTimes(2);
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
