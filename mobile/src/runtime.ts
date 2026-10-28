import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { authStorage } from "./authStorage";
import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import NetInfo from "@react-native-community/netinfo";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import { Outbox, Uploader, type Drive } from "./outbox";
import { gpsPayload, type EventPacket, type LocationFix } from "./protocol";
import { HardwareBle, SimulatedBle, type Source } from "./ble";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
// Public configuration only. Refuse common privileged key formats.
let privileged = false;
try {
  privileged = JSON.parse(atob(key.split(".")[1])).role === "service_role";
} catch {}
if (key.startsWith("sb_secret_") || privileged)
  throw new Error("Privileged Supabase keys are forbidden");
export const configured = !!url && !!key;
export const client = createClient(
  url || "https://unconfigured.supabase.co",
  key || "unconfigured",
  {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
const TASK = "msd-driving-location";
let boxPromise: Promise<Outbox> | undefined;
export function getBox() {
  return (boxPromise ??= (async () => {
    const box = new Outbox(await SQLite.openDatabaseAsync("msd-gateway.db"));
    await box.init();
    return box;
  })());
}
async function report(e: unknown) {
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String(e.message)
        : String(e);
  await (await getBox()).error(message);
}
let ingestion: Promise<unknown> = Promise.resolve();
function collect<T>(fn: () => Promise<T>): Promise<T> {
  const job = ingestion.then(fn);
  ingestion = job.catch(() => {});
  return job;
}
let uploader: Uploader | undefined;
let failures = 0,
  retryAt = 0;
export async function flush() {
  try {
    if (Date.now() < retryAt) return;
    const net = await NetInfo.fetch();
    if (!net.isConnected || net.isInternetReachable === false) return;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) return;
    uploader ??= new Uploader(await getBox(), client);
    await uploader.flush(session.user.id);
    failures = 0;
    retryAt = 0;
  } catch (e) {
    retryAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(failures++, 6));
    await report(e);
  }
}
async function checkTime(drive: Drive, time: string) {
  const ms = Date.parse(time);
  if (
    !Number.isFinite(ms) ||
    ms < Date.parse(drive.startedAt) ||
    ms > Date.now() + 60000
  )
    throw new Error(
      "Source timestamp outside session bounds; check source clock",
    );
}
async function locations(fixes: LocationFix[]) {
  const box = await getBox();
  const drive = await box.drive();
  if (!drive || drive.stopped) return;
  for (const fix of fixes) {
    try {
      const payload = gpsPayload(fix, Crypto.randomUUID());
      await checkTime(drive, payload.recorded_at as string);
      // OS can replay a location callback. Durable receipt survives upload and restart.
      await box.enqueue(drive, "gps", payload, String(fix.timestamp));
    } catch (e) {
      await report(e);
    }
  }
  void flush();
}
export function recordLocations(fixes: LocationFix[]) {
  return collect(() => locations(fixes));
}
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  TASK,
  async ({ data, error }) => {
    if (error) {
      await report(error);
      return;
    }
    if (data) await recordLocations(data.locations);
  },
);
let source: Source | undefined,
  watch: Location.LocationSubscription | undefined;
let connected = false,
  timer: ReturnType<typeof setInterval> | undefined;
