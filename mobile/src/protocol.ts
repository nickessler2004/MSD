/** Stage 2 event payload; gateway assigns durable cloud sequence, MCU supplies stable UUID. */
export interface EventPacket {
  id: string;
  imu_id: 1 | 2 | 3;
  recorded_at: string;
  severity: "warning" | "critical";
  magnitude: number | null;
  latitude: number | null;
  longitude: number | null;
  t1: number;
  t2: number;
}
export type Stream = "gps" | "event" | "connection" | "finish";
export type Payload = Record<string, unknown>;
export const validTime = (value: unknown): value is string =>
  typeof value === "string" &&
  /Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export function parseEvent(value: unknown): EventPacket {
  const e = value as EventPacket;
  if (
    !e ||
    typeof e.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      e.id,
    ) ||
    ![1, 2, 3].includes(e.imu_id) ||
    !validTime(e.recorded_at) ||
    !finite(e.t1) ||
    !finite(e.t2) ||
    !(0 < e.t1 && e.t1 < e.t2 && e.t2 <= 10) ||
    !["warning", "critical"].includes(e.severity) ||
    !(
      e.magnitude === null ||
      (finite(e.magnitude) &&
        (e.severity === "warning"
          ? e.magnitude >= e.t1 && e.magnitude <= e.t2
          : e.magnitude > e.t2))
    ) ||
    !(
      (e.latitude === null && e.longitude === null) ||
      (finite(e.latitude) &&
        finite(e.longitude) &&
        Math.abs(e.latitude) <= 90 &&
        Math.abs(e.longitude) <= 180)
    )
  )
    throw new Error("Invalid BLE event packet");
  // Whitelist fields: source cannot override session, sequence or provenance.
  return {
    id: e.id,
    imu_id: e.imu_id,
    recorded_at: e.recorded_at,
    severity: e.severity,
    magnitude: e.magnitude,
    latitude: e.latitude,
    longitude: e.longitude,
    t1: e.t1,
    t2: e.t2,
  };
}
export interface LocationFix {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
  };
}
export function gpsPayload(fix: LocationFix, id: string): Payload {
  const c = fix.coords;
  if (
    !Number.isFinite(fix.timestamp) ||
    !finite(c.latitude) ||
    !finite(c.longitude) ||
    Math.abs(c.latitude) > 90 ||
    Math.abs(c.longitude) > 180 ||
    !finite(c.accuracy) ||
    c.accuracy < 0
  )
    throw new Error("GPS fix lacks valid coordinates or accuracy");
  return {
    id,
    recorded_at: new Date(fix.timestamp).toISOString(),
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy_m: c.accuracy,
    speed_kph: finite(c.speed) && c.speed >= 0 ? c.speed * 3.6 : null,
    heading:
      finite(c.heading) && c.heading >= 0 && c.heading < 360 ? c.heading : null,
  };
}
