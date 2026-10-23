import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Check,
  Cloud,
  Clock3,
  Database,
  LogOut,
  MapPin,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck,
  Square,
  Users,
  WifiOff,
  Zap,
} from "lucide-react";
import type { CloudThresholdEvent, ImuId } from "../domain/cloud";
import type { TelemetryMode } from "../domain/types";
import {
  connectionFreshness,
  gpsFreshness,
  latestGps,
  normalizeEvents,
  normalizeGps,
  routeDistanceKm,
} from "../domain/cloudRecords";
import { getSupabaseClient, getSupabaseConfig } from "../services/supabase";
import { CloudRepository } from "../services/cloudRepository";
import { startCloudSimulation } from "../services/cloudSimulator";
import { useCloudAuth } from "../hooks/useCloudAuth";
import { useCloudSession } from "../hooks/useCloudSession";
import { CloudAuth } from "./CloudAuth";
import { Stat } from "./StatCard";
import { VehicleMap } from "./VehicleMap";
import { date, duration, time } from "../lib/format";
import "./CloudDashboard.css";

type Props = { onModeChange: (mode: TelemetryMode | "cloud") => void };
const age = (value: string | undefined, now: number) =>
  value
    ? `${Math.max(0, Math.floor((now - Date.parse(value)) / 1000))}s ago`
    : "Never received";
const imuIds: ImuId[] = [1, 2, 3];
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Cloud operation failed. Please retry.";

