import {
  BleManager,
  State,
  type Device,
  type Subscription,
} from "react-native-ble-plx";
import { Buffer } from "buffer";
import { parseEvent, type EventPacket } from "./protocol";
export interface Source {
  start(
    event: (e: EventPacket) => void,
    status: (connected: boolean) => void,
    error: (e: unknown) => void,
  ): void;
  stop(): Promise<void>;
}
/** Explicit test source. Never selected as a hardware fallback. */
export class SimulatedBle implements Source {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private uuid: () => string) {}
  start(event: (e: EventPacket) => void, status: (v: boolean) => void) {
    let n = 0;
    status(true);
    this.timer = setInterval(() => {
      event({
        id: this.uuid(),
        imu_id: ((n++ % 3) + 1) as 1 | 2 | 3,
        recorded_at: new Date().toISOString(),
        severity: n % 2 ? "warning" : "critical",
        magnitude: null,
        latitude: null,
        longitude: null,
        t1: 0.8,
        t2: 1.8,
      });
    }, 3000);
  }
  async stop() {
    clearInterval(this.timer);
  }
}
/** Provisional GATT: UTF-8 newline-delimited JSON, notifications may split frames. */
export class FrameDecoder {
  private bytes = Buffer.alloc(0);
  push(
    base64: string,
    onError: (e: unknown) => void = (e) => {
      throw e;
    },
  ): EventPacket[] {
    this.bytes = Buffer.concat([this.bytes, Buffer.from(base64, "base64")]);
    if (this.bytes.length > 8192) {
      this.bytes = Buffer.alloc(0);
      throw new Error("BLE frame exceeds 8 KiB");
    }
    const result: EventPacket[] = [];
    let end: number;
    while ((end = this.bytes.indexOf(10)) >= 0) {
      const line = this.bytes.subarray(0, end).toString("utf8");
      this.bytes = this.bytes.subarray(end + 1);
      if (line.trim()) {
        try {
          result.push(parseEvent(JSON.parse(line)));
        } catch (e) {
          onError(e);
        }
      }
    }
    return result;
  }
}
export class HardwareBle implements Source {
  private manager = new BleManager({
    restoreStateIdentifier: "msd-gateway",
    restoreStateFunction: () => {
      // Restoration is a reconnect hint; persisted session remains authoritative.
    },
  });
  private running = false;
  private device: Device | null = null;
  private monitor: Subscription | undefined;
  private disconnect: Subscription | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  constructor(
    private id: string,
    private service: string,
    private characteristic: string,
  ) {}
  start(
    event: (e: EventPacket) => void,
    status: (v: boolean) => void,
    error: (e: unknown) => void,
  ) {
    this.running = true;
    const generation = ++this.generation;
    let attempt = 0,
      connectionEpoch = 0;
    const connect = async () => {
      if (!this.running || generation !== this.generation) return;
      const epoch = ++connectionEpoch;
      const current = () =>
        this.running &&
        generation === this.generation &&
        epoch === connectionEpoch;
      const lost = () => {
        if (!current()) return;
        connectionEpoch++;
        status(false);
        this.monitor?.remove();
        this.disconnect?.remove();
        const old = this.device;
        this.device = null;
        if (old) void old.cancelConnection().catch(() => {});
        clearTimeout(this.retry);
        this.retry = setTimeout(
          () => void connect(),
          Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)),
        );
      };
      try {
        if ((await this.manager.state()) !== State.PoweredOn)
          throw new Error("Bluetooth is not powered on");
        const device = await this.manager.connectToDevice(this.id, {
          timeout: 10000,
        });
        if (!current()) {
          await device.cancelConnection().catch(() => {});
          return;
        }
        this.device = await device.discoverAllServicesAndCharacteristics();
        if (!current()) {
          await device.cancelConnection().catch(() => {});
          return;
        }
        const decoder = new FrameDecoder();
        this.disconnect = this.manager.onDeviceDisconnected(device.id, lost);
        this.monitor = this.device.monitorCharacteristicForService(
          this.service,
          this.characteristic,
          (err, value) => {
            if (!current()) return;
            if (err) {
              error(err);
              lost();
              return;
            }
            try {
              if (value?.value)
                for (const packet of decoder.push(value.value, error))
                  event(packet);
            } catch (e) {
              error(e);
            }
          },
        );
        if (current()) {
          attempt = 0;
          status(true);
        }
      } catch (e) {
        if (current()) {
          error(e);
          lost();
        }
      }
    };
    status(false);
    void connect();
  }
  async stop() {
    this.running = false;
    this.generation++;
    clearTimeout(this.retry);
    this.monitor?.remove();
    this.disconnect?.remove();
    if (this.device) await this.device.cancelConnection().catch(() => {});
    this.device = null;
    this.manager.destroy();
  }
}
