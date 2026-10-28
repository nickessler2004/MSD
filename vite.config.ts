import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { assertPublicSupabaseEnvironment } from "./src/services/supabaseConfig";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  assertPublicSupabaseEnvironment(loadEnv(mode, process.cwd(), "VITE_"));
  return {
    plugins: [react()],
    test: { include: ["src/**/*.test.{ts,tsx}"] },
  };
});
