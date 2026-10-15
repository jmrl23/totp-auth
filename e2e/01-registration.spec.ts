import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import {
  captureRequestBodies,
  expectNoSecretIn,
  newAccount,
  newProjectContext,
  passwordField,
  RECOVERY_KEY_RE,
  readRecoveryKey,
  waitForVault,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let bodies: string[];
const acct = newAccount("e2e-owner");

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  bodies = captureRequestBodies(context);
  page = await context.newPage();
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

test("fresh instance: registration is open and the login page links to it", async () => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Create the account" })).toBeVisible();
  const config = await page.request.get("/api/auth/config");
  expect(await config.json()).toEqual({ registrationOpen: true, setupTokenRequired: false });
  await page.getByRole("link", { name: "Create the account" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByText("Step 1 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("account step rejects a weak password and mismatched repeat", async () => {
  await page.getByLabel("Username").fill(acct.username);
  await passwordField(page).fill("short");
  await expect(page.getByText("Too short: 7 more characters needed.")).toBeVisible();
  await passwordField(page, "Repeat password").fill("short");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await passwordField(page).fill(acct.password);
  await passwordField(page, "Repeat password").fill(acct.password + "x");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("The passwords do not match.")).toBeVisible();
});

test("strong password creates the account and shows the recovery key", async () => {
  await passwordField(page).fill(acct.password);
  await expect(page.getByText("Strong length.")).toBeVisible();
  await passwordField(page, "Repeat password").fill(acct.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery key" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
  acct.recoveryKey = await readRecoveryKey(page);
  expect(acct.recoveryKey).toMatch(RECOVERY_KEY_RE);
  await expect(page.getByText(/erase/i).first()).toBeVisible();
});

test("Download .txt saves a file with the key and the username", async () => {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download .txt" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`totp-auth-recovery-key-${acct.username}.txt`);
  const text = await readFile(await download.path(), "utf8");
  expect(text).toContain(acct.recoveryKey);
  expect(text).toContain(acct.username);
});

test("continuing needs the checkbox", async () => {
  const open = page.getByRole("button", { name: "Open my vault" });
  await expect(open).toBeDisabled();
  await page.getByLabel("I saved my recovery key").check();
  await expect(open).toBeEnabled();
  await page.getByLabel("I saved my recovery key").uncheck();
  await expect(open).toBeDisabled();
  await page.getByLabel("I saved my recovery key").check();
  await open.click();
  await expect(page).toHaveURL(/\/vault$/);
  await waitForVault(page);
  await expect(page.getByRole("heading", { name: "No entries yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add your first entry" })).toBeVisible();
});

test("registration is closed once the account exists", async ({ browser }, testInfo) => {
  const other = await newProjectContext(browser, testInfo);
  try {
    const p = await other.newPage();
    await p.goto("/register");
    await expect(p.getByRole("heading", { name: "Registration is closed on this instance" })).toBeVisible();
    await expect(p.getByRole("link", { name: "Go to sign in" })).toBeVisible();
    await p.goto("/login");
    await expect(p.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(p.getByRole("link", { name: "Create the account" })).toHaveCount(0);
    const config = await p.request.get("/api/auth/config");
    expect((await config.json()).registrationOpen).toBe(false);
  } finally {
    await other.close();
  }
});

test("the password never left the browser during registration", async () => {
  expect(bodies.some((b) => b.includes("/api/auth/register"))).toBe(true);
  expectNoSecretIn(bodies, [acct.password]);
});
