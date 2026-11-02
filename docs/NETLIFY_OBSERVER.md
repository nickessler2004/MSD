# Deploy MSD Observer to Netlify and install on iPhone

This is the existing React/Vite observer dashboard, not the phone gateway. Observers use Supabase HTTPS and Realtime (secure WebSockets); Bluetooth and location permissions are not needed. Authentication and the existing owner/observer authorization rules still apply. A public website URL does not grant access to session records.

## What this PR configures

- Netlify builds the repository root using `npm run build` and serves `dist`, with Node 24. No server or database migration is needed.
- Netlify builds open in cloud mode (`VITE_OBSERVER_DEFAULT_SOURCE=cloud`). Local development and the standalone design demo retain their existing simulator defaults. The source selector remains available and clearly labels simulation.
- All unknown paths fall back to `index.html` without overriding existing files. The application currently selects views in its own state; a direct path opens the authenticated application but does not select a particular session or create a new URL router.
- Manifest identity and launch URL are `/`; app name is **MSD Observer**, display is standalone, with opaque 180px Apple touch, 192px, 512px and maskable PNG icons. iOS status bar uses the standard black style without extending dashboard content under the notch.
- The service worker has **no fetch handler**, precache, Cache API writes, offline page or background sync. It never stores/replays auth, GPS, IMU events, session history or API responses. Realtime is not intercepted. HTML/manifest/worker use `Cache-Control: no-store`; fingerprinted static assets can use immutable browser caching. The current screen may retain labeled historical records when connection is lost, but existing offline handling removes live GPS confirmation and marks live updates unconfirmed. Initial loading offline fails normally; this is not an offline telemetry application.
- Existing loading, missing-configuration, failed-authentication, disconnected, stale and unavailable states remain in place. On returning from the background, observe the source timestamps/freshness indicators; do not treat an open app as proof that telemetry is live.

## Manual Netlify steps

1. Merge this PR only after review. Sign up for Netlify's free plan and choose **Add new project / Import an existing project**, then **GitHub**. Grant access to this repository (`nickessler2004/MSD`). You do not need to grant access to other repositories.
2. Select production branch **main**. Leave the base directory at the repository root (blank or `.`), not `mobile`. Confirm build command **`npm run build`** and publish directory **`dist`**. `netlify.toml` supplies those settings and Node 24.
3. Before the first usable deployment, add these build environment variables in Netlify's project environment settings:
   - `VITE_SUPABASE_URL`: your existing HTTPS Supabase project URL.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: your existing public `sb_publishable_…` key from Supabase Project Settings / API Keys.
     Scope them to **Production** initially. Vite embeds them in the browser bundle; these two values are intentionally public. Existing database authorization protects the records. Never add a service-role/secret key, a user's JWT, passwords, private test credentials or any test account variables. Do not paste an entire local environment file into Netlify.
4. Deploy. Confirm the build succeeds. If variables were added after a build, trigger a new deployment because Vite reads them at build time. The build rejects privileged keys in the Supabase frontend key settings.
5. Choose the final Netlify site name (for example `https://YOUR-SITE.netlify.app`) before changing Supabase URLs. Netlify supplies HTTPS automatically. Leave Git-connected automatic production deploys enabled for **main**; future merges will deploy automatically. Do not connect the mobile gateway as another Netlify application.
6. Optional: disable deploy previews/branch deploys, or keep them without production configuration. Only give Supabase configuration to a trusted preview after deliberate review; do not add broad preview URL wildcards to Auth just for convenience.

Netlify's free plan has usage limits; monitor its usage dashboard. No paid Netlify features are required by this configuration. This PR does not provision an account, publish a site, change database access or alter Supabase settings for you.

## Manual Supabase steps after the final domain is known

1. In the existing Supabase project, open **Authentication → URL Configuration**.
2. Set **Site URL** to the final HTTPS origin, for example `https://YOUR-SITE.netlify.app`.
3. Add the exact root callback URL `https://YOUR-SITE.netlify.app/` to **Redirect URLs**. If you later add a dedicated auth callback route, add its exact URL too. Repeat with the exact custom domain if you later use one. Retain existing localhost or gateway callbacks only where still needed; do not break the phone gateway's configured callbacks.
4. Keep email confirmation enabled according to your existing policy. Password sign-in itself does not redirect, but signup confirmation and auth email links use the configured Site URL. Test an auth email link in Safari after changing the domain. Existing app flows are unchanged; this PR does not add OAuth or password recovery screens.
5. Do **not** change database policies, schema, anonymous permissions, Realtime publication or API access. Use existing owner/observer session sharing to authorize each observer. A publishable key is not an authorization bypass. Never disable RLS to fix a login or empty-session problem.

## Install and verify on iPhone

1. Open the final HTTPS URL in **Safari**, not an embedded Messages browser. Sign in with an authorized observer account. Confirm the shared session is available.
2. Tap **Share → Add to Home Screen** (on current iOS this may be under **More**). Keep the name **MSD Observer**. Enable **Open as Web App** if offered, then tap **Add**.
3. Launch the new icon. It should open without Safari's normal address bar. Sign in again if the Home Screen app has a separate auth session from Safari. Existing password/session handling is unchanged.
4. Check live GPS, historical IMU events, event analysis and session history. Rotate the phone and scroll; verify controls and tables remain usable. No Bluetooth prompt should appear.
5. With the app open, turn on Airplane Mode. Live updates must become unconfirmed and GPS unavailable; IMUs must not become green from silence. Historical records may remain labeled historical. Restore connectivity and use **Refresh records** if needed. Fresh source timestamps must return before treating GPS as live.
6. Close the app, go offline and launch it again: no offline dashboard is promised. Reconnect to sign in or load records. Sign out when finished on a shared device.
7. On a computer, open the same HTTPS address and use the existing authorized sign-in. Install prompts vary by browser; installation is optional.

Before relying on production, test with both an owner and an observer: observer can read shared records but cannot configure thresholds or share sessions; an unrelated account cannot read the session. Use existing authorized data for manual read checks rather than uploading synthetic records to production.

## Verification commands

```sh
npm ci
npm run format:check
npm run build
npm run build:demo
npm test
npm run test:e2e
npm run test:pwa
cd mobile
npm ci
npm run typecheck
npm test
```

`test:e2e` preserves the existing auth, role, realtime, GPS, event, history, offline and responsive coverage. `test:pwa` builds a production bundle using explicitly nonfunctional browser fixture configuration, then checks manifest/iOS metadata, PNG sizes, direct navigation/refresh, actual worker control, sign-in/persistence/sign-out, read-only observer controls, events/history, offline/recovery, mobile overflow and empty Cache Storage. It uses its own output directory and port; never launch two Playwright commands using the same output directory, because each runner cleans its output directory on startup. Run the listed commands sequentially. The test fixture build is not a production deployment; Netlify builds from source using its configured production values.

Automated browser checks use Chromium at iPhone-sized viewports. They do not certify physical iPhone/Safari installation, iOS background suspension or auth email delivery. Complete the Safari steps above on a real iPhone after deployment. The exact final domain cannot be supplied until you create/rename the Netlify project.
