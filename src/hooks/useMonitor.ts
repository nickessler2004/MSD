import { useCallback, useEffect, useRef, useState } from "react";
import { getSimulatedSample } from "../services/telemetry";
import { DEMO_EVENTS, DEMO_SESSIONS } from "../data/demo";
import {
  classifyMagnitude,
  getMagnitude,
  haversineDistanceKm,
} from "../domain/monitoring";
import type {
  DrivingSession,
  ImpactEvent,
  TelemetrySample,
  Thresholds,
} from "../domain/types";

export function useMonitor() {
  const [available, setAvailable] = useState(true);
  const [thresholds, setThresholds] = useState<Thresholds>({
    t1: 0.8,
    t2: 1.8,
  });
  const [session, setSession] = useState<DrivingSession>(() => ({
    id: `session-${Date.now()}`,
    startedAt: Date.now(),
    endedAt: null,
    distanceKm: 0,
    impactCount: 0,
    maxMagnitude: 0,
  }));
  const [sessions, setSessions] = useState<DrivingSession[]>(DEMO_SESSIONS);
  const [events, setEvents] = useState<ImpactEvent[]>(DEMO_EVENTS);
  const [sample, setSample] = useState<TelemetrySample>(() =>
    getSimulatedSample(0, session.startedAt),
  );
  const [history, setHistory] = useState<TelemetrySample[]>([]);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState("");
  const impactUntil = useRef(0);
  const activeEventId = useRef<string | null>(null);
  const previousPosition = useRef<TelemetrySample | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const timer = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (!available) {
        previousPosition.current = null;
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
      const distance = previousPosition.current
        ? haversineDistanceKm(previousPosition.current.position, next.position)
        : 0;
      previousPosition.current = next;
      setSample(next);
      setHistory((old) => [...old.slice(-47), next]);
      const isImpact = status === "critical" || status === "warning";
      const isNewEvent = isImpact && activeEventId.current === null;
      if (isImpact) {
        if (isNewEvent) {
          const id = crypto.randomUUID();
          activeEventId.current = id;
          setEvents((old) => [
            {
              id,
              timestamp,
              position: { ...next.position },
              magnitude,
              severity: status,
              sessionId: currentSession.id,
            },
            ...old,
          ]);
        } else {
          const id = activeEventId.current;
          setEvents((old) =>
            old.map((event) => {
              if (event.id !== id) return event;
              const isPeak = magnitude > event.magnitude;
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
            }),
          );
        }
      } else activeEventId.current = null;
      setSession((old) => ({
        ...old,
        distanceKm: old.distanceKm + distance,
        maxMagnitude: Math.max(old.maxMagnitude, magnitude),
        impactCount: old.impactCount + (isNewEvent ? 1 : 0),
      }));
    }, 500);
    return () => window.clearInterval(timer);
  }, [available, thresholds]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const simulateImpact = useCallback(() => {
    if (!available) return;
    impactUntil.current = Date.now() + 2500;
    setNotice("Impact injected into the simulated data feed.");
  }, [available]);

  function newSession() {
    const timestamp = Date.now();
    setSessions((old) => [{ ...session, endedAt: timestamp }, ...old]);
    const next = {
      id: `session-${timestamp}`,
      startedAt: timestamp,
      endedAt: null,
      distanceKm: 0,
      impactCount: 0,
      maxMagnitude: 0,
    };
    setSession(next);
    setHistory([]);
    setSample(getSimulatedSample(0, timestamp));
    previousPosition.current = null;
    impactUntil.current = 0;
    activeEventId.current = null;
    setNotice("Previous session saved. A new driving session is recording.");
  }

  function exportData() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 1,
            source: "simulation",
            exportedAt: new Date().toISOString(),
            thresholds,
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
    link.download = `msd-simulation-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Simulation data exported as JSON.");
  }

  return {
    available,
    setAvailable,
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
      available ? getMagnitude(sample.acceleration) : null,
      thresholds,
    ),
  };
}
