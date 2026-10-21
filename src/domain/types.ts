/** Shared domain models. Acceleration is linear acceleration in g, with gravity removed. */
export interface Acceleration {
  x: number;
  y: number;
  z: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface TelemetrySample {
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  position: Coordinates;
  acceleration: Acceleration;
  speedKph: number;
  /** Degrees clockwise from north. */
  heading: number;
}

export type Severity = "normal" | "warning" | "critical" | "unavailable";

export interface Thresholds {
  t1: number;
  t2: number;
}

export interface ImpactEvent {
  id: string;
  timestamp: number;
  position: Coordinates;
  magnitude: number;
  severity: "warning" | "critical";
  sessionId: string;
}

export interface DrivingSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  distanceKm: number;
  impactCount: number;
  maxMagnitude: number;
}
