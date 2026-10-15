import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, sessions, users } from "@/db/schema";
import { decoySalt } from "@/lib/server/password";
import {
  configureTestEnv,
  fakeAuthKey,
  fakeEntry,
  fakeSalt,
  Jar,
  kdfParams,
  setupTestDb,
} from "@/lib/server/testing/helpers";
import {
  MAX_ENTRIES_PER_USER,
  preloginResponseSchema,
  recoverResponseSchema,
  registerResponseSchema,
  sessionResponseSchema,
  vaultResponseSchema,
  type ApiErrorBody,
} from "@/lib/schemas";

import { GET as timeGET } from "./time/route";
import { GET as configGET } from "./auth/config/route";
import { POST as preloginPOST } from "./auth/prelogin/route";
import { POST as loginPOST } from "./auth/login/route";
import { POST as registerPOST } from "./auth/register/route";
import { POST as recoverPOST } from "./auth/recover/route";
import { GET as sessionGET } from "./auth/session/route";
import { POST as unlockPOST } from "./auth/unlock/route";
import { POST as logoutPOST } from "./auth/logout/route";
import { POST as recoveryKeyPOST } from "./account/recovery-key/route";
import { POST as passwordPOST } from "./account/password/route";
import { GET as vaultGET } from "./vault/route";
import { POST as entryPOST } from "./vault/entries/route";
import { DELETE as entryDELETE, PUT as entryPUT } from "./vault/entries/[id]/route";
import { POST as importPOST } from "./vault/import/route";
import { GET as healthGET } from "./health/route";
import { getPool } from "@/db";
import { swapCredentials } from "@/lib/server/users";
import { hashAuthKey } from "@/lib/server/password";
import { sessionIdFromToken } from "@/lib/server/sessions";

setupTestDb();

const errCode = (r: { body: unknown }) => (r.body as ApiErrorBody).error.code;
const KEY_RE = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/;

type Account = { jar: Jar; username: string; authKey: string; kdfSalt: string; recoveryKey: string };

async function registerAccount(username = "alice"): Promise<Account> {
  const jar = new Jar();
  const authKey = fakeAuthKey();
  const kdfSalt = fakeSalt();
  const reg = await jar.call(registerPOST, "POST", "/api/auth/register", { body: { username, authKey, kdfSalt, kdfParams } });
  expect(reg.status).toBe(201);
  return { jar, username, authKey, kdfSalt, recoveryKey: registerResponseSchema.parse(reg.body).recoveryKey };
}

async function signIn(acct: Pick<Account, "username" | "authKey">): Promise<Jar> {
  const jar = new Jar();
  expect((await jar.call(loginPOST, "POST", "/api/auth/login", { body: { username: acct.username, authKey: acct.authKey } })).status).toBe(204);
  return jar;
}

const recoverBody = (acct: Pick<Account, "username" | "recoveryKey">, extra: Record<string, unknown> = {}) => ({
  username: acct.username,
  recoveryKey: acct.recoveryKey,
  newAuthKey: fakeAuthKey(),
  newKdfSalt: fakeSalt(),
  newKdfParams: kdfParams,
  ...extra,
});

describe("public endpoints", () => {
  it("GET /api/time returns epoch ms with no-store", async () => {
    const r = await new Jar().call<{ now: number }>(timeGET, "GET", "/api/time");
    expect(r.status).toBe(200);
    expect(Math.abs(r.body.now - Date.now())).toBeLessThan(5_000);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /api/auth/config reflects registration state and setup token", async () => {
    const jar = new Jar();
    expect((await jar.call(configGET, "GET", "/api/auth/config")).body).toEqual({ registrationOpen: true, setupTokenRequired: false });
    await registerAccount();
    expect((await jar.call(configGET, "GET", "/api/auth/config")).body).toEqual({
      registrationOpen: false,
      setupTokenRequired: false,
      closedReason: "closed",
    });
    configureTestEnv({ ALLOW_REGISTRATION: "true", SETUP_TOKEN: "s3cret-setup-token" });
    expect((await jar.call(configGET, "GET", "/api/auth/config")).body).toEqual({ registrationOpen: true, setupTokenRequired: true });
  });
});

