import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyStore, resetKeyStoreForTests } from "./key-store";
import {
  getLockState,
  getVaultKey,
  refreshLockState,
  resetLockStateForTests,
  setLocked,
  setSessionLoader,
  setSignedOut,
  setUnlocked,
} from "./lock-state";
import { emitSessionEvent } from "./session-events";

const USER = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  username: "alice",
  kdfSalt: "AQIDBAUGBwgJCgsMDQ4PEA",
  kdfParams: { alg: "argon2id" as const, m: 19456, t: 2, p: 1, v: 1 as const },
};
const session = { user: USER, recoveryKeyCreatedAt: new Date().toISOString(), expiresAt: new Date().toISOString() };
const newKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

beforeEach(async () => {
  resetLockStateForTests();
  resetKeyStoreForTests();
  await keyStore.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetLockStateForTests();
});

describe("keyStore", () => {
  it("saves, loads and clears a non-extractable key that still works", async () => {
    const key = await newKey();
    expect(await keyStore.save({ key, userId: USER.id, username: "alice" })).toBe(true);
    const loaded = await keyStore.load();
    expect(loaded).toMatchObject({ userId: USER.id, username: "alice" });
    expect(loaded?.key.extractable).toBe(false);
    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array([1, 2, 3]));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, loaded!.key, ct);
    expect([...new Uint8Array(pt)]).toEqual([1, 2, 3]);
    await keyStore.clear();
    expect(await keyStore.load()).toBeNull();
  });

  it("never throws when IndexedDB is missing or broken", async () => {
    resetKeyStoreForTests();
    vi.stubGlobal("indexedDB", undefined);
    await expect(keyStore.load()).resolves.toBeNull();
    await expect(keyStore.save({ key: await newKey(), userId: USER.id, username: "a" })).resolves.toBe(false);
    await expect(keyStore.clear()).resolves.toBeUndefined();

    resetKeyStoreForTests();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("broken");
      },
    });
    await expect(keyStore.load()).resolves.toBeNull();
    await expect(keyStore.save({ key: await newKey(), userId: USER.id, username: "a" })).resolves.toBe(false);
  });
});

describe("lock state", () => {
  it("is signed-out without a session and clears any stored key", async () => {
    await keyStore.save({ key: await newKey(), userId: USER.id, username: "alice" });
    setSessionLoader(async () => null);
    expect(await refreshLockState()).toBe("signed-out");
    expect(await keyStore.load()).toBeNull();
  });

  it("is locked with a session but no key, unlocked with a matching stored key", async () => {
    setSessionLoader(async () => session);
    expect(await refreshLockState()).toBe("locked");
    await keyStore.save({ key: await newKey(), userId: USER.id, username: "alice" });
    expect(await refreshLockState()).toBe("unlocked");
    expect(getVaultKey()).not.toBeNull();
  });

  it("drops a stored key that belongs to another user", async () => {
    await keyStore.save({ key: await newKey(), userId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", username: "bob" });
    setSessionLoader(async () => session);
    expect(await refreshLockState()).toBe("locked");
    expect(await keyStore.load()).toBeNull();
  });

  it("degrades to locked when IndexedDB is unavailable", async () => {
    resetKeyStoreForTests();
    vi.stubGlobal("indexedDB", undefined);
    setSessionLoader(async () => session);
    expect(await refreshLockState()).toBe("locked");
  });

  it("transitions on unlock, lock, logout and a 401 event", async () => {
    setSessionLoader(async () => session);
    const key = await newKey();
    await setUnlocked(key, USER);
    expect(getLockState()).toBe("unlocked");
    expect((await keyStore.load())?.userId).toBe(USER.id);

    await setLocked();
    expect(getLockState()).toBe("locked");
    expect(getVaultKey()).toBeNull();
    expect(await keyStore.load()).toBeNull();

    await setUnlocked(key, USER);
    emitSessionEvent("signed-out");
    expect(getLockState()).toBe("signed-out");

    await setUnlocked(key, USER);
    await setSignedOut();
    expect(getLockState()).toBe("signed-out");
    expect(await keyStore.load()).toBeNull();
  });

  it("follows lock and logout from another tab", async () => {
    setSessionLoader(async () => session);
    await setUnlocked(await newKey(), USER);
    const other = new BroadcastChannel("totp-auth");
    other.postMessage({ type: "lock" });
    await vi.waitFor(() => expect(getLockState()).toBe("locked"));
    other.postMessage({ type: "logout" });
    await vi.waitFor(() => expect(getLockState()).toBe("signed-out"));
    other.close();
  });
});
