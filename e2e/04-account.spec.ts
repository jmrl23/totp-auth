import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { E2E_ORIGIN } from "./env";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import {
  RFC_SHA1,
  RFC_SHA256,
  accountAction,
  RECOVERY_KEY_RE,
  awaitFreshPeriod,
  captureRequestBodies,
  readRecoveryKey,
  expectNoSecretIn,
  importLinks,
  issuersShown,
  newAccount,
  newProjectContext,
  passwordField,
  registerViaUi,
  row,
  shownCode,
  signOut,
  submitPassword,
  totpAt,
  waitForVault,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let bodies: string[];
const acct = newAccount("e2e-account");
const NEW_PASSWORD = "a brand new passphrase for e2e 2026";

const SEED = [
  `otpauth://totp/GitHub:octocat%40example.com?secret=${RFC_SHA1}&issuer=GitHub`,
  `otpauth://totp/Cloudflare:ops%40example.com?secret=${RFC_SHA256}&issuer=Cloudflare&algorithm=SHA256&digits=8&period=60`,
  "otpauth://totp/Proton:me%40proton.me?secret=KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU&issuer=Proton",
];

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  bodies = captureRequestBodies(context);
  page = await context.newPage();
  await registerViaUi(page, acct);
  await importLinks(page, acct.username, SEED);
  await expect(page.getByRole("region", { name: "Entries" }).getByRole("listitem")).toHaveCount(3);
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

test("Export downloads one otpauth:// line per entry", async () => {
  await accountAction(page, acct.username, "Export");
  const dialog = page.getByRole("dialog", { name: "Export entries" });
  await expect(dialog.getByText("The file is not encrypted")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download 3 entries" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^totp-auth-export-\d{4}-\d{2}-\d{2}\.txt$/);
  const text = await readFile(await download.path(), "utf8");
  const lines = text.trim().split("\n");
  expect(lines).toHaveLength(3);
  for (const line of lines) expect(line).toMatch(/^otpauth:\/\/totp\//);
  const parsed = lines.map((l) => OTPAuth.URI.parse(l) as OTPAuth.TOTP);
  const byIssuer = Object.fromEntries(parsed.map((t) => [t.issuer, t]));
  expect(Object.keys(byIssuer).sort()).toEqual(["Cloudflare", "GitHub", "Proton"]);
  expect(byIssuer.GitHub.secret.base32).toBe(RFC_SHA1);
  expect(byIssuer.GitHub.label).toBe("octocat@example.com");
  expect(byIssuer.Cloudflare.secret.base32).toBe(RFC_SHA256);
  expect([byIssuer.Cloudflare.algorithm, byIssuer.Cloudflare.digits, byIssuer.Cloudflare.period]).toEqual([
    "SHA256",
    8,
    60,
  ]);
  await expect(page.getByText("Exported 3 entries.")).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("Import previews new, duplicate and unusable lines, then imports the new ones", async () => {
  const file = [
    "# exported elsewhere",
    SEED[0], // already in the vault
    "otpauth://totp/Hetzner:admin%40example.com?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U&issuer=Hetzner",
    "",
    "otpauth://hotp/Bank:me?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U&counter=3",
    "otpauth://totp/Namecheap:dns%40example.com?secret=ONSWG4TFORZWK5DSMVRWK4TF&issuer=Namecheap",
    "this is not a link",
    "otpauth://totp/Hetzner:admin%40example.com?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U&issuer=Hetzner", // dup in file
  ].join("\r\n");

  await accountAction(page, acct.username, "Import");
  const dialog = page.getByRole("dialog", { name: "Import entries" });
  await dialog.getByRole("button", { name: "Check entries" }).click();
  await expect(dialog.getByText("Choose a file or paste otpauth:// links first.")).toBeVisible();

  await dialog.getByLabel("File").setInputFiles({ name: "import.txt", mimeType: "text/plain", buffer: Buffer.from(file) });
  await expect(dialog.getByLabel("Or paste the links")).toHaveValue(/Namecheap/);
  await dialog.getByRole("button", { name: "Check entries" }).click();

  const stat = (name: string) => dialog.locator("dl > div").filter({ has: page.locator("dt", { hasText: name }) }).locator("dd");
  await expect(stat("New")).toHaveText("2");
  await expect(stat("Already in vault")).toHaveText("2");
  await expect(stat("Not usable")).toHaveText("2");
  await expect(dialog.getByText("Lines that will be skipped")).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: "Line 5" })).toContainText("HOTP");
  await expect(dialog.getByRole("listitem").filter({ hasText: "Line 7" })).toContainText("This is not an otpauth:// link.");

  await dialog.getByRole("button", { name: "Import 2 entries" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Imported 2 entries.")).toBeVisible();
  expect(await issuersShown(page)).toEqual(["Cloudflare", "GitHub", "Hetzner", "Namecheap", "Proton"]);
});

/** Asks the server to recover with `key` using dummy new credentials; only a rejection is expected. */
async function recoverStatus(key: string): Promise<number> {
  const res = await page.request.post("/api/auth/recover", {
    headers: { Origin: E2E_ORIGIN, "Content-Type": "application/json" },
    data: {
      username: acct.username,
      recoveryKey: key,
      newAuthKey: "A".repeat(43),
      newKdfSalt: "A".repeat(22),
      newKdfParams: { alg: "argon2id", m: 65536, t: 3, p: 1, v: 1 },
    },
  });
  return res.status();
}

test("Recovery key: wrong password is rejected, regenerating replaces the key", async () => {
  await accountAction(page, acct.username, "Recovery key");
  const dialog = page.getByRole("dialog", { name: "Recovery key" });
  await expect(dialog.getByText(/^The current key was made on \d{4}-\d{2}-\d{2}\./)).toBeVisible();

  await passwordField(dialog).fill("this is not my password");
  await dialog.getByRole("button", { name: "Make a new recovery key" }).click();
  await expect(dialog.getByText("That password is not correct.")).toBeVisible({ timeout: 30_000 });

  await passwordField(dialog).fill(acct.password);
  await dialog.getByRole("button", { name: "Make a new recovery key" }).click();
  await expect(dialog.getByText("The old key no longer works")).toBeVisible({ timeout: 30_000 });
  const fresh = await readRecoveryKey(page);
  expect(fresh).toMatch(RECOVERY_KEY_RE);
  expect(fresh).not.toBe(acct.recoveryKey);
  const old = acct.recoveryKey;
  acct.recoveryKey = fresh;
  await dialog.getByRole("button", { name: "I saved my recovery key" }).click();
  await expect(dialog).toBeHidden();

  // The old key is rejected by the server; the account and vault are untouched.
  expect(await recoverStatus(old)).toBe(401);
  await page.reload();
  await waitForVault(page);
  expect(await issuersShown(page)).toEqual(["Cloudflare", "GitHub", "Hetzner", "Namecheap", "Proton"]);
});

test("Change password: validation, wrong current password, then success without any code", async () => {
  await accountAction(page, acct.username, "Change password");
  const dialog = page.getByRole("dialog", { name: "Change password" });
  const submit = dialog.getByRole("button", { name: "Change password" });
  await expect(dialog.getByLabel(/code/i)).toHaveCount(0);

  await passwordField(dialog, "Current password").fill(acct.password);
  await passwordField(dialog, "New password").fill(acct.password);
  await passwordField(dialog, "Repeat new password").fill("different");
  await submit.click();
  await expect(dialog.getByText("Choose a password different from the current one.")).toBeVisible();
  await expect(dialog.getByText("The new passwords do not match.")).toBeVisible();

  await passwordField(dialog, "Current password").fill("this is not my password");
  await passwordField(dialog, "New password").fill(NEW_PASSWORD);
  await passwordField(dialog, "Repeat new password").fill(NEW_PASSWORD);
  await submit.click();
  await expect(dialog.getByText("That password is not correct.")).toBeVisible({ timeout: 30_000 });

  await passwordField(dialog, "Current password").fill(acct.password);
  await submit.click();
  await expect(page.getByText("Password changed. Other devices were signed out.")).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toBeHidden();
  const oldPassword = acct.password;
  acct.password = NEW_PASSWORD;

  await signOut(page, acct.username);
  await submitPassword(page, acct.username, oldPassword);
  await expect(page.getByText("Wrong username or password.")).toBeVisible({ timeout: 30_000 });

  await submitPassword(page, acct.username, NEW_PASSWORD);
  await waitForVault(page);
  expect(await issuersShown(page)).toEqual(["Cloudflare", "GitHub", "Hetzner", "Namecheap", "Proton"]);
  await awaitFreshPeriod(60, 3);
  await awaitFreshPeriod(30, 3);
  expect(await shownCode(page, "GitHub")).toBe(totpAt(RFC_SHA1, Date.now()));
  expect(await shownCode(page, "Cloudflare")).toBe(
    totpAt(RFC_SHA256, Date.now(), { algorithm: "SHA256", digits: 8, period: 60 }),
  );
  await expect(row(page, "Hetzner")).toContainText("admin@example.com");
});

test("neither the old nor the new password was ever sent to the server", async () => {
  expectNoSecretIn(bodies, ["correct horse battery staple 42", NEW_PASSWORD]);
});
