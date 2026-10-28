import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
interface Manifest {
  version: string;
  count: number;
}
// Supabase sessions can exceed SecureStore's per-item size on some phones.
// Write chunks first and commit the manifest last, retaining the previous session on failure.
export const authStorage = {
  async getItem(key: string) {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    const manifest: Manifest = JSON.parse(raw);
    const parts = await Promise.all(
      Array.from({ length: manifest.count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${manifest.version}.${i}`),
      ),
    );
    return parts.some((p) => p === null) ? null : parts.join("");
  },
  async setItem(key: string, value: string) {
    const previous = await SecureStore.getItemAsync(key);
    const version = Crypto.randomUUID();
    const count = Math.ceil(value.length / 1000);
    for (let i = 0; i < count; i++)
      await SecureStore.setItemAsync(
        `${key}.${version}.${i}`,
        value.slice(i * 1000, (i + 1) * 1000),
      );
    await SecureStore.setItemAsync(key, JSON.stringify({ version, count }));
    if (previous) await removeChunks(key, JSON.parse(previous));
  },
  async removeItem(key: string) {
    const raw = await SecureStore.getItemAsync(key);
    await SecureStore.deleteItemAsync(key);
    if (raw) await removeChunks(key, JSON.parse(raw));
  },
};
async function removeChunks(key: string, m: Manifest) {
  for (let i = 0; i < m.count; i++)
    await SecureStore.deleteItemAsync(`${key}.${m.version}.${i}`);
}
