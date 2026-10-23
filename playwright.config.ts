import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5175",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: existsSync("/usr/bin/chromium")
      ? { executablePath: "/usr/bin/chromium" }
      : {},
  },
  webServer: {
    command: "npm run dev -- --port 5175 --strictPort",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: !process.env.CI,
    env: {
      // Public, nonfunctional fixtures are intercepted by cloud browser tests only.
      VITE_SUPABASE_URL: "https://msd-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_msd_browser_test_fixture",
    },
    timeout: 30_000,
  },
});
