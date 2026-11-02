import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  testDir: "./tests-pwa",
  outputDir: "work/pwa-browser-results",
  workers: 1,
  timeout: 30000,
  expect: { timeout: 7000 },
  use: {
    ...base.use,
    baseURL: "http://127.0.0.1:5177",
    serviceWorkers: "allow",
  },
  webServer: {
    command:
      "npm run build && npm run preview -- --host 127.0.0.1 --port 5177 --strictPort",
    url: "http://127.0.0.1:5177",
    reuseExistingServer: false,
    env: {
      VITE_OBSERVER_DEFAULT_SOURCE: "cloud",
      VITE_SUPABASE_URL: "https://msd-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_msd_browser_test_fixture",
    },
    timeout: 60000,
  },
});
