import { describe, expect, it } from "vitest";
import type { CloudConnection, CloudThresholdEvent, GpsPoint } from "./cloud";
import {
  connectionFreshness,
  gpsFreshness,
  latestGps,
  normalizeEvents,
  normalizeGps,
  routeDistanceKm,
} from "./cloudRecords";
const base = 1_700_000_000_000;
const point = (sequence: number, age = sequence * 1000): GpsPoint => ({
  id: `gps-${sequence}`,
  session_id: "session-a",
  sequence,
  recorded_at: new Date(base + age).toISOString(),
  received_at: new Date(base + age + 100).toISOString(),
  latitude: 37.77 + sequence * 0.001,
  longitude: -122.42,
  speed_kph: 30,
  heading: 0,
});

describe("cloud source-time records", () => {
  it("deduplicates repeated deliveries and sorts delayed positions by source time without mutating inputs", () => {
    const rows = [point(3), point(1), point(2), point(1)];
    expect(normalizeGps(rows).map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(rows.map((p) => p.sequence)).toEqual([3, 1, 2, 1]);
    expect(latestGps(rows)?.sequence).toBe(3);
    expect(routeDistanceKm(rows)).toBeCloseTo(
      routeDistanceKm([point(1), point(2), point(3)]),
      8,
    );
  });
  it("retains first received payload on conflicting duplicate IDs or session sequence numbers", () => {
    const original = point(1);
    const conflicting = {
      ...original,
      latitude: 0,
      received_at: new Date(base + 9000).toISOString(),
    };
    const conflictingSequence = { ...conflicting, id: "another-id" };
    expect(normalizeGps([conflictingSequence, conflicting, original])).toEqual([
      original,
    ]);
  });
  it("keeps distinct sessions sequences separate and resolves equal source times by sequence", () => {
    const rows = [
      point(2, 1000),
      point(1, 1000),
      { ...point(1), id: "session-b-gps", session_id: "session-b" },
    ];
    expect(normalizeGps(rows)).toHaveLength(3);
    expect(
      normalizeGps([point(2, 1000), point(1, 1000)]).map((p) => p.sequence),
    ).toEqual([1, 2]);
  });
  it("never treats freshly received delayed GPS as a live position", () => {
    const delayed = {
      ...point(1),
      received_at: new Date(base + 60_000).toISOString(),
    };
    expect(gpsFreshness(delayed, base + 60_000)).toBe("stale");
    expect(gpsFreshness(point(1), base + 6000)).toBe("fresh");
    expect(gpsFreshness(point(1), base + 6001)).toBe("stale");
    expect(gpsFreshness(point(1), base)).toBe("waiting");
    expect(gpsFreshness(null, base)).toBe("waiting");
  });
  it("retains event reported severity and nullable GPS/magnitude under replay", () => {
    const event: CloudThresholdEvent = {
      ...point(1),
      imu_id: 3,
      severity: "critical",
      magnitude: null,
      latitude: null,
      longitude: null,
      t1: 0.8,
      t2: 1.8,
    };
    expect(normalizeEvents([event, event])).toEqual([event]);
  });
  it("connection freshness uses source heartbeat time and never implies normal acceleration", () => {
    const heartbeat: CloudConnection = {
      session_id: "a",
      sequence: 2,
      recorded_at: new Date(base).toISOString(),
      received_at: new Date(base + 60_000).toISOString(),
      connected: true,
    };
    expect(connectionFreshness(heartbeat, base + 15_000)).toBe("fresh");
    expect(connectionFreshness(heartbeat, base + 15_001)).toBe("stale");
    expect(connectionFreshness({ ...heartbeat, connected: false }, base)).toBe(
      "disconnected",
    );
    expect(connectionFreshness(null, base)).toBe("waiting");
  });
});