describe("full flow", () => {
  it("register -> logout -> prelogin -> login -> vault CRUD -> import -> unlock -> regenerate key -> change password", async () => {
    const jar = new Jar();
    const authKey = fakeAuthKey();
    const kdfSalt = fakeSalt();

    // register: active session cookie, recovery key shown once
    const reg = await jar.call(registerPOST, "POST", "/api/auth/register", { body: { username: "Alice", authKey, kdfSalt, kdfParams } });
    expect(reg.status).toBe(201);
    const { recoveryKey } = registerResponseSchema.parse(reg.body);
    expect(recoveryKey).toMatch(KEY_RE);
    expect(reg.headers.getSetCookie()[0]).toMatch(/^sid=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=1209600; HttpOnly; SameSite=Strict/);
    const sess = await jar.call(sessionGET, "GET", "/api/auth/session");
    expect(sess.status).toBe(200);
    const parsedSession = sessionResponseSchema.parse(sess.body);
    expect(parsedSession.user.username).toBe("alice");
    expect(parsedSession.user.kdfSalt).toBe(kdfSalt);
    expect(Date.now() - new Date(parsedSession.recoveryKeyCreatedAt).getTime()).toBeLessThan(60_000);
    expect(JSON.stringify(sess.body)).not.toContain(recoveryKey);

    // the database holds only a keyed hash of the key
    const [stored] = await getDb().select().from(users);
    expect(stored.recoveryKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(recoveryKey.replace(/-/g, ""));

    // logout
    const out = await jar.call(logoutPOST, "POST", "/api/auth/logout");
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()[0]).toMatch(/^sid=; Path=\/; Max-Age=0/);
    expect(jar.cookie).toBeUndefined();
    expect(await getDb().select().from(sessions)).toHaveLength(0);

    // prelogin returns the real salt
    const pre = await jar.call(preloginPOST, "POST", "/api/auth/prelogin", { body: { username: "alice" } });
    expect(preloginResponseSchema.parse(pre.body)).toEqual({ kdfSalt, kdfParams });

    // login: one step, straight to an active session
    const login = await jar.call(loginPOST, "POST", "/api/auth/login", { body: { username: "alice", authKey } });
    expect(login.status).toBe(204);
    expect(login.headers.getSetCookie()[0]).toContain("Max-Age=1209600");

    // vault CRUD
    expect((await jar.call(vaultGET, "GET", "/api/vault")).body).toEqual({ entries: [] });
    const e1 = fakeEntry();
    const created = await jar.call<{ entry: { id: string; updatedAt: string } }>(entryPOST, "POST", "/api/vault/entries", { body: e1 });
    expect(created.status).toBe(201);
    expect(created.body.entry.id).toBe(e1.id);
    expect((await jar.call(entryPOST, "POST", "/api/vault/entries", { body: e1 })).status).toBe(409);
    const upd = fakeEntry(e1.id);
    const put = await jar.call<{ entry: { ciphertext: string } }>(entryPUT, "PUT", `/api/vault/entries/${e1.id}`, {
      params: { id: e1.id },
      body: { ciphertext: upd.ciphertext, iv: upd.iv },
    });
    expect(put.status).toBe(200);
    expect(put.body.entry.ciphertext).toBe(upd.ciphertext);
    const e2 = fakeEntry();
    await jar.call(entryPOST, "POST", "/api/vault/entries", { body: e2 });
    expect((await jar.call(entryDELETE, "DELETE", `/api/vault/entries/${e2.id}`, { params: { id: e2.id } })).status).toBe(204);
    expect((await jar.call(entryDELETE, "DELETE", `/api/vault/entries/${e2.id}`, { params: { id: e2.id } })).status).toBe(404);

    // import: existing id skipped
    const imp = await jar.call(importPOST, "POST", "/api/vault/import", { body: { entries: [fakeEntry(e1.id), fakeEntry(), fakeEntry()] } });
    expect(imp.status).toBe(201);
    expect(imp.body).toEqual({ created: 2 });
    const vault = vaultResponseSchema.parse((await jar.call(vaultGET, "GET", "/api/vault")).body);
    expect(vault.entries).toHaveLength(3);
    expect(vault.entries.find((e) => e.id === e1.id)?.ciphertext).toBe(upd.ciphertext);

    // unlock
    expect((await jar.call(unlockPOST, "POST", "/api/auth/unlock", { body: { authKey } })).status).toBe(204);
    const badUnlock = await jar.call(unlockPOST, "POST", "/api/auth/unlock", { body: { authKey: fakeAuthKey() } });
    expect(badUnlock.status).toBe(401);
    expect(errCode(badUnlock)).toBe("invalid_credentials");

    // regenerate the recovery key: needs the password, replaces the old key
    const badRegen = await jar.call(recoveryKeyPOST, "POST", "/api/account/recovery-key", { body: { authKey: fakeAuthKey() } });
    expect(badRegen.status).toBe(401);
    expect(errCode(badRegen)).toBe("invalid_credentials");
    const regen = await jar.call(recoveryKeyPOST, "POST", "/api/account/recovery-key", { body: { authKey } });
    expect(regen.status).toBe(200);
    const fresh = registerResponseSchema.parse(regen.body).recoveryKey;
    expect(fresh).toMatch(KEY_RE);
    expect(fresh).not.toBe(recoveryKey);
    const [rotated] = await getDb().select().from(users);
    expect(rotated.recoveryKeyHash).not.toBe(stored.recoveryKeyHash);
    const staleRecover = await new Jar().call(recoverPOST, "POST", "/api/auth/recover", {
      body: recoverBody({ username: "alice", recoveryKey }),
    });
    expect(staleRecover.status).toBe(401);

    // a second device session that must be revoked by the password change
    const other = await signIn({ username: "alice", authKey });
    expect((await other.call(vaultGET, "GET", "/api/vault")).status).toBe(200);

    // change password: all entries re-encrypted, no second factor needed
    const newAuthKey = fakeAuthKey();
    const newKdfSalt = fakeSalt();
    const reenc = vault.entries.map((e) => fakeEntry(e.id));
    const change = await jar.call(passwordPOST, "POST", "/api/account/password", {
      body: { currentAuthKey: authKey, newAuthKey, newKdfSalt, newKdfParams: kdfParams, entries: reenc },
    });
    expect(change.status).toBe(204);
    expect((await other.call(vaultGET, "GET", "/api/vault")).status).toBe(401);
    const after = vaultResponseSchema.parse((await jar.call(vaultGET, "GET", "/api/vault")).body);
    expect(new Map(after.entries.map((e) => [e.id, e.ciphertext]))).toEqual(new Map(reenc.map((e) => [e.id, e.ciphertext])));
    const pre2 = await new Jar().call(preloginPOST, "POST", "/api/auth/prelogin", { body: { username: "alice" } });
    expect((pre2.body as { kdfSalt: string }).kdfSalt).toBe(newKdfSalt);
    const oldLogin = await new Jar().call(loginPOST, "POST", "/api/auth/login", { body: { username: "alice", authKey } });
    expect(oldLogin.status).toBe(401);
    await signIn({ username: "alice", authKey: newAuthKey });
    // the recovery key survives a password change
    const stillValid = await new Jar().call(recoverPOST, "POST", "/api/auth/recover", { body: recoverBody({ username: "alice", recoveryKey: fresh }) });
    expect(stillValid.status).toBe(200);
  });
});

