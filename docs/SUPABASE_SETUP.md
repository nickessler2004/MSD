# Supabase setup

The dashboard builds and runs its local demonstration without a Supabase account or credentials. To enable **Supabase cloud**, configure your own project using the steps below. No hosted project is created or modified by this repository, and no privileged key is needed in the frontend.

## 1. Create a project and install the database migration

Create a Supabase project and wait until its database is available. In the project's **SQL Editor**, open a new query and run the complete contents of:

[`supabase/migrations/20261021000100_msd_cloud.sql`](../supabase/migrations/20261021000100_msd_cloud.sql)

Apply this migration once to a fresh project. It uses the standard Supabase `auth.users`, `auth.uid()`, `anon`, and `authenticated` objects. Do not run the test-only auth fixtures against your project. Keep this migration in version control and use new migrations for later schema changes.

If you already use an installed and initialized Supabase CLI for this checkout, you can apply the same migration through its normal workflow instead:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

CLI login credentials belong to the CLI's secure setup, never to a `VITE_` variable or a tracked file. A local Docker/Supabase stack is optional; the credential-free SQL tests use PGlite and do not require one.

The migration creates these six tables:

| Table               | Purpose                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `driving_sessions`  | Owner, immutable simulated/device provenance, label, start/end time                     |
| `session_observers` | Explicit read-only access grants for registered users                                   |
| `gps_points`        | Append-only GPS route points, normally uploaded about once per second                   |
| `threshold_events`  | Append-only events for IMUs 1, 2, and 3, with threshold snapshots and optional GPS/peak |
| `connection_status` | Append-only gateway connection/heartbeat history                                        |
| `imu_thresholds`    | Configured T1/T2 values for all three IMUs in a session                                 |

All six tables have row-level security. Owners and explicitly shared observers can read authorized session data. Observers cannot upload telemetry, change thresholds, finish sessions, or manage sharing. Owners write through narrowly scoped authenticated RPCs; direct browser table writes and changes to session ownership or provenance are denied. Anonymous users have no access to session records.

The migration adds five tables to the `supabase_realtime` publication: `driving_sessions`, `gps_points`, `threshold_events`, `connection_status`, and `imu_thresholds`. Membership in `session_observers` is deliberately not published: Realtime DELETE notifications must not disclose observer identities. Sharing, revocation, and session discovery are rechecked with authorized queries on reconnect and during the ten-second reconciliation cycle. In your project's database replication/publication settings, verify the five published tables are present. This read-only SQL check is another way to inspect the publication:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
order by tablename;
```

Keep RLS enabled. Do not add broad anonymous read/write policies to make Realtime work.

## 2. Configure authentication

In **Authentication → Providers**, enable email/password sign-in. Keep email confirmation enabled for normal use; configure an SMTP provider and email delivery settings appropriate to your deployment.

In the authentication URL configuration:

- Set **Site URL** to the frontend origin you use, for example `http://localhost:5173` during local development.
- Add the exact development, preview, and deployed callback origins/URLs you will use to the allowed redirect list. The usual local preview origin is `http://localhost:4173`; Vite prints its actual address when starting. Use the actual HTTPS application URL for a deployed frontend.
- Do not use a public wildcard redirect in production.

Create accounts through **Supabase cloud → Create an account** in the dashboard. Confirm the email before signing in. PKCE email confirmation works best in the same browser where account creation began. If the confirmation link returns to local simulation, choose **Supabase cloud** to finish loading the cloud account state.

Sharing requires the observer to have registered and confirmed their email in the same Supabase project. It does not create accounts or send invitations automatically.

## 3. Set the public frontend configuration

Find your project's URL and its **publishable** key in Supabase's project connection/API-key settings. From the repository root:

```sh
cp .env.example .env.local
```

