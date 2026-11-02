import type { CloudThresholdEvent, GpsPoint } from "../domain/cloud";

export function MobileObserverOverview({
  fix,
  gpsLive,
  fixAge,
  events,
}: {
  fix: GpsPoint | null;
  gpsLive: boolean;
  fixAge: string;
  events: CloudThresholdEvent[];
}) {
  const latest = events.at(-1);
  return (
    <section
      className="mobile-observer-overview"
      aria-label="Mobile session overview"
    >
      <div className="mobile-overview-heading">
        <h1>Overview</h1>
        <span>Current readings & reported events</span>
      </div>
      <dl className="mobile-gps-summary">
        <div>
          <dt>GPS</dt>
          <dd>{gpsLive ? "Recent fix" : "Unavailable"}</dd>
          <small>{fixAge}</small>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>
            {gpsLive && fix?.speed_kph != null
              ? `${fix.speed_kph.toFixed(1)} km/h`
              : "—"}
          </dd>
          <small>{gpsLive ? "Source GPS" : "No current GPS"}</small>
        </div>
        <div>
          <dt>Position</dt>
          <dd>
            {gpsLive && fix
              ? `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>
            {gpsLive && fix?.accuracy_m != null
              ? `±${fix.accuracy_m.toFixed(1)} m`
              : "—"}
          </dd>
        </div>
      </dl>
      <section className="mobile-imu-summary" aria-label="IMU summary">
        <h2>
          IMUs <span>Current measurements unavailable</span>
        </h2>
        <div>
          {([1, 2, 3] as const).map((id) => {
            const event = events.filter((e) => e.imu_id === id).at(-1);
            return (
              <article key={id}>
                <h3>IMU {id}</h3>
                <p>
                  <i />
                  Unknown
                </p>
                <strong>
                  {event?.magnitude != null
                    ? `${event.magnitude.toFixed(2)} g`
                    : "—"}
                </strong>
                <small>Last reported peak</small>
              </article>
            );
          })}
        </div>
        <p>Event-only data · Silence does not confirm safe motion.</p>
      </section>
      <section
        className="mobile-latest-event"
        aria-label="Latest reported event"
      >
        <h2>
          Latest event <span>Historical report</span>
        </h2>
        {latest ? (
          <>
            <strong className={`severity-badge ${latest.severity}`}>
              {latest.severity === "critical" ? "High impact" : "Moderate"} ·
              IMU {latest.imu_id}
            </strong>
            <p>
              {latest.magnitude != null
                ? `${latest.magnitude.toFixed(2)} g`
                : "Magnitude not supplied"}{" "}
              · {new Date(latest.recorded_at).toLocaleTimeString()}
            </p>
          </>
        ) : (
          <p>No event received. Current motion remains unknown.</p>
        )}
      </section>
    </section>
  );
}
