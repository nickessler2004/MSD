# ESP32 USB integration validation

Validated 2026-11-02 against `main` commit `0010bcd5b0d016239a28940130b0f3b464ab76b9`. The user confirmed the physical board is **Adafruit Feather ESP32-S3 #5477, 4MB flash / 2MB PSRAM, without a screen**. The default flashing profile is `adafruit_feather_esp32s3`; Reverse TFT #5691 is a documented alternative.

## Software checks performed

| Check                                            | Result                                        |
| ------------------------------------------------ | --------------------------------------------- |
| Python/native firmware + bridge tests            | 13 passed; live cloud test skipped by default |
| Explicit opt-in live Supabase test               | 1 passed                                      |
| Existing dashboard unit / migration tests        | 84 passed                                     |
| Existing browser end-to-end tests                | 31 passed                                     |
| Existing production PWA browser tests            | 3 passed                                      |
| Existing mobile gateway unit tests               | 21 passed                                     |
| ESP32 cross-compile, confirmed #5477 profile     | Passed in GitHub CI, Espressif 3.3.5          |
| Reverse TFT alternative cross-compile            | Passed in GitHub CI, Espressif 3.3.5          |
| Existing mobile TypeScript check                 | Passed                                        |
| Dashboard production build                       | Passed                                        |
| Standalone demo build                            | Passed                                        |
| Repository Prettier check                        | Passed                                        |
| Python syntax compilation / git whitespace check | Passed                                        |

The native tests compile the shared firmware simulation/formatter and the actual `.ino` against small Arduino/clock/serial stubs. This verifies code paths, not the Espressif toolchain or hardware. Python capture tests consume those firmware-formatted bytes; they also verify that empty serial input fails instead of generating laptop events. The actual runtime bridge has no laptop measurement generator.

The explicit live test authenticated as the configured owner using the existing public project key. It created **SIMULATED — SOFTWARE ONLY USB bridge RPC test** session `72dc63b7-488d-4e47-80c3-5a25732eba5e`, uploaded three fixture events (T1 boundary, T2 boundary, above T2), replayed the same UUIDs/sequences/times through the durable upload path, and read back exactly three unchanged records. A separate unrelated authenticated observer could not read them or ingest into that session. The test finished the session. These were software-generated fixtures, not serial measurements from hardware. No service-role credential, schema migration, RLS change or UI/mobile code change was used.

Initial browser commands were blocked by the command sandbox's socket restriction; they passed when rerun with managed networking enabled. Initial mobile commands lacked installed mobile dependencies; `npm ci` restored those and the tests/typecheck passed without source or lockfile edits.

## Cross-compilation and website access

The local Arduino CLI 1.3.1 could not install the Espressif core: the environment's network policy denied `downloads.arduino.cc` and `espressif.github.io`. The **ESP32 USB telemetry** [GitHub CI run](https://github.com/nickessler2004/MSD/actions/runs/41510658910) successfully installed Espressif 3.3.5 and cross-compiled both `adafruit_feather_esp32s3` and `adafruit_feather_esp32s3_reversetft`, with native USB CDC enabled, at commit `47929de2804d3fda21ee7340fbc045ec8709976e`. The confirmed #5477 build uses 411,083 bytes of flash and 43,584 bytes of global RAM. Both jobs also passed the Python/native suite using Python 3.9. The first CI attempt failed because `ubuntu-latest` had moved to Ubuntu 26.04 without Python 3.9 builds; pinning this new workflow to Ubuntu 22.04 resolved it. Cross-compilation is not a physical flash or USB test.

The existing [dashboard/mobile CI run](https://github.com/nickessler2004/MSD/actions/runs/41510658897) also passed, including dashboard/browser/PWA checks, mobile tests/typecheck, Expo dependency compatibility and iOS/Android bundle export. No mobile source changes were made.

The environment also returned **403 Forbidden** for `https://msd-observer.netlify.app/` because that hostname is outside its network allowlist. The live Supabase ingestion/readback test succeeded against the existing project and existing local dashboard browser tests passed, but the deployed website could not be inspected here. The [manual guide](ESP32_USB_TEST.md) gives exact verification steps on that website from the user's Mac. No access restriction was bypassed.

## Physical acceptance — pending user execution

- Flash #5477 using the confirmed board profile on macOS Monterey; verify USB enumeration and clock handshake.
- Capture actual ESP32 event packets for 30 seconds, then upload the persisted capture.
- Match the printed session ID and simulated label on the existing deployed observer website.
- Confirm all three IMUs, warning at both exact boundaries, critical above T2, source times, event count and threshold snapshots.
- Compare UUIDs and shared event sequences between the SQLite outbox and cloud records.
- Confirm no GPS, raw acceleration or current-green IMU state is fabricated.
- Interrupt/retry an upload and confirm no duplicate cloud rows.

No physical ESP32, macOS serial connection, actual USB packet transfer or hardware-to-dashboard success has been observed by the agent. No PR is merged automatically.
