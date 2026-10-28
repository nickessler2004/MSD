# Stage 2 telemetry and storage protocol

This contract prepares the observer dashboard for a later phone gateway. It does not implement the driver phone application or ESP32-S3 firmware. Complete raw IMU data remains on the ESP32-S3. Cloud storage contains continuous GPS, sparse threshold events, explicit connection/heartbeat packets, session metadata, and per-IMU threshold configuration.

## Trust and ownership

Every cloud request uses the signed-in user's Supabase session with the public publishable/anon project key. The database assigns session ownership from `auth.uid()`; clients cannot supply or change the owner. Only an owner can upload to, finish, configure, or share a session. Shared observers have read-only access enforced by RLS. Anonymous clients and unrelated authenticated users cannot read its records.

The frontend must never receive a service-role/secret key. A future phone uploader must authenticate as the session owner, or use a separately designed narrowly scoped ingestion service. No such privileged ingestion service is included in Stage 2.

`data_source` is `simulated` or `device` and is fixed when the session is created. A cloud test drive can publish only into an active `simulated` session. It cannot label generated telemetry as a real-device session. Local simulation, local test events, and cloud session records are never an implicit fallback for one another.

## Shared identity, time, and retry rules

- Generate a stable UUID for each GPS point and each threshold event before enqueueing it.
- Allocate an increasing, JavaScript-safe nonnegative integer `sequence` for each stream within the session. GPS, threshold-event, and connection streams have separate sequence spaces. Threshold-event sequence is shared across **all three IMUs**, not restarted for each IMU.
- Preserve the UUID, sequence, source timestamp, and payload when retrying. A future phone's durable outbox must preserve sequence allocation across restarts; the browser test uploader is an in-memory development tool only.
- Use ISO 8601 UTC timestamps. `recorded_at` is when the source recorded the GPS/event/status. `received_at` is assigned by PostgreSQL and cannot be supplied by an uploader.
- A packet must be recorded on/after session start and, for a finished session, on/before its end. Delayed uploads of packets within that window are accepted even after the session has finished. Source time may be at most 60 seconds ahead of database time; larger clock errors are rejected.
- GPS and event UUIDs are primary keys and `(session_id, sequence)` is unique. Connection identity is `(session_id, sequence)`. Duplicate/conflicting keys are **first-write wins**: accepted history is not overwritten by a retry or a conflicting replay.
- A GPS/event batch contains 1–100 records and is atomic. Invalid fields or timestamps reject the call; split larger backlogs into batches and handle errors explicitly. Constraints still apply to retry payloads: retry the original valid payload rather than using a duplicate key to submit invalid values.
- Finishing a session is serialized with ingestion. Its end time includes any already accepted source timestamps within the allowed clock tolerance, so accepted history remains inside the closed session window. New telemetry after that end is rejected.
- Upload/arrival order is not display order. GPS and events are deduplicated and ordered by `recorded_at`, with sequence as a stable tie-breaker. The live marker uses the newest source point; a delayed older point extends the historical route without moving the live vehicle backward. Latest connection status is chosen by highest sequence.
- Current freshness uses source time, never `received_at`. Future-dated or stale source data must not claim fresh current readings. Realtime notifications from the five published session/telemetry tables trigger database refreshes; reconnect refresh and ten-second reconciliation recover missed changes. Observer membership is not published, so authorized reconciliation also discovers sharing and revocation without exposing membership DELETE notifications.

These rules assume one coordinated uploader for each session. Multiple independent publishers must not allocate the same session/stream sequence space.

## RPCs

The following are authenticated Supabase RPCs in `public`:

| RPC                       | Parameters                                | Result/purpose                                                            |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `create_driving_session`  | `p_label`, `p_data_source`                | Returns the new UUID and atomically creates default settings for IMUs 1–3 |
| `finish_driving_session`  | `p_session_id`                            | Sets end time once; does not erase history                                |
| `ingest_gps`              | `p_session_id`, `p_points` JSON array     | Append GPS points; duplicates do not overwrite                            |
| `ingest_threshold_events` | `p_session_id`, `p_events` JSON array     | Append sparse IMU events with threshold snapshots                         |
| `ingest_connection`       | `p_session_id`, `p_status` JSON object    | Append a connection/heartbeat packet                                      |
| `set_imu_thresholds`      | `p_session_id`, `p_thresholds` JSON array | Atomically set all three IMUs' T1/T2 configuration for an active session  |
| `share_session`           | `p_session_id`, `p_email`                 | Grant read access to an already registered, email-confirmed account       |
| `revoke_session_observer` | `p_session_id`, `p_user_id`               | Revoke that observer's future reads                                       |

Use the repository methods in `src/services/cloudRepository.ts` from the frontend. The examples below show the underlying wire contract for the future uploader. They require an authenticated owner and an active session; the public key alone cannot upload.

## GPS, approximately 1 Hz

```ts
const point = {
  id: crypto.randomUUID(),
  sequence: 1, // Allocate once and retain through retry.
  recorded_at: new Date().toISOString(),
  latitude: 37.7793,
  longitude: -122.4193,
  speed_kph: 32, // null when unavailable
  heading: 140, // degrees clockwise from north; null when unavailable
};

const { error } = await supabase.rpc("ingest_gps", {
  p_session_id: sessionId,
  p_points: [point],
});
if (error) throw error;
```

