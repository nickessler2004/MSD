# Stage 3 — driver's phone gateway

React Native + TypeScript, Expo SDK 54 development build, iOS and Android. This is a testable gateway implementation; **no physical phone, background execution, or ESP32 link has been validated yet**. No driver monitoring dashboard, phone accelerometer, raw IMU upload, or firmware is included.

## Build and configure while parked

Use Node 24. Install the Android SDK/JDK 17 for Android; use macOS with Xcode and a signing team for an iPhone. Change the example app identifiers in `app.json` before distribution. Expo Go cannot load `react-native-ble-plx`; use a native development build.

```sh
cd mobile
npm ci
cp .env.example .env
# Set the SAME Supabase project URL and public publishable/anon key as the dashboard.
npm run typecheck
npm test
npm run android  # attached Android phone with USB debugging
npm run ios -- --device  # on macOS, attached signed iPhone
```

Apply `supabase/migrations/20261028000100_gps_accuracy.sql` through the existing Supabase migration workflow before uploading GPS. It adds only nullable `gps_points.accuracy_m` and extends `ingest_gps`; old publishers remain compatible. Existing ownership, RLS, RPC names and retry rules remain unchanged. The root database tests execute both migrations. This PR does not apply the migration to the live database.

Use an existing confirmed session-owner account. No service-role key, test account password, or privileged credential belongs in `.env` or the bundle. Owner auth tokens use chunked iOS Keychain / Android Keystore-backed SecureStore storage. The local SQLite telemetry database is in the app sandbox, not application-level encrypted; uninstalling or clearing app storage deletes the backlog. Do not sign out, clear app data or uninstall before verifying uploads.

1. Sign in while parked. Leave **Hardware BLE off** for the first test: the app creates an immutable `simulated` session and explicitly generates sparse BLE test events every three seconds, rotating IMUs 1–3. Peak magnitude and event GPS remain null. **GPS comes from the phone**, including in this BLE simulation mode; there is no fake GPS fallback.
2. Choose foreground test mode first. Grant precise location. Press Start once before driving. The phone requests highest navigation accuracy and approximately 1-second updates with zero distance filter; it preserves the OS fix timestamp, horizontal accuracy in metres, and nullable speed/heading. Fixes without valid accuracy/coordinates are rejected and logged. Android's `timeInterval` is a request; iOS ignores it and controls callback cadence. Neither platform guarantees one valid fix per second.
3. The status screen shows collection, BLE transport connection, pending uploads and latest durable diagnostic. It never presents event silence as normal/green. Network failures leave packets queued and visible. Connection observations occur on BLE transitions and every five seconds while JS is scheduled. The observer's existing 15-second stale rule applies; a connected BLE link does not prove fresh IMU readings.
4. End while parked. Collection stops, and a final disconnected observation and finish operation enter the durable queue atomically with stopped state. The server session finishes only after earlier packets upload, so stopping offline does not reject the backlog. A failed RPC remains at the queue head with an error; there is no automatic data deletion or identity rewrite. Correct clock/auth/schema issues before retrying. Start/sign-out controls remain blocked until the queue drains.

## Durability and retries

SQLite WAL + FULL synchronous transactions persist source receipts, sequence allocation and packet payload together before an upload can read them. GPS, event and connection have separate counters; events share one counter across all three IMUs. One app installation is the exclusive publisher of each created session. Do not run a dashboard cloud simulator or another phone into the same session.

A single uploader drains FIFO records through the existing authenticated ingestion RPCs, at most 100 records per pass. Current requests contain one record (within the 1–100 RPC limit). Only a successful response deletes an outbox row. Network callbacks, a five-second scheduler and location tasks trigger retries, with capped exponential delay after errors. The UUID, source timestamp, accuracy, payload and sequence stay fixed after enqueue. A server commit followed by a lost response is safe because existing server keys use first-write-wins. BLE UUID receipts remain after successful upload, so retransmission does not allocate another sequence. GPS callback timestamps similarly deduplicate OS replays. Counters and receipts deliberately remain for the installation lifetime; retention/archival is future operational work.

Persisted drive ownership fences uploads to the signed-in account. Relaunch with previously granted permissions resumes the saved session, including offline when a cached auth session is available; process termination itself cannot be repaired until the OS launches the app again. A fresh session requires network access to create its server identity. Reinstall and moving an active session to a second phone are unsupported. Never independently resume a session finished remotely; a server rejection stays visible for diagnosis.

Source UTC clocks must be synchronized. Events before session start or more than 60 seconds in the future are rejected locally; the database remains authoritative. There is no fabricated UTC conversion from MCU uptime and no substitution of phone receipt time for event time.

## Provisional BLE bench contract (no ESP32 firmware)

Hardware mode requires a known peripheral identifier (Android MAC, iOS CoreBluetooth UUID) and configurable 128-bit service/notify-characteristic UUIDs. Find them with a BLE inspection tool during bench setup. No production UUIDs, pairing/security policy, replay request, application ACK or clock-sync exchange exist in the prior protocol, so none is claimed finalized here.

