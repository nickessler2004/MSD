/** Registration is optional: a failed worker must never block auth or telemetry. */
export function registerObserverPwa() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // Online dashboard functionality does not depend on this worker.
        });
    });
  }
}
