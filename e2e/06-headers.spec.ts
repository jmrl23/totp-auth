import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import { E2E_ORIGIN } from "./env";
import {
  newAccount,
  newProjectContext,
  registerViaUi,
  signOut,
  submitPassword,
  waitForVault,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const acct = newAccount("e2e-headers");

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  page = await context.newPage();
  await registerViaUi(page, acct);
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((p) => p[0])
      .map(([name, ...values]) => [name, values]),
  );
}

test("/login sends a strict nonce CSP and the security headers", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.status()).toBe(200);
  const h = res.headers();
  const csp = h["content-security-policy"];
  expect(csp).toBeTruthy();
  const d = directives(csp);
  const nonce = d.get("script-src")?.find((v) => v.startsWith("'nonce-"));
  expect(nonce).toMatch(/^'nonce-[A-Za-z0-9+/=]{16,}'$/);
  expect(d.get("script-src")).toEqual(["'self'", nonce, "'strict-dynamic'", "'wasm-unsafe-eval'"]);
  expect(d.get("script-src")).not.toContain("'unsafe-eval'");
  expect(d.get("script-src")).not.toContain("'unsafe-inline'");
  expect(d.get("style-src")).toContain(nonce);
  expect(d.get("style-src")).not.toContain("'unsafe-inline'");
  expect(d.get("default-src")).toEqual(["'self'"]);
  expect(d.get("frame-ancestors")).toEqual(["'none'"]);
  expect(d.get("object-src")).toEqual(["'none'"]);
  expect(d.get("base-uri")).toEqual(["'self'"]);
  expect(d.get("form-action")).toEqual(["'self'"]);
  expect(d.get("connect-src")).toEqual(["'self'"]);
  expect(d.get("worker-src")).toEqual(["'self'", "blob:"]);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["cross-origin-opener-policy"]).toBe("same-origin");
  expect(h["permissions-policy"]).toBe("camera=(self), microphone=(), geolocation=()");
  expect(h["x-powered-by"]).toBeUndefined();
  // Plain http origin: no HSTS.
  expect(h["strict-transport-security"]).toBeUndefined();

  // Every inline/next script in the document carries the same nonce, and it changes per request.
  const html = await res.text();
  const raw = nonce!.slice(7, -1);
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(s).toContain(`nonce="${raw}"`);
  const again = directives((await request.get("/login")).headers()["content-security-policy"]);
  expect(again.get("script-src")).not.toContain(nonce);
});

test("API responses are no-store; /api/vault is 401 without a cookie", async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: E2E_ORIGIN });
  try {
    const res = await anon.get("/api/vault");
    expect(res.status()).toBe(401);
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect((await res.json()).error.code).toBe("unauthorized");
    const session = await anon.get("/api/auth/session");
    expect(session.status()).toBe(401);
    const time = await anon.get("/api/time");
    expect(time.headers()["cache-control"]).toContain("no-store");
  } finally {
    await anon.dispose();
  }
});

test("cross-origin and non-JSON POSTs are rejected with 403", async ({ playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: E2E_ORIGIN });
  try {
    const data = { username: acct.username, authKey: "A".repeat(43) };
    const evil = await anon.post("/api/auth/login", {
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      data,
    });
    expect(evil.status()).toBe(403);
    expect((await evil.json()).error.code).toBe("forbidden");

    const noOrigin = await anon.post("/api/auth/login", { headers: { "Content-Type": "application/json" }, data });
    expect(noOrigin.status()).toBe(403);

    const form = await anon.post("/api/auth/login", {
      headers: { Origin: E2E_ORIGIN, "Content-Type": "text/plain" },
      data: JSON.stringify(data),
    });
    expect(form.status()).toBe(403);

    // Same request from the right origin reaches the handler (generic 401).
    const ok = await anon.post("/api/auth/login", {
      headers: { Origin: E2E_ORIGIN, "Content-Type": "application/json" },
      data,
    });
    expect(ok.status()).toBe(401);
    expect((await ok.json()).error).toMatchObject({ code: "invalid_credentials", message: "Wrong username or password." });
  } finally {
    await anon.dispose();
  }
});

test("a signed-in request with a foreign Origin is rejected and the session survives", async () => {
  // A logged-in cookie is SameSite=Strict, and the Origin header would not match anyway.
  const res = await page.request.post("/api/auth/logout", {
    headers: { Origin: "http://evil.localhost:3100", "Content-Type": "application/json" },
    data: {},
  });
  expect(res.status()).toBe(403);
  await page.reload();
  await waitForVault(page);
});

test("session cookie is HttpOnly, SameSite=Strict, Path=/ (and new on every sign-in)", async () => {
  const before = (await context.cookies()).find((c) => c.name === "sid");
  expect(before).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/", secure: false });

  await signOut(page, acct.username);
  expect((await context.cookies()).find((c) => c.name === "sid")).toBeUndefined();

  const loginRes = page.waitForResponse((r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await submitPassword(page, acct.username, acct.password);
  const login = await loginRes;
  const loginCookie = await login.headerValue("set-cookie");
  expect(loginCookie).toMatch(/^sid=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/);
  expect(login.status()).toBe(204);
  await waitForVault(page);

  const after = (await context.cookies()).find((c) => c.name === "sid");
  expect(after).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  expect(after!.value).not.toBe(before!.value);
  // Not readable from page script.
  expect(await page.evaluate(() => document.cookie)).not.toContain("sid=");
});
