# First ESP32 → USB → Supabase → MSD Observer test

This is a **bench test with simulated acceleration generated on your physical ESP32-S3**. No real IMUs, GPS, Wi-Fi, BLE, iPhone gateway, display driver, database migration or observer changes are involved. Run it on a desk. The firmware replaces the board's current program; save any existing board files/program first. Its display can stay blank.

Hardware acceptance is **pending until you perform the steps below**. Software tests, mocked serial tests and cloud fixtures do not prove physical USB operation.

## 1. Check the board model

You confirmed your physical board is **#5477 without a built-in screen**. Use **Adafruit Feather ESP32-S3 2MB PSRAM** below. For reference, Adafruit's [Reverse TFT PCB README](https://github.com/adafruit/Adafruit-ESP32-S3-Reverse-TFT-Feather-PCB) identifies it as **#5691**, while Adafruit's [hardware list](https://github.com/adafruit/Adafruit_Learning_System_Guides/blob/main/MeshFruit_EInk_Message_Board/README.md) identifies **#5477** as the ESP32-S3 Feather with 4MB flash / 2MB PSRAM. The Reverse TFT profile is included only as an alternative for that different board:

| Physical board                                                | Arduino Tools → Board selection (Espressif core 3.3.5) | CLI board ID                          |
| ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| Reverse TFT, display on back and three front buttons, #5691   | Adafruit Feather ESP32-S3 Reverse TFT                  | `adafruit_feather_esp32s3_reversetft` |
| Feather without built-in screen, 4MB flash / 2MB PSRAM, #5477 | Adafruit Feather ESP32-S3 2MB PSRAM                    | `adafruit_feather_esp32s3`            |

The same sketch supports both: it uses native USB and no board-specific sensor/display pins. Do not choose an ESP32-S2, plain ESP32, TFT #5483, or No PSRAM board profile for these models.

## 2. Get the files on macOS Monterey

