import { beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  version: 0,
  fail: false,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => `version-${++storage.version}`,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => storage.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (storage.fail && key !== "auth") throw new Error("keychain unavailable");
    storage.values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    storage.values.delete(key);
  },
}));
import { authStorage } from "../src/authStorage";
beforeEach(() => {
  storage.values.clear();
  storage.version = 0;
  storage.fail = false;
});
it("roundtrips an auth session larger than native per-item limits", async () => {
  const session = JSON.stringify({ access_token: "x".repeat(6000) });
  await authStorage.setItem("auth", session);
  expect(await authStorage.getItem("auth")).toBe(session);
  expect([...storage.values.values()].every((v) => v.length <= 1000)).toBe(
    true,
  );
});
it("retains the committed session if a refreshed token cannot be written", async () => {
  await authStorage.setItem("auth", "previous-session");
  storage.fail = true;
  await expect(authStorage.setItem("auth", "new-session")).rejects.toThrow();
  expect(await authStorage.getItem("auth")).toBe("previous-session");
});
it("removes obsolete token chunks on refresh and sign-out", async () => {
  await authStorage.setItem("auth", "x".repeat(4000));
  await authStorage.setItem("auth", "new-session");
  expect(storage.values.size).toBe(2);
  await authStorage.removeItem("auth");
  expect(storage.values.size).toBe(0);
  expect(await authStorage.getItem("auth")).toBeNull();
});
