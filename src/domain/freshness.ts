import type { TelemetryFreshness } from "./types";

export const TELEMETRY_STALE_AFTER_MS = 5_000;

export interface FreshnessInput {
  connected: boolean;
  /** Local receipt time, not the event's occurrence timestamp. */
  lastReceivedAt: number | null;
  now: number;
  staleAfterMs?: number;
}

/**
 * Receipt freshness describes availability, never a confirmed normal impact state.
 * Event-only silence cannot establish that the vehicle is currently below T1.
 */
export function getFreshness({
  connected,
  lastReceivedAt,
  now,
  staleAfterMs = TELEMETRY_STALE_AFTER_MS,
}: FreshnessInput): TelemetryFreshness {
  if (!connected) return "disconnected";
  if (
    lastReceivedAt === null ||
    !Number.isFinite(lastReceivedAt) ||
    !Number.isFinite(now) ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs < 0 ||
    lastReceivedAt > now
  )
    return "waiting";
  return now - lastReceivedAt <= staleAfterMs ? "fresh" : "stale";
}