describe("negative cases", () => {
  it("rejects a bad or missing Origin with 403", async () => {
    const jar = new Jar();
    const bad = await jar.call(preloginPOST, "POST", "/api/auth/prelogin", { body: { username: "alice" }, origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(errCode(bad)).toBe("forbidden");
    expect(bad.headers.get("cache-control")).toBe("no-store");
    expect((await jar.call(preloginPOST, "POST", "/api/auth/prelogin", { body: { username: "alice" }, origin: null })).status).toBe(403);
  });

  it("rejects a non-JSON content type with 403", async () => {
    const r = await new Jar().call(preloginPOST, "POST", "/api/auth/prelogin", {
      rawBody: "username=alice",
      contentType: "application/x-www-form-urlencoded",
    });
    expect(r.status).toBe(403);
    const plain = await new Jar().call(logoutPOST, "POST", "/api/auth/logout", { contentType: "text/plain" });
    expect(plain.status).toBe(403);
  });

  it("returns 400 invalid_request for malformed bodies without leaking internals", async () => {
    const jar = new Jar();
    const r = await jar.call(preloginPOST, "POST", "/api/auth/prelogin", { rawBody: "{not json" });
    expect(r.status).toBe(400);
    expect(errCode(r)).toBe("invalid_request");
    const v = await jar.call(loginPOST, "POST", "/api/auth/login", { body: { username: "alice", authKey: "short" } });
    expect(v.status).toBe(400);
  });

  it("requires a session for protected endpoints", async () => {
    for (const r of [
      await new Jar().call(vaultGET, "GET", "/api/vault"),
      await new Jar().call(sessionGET, "GET", "/api/auth/session"),
      await new Jar().call(entryPOST, "POST", "/api/vault/entries", { body: fakeEntry() }),
      await new Jar().call(unlockPOST, "POST", "/api/auth/unlock", { body: { authKey: fakeAuthKey() } }),
      await new Jar().call(recoveryKeyPOST, "POST", "/api/account/recovery-key", { body: { authKey: fakeAuthKey() } }),
      await new Jar().call(passwordPOST, "POST", "/api/account/password", {
        body: { currentAuthKey: fakeAuthKey(), newAuthKey: fakeAuthKey(), newKdfSalt: fakeSalt(), newKdfParams: kdfParams, entries: [] },
      }),
    ]) {
      expect(r.status).toBe(401);
      expect(errCode(r)).toBe("unauthorized");
    }
  });

  it("scopes vault access to the session user (cross-user returns 404)", async () => {
    configureTestEnv({ ALLOW_REGISTRATION: "true" });
    const a = await registerAccount("alice");
    const b = await registerAccount("bobby");
    const e = fakeEntry();
    expect((await a.jar.call(entryPOST, "POST", "/api/vault/entries", { body: e })).status).toBe(201);
    const put = await b.jar.call(entryPUT, "PUT", `/api/vault/entries/${e.id}`, { params: { id: e.id }, body: { ciphertext: fakeEntry().ciphertext, iv: fakeEntry().iv } });
    expect(put.status).toBe(404);
    expect((await b.jar.call(entryDELETE, "DELETE", `/api/vault/entries/${e.id}`, { params: { id: e.id } })).status).toBe(404);
    expect((await b.jar.call(vaultGET, "GET", "/api/vault")).body).toEqual({ entries: [] });
    expect((await b.jar.call(entryDELETE, "DELETE", "/api/vault/entries/not-a-uuid", { params: { id: "not-a-uuid" } })).status).toBe(404);
    // b importing a's id must not touch a's row
    expect((await b.jar.call(importPOST, "POST", "/api/vault/import", { body: { entries: [fakeEntry(e.id)] } })).body).toEqual({ created: 0 });
    const [row] = await getDb().select().from(entries).where(eq(entries.id, e.id));
    expect(row.ciphertext).toBe(e.ciphertext);
    // b cannot change password while covering a's entries
    const change = await b.jar.call(passwordPOST, "POST", "/api/account/password", {
      body: { currentAuthKey: b.authKey, newAuthKey: fakeAuthKey(), newKdfSalt: fakeSalt(), newKdfParams: kdfParams, entries: [fakeEntry(e.id)] },
    });
    expect(change.status).toBe(409);
    const [after] = await getDb().select().from(entries).where(eq(entries.id, e.id));
    expect(after.ciphertext).toBe(e.ciphertext);
  });

  it("answers unknown users exactly like a wrong password", async () => {
    const acct = await registerAccount();
    const wrong = await new Jar().call(loginPOST, "POST", "/api/auth/login", { body: { username: acct.username, authKey: fakeAuthKey() } });
    const unknown = await new Jar().call(loginPOST, "POST", "/api/auth/login", { body: { username: "nobody", authKey: fakeAuthKey() } });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual({ error: { code: "invalid_credentials", message: "Wrong username or password." } });
    expect(unknown.headers.getSetCookie()).toEqual(wrong.headers.getSetCookie());

    const pre = await new Jar().call(preloginPOST, "POST", "/api/auth/prelogin", { body: { username: "nobody" } });
    expect(pre.status).toBe(200);
    expect(preloginResponseSchema.parse(pre.body)).toEqual({ kdfSalt: decoySalt("nobody"), kdfParams });
    const again = await new Jar().call(preloginPOST, "POST", "/api/auth/prelogin", { body: { username: "nobody" } });
    expect(again.body).toEqual(pre.body);
  });

  it("rate limits login per username with 429 and Retry-After", async () => {
    await registerAccount();
    let last;
    for (let i = 0; i < 11; i++) {
      last = await new Jar().call(loginPOST, "POST", "/api/auth/login", { body: { username: "alice", authKey: fakeAuthKey() } });
    }
    expect(last!.status).toBe(429);
    const body = last!.body as ApiErrorBody;
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retryAfter).toBeGreaterThan(0);
    expect(last!.headers.get("retry-after")).toBe(String(body.error.retryAfter));
  });

  it("rate limits login per IP across usernames when the proxy is trusted", async () => {
    configureTestEnv({ TRUST_PROXY: "true" });
    const call = (u: string, ip: string) =>
      new Jar().call(loginPOST, "POST", "/api/auth/login", {
        body: { username: u, authKey: fakeAuthKey() },
        headers: { "x-forwarded-for": ip },
      });
    for (let i = 0; i < 30; i++) expect((await call(`user${i}x`, "203.0.113.5")).status).toBe(401);
    expect((await call("another", "203.0.113.5")).status).toBe(429);
    expect((await call("another", "203.0.113.9")).status).toBe(401);
  });

  it("closes registration once an account exists", async () => {
    await registerAccount();
    const r = await new Jar().call(registerPOST, "POST", "/api/auth/register", {
      body: { username: "mallory", authKey: fakeAuthKey(), kdfSalt: fakeSalt(), kdfParams },
    });
    expect(r.status).toBe(403);
    expect(errCode(r)).toBe("registration_closed");
  });

  it("reports a taken username", async () => {
    configureTestEnv({ ALLOW_REGISTRATION: "true" });
    await registerAccount("erin1");
    const taken = await new Jar().call(registerPOST, "POST", "/api/auth/register", {
      body: { username: "erin1", authKey: fakeAuthKey(), kdfSalt: fakeSalt(), kdfParams },
    });
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: { code: "conflict", message: "That username is taken." } });
    expect(await getDb().select().from(users)).toHaveLength(1);
  });

  it("requires the setup token when configured", async () => {
    configureTestEnv({ SETUP_TOKEN: "correct-horse-battery" });
    const body = { username: "frank", authKey: fakeAuthKey(), kdfSalt: fakeSalt(), kdfParams };
    expect((await new Jar().call(registerPOST, "POST", "/api/auth/register", { body })).status).toBe(403);
    expect((await new Jar().call(registerPOST, "POST", "/api/auth/register", { body: { ...body, setupToken: "wrong" } })).status).toBe(403);
    expect((await new Jar().call(registerPOST, "POST", "/api/auth/register", { body: { ...body, setupToken: "correct-horse-battery" } })).status).toBe(201);
  });

  it("change password requires the current authKey and an exact entry set", async () => {
    const acct = await registerAccount();
    const e = fakeEntry();
    await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: e });
    const base = { newAuthKey: fakeAuthKey(), newKdfSalt: fakeSalt(), newKdfParams: kdfParams };
    const wrongKey = await acct.jar.call(passwordPOST, "POST", "/api/account/password", {
      body: { ...base, currentAuthKey: fakeAuthKey(), entries: [fakeEntry(e.id)] },
    });
    expect(wrongKey.status).toBe(401);
    expect(errCode(wrongKey)).toBe("invalid_credentials");
    const missing = await acct.jar.call(passwordPOST, "POST", "/api/account/password", {
      body: { ...base, currentAuthKey: acct.authKey, entries: [] },
    });
    expect(missing.status).toBe(409);
    const extra = await acct.jar.call(passwordPOST, "POST", "/api/account/password", {
      body: { ...base, currentAuthKey: acct.authKey, entries: [fakeEntry(e.id), fakeEntry()] },
    });
    expect(extra.status).toBe(409);
    // nothing changed
    const [u] = await getDb().select().from(users);
    expect(u.kdfSalt).toBe(acct.kdfSalt);
    const [row] = await getDb().select().from(entries);
    expect(row.ciphertext).toBe(e.ciphertext);
  });

  it("enforces MAX_ENTRIES_PER_USER on create and import", async () => {
    const acct = await registerAccount();
    const [u] = await getDb().select().from(users);
    const now = new Date();
    await getDb().insert(entries).values(
      Array.from({ length: MAX_ENTRIES_PER_USER - 1 }, () => ({ ...fakeEntry(), userId: u.id, createdAt: now, updatedAt: now })),
    );
    const tooMany = await acct.jar.call(importPOST, "POST", "/api/vault/import", { body: { entries: [fakeEntry(), fakeEntry()] } });
    expect(tooMany.status).toBe(409);
    expect(errCode(tooMany)).toBe("limit_reached");
    expect((await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: fakeEntry() })).status).toBe(201);
    const full = await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: fakeEntry() });
    expect(full.status).toBe(409);
    expect(errCode(full)).toBe("limit_reached");
  });

  it("logout is idempotent and clears the cookie", async () => {
    const r = await new Jar().call(logoutPOST, "POST", "/api/auth/logout");
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });

  it("clears a stale cookie on 401", async () => {
    const jar = new Jar();
    jar.cookie = "stale-token";
    const r = await jar.call(vaultGET, "GET", "/api/vault");
    expect(r.status).toBe(401);
    expect(r.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });
});


