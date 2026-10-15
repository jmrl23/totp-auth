/**
 * Two logical instances with no shared memory: each gets a fresh module graph (its own env cache,
 * pg pool, dummy hash, throttles). Register on A, login on B, recover on A, vault on B: all state is in Postgres.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { fakeAuthKey, fakeSalt, Jar, kdfParams, setupTestDb } from "@/lib/server/testing/helpers";
import { registerResponseSchema } from "@/lib/schemas";

setupTestDb();

type Instance = {
  register: typeof import("./auth/register/route").POST;
  login: typeof import("./auth/login/route").POST;
  recover: typeof import("./auth/recover/route").POST;
  vault: typeof import("./vault/route").GET;
  close: () => Promise<void>;
};

const g = globalThis as unknown as { __totpAuthDb?: unknown };

async function bootInstance(): Promise<Instance> {
  vi.resetModules();
  delete g.__totpAuthDb; // force a brand-new pg pool for this instance
  const db = await import("@/db");
  return {
    register: (await import("./auth/register/route")).POST,
    login: (await import("./auth/login/route")).POST,
    recover: (await import("./auth/recover/route")).POST,
    vault: (await import("./vault/route")).GET,
    close: db.closeDb,
  };
}

const instances: Instance[] = [];
afterAll(async () => {
  for (const i of instances) await i.close();
});

describe("stateless operation", () => {
  it("registers on one instance, logs in and recovers on others", async () => {
    const a = await bootInstance();
    const b = await bootInstance();
    instances.push(a, b);
    expect(a.login).not.toBe(b.login);

    const authKey = fakeAuthKey();
    const first = new Jar();
    const reg = await first.call(a.register, "POST", "/api/auth/register", {
      body: { username: "alice", authKey, kdfSalt: fakeSalt(), kdfParams },
    });
    expect(reg.status).toBe(201);
    const { recoveryKey } = registerResponseSchema.parse(reg.body);
    expect((await first.call(b.vault, "GET", "/api/vault")).status).toBe(200);

    const browser = new Jar();
    expect((await browser.call(b.login, "POST", "/api/auth/login", { body: { username: "alice", authKey } })).status).toBe(204);
    expect((await browser.call(a.vault, "GET", "/api/vault")).status).toBe(200);

    const newAuthKey = fakeAuthKey();
    const rec = await new Jar().call(b.recover, "POST", "/api/auth/recover", {
      body: { username: "alice", recoveryKey, newAuthKey, newKdfSalt: fakeSalt(), newKdfParams: kdfParams },
    });
    expect(rec.status).toBe(200);
    expect((await browser.call(a.vault, "GET", "/api/vault")).status).toBe(401);
    const again = new Jar();
    expect((await again.call(a.login, "POST", "/api/auth/login", { body: { username: "alice", authKey: newAuthKey } })).status).toBe(204);
  });
});
