import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type AuthState = {
  client: SupabaseClient | null;
  user: User | null;
  initializing: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
};

/** Only the Supabase auth session establishes an authenticated cloud identity. */
export function useCloudAuth(client: SupabaseClient | null) {
  const epoch = useRef(0);
  const authRevision = useRef(0);
  const [state, setState] = useState<AuthState>({
    client,
    user: null,
    initializing: client !== null,
    busy: false,
    error: null,
    notice: null,
  });

  useEffect(() => {
    const generation = ++epoch.current;
    authRevision.current += 1;
    setState({
      client,
      user: null,
      initializing: client !== null,
      busy: false,
      error: null,
      notice: null,
    });
    if (!client) return;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (epoch.current !== generation) return;
      authRevision.current += 1;
      setState((old) => ({
        ...old,
        client,
        user: session?.user ?? null,
        initializing: false,
        error: null,
      }));
    });
    const initialRevision = authRevision.current;
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (
          epoch.current !== generation ||
          authRevision.current !== initialRevision
        )
          return;
        setState((old) => ({
          ...old,
          client,
          user: data.session?.user ?? null,
          initializing: false,
          error: error?.message ?? null,
        }));
      })
      .catch((error: unknown) => {
        if (
          epoch.current !== generation ||
          authRevision.current !== initialRevision
        )
          return;
        setState((old) => ({
          ...old,
          initializing: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not restore the cloud sign-in session.",
        }));
      });
    return () => {
      epoch.current += 1;
      subscription.unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      if (!client) return false;
      const generation = epoch.current;
      setState((old) => ({ ...old, busy: true, error: null, notice: null }));
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (epoch.current !== generation) return false;
        if (error) throw error;
        authRevision.current += 1;
        setState((old) => ({
          ...old,
          client,
          user: data.user,
          initializing: false,
          busy: false,
        }));
        return true;
      } catch (error) {
        if (epoch.current === generation)
          setState((old) => ({
            ...old,
            busy: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not sign in. Please try again.",
          }));
        return false;
      }
    },
    [client],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      if (!client) return false;
      const generation = epoch.current;
      setState((old) => ({ ...old, busy: true, error: null, notice: null }));
      try {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (epoch.current !== generation) return false;
        if (error) throw error;
        authRevision.current += 1;
        setState((old) => ({
          ...old,
          client,
          user: data.session?.user ?? null,
          initializing: false,
          busy: false,
          notice: data.session
            ? "Account created. You are signed in."
            : "Check your email to confirm your account, then return here to sign in.",
        }));
        return true;
      } catch (error) {
        if (epoch.current === generation)
          setState((old) => ({
            ...old,
            busy: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not create an account. Please try again.",
          }));
        return false;
      }
    },
    [client],
  );

  const signOut = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    const generation = epoch.current;
    setState((old) => ({ ...old, busy: true, error: null, notice: null }));
    try {
      const { error } = await client.auth.signOut();
      if (epoch.current !== generation) return false;
      if (error) throw error;
      authRevision.current += 1;
      setState((old) => ({
        ...old,
        user: null,
        initializing: false,
        busy: false,
      }));
      return true;
    } catch (error) {
      if (epoch.current === generation)
        setState((old) => ({
          ...old,
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not sign out. Please try again.",
        }));
      return false;
    }
  }, [client]);

  const current = state.client === client;
  return {
    user: current ? state.user : null,
    loading: current ? state.initializing || state.busy : client !== null,
    error: current ? state.error : null,
    notice: current ? state.notice : null,
    signIn,
    signUp,
    signOut,
  };
}
