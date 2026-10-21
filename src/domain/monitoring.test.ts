import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyMagnitude,
  DEFAULT_THRESHOLDS,
  getMagnitude,
  haversineDistanceKm,
  validateThresholds,
} from "./monitoring";
import {
  createSimulatedTelemetrySource,
  getSimulatedSample,
  ROUTE_COORDINATES,
  ROUTE_DISTANCE_KM,
  SIMULATED_SPEED_KPH,
} from "../services/telemetry";

describe("impact classification", () => {
  it("classifies both threshold boundaries into the higher band", () => {
    expect(classifyMagnitude(0.799, DEFAULT_THRESHOLDS)).toBe("normal");
    expect(classifyMagnitude(0.8, DEFAULT_THRESHOLDS)).toBe("warning");
    expect(classifyMagnitude(1.799, DEFAULT_THRESHOLDS)).toBe("warning");
    expect(classifyMagnitude(1.8, DEFAULT_THRESHOLDS)).toBe("critical");
  });

  it("uses adjusted thresholds immediately", () => {
    expect(classifyMagnitude(1.2, { t1: 1.5, t2: 3 })).toBe("normal");
    expect(classifyMagnitude(1.2, { t1: 0.5, t2: 1 })).toBe("critical");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "shows unavailable for missing/invalid magnitude %s",
    (magnitude) => {
      expect(classifyMagnitude(magnitude, DEFAULT_THRESHOLDS)).toBe(
        "unavailable",
      );
    },
  );

  it("rejects invalid threshold configuration", () => {
    expect(validateThresholds({ t1: 0, t2: 1 })).not.toBeNull();
    expect(validateThresholds({ t1: 1, t2: 1 })).not.toBeNull();
    expect(validateThresholds({ t1: 2, t2: 1 })).not.toBeNull();
    expect(validateThresholds({ t1: 0.8, t2: Number.NaN })).not.toBeNull();
    expect(validateThresholds(DEFAULT_THRESHOLDS)).toBeNull();
    expect(classifyMagnitude(0.1, { t1: 2, t2: 1 })).toBe("unavailable");
  });

  it("uses the vector magnitude of all three signed axes", () => {
    expect(getMagnitude({ x: -3, y: 4, z: 12 })).toBe(13);
    expect(getMagnitude({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe("simulated GPS and IMU source", () => {
  const startedAt = 1_700_000_000_000;
  afterEach(() => vi.useRealTimers());

  it("starts at the route origin and moves with monotonic sample timestamps", () => {
    const first = getSimulatedSample(0, startedAt);
    const later = getSimulatedSample(2000, startedAt);
    expect(first.position).toEqual(ROUTE_COORDINATES[0]);
    expect(later.position).not.toEqual(first.position);
    expect(later.timestamp - first.timestamp).toBe(2000);
    expect(haversineDistanceKm(first.position, later.position)).toBeCloseTo(
      SIMULATED_SPEED_KPH / 1800,
      4,
    );
    expect(later.heading).toBeGreaterThanOrEqual(0);
    expect(later.heading).toBeLessThan(360);
  });

  it("loops without leaving the bounded demo route", () => {
    const loopMs = (ROUTE_DISTANCE_KM / SIMULATED_SPEED_KPH) * 3_600_000;
    const looped = getSimulatedSample(loopMs + 2000, startedAt);
    const firstLap = getSimulatedSample(2000, startedAt);
    expect(looped.position.latitude).toBeCloseTo(firstLap.position.latitude, 8);
    expect(looped.position.longitude).toBeCloseTo(
      firstLap.position.longitude,
      8,
    );
  });

  it("emits normal motion and repeatable warning/critical pulses", () => {
    expect(
      classifyMagnitude(
        getMagnitude(getSimulatedSample(5000, startedAt).acceleration),
        DEFAULT_THRESHOLDS,
      ),
    ).toBe("normal");
    expect(
      classifyMagnitude(
        getMagnitude(getSimulatedSample(30_600, startedAt).acceleration),
        DEFAULT_THRESHOLDS,
      ),
    ).toBe("warning");
    expect(
      classifyMagnitude(
        getMagnitude(getSimulatedSample(60_600, startedAt).acceleration),
        DEFAULT_THRESHOLDS,
      ),
    ).toBe("critical");
    expect(getSimulatedSample(30_600, startedAt)).toEqual(
      getSimulatedSample(30_600, startedAt),
    );
  });

  it("emits immediately, streams updates, and stops completely on unsubscribe", () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const listener = vi.fn();
    const unsubscribe = createSimulatedTelemetrySource(250).subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(5);
    expect(listener.mock.lastCall?.[0].timestamp).toBe(startedAt + 1000);
    unsubscribe();
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
