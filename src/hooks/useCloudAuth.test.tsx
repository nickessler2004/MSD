// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import { useCloudAuth } from "./useCloudAuth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const user = { id: "owner-a", email: "owner@example.com" } as User;
function authFixture(
  initial = Promise.resolve({
    data: { session: null as Session | null },
    error: null,
  }),
) {
  let callback: (
    event: AuthChangeEvent,
    session: Session | null,
  ) => void = () => {};
  const unsubscribe = vi.fn();
  const auth = {
    getSession: vi.fn(() => initial),
    onAuthStateChange: vi.fn((listener: typeof callback) => {
      callback = listener;
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithPassword: vi
      .fn()
      .mockResolvedValue({ data: { user }, error: null }),
    signUp: vi
      .fn()
      .mockResolvedValue({ data: { user, session: null }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    unsubscribe,
    emit: (event: AuthChangeEvent, current: User | null) =>
      callback(event, current ? ({ user: current } as Session) : null),
  };
}
afterEach(() => cleanup());

describe("cloud authentication lifetime", () => {
  it("does not restore an old user when a late getSession resolves after a sign-out notification", async () => {
    const initial = deferred<{
      data: { session: Session | null };
      error: null;
    }>();
    const fixture = authFixture(initial.promise);
    const { result } = renderHook(() => useCloudAuth(fixture.client));
    act(() => fixture.emit("SIGNED_OUT", null));
    await act(async () =>
      initial.resolve({ data: { session: { user } as Session }, error: null }),
    );
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("does not restore an old user after explicit signOut even if no auth notification arrives", async () => {
    const initial = deferred<{
      data: { session: Session | null };
      error: null;
    }>();
    const fixture = authFixture(initial.promise);
    const { result } = renderHook(() => useCloudAuth(fixture.client));
    await act(async () => {
      expect(await result.current.signOut()).toBe(true);
    });
    await act(async () =>
      initial.resolve({ data: { session: { user } as Session }, error: null }),
    );
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("ignores a previous client's auth response after configuration changes", async () => {
    const initial = deferred<{
      data: { session: Session | null };
      error: null;
    }>();
    const first = authFixture(initial.promise);
    const second = authFixture();
    const { result, rerender } = renderHook(
      ({ client }) => useCloudAuth(client),
      { initialProps: { client: first.client } },
    );
    rerender({ client: second.client });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () =>
      initial.resolve({ data: { session: { user } as Session }, error: null }),
    );
    expect(result.current.user).toBeNull();
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("surfaces confirmation requirements and authenticates only when there is a session", async () => {
    const fixture = authFixture();
    const { result } = renderHook(() => useCloudAuth(fixture.client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(
        await result.current.signUp(" owner@example.com ", "test-password"),
      ).toBe(true);
    });
    expect(result.current.user).toBeNull();
    expect(result.current.notice).toMatch(/confirm your account/i);
    expect(fixture.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@example.com" }),
    );
    await act(async () => {
      expect(
        await result.current.signIn(" owner@example.com ", "test-password"),
      ).toBe(true);
    });
    expect(result.current.user?.id).toBe("owner-a");
  });

  it("surfaces auth errors without creating a user and cleans up on unmount", async () => {
    const fixture = authFixture();
    fixture.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: new Error("Invalid credentials"),
    });
    const { result, unmount } = renderHook(() => useCloudAuth(fixture.client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(
        await result.current.signIn("owner@example.com", "invalid-password"),
      ).toBe(false);
    });
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBe("Invalid credentials");
    unmount();
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