Latitude must be within −90…90 and longitude within −180…180. Optional speed is finite and nonnegative; optional heading is at least 0 and less than 360. GPS source samples should target roughly one per second. Cellular delivery can be delayed or batched; that does not change the original timestamps or packet identities.

The dashboard fetches paginated history rather than relying on Supabase's default 1,000-row response limit. It shows the observed route and event markers. An illustrated offline basemap remains available when public map tiles cannot load; the underlying GPS coordinates remain geographic data.

## Threshold events for three IMUs

```ts
const event = {
  id: crypto.randomUUID(),
  sequence: 1, // One event sequence space across IMUs 1, 2, and 3.
  imu_id: 2,
  recorded_at: new Date().toISOString(),
  severity: "warning",
  magnitude: 1.8, // optional peak resultant acceleration in g; null if omitted
  latitude: null,
  longitude: null, // both coordinates supplied together or both null
  t1: 0.8,
  t2: 1.8,
};

const { error } = await supabase.rpc("ingest_threshold_events", {
  p_session_id: sessionId,
  p_events: [event],
});
if (error) throw error;
```

`imu_id` is exactly 1, 2, or 3. An event snapshots the T1/T2 values that applied when it occurred. They must satisfy `0 < T1 < T2 ≤ 10 g`. The rule is:

| Known acceleration A | Classification |
| -------------------- | -------------- |
| A < T1               | Green/normal   |
| T1 ≤ A ≤ T2          | Yellow/warning |
| A > T2               | Red/critical   |

Threshold events contain warning or critical reports; absence of an event is not a normal/green report. If a peak magnitude is supplied, it must agree with the event's snapshot classification. Both exact boundaries are warning. When the magnitude is absent, the reported severity is retained without inventing a peak. Optional event GPS is `null` when no event location was supplied; the dashboard does not silently substitute a current or simulated location.

No continuous X/Y/Z acceleration samples are stored or synthesized for cloud mode. A latest-event badge is a historical observation, not the IMU's current state. All three cloud IMU current-state indicators remain unknown/gray when only threshold events are available, regardless of GPS freshness or time since the last event.

## Connection status and heartbeat

```ts
const { error } = await supabase.rpc("ingest_connection", {
  p_session_id: sessionId,
  p_status: {
    sequence: 1,
    recorded_at: new Date().toISOString(),
    connected: true,
  },
});
if (error) throw error;
```

Connection packets are append-only. The newest sequence determines the most recent known gateway status; late delivery of an older sequence cannot replace it. For the cloud simulator, a connected heartbeat is sent about every five seconds. A latest status older than fifteen seconds is stale. A fresh observer-to-Supabase WebSocket does not prove a fresh phone-to-vehicle connection.

The simulator's stop control stops its timer and drops unsent queued packets; an in-flight RPC can still finish. It does not create a fake disconnected packet on behalf of a device. Its last heartbeat naturally ages out. A future phone gateway may upload an explicit `connected: false` observation when it actually detects a disconnection.

## Per-IMU threshold configuration

```ts
const { error } = await supabase.rpc("set_imu_thresholds", {
  p_session_id: sessionId,
  p_thresholds: [
    { imu_id: 1, t1: 0.8, t2: 1.8 },
    { imu_id: 2, t1: 0.8, t2: 1.8 },
    { imu_id: 3, t1: 0.8, t2: 1.8 },
  ],
});
if (error) throw error;
```

Supply exactly the three unique IMU IDs in one call. Configuration is persisted and available to all authorized observers. Historical event snapshots are unchanged. Stage 2 does not send configuration to ESP32-S3 firmware or acknowledge its application; that phone/firmware synchronization is future work. Saving cloud thresholds stops the browser test drive; start it again to use the updated snapshot.

## Simulated cloud publishing

The development publisher uses the same authenticated repository/RPC path as later uploads, but only into a session whose immutable `data_source` is `simulated`. It enqueues GPS immediately and about every second, a heartbeat every five ticks, and one sparse threshold event every ten ticks, cycling IMUs so all three are exercised over about thirty seconds.

Requests are serialized and transient failures retain packet identity for retry. The queue is bounded at 60 pending packets; overflow skips new GPS rather than growing without limit and surfaces an error. Stop/reload is not durable recovery: the queue is in memory and unsent items are discarded. A real phone will need a durable outbox, coordinated sequence allocation, clock handling, and explicit synchronization, none of which is implemented here.

## Stage 3 phone gateway extension

The React Native gateway lives in `mobile/`; see its README for the provisional BLE framing contract, durable retry implementation and native-phone acceptance matrix. GPS ingestion additionally accepts nullable `accuracy_m` (horizontal OS accuracy in metres), persisted by migration `20261028000100_gps_accuracy.sql`. Existing GPS payloads may omit it. This is the only Stage 3 schema extension; RPC names, RLS, identities, source timestamps and first-write-wins semantics remain unchanged. Stage 3 does not implement ESP32 firmware, firmware threshold synchronization or reliable device-side replay. Background operation has not been validated on actual phones.
