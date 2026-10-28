import type { Coordinates, Thresholds } from "./types";
export interface AnalysisEvent {
  id: string;
  timestamp: number;
  imuId: number | null;
  severity: "warning" | "critical";
  magnitude: number | null;
  position: Coordinates | null;
  thresholds: Thresholds | null;
  source: string;
}
export interface EventFilters {
  imu: string;
  severity: string;
  since: number | null;
  until: number | null;
}
export function filterAnalysisEvents(
  events: AnalysisEvent[],
  filters: EventFilters,
) {
  return events
    .filter(
      (e) =>
        (filters.imu === "all" ||
          String(e.imuId ?? "unknown") === filters.imu) &&
        (filters.severity === "all" || e.severity === filters.severity) &&
        (filters.since === null || e.timestamp >= filters.since) &&
        (filters.until === null || e.timestamp <= filters.until),
    )
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}
export function reportedPeak(events: Array<{ magnitude: number | null }>) {
  const values = events.flatMap((e) =>
    e.magnitude === null ? [] : [e.magnitude],
  );
  return values.length ? Math.max(...values) : null;
}
