import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/liveGateway.live.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
