import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CloudSession } from "../domain/cloud";
import {
  filterAnalysisEvents,
  type AnalysisEvent,
} from "../domain/eventAnalysis";
import { ViewButtons } from "./WorkspaceViews";

export type RecordRequest = {
  view: "report" | "history";
  imu?: string;
  serial: number;
};
type Props = {
  request: RecordRequest | null;
  active: boolean;
  events: AnalysisEvent[];
  now: number;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  map: ReactNode;
  sessions: CloudSession[];
  userId: string;
  onSelectSession: (id: string) => void;
};
export function WorkspaceRecords(p: Props) {
  const [view, setView] = useState<
    "report" | "filters" | "map" | "history" | "timeline"
  >("report");
  const [imu, setImu] = useState("all"),
    [level, setLevel] = useState("all"),
    [window, setWindow] = useState("all");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  const [sessionPage, setSessionPage] = useState(0);
  useEffect(() => {
    if (p.request) {
      setView(p.request.view);
      if (p.request.view === "report") {
        setImu(p.request.imu || "all");
        setLevel("all");
        setWindow("all");
        setFrom("");
        setTo("");
        p.onSelectEvent(null);
      }
    }
  }, [p.request]);
  const invalid =
    window === "custom" && !!from && !!to && Date.parse(from) > Date.parse(to);
  const visible = useMemo(
    () =>
      invalid
        ? []
        : filterAnalysisEvents(p.events, {
            imu,
            severity: level,
            since:
              window === "custom"
                ? from
                  ? Date.parse(from)
                  : null
                : window === "all"
                  ? null
                  : p.now - Number(window) * 60000,
            until: window === "custom" && to ? Date.parse(to) : null,
          }).reverse(),
    [p.events, p.now, imu, level, window, from, to, invalid],
  );
  const index = Math.max(
    0,
    visible.findIndex((e) => e.id === p.selectedEventId),
  );
  const selected = visible[index];
  useEffect(() => {
    if (!p.active) return;
    if (selected && selected.id !== p.selectedEventId)
      p.onSelectEvent(selected.id);
    if (!selected && p.selectedEventId) p.onSelectEvent(null);
  }, [selected?.id, p.selectedEventId, p.onSelectEvent, p.active]);
  const reset = () => {
    setImu("all");
    setLevel("all");
    setWindow("all");
    setFrom("");
    setTo("");
  };
  const sessions = p.sessions.filter(
    (s) =>
      s.label.toLowerCase().includes(search.toLowerCase()) &&
      (status === "all" || (status === "active" ? !s.ended_at : !!s.ended_at)),
  );
  const sIndex = Math.min(sessionPage, Math.max(0, sessions.length - 1));
  const session = sessions[sIndex];
  return (
    <>
      <ViewButtons
        label="Event views"
        value={view}
        options={[
          ["report", "Reports"],
          ["filters", "Filters"],
          ["map", "Event map"],
          ["timeline", "Timeline"],
          ["history", "History"],
        ]}
        onChange={setView}
      />
      {view === "timeline" && (
        <section
          className="ws-panel ws-timeline"
          aria-label="Interactive threshold event timeline"
        >
          <h2>Event sequence</h2>
          <p>Source-time order · Discrete reports, not a continuous trace.</p>
          {[1, 2, 3].map((id) => (
            <div className="ws-timeline-lane" key={id}>
              <span>IMU {id}</span>
              <div>
                {visible
                  .slice(
                    Math.floor(index / 6) * 6,
                    Math.floor(index / 6) * 6 + 6,
                  )
                  .map((event, column) =>
                    event.imuId === id ? (
                      <button
                        key={event.id}
                        style={{ gridColumn: column + 1 }}
                        className={`severity-badge ${event.severity}`}
                        aria-label={`Inspect ${event.severity} event ${event.id}`}
                        title={new Date(event.timestamp).toLocaleString()}
                        onClick={() => {
                          p.onSelectEvent(event.id);
                          setView("report");
                        }}
                      >
                        {event.severity === "critical" ? "!" : "△"}
                      </button>
                    ) : null,
                  )}
              </div>
            </div>
          ))}
          <div className="ws-pager">
            <button
              disabled={index < 6}
              onClick={() =>
                p.onSelectEvent(visible[Math.floor(index / 6) * 6 - 6].id)
              }
            >
              Newer reports
            </button>
            <span>
              {Math.floor(index / 6) + 1} /{" "}
              {Math.max(1, Math.ceil(visible.length / 6))}
            </span>
            <button
              disabled={Math.floor(index / 6) * 6 + 6 >= visible.length}
              onClick={() =>
                p.onSelectEvent(visible[Math.floor(index / 6) * 6 + 6].id)
              }
            >
              Older reports
            </button>
          </div>
        </section>
      )}
      {view === "filters" && (
        <section
          className="ws-panel ws-filters"
          aria-label="Event analysis filters"
        >
          <div className="ws-filter-grid">
            <label>
              Sensor
              <select
                aria-label="Filter by IMU"
                value={imu}
                onChange={(e) => setImu(e.target.value)}
              >
                <option value="all">All IMUs</option>
                {[1, 2, 3].map((id) => (
                  <option key={id} value={id}>
                    IMU {id}
                  </option>
                ))}
                <option value="unknown">Not supplied</option>
              </select>
            </label>
            <label>
              Severity
              <select
                aria-label="Filter by severity"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="all">All</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Time range
              <select
                aria-label="Filter by time"
                value={window}
                onChange={(e) => setWindow(e.target.value)}
              >
                <option value="all">All time</option>
                <option value="5">5 min</option>
                <option value="15">15 min</option>
                <option value="60">1 hour</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {window === "custom" && (
              <>
                <label>
                  From
                  <input
                    type="datetime-local"
                    step="1"
                    aria-label="Events from"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label>
                  Until
                  <input
                    type="datetime-local"
                    step="1"
                    aria-label="Events until"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <p>
            {invalid ? (
              <span role="alert">
                The end time must be on or after the start time.
              </span>
            ) : (
              `${visible.length} matching events · Times use your browser’s timezone.`
            )}
          </p>
          <button onClick={reset}>Reset filters</button>
        </section>
      )}
      {(view === "report" || view === "map") && (
        <>
          <div className="ws-pager" aria-label="Event pagination">
            <button
              disabled={index === 0 || !visible.length}
              onClick={() => p.onSelectEvent(visible[index - 1].id)}
            >
              Previous event
            </button>
            <span>
              {visible.length ? index + 1 : 0} / {visible.length}
            </span>
            <button
              disabled={!visible.length || index + 1 >= visible.length}
              onClick={() => p.onSelectEvent(visible[index + 1].id)}
            >
              Next event
            </button>
          </div>
          {!selected ? (
            <section className="ws-panel">
              <h2>
                {p.events.length
                  ? "No events match these filters"
                  : "No threshold events recorded"}
              </h2>
              <p>Event silence does not confirm safe motion.</p>
              <button onClick={reset}>Clear filters</button>
            </section>
          ) : view === "map" ? (
            <section className="ws-panel ws-map" aria-label="Event location">
              <p>
                {selected.position
                  ? "Selected historical event location"
                  : "No location supplied · Cannot highlight on map"}
              </p>
              {p.active ? p.map : null}
            </section>
          ) : (
            <section
              className="ws-panel ws-report"
              aria-label="Selected event details"
            >
              <p>Historical report</p>
              <div className="ws-report-heading">
                <h2>IMU {selected.imuId ?? "not supplied"}</h2>
                <strong className={`severity-badge ${selected.severity}`}>
                  {selected.severity === "critical"
                    ? "High impact · Red"
                    : "Moderate · Yellow"}
                </strong>
              </div>
              <dl className="ws-facts">
                <div>
                  <dt>Historical peak</dt>
                  <dd>
                    {selected.magnitude === null
                      ? "Not supplied"
                      : `${selected.magnitude.toFixed(2)} g`}
                  </dd>
                </div>
                <div>
                  <dt>Recorded at</dt>
                  <dd>{new Date(selected.timestamp).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Event thresholds (snapshot)</dt>
                  <dd>
                    {selected.thresholds
                      ? `T1 ${selected.thresholds.t1.toFixed(2)} g · T2 ${selected.thresholds.t2.toFixed(2)} g`
                      : "Not supplied"}
                  </dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>
                    {selected.position
                      ? `${selected.position.latitude.toFixed(5)}, ${selected.position.longitude.toFixed(5)}`
                      : "No location supplied"}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </>
      )}
      {view === "history" && (
        <section
          className="ws-panel ws-session-browser"
          aria-label="Browse cloud sessions"
        >
          <div className="ws-selectors">
            <label>
              Search
              <input
                aria-label="Search sessions"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSessionPage(0);
                }}
                placeholder="Find a session…"
              />
            </label>
            <label>
              Status
              <select
                aria-label="Filter session status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setSessionPage(0);
                }}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
          {session ? (
            <button
              className="ws-session-card"
              onClick={() => p.onSelectSession(session.id)}
            >
              <strong>{session.label}</strong>
              <span>
                {session.ended_at ? "Completed" : "Active"} ·{" "}
                {session.owner_id === p.userId ? "Owner" : "Read only"}
              </span>
              <span>{new Date(session.started_at).toLocaleString()}</span>
            </button>
          ) : (
            <p>No matching sessions</p>
          )}
          <div className="ws-pager">
            <button
              disabled={sIndex === 0}
              onClick={() => setSessionPage(sIndex - 1)}
            >
              Previous session
            </button>
            <span>
              {sessions.length ? sIndex + 1 : 0} / {sessions.length}
            </span>
            <button
              disabled={!sessions.length || sIndex + 1 >= sessions.length}
              onClick={() => setSessionPage(sIndex + 1)}
            >
              Next session
            </button>
          </div>
        </section>
      )}
    </>
  );
}