function CloudEvents({
  events,
  compact = false,
}: {
  events: CloudThresholdEvent[];
  compact?: boolean;
}) {
  const sorted = [...events].reverse();
  return (
    <div className="table-scroll">
      <table className="events-table cloud-events-table">
        <thead>
          <tr>
            <th>EVENT TIME / IMU</th>
            <th>REPORTED STATUS</th>
            <th>PEAK A</th>
            <th>EVENT LOCATION</th>
            <th>THRESHOLD SNAPSHOT</th>
          </tr>
        </thead>
        <tbody>
          {(compact ? sorted.slice(0, 5) : sorted).map((event) => (
            <tr key={event.id}>
              <td>
                <strong>{time(Date.parse(event.recorded_at))}</strong>
                <small>
                  {date(Date.parse(event.recorded_at))} · IMU {event.imu_id}
                </small>
              </td>
              <td>
                <span className={`severity-badge ${event.severity}`}>
                  <i />
                  {event.severity === "critical" ? "High impact" : "Moderate"}
                </span>
                <small>Historical event</small>
              </td>
              <td>
                {event.magnitude === null
                  ? "Not supplied"
                  : `${event.magnitude.toFixed(2)} g`}
              </td>
              <td>
                {event.latitude === null || event.longitude === null
                  ? "Not supplied"
                  : `${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}`}
              </td>
              <td>
                T1 {event.t1.toFixed(2)} g · T2 {event.t2.toFixed(2)} g
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && (
        <div className="empty-state">
          <ShieldCheck size={25} />
          <strong>No threshold events recorded</strong>
          <p>Event silence does not confirm safe motion.</p>
        </div>
      )}
    </div>
  );
}

export function CloudDashboard({ onModeChange }: Props) {
  const [config] = useState(getSupabaseConfig);
  const [client] = useState(getSupabaseClient);
  const repository = useMemo(
    () => (client ? new CloudRepository(client) : null),
    [client],
  );
  const auth = useCloudAuth(client);
  const cloud = useCloudSession(repository, auth.user?.id ?? null);
  const { snapshot, sessions, selectedId } = cloud;
  const [tab, setTab] = useState<"overview" | "history" | "events">("overview");
  const [now, setNow] = useState(Date.now());
  const [label, setLabel] = useState("");
  const [dataSource, setDataSource] = useState<"simulated" | "device">(
    "simulated",
  );
  const [sharingEmail, setSharingEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [feeding, setFeeding] = useState(false);
  const feedStop = useRef<(() => void) | null>(null);
  const [draftThresholds, setDraftThresholds] = useState(
    imuIds.map((imu_id) => ({ imu_id, t1: "0.8", t2: "1.8" })),
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setFeeding(false);
    return () => {
      feedStop.current?.();
      feedStop.current = null;
    };
  }, [selectedId, auth.user?.id]);
  const thresholdVersion = JSON.stringify(snapshot?.thresholds ?? []);
  useEffect(() => {
    if (snapshot)
      setDraftThresholds(
        imuIds.map((imu_id) => {
          const row = snapshot.thresholds.find(
            (item) => item.imu_id === imu_id,
          );
          return {
            imu_id,
            t1: String(row?.t1 ?? 0.8),
            t2: String(row?.t2 ?? 1.8),
          };
        }),
      );
  }, [selectedId, thresholdVersion]);
  const gps = useMemo(() => normalizeGps(snapshot?.gps ?? []), [snapshot?.gps]);
  const events = useMemo(
    () => normalizeEvents(snapshot?.events ?? []),
    [snapshot?.events],
  );
  const fix = useMemo(() => latestGps(gps), [gps]);
  const gpsState = gpsFreshness(fix, now);
  const gatewayState = connectionFreshness(snapshot?.connection ?? null, now);
  const owner = Boolean(
    snapshot && auth.user?.id === snapshot.session.owner_id,
  );
  const active = Boolean(snapshot && !snapshot.session.ended_at);
  const gpsLive = gpsState === "fresh" && active && !cloud.error;
  const route = useMemo(
    () =>
      gps.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
    [gps],
  );
  const eventMarkers = useMemo(
    () =>
      events.flatMap((event) =>
        event.latitude !== null && event.longitude !== null
          ? [
              {
                id: event.id,
                timestamp: Date.parse(event.recorded_at),
                severity: event.severity,
                position: {
                  latitude: event.latitude,
                  longitude: event.longitude,
                },
              },
            ]
          : [],
      ),
    [events],
  );
  const validThresholds = draftThresholds.every(
    (row) =>
      row.t1.trim() !== "" &&
      row.t2.trim() !== "" &&
      Number.isFinite(Number(row.t1)) &&
      Number.isFinite(Number(row.t2)) &&
      Number(row.t1) > 0 &&
      Number(row.t2) > Number(row.t1) &&
      Number(row.t2) <= 10,
  );
  async function act(work: () => Promise<void>, success: string) {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await work();
      setNotice(success);
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  }
  function stopDrive() {
    feedStop.current?.();
    feedStop.current = null;
    setFeeding(false);
  }
  function startDrive() {
    if (
      !repository ||
      !snapshot ||
      !owner ||
      snapshot.session.data_source !== "simulated" ||
      !active
    )
      return;
    setActionError("");
    try {
      feedStop.current = startCloudSimulation(
        repository,
        snapshot.session,
        snapshot.thresholds,
        (error) => setActionError(error),
      );
      setFeeding(true);
      setNotice(
        "Uploading simulated GPS at approximately 1 Hz. Other authorized observers can watch this session.",
      );
    } catch (error) {
      setActionError(message(error));
    }
  }
  function exportSession() {
    if (!snapshot) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 3,
            transport: "supabase",
            exportedAt: new Date().toISOString(),
            ...snapshot,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `msd-cloud-${snapshot.session.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cloud-shell">
      <header className="cloud-topbar">
        <a
          className="cloud-brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onModeChange("simulation");
          }}
        >
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          <strong>
            MSD<span>.</span>
          </strong>
          <span className="cloud-brand-label">IMPACT MONITOR</span>
        </a>
        <div className="cloud-top-actions">
          <label className="cloud-source-label">
            Telemetry source
            <select
              aria-label="Telemetry source"
              value="cloud"
              onChange={(event) =>
                onModeChange(event.target.value as TelemetryMode | "cloud")
              }
            >
              <option value="simulation">Live simulation</option>
              <option value="event-only">Event-only preview</option>
              <option value="cloud">Supabase cloud</option>
            </select>
          </label>
          {auth.user && (
            <button
              className="button secondary"
              onClick={() => {
                stopDrive();
                void auth.signOut();
              }}
              disabled={auth.loading}
            >
              <LogOut size={14} />
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="cloud-main">
        <div className="cloud-page-heading">
          <div>
            <span className="heading-eyebrow">
              <Cloud size={12} />
              STAGE 2 · CLOUD OBSERVATION
            </span>
            <h1>Cloud session monitor</h1>
            <p>
              Live GPS. Historical threshold events. Shared, persistent session
              records.
            </p>
          </div>
          {auth.user && (
            <span className="cloud-user">
              <ShieldCheck size={14} />
              {auth.user.email}
            </span>
          )}
        </div>
        {!config.ready ? (
          <section className="card cloud-setup">
            <Database size={34} />
            <h2>Connect your Supabase project</h2>
            <p>{config.message}</p>
            <ol>
              <li>
                Apply the migration in <code>supabase/migrations</code> to your
                project.
              </li>
              <li>
                Set <code>VITE_SUPABASE_URL</code> and{" "}
                <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in{" "}
                <code>.env.local</code>.
              </li>
              <li>
                Restart the development server, then create an account and a
                simulated cloud session.
              </li>
            </ol>
            <p>
              Use only a publishable or legacy anon key. Privileged keys never
              belong in frontend code. Full instructions are in{" "}
              <code>docs/SUPABASE_SETUP.md</code>.
            </p>
            <button
              className="button primary"
              onClick={() => onModeChange("simulation")}
            >
              Continue local simulation
            </button>
          </section>
        ) : !auth.user ? (
          <CloudAuth auth={auth} />
        ) : (
          <>
            <section className="card cloud-session-toolbar">
              <div className="cloud-session-choice">
                <label htmlFor="cloud-session">Cloud driving session</label>
                <select
                  id="cloud-session"
                  value={selectedId ?? ""}
                  onChange={(event) => {
                    stopDrive();
                    cloud.setSelectedId(event.target.value || null);
                  }}
                >
                  <option value="">
                    {cloud.loading ? "Loading sessions…" : "Choose a session"}
                  </option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.label} · {session.data_source} ·{" "}
                      {session.ended_at ? "completed" : "active"}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  void act(async () => {
                    await cloud.refreshSessions();
                    await cloud.refreshSnapshot();
                  }, "Cloud records refreshed.")
                }
                disabled={busy}
              >
                <RefreshCw size={14} />
                Refresh records
              </button>
              <form
                className="cloud-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!repository) return;
                  void act(async () => {
                    const id = await repository.createSession(
                      label.trim(),
                      dataSource,
                    );
                    await cloud.refreshSessions();
                    cloud.setSelectedId(id);
                    setLabel("");
                    setTab("overview");
                  }, "Cloud session created with three IMU threshold configurations.");
                }}
              >
                <input
                  aria-label="Session name"
                  placeholder="Name your next session"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={100}
                  required
                />
                <select
                  aria-label="Cloud data source"
                  value={dataSource}
                  onChange={(event) =>
                    setDataSource(event.target.value as "simulated" | "device")
                  }
                >
                  <option value="simulated">Simulated data</option>
                  <option value="device">Device data</option>
                </select>
                <button className="button primary" disabled={busy}>
                  <Plus size={14} />
                  New cloud session
                </button>
              </form>
            </section>
            {(cloud.error || actionError || auth.error) && (
              <div className="cloud-message cloud-error" role="alert">
                <WifiOff size={16} />
                {actionError || cloud.error || auth.error}
              </div>
            )}
            {notice && (
              <div className="cloud-message" role="status">
                <Check size={15} />
                {notice}
              </div>
            )}
            <nav className="cloud-tabs" aria-label="Cloud navigation">
              {(["overview", "history", "events"] as const).map((value) => (
                <button
                  key={value}
                  aria-current={tab === value ? "page" : undefined}
                  className={tab === value ? "active" : ""}
                  onClick={() => setTab(value)}
                >
                  Cloud {value}
                </button>
              ))}
              <span className={`cloud-sync cloud-sync-${cloud.realtimeStatus}`}>
                <i />
                {cloud.realtimeStatus === "subscribed"
                  ? "Realtime connected"
                  : cloud.realtimeStatus === "connecting"
                    ? "Connecting realtime…"
                    : "Realtime unavailable · reconciling every 10s"}
              </span>
            </nav>
            {tab === "history" ? (
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>
                      <Clock3 size={18} />
                      Persistent session history
                    </h2>
                    <p>
                      Owned and shared sessions, loaded from Supabase after
                      every visit.
                    </p>
                  </div>
                </div>
                <div className="table-scroll">
                  <table className="events-table cloud-history-table">
                    <thead>
                      <tr>
                        <th>SESSION / SOURCE</th>
                        <th>STARTED</th>
                        <th>DURATION</th>
                        <th>ACCESS</th>
                        <th>STATE</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => (
                        <tr key={session.id}>
                          <td>
                            <strong>{session.label}</strong>
                            <small>
                              {session.data_source === "simulated"
                                ? "Simulated cloud telemetry"
                                : "Device telemetry"}
                            </small>
                          </td>
                          <td>
                            {date(Date.parse(session.started_at))} ·{" "}
                            {time(Date.parse(session.started_at))}
                          </td>
                          <td>
                            {duration(
                              Date.parse(
                                session.ended_at ?? new Date(now).toISOString(),
                              ) - Date.parse(session.started_at),
                            )}
                          </td>
                          <td>
                            {session.owner_id === auth.user!.id
                              ? "Owner"
                              : "Observer · read only"}
                          </td>
                          <td>{session.ended_at ? "Completed" : "Active"}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => {
                                stopDrive();
                                cloud.setSelectedId(session.id);
                                setTab("overview");
                              }}
                            >
                              Open session
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : !snapshot ? (
              <section className="card cloud-empty">
                <Database size={32} />
                <h2>
                  {cloud.loading
                    ? "Loading authorized session records…"
                    : "Choose or create a cloud session"}
                </h2>
                <p>
                  Sessions are private until the owner shares access. Local demo
                  records are never used as a cloud fallback.
                </p>
              </section>
            ) : (
              <>
                <div className="cloud-session-caption">
                  <div>
                    <h2>{snapshot.session.label}</h2>
                    <span
                      className={`cloud-source-chip ${snapshot.session.data_source}`}
                    >
                      {snapshot.session.data_source === "simulated"
                        ? "SIMULATED CLOUD DATA"
                        : "DEVICE TELEMETRY"}
                    </span>
                    <span>{owner ? "Owner" : "Observer · read only"}</span>
                    <span>
                      {active
                        ? "Active session"
                        : "Completed session · Historical records"}
                    </span>
                  </div>
                  <button className="button secondary" onClick={exportSession}>
                    <ArrowDownToLine size={14} />
                    Export session
                  </button>
                </div>
                <section className="stats-grid cloud-stats">
                  <Stat
                    icon={MapPin}
                    label="GPS availability"
                    value={
                      gpsLive
                        ? "Recent fix"
                        : gps.length
                          ? "Historical"
                          : "No GPS"
                    }
                    detail={`${age(fix?.recorded_at, now)} · Freshness limit 5s`}
                    tone={gpsLive ? "text-green" : "text-muted"}
                  />
                  <Stat
                    icon={Route}
                    label="Recorded route"
                    value={routeDistanceKm(gps).toFixed(2)}
                    suffix="km"
                    detail={`${gps.length} stored GPS fixes · Source-time order`}
                  />
                  <Stat
                    icon={Zap}
                    label="Threshold events"
                    value={String(events.length).padStart(2, "0")}
                    detail="Historical reports · No current IMU readings"
                  />
                  <Stat
                    icon={gatewayState === "fresh" ? Radio : WifiOff}
                    label="Gateway availability"
                    value={
                      !active
                        ? "Completed"
                        : gatewayState === "fresh"
                          ? "Recent report"
                          : gatewayState === "disconnected"
                            ? "Disconnected"
                            : gatewayState === "stale"
                              ? "Stale"
                              : "Unknown"
                    }
                    detail={`${age(snapshot.connection?.recorded_at, now)} · Heartbeat limit 15s`}
                    tone={
                      gatewayState === "fresh" && active
                        ? "text-green"
                        : "text-muted"
                    }
                  />
                </section>
                {tab === "events" ? (
                  <section className="card">
                    <div className="card-heading">
                      <div>
                        <h2>
                          <Zap size={18} />
                          Cloud threshold event records
                        </h2>
                        <p>
                          All three IMUs · Immutable event-time thresholds and
                          optional GPS locations
                        </p>
                      </div>
                    </div>
                    <CloudEvents events={events} />
                  </section>
                ) : (
                  <>
                    <div className="cloud-live-grid">
                      <section className="card cloud-map-card">
                        <div className="card-heading">
                          <div>
                            <h2>
                              <MapPin size={18} />
                              Live GPS route
                            </h2>
                            <p>
                              {gpsLive
                                ? "Recent source GPS · Not inferred from event arrival"
                                : "Current GPS unavailable or stale · Recorded route remains visible"}
                            </p>
                          </div>
                          <span
                            className={`live-badge ${gpsLive ? "" : "offline"}`}
                          >
                            <i />
                            {gpsLive ? "RECENT GPS" : "NO CURRENT GPS"}
                          </span>
                        </div>
                        <VehicleMap
                          key={snapshot.session.id}
                          position={
                            gpsLive && fix
                              ? {
                                  latitude: fix.latitude,
                                  longitude: fix.longitude,
                                }
                              : null
                          }
                          heading={fix?.heading ?? 0}
                          events={eventMarkers}
                          route={route}
                          available={gpsLive}
                          sourceLabel={
                            snapshot.session.data_source === "simulated"
                              ? "Simulated cloud vehicle"
                              : "Device GPS position"
                          }
                          mapLabel="Live GPS route of cloud driving session"
                          gpsStatusLabel="Recent GPS fix"
                          fitRoute
                        />
                        <div className="map-footer">
                          <span>
                            <Route size={14} />
                            {gps.length} GPS fixes · {eventMarkers.length} event
                            locations
                          </span>
                          <span>
                            {gpsLive &&
                            fix?.speed_kph !== null &&
                            fix?.speed_kph !== undefined
                              ? Math.round(fix.speed_kph)
                              : "—"}{" "}
                            km/h
                          </span>
                        </div>
                        <p className="cloud-gps-times">
                          Source fix:{" "}
                          {fix
                            ? new Date(fix.recorded_at).toLocaleString()
                            : "Not received"}{" "}
                          · Cloud receipt:{" "}
                          {fix
                            ? new Date(fix.received_at).toLocaleString()
                            : "Not received"}
                        </p>
                      </section>
                      <section
                        className="cloud-imu-grid"
                        aria-label="Three IMU event statuses"
                      >
                        {imuIds.map((imu_id) => {
                          const event = events
                            .filter((item) => item.imu_id === imu_id)
                            .at(-1);
                          const threshold = snapshot.thresholds.find(
                            (item) => item.imu_id === imu_id,
                          );
                          return (
                            <article
                              className="card cloud-imu-card"
                              aria-label={`IMU ${imu_id} event status`}
                              key={imu_id}
                            >
                              <div className="cloud-imu-title">
                                <span className="cloud-imu-number">
                                  {imu_id}
                                </span>
                                <h2>IMU {imu_id}</h2>
                                <span className="cloud-unknown">
                                  <i />
                                  Current: Unknown
                                </span>
                              </div>
                              <p>
                                Event-only telemetry · Continuous acceleration
                                not transmitted
                              </p>
                              <div className="cloud-last-event">
                                {event ? (
                                  <>
                                    <span
                                      className={`severity-badge ${event.severity}`}
                                    >
                                      <i />
                                      {event.severity === "critical"
                                        ? "High impact"
                                        : "Moderate"}
                                    </span>
                                    <span>
                                      {time(Date.parse(event.recorded_at))} ·
                                      Historical event
                                    </span>
                                  </>
                                ) : (
                                  <span>
                                    No event received · Silence does not confirm
                                    green
                                  </span>
                                )}
                              </div>
                              <footer>
                                T1 {threshold?.t1.toFixed(2) ?? "—"} g{" "}
                                <span>·</span> T2{" "}
                                {threshold?.t2.toFixed(2) ?? "—"} g
                              </footer>
                            </article>
                          );
                        })}
                      </section>
                    </div>
                    <section className="card cloud-recent">
                      <div className="card-heading">
                        <div>
                          <h2>
                            <Zap size={18} />
                            Recent cloud events
                          </h2>
                          <p>
                            {snapshot.session.data_source === "simulated"
                              ? "Simulated cloud records"
                              : "Device reports"}{" "}
                            · Event time and GPS retained between visits
                          </p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab("events")}
                        >
                          View all events
                        </button>
                      </div>
                      <CloudEvents events={events} compact />
                    </section>
                    <div className="cloud-settings-grid">
                      <section className="card cloud-threshold-settings">
                        <div className="card-heading">
                          <div>
                            <h2>
                              <Settings2 size={18} />
                              Three-IMU cloud thresholds
                            </h2>
                            <p>
                              Green A &lt; T1 · Yellow T1 ≤ A ≤ T2 · Red A &gt;
                              T2
                            </p>
                          </div>
                          <span className="unit-label">
                            {owner ? "OWNER SETTINGS" : "READ ONLY"}
                          </span>
                        </div>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!repository || !validThresholds || !owner)
                              return;
                            stopDrive();
                            void act(async () => {
                              await repository.setThresholds(
                                snapshot.session.id,
                                draftThresholds.map((row) => ({
                                  imu_id: row.imu_id,
                                  t1: Number(row.t1),
                                  t2: Number(row.t2),
                                })),
                              );
                              await cloud.refreshSnapshot();
                            }, "Threshold configurations saved. Restart the cloud test drive to use them. Future hardware must explicitly apply these settings.");
                          }}
                        >
                          <div className="cloud-threshold-rows">
                            {draftThresholds.map((row, index) => (
                              <div key={row.imu_id}>
                                <strong>IMU {row.imu_id}</strong>
                                {(["t1", "t2"] as const).map((key) => (
                                  <label key={key}>
                                    {key.toUpperCase()}
                                    <input
                                      aria-label={`IMU ${row.imu_id} ${key.toUpperCase()}`}
                                      type="number"
                                      min="0.1"
                                      max="10"
                                      step="0.1"
                                      value={row[key]}
                                      disabled={!owner || !active || busy}
                                      onChange={(event) =>
                                        setDraftThresholds((old) =>
                                          old.map((item, i) =>
                                            i === index
                                              ? {
                                                  ...item,
                                                  [key]: event.target.value,
                                                }
                                              : item,
                                          ),
                                        )
                                      }
                                    />
                                    <span>g</span>
                                  </label>
                                ))}
                              </div>
                            ))}
                          </div>
                          {!validThresholds && (
                            <p className="cloud-form-error" role="alert">
                              Each IMU requires 0 &lt; T1 &lt; T2 ≤ 10 g.
                            </p>
                          )}
                          <p className="cloud-settings-note">
                            These settings do not reclassify historical events
                            or confirm current acceleration. Device
                            configuration delivery belongs to the future phone
                            gateway.
                          </p>
                          {owner && (
                            <button
                              className="button secondary"
                              disabled={busy || !active || !validThresholds}
                            >
                              Save cloud thresholds
                            </button>
                          )}
                        </form>
                      </section>
                      <section className="card cloud-sharing">
                        <div className="card-heading">
                          <div>
                            <h2>
                              <Users size={18} />
                              Session observers
                            </h2>
                            <p>Only the owner can grant read-only access.</p>
                          </div>
                        </div>
                        {owner ? (
                          <>
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (!repository) return;
                                void act(async () => {
                                  await repository.shareSession(
                                    snapshot.session.id,
                                    sharingEmail.trim(),
                                  );
                                  setSharingEmail("");
                                  await cloud.refreshSnapshot();
                                }, "Observer access granted. The observer must sign in to this same Supabase project.");
                              }}
                            >
                              <label htmlFor="observer-email">
                                Existing account email
                              </label>
                              <div>
                                <input
                                  id="observer-email"
                                  type="email"
                                  value={sharingEmail}
                                  onChange={(event) =>
                                    setSharingEmail(event.target.value)
                                  }
                                  required
                                  placeholder="observer@example.com"
                                />
                                <button
                                  className="button secondary"
                                  disabled={busy}
                                >
                                  Share session
                                </button>
                              </div>
                            </form>
                            <ul className="cloud-observer-list">
                              {snapshot.observers.map((observer) => (
                                <li key={observer.user_id}>
                                  <span>{observer.user_id}</span>
                                  <button
                                    className="text-button"
                                    disabled={busy}
                                    onClick={() => {
                                      if (!repository) return;
                                      void act(async () => {
                                        await repository.revokeObserver(
                                          snapshot.session.id,
                                          observer.user_id,
                                        );
                                        await cloud.refreshSnapshot();
                                      }, "Observer access revoked in the database.");
                                    }}
                                  >
                                    Revoke access
                                  </button>
                                </li>
                              ))}
                            </ul>
                            <p className="cloud-settings-note">
                              Access is enforced by row-level security.
                              Membership changes are reconciled within 10
                              seconds; unauthorized reads are denied
                              immediately.
                            </p>
                          </>
                        ) : (
                          <div className="cloud-readonly">
                            <ShieldCheck size={23} />
                            <strong>Read-only observer</strong>
                            <p>
                              You can view this session’s route, events,
                              history, and thresholds. Upload and sharing
                              controls belong to its owner.
                            </p>
                          </div>
                        )}
                      </section>
                    </div>
                    {owner && (
                      <section className="demo-controls cloud-test-controls">
                        <div className="demo-controls-title">
                          <span className="demo-icon">
                            <Play size={15} />
                          </span>
                          <div>
                            <strong>
                              {snapshot.session.data_source === "simulated"
                                ? "Test cloud delivery with simulated telemetry"
                                : "Awaiting a future phone gateway"}
                            </strong>
                            <span>
                              {snapshot.session.data_source === "simulated"
                                ? "GPS ~1 Hz · Three IMUs send threshold events only · No raw IMU uploads"
                                : "Device sessions never fall back to generated telemetry."}
                            </span>
                          </div>
                        </div>
                        <div className="demo-actions">
                          {snapshot.session.data_source === "simulated" &&
                            active && (
                              <button
                                className="button secondary"
                                onClick={() => {
                                  if (feeding) {
                                    stopDrive();
                                    setNotice(
                                      "Cloud test drive stopped. Its last heartbeat ages out after 15 seconds.",
                                    );
                                  } else startDrive();
                                }}
                              >
                                {feeding ? (
                                  <Square size={14} />
                                ) : (
                                  <Play size={14} />
                                )}{" "}
                                {feeding
                                  ? "Stop cloud test drive"
                                  : "Start cloud test drive"}
                              </button>
                            )}
                          {active && (
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => {
                                if (!repository) return;
                                stopDrive();
                                void act(async () => {
                                  await repository.finishSession(
                                    snapshot.session.id,
                                  );
                                  await cloud.refreshSessions();
                                  await cloud.refreshSnapshot();
                                }, "Session completed. Delayed packets within the session time window can still be recorded.");
                              }}
                            >
                              Complete session
                            </button>
                          )}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
        <footer className="cloud-footer">
          <span>
            <ShieldCheck size={13} />
            Raw IMU data stays on the ESP32-S3. Cloud events never imply current
            safe motion.
          </span>
          <span>MSD · Supabase integration prototype</span>
        </footer>
      </main>
    </div>
  );
}
