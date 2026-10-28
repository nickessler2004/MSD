# PR #3 software validation — 2026-10-28

Deployment scope: **iPhone**, using the existing implementation. Software validation runs free on the Linux cloud executor with Node 24. No Apple Developer Program membership, paid build service, device lab, signing service or Mac was used or required. Android code remains in the repository but is not an iPhone acceptance dependency.

## Live Supabase migration and gateway verification

Project: `zffpqwqabysvqjbnchgy.supabase.co`. The user applied migration `20261028000100_gps_accuracy.sql`; validation made **no schema changes** and used only the public project key plus ordinary authenticated owner/observer accounts. No service-role credential was used or embedded in the app.

Successful opt-in run created finished simulated session `814b16bb-cde1-4e80-bce0-2bfdf123db02`, labeled `PR #3 SOFTWARE VALIDATION — SIMULATED …`. Test runs leave labeled, finished simulated sessions in the existing database; no existing user telemetry was edited or deleted.

| Check                                                           | Observed result                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual `SimulatedBle` → parser → durable SQLite → existing RPCs | One event each from IMUs 1, 2 and 3; sequences 1–3; source timestamps, UUIDs, reported severities and threshold snapshots retained                                  |
| Sparse event payloads                                           | Missing magnitude and event GPS remain null; no acceleration or position is invented                                                                                |
| GPS accuracy migration                                          | Synthetic 4.25 m accuracy uploaded and read back as 4.25; source timestamp preserved as the same instant, despite PostgreSQL returning UTC `+00:00` rather than `Z` |
| Legacy GPS compatibility                                        | Old GPS payload without `accuracy_m` accepted; accuracy reads back null                                                                                             |
| Accuracy constraints                                            | Negative and infinite accuracy rejected                                                                                                                             |
| Backend idempotency                                             | Replayed event remains one event; conflicting GPS replay cannot overwrite original 4.25 m accuracy                                                                  |
| Durable retry                                                   | File-backed SQLite reopened before upload and after an actual server commit with a deliberately lost response; backlog drained without duplicate records            |
| Connection/session lifecycle                                    | Exactly connected/disconnected observations persisted; queued server finish follows telemetry and closes the simulated session                                      |
| Access control                                                  | Shared observer reads GPS/events/status; observer ingestion rejected; anonymous telemetry unavailable                                                               |

GPS coordinates/accuracy in this live test are **synthetic fixtures**, explicitly stored in a simulated session. Native BLE is mocked so the real simulator can load on Node; the simulator, queue, upload calls and remote database responses are real. This is not an iPhone GPS or hardware BLE measurement.

## Software and dashboard checks

- 81 repository unit/integration tests, including both SQL migrations and RLS.
- 21 mobile unit/integration tests, covering protocol boundaries, actual file-backed SQLite, restart recovery, transaction rollback, replay deduplication, ambiguous responses, mocked-native runtime behavior, BLE subscription replacement and token chunk storage.
- One additional opt-in live Supabase integration test described above.
- 23 browser regression tests for the existing dashboard.
- Two additional live browser checks: owner and shared observer load the existing dashboard production build against this real project, display the two historical GPS fixes/route and all three IMU events, preserve simulated labeling, keep current IMU states unknown/gray, and display read-only observer access without uncaught page errors.
- Root TypeScript/production build, mobile TypeScript, formatting and Android/iOS JavaScript/Hermes bundle exports.
- Expo SDK dependency compatibility check uses its bundled map in offline mode; it is not an online compatibility certification.

The live browser checks run the existing dashboard's local production build. This executor's Chromium lacks the session proxy CA, so live Supabase HTTP requests are relayed through Node using the configured proxy/trusted CA, with TLS verification enabled. Responses come from the actual project, not fixtures. This verifies HTTP loading/rendering/reconciliation; direct-browser TLS and live WebSocket delivery were not certified by this test. Realtime behavior is covered separately by the fixture-based regression suite.

The existing hosted URL `https://msd-pr2-dashboard-nick-1026.honey-box-4446.chatgpt.site` returned an HTTP 401 access gate from this environment. Hosted deployment access was not bypassed or changed and is not claimed validated. The unchanged dashboard software was validated locally against the real backend.

Initial overlapping browser runs collided in a shared output directory and exposed a pre-existing timing race. Live tests now use a separate ignored output directory. Two existing clock-driven regression tests freeze time between explicit timer advances, and the long replay test has enough execution time for slower executors; assertions and application behavior remain unchanged. Final browser runs are performed sequentially.

## Exact boundary of iPhone evidence

**A successful iOS bundle export does not prove physical iPhone compatibility.** No native iOS compilation/linking, signing, installation, iPhone launch or native service execution was tested. Generating JavaScript/Hermes assets does not test Xcode entitlements or CoreBluetooth/CoreLocation/Keychain/SQLite on iOS.

Still untested on an actual iPhone:

1. Supported iPhone/iOS versions, native module startup, screen layout/accessibility, signing/capabilities using a free Apple ID and actual installation/launch.
2. Bluetooth and location permission flows, Always versus When In Use, approximate/denied/revoked location, Bluetooth disabled and recovery while parked.
3. Actual Feather/three-IMU event delivery, GATT identity/notifications/MTU, RF loss, reconnect/subscription behavior, secure pairing and battery/thermal impact.
4. Real GPS acquisition/accuracy, roughly 1 Hz valid-fix cadence, timestamps, heading/speed and poor reception. iOS controls location cadence; a 1,000 ms request does not guarantee 1 Hz.
5. Lock screen/app switching, suspension, Low Power Mode, native task wakeups, long sessions, force-quit/reboot and unattended uploads. JS heartbeat/reconnect timers cannot be assumed to run while suspended.
6. iPhone SQLite/WAL and Keychain durability under termination/storage exhaustion, auth refresh, cellular handoffs and offline-to-online queue draining without driver interaction.

Known implementation gaps remain: native restored-device subscription recovery and uninterrupted killed-process BLE ingestion; ESP32 firmware, UTC synchronization, firmware event retention/replay/ACK and threshold application. BLE events never received by the phone cannot be recovered by its upload queue. Complete raw recordings remain a future firmware responsibility on the ESP32.

Expo Go cannot load the native BLE dependency. A PWA/browser, simulator, bundle export or mocked-native test cannot replace these phone checks. With no regular compatible Mac access, native iPhone validation remains pending. A free Apple ID / Personal Team may permit local development signing when a compatible Mac/Xcode/iPhone becomes available, subject to Apple's provisioning/capability limits; that optional path has not been verified for this project. Neither membership purchase nor Mac purchase is required for the software checks in this report.

## Merge assessment

PR #3 is suitable for merge **from a software-validation perspective** once its final CI checks pass. It is not certified for physical iPhone deployment, reliable background collection or unattended driving. Keep the PR open for review; do not merge automatically. No further database schema change is required by the verified results.

Reproduction commands and the later iPhone acceptance matrix are in [mobile/README.md](../mobile/README.md). Live tests require explicit opt-in and ordinary test-account credentials; normal unit/build/CI checks never write to the live project.