const loginAs = (jar: Jar, username: string, authKey: string, ip?: string) =>
  jar.call(loginPOST, "POST", "/api/auth/login", {
    body: { username, authKey },
    headers: ip ? { "x-forwarded-for": ip } : undefined,
  });

describe("request body caps (streamed)", () => {
  /** A chunked body with no Content-Length; counts how many chunks the server pulled. */
  function chunkedBody(totalBytes: number, chunkBytes = 64 * 1024) {
    const state = { pulled: 0, cancelled: false };
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= totalBytes) return controller.close();
        state.pulled++;
        const n = Math.min(chunkBytes, totalBytes - sent);
        sent += n;
        controller.enqueue(new Uint8Array(n).fill(0x20));
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { stream, state };
  }

  it("cuts off a chunked 300 MB body at the 8 KiB auth cap with 413 after a few chunks", async () => {
    const { stream, state } = chunkedBody(300 * 1024 * 1024);
    const r = await new Jar().call(loginPOST, "POST", "/api/auth/login", { stream });
    expect(r.status).toBe(413);
    expect(errCode(r)).toBe("payload_too_large");
    expect(state.pulled).toBeLessThanOrEqual(2);
    expect(state.cancelled).toBe(true);
  });

  it("rejects a declared Content-Length over the cap without reading", async () => {
    const r = await new Jar().call(preloginPOST, "POST", "/api/auth/prelogin", {
      rawBody: JSON.stringify({ username: "alice" }),
      headers: { "content-length": String(9 * 1024) },
    });
    expect(r.status).toBe(413);
  });

  it("uses per-route caps: 16 KiB entries, 1 MiB import", async () => {
    const acct = await registerAccount();
    const big = (n: number) => ({ ...fakeEntry(), ciphertext: "A".repeat(n) });
    const entry = await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: big(17 * 1024) });
    expect(entry.status).toBe(413);
    const imp = chunkedBody(1024 * 1024 + 1, 128 * 1024);
    const r = await acct.jar.call(importPOST, "POST", "/api/vault/import", { stream: imp.stream });
    expect(r.status).toBe(413);
    // Within the import cap but above the auth cap is fine (validation decides).
    const ok = await acct.jar.call(importPOST, "POST", "/api/vault/import", {
      body: { entries: Array.from({ length: 50 }, () => fakeEntry()) },
    });
    expect(ok.status).toBe(201);
  });
});

