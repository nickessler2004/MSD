import { describe, expect, it } from "vitest";
import {
  filterAnalysisEvents,
  reportedPeak,
  type AnalysisEvent,
} from "./eventAnalysis";
const events: AnalysisEvent[] = [
  {
    id: "a",
    timestamp: 100,
    imuId: 1,
    severity: "warning",
    magnitude: 0.8,
    position: null,
    thresholds: { t1: 0.8, t2: 1.8 },
    source: "Device",
  },
  {
    id: "b",
    timestamp: 200,
    imuId: 2,
    severity: "critical",
    magnitude: 2.1,
    position: null,
    thresholds: { t1: 0.8, t2: 1.8 },
    source: "Device",
  },
  {
    id: "c",
    timestamp: 300,
    imuId: null,
    severity: "warning",
    magnitude: null,
    position: null,
    thresholds: null,
    source: "Test event",
  },
];
describe("event exploration without manufacturing telemetry", () => {
  it("combines sensor, severity, and inclusive time boundaries", () => {
    expect(
      filterAnalysisEvents(events, {
        imu: "2",
        severity: "critical",
        since: 200,
        until: 200,
      }).map((e) => e.id),
    ).toEqual(["b"]);
    expect(
      filterAnalysisEvents(events, {
        imu: "1",
        severity: "critical",
        since: null,
        until: null,
      }),
    ).toEqual([]);
  });
  it("retains unknown sensor/magnitude/thresholds rather than assigning data", () => {
    expect(
      filterAnalysisEvents(events, {
        imu: "unknown",
        severity: "all",
        since: null,
        until: null,
      }),
    ).toEqual([events[2]]);
    expect(reportedPeak([events[2]])).toBeNull();
    expect(reportedPeak([])).toBeNull();
    expect(reportedPeak(events)).toBe(2.1);
  });
  it("orders by source time and does not mutate or reclassify historical reports", () => {
    const reversed = [...events].reverse();
    const result = filterAnalysisEvents(reversed, {
      imu: "all",
      severity: "all",
      since: null,
      until: null,
    });
    expect(result.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(reversed[0].id).toBe("c");
    expect(result[0]).toBe(events[0]);
  });
});
