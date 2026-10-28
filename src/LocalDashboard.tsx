import { useMemo, useState } from "react";
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
import { EventAnalysis } from "./components/EventAnalysis";
import type { AnalysisEvent } from "./domain/eventAnalysis";
import { TelemetryAvailability } from "./components/TelemetryAvailability";
import type { TelemetryMode } from "./domain/types";
import { useMonitor } from "./hooks/useMonitor";

type Page = "overview" | "events" | "sessions";
const pageNames: Record<Page, string> = {
  overview: "Vehicle overview",
  events: "Impact events",
  sessions: "Driving sessions",
};

export default function LocalDashboard({
  initialMode,
  onCloudMode,
}: {
  initialMode: TelemetryMode;
  onCloudMode: () => void;
}) {
  const monitor = useMonitor(initialMode);
  const [page, setPage] = useState<Page>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const {
    available,
    mode,
    connected,
    freshness,
    sample,
    severity,
    thresholds,
    session,
    events,
    sessions,
    now,
    history,
  } = monitor;
  const isDemo = mode === "simulation";
  const magnitude = sample
    ? Math.hypot(
        sample.acceleration.x,
        sample.acceleration.y,
        sample.acceleration.z,
      )
    : null;
  const labels = {
    normal: "All systems normal",
    warning: "Moderate impact detected",
    critical: "High impact detected",
    unavailable: "Waiting for data",
  };
  const statusDescriptions = {
    normal: "Simulated acceleration is below T1. This is not a device reading.",
    warning:
      "Acceleration reached your warning threshold. An event has been logged.",
    critical:
      "Simulated acceleration is greater than T2. An event has been logged.",
    unavailable:
      "Current motion is unconfirmed. Fresh data is required before a green assessment.",
  };
  const currentEvents = events.filter((e) => e.sessionId === session.id);
  const analysisEvents = useMemo<AnalysisEvent[]>(
    () =>
      events.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        imuId: null,
        severity: e.severity,
        magnitude: e.magnitude,
        position: e.position,
        thresholds: null,
        source:
          e.source === "simulation"
            ? "Simulated"
            : e.source === "test-event"
              ? "Test event"
              : "Device event",
      })),
    [events],
  );
  const reviewSession = [session, ...sessions].find(
    (s) => s.id === reviewSessionId,
  );
  const analysisMap = (
    items: AnalysisEvent[],
    route = monitor.routes[session.id] ?? [],
  ) => (
    <VehicleMap
      position={null}
      heading={0}
      route={route}
      events={items.flatMap((e) =>
        e.position ? [{ ...e, position: e.position }] : [],
      )}
      available={false}
      fitRoute
      selectedEventId={selectedEventId}
      onEventSelect={setSelectedEventId}
      mapLabel="Recorded demo event locations"
    />
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
          aria-label="MSD Observer home"
        >
          <span className="brand-mark">
            <Activity size={25} strokeWidth={2.4} />
          </span>
          <span>
            <strong>
              MSD<span className="brand-dot">.</span>
            </strong>
            <small>OBSERVER</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-symbol">
            <Navigation size={16} />
          </span>
          <div>
            <strong>Local workspace</strong>
            <span>Simulated telemetry</span>
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
            <strong>Local demonstration</strong>
            <p>
              Simulated motion and test events only. No physical device is
              connected.
            </p>
            <span>
              <i />
              {isDemo ? "SIMULATION MODE" : "EVENT-ONLY PREVIEW"}
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
              {isDemo ? "Live simulation" : "Event-only preview"}
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
                  {page === "overview" ? "Observer dashboard" : pageNames[page]}
                </h1>
                <p>
                  {page === "overview"
                    ? isDemo
                      ? "A clear view of every drive. GPS, reported impacts, and session context."
                      : "Threshold events with clear availability and source context."
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
          <TelemetryAvailability
            mode={mode}
            onModeChange={(next) =>
              next === "cloud" ? onCloudMode() : monitor.setMode(next)
            }
            connected={connected}
            freshness={freshness}
            lastReceivedAt={monitor.lastReceivedAt}
            lastEventReceivedAt={monitor.lastEventReceivedAt}
            lastEventSource={monitor.latestEvent?.source}
            now={now}
          />
          <section className="stats-grid" aria-label="Session statistics">
            <Stat
              icon={Clock3}
              label="Current session"
              value={duration(now - session.startedAt)}
              detail={
                available
                  ? "Simulated session · Recording"
                  : isDemo
                    ? "Session active · No fresh data"
                    : "Event-only preview session"
              }
              badge={available ? "LIVE" : undefined}
            />
            <Stat
              icon={Route}
              label="Distance traveled"
              value={session.distanceKm?.toFixed(2) ?? "—"}
              suffix="km"
              detail={
                isDemo
                  ? "Simulated distance in this session"
                  : "Unavailable without continuous GPS"
              }
            />
            <Stat
              icon={Zap}
              label="Impacts detected"
              value={String(session.impactCount).padStart(2, "0")}
              detail={
                session.impactCount
                  ? "Threshold crossings this session"
                  : "No events logged · Safety unconfirmed"
              }
              tone={session.impactCount ? "text-warning" : ""}
            />
            <Stat
              icon={available ? Wifi : WifiOff}
              label="Telemetry signal"
              value={
                !isDemo
                  ? connected
                    ? "Event-only"
                    : "No device"
                  : freshness === "stale"
                    ? "Stale data"
                    : available
                      ? "Connected"
                      : "No data"
              }
              detail={
                available
                  ? "Simulated stream · Updates at 2 Hz"
                  : isDemo
                    ? "No fresh samples · Motion unknown"
                    : "No physical device connection"
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
                        {isDemo ? "Live location" : "Event locations"}
                      </h2>
                      <p>
                        {isDemo
                          ? "San Francisco, California · Simulated GPS"
                          : "Locations from individual event packets only"}
                      </p>
                    </div>
                    <span
                      className={`live-badge ${!available ? "offline" : ""}`}
                    >
                      <i />
                      {!isDemo
                        ? "NO LIVE GPS"
                        : available
                          ? "SIMULATED GPS"
                          : "NO GPS DATA"}
                    </span>
                  </div>
                  {isDemo ? (
                    <VehicleMap
                      position={available && sample ? sample.position : null}
                      heading={sample?.heading ?? 0}
                      events={currentEvents
                        .filter((event) => event.position !== null)
                        .map((event) => ({
                          ...event,
                          position: event.position!,
                        }))}
                      route={monitor.routes[session.id] ?? []}
                      selectedEventId={selectedEventId}
                      onEventSelect={(id) => {
                        setSelectedEventId(id);
                        setPage("events");
                      }}
                      available={available}
                    />
                  ) : (
                    <div className="event-location-panel">
                      <MapPin size={32} />
                      <h3>Event locations only</h3>
                      <p>
                        No live vehicle position is available. GPS appears only
                        when a threshold event supplies a location.
                      </p>
                      <ul aria-label="Event locations">
                        {currentEvents.length === 0 ? (
                          <li>No event locations received</li>
                        ) : (
                          currentEvents.slice(0, 4).map((event) => (
                            <li key={event.id}>
                              {time(event.timestamp)} ·{" "}
                              {event.position
                                ? `${event.position.latitude.toFixed(5)}, ${event.position.longitude.toFixed(5)}`
                                : "GPS not supplied"}
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  )}
                  <div className="map-footer">
                    <span>
                      <Navigation size={14} />
                      <strong>
                        {isDemo ? "Demo vehicle" : "Event-only preview"}
                      </strong>
                      <span className="muted-dot">·</span>
                      {isDemo ? "MSD-001" : "No device"}
                    </span>
                    <span>
                      <Gauge size={14} />
                      <strong>
                        {available && sample
                          ? Math.round(sample.speedKph)
                          : "—"}
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
                      <p>
                        {isDemo
                          ? "Simulated assessment · Fresh samples only"
                          : "Current motion cannot be inferred from events"}
                      </p>
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
                      {!isDemo
                        ? "CURRENT STATE UNKNOWN"
                        : severity === "unavailable"
                          ? "SIGNAL UNAVAILABLE"
                          : severity === "normal"
                            ? "YOU’RE IN THE GREEN"
                            : "THRESHOLD EXCEEDED"}
                    </span>
                    <div role="status" aria-live="polite">
                      <h3>
                        {!isDemo
                          ? "Current motion unknown"
                          : freshness === "stale"
                            ? "Telemetry is stale"
                            : labels[severity]}
                      </h3>
                    </div>
                    <p>
                      {isDemo
                        ? statusDescriptions[severity]
                        : "Threshold events report past impacts, not ongoing safe motion. Event silence never confirms green."}
                    </p>
                    <div className="resultant">
                      <span>Resultant acceleration</span>
                      <strong>
                        {available && magnitude !== null
                          ? magnitude.toFixed(2)
                          : "—"}
                        <small> g</small>
                      </strong>
                    </div>
                  </div>
                  {!isDemo && monitor.latestEvent && (
                    <div className="last-event-info">
                      <strong>
                        Last{" "}
                        {monitor.latestEvent.source === "test-event"
                          ? "test"
                          : "device"}{" "}
                        event ·{" "}
                        {monitor.latestEvent.severity === "critical"
                          ? "High impact"
                          : "Moderate"}
                      </strong>
                      <span>
                        {time(monitor.latestEvent.timestamp)} · Historical
                        report, not current motion
                      </span>
                      <span>
                        Last{" "}
                        {monitor.latestEvent.source === "device"
                          ? "device"
                          : "test"}{" "}
                        event received{" "}
                        {monitor.lastEventReceivedAt === null
                          ? "never"
                          : `${Math.max(0, Math.floor((now - monitor.lastEventReceivedAt) / 1000))}s ago`}
                        {monitor.lastEventReceivedAt !== null &&
                        now - monitor.lastEventReceivedAt > 5000
                          ? " · Stale event record"
                          : " · Recent event record"}
                      </span>
                    </div>
                  )}
                  {isDemo ? (
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
                  ) : (
                    <div className="event-threshold-note">
                      Demo settings do not configure device thresholds.
                    </div>
                  )}
                </section>
              </div>
              <section
                className="local-imu-statuses"
                aria-label="Three IMU availability cards"
              >
                {[1, 2, 3].map((id) => (
                  <article
                    className="card local-imu-availability"
                    aria-label={`IMU ${id} availability`}
                    key={id}
                  >
                    <div>
                      <strong>IMU {id}</strong>
                      <span className="cloud-unknown">
                        <i />
                        Current: Unavailable
                      </span>
                    </div>
                    <p>
                      Per-IMU measurements are not supplied by this local demo.
                    </p>
                    <span>Last per-IMU event: Not supplied</span>
                  </article>
                ))}
              </section>
              <section className="card imu-card">
                <div className="card-heading">
                  <div>
                    <h2>
                      <Activity size={18} />
                      Motion at a glance
                    </h2>
                    <p>
                      {isDemo
                        ? "Simulated axes · Gravity removed · Not device telemetry"
                        : "Not provided by event-only telemetry"}
                    </p>
                  </div>
                  <span className="unit-label">
                    {isDemo ? (
                      <>
                        LAST 24 SECONDS <span>·</span> g
                      </>
                    ) : (
                      "NO CONTINUOUS DATA"
                    )}
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
                        {available && sample
                          ? `${sample.acceleration[axis] >= 0 ? "+" : ""}${sample.acceleration[axis].toFixed(2)}`
                          : "—"}
                        <span>g</span>
                      </div>
                      {isDemo && available && (
                        <Sparkline
                          values={
                            available
                              ? history.map((s) => s.acceleration[axis])
                              : []
                          }
                          axis={axis}
                        />
                      )}
                      {isDemo && !available && (
                        <div className="chart-unavailable">
                          No fresh samples
                        </div>
                      )}
                      <div className="axis-chart-footer">
                        <span>{isDemo ? "24s ago" : "Not supplied"}</span>
                        <span>{isDemo ? "Now" : ""}</span>
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
                            {s.distanceKm === null
                              ? "Distance unavailable"
                              : `${s.distanceKm.toFixed(1)} km`}{" "}
                            <span>·</span>{" "}
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
                            : "No events logged"}
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
            <EventAnalysis
              key={mode}
              events={analysisEvents}
              now={now}
              selectedId={selectedEventId}
              onSelect={setSelectedEventId}
              map={analysisMap(analysisEvents)}
            />
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
              <SessionTable
                sessions={[session, ...sessions]}
                now={now}
                onReview={(id) => {
                  setReviewSessionId(id);
                  setSelectedEventId(null);
                }}
              />
              {reviewSession && (
                <div className="local-session-review">
                  <div className="card-heading">
                    <div>
                      <h2>Review · {date(reviewSession.startedAt)}</h2>
                      <p>
                        {reviewSession.source === "simulation"
                          ? "Simulated session"
                          : "Event-only session"}{" "}
                        ·{" "}
                        {duration(
                          (reviewSession.endedAt ?? now) -
                            reviewSession.startedAt,
                        )}{" "}
                        · {reviewSession.impactCount} recorded events
                      </p>
                      <p>
                        {monitor.routes[reviewSession.id]?.length
                          ? `${monitor.routes[reviewSession.id].length} captured demo positions`
                          : "GPS route not retained for this session · Event locations shown only where supplied"}
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setReviewSessionId(null)}
                    >
                      Close review
                    </button>
                  </div>
                  <EventAnalysis
                    key={reviewSession.id}
                    events={analysisEvents.filter(
                      (e) =>
                        events.find((original) => original.id === e.id)
                          ?.sessionId === reviewSession.id,
                    )}
                    now={now}
                    selectedId={selectedEventId}
                    onSelect={setSelectedEventId}
                    map={analysisMap(
                      analysisEvents.filter(
                        (e) =>
                          events.find((original) => original.id === e.id)
                            ?.sessionId === reviewSession.id,
                      ),
                      monitor.routes[reviewSession.id] ?? [],
                    )}
                  />
                </div>
              )}
            </section>
          )}
          <section
            className="demo-controls"
            aria-label={
              isDemo ? "Simulation controls" : "Event-only test controls"
            }
          >
            <div className="demo-controls-title">
              <span className="demo-icon">
                <Play size={15} fill="currentColor" />
              </span>
              <div>
                <strong>
                  {isDemo ? "Simulation controls" : "Sparse event preview"}
                </strong>
                <span>
                  {isDemo
                    ? "Continuous simulated data · No device connection"
                    : "Local test packets only · No continuous samples"}
                </span>
              </div>
            </div>
            <div className="demo-actions">
              {isDemo ? (
                <>
                  <label className="feed-toggle">
                    <span>Data feed</span>
                    <button
                      role="switch"
                      aria-checked={connected}
                      aria-label="Simulated data feed"
                      onClick={() => monitor.setAvailable(!connected)}
                      className={`switch ${connected ? "on" : ""}`}
                    >
                      <span />
                    </button>
                  </label>
                  <button
                    className="button secondary"
                    onClick={() => monitor.setPaused(!monitor.paused)}
                    disabled={!connected}
                  >
                    {monitor.paused ? "Resume updates" : "Pause updates"}
                  </button>
                  <button
                    className="button simulate-button"
                    onClick={monitor.simulateImpact}
                    disabled={!available || monitor.paused}
                  >
                    <Zap size={15} />
                    Simulate impact
                  </button>
                </>
              ) : (
                <>
                  <label className="test-severity">
                    Test event severity
                    <select
                      aria-label="Test event severity"
                      value={monitor.testEventSeverity}
                      onChange={(event) =>
                        monitor.setTestEventSeverity(
                          event.target.value as "warning" | "critical",
                        )
                      }
                    >
                      <option value="warning">Moderate</option>
                      <option value="critical">High impact</option>
                    </select>
                  </label>
                  <button
                    className="button simulate-button"
                    onClick={monitor.injectTestEvent}
                  >
                    <Zap size={15} />
                    Inject test event
                  </button>
                </>
              )}
            </div>
          </section>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Simulation and test events only. No hardware or cloud connection.
            </span>
            <span>
              MSD Impact Monitor <span className="muted-dot">/</span> Observer /
              Demonstration
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
            Continuous readings are simulation-only. Event-only mode displays
            sparse local test packets and never confirms current safe motion.
            GPS coordinates do not represent a real driver.
          </p>
        </div>
      )}
    </div>
  );
}