describe("first-run registration guard", () => {
  const publicOrigin = "https://auth.example.com";
  const reg = (jar: Jar, extra: Record<string, unknown> = {}) =>
    jar.call(registerPOST, "POST", "/api/auth/register", {
      origin: publicOrigin,
      body: { username: "owner", authKey: fakeAuthKey(), kdfSalt: fakeSalt(), kdfParams, ...extra },
    });

  it("keeps registration closed on a public origin without SETUP_TOKEN", async () => {
    configureTestEnv({ APP_ORIGIN: publicOrigin });
    const cfg = await new Jar().call(configGET, "GET", "/api/auth/config");
    expect(cfg.body).toEqual({ registrationOpen: false, setupTokenRequired: false, closedReason: "setup_token_missing" });
    const r = await reg(new Jar());
    expect(r.status).toBe(403);
    expect(errCode(r)).toBe("registration_closed");
  });

  it("opens with SETUP_TOKEN on a public origin and requires it", async () => {
    configureTestEnv({ APP_ORIGIN: publicOrigin, SETUP_TOKEN: "a-very-long-setup-token" });
    const cfg = await new Jar().call(configGET, "GET", "/api/auth/config");
    expect(cfg.body).toEqual({ registrationOpen: true, setupTokenRequired: true });
    expect((await reg(new Jar())).status).toBe(403);
    expect((await reg(new Jar(), { setupToken: "a-very-long-setup-tokeX" })).status).toBe(403);
    const jar = new Jar();
    const ok = await reg(jar, { setupToken: "a-very-long-setup-token" });
    expect(ok.status).toBe(201);
    expect(jar.name).toBe("__Host-sid");
  });

  it("allows tokenless first registration only on loopback origins", async () => {
    for (const origin of ["http://127.0.0.1:3000", "http://[::1]:3000", "http://localhost:3000"]) {
      configureTestEnv({ APP_ORIGIN: origin });
      expect((await new Jar().call(configGET, "GET", "/api/auth/config")).body).toMatchObject({ registrationOpen: true });
    }
  });

  it("lets exactly one of two concurrent registrations win", async () => {
    const attemptReg = (username: string) =>
      new Jar().call(registerPOST, "POST", "/api/auth/register", { body: { username, authKey: fakeAuthKey(), kdfSalt: fakeSalt(), kdfParams } });
    const [ra, rb] = await Promise.all([attemptReg("first"), attemptReg("second")]);
    expect([ra.status, rb.status].sort()).toEqual([201, 403]);
    const loser = ra.status === 403 ? ra : rb;
    expect(errCode(loser)).toBe("registration_closed");
    expect(await getDb().select().from(users)).toHaveLength(1);
  });
});

