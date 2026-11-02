/* MSD Observer requires a network connection.
 * Deliberately no fetch handler, Cache API, precache or offline fallback.
 * Supabase HTTPS/Auth and Realtime WebSockets go directly to the network.
 * Do not add runtime caching of telemetry or authenticated responses here.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
