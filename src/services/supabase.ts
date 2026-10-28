import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseConfig as parseSupabaseConfig,
  type BuildEnvironment,
} from "./supabaseConfig";
export {
  assertPublicSupabaseEnvironment,
  assertPublicSupabaseEnvironment as assertPublicSupabaseKeys,
} from "./supabaseConfig";
export type { SupabaseConfig } from "./supabaseConfig";

/** Explicit property references prevent Vite from inlining unrelated VITE_* values. */
export function getSupabaseConfig(env?: BuildEnvironment) {
  return parseSupabaseConfig(
    env ?? {
      VITE_SUPABASE_URL: (import.meta as ImportMeta & { env: BuildEnvironment })
        .env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: (
        import.meta as ImportMeta & { env: BuildEnvironment }
      ).env.VITE_SUPABASE_PUBLISHABLE_KEY,
      VITE_SUPABASE_ANON_KEY: (
        import.meta as ImportMeta & { env: BuildEnvironment }
      ).env.VITE_SUPABASE_ANON_KEY,
    },
  );
}

let client: SupabaseClient | null = null;
/** Deliberately lazy: selecting local simulation never creates a cloud connection. */
export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.ready) return null;
  client ??= createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return client;
}
