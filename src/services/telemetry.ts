import { haversineDistanceKm } from "../domain/monitoring";
import type {
  Coordinates,
  TelemetryMessage,
  TelemetrySample,
  ThresholdEvent,
} from "../domain/types";

/**
 * Continuous sample source for the live simulation only.
 * Real ESP32-S3 integration must use event messages instead; threshold-only packets
 * cannot establish a current acceleration, speed, GPS fix, or confirmed green state.
 */
export interface TelemetrySource {
  subscribe(onSample: (sample: TelemetrySample | null) => void): () => void;
}

/** A closed route through San Francisco's Civic Center and SOMA. No live GPS is read. */
export const ROUTE_COORDINATES: Coordinates[] = [
  { latitude: 37.7793, longitude: -122.4193 },
  { latitude: 37.7774, longitude: -122.4169 },
  { latitude: 37.7801, longitude: -122.4135 },
  { latitude: 37.7767, longitude: -122.4092 },
  { latitude: 37.7743, longitude: -122.4122 },
  { latitude: 37.7718, longitude: -122.4154 },
  { latitude: 37.7753, longitude: -122.4198 },
  { latitude: 37.7762, longitude: -122.421 },
  { latitude: 37.7793, longitude: -122.4193 },
];

const segments = ROUTE_COORDINATES.slice(1).map((end, index) => ({
  start: ROUTE_COORDINATES[index],
  end,
  distanceKm: haversineDistanceKm(ROUTE_COORDINATES[index], end),
}));
export const ROUTE_DISTANCE_KM = segments.reduce(
  (total, segment) => total + segment.distanceKm,
  0,
);
export const SIMULATED_SPEED_KPH = 32;

/** Pure deterministic sampler, also useful for replay and tests. */
export function getSimulatedSample(
  elapsedMs: number,
  startedAt: number,
): TelemetrySample {
  const elapsed = Math.max(0, elapsedMs);
  let remainingKm =
    ((elapsed / 3_600_000) * SIMULATED_SPEED_KPH) % ROUTE_DISTANCE_KM;
  let segment = segments[segments.length - 1];
  for (const candidate of segments) {
    if (remainingKm <= candidate.distanceKm) {
      segment = candidate;
      break;
    }
    remainingKm -= candidate.distanceKm;
  }
  const fraction = remainingKm / segment.distanceKm;
  const seconds = elapsed / 1000;
  // A short pulse every 30 seconds; each second pulse is a critical impact.
  const pulseIndex = Math.floor(seconds / 30);
  const pulseAge = seconds % 30;
  const pulse =
    pulseIndex > 0 && pulseAge < 1.2
      ? (pulseIndex % 2 === 0 ? 2.4 : 1.1) *
        Math.sin((pulseAge / 1.2) * Math.PI)
      : 0;
  const latitude =
    segment.start.latitude +
    (segment.end.latitude - segment.start.latitude) * fraction;
  const longitude =
    segment.start.longitude +
    (segment.end.longitude - segment.start.longitude) * fraction;
  const heading =
    ((Math.atan2(
      (segment.end.longitude - segment.start.longitude) *
        Math.cos((latitude * Math.PI) / 180),
      segment.end.latitude - segment.start.latitude,
    ) *
      180) /
      Math.PI +
      360) %
    360;

  return {
    timestamp: startedAt + elapsed,
    position: { latitude, longitude },
    acceleration: {
      x: 0.075 * Math.sin(seconds * 1.3) + pulse,
      y: 0.055 * Math.sin(seconds * 0.9 + 0.8),
      z: 0.045 * Math.cos(seconds * 1.7),
    },
    speedKph: SIMULATED_SPEED_KPH,
    heading,
  };
}

/** Timer ownership stays inside the adapter; unsubscribe always removes its timer. */
export function createSimulatedTelemetrySource(
  intervalMs = 250,
): TelemetrySource {
  return {
    subscribe(onSample) {
      const startedAt = Date.now();
      const emit = () =>
        onSample(getSimulatedSample(Date.now() - startedAt, startedAt));
      emit();
      const timer = setInterval(emit, intervalMs);
      return () => clearInterval(timer);
    },
  };
}

/** Sparse message boundary for the future phone gateway. No transport is connected here. */
export interface EventOnlyTelemetrySource {
  subscribe(onMessage: (message: TelemetryMessage) => void): () => void;
  /** Local preview fixture only: does not establish a physical-device connection. */
  emitTestEvent(event: ThresholdEvent): void;
}

function validateThresholdEvent(event: ThresholdEvent): void {
  if (
    !event ||
    typeof event.id !== "string" ||
    event.id.trim() === "" ||
    !Number.isFinite(event.timestamp) ||
    event.timestamp <= 0 ||
    (event.severity !== "warning" && event.severity !== "critical") ||
    (event.magnitude !== null &&
      (!Number.isFinite(event.magnitude) || event.magnitude < 0)) ||
    (event.position !== null &&
      (!event.position ||
        !Number.isFinite(event.position.latitude) ||
        !Number.isFinite(event.position.longitude) ||
        Math.abs(event.position.latitude) > 90 ||
        Math.abs(event.position.longitude) > 180))
  ) {
    throw new TypeError("Invalid threshold event packet.");
  }
}

/**
 * Local event-only preview: emits explicit test fixtures on demand, never continuous
 * readings, heartbeats, inferred green status, or a fabricated device connection.
 * The firmware-reported severity is retained independently of dashboard thresholds.
 */
export function createEventOnlyTelemetrySource(): EventOnlyTelemetrySource {
  const listeners = new Set<(message: TelemetryMessage) => void>();
  return {
    subscribe(onMessage) {
      const listener = (message: TelemetryMessage) => onMessage(message);
      listeners.add(listener);
      onMessage({ type: "connection", connected: false });
      return () => listeners.delete(listener);
    },
    emitTestEvent(event) {
      validateThresholdEvent(event);
      for (const listener of listeners) {
        listener({
          type: "event",
          source: "test-event",
          event: {
            ...event,
            position: event.position ? { ...event.position } : null,
          },
        });
      }
    },
  };
}
