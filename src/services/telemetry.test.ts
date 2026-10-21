import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelemetryMessage, ThresholdEvent } from "../domain/types";
import { createEventOnlyTelemetrySource } from "./telemetry";

const event: ThresholdEvent = {
  id: "test-impact-1",
  timestamp: 1_700_000_000_000,
  severity: "critical",
  magnitude: 2.1,
  position: { latitude: 37.7793, longitude: -122.4193 },
};

describe("event-only telemetry preview", () => {
  afterEach(() => vi.useRealTimers());

  it("starts disconnected and does not invent continuous readings or green during silence", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = createEventOnlyTelemetrySource().subscribe(listener);
    expect(listener.mock.calls).toEqual([
      [{ type: "connection", connected: false }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(3_600_000);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("delivers sparse test events with provenance without claiming a device connection", () => {
    vi.useFakeTimers();
    const source = createEventOnlyTelemetrySource();
    const messages: TelemetryMessage[] = [];
    source.subscribe((message) => messages.push(message));
    source.emitTestEvent(event);
    vi.advanceTimersByTime(60_000);
    source.emitTestEvent({
      ...event,
      id: "test-impact-2",
      severity: "warning",
      magnitude: null,
      position: null,
    });
    expect(messages).toEqual([
      { type: "connection", connected: false },
      { type: "event", source: "test-event", event },
      {
        type: "event",
        source: "test-event",
        event: {
          ...event,
          id: "test-impact-2",
          severity: "warning",
          magnitude: null,
          position: null,
        },
      },
    ]);
    expect(messages.every((message) => message.type !== "sample")).toBe(true);
  });

  it("preserves the firmware severity even when optional magnitude is absent or different", () => {
    const source = createEventOnlyTelemetrySource();
    const listener = vi.fn();
    source.subscribe(listener);
    source.emitTestEvent({ ...event, severity: "warning", magnitude: 4.2 });
    expect(listener).toHaveBeenLastCalledWith({
      type: "event",
      source: "test-event",
      event: { ...event, severity: "warning", magnitude: 4.2 },
    });
    source.emitTestEvent({ ...event, magnitude: null, position: null });
    expect(listener).toHaveBeenLastCalledWith({
      type: "event",
      source: "test-event",
      event: { ...event, magnitude: null, position: null },
    });
  });

  it.each([
    { id: "" },
    { timestamp: Number.NaN },
    { timestamp: Number.POSITIVE_INFINITY },
    { timestamp: 0 },
    { timestamp: -1 },
    { severity: "normal" },
    { magnitude: -0.1 },
    { magnitude: Number.NaN },
    { magnitude: Number.POSITIVE_INFINITY },
    { position: { latitude: 91, longitude: 0 } },
    { position: { latitude: 0, longitude: -181 } },
    { position: { latitude: Number.NaN, longitude: 0 } },
  ])(
    "rejects invalid event fields without notifying consumers: %j",
    (override) => {
      const source = createEventOnlyTelemetrySource();
      const listener = vi.fn();
      source.subscribe(listener);
      listener.mockClear();
      expect(() =>
        source.emitTestEvent({ ...event, ...override } as ThresholdEvent),
      ).toThrow(TypeError);
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it("cleans up subscriptions independently and supports repeated unsubscribe", () => {
    const source = createEventOnlyTelemetrySource();
    const listener = vi.fn();
    const first = source.subscribe(listener);
    const second = source.subscribe(listener);
    listener.mockClear();
    first();
    first();
    source.emitTestEvent(event);
    expect(listener).toHaveBeenCalledTimes(1);
    second();
    source.emitTestEvent(event);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("copies event payloads so callers and consumers cannot mutate other deliveries", () => {
    const source = createEventOnlyTelemetrySource();
    const observed: TelemetryMessage[] = [];
    source.subscribe((message) => {
      if (message.type === "event" && message.event.position)
        message.event.position.latitude = 0;
    });
    source.subscribe((message) => observed.push(message));
    const original = structuredClone(event);
    source.emitTestEvent(original);
    expect(original).toEqual(event);
    expect(observed.at(-1)).toEqual({
      type: "event",
      source: "test-event",
      event,
    });
  });
});