describe("rate limits count failures per (username, ip)", () => {
  beforeEach(() => configureTestEnv({ TRUST_PROXY: "true" }));

  it("does not lock the owner out after 10 failures from another IP", async () => {
    const acct = await registerAccount();
    for (let i = 0; i < 10; i++) {
      const r = await loginAs(new Jar(), acct.username, fakeAuthKey(), "198.51.100.66");
      expect([401, 429]).toContain(r.status);
    }
    expect((await loginAs(new Jar(), acct.username, acct.authKey, "203.0.113.10")).status).toBe(204);
  });

  it("locks after 5 failures from the same IP, even for the right password", async () => {
    const acct = await registerAccount();
    for (let i = 0; i < 5; i++) expect((await loginAs(new Jar(), acct.username, fakeAuthKey(), "203.0.113.10")).status).toBe(401);
    const locked = await loginAs(new Jar(), acct.username, acct.authKey, "203.0.113.10");
    expect(locked.status).toBe(429);
    expect(errCode(locked)).toBe("rate_limited");
  });

  it("a successful login resets the (username, ip) counter", async () => {
    const acct = await registerAccount();
    for (let i = 0; i < 4; i++) await loginAs(new Jar(), acct.username, fakeAuthKey(), "203.0.113.10");
    expect((await loginAs(new Jar(), acct.username, acct.authKey, "203.0.113.10")).status).toBe(204);
    for (let i = 0; i < 4; i++) expect((await loginAs(new Jar(), acct.username, fakeAuthKey(), "203.0.113.10")).status).toBe(401);
    expect((await loginAs(new Jar(), acct.username, acct.authKey, "203.0.113.10")).status).toBe(204);
  });

  it("caps distributed guessing with a global per-username failure limit", async () => {
    const acct = await registerAccount();
    for (let i = 0; i < 30; i++) expect((await loginAs(new Jar(), acct.username, fakeAuthKey(), `192.0.2.${i + 1}`)).status).toBe(401);
    expect((await loginAs(new Jar(), acct.username, fakeAuthKey(), "192.0.2.200")).status).toBe(429);
  });

  it("treats unknown usernames the same way (same statuses, same limits)", async () => {
    for (let i = 0; i < 5; i++) expect((await loginAs(new Jar(), "ghost1", fakeAuthKey(), "203.0.113.10")).status).toBe(401);
    expect((await loginAs(new Jar(), "ghost1", fakeAuthKey(), "203.0.113.10")).status).toBe(429);
  });
});

