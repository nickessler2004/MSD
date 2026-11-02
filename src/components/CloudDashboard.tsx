import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cloud,
  Database,
  LogOut,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Square,
  Users,
} from "lucide-react";
import type { ImuId } from "../domain/cloud";
import type { TelemetryMode } from "../domain/types";
import {
  connectionFreshness,
  gpsFreshness,
  latestGps,
  normalizeEvents,
  normalizeGps,
} from "../domain/cloudRecords";
import { getSupabaseClient, getSupabaseConfig } from "../services/supabase";
import { CloudRepository } from "../services/cloudRepository";
import { startCloudSimulation } from "../services/cloudSimulator";
import { useCloudAuth } from "../hooks/useCloudAuth";
import { useCloudSession } from "../hooks/useCloudSession";
import { CloudAuth } from "./CloudAuth";
import { VehicleMap } from "./VehicleMap";

import type { AnalysisEvent } from "../domain/eventAnalysis";
import "./CloudDashboard.css";
import { ObserverWorkspace } from "./ObserverWorkspace";

type Props = { onModeChange: (mode: TelemetryMode | "cloud") => void };
const imuIds: ImuId[] = [1, 2, 3];
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Cloud operation failed. Please retry.";

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
  const [thresholdSensor, setThresholdSensor] = useState("1");
  const [observerPage, setObserverPage] = useState(0);
  useEffect(
    () =>
      setObserverPage((page) =>
        Math.min(page, Math.max(0, (snapshot?.observers.length ?? 0) - 1)),
      ),
    [snapshot?.observers.length],
  );
  const [now, setNow] = useState(Date.now());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    setSelectedEventId(null);
    setObserverPage(0);
  }, [selectedId]);
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
  const active = Boolean(
    snapshot &&
    snapshot.session.id === selectedId &&
    !snapshot.session.ended_at,
  );
  const gpsLive = gpsState === "fresh" && active && !cloud.error && online;
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
  const analysisEvents = useMemo<AnalysisEvent[]>(
    () =>
      events.map((event) => ({
        id: event.id,
        timestamp: Date.parse(event.recorded_at),
        imuId: event.imu_id,
        severity: event.severity,
        magnitude: event.magnitude,
        position:
          event.latitude !== null && event.longitude !== null
            ? { latitude: event.latitude, longitude: event.longitude }
            : null,
        thresholds: { t1: event.t1, t2: event.t2 },
        source:
          snapshot?.session.data_source === "simulated"
            ? "Simulated cloud"
            : "Device report",
      })),
    [events, snapshot?.session.data_source],
  );
  const renderReviewMap = (historical = false) => (
    <VehicleMap
      key={snapshot?.session.id}
      position={
        !historical && gpsLive && fix
          ? { latitude: fix.latitude, longitude: fix.longitude }
          : null
      }
      heading={fix?.heading ?? 0}
      events={eventMarkers}
      route={route}
      available={!historical && gpsLive}
      fitRoute
      mapLabel="Recorded session route and event locations"
      selectedEventId={selectedEventId}
      onEventSelect={setSelectedEventId}
    />
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

  if (auth.user && config.ready)
    return (
      <ObserverWorkspace
        snapshot={snapshot}
        sessions={sessions}
        selectedId={selectedId}
        userId={auth.user.id}
        now={now}
        online={online}
        loading={cloud.loading}
        gps={gps}
        events={analysisEvents}
        fix={fix}
        gpsLive={gpsLive}
        realtimeStatus={cloud.realtimeStatus}
        gatewayState={gatewayState}
        error={actionError || cloud.error || auth.error}
        notice={notice}
        busy={busy}
        onRefresh={() =>
          void act(async () => {
            await cloud.refreshSessions();
            await cloud.refreshSnapshot();
          }, "Cloud records refreshed.")
        }
        onSelectSession={(id) => {
          stopDrive();
          cloud.setSelectedId(id);
        }}
        onExport={exportSession}
        selectedEventId={selectedEventId}
        onSelectEvent={setSelectedEventId}
        map={renderReviewMap()}
        selectedImu={thresholdSensor}
        onSelectImu={setThresholdSensor}
        imuPanel={
          snapshot ? (
            <section
              className="cloud-imu-grid"
              aria-label="Three IMU event statuses"
            >
              {imuIds.map((imu_id) => {
                return (
                  <article
                    className="card cloud-imu-card"
                    aria-label={`IMU ${imu_id} event status`}
                    key={imu_id}
                  >
                    <div className="cloud-imu-title">
                      <span className="cloud-imu-number">{imu_id}</span>
                      <h2>IMU {imu_id}</h2>
                      <span
                        className="imu-traffic"
                        aria-label={`IMU ${imu_id} current measurement unavailable`}
                      >
                        <i />
                        <i />
                        <i />
                        <i className="active-gray" />
                      </span>
                      <span className="cloud-unknown">
                        <i />
                        Current: Unknown
                      </span>
                    </div>
                    <p>
                      Event-only telemetry · Continuous acceleration not
                      transmitted
                    </p>
                  </article>
                );
              })}
            </section>
          ) : null
        }
        settings={{
          session: (
            <section className="card cloud-session-toolbar">
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
          ),
          thresholds: snapshot ? (
            <section
              className="card cloud-threshold-settings"
              id="cloud-threshold-settings"
              tabIndex={-1}
            >
              <div className="card-heading">
                <div>
                  <h2>
                    <Settings2 size={18} />
                    Cloud thresholds (g)
                  </h2>
                  <p>Green A &lt; T1 · Yellow T1 ≤ A ≤ T2 · Red A &gt; T2</p>
                </div>
                <span className="unit-label">
                  {owner ? "OWNER SETTINGS" : "READ ONLY"}
                </span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!repository || !validThresholds || !owner) return;
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
                  }, "Cloud thresholds saved.");
                }}
              >
                <div
                  className="cloud-threshold-rows"
                  data-threshold-sensor={thresholdSensor}
                >
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
          ) : null,
          sharing: snapshot ? (
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
                      <button className="button secondary" disabled={busy}>
                        Share session
                      </button>
                    </div>
                  </form>
                  <div className="ws-pager">
                    <button
                      disabled={observerPage === 0}
                      onClick={() => setObserverPage((p) => p - 1)}
                    >
                      Previous observer
                    </button>
                    <span>
                      {snapshot.observers.length
                        ? Math.min(observerPage + 1, snapshot.observers.length)
                        : 0}{" "}
                      / {snapshot.observers.length}
                    </span>
                    <button
                      disabled={observerPage + 1 >= snapshot.observers.length}
                      onClick={() => setObserverPage((p) => p + 1)}
                    >
                      Next observer
                    </button>
                  </div>
                  <ul className="cloud-observer-list">
                    {snapshot.observers
                      .slice(observerPage, observerPage + 1)
                      .map((observer) => (
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
                </>
              ) : (
                <div className="cloud-readonly">
                  <ShieldCheck size={23} />
                  <strong>Read-only observer</strong>
                  <p>
                    You can view this session’s route, events, history, and
                    thresholds. Upload and sharing controls belong to its owner.
                  </p>
                </div>
              )}
            </section>
          ) : null,
          tools:
            snapshot && owner ? (
              <section className="demo-controls cloud-test-controls">
                <div className="demo-controls-title">
                  <span className="demo-icon">
                    <Play size={15} />
                  </span>
                  <div>
                    <strong>
                      {snapshot.session.data_source === "simulated"
                        ? "Test cloud delivery with simulated telemetry"
                        : "Device session controls"}
                    </strong>
                    <span>
                      {snapshot.session.data_source === "simulated"
                        ? "GPS ~1 Hz · Three IMUs send threshold events only · No raw IMU uploads"
                        : "Device sessions never fall back to generated telemetry."}
                    </span>
                  </div>
                </div>
                <div className="demo-actions">
                  {snapshot.session.data_source === "simulated" && active && (
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
                      {feeding ? <Square size={14} /> : <Play size={14} />}{" "}
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
                          await repository.finishSession(snapshot.session.id);
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
            ) : null,
          account: (
            <section className="ws-account">
              <h2>Account</h2>
              <p>{auth.user.email}</p>

              <div className="cloud-top-actions">
                <label className="cloud-source-label">
                  Telemetry source
                  <select
                    aria-label="Telemetry source"
                    value="cloud"
                    onChange={(event) =>
                      onModeChange(
                        event.target.value as TelemetryMode | "cloud",
                      )
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
            </section>
          ),
        }}
      />
    );

  return (
    <div className="cloud-shell cloud-auth-shell">
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
          <span className="cloud-brand-label">OBSERVER / TELEMETRY</span>
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
              OBSERVER CONSOLE / CLOUD
            </span>
            <h1>Observer dashboard</h1>
            <p>
              Track the drive. Inspect the impact. Review every recorded
              session.
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
        ) : null}

        <footer className="cloud-footer">
          <span>
            <ShieldCheck size={13} />
            Raw IMU data stays on the ESP32-S3. Cloud events never imply current
            safe motion.
          </span>
          <span>MSD Observer / Session telemetry</span>
        </footer>
      </main>
    </div>
  );
}
