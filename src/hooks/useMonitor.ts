import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEventOnlyTelemetrySource,
  getSimulatedSample,
} from "../services/telemetry";
import { DEMO_EVENTS, DEMO_SESSIONS } from "../data/demo";
import {
  classifyMagnitude,
  DEFAULT_THRESHOLDS,
  getMagnitude,
  haversineDistanceKm,
} from "../domain/monitoring";
import { getFreshness, TELEMETRY_STALE_AFTER_MS } from "../domain/freshness";
import type {
  DrivingSession,
  ImpactEvent,
  TelemetryMode,
  TelemetrySample,
  Thresholds,
} from "../domain/types";

type ModeHistory = {
  session: DrivingSession;
  sessions: DrivingSession[];
  events: ImpactEvent[];
};
function createSession(source: TelemetryMode): DrivingSession {
  return {
    id: crypto.randomUUID(),
    source,
    startedAt: Date.now(),
    endedAt: null,
    distanceKm: source === "simulation" ? 0 : null,
    impactCount: 0,
    maxMagnitude: source === "simulation" ? 0 : null,
  };
}

export function useMonitor(initialMode: TelemetryMode = "simulation") {
  const [mode, updateMode] = useState<TelemetryMode>(initialMode);
  const [connected, updateConnected] = useState(true);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [modeHistories, setModeHistories] = useState<
    Record<TelemetryMode, ModeHistory>
  >(() => ({
    simulation: {
      session: createSession("simulation"),
      sessions: DEMO_SESSIONS,
      events: DEMO_EVENTS,
    },
    "event-only": {
      session: createSession("event-only"),
      sessions: [],
      events: [],
    },
  }));
  const { session, sessions, events } = modeHistories[mode];
  const [sample, setSample] = useState<TelemetrySample | null>(null);
  const [history, setHistory] = useState<TelemetrySample[]>([]);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [lastEventReceivedAt, setLastEventReceivedAt] = useState<number | null>(
    null,
  );
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState("");
  const [testEventSeverity, setTestEventSeverity] = useState<
    "warning" | "critical"
  >("warning");
  const impactUntil = useRef(0);
  const activeEventId = useRef<string | null>(null);
  const previousSample = useRef<TelemetrySample | null>(null);
  const sessionRef = useRef(session);
  const eventSource = useRef<ReturnType<
    typeof createEventOnlyTelemetrySource
  > | null>(null);
  if (!eventSource.current)
    eventSource.current = createEventOnlyTelemetrySource();
  sessionRef.current = session;

  // Event-only transport never invokes the continuous sampler. Local test events
  // exercise this boundary without claiming a connected ESP32 or phone gateway.
  useEffect(() => {
    if (mode !== "event-only") return;
    return eventSource.current!.subscribe((message) => {
      if (message.type === "connection") {
        setDeviceConnected(message.connected);
        return;
      }
      if (message.type !== "event") return;
      const receivedAt = Date.now();
      if (message.source === "device") setLastReceivedAt(receivedAt);
      setLastEventReceivedAt(receivedAt);
      const event: ImpactEvent = {
        ...message.event,
        source: message.source,
        sessionId: sessionRef.current.id,
      };
      setModeHistories((old) => {
        const current = old["event-only"];
        if (current.events.some((item) => item.id === event.id)) return old;
        return {
          ...old,
          "event-only": {
            ...current,
            events: [event, ...current.events],
            session: {
              ...current.session,
              impactCount: current.session.impactCount + 1,
              maxMagnitude:
                event.magnitude === null
                  ? current.session.maxMagnitude
                  : Math.max(
                      current.session.maxMagnitude ?? 0,
                      event.magnitude,
                    ),
            },
          },
        };
      });
    });
  }, [mode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (mode !== "simulation" || !connected || paused) {
        previousSample.current = null;
        activeEventId.current = null;
        return;
      }
      const currentSession = sessionRef.current;
      const next = getSimulatedSample(
        timestamp - currentSession.startedAt,
        currentSession.startedAt,
      );
      if (timestamp < impactUntil.current)
        next.acceleration = { x: 1.74, y: 1.42, z: 0.86 };
      const magnitude = getMagnitude(next.acceleration);
      const status = classifyMagnitude(magnitude, thresholds);
      const previous = previousSample.current;
      const distance =
        previous && timestamp - previous.timestamp <= TELEMETRY_STALE_AFTER_MS
          ? haversineDistanceKm(previous.position, next.position)
          : 0;
      previousSample.current = next;
      setSample(next);
      setLastReceivedAt(timestamp);
      setHistory((old) => [
        ...old.filter((item) => timestamp - item.timestamp < 24_000).slice(-47),
        next,
      ]);
      const isImpact = status === "critical" || status === "warning";
      const isNewEvent = isImpact && activeEventId.current === null;
      if (isNewEvent) activeEventId.current = crypto.randomUUID();
      const eventId = activeEventId.current;
      if (!isImpact) activeEventId.current = null;
      setModeHistories((old) => {
        const current = old.simulation;
        let nextEvents = current.events;
        if (isImpact && isNewEvent) {
          nextEvents = [
            {
              id: eventId!,
              source: "simulation",
              timestamp,
              position: { ...next.position },
              magnitude,
              severity: status,
              sessionId: currentSession.id,
            },
            ...nextEvents,
          ];
        } else if (isImpact) {
          nextEvents = nextEvents.map((event) => {
            if (event.id !== eventId) return event;
            const isPeak = magnitude > (event.magnitude ?? 0);
            const escalated =
              status === "critical" && event.severity === "warning";
            if (!isPeak && !escalated) return event;
            return {
              ...event,
              severity:
                event.severity === "critical" || status === "critical"
                  ? "critical"
                  : "warning",
              ...(isPeak
                ? { magnitude, timestamp, position: { ...next.position } }
                : {}),
            };
          });
        }
        return {
          ...old,
          simulation: {
            ...current,
            events: nextEvents,
            session: {
              ...current.session,
              distanceKm: (current.session.distanceKm ?? 0) + distance,
              maxMagnitude: Math.max(
                current.session.maxMagnitude ?? 0,
                magnitude,
              ),
              impactCount: current.session.impactCount + (isNewEvent ? 1 : 0),
            },
          },
        };
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [mode, connected, paused, thresholds]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function clearLiveData() {
    setSample(null);
    setHistory([]);
    setLastReceivedAt(null);
    previousSample.current = null;
    activeEventId.current = null;
    impactUntil.current = 0;
  }
  function setMode(next: TelemetryMode) {
    if (next === mode) return;
    clearLiveData();
    setPaused(false);
    updateMode(next);
    setNow(Date.now());
  }
  function setAvailable(next: boolean) {
    updateConnected(next);
    clearLiveData();
    setNow(Date.now());
  }
  const freshness = getFreshness({
    connected: mode === "simulation" ? connected : deviceConnected,
    lastReceivedAt,
    now,
  });
  const available =
    mode === "simulation" && freshness === "fresh" && sample !== null;
  const simulateImpact = useCallback(() => {
    if (!available || paused) return;
    impactUntil.current = Date.now() + 2500;
    setNotice("Impact injected into the simulated data feed.");
  }, [available, paused]);
  function injectTestEvent() {
    if (mode !== "event-only") return;
    eventSource.current!.emitTestEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      severity: testEventSeverity,
      magnitude: null,
      position: null,
    });
    setNow(Date.now());
    setNotice("Local test event received. No device is connected.");
  }
  function newSession() {
    const timestamp = Date.now();
    const nextSession = createSession(mode);
    setModeHistories((old) => ({
      ...old,
      [mode]: {
        ...old[mode],
        sessions: [
          { ...old[mode].session, endedAt: timestamp },
          ...old[mode].sessions,
        ],
        session: nextSession,
      },
    }));
    clearLiveData();
    setNow(timestamp);
    setNotice("Previous session saved. A new session has started.");
  }
  function exportData() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 2,
            source: mode,
            exportedAt: new Date().toISOString(),
            thresholds: { ...thresholds, scope: "simulation-only" },
            telemetry: {
              connected: mode === "simulation" ? connected : deviceConnected,
              freshness,
              lastReceivedAt,
              lastEventReceivedAt,
              currentMotionConfirmed: available,
            },
            sessions: [session, ...sessions],
            events,
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
    link.download = `msd-${mode}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Telemetry data exported as JSON.");
  }
  return {
    mode,
    setMode,
    connected: mode === "simulation" ? connected : deviceConnected,
    paused,
    setPaused,
    available,
    setAvailable,
    freshness,
    lastReceivedAt,
    lastEventReceivedAt,
    latestEvent: events[0] ?? null,
    testEventSeverity,
    setTestEventSeverity,
    injectTestEvent,
    thresholds,
    setThresholds,
    session,
    sessions,
    events,
    sample,
    history,
    now,
    notice,
    simulateImpact,
    newSession,
    exportData,
    severity: classifyMagnitude(
      available && sample ? getMagnitude(sample.acceleration) : null,
      thresholds,
    ),
  };
}
