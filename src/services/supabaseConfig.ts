export type BuildEnvironment = Record<string, string | undefined>;
export type SupabaseConfig =
  { ready: true; url: string; key: string } | { ready: false; message: string };

/** Build-time and runtime guard. The error never contains a key value. */
export function assertPublicSupabaseEnvironment(env: BuildEnvironment): void {
  for (const name of [
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]) {
    const key = env[name]?.trim();
    if (!key) continue;
    if (key.startsWith("sb_secret_"))
      throw new Error(
        "Privileged Supabase keys cannot be included in a frontend build. Use a publishable or anon key.",
      );
    if (key.split(".").length === 3) {
      let role: unknown;
      try {
        role = JSON.parse(
          atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        ).role;
      } catch {
        /* Normal validation reports malformed public configuration. */
      }
      if (role !== undefined && role !== "anon")
        throw new Error(
          "Privileged or user-specific Supabase JWTs cannot be included in a frontend build. Use a publishable or anon key.",
        );
    }
  }
}

/** Public project configuration only. A service-role/secret key must never enter a browser build. */
export function getSupabaseConfig(env: BuildEnvironment): SupabaseConfig {
  try {
    assertPublicSupabaseEnvironment(env);
  } catch {
    return {
      ready: false,
      message:
        "Privileged Supabase keys are forbidden in frontend configuration. Use the project publishable key.",
    };
  }
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = (
    env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  )?.trim();
  if (
    !url ||
    !key ||
    /your[-_ ]|placeholder|replace[-_ ]|[<>]/i.test(`${url} ${key}`)
  ) {
    return {
      ready: false,
      message:
        "Cloud mode needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local. Local simulation is available without them.",
    };
  }
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      (parsed.protocol !== "https:" &&
        !(local && parsed.protocol === "http:")) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    )
      throw new Error();
  } catch {
    return {
      ready: false,
      message:
        "Use a valid HTTPS Supabase project URL (HTTP is supported only for local development).",
    };
  }
  if (key.startsWith("sb_secret_"))
    return {
      ready: false,
      message:
        "Privileged Supabase keys are forbidden in frontend configuration. Use the project publishable key.",
    };
  if (!key.startsWith("sb_publishable_")) {
    try {
      const payload = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (payload.role !== "anon")
        return {
          ready: false,
          message:
            "Use a publishable key or the legacy anon key. Service-role keys must never be exposed in frontend code.",
        };
    } catch {
      return {
        ready: false,
        message:
          "The configured key must be a Supabase publishable key or a legacy anon JWT.",
      };
    }
  }
  return { ready: true, url: url.replace(/\/$/, ""), key };
}
