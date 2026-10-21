import type { DrivingSession, ImpactEvent } from "../domain/types";

/** Seeded demonstration history only. All dates are relative to this page load. */
const now = Date.now();
const hour = 3_600_000;

export const DEMO_SESSIONS: DrivingSession[] = [
  {
    id: "demo-session-1",
    startedAt: now - 2 * hour,
    endedAt: now - 1.5 * hour,
    distanceKm: 14.2,
    impactCount: 2,
    maxMagnitude: 2.14,
  },
  {
    id: "demo-session-2",
    startedAt: now - 23 * hour,
    endedAt: now - 22.3 * hour,
    distanceKm: 21.8,
    impactCount: 1,
    maxMagnitude: 1.12,
  },
  {
    id: "demo-session-3",
    startedAt: now - 26 * hour,
    endedAt: now - 25.6 * hour,
    distanceKm: 9.6,
    impactCount: 0,
    maxMagnitude: 0.24,
  },
];

export const DEMO_EVENTS: ImpactEvent[] = [
  {
    id: "demo-impact-1",
    timestamp: now - 1.6 * hour,
    position: { latitude: 37.7767, longitude: -122.4092 },
    magnitude: 2.14,
    severity: "critical",
    sessionId: "demo-session-1",
  },
  {
    id: "demo-impact-2",
    timestamp: now - 1.8 * hour,
    position: { latitude: 37.7743, longitude: -122.4122 },
    magnitude: 1.26,
    severity: "warning",
    sessionId: "demo-session-1",
  },
  {
    id: "demo-impact-3",
    timestamp: now - 22.5 * hour,
    position: { latitude: 37.7753, longitude: -122.4198 },
    magnitude: 1.12,
    severity: "warning",
    sessionId: "demo-session-2",
  },
];
