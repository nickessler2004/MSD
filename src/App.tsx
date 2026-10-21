import { useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gauge,
  LayoutDashboard,
  MapPin,
  MoreHorizontal,
  Navigation,
  Play,
  Plus,
  Route,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { Stat } from "./components/StatCard";
import { Sparkline } from "./components/Sparkline";
import { EventTable } from "./components/EventTable";
import { SessionTable } from "./components/SessionTable";
import { ThresholdDialog } from "./components/ThresholdDialog";
import { time, date, duration } from "./lib/format";
import { VehicleMap } from "./components/VehicleMap";
import { ROUTE_COORDINATES } from "./services/telemetry";
import { useMonitor } from "./hooks/useMonitor";

type Page = "overview" | "events" | "sessions";
const pageNames: Record<Page, string> = {
  overview: "Vehicle overview",
  events: "Impact events",
  sessions: "Driving sessions",
};

export default function App() {
  const monitor = useMonitor();
  const [page, setPage] = useState<Page>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState("all");
  const [helpOpen, setHelpOpen] = useState(false);
  const {
    available,
    sample,
    severity,
    thresholds,
    session,
    events,
    sessions,
    now,
    history,
  } = monitor;
  const magnitude = Math.hypot(
    sample.acceleration.x,
    sample.acceleration.y,
    sample.acceleration.z,
  );
  const labels = {
    normal: "All systems normal",
    warning: "Moderate impact detected",
    critical: "High impact detected",
    unavailable: "Waiting for data",
  };
  const statusDescriptions = {
    normal: "A smooth ride. Acceleration is within your safety thresholds.",
    warning:
      "Acceleration reached your warning threshold. An event has been logged.",
    critical:
      "Acceleration reached your critical threshold. An event has been logged.",
    unavailable:
      "The data feed is disconnected. Reconnect to resume live monitoring.",
  };
  const currentEvents = events.filter((e) => e.sessionId === session.id);
  const filteredEvents = events.filter(
    (e) => eventFilter === "all" || e.severity === eventFilter,
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
          aria-label="MSD Impact Monitor home"
        >
          <span className="brand-mark">
            <Activity size={25} strokeWidth={2.4} />
          </span>
          <span>
            <strong>
              MSD<span className="brand-dot">.</span>
            </strong>
            <small>IMPACT MONITOR</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-symbol">
            <Navigation size={16} />
          </span>
          <div>
            <strong>Demo workspace</strong>
            <span>Vehicle monitoring</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "overview" ? "nav-item active" : "nav-item"}
            aria-current={page === "overview" ? "page" : undefined}
            onClick={() => setPage("overview")}
          >
            <LayoutDashboard size={18} />
            Overview
          </button>
          <button
            className={page === "events" ? "nav-item active" : "nav-item"}
            aria-current={page === "events" ? "page" : undefined}
            onClick={() => setPage("events")}
          >
            <Activity size={18} />
            Impact events<span className="nav-count">{events.length}</span>
          </button>
          <button
            className={page === "sessions" ? "nav-item active" : "nav-item"}
            aria-current={page === "sessions" ? "page" : undefined}
            onClick={() => setPage("sessions")}
          >
            <Route size={18} />
            Driving sessions
          </button>
        </nav>
        <div className="nav-label system-label">MANAGE</div>
        <button className="nav-item" onClick={() => setSettingsOpen(true)}>
          <SlidersHorizontal size={18} />
          Threshold settings
        </button>
        <button className="nav-item" onClick={monitor.exportData}>
          <ArrowDownToLine size={18} />
          Export data
        </button>
        <div className="sidebar-bottom">
          <div className="simulation-note">
            <span className="simulation-note-icon">
              <Sparkles size={18} />
            </span>
            <strong>A safe space to explore.</strong>
            <p>
              You’re viewing simulated vehicle data. Take it for a test drive.
            </p>
            <span>
              <i />
              SIMULATION MODE
            </span>
          </div>
          <button
            className="nav-item help-button"
            onClick={() => setHelpOpen(!helpOpen)}
          >
            <CircleHelp size={18} />
            About this prototype
            <ChevronRight size={15} />
          </button>
          <div className="sidebar-footer">
            <span className="avatar">DM</span>
            <div>
              <strong>Demo environment</strong>
              <span>MSD · Prototype v0.1</span>
            </div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="simulation-chip">
              <span />
              Simulation mode
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="View impact events"
              onClick={() => setPage("events")}
            >
              <Bell size={19} />
              {currentEvents.length > 0 && <i className="notification-dot" />}
            </button>
            <span className="avatar top-avatar">DM</span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div className="heading-eyebrow">
              <span />
              VEHICLE INTELLIGENCE
            </div>
            <div className="heading-main">
              <div>
                <h1>
                  {page === "overview"
                    ? "Every journey, in focus."
                    : pageNames[page]}
                </h1>
                <p>
                  {page === "overview"
                    ? "Real-time motion. Meaningful insights. A safer road ahead."
                    : page === "events"
                      ? "A closer look at the moments that matter on the road."
                      : "Your driving activity, all in one place."}
                </p>
              </div>
              <button className="button primary" onClick={monitor.newSession}>
                <Plus size={17} />
                New session
              </button>
            </div>
          </section>
          <section className="stats-grid" aria-label="Session statistics">
            <Stat
              icon={Clock3}
              label="Current session"
              value={duration(now - session.startedAt)}
              detail={
                available
                  ? "Live session · Recording"
                  : "Session active · Feed disconnected"
              }
              badge={available ? "LIVE" : undefined}
            />
            <Stat
              icon={Route}
              label="Distance traveled"
              value={session.distanceKm.toFixed(2)}
              suffix="km"
              detail="Distance in this session"
            />
            <Stat
              icon={Zap}
              label="Impacts detected"
              value={String(session.impactCount).padStart(2, "0")}
              detail={
                session.impactCount
                  ? "Threshold crossings this session"
                  : "A smooth start to your journey"
              }
              tone={session.impactCount ? "text-warning" : ""}
            />
            <Stat
              icon={available ? Wifi : WifiOff}
              label="Telemetry signal"
              value={available ? "Connected" : "No data"}
              detail={
                available
                  ? "Simulated stream · Updates at 2 Hz"
                  : "Simulated data feed is turned off"
              }
              tone={available ? "text-green" : "text-muted"}
            />
          </section>
          {page === "overview" && (
            <>
              <div className="monitor-grid">
                <section className="card map-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <MapPin size={18} />
                        Live location
                      </h2>
                      <p>San Francisco, California</p>
                    </div>
                    <span
                      className={`live-badge ${!available ? "offline" : ""}`}
                    >
                      <i />
                      {available ? "LIVE GPS" : "NO GPS DATA"}
                    </span>
                  </div>
                  <VehicleMap
                    position={available ? sample.position : null}
                    heading={sample.heading}
                    events={currentEvents}
                    route={ROUTE_COORDINATES}
                    available={available}
                  />
                  <div className="map-footer">
                    <span>
                      <Navigation size={14} />
                      <strong>Demo vehicle</strong>
                      <span className="muted-dot">·</span>MSD-001
                    </span>
                    <span>
                      <Gauge size={14} />
                      <strong>
                        {available ? Math.round(sample.speedKph) : "—"}
                      </strong>{" "}
                      km/h
                    </span>
                  </div>
                </section>
                <section className={`card status-card status-${severity}`}>
                  <div className="card-heading">
                    <div>
                      <h2>
                        <ShieldCheck size={18} />
                        Impact status
                      </h2>
                      <p>Live acceleration assessment</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Configure impact thresholds"
                      onClick={() => setSettingsOpen(true)}
                    >
                      <Settings2 size={17} />
                    </button>
                  </div>
                  <div className="status-content">
                    <div
                      className="traffic-light"
                      aria-label={`${severity} status`}
                    >
                      <span
                        className={`light green ${severity === "normal" ? "lit" : ""}`}
                      >
                        <Check size={24} />
                      </span>
                      <span
                        className={`light yellow ${severity === "warning" ? "lit" : ""}`}
                      >
                        <TriangleAlert size={23} />
                      </span>
                      <span
                        className={`light red ${severity === "critical" ? "lit" : ""}`}
                      >
                        <Zap size={23} />
                      </span>
                    </div>
                    <span className="status-overline">
                      {severity === "unavailable"
                        ? "SIGNAL UNAVAILABLE"
                        : severity === "normal"
                          ? "YOU’RE IN THE GREEN"
                          : "THRESHOLD EXCEEDED"}
                    </span>
                    <div role="status" aria-live="polite">
                      <h3>{labels[severity]}</h3>
                    </div>
                    <p>{statusDescriptions[severity]}</p>
                    <div className="resultant">
                      <span>Resultant acceleration</span>
                      <strong>
                        {available ? magnitude.toFixed(2) : "—"}
                        <small> g</small>
                      </strong>
                    </div>
                  </div>
                  <button
                    className="threshold-summary"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <span>
                      <i className="warning-dot" />
                      T1 <strong>{thresholds.t1.toFixed(1)} g</strong>
                    </span>
                    <span>
                      <i className="critical-dot" />
                      T2 <strong>{thresholds.t2.toFixed(1)} g</strong>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                </section>
              </div>
              <section className="card imu-card">
                <div className="card-heading">
                  <div>
                    <h2>
                      <Activity size={18} />
                      Motion at a glance
                    </h2>
                    <p>Three-axis linear acceleration · Gravity removed</p>
                  </div>
                  <span className="unit-label">
                    LAST 24 SECONDS <span>·</span> g
                  </span>
                </div>
                <div className="axes-grid">
                  {(["x", "y", "z"] as const).map((axis, i) => (
                    <article className={`axis axis-${axis}`} key={axis}>
                      <div className="axis-meta">
                        <span className="axis-label">{axis.toUpperCase()}</span>
                        <span>
                          {["Longitudinal", "Lateral", "Vertical"][i]}
                        </span>
                        <span
                          className={`axis-live ${available ? "" : "axis-offline"}`}
                        />
                      </div>
                      <div className="axis-reading">
                        {available
                          ? `${sample.acceleration[axis] >= 0 ? "+" : ""}${sample.acceleration[axis].toFixed(2)}`
                          : "—"}
                        <span>g</span>
                      </div>
                      <Sparkline
                        values={
                          available
                            ? history.map((s) => s.acceleration[axis])
                            : []
                        }
                        axis={axis}
                      />
                      <div className="axis-chart-footer">
                        <span>24s ago</span>
                        <span>Now</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <div className="bottom-grid">
                <section className="card events-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <Zap size={18} />
                        Recent impacts
                        <span className="count-badge">{events.length}</span>
                      </h2>
                      <p>Timestamped moments, with location context</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("events")}
                    >
                      View all
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  <EventTable events={events} compact />
                </section>
                <section className="card session-summary">
                  <div className="card-heading">
                    <div>
                      <h2>
                        <Route size={18} />
                        Session history
                      </h2>
                      <p>Recent driving activity</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="View all driving sessions"
                      onClick={() => setPage("sessions")}
                    >
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="mini-sessions">
                    {sessions.slice(0, 3).map((s) => (
                      <button
                        className="mini-session"
                        key={s.id}
                        onClick={() => setPage("sessions")}
                      >
                        <span className="mini-route">
                          <Route size={17} />
                        </span>
                        <div>
                          <strong>
                            {date(s.startedAt)}
                            <span>{time(s.startedAt).slice(0, 5)}</span>
                          </strong>
                          <small>
                            {s.distanceKm.toFixed(1)} km <span>·</span>{" "}
                            {Math.round(
                              ((s.endedAt ?? now) - s.startedAt) / 60000,
                            )}{" "}
                            min
                          </small>
                        </div>
                        <span
                          className={`session-impact-count ${s.impactCount ? "has-impacts" : ""}`}
                        >
                          {s.impactCount
                            ? `${s.impactCount} impacts`
                            : "Smooth ride"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="all-sessions"
                    onClick={() => setPage("sessions")}
                  >
                    Explore driving history
                    <ArrowRight size={14} />
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "events" && (
            <section className="card full-table-card">
              <div className="card-heading">
                <div>
                  <h2>
                    <Zap size={18} />
                    Impact event log
                    <span className="count-badge">{filteredEvents.length}</span>
                  </h2>
                  <p>
                    Events retain the severity recorded at the time of impact.
                  </p>
                </div>
                <label className="filter-select">
                  <SlidersHorizontal size={14} />
                  <select
                    aria-label="Filter impact events"
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value)}
                  >
                    <option value="all">All severities</option>
                    <option value="warning">Moderate</option>
                    <option value="critical">High impact</option>
                  </select>
                </label>
              </div>
              <EventTable events={filteredEvents} />
            </section>
          )}
          {page === "sessions" && (
            <section className="card full-table-card">
              <div className="card-heading">
                <div>
                  <h2>
                    <Route size={18} />
                    Driving session history
                  </h2>
                  <p>
                    Start a new session to save the current drive. History is
                    kept for this browser visit.
                  </p>
                </div>
                <span className="unit-label">
                  {sessions.length + 1} SESSIONS
                </span>
              </div>
              <SessionTable sessions={[session, ...sessions]} now={now} />
            </section>
          )}
          <section className="demo-controls" aria-label="Simulation controls">
            <div className="demo-controls-title">
              <span className="demo-icon">
                <Play size={15} fill="currentColor" />
              </span>
              <div>
                <strong>Your virtual test drive</strong>
                <span>Explore the dashboard with simulated data.</span>
              </div>
            </div>
            <div className="demo-actions">
              <label className="feed-toggle">
                <span>Data feed</span>
                <button
                  role="switch"
                  aria-checked={available}
                  aria-label="Simulated data feed"
                  onClick={() => monitor.setAvailable(!available)}
                  className={`switch ${available ? "on" : ""}`}
                >
                  <span />
                </button>
              </label>
              <span className="control-divider" />
              <button
                className="button simulate-button"
                onClick={monitor.simulateImpact}
                disabled={!available}
              >
                <Zap size={15} />
                Simulate impact
              </button>
            </div>
          </section>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Simulation only. No hardware or cloud connection.
            </span>
            <span>
              MSD Impact Monitor <span className="muted-dot">/</span> Prototype
              0.1
            </span>
          </footer>
        </main>
      </div>
      {settingsOpen && (
        <ThresholdDialog
          value={thresholds}
          onSave={monitor.setThresholds}
          onClose={() => setSettingsOpen(false)}
        />
      )}{" "}
      {monitor.notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {monitor.notice}
        </div>
      )}
      {helpOpen && (
        <div className="about-panel">
          <button
            className="icon-button"
            aria-label="Close about panel"
            onClick={() => setHelpOpen(false)}
          >
            <X size={18} />
          </button>
          <span className="heading-eyebrow">BUILT FOR THE ROAD AHEAD</span>
          <h2>Meet your impact monitor.</h2>
          <p>
            This prototype simulates a vehicle driving around San Francisco.
            Acceleration is measured in g, with gravity removed. Warning and
            critical thresholds determine the traffic light and impact log.
          </p>
          <p>
            Use the data feed switch to test missing data, or inject an impact
            to see an alert. Sessions and changes are in memory and reset on
            refresh; export JSON to keep a copy.
          </p>
          <p className="about-footnote">
            The live session and labeled historical records are all simulated.
            GPS coordinates do not represent a real driver.
          </p>
        </div>
      )}
    </div>
  );
}
