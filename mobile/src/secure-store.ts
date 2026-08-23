import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 1800;

function manifestKey(key: string) {
  return `${key}:manifest`;
}

function chunkKey(key: string, index: number) {
  return `${key}:chunk:${index}`;
}

export const secureStorage = {
  async getItem(key: string) {
    const manifest = await SecureStore.getItemAsync(manifestKey(key));
    if (!manifest) return SecureStore.getItemAsync(key);

    const count = Number(manifest);
    if (!Number.isInteger(count) || count < 1 || count > 64) return null;

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))),
    );
    if (chunks.some((chunk) => chunk === null)) return null;
    return chunks.join("");
  },

  async setItem(key: string, value: string) {
    await secureStorage.removeItem(key);
    const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, "gs")) ?? [""];
    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
    );
    await SecureStore.setItemAsync(manifestKey(key), String(chunks.length));
  },

  async removeItem(key: string) {
    const manifest = await SecureStore.getItemAsync(manifestKey(key));
    const count = Number(manifest ?? 0);
    if (Number.isInteger(count) && count > 0 && count <= 64) {
      await Promise.all(
        Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))),
      );
    }
    await Promise.all([
      SecureStore.deleteItemAsync(manifestKey(key)),
      SecureStore.deleteItemAsync(key),
    ]);
  },
};

export const DEVICE_TOKEN_KEY = "floornow-device-token";
export const DEVICE_SECRET_KEY = "floornow-device-secret";
export const ACTIVE_SESSION_KEY = "floornow-active-tracking-session";
