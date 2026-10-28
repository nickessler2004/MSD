import type { CloudConnection, CloudThresholdEvent, GpsPoint } from "./cloud";
import type { TelemetryFreshness } from "./types";
import { haversineDistanceKm } from "./monitoring";

/** The database is append-only. If a duplicate delivery conflicts, retain the first received row. */
function normalize<
  T extends {
    id: string;
    session_id: string;
    sequence: number;
    recorded_at: string;
    received_at: string;
  },
>(rows: readonly T[]): T[] {
  const byId = new Set<string>();
  const bySequence = new Set<string>();
  return [...rows]
    .sort(
      (a, b) =>
        Date.parse(a.received_at) - Date.parse(b.received_at) ||
        a.id.localeCompare(b.id),
    )
    .filter((row) => {
      const sequence = `${row.session_id}:${row.sequence}`;
      if (byId.has(row.id) || bySequence.has(sequence)) return false;
      byId.add(row.id);
      bySequence.add(sequence);
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(a.recorded_at) - Date.parse(b.recorded_at) ||
        a.sequence - b.sequence ||
        a.id.localeCompare(b.id),
    );
}
export function normalizeGps(rows: readonly GpsPoint[]): GpsPoint[] {
  return normalize(rows);
}
export function normalizeEvents(
  rows: readonly CloudThresholdEvent[],
): CloudThresholdEvent[] {
  return normalize(rows);
}
export function latestGps(rows: readonly GpsPoint[]): GpsPoint | null {
  return normalizeGps(rows).at(-1) ?? null;
}

/** Source time is essential: a delayed backlog received now is not a live GPS fix. */
export function gpsFreshness(
  point: GpsPoint | null,
  now: number,
  staleAfterMs = 5000,
): TelemetryFreshness {
  if (!point) return "waiting";
  const timestamp = Date.parse(point.recorded_at);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now) || timestamp > now)
    return "waiting";
  return now - timestamp <= staleAfterMs ? "fresh" : "stale";
}
export function connectionFreshness(
  connection: CloudConnection | null,
  now: number,
  staleAfterMs = 15000,
): TelemetryFreshness {
  if (!connection) return "waiting";
  if (!connection.connected) return "disconnected";
  const timestamp = Date.parse(connection.recorded_at);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now) || timestamp > now)
    return "waiting";
  return now - timestamp <= staleAfterMs ? "fresh" : "stale";
}
/** Recalculate from source-time ordering rather than arrival-order deltas. */
export function routeDistanceKm(rows: readonly GpsPoint[]): number {
  const points = normalizeGps(rows);
  return points
    .slice(1)
    .reduce(
      (distance, point, index) =>
        distance + haversineDistanceKm(points[index], point),
      0,
    );
}
