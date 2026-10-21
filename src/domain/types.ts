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

/** UI mode is explicit: live continuous values are demonstration data only. */
export type TelemetryMode = "simulation" | "event-only";
export type DataSource = "simulation" | "test-event" | "device";
export type TelemetryFreshness = "waiting" | "fresh" | "stale" | "disconnected";

/** A threshold packet need not contain continuous axes, GPS, or a peak magnitude. */
export interface ThresholdEvent {
  id: string;
  timestamp: number;
  severity: "warning" | "critical";
  magnitude: number | null;
  position: Coordinates | null;
}

/** Continuous samples cannot be attributed to a physical event-only device. */
export type TelemetryMessage =
  | { type: "sample"; source: "simulation"; sample: TelemetrySample }
  | { type: "event"; source: "test-event" | "device"; event: ThresholdEvent }
  | { type: "connection"; connected: boolean };

export interface ImpactEvent {
  id: string;
  timestamp: number;
  position: Coordinates | null;
  magnitude: number | null;
  severity: "warning" | "critical";
  sessionId: string;
  source: DataSource;
}

export interface DrivingSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  distanceKm: number | null;
  impactCount: number;
  maxMagnitude: number | null;
  source: TelemetryMode;
}
