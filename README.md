# MSD Impact Monitor

A working React + TypeScript prototype for monitoring vehicle motion and impact events. All vehicle, GPS, IMU, impact, and session data is **simulated**. No physical hardware, phone gateway, account, API key, or cloud database is required.

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

## Try the dashboard

- **Live GPS:** a demo vehicle travels a closed San Francisco route at 32 km/h. The map follows it; drag to explore, use +/− to zoom, and use the target button to resume following. Impact markers include event timestamps and coordinates.
- **IMU indicators:** view signed X (longitudinal), Y (lateral), and Z (vertical) acceleration in g, with the latest 24 seconds plotted. Values represent linear acceleration with gravity removed.
- **Traffic light:** the resultant magnitude `sqrt(x² + y² + z²)` determines the status. Green is below T1; yellow is at or above T1 and below T2; red is at or above T2. Gray indicates unavailable data.
- **Thresholds:** open **Threshold settings** or the impact card’s settings button. The prototype supports `0 < T1 < T2 ≤ 10 g`, defaulting to T1 = 0.8 g and T2 = 1.8 g. These are demonstration values, not calibrated safety limits.
- **Impact simulation:** select **Simulate impact** to inject a short pulse. Automatic warning and critical pulses also occur at alternating 30-second intervals. One continuous excursion produces one event; its peak magnitude, timestamp, GPS location, and highest severity update as the pulse evolves.
- **Missing data:** switch **Data feed** off to see gray status, unavailable readings, and no GPS marker. Reconnect to resume the stream. Session time continues; distance is accumulated only between consecutive received positions.
- **Session history:** select **New session** to save the current drive and begin another. Completed drives retain distance, duration, impact count, and maximum magnitude in the exported record.
- **Impact history:** open **Impact events** and filter by severity. Historical classifications are retained when thresholds change.
- **Export:** **Export data** downloads a JSON snapshot with schema version, simulation label, thresholds, sessions, and timestamped impact coordinates.

The dashboard starts with three clearly simulated historical sessions and three impact events. Active data, settings, and newly recorded history are held **in memory** and reset on refresh. Export JSON before refreshing to retain a copy. Times use the browser’s local timezone; exported timestamps are Unix milliseconds and export time is ISO 8601.

## Map and offline behavior

The map uses Leaflet and public OpenStreetMap raster tiles, with visible attribution. Tile access is the only external browser request; fonts and application assets are bundled locally. If tile loading fails or the browser is offline, an **illustrated offline basemap** keeps GPS coordinates, the route, vehicle movement, and event markers usable. The illustration is approximate and is not a navigation map. OpenStreetMap tiles are subject to their [usage policy](https://operations.osmfoundation.org/policies/tiles/); choose an appropriate tile service before a production deployment.

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
    monitoring.test.ts Domain and simulated-source tests
  hooks/useMonitor.ts  Live state, event aggregation, sessions, and JSON export
  lib/format.ts        Time and duration presentation
  services/telemetry.ts
                       Deterministic simulator and TelemetrySource adapter interface
  App.tsx              Dashboard layout and navigation
  styles.css           Responsive theme
 tests/                Browser-level behavior and mobile layout checks
```

## Later integration

1. **ESP32-S3 → driver phone gateway:** implement `TelemetrySource.subscribe()` to deliver normalized `TelemetrySample` records or `null` on signal loss. Keep transport details outside presentation components. The pure sampler currently drives `useMonitor`; replace that polling section with the gateway adapter subscription while retaining event/session state handling. Account for sensor calibration, orientation, gravity removal, sampling rate, and timestamps at this boundary.
2. **Stale data:** the prototype has an explicit disconnect control. A real adapter must emit `null` on disconnect or after a freshness timeout, validate incoming records, and handle reconnects. The simulator does not establish hardware reliability or real impact-detection accuracy.
3. **Supabase:** add authenticated persistence around the shared `DrivingSession` and `ImpactEvent` models and threshold settings. Keep database calls in a service layer, add schema migrations and row-level security, and replace the in-memory initial history with loaded records. Do not expose service-role credentials in the browser.
4. **Configuration:** no environment variables are needed today. Introduce documented public configuration only when an integration is added.

No hardware connection, cloud database, real GPS collection, or authentication is implemented in this prototype.
