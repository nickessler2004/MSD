import { Route } from "lucide-react";
import type { DrivingSession } from "../domain/types";
import { date, time, duration } from "../lib/format";

export function SessionTable({
  sessions,
  now,
}: {
  sessions: DrivingSession[];
  now: number;
}) {
  return (
    <div className="table-scroll">
      <table className="events-table session-table">
        <thead>
          <tr>
            <th>SESSION</th>
            <th>DURATION</th>
            <th>DISTANCE</th>
            <th>IMPACTS</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session, index) => (
            <tr key={session.id}>
              <td>
                <div className="event-time">
                  <span className="event-icon session-icon">
                    <Route size={16} />
                  </span>
                  <div>
                    <strong>
                      {date(session.startedAt)} · {time(session.startedAt)}
                    </strong>
                    <span>
                      {session.source === "simulation"
                        ? "Simulated"
                        : "Event-only preview"}{" "}
                      ·{" "}
                      {session.endedAt
                        ? `Drive ${sessions.length - index}`
                        : "Current driving session"}
                    </span>
                  </div>
                </div>
              </td>
              <td className="number-cell">
                {duration((session.endedAt ?? now) - session.startedAt)}
              </td>
              <td className="number-cell">
                {session.distanceKm === null ? (
                  "Not available"
                ) : (
                  <>
                    {session.distanceKm.toFixed(2)} <span>km</span>
                  </>
                )}
              </td>
              <td>{session.impactCount}</td>
              <td>
                <span
                  className={`severity-badge ${session.endedAt ? "completed" : "normal"}`}
                >
                  <i />
                  {session.endedAt ? "Completed" : "Recording"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
