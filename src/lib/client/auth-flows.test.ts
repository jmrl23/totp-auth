import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedEntryInput, EntryPlain, KdfParams } from "@/lib/schemas";
import {
  changePassword,
  lock,
  login,
  logout,
  recoverAccount,
  regenerateRecoveryKey,
  register,
  unlock,
} from "./auth-flows";
import { keyStore, resetKeyStoreForTests } from "./key-store";
import { getLockState, getVaultKey, resetLockStateForTests } from "./lock-state";
import { decryptEntry, encryptEntry } from "./vault-crypto";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a much better passphrase!";
const USER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RECOVERY_KEY = "ABCDE-FGHJK-MNPQR-STVWX";
const NEXT_RECOVERY_KEY = "23456-789AB-CDEFG-HJKMN";

/** Minimal in-memory server that follows the wire contract. */
function fakeServer() {
  const state = {
    user: null as null | { username: string; authKey: string; kdfSalt: string; kdfParams: KdfParams },
    recoveryKey: RECOVERY_KEY,
    active: false,
    entries: [] as EncryptedEntryInput[],
    bodies: [] as string[],
  };
  const ok = (body: unknown, status = 200) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fail = (status: number, code: string, message = code) => ok({ error: { code, message } }, status);
  const needActive = () => (state.active ? null : fail(401, "unauthorized"));

  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (init?.body) state.bodies.push(init.body as string);
    const route = `${method} ${url}`;
    switch (route) {
      case "POST /api/auth/register":
        state.user = { username: body.username, authKey: body.authKey, kdfSalt: body.kdfSalt, kdfParams: body.kdfParams };
        state.active = true;
        return ok({ recoveryKey: state.recoveryKey }, 201);
      case "POST /api/auth/prelogin":
        return ok({ kdfSalt: state.user!.kdfSalt, kdfParams: state.user!.kdfParams });
      case "POST /api/auth/login":
        if (body.authKey !== state.user?.authKey) return fail(401, "invalid_credentials", "Wrong username or password.");
        state.active = true;
        return ok(null, 204);
      case "POST /api/auth/recover":
        if (body.username !== state.user?.username || body.recoveryKey !== state.recoveryKey.replace(/-/g, "")) {
          return fail(401, "invalid_credentials", "Wrong username or recovery key.");
        }
        state.user = { ...state.user!, authKey: body.newAuthKey, kdfSalt: body.newKdfSalt, kdfParams: body.newKdfParams };
        state.entries = [];
        state.recoveryKey = NEXT_RECOVERY_KEY;
        state.active = true;
        return ok({ recoveryKey: state.recoveryKey });
      case "GET /api/auth/session":
        return (
          needActive() ??
          ok({
            user: { id: USER_ID, username: state.user!.username, kdfSalt: state.user!.kdfSalt, kdfParams: state.user!.kdfParams },
            recoveryKeyCreatedAt: "2026-01-01T00:00:00Z",
            expiresAt: new Date(Date.now() + 1e9).toISOString(),
          })
        );
      case "POST /api/auth/unlock":
        return needActive() ?? (body.authKey === state.user!.authKey ? ok(null, 204) : fail(401, "invalid_credentials"));
      case "POST /api/auth/logout":
        state.active = false;
        return ok(null, 204);
      case "POST /api/account/recovery-key":
        return (
          needActive() ??
          (body.authKey === state.user!.authKey
            ? ok({ recoveryKey: (state.recoveryKey = NEXT_RECOVERY_KEY) })
            : fail(401, "invalid_credentials", "Wrong password."))
        );
      case "GET /api/vault":
        return needActive() ?? ok({ entries: state.entries.map((e) => ({ ...e, updatedAt: "2026-01-01T00:00:00Z" })) });
      case "POST /api/account/password": {
        const denied = needActive();
        if (denied) return denied;
        if (body.currentAuthKey !== state.user!.authKey) return fail(401, "invalid_credentials");
        const ids = new Set(body.entries.map((e: EncryptedEntryInput) => e.id));
        if (ids.size !== state.entries.length || !state.entries.every((e) => ids.has(e.id))) return fail(409, "conflict");
        state.user = { ...state.user!, authKey: body.newAuthKey, kdfSalt: body.newKdfSalt, kdfParams: body.newKdfParams };
        state.entries = body.entries;
        return ok(null, 204);
      }
      default:
        return fail(404, "not_found");
    }
  };
  return { state, fetch: vi.fn(handler) };
}

const sample = (n: number): EntryPlain => ({
  issuer: `Service ${n}`,
  label: `user${n}@example.com`,
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
});

let server: ReturnType<typeof fakeServer>;

