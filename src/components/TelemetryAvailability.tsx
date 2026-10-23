import { Radio, WifiOff } from "lucide-react";
import type {
  DataSource,
  TelemetryFreshness,
  TelemetryMode,
} from "../domain/types";

export function TelemetryAvailability({
  mode,
  onModeChange,
  connected,
  freshness,
  lastReceivedAt,
  lastEventReceivedAt,
  lastEventSource,
  now,
}: {
  mode: TelemetryMode;
  onModeChange: (mode: TelemetryMode | "cloud") => void;
  connected: boolean;
  freshness: TelemetryFreshness;
  lastReceivedAt: number | null;
  lastEventReceivedAt: number | null;
  lastEventSource: DataSource | undefined;
  now: number;
}) {
  const labels = {
    fresh: "Fresh data",
    waiting: "Waiting for first sample",
    stale: "Stale data",
    disconnected: "Disconnected",
  };
  return (
    <section className="telemetry-panel" aria-label="Telemetry availability">
      <div className="source-control">
        <label htmlFor="telemetry-source">Telemetry source</label>
        <select
          id="telemetry-source"
          value={mode}
          onChange={(event) =>
            onModeChange(event.target.value as TelemetryMode | "cloud")
          }
        >
          <option value="simulation">Live simulation</option>
          <option value="event-only">Event-only preview</option>
          <option value="cloud">Supabase cloud</option>
        </select>
      </div>
      <div className="telemetry-health">
        <div
          className={`connection-label ${mode === "simulation" && connected ? "connected" : ""}`}
        >
          {mode === "simulation" && connected ? (
            <Radio size={15} />
          ) : (
            <WifiOff size={15} />
          )}
          <strong>
            {mode === "event-only"
              ? connected
                ? "Device transport connected"
                : "No device connected"
              : connected
                ? "Demo transport connected"
                : "Demo transport disconnected"}
          </strong>
          <span className={`freshness-badge freshness-${freshness}`}>
            {mode === "event-only"
              ? connected
                ? freshness === "fresh"
                  ? "Recent event receipt"
                  : "No recent event receipt"
                : "Device data unavailable"
              : labels[freshness]}
          </span>
        </div>
        <p>
          {mode === "simulation" ? (
            <>
              Last sample received:{" "}
              <strong>
                {lastReceivedAt === null
                  ? "Never"
                  : `${Math.max(0, Math.floor((now - lastReceivedAt) / 1000))}s ago`}
              </strong>{" "}
              · Stale after 5s · All continuous readings are simulated.
            </>
          ) : (
            <>
              Device messages:{" "}
              {lastReceivedAt === null
                ? "Never received"
                : `${Math.max(0, Math.floor((now - lastReceivedAt) / 1000))}s ago`}
              .{" "}
              {lastEventReceivedAt !== null && (
                <>
                  Last {lastEventSource === "device" ? "device" : "test"} event
                  received{" "}
                  {Math.max(0, Math.floor((now - lastEventReceivedAt) / 1000))}s
                  ago.{" "}
                </>
              )}
              Threshold events do not confirm current acceleration. No events
              does not mean a safe drive.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
