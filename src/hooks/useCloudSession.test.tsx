// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudSession, CloudSnapshot } from "../domain/cloud";
import type {
  CloudRepository,
  RealtimeState,
} from "../services/cloudRepository";
import { useCloudSession } from "./useCloudSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function session(id: string, owner = "owner-a"): CloudSession {
  return {
    id,
    owner_id: owner,
    label: id,
    started_at: "2026-10-21T12:00:00Z",
    ended_at: null,
    data_source: "simulated",
    created_at: "2026-10-21T12:00:00Z",
  };
}
function snapshot(id: string, sequence?: number): CloudSnapshot {
  return {
    session: session(id),
    gps:
      sequence === undefined
        ? []
        : [
            {
              id: `gps-${sequence}`,
              session_id: id,
              sequence,
              recorded_at: "2026-10-21T12:00:01Z",
              received_at: "2026-10-21T12:00:01Z",
              latitude: 37,
              longitude: -122,
              speed_kph: 30,
              heading: 0,
            },
          ],
    events: [],
    connection: null,
    thresholds: [],
    observers: [],
  };
}
function repositoryFixture(
  rows = [session("session-a"), session("session-b")],
) {
  const order: string[] = [];
  const subscriptions: Array<{
    id: string;
    change: () => void;
    status: (state: RealtimeState) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }> = [];
  const methods = {
    listSessions: vi.fn(async () => rows),
    loadSnapshot: vi.fn(async (id: string) => {
      order.push(`load:${id}`);
      return snapshot(id);
    }),
    watchSession: vi.fn(
      (
        id: string,
        change: () => void,
        status: (state: RealtimeState) => void,
      ) => {
        order.push(`watch:${id}`);
        const subscription = { id, change, status, unsubscribe: vi.fn() };
        subscriptions.push(subscription);
        status("connecting");
        return subscription.unsubscribe;
      },
    ),
  };
  return {
    repository: methods as unknown as CloudRepository,
    methods,
    order,
    subscriptions,
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("cloud observer synchronization", () => {
  it("registers realtime before loading and reconciles a change received during the initial snapshot", async () => {
    const fixture = repositoryFixture();
    const first = deferred<CloudSnapshot>();
    fixture.methods.loadSnapshot
      .mockImplementationOnce(async (id) => {
        fixture.order.push(`load:${id}`);
        return first.promise;
      })
      .mockImplementationOnce(async (id) => snapshot(id, 2));
    const { result } = renderHook(() =>
      useCloudSession(fixture.repository, "owner-a"),
    );
    await waitFor(() =>
      expect(fixture.methods.loadSnapshot).toHaveBeenCalledTimes(1),
    );
    expect(fixture.order.slice(0, 2)).toEqual([
      "watch:session-a",
      "load:session-a",
    ]);
    act(() => fixture.subscriptions[0].change());
    await act(async () => first.resolve(snapshot("session-a", 1)));
    await waitFor(() =>
      expect(result.current.snapshot?.gps[0]?.sequence).toBe(2),
    );
    expect(fixture.methods.loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it("never replaces the selected session with a slow response from an old selection", async () => {
    const fixture = repositoryFixture();
    const first = deferred<CloudSnapshot>();
    fixture.methods.loadSnapshot.mockImplementationOnce(
      async () => first.promise,
    );
    const { result } = renderHook(() =>
      useCloudSession(fixture.repository, "owner-a"),
    );
    await waitFor(() =>
      expect(fixture.methods.loadSnapshot).toHaveBeenCalledWith("session-a"),
    );
    act(() => result.current.setSelectedId("session-b"));
    await waitFor(() =>
      expect(result.current.snapshot?.session.id).toBe("session-b"),
    );
    await act(async () => first.resolve(snapshot("session-a", 9)));
    expect(result.current.snapshot?.session.id).toBe("session-b");
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("clears records on sign-out and ignores an earlier user's in-flight response", async () => {
    const fixture = repositoryFixture();
    const first = deferred<CloudSnapshot>();
    fixture.methods.loadSnapshot.mockImplementationOnce(
      async () => first.promise,
    );
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) =>
        useCloudSession(fixture.repository, userId),
      { initialProps: { userId: "owner-a" as string | null } },
    );
    await waitFor(() =>
      expect(fixture.methods.loadSnapshot).toHaveBeenCalledTimes(1),
    );
    rerender({ userId: null });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.selectedId).toBeNull();
    await act(async () => first.resolve(snapshot("session-a", 9)));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.realtimeStatus).toBe("closed");
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not expose one user's session when switching directly to another user", async () => {
    const fixture = repositoryFixture([session("session-a")]);
    const { result, rerender } = renderHook(
      ({ userId }) => useCloudSession(fixture.repository, userId),
      { initialProps: { userId: "owner-a" } },
    );
    await waitFor(() =>
      expect(result.current.snapshot?.session.id).toBe("session-a"),
    );
    fixture.methods.listSessions.mockResolvedValue([
      session("session-b", "owner-b"),
    ]);
    rerender({ userId: "owner-b" });
    expect(result.current.snapshot?.session.id).not.toBe("session-a");
    await waitFor(() =>
      expect(result.current.snapshot?.session.id).toBe("session-b"),
    );
  });

  it("clears a previously loaded route when access or a snapshot refresh fails", async () => {
    const fixture = repositoryFixture();
    const { result } = renderHook(() =>
      useCloudSession(fixture.repository, "owner-a"),
    );
    await waitFor(() =>
      expect(result.current.snapshot?.session.id).toBe("session-a"),
    );
    fixture.methods.loadSnapshot.mockRejectedValueOnce(
      new Error("Session access revoked"),
    );
    await act(async () => result.current.refreshSnapshot());
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBe("Session access revoked");
    expect(result.current.loading).toBe(false);
  });

  it("reloads after realtime reconnect to recover events missed during an outage", async () => {
    const fixture = repositoryFixture();
    const { result } = renderHook(() =>
      useCloudSession(fixture.repository, "owner-a"),
    );
    await waitFor(() =>
      expect(result.current.snapshot?.session.id).toBe("session-a"),
    );
    act(() => fixture.subscriptions[0].status("error"));
    expect(result.current.realtimeStatus).toBe("error");
    fixture.methods.loadSnapshot.mockResolvedValueOnce(
      snapshot("session-a", 3),
    );
    act(() => fixture.subscriptions[0].status("subscribed"));
    await waitFor(() =>
      expect(result.current.snapshot?.gps[0]?.sequence).toBe(3),
    );
    expect(result.current.realtimeStatus).toBe("subscribed");
  });

  it("cleans up the realtime channel and reconciliation interval, rejecting late callbacks", async () => {
    const clearInterval = vi.spyOn(window, "clearInterval");
    const fixture = repositoryFixture();
    const { result, unmount } = renderHook(() =>
      useCloudSession(fixture.repository, "owner-a"),
    );
    await waitFor(() =>
      expect(result.current.snapshot?.session.id).toBe("session-a"),
    );
    const calls = fixture.methods.loadSnapshot.mock.calls.length;
    unmount();
    expect(fixture.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(clearInterval).toHaveBeenCalled();
    fixture.subscriptions[0].change();
    fixture.subscriptions[0].status("subscribed");
    expect(fixture.methods.loadSnapshot).toHaveBeenCalledTimes(calls);
  });
});
