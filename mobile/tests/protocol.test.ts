import { expect, it, vi } from "vitest";
import { Buffer } from "buffer";
vi.mock("react-native-ble-plx", () => ({
  BleManager: vi.fn(),
  State: { PoweredOn: "PoweredOn" },
}));
import { FrameDecoder, SimulatedBle } from "../src/ble";
import { gpsPayload, parseEvent } from "../src/protocol";
const packet = {
  id: "11111111-1111-4111-8111-111111111111",
  imu_id: 2,
  recorded_at: "2026-10-28T12:00:00.000Z",
  severity: "warning",
  magnitude: 1.8,
  latitude: null,
  longitude: null,
  t1: 0.8,
  t2: 1.8,
};
it.each([0.8, 1.8])(
  "preserves exact yellow boundary %s without reclassifying",
  (magnitude) => {
    expect(parseEvent({ ...packet, magnitude }).magnitude).toBe(magnitude);
  },
);
it("preserves missing peak/location and rejects forged severity or invalid IDs", () => {
  expect(parseEvent({ ...packet, magnitude: null })).toMatchObject({
    magnitude: null,
    latitude: null,
  });
  for (const patch of [
    { imu_id: 4 },
    { magnitude: 1.81 },
    { id: "bad" },
    { t2: 0.1 },
    { recorded_at: "yesterday" },
    { latitude: 1 },
  ])
    expect(() => parseEvent({ ...packet, ...patch })).toThrow();
  expect(
    parseEvent({ ...packet, magnitude: 1.81, severity: "critical" }).severity,
  ).toBe("critical");
});
it("reassembles split notifications and accepts multiple frames", () => {
  const decoder = new FrameDecoder();
  const bytes = Buffer.from(
    JSON.stringify(packet) + "\n" + JSON.stringify(packet) + "\n",
  );
  expect(decoder.push(bytes.subarray(0, 14).toString("base64"))).toEqual([]);
  expect(decoder.push(bytes.subarray(14).toString("base64"))).toEqual([
    packet,
    packet,
  ]);
  expect(() => decoder.push(Buffer.alloc(8193).toString("base64"))).toThrow();
  expect(
    decoder.push(Buffer.from(JSON.stringify(packet) + "\n").toString("base64")),
  ).toEqual([packet]);
});
it("uses OS source time, preserves accuracy, converts m/s, and nulls unavailable heading/speed", () => {
  const fix = {
    timestamp: 1000,
    coords: {
      latitude: 1,
      longitude: 2,
      accuracy: 3.4,
      speed: 10,
      heading: 90,
    },
  };
  expect(gpsPayload(fix, "id")).toMatchObject({
    recorded_at: "1970-01-01T00:00:01.000Z",
    accuracy_m: 3.4,
    speed_kph: 36,
    heading: 90,
  });
  expect(
    gpsPayload(
      { ...fix, coords: { ...fix.coords, speed: -1, heading: -1 } },
      "id",
    ),
  ).toMatchObject({ speed_kph: null, heading: null });
  expect(() =>
    gpsPayload({ ...fix, coords: { ...fix.coords, accuracy: null } }, "id"),
  ).toThrow();
});
it("simulates all three IMUs only after explicit selection and stops cleanly", async () => {
  vi.useFakeTimers();
  let n = 0;
  const source = new SimulatedBle(() => String(++n));
  const event = vi.fn(),
    status = vi.fn();
  source.start(event, status);
  vi.advanceTimersByTime(9000);
  expect(event.mock.calls.map(([e]) => e.imu_id)).toEqual([1, 2, 3]);
  expect(event.mock.calls.every(([e]) => e.magnitude === null)).toBe(true);
  await source.stop();
  vi.advanceTimersByTime(9000);
  expect(event).toHaveBeenCalledTimes(3);
  vi.useRealTimers();
});

it("isolates malformed frames so valid packets in the same notification are retained", () => {
  const decoder = new FrameDecoder(),
    error = vi.fn();
  const bytes = Buffer.from(
    JSON.stringify(packet) + "\ninvalid\n" + JSON.stringify(packet) + "\n",
  );
  expect(decoder.push(bytes.toString("base64"), error)).toEqual([
    packet,
    packet,
  ]);
  expect(error).toHaveBeenCalledTimes(1);
});