describe("races", () => {
  it("swapCredentials refuses when the stored hash is no longer the verified one", async () => {
    await registerAccount();
    const [u] = await getDb().select().from(users);
    const newHash = await hashAuthKey(fakeAuthKey());
    const swap = (expected: string) =>
      getDb().transaction((tx) =>
        swapCredentials(tx, { userId: u.id, expectedAuthHash: expected, authHash: newHash, kdfSalt: fakeSalt(), kdfParams }),
      );
    expect(await swap(u.authHash)).toBe(true);
    expect(await swap(u.authHash)).toBe(false);
  });

  it("two concurrent password changes: exactly one wins, state stays consistent", async () => {
    const acct = await registerAccount();
    const e = fakeEntry();
    await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: e });
    const second = await signIn(acct);
    const change = (jar: Jar) =>
      jar.call(passwordPOST, "POST", "/api/account/password", {
        body: {
          currentAuthKey: acct.authKey,
          newAuthKey: fakeAuthKey(),
          newKdfSalt: fakeSalt(),
          newKdfParams: kdfParams,
          entries: [fakeEntry(e.id)],
        },
      });
    const [r1, r2] = await Promise.all([change(acct.jar), change(second)]);
    expect([r1.status, r2.status].filter((s) => s === 204)).toHaveLength(1);
    expect([r1.status, r2.status].every((s) => s === 204 || s === 401 || s === 409)).toBe(true);
    expect(await getDb().select().from(sessions)).toHaveLength(1);
  });

  it("password change rotates the current session token", async () => {
    const acct = await registerAccount();
    const before = acct.jar.cookie;
    const r = await acct.jar.call(passwordPOST, "POST", "/api/account/password", {
      body: { currentAuthKey: acct.authKey, newAuthKey: fakeAuthKey(), newKdfSalt: fakeSalt(), newKdfParams: kdfParams, entries: [] },
    });
    expect(r.status).toBe(204);
    expect(acct.jar.cookie).toBeDefined();
    expect(acct.jar.cookie).not.toBe(before);
    const old = new Jar();
    old.cookie = before;
    expect((await old.call(vaultGET, "GET", "/api/vault")).status).toBe(401);
    expect((await acct.jar.call(vaultGET, "GET", "/api/vault")).status).toBe(200);
  });

  it("a vault write queued behind a password change fails once its session is revoked", async () => {
    const acct = await registerAccount();
    const e = fakeEntry();
    await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: e });
    const [u] = await getDb().select().from(users);
    const client = await getPool().connect();
    try {
      // Simulate the password-change transaction: lock the user, revoke the session, commit later.
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [u.id]);
      await client.query("DELETE FROM sessions WHERE id = $1", [sessionIdFromToken(acct.jar.cookie!)]);
      const put = acct.jar.call(entryPUT, "PUT", `/api/vault/entries/${e.id}`, {
        params: { id: e.id },
        body: { ciphertext: fakeEntry().ciphertext, iv: fakeEntry().iv },
      });
      const del = new Jar();
      del.cookie = acct.jar.cookie;
      const remove = del.call(entryDELETE, "DELETE", `/api/vault/entries/${e.id}`, { params: { id: e.id } });
      await new Promise((r) => setTimeout(r, 200));
      await client.query("COMMIT");
      expect((await put).status).toBe(401);
      expect((await remove).status).toBe(401);
    } finally {
      client.release();
    }
    const [row] = await getDb().select().from(entries);
    expect(row.ciphertext).toBe(e.ciphertext);
  });
});

