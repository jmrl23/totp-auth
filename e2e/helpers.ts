import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { E2E_ORIGIN } from "./env";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- accounts ---------- */

export type Account = {
  username: string;
  password: string;
  /** Recovery key as shown (XXXXX-XXXXX-XXXXX-XXXXX), read from the registration screen. */
  recoveryKey: string;
};

export const RECOVERY_KEY_RE = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/;

export function newAccount(username: string, password = "correct horse battery staple 42"): Account {
  return { username, password, recoveryKey: "" };
}

/* ---------- TOTP ---------- */

type TotpOpts = { algorithm?: string; digits?: number; period?: number };

export function totpAt(secret: string, timestamp: number, opts: TotpOpts = {}): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: opts.algorithm ?? "SHA1",
    digits: opts.digits ?? 6,
    period: opts.period ?? 30,
  }).generate({ timestamp });
}

/** Seconds left in the current period. */
export function secondsLeft(period = 30, now = Date.now()): number {
  return period - Math.floor((now % (period * 1000)) / 1000);
}

/** Waits until at least `min` seconds remain in the current period. */
export async function awaitFreshPeriod(period = 30, min = 3): Promise<void> {
  const ms = Date.now() % (period * 1000);
  const left = period * 1000 - ms;
  if (left < min * 1000) await sleep(left + 200);
}

/* ---------- pages ---------- */

/**
 * A context built from the project's `use` options, for describe blocks that keep one page
 * across serial tests (the vault key lives in this context's IndexedDB).
 */
export async function newProjectContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const u = testInfo.project.use;
  return browser.newContext({
    baseURL: E2E_ORIGIN,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    permissions: u.permissions,
    reducedMotion: u.reducedMotion,
    locale: u.locale,
    timezoneId: u.timezoneId,
    acceptDownloads: true,
  });
}

export const isMobileProject = (testInfo: TestInfo) => testInfo.project.name === "mobile";

/** Records every request body so a test can assert the password never leaves the browser. */
export function captureRequestBodies(context: BrowserContext): string[] {
  const bodies: string[] = [];
  context.on("request", (req) => {
    const body = req.postData();
    if (body) bodies.push(`${req.method()} ${req.url()} ${body}`);
    bodies.push(`${req.method()} ${req.url()}`);
  });
  return bodies;
}

export function expectNoSecretIn(bodies: string[], secrets: string[]): void {
  for (const s of secrets) {
    const hits = bodies.filter((b) => b.includes(s) || b.includes(encodeURIComponent(s)));
    expect(hits, `request bodies or URLs containing a secret`).toEqual([]);
  }
}

export function passwordField(page: Pick<Page, "getByLabel">, label = "Password") {
  return page.getByLabel(label, { exact: true });
}

/* ---------- registration ---------- */

/** The key shown in the recovery key panel (digits and letters, dashes included). */
export async function readRecoveryKey(page: Page): Promise<string> {
  const text = await page.getByRole("group", { name: "Recovery key" }).innerText();
  return text.trim().split(/\s+/).join("-");
}

export async function registerViaUi(
  page: Page,
  acct: Account,
  shot?: (name: string) => Promise<void>,
): Promise<Account> {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await shot?.("register-account");
  await page.getByLabel("Username").fill(acct.username);
  await passwordField(page).fill(acct.password);
  await passwordField(page, "Repeat password").fill(acct.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery key" })).toBeVisible({ timeout: 30_000 });
  acct.recoveryKey = await readRecoveryKey(page);
  expect(acct.recoveryKey).toMatch(RECOVERY_KEY_RE);
  await shot?.("register-key");
  await page.getByLabel("I saved my recovery key").check();
  await page.getByRole("button", { name: "Open my vault" }).click();
  await expect(page).toHaveURL(/\/vault$/);
  await waitForVault(page);
  return acct;
}

/** Waits for the unlocked vault: either rows or the empty state. */
export async function waitForVault(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "No entries yet" }).or(page.getByRole("region", { name: "Entries" })),
  ).toBeVisible({ timeout: 30_000 });
}

/* ---------- sign in ---------- */

export async function submitPassword(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await passwordField(page).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function loginViaUi(page: Page, acct: Account): Promise<void> {
  await submitPassword(page, acct.username, acct.password);
  await expect(page).toHaveURL(/\/vault$/, { timeout: 30_000 });
  await waitForVault(page);
}

/* ---------- vault ---------- */

export async function openAccountMenu(page: Page, username: string): Promise<void> {
  await page.getByRole("button", { name: `Account menu for ${username}` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

export async function accountAction(page: Page, username: string, item: string): Promise<void> {
  await openAccountMenu(page, username);
  await page.getByRole("menuitem", { name: item }).click();
}

export async function signOut(page: Page, username: string): Promise<void> {
  await accountAction(page, username, "Sign out");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

/** The copy button of the row whose issuer is `issuer`. */
export function row(page: Page, issuer: string) {
  return page
    .getByRole("region", { name: "Entries" })
    .getByRole("listitem")
    .filter({ has: page.locator(".ga-issuer", { hasText: new RegExp(`^${escapeRe(issuer)}$`) }) });
}

export function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Digits currently shown in a row (spaces removed). */
export async function shownCode(page: Page, issuer: string): Promise<string> {
  const text = await row(page, issuer).locator(".ga-code > span[aria-hidden]").innerText();
  return text.replace(/\s+/g, "");
}

export async function issuersShown(page: Page): Promise<string[]> {
  return page.getByRole("region", { name: "Entries" }).locator("li .ga-issuer").allInnerTexts();
}

/** Bulk-adds entries through Account menu > Import (paste). */
export async function importLinks(page: Page, username: string, links: string[]): Promise<void> {
  await accountAction(page, username, "Import");
  const dialog = page.getByRole("dialog", { name: "Import entries" });
  await dialog.getByLabel("Or paste the links").fill(links.join("\n"));
  await dialog.getByRole("button", { name: "Check entries" }).click();
  await dialog.getByRole("button", { name: /^Import \d+ entr/ }).click();
  await expect(dialog).toBeHidden();
}

export async function waitForToastsGone(page: Page): Promise<void> {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
}

/* ---------- RFC 6238 test secrets ---------- */

/** RFC 6238 appendix B seeds, base32. */
export const RFC_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
export const RFC_SHA256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA"; // 32 bytes
