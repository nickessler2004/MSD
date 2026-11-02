import { useState } from "react";
import type { GpsPoint } from "../domain/cloud";

/** Plots only supplied GPS measurements; missing samples break the trace. */
export function ObserverInstruments({ gps }: { gps: GpsPoint[] }) {
  const [range, setRange] = useState("all");
  const end = gps.at(-1) ? Date.parse(gps.at(-1)!.recorded_at) : 0;
  const points =
    range === "all"
      ? gps
      : gps.filter(
          (p) => Date.parse(p.recorded_at) >= end - Number(range) * 1000,
        );
  const start = points[0] ? Date.parse(points[0].recorded_at) : end;
  return (
    <section
      className="observer-instruments"
      aria-label="Recorded GPS instruments"
    >
      <div className="instrument-toolbar">
        <strong>Recorded telemetry</strong>
        <label>
          Window{" "}
          <select
            aria-label="GPS chart window"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="all">Full session</option>
            <option value="10">10 s</option>
            <option value="60">60 s</option>
          </select>
        </label>
      </div>
      {(
        [
          ["Speed", "km/h", "speed_kph", "#b48bd0"],
          ["GPS quality", "m accuracy", "accuracy_m", "#d9b65f"],
        ] as const
      ).map(([title, unit, key, color]) => {
        const values = points.flatMap((p) =>
          typeof p[key] === "number" ? [p[key] as number] : [],
        );
        const max = Math.max(1, ...values);
        let pen = false;
        const path = points
          .map((p) => {
            const value = p[key];
            if (value == null) {
              pen = false;
              return "";
            }
            const x =
              48 +
              ((Date.parse(p.recorded_at) - start) / Math.max(1, end - start)) *
                900;
            const y = 108 - (value / max) * 72;
            const command = `${pen ? "L" : "M"}${x},${y}`;
            pen = true;
            return command;
          })
          .join(" ");
        return (
          <div className="instrument-panel" key={key}>
            <header>
              <h3>{title}</h3>
              <span style={{ color }}>━ GPS · {unit}</span>
            </header>
            <div className="instrument-scale">
              <span>{max.toFixed(1)}</span>
              <span>0</span>
            </div>
            <svg
              viewBox="0 0 1000 138"
              role="img"
              aria-label={`${title}: ${values.length} supplied measurements`}
              preserveAspectRatio="none"
            >
              <text x="8" y="43">
                {max.toFixed(1)}
              </text>
              <text x="8" y="112">
                0
              </text>
              <path
                d={path}
                stroke={color}
                fill="none"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {points.map((p) =>
                p[key] == null ? null : (
                  <circle
                    key={p.id}
                    cx={
                      48 +
                      ((Date.parse(p.recorded_at) - start) /
                        Math.max(1, end - start)) *
                        900
                    }
                    cy={108 - ((p[key] as number) / max) * 72}
                    r="2.5"
                    fill={color}
                  />
                ),
              )}
            </svg>
            {!values.length && (
              <p className="instrument-empty">
                No supplied {title.toLowerCase()} measurements
              </p>
            )}
          </div>
        );
      })}
      <div className="instrument-time">
        <span>
          {points[0] ? new Date(start).toLocaleTimeString() : "No GPS fixes"}
        </span>
        <span>{points.length} recorded fixes · Source timestamps</span>
        <span>{points.length ? new Date(end).toLocaleTimeString() : "—"}</span>
      </div>
    </section>
  );
}
