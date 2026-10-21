import { describe, expect, it } from "vitest";
import { getFreshness, TELEMETRY_STALE_AFTER_MS } from "./freshness";

describe("telemetry receipt freshness", () => {
  const now = 100_000;

  it("requires an actual receipt before reporting freshness", () => {
    expect(getFreshness({ connected: true, lastReceivedAt: null, now })).toBe(
      "waiting",
    );
  });

  it("is fresh through the timeout and stale immediately afterwards", () => {
    expect(getFreshness({ connected: true, lastReceivedAt: now, now })).toBe(
      "fresh",
    );
    expect(
      getFreshness({
        connected: true,
        lastReceivedAt: now - TELEMETRY_STALE_AFTER_MS,
        now,
      }),
    ).toBe("fresh");
    expect(
      getFreshness({
        connected: true,
        lastReceivedAt: now - TELEMETRY_STALE_AFTER_MS - 1,
        now,
      }),
    ).toBe("stale");
  });

  it("marks disconnected transport unavailable even after a recent receipt", () => {
    expect(getFreshness({ connected: false, lastReceivedAt: now, now })).toBe(
      "disconnected",
    );
    expect(getFreshness({ connected: false, lastReceivedAt: null, now })).toBe(
      "disconnected",
    );
  });

  it("supports explicit source-specific freshness timeouts", () => {
    expect(
      getFreshness({
        connected: true,
        lastReceivedAt: now - 60_000,
        now,
        staleAfterMs: 60_000,
      }),
    ).toBe("fresh");
    expect(
      getFreshness({
        connected: true,
        lastReceivedAt: now - 60_001,
        now,
        staleAfterMs: 60_000,
      }),
    ).toBe("stale");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, now + 1])(
    "does not trust invalid or future receipt time %s",
    (lastReceivedAt) => {
      expect(getFreshness({ connected: true, lastReceivedAt, now })).toBe(
        "waiting",
      );
    },
  );

  it("does not treat an invalid clock or timeout as fresh data", () => {
    expect(
      getFreshness({ connected: true, lastReceivedAt: now, now: Number.NaN }),
    ).toBe("waiting");
    expect(
      getFreshness({
        connected: true,
        lastReceivedAt: now,
        now,
        staleAfterMs: -1,
      }),
    ).toBe("waiting");
    expect(
      getFreshness({
        connected: true,
        lastReceivedAt: now,
        now,
        staleAfterMs: Number.POSITIVE_INFINITY,
      }),
    ).toBe("waiting");
  });
});
