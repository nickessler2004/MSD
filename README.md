# MSD Impact Monitor

A working React + TypeScript prototype for monitoring vehicle motion and threshold events. The **Live simulation** and **Event-only preview** modes are explicitly separated. Continuous GPS and IMU values are simulated; locally injected threshold packets are labeled test events. No physical hardware, phone gateway, account, API key, or cloud database is connected or required.

![MSD Impact Monitor dashboard with simulated GPS, acceleration, and impact history](docs/dashboard.png)

## Run locally

Use **Node.js 22.12+** (Node 24 recommended) and npm.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173` in your browser. To preview the production bundle:

```sh
npm run build
npm run preview
```

Vite prints the preview address (normally `http://localhost:4173`). The development and preview servers bind to all interfaces for use in a development container; they are development tools, not a production deployment.

## Choose a telemetry mode

Use the **Telemetry source** selector at the top of the dashboard:

- **Live simulation** retains the moving-vehicle demonstration, three continuously updated acceleration axes, and automatic/injected impact pulses. Every continuous value is labeled simulated.
- **Event-only preview** prepares the UI for the ESP32-S3’s threshold-event protocol. No device is connected. Continuous acceleration, live GPS, route, speed, and distance are unavailable; the dashboard does not fill them with simulated values or zeros. **Inject test event** delivers a local sparse threshold packet through the event adapter. Its provenance remains **Test event**, never **Device event**.

Event-only packets may omit peak magnitude and GPS. The event table displays **Not supplied** instead of generating either value. Session distance is **Not available** when no continuous position stream exists. The two modes keep separate in-memory histories, so simulation records cannot appear as real-device records after changing modes.

![Event-only preview showing unknown current motion and a sparse test event](docs/event-only.png)

## Try the dashboard

- **Live GPS (simulation only):** a demo vehicle travels a closed San Francisco route at 32 km/h. The map follows it; drag to explore, use +/− to zoom, and use the target button to resume following. Impact markers include event timestamps and coordinates when those values are supplied.
- **IMU indicators (simulation only):** view signed X (longitudinal), Y (lateral), and Z (vertical) acceleration in g, with the latest 24 seconds plotted. Values represent linear acceleration with gravity removed. These are not ESP32-S3 readings.
- **Traffic light:** for fresh simulated resultant acceleration `A = sqrt(x² + y² + z²)`, green means **A < T1**, yellow means **T1 ≤ A ≤ T2**, and red means **A > T2**. Both exact threshold values are yellow. Gray means current motion is unknown or data is unavailable/stale.
- **Demo thresholds:** open the threshold settings dialog. The prototype supports `0 < T1 < T2 ≤ 10 g`, defaulting to T1 = 0.8 g and T2 = 1.8 g. Changes apply only to the local live demonstration. They are not sent to a device and do not reclassify recorded events. These values are not calibrated safety limits.
- **Impact simulation:** select **Simulate impact** in live simulation to inject a short pulse. Automatic warning and critical pulses also occur at alternating 30-second intervals. One continuous excursion produces one event; its peak magnitude, timestamp, GPS location, and highest observed severity update as the pulse evolves.
- **Freshness:** availability, connection state, last-received time, and age are separate from impact severity. Live samples older than **5 seconds** are stale; their acceleration and GPS are hidden and the current traffic light becomes gray. Use **Pause updates** to exercise connected-but-stale behavior. Turning **Data feed** off disconnects immediately; reconnecting waits for a new sample instead of restoring an old green status.
- **Event-only silence:** no threshold events does **not** mean the vehicle is below T1, healthy, or currently safe. A threshold packet describes a historical impact, not continuous motion. Event-only current status remains **unknown/gray**; the latest event is shown separately with its timestamp and provenance. A locally injected test event never establishes device connectivity. Event age is recency information, not a device heartbeat.
- **Session history:** select **New session** to save the current session and begin another. Simulated drives retain measured distance, duration, impact count, and maximum magnitude. Event-only sessions retain event activity without inventing missing distance or acceleration.
- **Impact history:** open **Impact events** and filter by severity. Event packets retain their reported severity; changing local demo thresholds does not reclassify them. An empty log or zero impacts is not a confirmed green state.
- **Export:** **Export data** downloads a JSON snapshot containing the active mode, provenance, thresholds, sessions, and timestamped impact records. Unknown peak/GPS/distance values remain `null`.

