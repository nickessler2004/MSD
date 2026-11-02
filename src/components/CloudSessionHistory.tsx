import { useState, type ReactNode } from "react";
import { ArrowUpRight, Clock3, Route, Search, Zap } from "lucide-react";
import type { CloudSession, CloudSnapshot } from "../domain/cloud";
import { reportedPeak } from "../domain/eventAnalysis";
import { routeDistanceKm } from "../domain/cloudRecords";
import { duration } from "../lib/format";
export function CloudSessionHistory({
  sessions,
  snapshot,
  selectedId,
  userId,
  now,
  onSelect,
  onEvents,
  onExport,
  map,
  loading,
  error,
}: {
  sessions: CloudSession[];
  snapshot: CloudSnapshot | null;
  selectedId: string | null;
  userId: string;
  now: number;
  onSelect: (id: string) => void;
  onEvents: () => void;
  onExport: () => void;
  map: ReactNode;
  loading: boolean;
  error: string | null;
}) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const visible = sessions.filter(
    (s) =>
      s.label.toLowerCase().includes(search.toLowerCase()) &&
      (state === "all" || (state === "active" ? !s.ended_at : !!s.ended_at)),
  );
  const peak = snapshot ? reportedPeak(snapshot.events) : null;
  return (
    <section className="history-explorer">
      <div className="history-heading">
        <div>
          <h2>Persistent session history</h2>
          <p>Review a drive, its reported events, and its recorded route.</p>
        </div>
        <span>{sessions.length} sessions</span>
      </div>
      <div className="history-layout">
        <section
          className="card history-browser"
          aria-label="Browse cloud sessions"
        >
          <label className="history-search">
            <Search size={16} />
            <input
              aria-label="Search sessions"
              placeholder="Find a session…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="history-state">
            Session status
            <select
              aria-label="Filter session status"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="all">All sessions</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <div className="history-session-list">
            {visible.map((s) => (
              <button
                className={`history-session ${selectedId === s.id ? "selected" : ""}`}
                key={s.id}
                onClick={() => onSelect(s.id)}
                aria-pressed={selectedId === s.id}
              >
                <div>
                  <strong>{s.label}</strong>
                  <ArrowUpRight size={15} />
                </div>
                <span>{new Date(s.started_at).toLocaleString()}</span>
                <footer>
                  <span>
                    {s.ended_at ? "Completed" : "Active"} ·{" "}
                    {duration(
                      (s.ended_at ? Date.parse(s.ended_at) : now) -
                        Date.parse(s.started_at),
                    )}
                  </span>
                  <span>
                    {s.data_source === "simulated" ? "Simulated" : "Device"} ·{" "}
                    {s.owner_id === userId ? "Owner" : "Read only"}
                  </span>
                </footer>
              </button>
            ))}
          </div>
          {!visible.length && (
            <div className="empty-state">
              <Search size={22} />
              <strong>No matching sessions</strong>
              <p>Try a different name or status.</p>
            </div>
          )}
        </section>
        <section className="history-review" aria-label="Session review">
          {snapshot ? (
            <>
              <div className="history-review-heading">
                <div>
                  <span className="heading-eyebrow">SESSION REVIEW</span>
                  <h2>{snapshot.session.label}</h2>
                  <span>
                    {snapshot.session.data_source === "simulated"
                      ? "Simulated cloud telemetry"
                      : "Device telemetry"}{" "}
                    · {snapshot.session.ended_at ? "Completed" : "Active"}
                  </span>
                </div>
                <button className="button secondary" onClick={onExport}>
                  Export session
                </button>
              </div>
              <div className="history-metrics">
                <div>
                  <Clock3 size={15} />
                  <span>Duration</span>
                  <strong>
                    {duration(
                      (snapshot.session.ended_at
                        ? Date.parse(snapshot.session.ended_at)
                        : now) - Date.parse(snapshot.session.started_at),
                    )}
                  </strong>
                </div>
                <div>
                  <Zap size={15} />
                  <span>Events</span>
                  <strong>{snapshot.events.length}</strong>
                </div>
                <div>
                  <Route size={15} />
                  <span>Recorded distance</span>
                  <strong>
                    {snapshot.gps.length
                      ? `${routeDistanceKm(snapshot.gps).toFixed(2)} km`
                      : "Not supplied"}
                  </strong>
                </div>
                <div>
                  <span>Peak reported A</span>
                  <strong>
                    {peak === null ? "Not supplied" : `${peak.toFixed(2)} g`}
                  </strong>
                </div>
              </div>
              <section className="card history-map">
                <div className="card-heading">
                  <div>
                    <h2>Recorded route</h2>
                    <p>
                      {snapshot.gps.length} GPS fixes · Event markers only where
                      supplied
                    </p>
                  </div>
                </div>
                {map}
              </section>
              <button className="button primary" onClick={onEvents}>
                Review session events <ArrowUpRight size={15} />
              </button>
            </>
          ) : (
            <div className="card empty-state" role="status">
              <Route size={30} />
              <h2>
                {loading
                  ? "Loading session records…"
                  : error
                    ? "Session records unavailable"
                    : "Select a session to review"}
              </h2>
              <p>
                {error
                  ? "Refresh records to retry. Unconfirmed history is not shown."
                  : "Choose an owned or shared drive from the list."}
              </p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
