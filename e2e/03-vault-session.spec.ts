import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import { E2E_ORIGIN } from "./env";
import {
  RFC_SHA1,
  accountAction,
  importLinks,
  issuersShown,
  loginViaUi,
  newAccount,
  newProjectContext,
  passwordField,
  registerViaUi,
  row,
  signOut,
  submitPassword,
  waitForVault,
} from "./helpers";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const acct = newAccount("e2e-session");

const LINKS = [
  `otpauth://totp/GitHub:octocat%40example.com?secret=${RFC_SHA1}&issuer=GitHub`,
  "otpauth://totp/Cloudflare:ops%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Cloudflare",
  "otpauth://totp/AWS%20root:root%40example.com?secret=KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU&issuer=AWS%20root",
  "otpauth://totp/Fastmail:me%40fastmail.com?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U&issuer=Fastmail",
];

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  page = await context.newPage();
  await registerViaUi(page, acct);
  await importLinks(page, acct.username, LINKS);
  await expect(page.getByRole("region", { name: "Entries" }).getByRole("listitem")).toHaveCount(4);
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

const search = () => page.getByRole("searchbox", { name: "Search entries by service or account" });

test("search filters by service and account, and shows a no-match state", async () => {
  await search().fill("cloud");
  expect(await issuersShown(page)).toEqual(["Cloudflare"]);
  await search().fill("FASTMAIL.COM");
  expect(await issuersShown(page)).toEqual(["Fastmail"]);
  await search().fill("zzz-nothing");
  await expect(page.getByRole("heading", { name: "No entries match “zzz-nothing”" })).toBeVisible();
  await expect(page.getByText("Search looks at service and account names.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await expect(search()).toHaveValue("");
  expect(await issuersShown(page)).toEqual(["AWS root", "Cloudflare", "Fastmail", "GitHub"]);
});

test("edit an entry", async () => {
  await row(page, "GitHub").getByRole("button", { name: "Actions for GitHub (octocat@example.com)" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit GitHub" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Secret hidden")).toBeAttached();
  await dialog.getByLabel("Service").fill("GitHub Work");
  await dialog.getByLabel("Account (optional)").fill("work@example.com");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved GitHub Work (work@example.com).")).toBeVisible();
  await expect(row(page, "GitHub Work")).toContainText("work@example.com");
  expect(await issuersShown(page)).toEqual(["AWS root", "Cloudflare", "Fastmail", "GitHub Work"]);
});

test("delete asks for confirmation; Keep entry cancels, Delete entry removes", async () => {
  const actions = () => row(page, "Fastmail").getByRole("button", { name: "Actions for Fastmail (me@fastmail.com)" });
  await actions().click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete Fastmail (me@fastmail.com)?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep entry" }).click();
  await expect(confirm).toBeHidden();
  await expect(row(page, "Fastmail")).toHaveCount(1);

  await actions().click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await confirm.getByRole("button", { name: "Delete entry" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("Deleted Fastmail (me@fastmail.com).")).toBeVisible();
  expect(await issuersShown(page)).toEqual(["AWS root", "Cloudflare", "GitHub Work"]);
});

test("reload keeps the vault unlocked and the changes", async () => {
  await page.reload();
  await waitForVault(page);
  await expect(page.getByRole("heading", { name: "Vault locked" })).toHaveCount(0);
  expect(await issuersShown(page)).toEqual(["AWS root", "Cloudflare", "GitHub Work"]);
});

test("Lock, then Unlock rejects a wrong password and accepts the right one", async () => {
  await accountAction(page, acct.username, "Lock");
  await expect(page.getByRole("heading", { name: "Vault locked" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Vault locked" })).toBeVisible();

  await passwordField(page).fill("not the password at all");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("That password is not correct.")).toBeVisible({ timeout: 30_000 });
  await expect(passwordField(page)).toHaveValue("");

  await passwordField(page).fill(acct.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await waitForVault(page);
  expect(await issuersShown(page)).toEqual(["AWS root", "Cloudflare", "GitHub Work"]);
});

test("Sign out ends the session; /vault then redirects to /login", async () => {
  await signOut(page, acct.username);
  await page.goto("/vault");
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.get("/api/vault");
  expect(res.status()).toBe(401);
});

test("sign in with username and password goes straight to the vault", async () => {
  await loginViaUi(page, acct);
  expect(await issuersShown(page)).toEqual(["AWS root", "Cloudflare", "GitHub Work"]);
});

test("wrong password and unknown user get the same generic error", async () => {
  await signOut(page, acct.username);
  await submitPassword(page, acct.username, "wrong password but long");
  await expect(page.getByText("Wrong username or password.")).toBeVisible({ timeout: 30_000 });
  await expect(passwordField(page)).toHaveValue("");
  await expect(page).toHaveURL(/\/login$/);
  await submitPassword(page, "nobody-here", "wrong password but long");
  await expect(page.getByText("Wrong username or password.")).toBeVisible({ timeout: 30_000 });
});

test("the login page links to account recovery", async () => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
});

test("repeated bad logins hit the rate limit with a wait message", async () => {
  const throwaway = "e2e-throwaway";
  // Spend the failure budget for this username directly against the API until the server limits it.
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) {
    const res = await page.request.post("/api/auth/login", {
      headers: { Origin: E2E_ORIGIN, "Content-Type": "application/json" },
      data: { username: throwaway, authKey: "A".repeat(43) },
    });
    expect([401, 429]).toContain(res.status());
    limited = res.status() === 429;
    if (limited) expect(Number(res.headers()["retry-after"])).toBeGreaterThan(0);
  }
  expect(limited, "login attempts are rate limited").toBe(true);
  await submitPassword(page, throwaway, "whatever password 123");
  await expect(page.getByText(/^Too many attempts\..*Try again in \d+ s\.$/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^Wait \d+ s$/ })).toBeDisabled();

  // The main account is unaffected.
  await loginViaUi(page, acct);
});