Live simulation starts with three explicitly simulated historical sessions and three impact events. Event-only preview starts empty. Active data, settings, and newly recorded history are held **in memory** and reset on refresh. Export JSON before refreshing to retain a copy. Times use the browser’s local timezone; exported timestamps are Unix milliseconds and export time is ISO 8601.

## Map and offline behavior

The map uses Leaflet and public OpenStreetMap raster tiles, with visible attribution. Tile access is the only external browser request; fonts and application assets are bundled locally. In live simulation, if tile loading fails or the browser is offline, an **illustrated offline basemap** keeps GPS coordinates, the route, vehicle movement, and event markers usable. Event-only preview does not show a simulated live map. The illustration is approximate and is not a navigation map. OpenStreetMap tiles are subject to their [usage policy](https://operations.osmfoundation.org/policies/tiles/); choose an appropriate tile service before a production deployment.

## Validate

```sh
npm run build        # TypeScript checks and optimized Vite build
npm test             # Domain and telemetry unit tests
npm run test:e2e     # Browser interaction and mobile checks
npm run format:check
```

Browser tests use `/usr/bin/chromium` when available. Otherwise install Playwright’s browser once:

```sh
npx playwright install chromium
npm run test:e2e
```

On Linux, `npx playwright install --with-deps chromium` can also install required system libraries. Browser tests start the app automatically on port 5173 and deliberately block external map tiles to exercise the offline fallback. GitHub Actions runs build, unit, and browser checks on pull requests and main-branch pushes.

## Project structure

```text
src/
  components/          Map, acceleration chart, statistics, event/session tables, settings
  data/demo.ts         Explicitly seeded demonstration history
  domain/
    types.ts           Normalized telemetry, event, threshold, and session models
    monitoring.ts      Pure magnitude, classification, validation, and GPS distance logic
    freshness.ts       Explicit waiting/fresh/stale/disconnected classification
    *.test.ts          Domain and freshness tests
  hooks/useMonitor.ts  Live state, event aggregation, sessions, and JSON export
  lib/format.ts        Time and duration presentation
  services/telemetry.ts
                       Deterministic simulator and sparse event-only adapter
  services/*.test.ts   Event-only packet/provenance and adapter cleanup tests
  App.tsx              Dashboard layout and navigation
  styles.css           Responsive theme
 tests/                Browser-level behavior and mobile layout checks
```

## Later integration

No cloud integration is started in this change. The existing boundaries are ready for later work:

1. **ESP32-S3 → driver phone gateway:** use the event-first `TelemetryMessage` union to distinguish threshold-event packets from connection notifications. The ESP32-S3 will transmit threshold events, not continuous acceleration. A packet’s reported warning/critical severity is retained; optional peak magnitude and GPS stay `null` when absent. Continuous `sample` messages are typed as simulation data only. Implement a separate gateway adapter when hardware work begins, without making the simulator an implicit fallback.
2. **Connection and freshness:** keep transport connectivity independent of event arrival. Sparse events do not establish a heartbeat, and event silence cannot confirm current normal acceleration. A future gateway must report connection state and any explicit heartbeat/freshness contract separately. A recent historical event must not be represented as a current sensor reading.
3. **Persistence (later):** keep any future database calls in a service layer around the shared session and event models. Authentication, schema migrations, and row-level security are separate future work. No Supabase client, configuration, or database connection is added now.
4. **Configuration:** no environment variables are needed today. Introduce documented public configuration only when an integration is added.

No hardware connection, cloud database, real GPS collection, or authentication is implemented in this prototype.