beforeEach(async () => {
  resetLockStateForTests();
  resetKeyStoreForTests();
  await keyStore.clear();
  server = fakeServer();
  vi.stubGlobal("fetch", server.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetLockStateForTests();
});

const neverLeaksPassword = (...passwords: string[]) => {
  for (const body of server.state.bodies) for (const pw of passwords) expect(body).not.toContain(pw);
};

describe("auth flows", { timeout: 60_000 }, () => {
  it("registers, stores the key at once and returns the recovery key", async () => {
    const key = await register({ username: "Alice", password: PASSWORD });
    expect(key).toBe(RECOVERY_KEY);
    expect(server.state.user?.username).toBe("alice");
    expect(server.state.user?.kdfParams).toEqual({ alg: "argon2id", m: 65536, t: 3, p: 1, v: 1 });
    expect(getLockState()).toBe("unlocked");
    expect((await keyStore.load())?.userId).toBe(USER_ID);
    neverLeaksPassword(PASSWORD);
  });

  it("logs in with the password alone, locks, unlocks, logs out", async () => {
    await register({ username: "alice", password: PASSWORD });
    await logout();
    expect(getLockState()).toBe("signed-out");
    expect(await keyStore.load()).toBeNull();

    await expect(login("alice", "wrong password here")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(await keyStore.load()).toBeNull();

    await login("alice", PASSWORD);
    expect(getLockState()).toBe("unlocked");
    expect(await keyStore.load()).not.toBeNull();

    await lock();
    expect(getLockState()).toBe("locked");
    expect(await keyStore.load()).toBeNull();
    await expect(unlock("wrong password here")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(getLockState()).toBe("locked");
    await unlock(PASSWORD);
    expect(getLockState()).toBe("unlocked");
    neverLeaksPassword(PASSWORD, "wrong password here");
  });

  it("changePassword re-encrypts every entry under a new key and salt with the same ids", async () => {
    await register({ username: "alice", password: PASSWORD });
    const oldKey = getVaultKey()!;
    const oldSalt = server.state.user!.kdfSalt;
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    server.state.entries = await Promise.all(ids.map((id, i) => encryptEntry(oldKey, id, sample(i))));

    await expect(
      changePassword({ currentPassword: "wrong password here", newPassword: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });

    await changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(server.state.user!.kdfSalt).not.toBe(oldSalt);
    expect(server.state.entries.map((e) => e.id)).toEqual(ids);
    const newKey = getVaultKey()!;
    expect(newKey).not.toBe(oldKey);
    for (const [i, e] of server.state.entries.entries()) {
      await expect(decryptEntry(newKey, e.id, e)).resolves.toEqual(sample(i));
      await expect(decryptEntry(oldKey, e.id, e)).rejects.toThrow();
    }
    expect((await keyStore.load())?.key).toBeDefined();

    await logout();
    await login("alice", NEW_PASSWORD);
    expect(getLockState()).toBe("unlocked");
    neverLeaksPassword(PASSWORD, NEW_PASSWORD);
  });

  it("recovers with the key: new password works, old one does not, new key is returned, vault is empty", async () => {
    await register({ username: "alice", password: PASSWORD });
    server.state.entries = [await encryptEntry(getVaultKey()!, crypto.randomUUID(), sample(1))];
    await logout();

    await expect(
      recoverAccount({ username: "alice", recoveryKey: "AAAAA-AAAAA-AAAAA-AAAAA", newPassword: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(getLockState()).toBe("signed-out");
    await expect(recoverAccount({ username: "alice", recoveryKey: "short", newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: "invalid_request",
    });

    // Lowercase and spaces instead of dashes are accepted as typed.
    const next = await recoverAccount({
      username: "Alice",
      recoveryKey: RECOVERY_KEY.toLowerCase().replace(/-/g, " "),
      newPassword: NEW_PASSWORD,
    });
    expect(next).toBe(NEXT_RECOVERY_KEY);
    expect(server.state.entries).toEqual([]);
    expect(getLockState()).toBe("unlocked");
    expect((await keyStore.load())?.userId).toBe(USER_ID);

    await logout();
    await expect(login("alice", PASSWORD)).rejects.toMatchObject({ code: "invalid_credentials" });
    await login("alice", NEW_PASSWORD);
    neverLeaksPassword(PASSWORD, NEW_PASSWORD);
  });

  it("regenerates the recovery key without touching the vault key or signing out on a wrong password", async () => {
    await register({ username: "alice", password: PASSWORD });
    const key = getVaultKey();
    await expect(regenerateRecoveryKey("wrong password here")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(getLockState()).toBe("unlocked");
    await expect(regenerateRecoveryKey(PASSWORD)).resolves.toBe(NEXT_RECOVERY_KEY);
    expect(getVaultKey()).toBe(key);
    expect((await keyStore.load())?.userId).toBe(USER_ID);
    neverLeaksPassword(PASSWORD, "wrong password here");
  });
});
