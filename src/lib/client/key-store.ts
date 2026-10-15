/**
 * Persists the non-extractable vault CryptoKey in IndexedDB (db "totp-auth", key "vault-key").
 * Every call swallows storage failures: a broken or missing IndexedDB means "locked", never a crash.
 */
import { createStore, del, get, set, type UseStore } from "idb-keyval";

export type StoredKey = { key: CryptoKey; userId: string; username: string };

const DB_NAME = "totp-auth";
const STORE_NAME = "keys";
const KEY = "vault-key";

let store: UseStore | null = null;

function getStore(): UseStore | null {
  if (typeof indexedDB === "undefined") return null;
  if (!store) {
    try {
      store = createStore(DB_NAME, STORE_NAME);
    } catch {
      return null;
    }
  }
  return store;
}

function isStoredKey(value: unknown): value is StoredKey {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.username === "string" &&
    typeof CryptoKey !== "undefined" &&
    v.key instanceof CryptoKey
  );
}

export const keyStore = {
  /** Returns false when the key could not be stored (it then lives in memory for this tab only). */
  async save(record: StoredKey): Promise<boolean> {
    const s = getStore();
    if (!s) return false;
    try {
      await set(KEY, record, s);
      return true;
    } catch {
      store = null; // retry opening next time
      return false;
    }
  },
  /** Returns null when there is no key or storage is unavailable. */
  async load(): Promise<StoredKey | null> {
    const s = getStore();
    if (!s) return null;
    try {
      const value: unknown = await get(KEY, s);
      return isStoredKey(value) ? value : null;
    } catch {
      store = null;
      return null;
    }
  },
  async clear(): Promise<void> {
    const s = getStore();
    if (!s) return;
    try {
      await del(KEY, s);
    } catch {
      store = null;
    }
  },
};

/** Test hook: forget the cached store handle. */
export function resetKeyStoreForTests(): void {
  store = null;
}
