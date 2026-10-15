import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import {
  RFC_SHA1,
  RFC_SHA256,
  awaitFreshPeriod,
  issuersShown,
  newAccount,
  newProjectContext,
  registerViaUi,
  row,
  shownCode,
  totpAt,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const acct = newAccount("e2e-entries");

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

async function openAdd(): Promise<Locator> {
  const empty = page.getByRole("button", { name: "Add your first entry" });
  if (await empty.isVisible()) await empty.click();
  else await page.getByRole("banner").getByRole("button", { name: "Add entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add entry" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeDialog(dialog: Locator) {
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("paste link: validation errors for empty, junk, HOTP and unsupported links", async () => {
  const dialog = await openAdd();
  await dialog.getByRole("tab", { name: "Paste link" }).click();
  const field = dialog.getByLabel("Setup link or secret");
  const go = dialog.getByRole("button", { name: "Continue" });

  await go.click();
  await expect(dialog.getByText("Paste an otpauth:// link or a secret.")).toBeVisible();

  await field.fill("hello world");
  await go.click();
  await expect(dialog.getByText(/^This is neither an otpauth:\/\/ link nor a base32 secret\./)).toBeVisible();

  await field.fill(`otpauth://hotp/Bank:me?secret=${RFC_SHA1}&counter=1`);
  await go.click();
  await expect(
    dialog.getByText("This is a counter-based (HOTP) code. Only time-based (TOTP) codes are supported."),
  ).toBeVisible();

  await field.fill(`otpauth://totp/Bank:me?secret=${RFC_SHA1}&algorithm=MD5`);
  await go.click();
  await expect(dialog.getByText("The MD5 algorithm is not supported. Use SHA1, SHA256 or SHA512.")).toBeVisible();

  await field.fill(`otpauth://totp/Bank:me?secret=${RFC_SHA1}&digits=10`);
  await go.click();
  await expect(dialog.getByText("Codes with 10 digits are not supported. Use 6, 7 or 8 digits.")).toBeVisible();

  await field.fill("otpauth://totp/Bank:me?issuer=Bank");
  await go.click();
  await expect(dialog.getByText("This link has no secret.")).toBeVisible();
  await closeDialog(dialog);
});

test("paste link: an otpauth:// link fills the review form and adds the entry", async () => {
  const dialog = await openAdd();
  await dialog.getByRole("tab", { name: "Paste link" }).click();
  await dialog
    .getByLabel("Setup link or secret")
    .fill(`otpauth://totp/GitHub:octocat%40example.com?secret=${RFC_SHA1}&issuer=GitHub`);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByText("Check the details, then add the entry.")).toBeVisible();
  await expect(dialog.getByLabel("Service")).toHaveValue("GitHub");
  await expect(dialog.getByLabel("Account (optional)")).toHaveValue("octocat@example.com");
  await expect(dialog.getByLabel("Secret")).toHaveValue(RFC_SHA1);
  await expect(dialog.getByRole("button", { name: /^Advanced/ })).toContainText("SHA-1, 6 digits, 30 s");
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Added GitHub (octocat@example.com).")).toBeVisible();
  await expect(row(page, "GitHub")).toContainText("octocat@example.com");
});

test("manual entry: validation errors for missing service, bad secret and bad period", async () => {
  const dialog = await openAdd();
  await dialog.getByRole("tab", { name: "Enter manually" }).click();
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await expect(dialog.getByText("Enter the service name.")).toBeVisible();
  await expect(dialog.getByText("Enter a valid base32 secret (A to Z, 2 to 7).")).toBeVisible();

  await dialog.getByLabel("Service").fill("Broken");
  await dialog.getByLabel("Secret").fill("not-base32-1890");
  await dialog.getByRole("button", { name: /^Advanced/ }).click();
  await dialog.getByLabel("Period (seconds)").fill("5");
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await expect(dialog.getByText("Enter a valid base32 secret (A to Z, 2 to 7).")).toBeVisible();
  await expect(dialog.getByText("Use a whole number from 10 to 120.")).toBeVisible();
  await expect(dialog.getByText("Enter the service name.")).toHaveCount(0);
  await closeDialog(dialog);
  expect(await issuersShown(page)).toEqual(["GitHub"]);
});

async function pickOption(dialog: Locator, label: string, option: string) {
  await dialog.getByLabel(label).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(dialog.getByLabel(label)).toContainText(option);
}

test("manual entry with Advanced SHA-256, 8 digits, 60 s", async () => {
  const dialog = await openAdd();
  await dialog.getByRole("tab", { name: "Enter manually" }).click();
  await dialog.getByLabel("Service").fill("Cloudflare");
  await dialog.getByLabel("Account (optional)").fill("ops@example.com");
  // Lowercase with spaces: normalised by the schema.
  await dialog.getByLabel("Secret").fill(RFC_SHA256.toLowerCase().replace(/(.{4})/g, "$1 "));
  await dialog.getByRole("button", { name: /^Advanced/ }).click();
  await pickOption(dialog, "Algorithm", "SHA-256");
  await pickOption(dialog, "Digits", "8");
  await dialog.getByLabel("Period (seconds)").fill("60");
  await expect(dialog.getByRole("button", { name: /^Advanced/ })).toContainText("SHA-256, 8 digits, 60 s");
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Added Cloudflare (ops@example.com).")).toBeVisible();
  expect(await issuersShown(page)).toEqual(["Cloudflare", "GitHub"]);
});

test("displayed codes equal otpauth's codes for the RFC 6238 secrets", async () => {
  await awaitFreshPeriod(30, 3);
  const now = Date.now();
  expect(await shownCode(page, "GitHub")).toBe(totpAt(RFC_SHA1, now));
  const left = Number((await row(page, "GitHub").locator(".ga-secs[aria-hidden]").innerText()).replace(" s", ""));
  expect(Math.abs(left - (30 - Math.floor((now % 30_000) / 1000)))).toBeLessThanOrEqual(1);

  await awaitFreshPeriod(60, 3);
  const cf = await shownCode(page, "Cloudflare");
  expect(cf).toHaveLength(8);
  expect(cf).toBe(totpAt(RFC_SHA256, Date.now(), { algorithm: "SHA256", digits: 8, period: 60 }));
  // 8 digits are grouped 4 + 4.
  await expect(row(page, "Cloudflare").locator(".ga-code > span[aria-hidden]")).toHaveText(/^\d{4} \d{4}$/);
});

test("tapping a row copies exactly the digits and confirms it", async () => {
  await awaitFreshPeriod(30, 4);
  await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
  const expected = totpAt(RFC_SHA1, Date.now());
  await row(page, "GitHub").getByRole("button", { name: /^Copy code:/ }).click();
  await expect(row(page, "GitHub").getByText("Copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  await expect(row(page, "GitHub").getByText("Copied", { exact: true })).toBeHidden({ timeout: 5_000 });
  await expect(row(page, "GitHub")).toContainText("octocat@example.com");

  await awaitFreshPeriod(60, 4);
  const expected8 = totpAt(RFC_SHA256, Date.now(), { algorithm: "SHA256", digits: 8, period: 60 });
  await row(page, "Cloudflare").getByRole("button", { name: /^Copy code:/ }).click();
  await expect(row(page, "Cloudflare").getByText("Copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected8);
});