let starting = false;
async function recordStatus(value: boolean) {
  connected = value;
  const box = await getBox();
  const drive = await box.drive();
  if (drive && !drive.stopped) {
    const time = new Date().toISOString();
    await box.enqueue(
      drive,
      "connection",
      { recorded_at: time, connected: value },
      Crypto.randomUUID(),
    );
  }
}
function status(value: boolean) {
  return collect(() => recordStatus(value));
}
async function recordEvent(packet: EventPacket) {
  const box = await getBox();
  const drive = await box.drive();
  if (!drive || drive.stopped) return;
  await checkTime(drive, packet.recorded_at);
  await box.enqueue(drive, "event", { ...packet }, packet.id);
}
function event(packet: EventPacket) {
  return collect(() => recordEvent(packet));
}
async function permissions(hardware: boolean, background: boolean) {
  if (hardware && Platform.OS === "android" && Number(Platform.Version) >= 31) {
    const perms = [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ];
    const result = await PermissionsAndroid.requestMultiple(perms);
    if (perms.some((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED))
      throw new Error("Bluetooth permissions required");
  }
  if (Platform.OS === "android" && Number(Platform.Version) >= 33 && background)
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  if ((await Location.requestForegroundPermissionsAsync()).status !== "granted")
    throw new Error("Precise location permission required");
  if (
    background &&
    (await Location.requestBackgroundPermissionsAsync()).status !== "granted"
  )
    throw new Error(
      "Background location permission denied; select foreground test mode",
    );
}
export async function run(
  drive: Drive,
  background: boolean,
  requestPermissions = true,
) {
  if (starting || source) return;
  starting = true;
  try {
    if (requestPermissions)
      await permissions(drive.source === "device", background);
    const box = await getBox();
    const {
      data: { session },
    } = await client.auth.getSession();
    if (session?.user.id !== drive.owner)
      throw new Error("Sign in as the session owner");
    drive = { ...drive, stopped: false, background };
    await box.saveDrive(drive);
    const opts = {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1000,
      distanceInterval: 0,
    };
    if (background) {
      if (await Location.hasStartedLocationUpdatesAsync(TASK))
        await Location.stopLocationUpdatesAsync(TASK);
      await Location.startLocationUpdatesAsync(TASK, {
        ...opts,
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.AutomotiveNavigation,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "MSD driving session",
          notificationBody: "Recording GPS and forwarding helmet events",
        },
      });
    } else
      watch = await Location.watchPositionAsync(opts, (fix) => {
        void recordLocations([fix]).catch(report);
      });
    source =
      drive.source === "simulated"
        ? new SimulatedBle(Crypto.randomUUID)
        : new HardwareBle(drive.device, drive.service, drive.characteristic);
    source.start(
      (packet) => {
        void event(packet).catch(report);
      },
      (value) => {
        void status(value).catch(report);
      },
      (e) => {
        void report(e);
      },
    );
    timer = setInterval(() => {
      void status(connected).then(flush).catch(report);
    }, 5000);
  } catch (e) {
    await cleanup();
    await report(e);
    throw e;
  } finally {
    starting = false;
  }
}
async function cleanup() {
  clearInterval(timer);
  watch?.remove();
  watch = undefined;
  const old = source;
  source = undefined;
  await old?.stop();
  connected = false;
  if (await Location.hasStartedLocationUpdatesAsync(TASK))
    await Location.stopLocationUpdatesAsync(TASK);
}
export async function stop() {
  await cleanup();
  await collect(async () => {
    const box = await getBox();
    const drive = await box.drive();
    if (!drive || drive.stopped) return;
    // Persist stop + final observation + finish barrier atomically.
    await box.end(drive, new Date().toISOString());
  });
  await flush();
}
export const isRunning = () => !!source;
export const bleConnected = () => connected;
export async function recover() {
  const drive = await (await getBox()).drive();
  if (!drive || drive.stopped || source) return;
  const {
    data: { session },
  } = await client.auth.getSession();
  if (session?.user.id !== drive.owner) return;
  if ((await Location.getForegroundPermissionsAsync()).status !== "granted")
    return;
  if (
    drive.background &&
    (await Location.getBackgroundPermissionsAsync()).status !== "granted"
  )
    return;
  if (
    drive.source === "device" &&
    Platform.OS === "android" &&
    Number(Platform.Version) >= 31
  ) {
    for (const p of [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ])
      if (!(await PermissionsAndroid.check(p))) return;
  }
  await run(drive, drive.background ?? false, false);
}
NetInfo.addEventListener((state) => {
  if (state.isConnected && state.isInternetReachable !== false) {
    retryAt = 0;
    void flush();
  }
});
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    client.auth.startAutoRefresh();
    void flush();
  } else client.auth.stopAutoRefresh();
});
// Only while OS permits JS execution; not a promise of background scheduling.
setInterval(() => void flush(), 5000);
