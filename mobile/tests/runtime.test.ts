import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Drive } from "../src/outbox";
const state = vi.hoisted(() => ({
  online: false,
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    error: null,
  })),
  watch: vi.fn(),
  background: vi.fn(),
  stopBackground: vi.fn(),
  task: undefined as undefined | ((args: any) => Promise<void>),
  permission: vi.fn(async () => ({ status: "granted" })),
}));
vi.mock("react-native-url-polyfill/auto", () => ({}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-crypto", () => ({ randomUUID }));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => {
    const db = new DatabaseSync(":memory:");
    return {
      execAsync: async (s: string) => {
        db.exec(s);
      },
      runAsync: async (s: string, ...p: any[]) => db.prepare(s).run(...p),
      getFirstAsync: async (s: string, ...p: any[]) =>
        db.prepare(s).get(...p) ?? null,
    };
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: state.rpc,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "owner" } } },
      }),
      startAutoRefresh: vi.fn(),
      stopAutoRefresh: vi.fn(),
    },
  }),
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    fetch: async () => ({
      isConnected: state.online,
      isInternetReachable: state.online,
    }),
    addEventListener: vi.fn(),
  },
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn() },
  Platform: { OS: "ios", Version: 18 },
  PermissionsAndroid: {},
}));
vi.mock("react-native-ble-plx", () => ({
  BleManager: vi.fn(),
  State: { PoweredOn: "PoweredOn" },
}));
vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, task: any) => {
    state.task = task;
  },
}));
vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: state.permission,
  requestBackgroundPermissionsAsync: state.permission,
  getForegroundPermissionsAsync: state.permission,
  getBackgroundPermissionsAsync: state.permission,
  hasStartedLocationUpdatesAsync: async () => false,
  stopLocationUpdatesAsync: state.stopBackground,
  startLocationUpdatesAsync: state.background,
  watchPositionAsync: async (...args: any[]) => {
    state.watch(...args);
    return { remove: vi.fn() };
  },
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { AutomotiveNavigation: 1 },
}));
let runtime: typeof import("../src/runtime");
const drive: Drive = {
  id: "drive",
  owner: "owner",
  source: "simulated",
  startedAt: new Date().toISOString(),
  stopped: false,
  device: "",
  service: "",
  characteristic: "",
};
beforeAll(async () => {
  vi.useFakeTimers();
  runtime = await import("../src/runtime");
});
afterAll(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("integrates simulated BLE + native GPS callback + offline queue + ordered RPC recovery", async () => {
  await runtime.run(drive, false);
  expect(state.watch.mock.calls[0][0]).toMatchObject({
    timeInterval: 1000,
    distanceInterval: 0,
  });
  await vi.advanceTimersByTimeAsync(9000);
  const timestamp = Date.now();
  const fix = {
    timestamp,
    coords: {
      latitude: 37,
      longitude: -122,
      accuracy: 4,
      speed: 2,
      heading: 90,
    },
  };
  // The exported task/callback boundary uses the same serialized collector.
  await runtime.recordLocations([fix]);
  await runtime.recordLocations([fix]);
  expect(state.rpc).not.toHaveBeenCalled();
  const box = await runtime.getBox();
  expect(await box.count()).toBeGreaterThan(3);
  await runtime.stop();
  expect((await box.drive())!.stopped).toBe(true);
  state.online = true;
  await runtime.flush();
  expect(await box.count()).toBe(0);
  const events = state.rpc.mock.calls
    .filter(([name]) => name === "ingest_threshold_events")
    .map(([, args]) => (args.p_events as any[])[0]);
  expect(events.map((e) => e.imu_id)).toEqual([1, 2, 3]);
  expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  expect(events.every((e) => e.magnitude === null && e.latitude === null)).toBe(
    true,
  );
  const gps = state.rpc.mock.calls.filter(([name]) => name === "ingest_gps");
  expect(gps).toHaveLength(1);
  expect((gps[0][1].p_points as any[])[0]).toMatchObject({
    recorded_at: new Date(timestamp).toISOString(),
    accuracy_m: 4,
  });
  expect(state.rpc.mock.calls.at(-1)![0]).toBe("finish_driving_session");
});
it("registers experimental background location and ingests headless callbacks through the outbox", async () => {
  state.online = false;
  state.rpc.mockClear();
  await runtime.run(
    { ...drive, id: "background-drive", startedAt: new Date().toISOString() },
    true,
  );
  expect(state.background).toHaveBeenCalledWith(
    "msd-driving-location",
    expect.objectContaining({
      timeInterval: 1000,
      showsBackgroundLocationIndicator: true,
      foregroundService: expect.any(Object),
    }),
  );
  await state.task!({
    data: {
      locations: [
        {
          timestamp: Date.now(),
          coords: {
            latitude: 1,
            longitude: 2,
            accuracy: 8,
            speed: null,
            heading: null,
          },
        },
      ],
    },
  });
  expect(await (await runtime.getBox()).count()).toBeGreaterThan(0);
  await runtime.stop();
  state.online = true;
  await runtime.flush();
  expect(state.rpc.mock.calls.some(([name]) => name === "ingest_gps")).toBe(
    true,
  );
});
