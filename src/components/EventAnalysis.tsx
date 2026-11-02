import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Crosshair,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
  Zap,
  X,
} from "lucide-react";
import {
  filterAnalysisEvents,
  type AnalysisEvent,
} from "../domain/eventAnalysis";
import { time } from "../lib/format";
export function EventAnalysis({
  events,
  now,
  selectedId,
  onSelect,
  map,
  severity = "all",
}: {
  events: AnalysisEvent[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  map: ReactNode;
  severity?: string;
}) {
  const [imu, setImu] = useState("all"),
    [level, setLevel] = useState(severity),
    [window, setWindow] = useState("all");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const invalidRange =
    window === "custom" && !!from && !!to && Date.parse(from) > Date.parse(to);
  const visible = useMemo(
    () =>
      invalidRange
        ? []
        : filterAnalysisEvents(events, {
            imu,
            severity: level,
            since:
              window === "custom"
                ? from
                  ? Date.parse(from)
                  : null
                : window === "all"
                  ? null
                  : now - Number(window) * 60000,
            until: window === "custom" && to ? Date.parse(to) : null,
          }),
    [events, imu, level, window, from, to, now, invalidRange],
  );
  useEffect(() => {
    if (selectedId && !visible.some((e) => e.id === selectedId)) onSelect(null);
  }, [visible, selectedId, onSelect]);
  const selected = visible.find((e) => e.id === selectedId);
  const first = visible[0]?.timestamp ?? now,
    last = visible.at(-1)?.timestamp ?? now;
  const reset = () => {
    setImu("all");
    setLevel("all");
    setWindow("all");
    setFrom("");
    setTo("");
    onSelect(null);
  };
  return (
    <div className="event-analysis">
      <section
        className="card analysis-controls"
        aria-label="Event analysis filters"
      >
        <div className="analysis-filter-heading">
          <SlidersHorizontal size={16} />
          <strong>Event explorer</strong>
          <span>
            {visible.length} of {events.length} events
          </span>
        </div>
        <div className="analysis-filters">
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
              <option value="unknown">Sensor not supplied</option>
            </select>
          </label>
          <label>
            Severity
            <select
              aria-label="Filter by severity"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="all">All severities</option>
              <option value="warning">Yellow · Warning</option>
              <option value="critical">Red · Critical</option>
            </select>
          </label>
          <label>
            Time range
            <select
              aria-label="Filter by time"
              value={window}
              onChange={(e) => setWindow(e.target.value)}
            >
              <option value="all">All recorded time</option>
              <option value="5">Last 5 minutes</option>
              <option value="15">Last 15 minutes</option>
              <option value="60">Last hour</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          <button className="button secondary" onClick={reset}>
            <RotateCcw size={14} />
            Reset filters
          </button>
        </div>
        {window === "custom" && (
          <div className="analysis-custom-range">
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
            <span>Times use your browser’s local timezone.</span>
          </div>
        )}
        {invalidRange && (
          <p role="alert">The end time must be on or after the start time.</p>
        )}
      </section>
      <section
        className="card event-timeline"
        aria-label="Interactive threshold event timeline"
      >
        <div className="card-heading">
          <div>
            <h2>Impact timeline</h2>
            <p>
              Individual threshold reports · Select a marker to inspect · Not a
              continuous acceleration trace
            </p>
          </div>
          <span className="timeline-key">
            <i className="warning-dot" />
            Warning
            <i className="critical-dot" />
            Critical
          </span>
        </div>
        <div className="timeline-scroll">
          <div className="timeline-plot">
            {[
              1,
              2,
              3,
              ...(visible.some((e) => e.imuId === null) ? [null] : []),
            ].map((id) => (
              <div className="timeline-lane" key={id ?? "unknown"}>
                <span>{id ? `IMU ${id}` : "Unspecified"}</span>
                <div className="timeline-track">
                  {visible
                    .filter((e) => e.imuId === id)
                    .map((e) => (
                      <button
                        key={e.id}
                        className={`timeline-event ${e.severity} ${selectedId === e.id ? "selected" : ""}`}
                        style={{
                          left: `${last === first ? 50 : 4 + ((e.timestamp - first) / (last - first)) * 92}%`,
                        }}
                        onClick={() => onSelect(e.id)}
                        aria-pressed={selectedId === e.id}
                        aria-label={`Inspect ${e.severity} event ${e.id}`}
                        title={`${e.imuId ? `IMU ${e.imuId}` : "Sensor not supplied"} · ${new Date(e.timestamp).toLocaleString()} · ${e.magnitude === null ? "Magnitude not supplied" : e.magnitude.toFixed(2) + " g"}`}
                      >
                        {e.severity === "critical" ? (
                          <Zap size={13} />
                        ) : (
                          <TriangleAlert size={13} />
                        )}
                      </button>
                    ))}
                </div>
              </div>
            ))}
            <div className="timeline-time">
              <span>{visible.length ? time(first) : "No events in range"}</span>
              <span>{visible.length ? time(last) : "—"}</span>
            </div>
          </div>
        </div>
      </section>
      <div className="analysis-map-grid">
        <section className="card analysis-map">
          <div className="card-heading">
            <div>
              <h2>
                <Crosshair size={17} />
                Event location
              </h2>
              <p>Recorded route and supplied event coordinates</p>
            </div>
          </div>
          {map}
        </section>
        <section
          className={`card event-inspector ${selected?.severity ?? ""}`}
          aria-label="Selected event details"
          aria-live="polite"
        >
          {selected ? (
            <>
              <div className="inspector-heading">
                <span className={`severity-badge ${selected.severity}`}>
                  {selected.severity === "critical" ? (
                    <Zap size={14} />
                  ) : (
                    <TriangleAlert size={14} />
                  )}{" "}
                  {selected.severity === "critical"
                    ? "Red · Critical"
                    : "Yellow · Warning"}
                </span>
                <span>Historical report</span>
                <button
                  className="icon-button"
                  aria-label="Clear selected event"
                  onClick={() => onSelect(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <h2>
                {selected.imuId
                  ? `IMU ${selected.imuId}`
                  : "Sensor not supplied"}
              </h2>
              <div className="inspector-magnitude">
                {selected.magnitude === null
                  ? "Not supplied"
                  : selected.magnitude.toFixed(2)}
                {selected.magnitude !== null && <small> g</small>}
              </div>
              <p>Peak reported resultant acceleration</p>
              <dl>
                <div>
                  <dt>Recorded at</dt>
                  <dd>
                    <time dateTime={new Date(selected.timestamp).toISOString()}>
                      {new Date(selected.timestamp).toLocaleString()}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Event thresholds</dt>
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
                      : "No location supplied · Cannot highlight on map"}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{selected.source}</dd>
                </div>
              </dl>
              <p className="inspector-note">
                An event describes a past impact. Current continuous
                acceleration remains unconfirmed.
              </p>
            </>
          ) : (
            <div className="inspector-empty">
              <Crosshair size={26} />
              <h2>Select an event</h2>
              <p>
                Choose a timeline marker or event row to inspect its original
                readings and highlight its supplied location.
              </p>
            </div>
          )}
        </section>
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Event records</h2>
            <p>Original severity and threshold snapshots · No interpolation</p>
          </div>
          <span>{visible.length} events</span>
        </div>
        <div
          className="table-scroll"
          role="region"
          tabIndex={0}
          aria-label="Event records, scroll horizontally for all fields"
        >
          <table className="events-table analysis-table">
            <thead>
              <tr>
                <th>EVENT / TIME</th>
                <th>SENSOR</th>
                <th>SEVERITY</th>
                <th>PEAK A</th>
                <th>THRESHOLD SNAPSHOT</th>
                <th>GPS LOCATION</th>
              </tr>
            </thead>
            <tbody>
              {[...visible].reverse().map((e) => (
                <tr
                  key={e.id}
                  className={selectedId === e.id ? "selected-event" : ""}
                >
                  <td>
                    <button
                      className="event-select-button"
                      aria-pressed={selectedId === e.id}
                      onClick={() => onSelect(e.id)}
                    >
                      <strong>{time(e.timestamp)}</strong>
                      <small>
                        {new Date(e.timestamp).toLocaleDateString()} ·{" "}
                        {e.source}
                      </small>
                    </button>
                  </td>
                  <td>{e.imuId ? `IMU ${e.imuId}` : "Not supplied"}</td>
                  <td>
                    <span className={`severity-badge ${e.severity}`}>
                      <i />
                      {e.severity === "critical"
                        ? "High impact · Red"
                        : "Moderate · Yellow"}
                    </span>
                  </td>
                  <td>
                    {e.magnitude === null
                      ? "Not supplied"
                      : `${e.magnitude.toFixed(2)} g`}
                  </td>
                  <td>
                    {e.thresholds
                      ? `T1 ${e.thresholds.t1.toFixed(2)} g · T2 ${e.thresholds.t2.toFixed(2)} g`
                      : "Not supplied"}
                  </td>
                  <td>
                    {e.position
                      ? `${e.position.latitude.toFixed(5)}, ${e.position.longitude.toFixed(5)}`
                      : "Not supplied"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className="empty-state">
            <Crosshair size={26} />
            <strong>
              {events.length
                ? "No events match these filters"
                : "No threshold events recorded"}
            </strong>
            <p>Event silence does not confirm safe motion.</p>
            {!!events.length && (
              <button className="button secondary" onClick={reset}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
