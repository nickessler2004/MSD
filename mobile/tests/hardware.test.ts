import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
const m = vi.hoisted(() => ({
  state: vi.fn(),
  connect: vi.fn(),
  discover: vi.fn(),
  cancel: vi.fn(),
  destroy: vi.fn(),
  monitor: vi.fn(),
  onDisconnect: vi.fn(),
  removeMonitor: vi.fn(),
  removeDisconnect: vi.fn(),
}));
vi.mock("react-native-ble-plx", () => ({
  State: { PoweredOn: "PoweredOn" },
  BleManager: class {
    state = m.state;
    connectToDevice = m.connect;
    onDeviceDisconnected = m.onDisconnect;
    destroy = m.destroy;
  },
}));
import { HardwareBle } from "../src/ble";
const device = {
  id: "known",
  discoverAllServicesAndCharacteristics: m.discover,
  cancelConnection: m.cancel,
  monitorCharacteristicForService: m.monitor,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  m.state.mockResolvedValue("PoweredOn");
  m.connect.mockResolvedValue(device);
  m.discover.mockResolvedValue(device);
  m.cancel.mockResolvedValue(undefined);
  m.monitor.mockReturnValue({ remove: m.removeMonitor });
  m.onDisconnect.mockReturnValue({ remove: m.removeDisconnect });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("retries powered-off Bluetooth and reconnects with exactly one replacement subscription", async () => {
  m.state.mockResolvedValueOnce("PoweredOff");
  const source = new HardwareBle("known", "service", "events"),
    event = vi.fn(),
    status = vi.fn(),
    error = vi.fn();
  source.start(event, status, error);
  await vi.advanceTimersByTimeAsync(0);
  expect(m.connect).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(m.connect).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith(true);
  const oldNotification = m.monitor.mock.calls[0][2];
  m.onDisconnect.mock.calls[0][1]();
  oldNotification(new Error("late duplicate disconnect"), null);
  await vi.advanceTimersByTimeAsync(1000);
  expect(m.connect).toHaveBeenCalledTimes(2);
  expect(m.monitor).toHaveBeenCalledTimes(2);
  expect(m.removeMonitor).toHaveBeenCalledTimes(1);
  const packet = {
    id: "11111111-1111-4111-8111-111111111111",
    imu_id: 3,
    recorded_at: new Date().toISOString(),
    severity: "critical",
    magnitude: null,
    latitude: null,
    longitude: null,
    t1: 0.8,
    t2: 1.8,
  };
  const value = {
    value: Buffer.from(JSON.stringify(packet) + "\n").toString("base64"),
  };
  oldNotification(null, value);
  expect(event).not.toHaveBeenCalled();
  m.monitor.mock.calls[1][2](null, value);
  expect(event).toHaveBeenCalledWith(packet);
  await source.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(m.connect).toHaveBeenCalledTimes(2);
  expect(m.destroy).toHaveBeenCalledOnce();
});
it("cancels a connection that resolves after stop without installing a subscription", async () => {
  let resolve!: (value: typeof device) => void;
  m.connect.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const source = new HardwareBle("known", "service", "events");
  source.start(vi.fn(), vi.fn(), vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  await source.stop();
  resolve(device);
  await vi.advanceTimersByTimeAsync(0);
  expect(m.cancel).toHaveBeenCalled();
  expect(m.monitor).not.toHaveBeenCalled();
});