describe("account recovery", () => {
  const recover = (body: unknown, ip?: string) =>
    new Jar().call(recoverPOST, "POST", "/api/auth/recover", { body, headers: ip ? { "x-forwarded-for": ip } : undefined });

  it("sets a new password with the key: entries erased, old password and key dead, other sessions revoked", async () => {
    const acct = await registerAccount();
    const second = await signIn(acct);
    await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: fakeEntry() });
    await acct.jar.call(entryPOST, "POST", "/api/vault/entries", { body: fakeEntry() });
    expect(await getDb().select().from(entries)).toHaveLength(2);

    const jar = new Jar();
    const newAuthKey = fakeAuthKey();
    const newKdfSalt = fakeSalt();
    const r = await jar.call(recoverPOST, "POST", "/api/auth/recover", {
      body: recoverBody({ ...acct, recoveryKey: acct.recoveryKey.toLowerCase() }, { newAuthKey, newKdfSalt }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie()[0]).toContain("Max-Age=1209600");
    const fresh = recoverResponseSchema.parse(r.body).recoveryKey;
    expect(fresh).toMatch(KEY_RE);
    expect(fresh).not.toBe(acct.recoveryKey);

    // the vault was unreadable without the old password, so it is gone
    expect(await getDb().select().from(entries)).toHaveLength(0);
    expect((await jar.call(vaultGET, "GET", "/api/vault")).body).toEqual({ entries: [] });
    expect(sessionResponseSchema.parse((await jar.call(sessionGET, "GET", "/api/auth/session")).body).user.kdfSalt).toBe(newKdfSalt);

    // every earlier session is revoked, including the one that registered
    expect((await second.call(vaultGET, "GET", "/api/vault")).status).toBe(401);
    expect((await acct.jar.call(vaultGET, "GET", "/api/vault")).status).toBe(401);
    expect(await getDb().select().from(sessions)).toHaveLength(1);

    // old password fails, new password works
    const oldLogin = await new Jar().call(loginPOST, "POST", "/api/auth/login", { body: { username: "alice", authKey: acct.authKey } });
    expect(oldLogin.status).toBe(401);
    expect((await new Jar().call(loginPOST, "POST", "/api/auth/login", { body: { username: "alice", authKey: newAuthKey } })).status).toBe(204);

    // the used key is dead; the new key works
    const reuse = await recover(recoverBody(acct));
    expect(reuse.status).toBe(401);
    expect(errCode(reuse)).toBe("invalid_credentials");
    expect((await recover(recoverBody({ username: "alice", recoveryKey: fresh }))).status).toBe(200);
  });

  it("answers a wrong key and an unknown user with the same response", async () => {
    const acct = await registerAccount();
    const wrong = await recover(recoverBody({ username: acct.username, recoveryKey: "ABCDE-FGHJK-MNPQR-STVWX" }));
    const unknown = await recover(recoverBody({ username: "nobody", recoveryKey: acct.recoveryKey }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual({ error: { code: "invalid_credentials", message: "That username or recovery key is not right." } });
    expect(unknown.headers.getSetCookie()).toEqual(wrong.headers.getSetCookie());
    // nothing changed
    const [u] = await getDb().select().from(users);
    expect(u.kdfSalt).toBe(acct.kdfSalt);
    expect((await signIn(acct)).cookie).toBeDefined();
  });

  it("rejects a malformed key before touching the account", async () => {
    const acct = await registerAccount();
    const r = await recover(recoverBody({ username: acct.username, recoveryKey: "not-a-key" }));
    expect(r.status).toBe(400);
    expect(errCode(r)).toBe("invalid_request");
  });

  it("rate limits wrong keys per (username, ip), even for the right key afterwards", async () => {
    configureTestEnv({ TRUST_PROXY: "true" });
    const acct = await registerAccount();
    const wrong = () => recover(recoverBody({ username: acct.username, recoveryKey: "ABCDE-FGHJK-MNPQR-STVWX" }), "203.0.113.10");
    for (let i = 0; i < 5; i++) expect((await wrong()).status).toBe(401);
    const locked = await recover(recoverBody(acct), "203.0.113.10");
    expect(locked.status).toBe(429);
    expect(errCode(locked)).toBe("rate_limited");
    expect((locked.body as ApiErrorBody).error.retryAfter).toBeGreaterThan(0);
    // another address is not locked out by it
    expect((await recover(recoverBody(acct), "203.0.113.77")).status).toBe(200);
  });

  it("lets only one of two concurrent recoveries with the same key win", async () => {
    const acct = await registerAccount();
    const [a, b] = await Promise.all([recover(recoverBody(acct)), recover(recoverBody(acct))]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    expect(await getDb().select().from(sessions)).toHaveLength(1);
  });
});

describe("recovery key regeneration", () => {
  it("needs the password, rotates the stored hash and kills the old key", async () => {
    const acct = await registerAccount();
    const [before] = await getDb().select().from(users);
    const bad = await acct.jar.call(recoveryKeyPOST, "POST", "/api/account/recovery-key", { body: { authKey: fakeAuthKey() } });
    expect(bad.status).toBe(401);
    expect(errCode(bad)).toBe("invalid_credentials");
    expect((await getDb().select().from(users))[0].recoveryKeyHash).toBe(before.recoveryKeyHash);

    const ok = await acct.jar.call(recoveryKeyPOST, "POST", "/api/account/recovery-key", { body: { authKey: acct.authKey } });
    expect(ok.status).toBe(200);
    const fresh = registerResponseSchema.parse(ok.body).recoveryKey;
    expect(fresh).toMatch(KEY_RE);
    const [after] = await getDb().select().from(users);
    expect(after.recoveryKeyHash).not.toBe(before.recoveryKeyHash);
    expect(after.recoveryKeyCreatedAt.getTime()).toBeGreaterThanOrEqual(before.recoveryKeyCreatedAt.getTime());

    const old = await new Jar().call(recoverPOST, "POST", "/api/auth/recover", { body: recoverBody(acct) });
    expect(old.status).toBe(401);
    const fine = await new Jar().call(recoverPOST, "POST", "/api/auth/recover", { body: recoverBody({ username: acct.username, recoveryKey: fresh }) });
    expect(fine.status).toBe(200);
  });

  it("is rate limited per account", async () => {
    const acct = await registerAccount();
    for (let i = 0; i < 5; i++) {
      expect((await acct.jar.call(recoveryKeyPOST, "POST", "/api/account/recovery-key", { body: { authKey: acct.authKey } })).status).toBe(200);
    }
    const r = await acct.jar.call(recoveryKeyPOST, "POST", "/api/account/recovery-key", { body: { authKey: acct.authKey } });
    expect(r.status).toBe(429);
    expect(errCode(r)).toBe("rate_limited");
  });
});

describe("health", () => {
  it("GET /api/health returns {ok:true} with no-store", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
