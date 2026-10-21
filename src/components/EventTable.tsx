import { MapPin, ShieldCheck, Zap } from "lucide-react";
import type { ImpactEvent } from "../domain/types";
import { date, time } from "../lib/format";

export function EventTable({
  events,
  compact = false,
}: {
  events: ImpactEvent[];
  compact?: boolean;
}) {
  const visible = compact ? events.slice(0, 4) : events;
  return (
    <div className="table-scroll">
      <table className="events-table">
        <thead>
          <tr>
            <th>EVENT / TIME</th>
            <th>SEVERITY</th>
            <th>PEAK FORCE</th>
            <th>GPS LOCATION</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((event) => (
            <tr key={event.id}>
              <td>
                <div className="event-time">
                  <span className={`event-icon ${event.severity}`}>
                    <Zap size={15} />
                  </span>
                  <div>
                    <strong>{time(event.timestamp)}</strong>
                    <span>{date(event.timestamp)} · Simulated</span>
                  </div>
                </div>
              </td>
              <td>
                <span className={`severity-badge ${event.severity}`}>
                  <i />
                  {event.severity === "critical" ? "High impact" : "Moderate"}
                </span>
              </td>
              <td className="number-cell">
                {event.magnitude.toFixed(2)} <span>g</span>
              </td>
              <td>
                <span className="location-cell">
                  <MapPin size={13} />
                  {event.position.latitude.toFixed(4)},{" "}
                  {event.position.longitude.toFixed(4)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 && (
        <div className="empty-state">
          <ShieldCheck size={30} />
          <strong>No impacts recorded</strong>
          <p>New events will appear here when a threshold is crossed.</p>
        </div>
      )}
    </div>
  );
}
