import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudSession, CloudSnapshot } from "../domain/cloud";
import type { CloudRepository } from "../services/cloudRepository";

type RealtimeStatus = "connecting" | "subscribed" | "error" | "closed";
type CloudState = {
  repository: CloudRepository | null;
  userId: string | null;
  sessions: CloudSession[];
  selectedId: string | null;
  snapshot: CloudSnapshot | null;
  listLoading: boolean;
  snapshotLoading: boolean;
  listError: string | null;
  snapshotError: string | null;
  realtimeStatus: RealtimeStatus;
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not load cloud records. Please retry.";

/**
 * Owns the observer subscription, bounded reconciliation polling, and snapshot
 * lifetime. Auth/selection changes invalidate pending work before it can be shown.
 */
export function useCloudSession(
  repository: CloudRepository | null,
  userId: string | null,
) {
  const contextEpoch = useRef(0);
  const selectionEpoch = useRef(0);
  const listRequest = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const snapshotController = useRef<{
    context: number;
    selection: number;
    id: string;
    reload: () => Promise<void>;
  } | null>(null);
  const [state, setState] = useState<CloudState>({
    repository,
    userId,
    sessions: [],
    selectedId: null,
    snapshot: null,
    listLoading: Boolean(repository && userId),
    snapshotLoading: false,
    listError: null,
    snapshotError: null,
    realtimeStatus: "closed",
  });

  const refreshSessions = useCallback(async (): Promise<void> => {
    if (!repository || !userId) return;
    const context = contextEpoch.current;
    const request = ++listRequest.current;
    try {
      const sessions = await repository.listSessions();
      if (contextEpoch.current !== context || listRequest.current !== request)
        return;
      const previous = selectedRef.current;
      const next = sessions.some((session) => session.id === previous)
        ? previous
        : (sessions[0]?.id ?? null);
      if (next !== previous) {
        selectedRef.current = next;
        selectionEpoch.current += 1;
      }
      setState((old) =>
        contextEpoch.current !== context ||
        old.repository !== repository ||
        old.userId !== userId
          ? old
          : {
              ...old,
              sessions,
              selectedId: next,
              listLoading: false,
              listError: null,
              snapshot: next === previous ? old.snapshot : null,
              snapshotLoading:
                next !== null && (next !== previous || old.snapshotLoading),
              snapshotError: next === previous ? old.snapshotError : null,
            },
      );
    } catch (error) {
      if (contextEpoch.current !== context || listRequest.current !== request)
        return;
      // Never continue displaying a cached route as current after a failed access check.
      setState((old) =>
        old.repository !== repository || old.userId !== userId
          ? old
          : {
              ...old,
              listLoading: false,
              snapshotLoading: false,
              listError: errorMessage(error),
              snapshot: null,
            },
      );
    }
  }, [repository, userId]);

  const setSelectedId = useCallback(
    (id: string | null) => {
      if (!repository || !userId || id === selectedRef.current) return;
      selectedRef.current = id;
      selectionEpoch.current += 1;
      setState((old) =>
        old.repository !== repository || old.userId !== userId
          ? old
          : {
              ...old,
              selectedId: id,
              snapshot: null,
              snapshotLoading: id !== null,
              snapshotError: null,
              realtimeStatus: id ? "connecting" : "closed",
            },
      );
    },
    [repository, userId],
  );

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const controller = snapshotController.current;
    if (
      controller &&
      controller.context === contextEpoch.current &&
      controller.selection === selectionEpoch.current &&
      controller.id === selectedRef.current
    )
      await controller.reload();
  }, []);

  useEffect(() => {
    const context = ++contextEpoch.current;
    selectionEpoch.current += 1;
    listRequest.current += 1;
    selectedRef.current = null;
    snapshotController.current = null;
    setState({
      repository,
      userId,
      sessions: [],
      selectedId: null,
      snapshot: null,
      listLoading: Boolean(repository && userId),
      snapshotLoading: false,
      listError: null,
      snapshotError: null,
      realtimeStatus: "closed",
    });
    if (!repository || !userId) return;
    void refreshSessions();
    const poll = window.setInterval(() => {
      void refreshSessions();
      void refreshSnapshot();
    }, 10_000);
    return () => {
      if (contextEpoch.current === context) contextEpoch.current += 1;
      selectionEpoch.current += 1;
      listRequest.current += 1;
      window.clearInterval(poll);
    };
  }, [repository, userId, refreshSessions, refreshSnapshot]);

  const currentContext =
    state.repository === repository && state.userId === userId;
  const selectedId = currentContext ? state.selectedId : null;

  useEffect(() => {
    if (!repository || !userId || !selectedId) return;
    const context = contextEpoch.current;
    const selection = selectionEpoch.current;
    let disposed = false;
    let pending = false;
    let running: Promise<void> | null = null;
    const active = () =>
      !disposed &&
      contextEpoch.current === context &&
      selectionEpoch.current === selection &&
      selectedRef.current === selectedId;
    const commit = (update: (old: CloudState) => CloudState) => {
      if (!active()) return;
      setState((old) =>
        active() &&
        old.repository === repository &&
        old.userId === userId &&
        old.selectedId === selectedId
          ? update(old)
          : old,
      );
    };
    const reload = (): Promise<void> => {
      if (!active()) return Promise.resolve();
      pending = true;
      if (running) return running;
      running = (async () => {
        while (pending && active()) {
          pending = false;
          commit((old) => ({ ...old, snapshotLoading: old.snapshot === null }));
          try {
            const snapshot = await repository.loadSnapshot(selectedId);
            if (!active()) return;
            if (snapshot.session.id !== selectedId)
              throw new Error(
                "Received records for a different driving session.",
              );
            commit((old) => ({
              ...old,
              snapshot,
              snapshotLoading: false,
              snapshotError: null,
            }));
          } catch (error) {
            if (!active()) return;
            commit((old) => ({
              ...old,
              snapshot: null,
              snapshotLoading: false,
              snapshotError: errorMessage(error),
            }));
            // A network failure must not spin on already queued invalidations.
            pending = false;
          }
        }
      })().finally(() => {
        running = null;
      });
      return running;
    };
    snapshotController.current = { context, selection, id: selectedId, reload };
    commit((old) => ({
      ...old,
      snapshot: null,
      snapshotLoading: true,
      snapshotError: null,
      realtimeStatus: "connecting",
    }));
    // Register before requesting the snapshot. A change during that request queues
    // a second read; subscription/reconnect acknowledgments also reconcile gaps.
    let unsubscribe = () => {};
    try {
      unsubscribe = repository.watchSession(
        selectedId,
        () => {
          void reload();
        },
        (status) => {
          commit((old) => ({ ...old, realtimeStatus: status }));
          if (status === "subscribed") void reload();
        },
      );
      void reload();
    } catch (error) {
      commit((old) => ({
        ...old,
        snapshotLoading: false,
        snapshot: null,
        snapshotError: errorMessage(error),
        realtimeStatus: "error",
      }));
    }
    return () => {
      disposed = true;
      pending = false;
      unsubscribe();
      if (
        snapshotController.current?.context === context &&
        snapshotController.current.selection === selection
      )
        snapshotController.current = null;
    };
  }, [repository, userId, selectedId]);

  return {
    sessions: currentContext ? state.sessions : [],
    selectedId,
    setSelectedId,
    snapshot:
      currentContext && state.snapshot?.session.id === selectedId
        ? state.snapshot
        : null,
    loading: currentContext
      ? state.listLoading || state.snapshotLoading
      : Boolean(repository && userId),
    error: currentContext ? (state.listError ?? state.snapshotError) : null,
    realtimeStatus: currentContext
      ? state.realtimeStatus
      : ("closed" as RealtimeStatus),
    refreshSessions,
    refreshSnapshot,
  };
}
