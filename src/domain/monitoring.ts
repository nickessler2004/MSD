import type { Acceleration, Coordinates, Severity, Thresholds } from "./types";

export const DEFAULT_THRESHOLDS: Thresholds = { t1: 0.8, t2: 1.8 };

export function getMagnitude(acceleration: Acceleration): number {
  return Math.hypot(acceleration.x, acceleration.y, acceleration.z);
}

/** Null means the input is valid; messages can be displayed beside the controls. */
export function validateThresholds({ t1, t2 }: Thresholds): string | null {
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
    return "Enter a number for both thresholds.";
  }
  if (t1 <= 0) return "T1 must be greater than 0 g.";
  if (t2 <= t1) return "T2 must be greater than T1.";
  return null;
}

/** Green: A < T1; yellow: T1 <= A <= T2; red: A > T2. Missing/invalid data is gray. */
export function classifyMagnitude(
  magnitude: number | null,
  thresholds: Thresholds,
): Severity {
  if (
    magnitude === null ||
    !Number.isFinite(magnitude) ||
    magnitude < 0 ||
    validateThresholds(thresholds) !== null
  )
    return "unavailable";

  if (magnitude > thresholds.t2) return "critical";
  if (magnitude >= thresholds.t1) return "warning";
  return "normal";
}

/** Great-circle distance; used for session mileage and constant-speed route playback. */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}
