import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import {
  RECOVERY_KEY_RE,
  RFC_SHA1,
  issuersShown,
  importLinks,
  newAccount,
  newProjectContext,
  passwordField,
  readRecoveryKey,
  registerViaUi,
  signOut,
  submitPassword,
  waitForVault,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const acct = newAccount("e2e-recover");
const SECOND_PASSWORD = "second passphrase after recovery 2026";
const THIRD_PASSWORD = "third passphrase after recovery 2026";
const WRONG_KEY_MESSAGE = "That username and recovery key do not match. Check both and try again.";

const LINKS = [
  `otpauth://totp/GitHub:octocat%40example.com?secret=${RFC_SHA1}&issuer=GitHub`,
  "otpauth://totp/Proton:me%40proton.me?secret=KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU&issuer=Proton",
];

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  page = await context.newPage();
  await registerViaUi(page, acct);
  await importLinks(page, acct.username, LINKS);
  await expect(page.getByRole("region", { name: "Entries" }).getByRole("listitem")).toHaveCount(2);
  await signOut(page, acct.username);
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

async function fillRecover(username: string, key: string, password: string, erase = true): Promise<void> {
  await page.goto("/recover");
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Recovery key").fill(key);
  await passwordField(page, "New password").fill(password);
  await passwordField(page, "Repeat new password").fill(password);
  if (erase) await page.getByLabel("I understand my saved entries will be erased").check();
  await page.getByRole("button", { name: "Set new password" }).click();
}

test("recovery needs the erase confirmation", async () => {
  await fillRecover(acct.username, acct.recoveryKey, SECOND_PASSWORD, false);
  await expect(page.getByText(/erased/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Save your new recovery key" })).toHaveCount(0);
});

test("a wrong key or unknown user gets the same error and changes nothing", async () => {
  await fillRecover(acct.username, "77777-77777-CCCCC-DDDDD", SECOND_PASSWORD);
  await expect(page.getByText(WRONG_KEY_MESSAGE)).toBeVisible({ timeout: 30_000 });
  await fillRecover("nobody-here", acct.recoveryKey, SECOND_PASSWORD);
  await expect(page.getByText(WRONG_KEY_MESSAGE)).toBeVisible({ timeout: 30_000 });
  await fillRecover(acct.username, "not a key", SECOND_PASSWORD);
  await expect(page.getByText("Enter your 20-character recovery key.")).toBeVisible();
  // The original password still works.
  await submitPassword(page, acct.username, acct.password);
  await waitForVault(page);
  expect(await issuersShown(page)).toEqual(["GitHub", "Proton"]);
  await signOut(page, acct.username);
});

test("recovery sets a new password, erases entries and issues a new key", async () => {
  const oldKey = acct.recoveryKey;
  // Lowercase and no dashes are accepted.
  await fillRecover(acct.username, oldKey.replace(/-/g, "").toLowerCase(), SECOND_PASSWORD);
  await expect(page.getByRole("heading", { name: "Save your new recovery key" })).toBeVisible({ timeout: 30_000 });
  const fresh = await readRecoveryKey(page);
  expect(fresh).toMatch(RECOVERY_KEY_RE);
  expect(fresh).not.toBe(oldKey);
  acct.recoveryKey = fresh;
  await page.getByLabel("I saved my recovery key").check();
  await page.getByRole("button", { name: "Open my vault" }).click();
  await expect(page).toHaveURL(/\/vault$/);
  await waitForVault(page);
  await expect(page.getByRole("heading", { name: "No entries yet" })).toBeVisible();

  await signOut(page, acct.username);
  await submitPassword(page, acct.username, acct.password);
  await expect(page.getByText("Wrong username or password.")).toBeVisible({ timeout: 30_000 });
  await submitPassword(page, acct.username, SECOND_PASSWORD);
  await waitForVault(page);
  expect(await issuersShown(page)).toEqual([]);
  await signOut(page, acct.username);

  // The earlier key is gone.
  await fillRecover(acct.username, oldKey, THIRD_PASSWORD);
  await expect(page.getByText(WRONG_KEY_MESSAGE)).toBeVisible({ timeout: 30_000 });
});

test("the new key works for a second recovery", async () => {
  const issued = acct.recoveryKey;
  await fillRecover(acct.username, issued, THIRD_PASSWORD);
  await expect(page.getByRole("heading", { name: "Save your new recovery key" })).toBeVisible({ timeout: 30_000 });
  const next = await readRecoveryKey(page);
  expect(next).not.toBe(issued);
  acct.recoveryKey = next;
  await page.getByLabel("I saved my recovery key").check();
  await page.getByRole("button", { name: "Open my vault" }).click();
  await waitForVault(page);
  await signOut(page, acct.username);
  await submitPassword(page, acct.username, THIRD_PASSWORD);
  await waitForVault(page);
});
