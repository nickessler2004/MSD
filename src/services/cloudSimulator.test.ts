import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudSession, ImuThreshold } from "../domain/cloud";
import { startCloudSimulation } from "./cloudSimulator";
const base = 1_700_000_000_000;
const session: CloudSession = {
  id: "a",
  owner_id: "owner",
  label: "Test",
  started_at: new Date(base).toISOString(),
  ended_at: null,
  data_source: "simulated",
  created_at: new Date(base).toISOString(),
};
const thresholds: ImuThreshold[] = ([1, 2, 3] as const).map((imu_id) => ({
  session_id: "a",
  imu_id,
  t1: 0.8,
  t2: 1.8,
  updated_at: session.started_at,
}));
const repository = () => ({
  ingestGps: vi.fn(async () => {}),
  ingestEvents: vi.fn(async () => {}),
  ingestConnection: vi.fn(async () => {}),
});

describe("cloud simulated test-drive uploader", () => {
  afterEach(() => vi.useRealTimers());
  it("stores GPS at approximately one-second cadence and only sparse threshold events for all three IMUs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(base);
    const repo = repository();
    const failed = vi.fn();
    const stop = startCloudSimulation(repo, session, thresholds, failed);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(repo.ingestGps).toHaveBeenCalledTimes(31);
    expect(repo.ingestEvents).toHaveBeenCalledTimes(3);
    expect(repo.ingestConnection).toHaveBeenCalledTimes(7);
    const events = repo.ingestEvents.mock.calls.map(
      (call) => (call as unknown as [string, Array<{ imu_id: number }>])[1][0],
    );
    expect(new Set(events.map((event) => event.imu_id))).toEqual(
      new Set([1, 2, 3]),
    );
    const points = repo.ingestGps.mock.calls.map(
      (call) =>
        (
          call as unknown as [
            string,
            Array<{ sequence: number; recorded_at: string }>,
          ]
        )[1][0],
    );
    expect(
      Date.parse(points[1].recorded_at) - Date.parse(points[0].recorded_at),
    ).toBe(1000);
    expect(points[1].sequence).toBeGreaterThan(points[0].sequence);
    expect(points.every((point) => !("acceleration" in point))).toBe(true);
    expect(failed).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(repo.ingestGps).toHaveBeenCalledTimes(31);
  });
  it("refuses to turn an actual device session into simulated hardware data", () => {
    expect(() =>
      startCloudSimulation(
        repository(),
        { ...session, data_source: "device" },
        thresholds,
        vi.fn(),
      ),
    ).toThrow("simulated");
    expect(() =>
      startCloudSimulation(
        repository(),
        { ...session, ended_at: session.started_at },
        thresholds,
        vi.fn(),
      ),
    ).toThrow("active");
    expect(() =>
      startCloudSimulation(
        repository(),
        session,
        thresholds.slice(0, 2),
        vi.fn(),
      ),
    ).toThrow("three IMUs");
  });
  it("retries the exact same immutable GPS packet after a transient upload error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(base);
    const repo = repository();
    const failed = vi.fn();
    repo.ingestGps.mockRejectedValueOnce(new Error("offline"));
    const stop = startCloudSimulation(repo, session, thresholds, failed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(repo.ingestGps).toHaveBeenCalledTimes(3);
    expect(repo.ingestGps.mock.calls[0]).toEqual(repo.ingestGps.mock.calls[1]);
    expect(repo.ingestConnection).toHaveBeenCalledTimes(1);
    stop();
  });
  it("bounds the retry queue and reports skipped new samples during a prolonged outage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(base);
    let online = false;
    const uploaded: unknown[] = [];
    const repo = repository();
    repo.ingestGps.mockImplementation(async (...args: unknown[]) => {
      if (!online) throw new Error("offline");
      uploaded.push((args[1] as unknown[])[0]);
    });
    const failed = vi.fn();
    const stop = startCloudSimulation(repo, session, thresholds, failed);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(
      failed.mock.calls.some(([message]) =>
        String(message).includes("queue is full"),
      ),
    ).toBe(true);
    online = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(uploaded).toHaveLength(60);
    expect(
      new Set(uploaded.map((point) => (point as { id: string }).id)).size,
    ).toBe(60);
    stop();
  });
  it("does not overlap uploads or start remaining writes after stopping an in-flight request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(base);
    let resolve: () => void = () => {};
    const repo = repository();
    repo.ingestGps.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const stop = startCloudSimulation(repo, session, thresholds, vi.fn());
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.ingestGps).toHaveBeenCalledTimes(1);
    stop();
    resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.ingestGps).toHaveBeenCalledTimes(1);
    expect(repo.ingestConnection).not.toHaveBeenCalled();
  });
});
