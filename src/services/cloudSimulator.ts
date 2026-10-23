import type {
  CloudSession,
  ImuThreshold,
  GpsUpload,
  EventUpload,
  ConnectionUpload,
  ImuId,
} from "../domain/cloud";
import type { CloudRepository } from "./cloudRepository";
import { getSimulatedSample } from "./telemetry";

type UploadRepository = Pick<
  CloudRepository,
  "ingestGps" | "ingestEvents" | "ingestConnection"
>;
type Pending = {
  gps: GpsUpload;
  event: EventUpload | null;
  connection: ConnectionUpload | null;
};

/**
 * A labeled cloud test-drive uploader, not the driver phone application.
 * Immutable packet IDs/sequences survive retries; writes are serialized and bounded.
 */
export function startCloudSimulation(
  repository: UploadRepository,
  session: CloudSession,
  thresholds: ImuThreshold[],
  onError: (message: string) => void,
): () => void {
  if (session.data_source !== "simulated" || session.ended_at !== null)
    throw new Error(
      "Cloud test drives require an active session labeled simulated.",
    );
  if (
    thresholds.length !== 3 ||
    new Set(thresholds.map((t) => t.imu_id)).size !== 3 ||
    thresholds.some(
      (t) =>
        t.session_id !== session.id ||
        ![1, 2, 3].includes(t.imu_id) ||
        !Number.isFinite(t.t1) ||
        !Number.isFinite(t.t2) ||
        t.t1 <= 0 ||
        t.t2 <= t.t1 ||
        t.t2 > 10,
    )
  )
    throw new Error(
      "Configure valid thresholds for all three IMUs before starting the cloud test drive.",
    );
  const startedAt = Date.now();
  const baseSequence = startedAt;
  const queue: Pending[] = [];
  let tick = 0;
  let stopped = false;
  let writing = false;
  let overflowReported = false;
  async function flush() {
    if (writing || stopped) return;
    writing = true;
    try {
      while (!stopped && queue.length) {
        const packet = queue[0];
        await repository.ingestGps(session.id, [packet.gps]);
        if (stopped) break;
        if (packet.event)
          await repository.ingestEvents(session.id, [packet.event]);
        if (stopped) break;
        if (packet.connection)
          await repository.ingestConnection(session.id, packet.connection);
        if (stopped) break;
        queue.shift();
      }
    } catch {
      // Never print request details or configuration. Keep the head packet for an idempotent retry.
      if (!stopped)
        onError(
          "Cloud test-drive upload failed. Pending packets will retry while the test drive is running.",
        );
    } finally {
      writing = false;
    }
  }
  function enqueue() {
    if (stopped) return;
    if (queue.length >= 60) {
      if (!overflowReported)
        onError(
          "The cloud test-drive queue is full. New GPS samples are being skipped until uploads recover; no continuous IMU data is buffered.",
        );
      overflowReported = true;
      void flush();
      return;
    }
    overflowReported = false;
    const now = Date.now();
    const sample = getSimulatedSample(now - startedAt, startedAt);
    const sequence = baseSequence + tick;
    const recorded_at = new Date(now).toISOString();
    const imu = ((Math.floor(tick / 10) % 3) + 1) as ImuId;
    const threshold = thresholds.find((t) => t.imu_id === imu)!;
    const severity = Math.floor(tick / 10) % 2 === 0 ? "warning" : "critical";
    queue.push({
      gps: {
        id: crypto.randomUUID(),
        sequence,
        recorded_at,
        ...sample.position,
        speed_kph: sample.speedKph,
        heading: sample.heading,
      },
      event:
        tick > 0 && tick % 10 === 0
          ? {
              id: crypto.randomUUID(),
              sequence,
              recorded_at,
              imu_id: imu,
              severity,
              magnitude:
                severity === "warning"
                  ? (threshold.t1 + threshold.t2) / 2
                  : threshold.t2 + 0.25,
              latitude: sample.position.latitude,
              longitude: sample.position.longitude,
              t1: threshold.t1,
              t2: threshold.t2,
            }
          : null,
      connection:
        tick % 5 === 0 ? { sequence, recorded_at, connected: true } : null,
    });
    tick += 1;
    void flush();
  }
  enqueue();
  const timer = setInterval(enqueue, 1000);
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    queue.length = 0;
    // Do not fabricate a gateway disconnection on stop: an already-started request
    // may finish, but no further writes are initiated. Its heartbeat ages to stale.
  };
}
