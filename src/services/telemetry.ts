import { haversineDistanceKm } from "../domain/monitoring";
import type { Coordinates, TelemetrySample } from "../domain/types";

/**
 * Boundary for future ESP32-S3 → phone gateway adapters.
 * An adapter emits normalized, gravity-compensated g values and null on signal loss.
 * Consumers never need to know which transport supplies the samples.
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