Replace the two placeholders in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PROJECT_PUBLISHABLE_KEY
```

A legacy public `anon` JWT is supported as `VITE_SUPABASE_ANON_KEY` when a publishable key is unavailable. Remove or comment out `VITE_SUPABASE_PUBLISHABLE_KEY` before using that alternative; leaving its placeholder set will keep configuration unavailable. If both key variables are set, the publishable-key variable takes precedence.

These values are public application configuration. All `VITE_` variables are included in the browser build. **Never put a `service_role` JWT, an `sb_secret_` key, a database password, or an administrative access token in frontend environment variables or source code.** Build-time and runtime checks reject known privileged-key formats in the supported key variables, and the runtime client references only the three documented public configuration fields. These guards do not make it safe to put secrets in frontend variables or source files. RLS and the signed-in user's session enforce access with the public project key.

`.env.local` is ignored by Git. Do not commit real configuration values. Restart Vite after changing environment variables, or rebuild and redeploy when using a production bundle:

```sh
npm ci
npm run dev
```

For a production preview:

```sh
npm run build
npm run preview
```

If your execution environment restricts network destinations, allow your specific project hostname (for example `YOUR_PROJECT_REF.supabase.co`) for HTTPS and secure WebSocket traffic in that environment's network settings. Map tiles are optional and use `tile.openstreetmap.org`; the bundled offline map still shows route coordinates and markers when tiles are blocked. Do not disable TLS verification or use a privileged key to work around a network error.

## 4. Test two observers with simulated cloud telemetry

1. Start the frontend and choose **Supabase cloud** in **Telemetry source**. Missing configuration is shown as setup guidance; it never falls back to local simulated readings while claiming to be cloud-connected.
2. Create an owner account, confirm its email, and sign in. Create a new cloud session with **simulated** provenance and a descriptive label. Session creation also installs default T1 = 0.8 g / T2 = 1.8 g settings for IMUs 1, 2, and 3.
3. Select that session and start its **cloud test drive**. Only the owner can start it, and only for an active session labeled simulated. It uploads GPS about once per second, connection heartbeats about every five seconds, and a sparse threshold event about every ten seconds, cycling through all three IMUs. It never uploads continuous raw IMU samples.
4. In a second browser or private window, either sign in to the same owner account for a quick observation test, or create a separate observer account and confirm its email. For the separate account, use the owner's sharing control to grant that email access, then sign in as the observer. The observer should see the same route and new events without receiving write controls.
5. Keep the test drive running in only one browser. Check the route and marker in the second browser, then reload it: the session, route, and recorded events should reload from the database. The Realtime subscription receives changes, and the dashboard refetches on reconnect and periodically reconciles state.
6. Verify each IMU's configured T1/T2 values. Owner changes are persisted, but are **configuration records**, not proof that a future ESP32 received them. Saving thresholds stops the test drive. Start it again to use the new threshold snapshot. Recorded events retain their original threshold snapshots and severity.
7. Stop the cloud test drive. The latest GPS becomes stale after five seconds and the gateway heartbeat after fifteen seconds. A historical route remains viewable, but an old packet does not claim a live vehicle or green IMU status. Stopping does not fabricate a device-disconnected packet; the heartbeat expires naturally.
8. Finish the session and confirm it remains in history after refresh or signing out and back in. Try signing in as an unrelated account: the session must not appear. Revoke a shared observer and verify a subsequent refresh/reconciliation removes their access.

A browser may retain data it already downloaded; revocation prevents subsequent authorized reads and the UI clears inaccessible session data when it detects the change. It cannot erase screenshots or previously exported files.

The test uploader is a development tool with a bounded, in-memory retry queue. It serializes requests, preserves packet identities during retries, and surfaces failures. On stop it drops unsent queued packets and permits an already-started request to finish. It is not a phone application's durable offline outbox.

## 5. Verify availability and safety semantics

Cloud GPS availability, gateway connection status, Realtime subscription status, and IMU impact history are separate signals:

- The current GPS position is chosen using source `recorded_at` time, not arrival time. A just-uploaded old point stays historical. GPS older than five seconds is stale.
- Gateway status comes from its latest sequence-numbered connection packet. A heartbeat older than fifteen seconds does not establish current connectivity.
- A connected observer WebSocket is a connection to Supabase, not evidence that the phone, vehicle, or IMUs are currently transmitting.
- Event-only IMU cards remain **unknown/gray** for current motion. A recent warning/critical event is a historical report. No events, fresh GPS, and a healthy heartbeat do not confirm a current green acceleration state.
- Where acceleration is actually known, the rule remains **green A < T1; yellow T1 ≤ A ≤ T2; red A > T2**. Both exact thresholds are yellow.

The driver phone application and ESP32-S3 firmware are not implemented here. The ESP32-S3 will retain complete raw IMU data locally; a later authenticated phone gateway will upload GPS and threshold packets using the protocol in [TELEMETRY_PROTOCOL.md](TELEMETRY_PROTOCOL.md).

## Troubleshooting

| Symptom                             | Check                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Cloud setup guidance appears        | Replace both placeholders in `.env.local` and restart Vite; verify a public publishable/anon key is used                         |
| Email sign-in fails                 | Confirm the account's email, project, password, and enabled email provider                                                       |
| Confirmation returns to a wrong URL | Update Auth Site URL/redirect settings and use the same browser for the PKCE confirmation flow                                   |
| Session list is empty               | Create an owned session, or ask its owner to share it with your confirmed account's email                                        |
| RPC/table is missing                | Apply the full migration to the same project used by the frontend                                                                |
| Data loads but live changes do not  | Verify the `supabase_realtime` publication, project Realtime status, WebSocket network access, and authenticated SELECT policies |
| New uploads fail after finishing    | Only packets recorded within the session's original start/end window can be accepted; new post-session telemetry is rejected     |
| A retry does not alter a row        | Expected: immutable duplicate UUIDs/sequences are first-write wins; upload a new packet rather than editing history              |
| Old data appears gray               | Expected for stale source timestamps; a new `received_at` time does not make old telemetry live                                  |

## What has and has not been validated

The repository includes tests that execute the actual migration in PostgreSQL via PGlite with test-only auth roles/users; service/domain tests use controlled inputs; browser tests use simulated Supabase HTTP and Realtime fixtures. They run without project credentials. These checks validate the implementation, SQL constraints/RLS, and client behavior but do **not** establish that your hosted project, email delivery, or network policy is configured correctly. Complete the two-observer checklist above against your own project before relying on hosted operation.