1. Get a **USB data cable** compatible with the Feather's USB-C connector and your Mac. A charge-only cable supplies power but cannot flash or carry serial data. No sensor wiring or battery is needed.
2. Install Arduino IDE **2.3.6** for your Mac architecture from [Arduino's release page](https://github.com/arduino/arduino-ide/releases/tag/2.3.6). This version supports Monterey. Drag Arduino IDE into Applications and open it.
3. Install Python **3.13** using the macOS universal2 installer from [python.org](https://www.python.org/downloads/macos/). Open Terminal (Applications → Utilities). Check `python3 --version` reports 3.9 or newer. Run the installer's **Install Certificates.command** if HTTPS reports certificate errors; keep TLS verification enabled.
4. To get this PR's code before it is merged, run the following in Terminal. If macOS prompts for Command Line Tools when using `git`, install them and rerun. This creates a new folder; if that folder already exists, choose another new folder name.

```sh
cd ~/Documents
git clone --branch feat/esp32-usb-simulated-telemetry --single-branch https://github.com/nickessler2004/MSD.git MSD-usb-test
cd MSD-usb-test
```

Keep this Terminal window open in the repository root. Do not run commands from inside `firmware/` or `mobile/`.

## 3. Install the board support and flash

1. Arduino IDE → **Settings/Preferences → Additional Boards Manager URLs**: add `https://espressif.github.io/arduino-esp32/package_esp32_index.json` (keep any existing URLs).
2. Open **Tools → Board → Boards Manager**, search **esp32**, choose **esp32 by Espressif Systems**, and install **3.3.5**. No extra Arduino libraries are needed.
3. **File → Open**: select `MSD-usb-test/firmware/usb_simulator/usb_simulator.ino`. The `telemetry.h` tab should also be present.
4. Plug the Feather into the Mac using the data cable. Choose the matching board from the table above under **Tools → Board → esp32**.
5. Set **Tools → USB Mode → USB-OTG (TinyUSB)** and **USB CDC On Boot → Enabled**. Keep board defaults for other options (4MB flash, QSPI PSRAM). Set **Core Debug Level → None** if shown, so debug output cannot corrupt the JSON stream.
6. Select **Tools → Port → /dev/cu.usbmodem…** for this board. If you are unsure, unplug it, inspect the port list, reconnect it, and select the port that appears.
7. Click **Verify** (check mark), then **Upload** (right arrow). Wait for the success message. If it cannot connect, hold **BOOT/0**, tap and release **RESET**, release BOOT/0, choose the newly appearing USB port, and upload again. After upload, tap RESET once if it remains in the bootloader.
8. **Close Serial Monitor and Serial Plotter**. Only the bridge should open the USB serial port. The firmware is deliberately silent until the bridge synchronizes its clock. A blank screen or no serial log is expected.

On these native-USB boards no CP210x/CH340 USB-UART driver should be required. If there is no port, try a known data cable and a direct Mac port or known working USB adapter before changing drivers.

Optional reproducible CLI compile, after installing Arduino CLI 1.3.1 and the same core:

```sh
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32@3.3.5 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3:USBMode=default,CDCOnBoot=cdc firmware/usb_simulator
```

Only for Reverse TFT #5691, replace `adafruit_feather_esp32s3` with `adafruit_feather_esp32s3_reversetft`.

## 4. Prepare the temporary laptop gateway

1. On Monterey, open **System Preferences → Date & Time → Date & Time**, unlock the padlock, and enable **Set date and time automatically**. Confirm the Mac has Internet access and correct current time. UTC serialization does not depend on the Mac's selected display time zone.
2. In the repository-root Terminal, create a virtual environment and install the one bridge dependency:

```sh
python3 -m venv tools/serial_bridge/.venv
source tools/serial_bridge/.venv/bin/activate
python -m pip install -r tools/serial_bridge/requirements.txt
python -m serial.tools.list_ports
```

The final command lists the actual `/dev/cu.usbmodem…` device. It can change after flashing/resetting.

3. Get the **existing dashboard's Supabase project URL and publishable/anon key** from your project's settings (or the existing local `.env` / Netlify build configuration). They must identify the same project as `https://msd-observer.netlify.app/`. Paste just these two public values into Terminal, replacing the examples:

```sh
export VITE_SUPABASE_URL='https://YOUR-PROJECT-REF.supabase.co'
export VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_REPLACE_WITH_YOUR_PUBLIC_KEY'
```

Do not copy service-role/secret keys, change RLS, paste passwords into these commands, or put any cloud credentials in firmware. The bridge rejects privileged keys. It prompts for the session-owner email and a hidden password, authenticates through Supabase Auth and uses that user's access token for every RPC. Tokens and passwords stay in process memory. It also supports existing `MSD_TEST_EMAIL` / `MSD_TEST_PASSWORD` environment variables for controlled tests; leave them unset to get interactive prompts. Do not source an unreviewed environment file.

## 5. Capture from the real board and upload

Replace the port below with the one actually listed on your Mac:

```sh
python tools/serial_bridge/bridge.py --port /dev/cu.usbmodem1101 --seconds 30 --t1 0.8 --t2 1.8
```

Enter your existing confirmed **session-owner account**, using the same account you can sign into on the observer website. A new session is always created with `data_source=simulated` and a label beginning **SIMULATED — ESP32 USB bench**. Its session ID and SQLite outbox path are printed before capture starts.

The command applies T1/T2 to all three IMUs, synchronizes the board, and prints lines such as `Saved #1 IMU 2 warning 0.800 g` **only after receiving real serial packets**. It captures for 30 seconds, then uploads the saved events in batches of at most 100 and finishes the cloud session. **Uploads start after capture ends**; allow another few seconds for them. A successful exit includes `Cloud upload complete; session finished: …`. The normal run contains warnings and criticals from all three IMUs (roughly 60 events over 30 seconds); no normal samples are uploaded.

To view using a separate existing confirmed observer account, explicitly grant access when creating the session:

```sh
python tools/serial_bridge/bridge.py --port /dev/cu.usbmodem1101 --seconds 30 --share-email observer@example.com
```

Replace the address with your actual intended observer. This calls only the existing `share_session` RPC. It does not create accounts or send chat/email messages.

T1/T2 are run configuration, in g: `0 < T1 < T2 <= 10`. The minimal bridge uses one pair for all three IMUs and persists all three cloud settings. Start another capture to test a different pair. Do not edit thresholds or start the dashboard's cloud simulator in this session during capture. Each invocation creates its own session; there is one coordinated publisher.

## 6. Verify on the existing website

1. Open [MSD Observer](https://msd-observer.netlify.app/) in your laptop browser. Choose the cloud data source if needed, then sign in as the bridge's owner or the observer explicitly shared above.
2. Refresh the page to discover the new session if it was open before creation. Select the **SIMULATED — ESP32 USB bench** session matching the printed UTC label/session ID. Do not start the website's generated cloud test drive.
3. After bridge upload completes, use **Refresh records**. In **Event analysis**, reset time/severity/IMU filters. Check warning and critical entries for **IMUs 1, 2 and 3**, magnitudes, source times, and T1/T2 snapshots. Both **0.80 g and 1.80 g must be warning** for default thresholds; peaks above 1.80 g must be critical.
4. **Session history** should retain the completed session. Event count should match the bridge's saved/uploaded events. The cloud source must be labeled simulated. Compare several serial sequence/IMU/peak lines with the website entries.
5. GPS, route, speed and event locations should be unavailable because this test supplies no GPS. The three **current** IMU indicators must stay unknown/gray; sparse historical threshold events do not establish current motion. No connection heartbeat is synthesized, so a disconnected/unavailable gateway indicator is expected.

For exact UUID/sequence/timestamp comparison, inspect your durable local capture:

```sh
python - work/usb-REPLACE_WITH_SESSION_ID.sqlite3 <<'PY'
import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    for (body,) in db.execute('SELECT body FROM events ORDER BY sequence'):
        print(json.dumps(json.loads(body), indent=2))
PY
```

In Supabase's authenticated owner-facing dashboard, inspect `public.threshold_events` filtered to that session ID and compare `id`, `sequence`, `recorded_at`, `imu_id`, `severity`, `magnitude`, `t1`, `t2`. `received_at` is assigned by the database and should differ from source time. Browser display may show source times in your local time zone. No admin/service key is needed by the bridge.

## Failures and retry

- **Port busy / permission denied:** close Arduino Serial Monitor, Plotter, `screen` and other serial applications. Recheck the port. Do not run the bridge with `sudo`.
- **No port / no packets:** use a data cable, verify the board selection and USB CDC setting, upload the sketch again, tap RESET, and recheck `/dev/cu.usbmodem…`. The bridge never substitutes laptop-generated measurements.
- **Handshake timeout / clock mismatch:** do not fabricate a timestamp or use the receive timestamp. Check automatic Mac time, reset the board, close other serial tools, and start a new capture. The board emits nothing before START and expires its synchronized clock after 60 seconds. An incomplete capture fails explicitly.
- **Capture interrupted / unplugged:** validated packets already saved in SQLite survive. Packets still on the board or in USB buffers can be lost; there is no device-side replay. A new capture always uses a new session and fresh clock handshake. Never resume board capture into an existing session/outbox.
- **Upload failed / Wi-Fi interrupted:** retain the printed outbox. With Internet restored, authenticate as the same owner in the same project and run:

```sh
python tools/serial_bridge/bridge.py --retry work/usb-REPLACE_WITH_SESSION_ID.sqlite3
```

Retry does not open USB, generate samples, create another session, change UUIDs/sequences/source times, or relabel data. If a commit succeeded but its response was lost, cloud first-write-wins prevents duplicates. Uploaded rows are marked sent only after the RPC succeeds. Already valid delayed packets can be uploaded to a finished session within its original time window. Incomplete captures can be retried to upload their saved subset, but must be recorded as incomplete hardware tests.

- **No events on website:** check the project URL, signed-in account, session sharing, selected session and filters, and then refresh. Check for an explicit bridge error. Do not disable RLS or switch to local simulation as proof of hardware integration.

## USB contract and limits

`docs/TELEMETRY_PROTOCOL.md` remains authoritative for cloud fields and classification. Firmware keeps generated X/Y/Z in g on the board, computes the Euclidean resultant, and emits one report per above-threshold simulated sample. Six repeating phases per IMU include normal, exact T1, exact T2, above T2 and a three-axis vector. Phases are offset across the three IMUs. There is no real IMU driver, gravity compensation, continuous cloud acceleration stream, impact-excursion grouping, GPS or heartbeat.

USB is 115200 baud, with newline-terminated UTF-8 JSON event frames of at most 1024 bytes. Each includes `type:event`, `run_id` (the cloud session UUID), plus exactly the protocol event fields. Example:

```json
{
  "type": "event",
  "run_id": "10000000-0000-4000-8000-000000000001",
  "id": "20000000-0000-4000-8000-000000000002",
  "sequence": 1,
  "imu_id": 2,
  "recorded_at": "2026-11-02T20:00:00.123Z",
  "magnitude": 0.8,
  "severity": "warning",
  "t1": 0.8,
  "t2": 1.8,
  "latitude": null,
  "longitude": null
}
```

The bridge removes only the transport fields `type` and `run_id`. It preserves the firmware-created UUID v4, single shared sequence (starting at 1 per session), source timestamp and payload through retries. It validates finite magnitudes, severity/boundary agreement, thresholds, IMU IDs, run identity and time bounds before saving. Duplicate UUID/sequence conflicts retain the first saved record. Missing normal events carry no current-state meaning.

Clock control messages are separate from telemetry; the sole board control response is a JSON `ready` acknowledgement. Host commands are bounded ASCII lines:

1. `STOP\n` pauses the board. The bridge drains old USB data before starting.
2. `SYNC <session-uuid> <32-hex-random-nonce> <host-utc-ms> <t1> <t2>\n` stops emission, validates thresholds/time range, and anchors source UTC to the board's 64-bit monotonic uptime. The board returns `{"type":"ready","run_id":"…","nonce":"…","utc_ms":…, "t1":…, "t2":…}`.
3. The bridge checks every acknowledged value and a round-trip deadline of 400 ms, then sends `START <same-nonce>\n`. The board accepts that challenge once, within 500 ms of SYNC. Late/mismatched responses do not enable telemetry. Reset starts unsynchronized.
4. Board UTC is the supplied UTC plus monotonic elapsed time. Transport delay means source UTC can lag synchronized host UTC by up to the accepted handshake latency; this is a subsecond bench clock estimate, not precision time certification. The host verifies its clock against session start (within five seconds), checks for clock jumps during capture, and never substitutes arrival time. Correct UTC still depends on macOS automatic time. Firmware stops emitting after 60 seconds without another synchronization; capture is restricted to 3–45 seconds and then STOP is sent.

There is no automatic reconnect or resynchronization during a run, no durable board outbox, and no background gateway service. Saved laptop events are durable; unreceived events are not. Firmware UUIDs use the ESP32 random source. This is a short integration harness; reliable BLE replay and iPhone lifecycle work remain separate.

## Automated validation

From the repository root (C++ compiler required for native tests; macOS Command Line Tools supply `c++`):

```sh
python3 -m unittest discover -s tools/serial_bridge/tests -v
npm test
npm run build
npm run test:e2e
npm run test:pwa
```

The Python suite compiles the shared firmware generator/formatter and the actual sketch against Arduino stubs. It checks X/Y/Z simulation, exact classification boundaries, clock expiry, handshake gating, malformed/partial/multiple/oversized frames, all three IMUs sharing sequence, UUID retention, SQLite restart/deduplication, authenticated RPC wiring and exact retry batches. These are software tests. The GitHub **ESP32 USB telemetry** workflow separately cross-compiles the actual sketch for both supported board profiles using Espressif 3.3.5.

An optional live **software-only** test creates a clearly labeled simulated session with three test fixtures, exercises real owner ingestion/readback, duplicate replay and unrelated-observer RLS, then finishes it. It does not read USB or prove hardware operation. Use only the configured test accounts and project:

```sh
MSD_LIVE_USB_BRIDGE_TEST=1 python3 -m unittest discover -s tools/serial_bridge/tests -p test_live.py -v
```

This opt-in test requires `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `MSD_TEST_EMAIL`, `MSD_TEST_PASSWORD`; optional `MSD_OBSERVER_EMAIL` / `MSD_OBSERVER_PASSWORD` enable the unrelated observer checks. Never commit these values. See [validation evidence](ESP32_USB_VALIDATION.md) for the checks actually run and pending hardware acceptance.