A bench peripheral must advertise the selected service and notify **UTF-8 newline-delimited JSON**. Frames may span multiple notifications; buffered bytes are capped at 8 KiB. Each event uses Stage 2 field names, with no `session_id`, `sequence`, `received_at`, or continuous acceleration samples:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "imu_id": 2,
  "recorded_at": "2026-10-28T16:00:00.000Z",
  "severity": "warning",
  "magnitude": 1.8,
  "latitude": null,
  "longitude": null,
  "t1": 0.8,
  "t2": 1.8
}
```

Supply a new stable UUID once per MCU event, retained on retransmission and across MCU reboot. IDs must be globally unique. Use the session's actual UTC time window. All listed fields are required; absent peak/GPS must be explicit null. Both boundaries T1 and T2 are warning; only A > T2 is critical. Invalid reports are logged and excluded, never corrected or synthesized. The gateway does not set MCU thresholds. Full raw recordings remain on the ESP32-S3 Feather (#5477) connected to three ISM330IS IMUs.

The adapter reconnects to the configured peripheral with 1–30 second capped backoff while JS runs, rediscovers GATT, replaces subscriptions and resets partial frames. Bluetooth off/permission failures remain disconnected. It never switches to simulation. Reliable delivery of events emitted while BLE is disconnected requires future firmware retention, replay and acknowledgment design; the phone cannot recover a packet it never received. The durable queue guarantee begins only after a successful local transaction.

## Background restrictions and required physical-phone acceptance tests

Background location is **opt-in and experimental**, not certified. Android requests foreground/background location, Android 12+ nearby Bluetooth permissions, and Android 13+ notifications. Background location can require a separate system Settings step; grant it while parked, then resume. Android uses a visible location foreground-service notification. iOS declares `location` and `bluetooth-central`, requests Always location and shows the background location indicator. Approximate/denied permissions reduce availability and must be tested explicitly.

iOS can suspend JS timers, throttle BLE discovery and location, or stop delivery after force-quit. Android vendors, Doze, battery restrictions, force-stop and permission revocation can stop services. BLE state restoration is configured, but native restored-device subscription recovery and uninterrupted killed-process BLE ingestion are **not implemented/validated**. Background location task callbacks can persist GPS and attempt queued uploads; they do not imply continuously running JS or BLE. No claim of reliable locked-screen BLE, continuous background GPS, 1 Hz accuracy or automatic restart after force-stop is made. This implementation must not be used for unattended driving trials until acceptance is recorded on actual phones.

Run these tests on at least one physical iPhone and Android phone; log OS/device versions, permission choices, app build, source mode, durations, packet counts and failures:

| Test                                                                 | Expected evidence                                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreground, explicit simulated BLE, 3+ minutes outdoors              | Server session says simulated; all three IMUs; real phone GPS timestamps/accuracy; measure valid fix cadence and gaps rather than assuming 1 Hz                |
| Cellular/Wi-Fi off, BLE left on for 2+ minutes; restore internet     | Queue grows then drains without touch; unique UUID/sequence counts and original source timestamps/accuracy match; observer route fills without moving backward |
| Kill/relaunch app with queued data                                   | Persisted payloads/counters survive; saved drive resumes only with appropriate existing permission/auth; acknowledge OS termination gaps                       |
| Stop offline, relaunch, restore network                              | Final disconnected status and server finish occur after backlog, with no post-end samples                                                                      |
| Bench BLE peripheral                                                 | Split and multiple JSON frames; all IMUs, exact T1/T2 boundaries, null peaks; repeat UUID before and after upload/relaunch produces one event                  |
| BLE off/out of range, then return                                    | Disconnect shown/persisted, reconnect resubscribes once, GPS continues, no test events introduced                                                              |
| Lock screen/background for 15+ minutes, including Doze/battery saver | Measure GPS cadence, BLE receipt gaps, retry latency and heartbeat staleness on each OS; record failures before claiming support                               |
| Revoked/approximate permissions, no GPS fix, Bluetooth off           | Useful error/disconnected status, no invented readings or accuracy                                                                                             |
| Expired auth, wrong owner, observer-only account, server rejection   | No unauthorized uploads, rejected queue retained, visible diagnosis; reauthenticate while parked                                                               |
| Observer dashboard on separate device                                | Remote owner/shared-observer history shows GPS/events/status, all current IMU states remain gray, simulated sessions remain labeled                            |

Check the existing observer sharing workflow to grant a separate confirmed observer account read access. The mobile app deliberately has no observer dashboard or driver alerts. All human setup, recovery from denied permissions and manual diagnostics happen while parked.

## Automated verification

```sh
# repository root
npm ci
npm test             # SQL/RLS and legacy+accuracy ingestion compatibility
npm run build
npm run test:e2e
# mobile
npm ci
npm run typecheck
npm test             # real file-backed SQLite restart/rollback/outbox integration + protocol/source tests
npx expo install --check
npx expo export --platform all --output-dir ../work/mobile-export
```

These checks do not exercise native Bluetooth/location services, signing or actual-phone background execution. Native Android/iOS builds and the physical acceptance matrix remain required. Export output is a JS/assets validation artifact, not an installable phone binary.
