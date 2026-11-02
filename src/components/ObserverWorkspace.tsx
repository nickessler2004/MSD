import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  LayoutDashboard,
  List,
  MapPin,
  Settings2,
  RefreshCw,
} from "lucide-react";
import type { CloudSession, CloudSnapshot, GpsPoint } from "../domain/cloud";
import { routeDistanceKm } from "../domain/cloudRecords";
import type { AnalysisEvent } from "../domain/eventAnalysis";
import { duration } from "../lib/format";
import { ObserverInstruments } from "./ObserverInstruments";
import { ViewButtons } from "./WorkspaceViews";
import { WorkspaceRecords, type RecordRequest } from "./WorkspaceRecords";
import "./ObserverWorkspace.css";
import { WorkspaceGuide } from "./WorkspaceGuide";

type Screen = "overview" | "gps" | "imus" | "events" | "settings";
type Setting = "new" | "sharing" | "account" | "tools" | "help";
type Props = {
  snapshot: CloudSnapshot | null;
  sessions: CloudSession[];
  selectedId: string | null;
  userId: string;
  now: number;
  online: boolean;
  loading: boolean;
  gps: GpsPoint[];
  fix: GpsPoint | null;
  gpsLive: boolean;
  events: AnalysisEvent[];
  realtimeStatus: string;
  gatewayState: string;
  error: string | null;
  notice: string;
  busy: boolean;
  onRefresh: () => void;
  onSelectSession: (id: string) => void;
  onExport: () => void;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  map: ReactNode;
  imuPanel: ReactNode;
  selectedImu: string;
  onSelectImu: (id: string) => void;
  settings: {
    session: ReactNode;
    thresholds: ReactNode;
    sharing: ReactNode;
    account: ReactNode;
    tools: ReactNode;
  };
};
export function ObserverWorkspace(p: Props) {
  const [viewport, setViewport] = useState(() => ({
    height:
      window.visualViewport?.scale === 1
        ? window.visualViewport.height
        : window.innerHeight,
    keyboard: false,
  }));
  useEffect(() => {
    const update = () => {
      const height =
        window.visualViewport?.scale === 1
          ? window.visualViewport.height
          : window.innerHeight;
      setViewport({
        height,
        keyboard:
          document.activeElement instanceof HTMLInputElement &&
          height < window.innerHeight - 100,
      });
    };
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusout", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("observer-screen-fit");
    return () =>
      document.documentElement.classList.remove("observer-screen-fit");
  }, []);
  const [screen, setScreen] = useState<Screen>("overview");
  const [gpsView, setGpsView] = useState<
    "map" | "speed" | "accuracy" | "details"
  >("map");
  const [imuView, setImuView] = useState("current");
  const [setting, setSetting] = useState<Setting>("account");
  const [request, setRequest] = useState<RecordRequest | null>(null);
  const [showMessages, setShowMessages] = useState(false),
    [messagePage, setMessagePage] = useState(0);
  function navigate(view: Screen) {
    if (document.activeElement instanceof HTMLInputElement)
      document.activeElement.blur();
    setScreen(view);
    setShowMessages(false);
  }
  function openRecords(view: "report" | "history", imu?: string) {
    setRequest((old) => ({ view, imu, serial: (old?.serial ?? 0) + 1 }));
    navigate("events");
  }
  const current = p.snapshot?.session.id === p.selectedId ? p.snapshot : null;
  const connected = !p.online
    ? "Offline · Live updates unconfirmed"
    : p.error
      ? "Connection error · Live updates unconfirmed"
      : p.realtimeStatus === "subscribed"
        ? "Realtime connected"
        : p.realtimeStatus === "connecting"
          ? "Connecting realtime…"
          : "Realtime unavailable · Refreshing every 10s";
  const gpsAge = p.fix
    ? `${Math.max(0, Math.floor((p.now - Date.parse(p.fix.recorded_at)) / 1000))}s ago`
    : "Never received";
  const message =
    [p.error, p.notice].filter(Boolean).join("\n") || "No messages.";
  const chunks = message.match(/[\s\S]{1,240}/g) || ["No messages."];
  const messageIndex = Math.min(messagePage, chunks.length - 1);
  return (
    <div
      className="observer-workspace"
      data-screen={screen}
      data-keyboard={viewport.keyboard}
      style={{ height: viewport.height }}
    >
      <header className="ws-header">
        {viewport.keyboard && (
          <button
            className="ws-done-editing"
            onClick={() => {
              if (document.activeElement instanceof HTMLElement)
                document.activeElement.blur();
            }}
          >
            Done editing
          </button>
        )}
        <div>
          <h1>
            MSD Observer{" "}
            <span className="ws-source">
              {current?.session.data_source === "simulated"
                ? "SIMULATED"
                : current
                  ? "DEVICE"
                  : ""}
            </span>
          </h1>
          <button
            className="ws-session-name"
            title={current?.session.label}
            onClick={() => openRecords("history")}
          >
            {current?.session.label || "Choose a session"}
          </button>
        </div>
        <button
          aria-label="Refresh records"
          disabled={p.busy}
          onClick={p.onRefresh}
        >
          <RefreshCw size={18} />
        </button>
        <button
          aria-label={p.error || p.notice ? "Open messages" : "Open guide"}
          aria-expanded={showMessages}
          onClick={() => {
            if (p.error || p.notice) {
              setShowMessages((v) => !v);
              setMessagePage(0);
            } else {
              navigate("settings");
              setSetting("help");
            }
          }}
        >
          {p.error ? "Error" : p.notice ? "Message" : "Info"}
        </button>
      </header>
      <div className="ws-connection" aria-label="Connection and GPS status">
        <span role="status">{connected}</span>
        <small>
          {p.gpsLive ? `GPS ${gpsAge}` : "GPS unavailable"} ·{" "}
          {p.gatewayState === "fresh" &&
          p.online &&
          !p.error &&
          !current?.session.ended_at
            ? "Gateway recent"
            : "Gateway unconfirmed"}
        </small>
      </div>
      <main className="ws-main">
        {showMessages ? (
          <>
            <h2>Messages</h2>
            <section className="ws-panel ws-message" aria-label="Full messages">
              <p role={p.error ? "alert" : undefined}>{chunks[messageIndex]}</p>
              <div className="ws-pager">
                <button
                  disabled={messageIndex === 0}
                  onClick={() => setMessagePage(messageIndex - 1)}
                >
                  Previous
                </button>
                <span>
                  {messageIndex + 1} / {chunks.length}
                </span>
                <button
                  disabled={messageIndex + 1 >= chunks.length}
                  onClick={() => setMessagePage(messageIndex + 1)}
                >
                  Next
                </button>
                <button onClick={() => setShowMessages(false)}>Close</button>
              </div>
            </section>
          </>
        ) : (
          <>
            {screen === "overview" && (
              <section
                className="ws-panel ws-session-overview"
                aria-label="Session overview"
              >
                {current ? (
                  <>
                    <h2>{current.session.label}</h2>
                    <dl className="ws-facts">
                      <div>
                        <dt>Status</dt>
                        <dd>
                          {current.session.ended_at ? "Completed" : "Active"}
                        </dd>
                      </div>
                      <div>
                        <dt>Access</dt>
                        <dd>
                          {current.session.owner_id === p.userId
                            ? "Owner"
                            : "Read-only observer"}
                        </dd>
                      </div>
                      <div>
                        <dt>Started</dt>
                        <dd>
                          {new Date(
                            current.session.started_at,
                          ).toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>Finished</dt>
                        <dd>
                          {current.session.ended_at
                            ? new Date(
                                current.session.ended_at,
                              ).toLocaleString()
                            : "In progress"}
                        </dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>
                          {duration(
                            (current.session.ended_at
                              ? Date.parse(current.session.ended_at)
                              : p.now) - Date.parse(current.session.started_at),
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Recorded route</dt>
                        <dd>
                          {p.gps.length
                            ? `${routeDistanceKm(p.gps).toFixed(2)} km`
                            : "Not supplied"}
                        </dd>
                      </div>
                      <div>
                        <dt>Stored GPS fixes</dt>
                        <dd>{p.gps.length}</dd>
                      </div>
                      <div>
                        <dt>Threshold reports</dt>
                        <dd>{p.events.length}</dd>
                      </div>
                    </dl>
                    <div className="ws-actions">
                      <button aria-label="Export session" onClick={p.onExport}>
                        Export
                      </button>
                      <button
                        aria-label="Choose a session"
                        onClick={() => openRecords("history")}
                      >
                        Sessions
                      </button>
                      <button
                        aria-label="View session events"
                        onClick={() => openRecords("report")}
                      >
                        Reports
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>
                      {p.loading
                        ? "Loading authorized records…"
                        : "Choose a session"}
                    </h2>
                    <button onClick={() => openRecords("history")}>
                      Find sessions
                    </button>
                    <button
                      onClick={() => {
                        navigate("settings");
                        setSetting("new");
                      }}
                    >
                      Create a session
                    </button>
                  </>
                )}
              </section>
            )}
            {screen === "gps" && (
              <>
                <ViewButtons
                  label="GPS views"
                  value={gpsView}
                  options={[
                    ["map", "Map"],
                    ["speed", "Speed"],
                    ["accuracy", "Accuracy"],
                    ["details", "Fix details"],
                  ]}
                  onChange={setGpsView}
                />
                <section
                  className="ws-panel ws-map"
                  data-gps={gpsView}
                  aria-label="GPS instruments"
                >
                  {gpsView === "map" ? (
                    p.map
                  ) : gpsView === "details" ? (
                    <div className="ws-fix-details">
                      <h2>Last recorded GPS fix</h2>
                      <p>
                        {p.gpsLive
                          ? "Recent source fix"
                          : "Historical / unavailable · Not live"}
                      </p>
                      <dl className="ws-facts">
                        <div>
                          <dt>Position</dt>
                          <dd>
                            {p.fix
                              ? `${p.fix.latitude.toFixed(6)}, ${p.fix.longitude.toFixed(6)}`
                              : "Not supplied"}
                          </dd>
                        </div>
                        <div>
                          <dt>Heading</dt>
                          <dd>
                            {p.fix?.heading != null
                              ? `${p.fix.heading}°`
                              : "Not supplied"}
                          </dd>
                        </div>
                        <div>
                          <dt>Source time</dt>
                          <dd>
                            {p.fix
                              ? new Date(p.fix.recorded_at).toLocaleString()
                              : "Not received"}
                          </dd>
                        </div>
                        <div>
                          <dt>Cloud receipt</dt>
                          <dd>
                            {p.fix
                              ? new Date(p.fix.received_at).toLocaleString()
                              : "Not received"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ) : (
                    <ObserverInstruments
                      gps={p.gps}
                      metric={gpsView === "speed" ? "speed_kph" : "accuracy_m"}
                    />
                  )}
                </section>
              </>
            )}
            {screen === "imus" && (
              <>
                <div className="ws-selectors">
                  <label>
                    Sensor
                    <select
                      aria-label="IMU sensor"
                      value={p.selectedImu}
                      onChange={(e) => p.onSelectImu(e.target.value)}
                    >
                      {[1, 2, 3].map((id) => (
                        <option key={id} value={id}>
                          IMU {id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Information
                    <select
                      aria-label="IMU information"
                      value={imuView}
                      onChange={(e) => setImuView(e.target.value)}
                    >
                      <option value="current">Availability</option>
                      <option value="thresholds">Thresholds</option>
                    </select>
                  </label>
                </div>
                <section
                  className={`ws-panel ${imuView === "thresholds" ? "ws-setting ws-imu-thresholds" : "ws-imu"}`}
                  data-imu={p.selectedImu}
                  data-information={imuView}
                >
                  {(imuView === "thresholds"
                    ? p.settings.thresholds
                    : p.imuPanel) || (
                    <p>
                      No session selected. Choose a session in Events → History.
                    </p>
                  )}
                </section>
                <div className="ws-imu-links">
                  <button onClick={() => openRecords("report", p.selectedImu)}>
                    View sensor reports
                  </button>
                  <button
                    onClick={() => {
                      navigate("settings");
                      setSetting("help");
                    }}
                  >
                    Threshold guide
                  </button>
                </div>
              </>
            )}
            <div className="ws-records" hidden={screen !== "events"}>
              <WorkspaceRecords
                {...p}
                active={screen === "events"}
                request={request}
                onSelectSession={(id) => {
                  p.onSelectSession(id);
                  navigate("overview");
                }}
              />
            </div>
            {screen === "settings" && (
              <>
                <label className="ws-setting-select">
                  Settings
                  <select
                    aria-label="Settings panel"
                    value={setting}
                    onChange={(e) => setSetting(e.target.value as Setting)}
                  >
                    <option value="new">New session</option>
                    <option value="sharing">Observers</option>
                    <option value="account">Account & source</option>
                    <option value="tools">Session controls</option>
                    <option value="help">Status & threshold guide</option>
                  </select>
                </label>
                <section className="ws-panel ws-setting" data-setting={setting}>
                  {setting === "help" ? (
                    <WorkspaceGuide />
                  ) : setting === "new" ? (
                    p.settings.session
                  ) : (
                    p.settings[setting] || (
                      <p>
                        No available controls. Choose a session or check your
                        permissions.
                      </p>
                    )
                  )}
                </section>
              </>
            )}
            {p.loading && !current && screen !== "settings" && (
              <span className="ws-loading" role="status">
                Loading authorized records…
              </span>
            )}
          </>
        )}
      </main>
      <nav className="ws-main-nav" aria-label="Observer navigation">
        {(
          [
            ["overview", "Overview", LayoutDashboard],
            ["gps", "GPS", MapPin],
            ["imus", "IMUs", Activity],
            ["events", "Events", List],
            ["settings", "Settings", Settings2],
          ] as const
        ).map(([view, label, Icon]) => (
          <button
            key={view}
            aria-current={screen === view ? "page" : undefined}
            onClick={() => navigate(view)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
