import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, query, resetDatabase } from "./db";
import {
  RFC_SHA1,
  RFC_SHA256,
  accountAction,
  captureRequestBodies,
  expectNoSecretIn,
  importLinks,
  loginViaUi,
  newAccount,
  newProjectContext,
  passwordField,
  registerViaUi,
  signOut,
  waitForVault,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let bodies: string[];
const acct = newAccount("e2e-zk", "zero knowledge passphrase e2e");

const PLAIN = [
  { issuer: "Mastodon", label: "toot@mastodon.example", secret: RFC_SHA1 },
  { issuer: "Fastmail", label: "inbox@fastmail.example", secret: RFC_SHA256 },
];

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  bodies = captureRequestBodies(context);
  page = await context.newPage();
  await registerViaUi(page, acct);
  await importLinks(
    page,
    acct.username,
    PLAIN.map((p) => `otpauth://totp/${p.issuer}:${encodeURIComponent(p.label)}?secret=${p.secret}&issuer=${p.issuer}`),
  );
  // Exercise unlock and a fresh login too, so every password-handling request is captured.
  await accountAction(page, acct.username, "Lock");
  await passwordField(page).fill(acct.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await waitForVault(page);
  await signOut(page, acct.username);
  await clearRateLimits();
  await loginViaUi(page, acct);
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

function variants(s: string): string[] {
  const b = Buffer.from(s);
  return [s, s.toLowerCase(), b.toString("base64"), b.toString("base64url"), b.toString("hex")];
}

test("entries are stored as ciphertext only", async () => {
  const rows = await query<{ id: string; ciphertext: string; iv: string }>(
    `SELECT e.id, e.ciphertext, e.iv FROM entries e JOIN users u ON u.id = e.user_id WHERE u.username = $1`,
    [acct.username],
  );
  expect(rows).toHaveLength(2);
  const ivs = new Set<string>();
  for (const r of rows) {
    expect(r.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(r.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    ivs.add(r.iv);
    const raw = Buffer.from(r.ciphertext, "base64url");
    const decoded = raw.toString("latin1");
    for (const p of PLAIN) {
      for (const needle of [p.issuer, p.label, p.secret, p.secret.toLowerCase()]) {
        for (const v of variants(needle)) expect(r.ciphertext).not.toContain(v);
        expect(decoded).not.toContain(needle);
      }
    }
    expect(decoded).not.toContain("issuer");
    expect(decoded).not.toContain("secret");
  }
  expect(ivs.size).toBe(2);
});

test("users.auth_hash is an argon2id hash, not the password or a plain digest of it", async () => {
  const [u] = await query<{ auth_hash: string; kdf_salt: string; kdf_params: unknown }>(
    `SELECT auth_hash, kdf_salt, kdf_params FROM users WHERE username = $1`,
    [acct.username],
  );
  expect(u.auth_hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  const pw = acct.password;
  const digests = [
    createHash("sha256").update(pw).digest("hex"),
    createHash("sha256").update(pw).digest("base64"),
    createHash("sha256").update(pw).digest("base64url"),
    createHash("sha1").update(pw).digest("hex"),
  ];
  for (const v of [...variants(pw), ...digests]) {
    expect(u.auth_hash).not.toContain(v);
  }
  // The server-side argon2 salt is its own, not the client KDF salt.
  const serverSalt = u.auth_hash.split("$")[4];
  expect(serverSalt).not.toBe(u.kdf_salt.replace(/-/g, "+").replace(/_/g, "/"));
  expect(u.kdf_params).toEqual({ alg: "argon2id", m: 65536, t: 3, p: 1, v: 1 });
});

test("the recovery key and sessions are stored as hashes", async () => {
  const [u] = await query<{ recovery_key_hash: string }>(
    `SELECT recovery_key_hash FROM users WHERE username = $1`,
    [acct.username],
  );
  expect(u.recovery_key_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(u.recovery_key_hash.toUpperCase()).not.toContain(acct.recoveryKey.replace(/-/g, ""));
  const columns = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
  );
  expect(columns.map((c) => c.column_name).filter((c) => c.includes("totp"))).toEqual([]);
  const tables = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'recovery_codes'`,
  );
  expect(tables).toEqual([]);
  const cookies = await context.cookies();
  const sid = cookies.find((c) => c.name === "sid");
  expect(sid?.value).toBeTruthy();
  const sessions = await query<{ id: string }>(`SELECT id FROM sessions`);
  expect(sessions.map((s) => s.id)).not.toContain(sid!.value);
  expect(sessions.map((s) => s.id)).toContain(createHash("sha256").update(sid!.value).digest("hex"));
});

test("no request body or URL ever carried the plaintext password or a vault secret", async () => {
  expect(bodies.some((b) => b.includes("/api/auth/login"))).toBe(true);
  expect(bodies.some((b) => b.includes("/api/auth/unlock"))).toBe(true);
  expect(bodies.some((b) => b.includes("/api/vault/import"))).toBe(true);
  expectNoSecretIn(bodies, [acct.password, RFC_SHA1, RFC_SHA256, ...PLAIN.map((p) => p.label)]);
});
