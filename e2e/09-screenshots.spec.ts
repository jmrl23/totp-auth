import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import {
  accountAction,
  importLinks,
  newAccount,
  newProjectContext,
  openAccountMenu,
  passwordField,
  registerViaUi,
  row,
  secondsLeft,
  signOut,
  sleep,
  waitForToastsGone,
  waitForVault,
} from "./helpers";

/** Full-page captures for design review, written to .impeccable/review/<project>-<screen>.png. */
test.describe.configure({ mode: "serial" });

const OUT = path.join(__dirname, "..", ".impeccable", "review");

let context: BrowserContext;
let page: Page;
let prefix = "";
const acct = newAccount("sam.rivera", "plum tractor lantern 2026 river");

/** issuer, account, secret, extra otpauth params (one SHA-256/60 s entry and one 8-digit entry). */
const SEED: [string, string, string, string?][] = [
  ["GitHub", "sam-rivera", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"],
  ["Cloudflare", "sam@rivera.dev", "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU"],
  ["AWS root", "billing@rivera.dev", "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U"],
  ["Fastmail", "sam@fastmail.com", "ONSWG4TFORZWK5DSMVRWK4TFONSWG4TF"],
  ["Hetzner", "K0457812", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "&digits=8"],
  ["Mastodon", "@sam@hachyderm.io", "NBSWY3DPO5XXE3DEEBSWY3DPO5XXE3DE"],
  ["Proton", "sam.rivera@proton.me", "MZXW6YTBOI3TEMZUGU2DQNJXGI4TSOBQ", "&algorithm=SHA256&period=60"],
  ["Namecheap", "rivera-dns", "OBQXG43XN5ZGIMJSGM2DKNRXHA4TAMJS"],
];

/** Polls the rendered "Valid for" values until every row shows 14 to 26 s or more (no row near expiry). */
async function waitForCalmRows(p: Page = page): Promise<void> {
  for (;;) {
    const values = await p
      .locator(".ga-secs[aria-hidden]")
      .allInnerTexts()
      .then((t) => t.map((v) => Number.parseInt(v, 10)));
    // Also skip the first seconds of a period so the hands sit visibly away from 12.
    if (values.length > 0 && values.every((v) => v >= 14) && Math.min(...values) <= 26) return;
    await sleep(250);
  }
}

/** Writes .impeccable/review/<project>-<name>.png (or exactly `file` when given). */
async function shot(name: string, p: Page = page, file?: string): Promise<void> {
  // Park the pointer outside the list so no row shows its hover tint by accident.
  await p.mouse.move(0, 0);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForLoadState("networkidle");
  // Let dialog/menu entrance transitions finish (reduced motion makes them near-instant).
  await p.waitForTimeout(400);
  await p.screenshot({
    path: path.join(OUT, file ?? `${prefix}-${name}.png`),
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
}

test.beforeAll(async ({ browser }, testInfo) => {
  prefix = testInfo.project.name;
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  page = await context.newPage();
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

test("registration screens and the empty vault", async () => {
  await registerViaUi(page, acct, async (name) => {
    await shot(name);
  });
  await expect(page.getByRole("heading", { name: "No entries yet" })).toBeVisible();
  await shot("vault-empty");
});

test("vault list, expiring codes and search with no match", async () => {
  await importLinks(
    page,
    acct.username,
    SEED.map(
      ([issuer, label, secret, extra = ""]) =>
        `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}${extra}`,
    ),
  );
  await expect(page.getByRole("region", { name: "Entries" }).getByRole("listitem")).toHaveCount(8);
  await waitForToastsGone(page);
  // Calm default state: every row has at least 14 s left when the capture starts.
  await waitForCalmRows();
  await shot("vault-list");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("dark-vault-list");
  await page.emulateMedia({ colorScheme: "light" });

  // Start right as the codes enter their last 5 seconds so both captures land before rotation.
  while (secondsLeft() !== 5) await sleep(100);
  await expect(page.locator("[data-expiring]").first()).toBeVisible();
  await shot("vault-expiring");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("dark-vault-expiring");
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByRole("searchbox", { name: "Search entries by service or account" }).fill("bitbucket");
  await expect(page.getByRole("heading", { name: /No entries match/ })).toBeVisible();
  await shot("vault-search-empty");
  await page.getByRole("button", { name: "Clear search" }).first().click();
});

test("add entry, account menu and delete confirmation", async () => {
  await page.getByRole("banner").getByRole("button", { name: "Add entry" }).click();
  await expect(page.getByRole("dialog", { name: "Add entry" })).toBeVisible();
  await shot("add-entry-open");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add entry" })).toBeHidden();

  await openAccountMenu(page, acct.username);
  await shot("account-menu-open");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();

  await row(page, "Hetzner").getByRole("button", { name: /^Actions for Hetzner/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await shot("delete-confirm");
  await page.getByRole("button", { name: "Keep entry" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
});

test("phone-only states: 320 px list and sheet, camera permission denied", async () => {
  test.skip(prefix !== "mobile", "phone captures");
  const narrow = await context.newPage();
  await narrow.setViewportSize({ width: 320, height: 720 });
  await narrow.goto("/vault");
  await waitForVault(narrow);
  await waitForCalmRows(narrow);
  await shot("vault-list", narrow, "mobile320-vault-list.png");
  await narrow.getByRole("banner").getByRole("button", { name: "Add entry" }).click();
  await expect(narrow.getByRole("dialog", { name: "Add entry" })).toBeVisible();
  await shot("add-entry-open", narrow, "mobile320-add-entry-open.png");
  await narrow.close();

  const denied = await context.newPage();
  await denied.addInitScript(() => {
    const reject = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: reject } });
  });
  await denied.goto("/vault");
  await waitForVault(denied);
  await denied.getByRole("banner").getByRole("button", { name: "Add entry" }).click();
  const sheet = denied.getByRole("dialog", { name: "Add entry" });
  await sheet.getByRole("button", { name: "Start camera" }).click();
  await expect(sheet.getByText(/Camera access was blocked/)).toBeVisible();
  await shot("scan-denied", denied);
  await denied.close();
});

test("desktop dialogs: edit, recovery key, password, export, import preview", async () => {
  test.skip(prefix !== "desktop", "desktop captures");
  const openDialog = async (item: string, title: string, name: string) => {
    await accountAction(page, acct.username, item);
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await shot(name);
    return dialog;
  };
  const close = async (title: string) => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: title })).toBeHidden();
  };

  await row(page, "Hetzner").getByRole("button", { name: /^Actions for Hetzner/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Hetzner" })).toBeVisible();
  await shot("edit-entry");
  await close("Edit Hetzner");

  await openDialog("Recovery key", "Recovery key", "recovery-key-dialog");
  await close("Recovery key");
  await openDialog("Change password", "Change password", "password-dialog");
  await close("Change password");
  await openDialog("Export", "Export entries", "export-dialog");
  await close("Export entries");

  const importer = await openDialog("Import", "Import entries", "import-dialog-empty");
  const [gh, , ghSecret] = SEED[0];
  await importer.getByLabel("Or paste the links").fill(
    [
      "otpauth://totp/Bitwarden:sam%40rivera.dev?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Bitwarden",
      `otpauth://totp/${gh}:sam-rivera?secret=${ghSecret}&issuer=${gh}`,
      "otpauth://hotp/Legacy:sam?secret=JBSWY3DPEHPK3PXP&counter=4",
      "this line is not a link",
    ].join("\n"),
  );
  await importer.getByRole("button", { name: "Check entries" }).click();
  await expect(importer.getByText("Lines that will be skipped")).toBeVisible();
  await shot("import-dialog");
  await close("Import entries");
});

test("desktop clock drift notice", async () => {
  test.skip(prefix !== "desktop", "desktop capture");
  // This tab's clock runs 5 s behind the server; the vault must say so and still show server codes.
  const drift = await context.newPage();
  await drift.addInitScript(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() - 5_000;
  });
  await drift.goto("/vault");
  await waitForVault(drift);
  await expect(drift.getByText(/This device.s clock is \d+ seconds behind the server/)).toBeVisible({ timeout: 15_000 });
  await waitForCalmRows(drift);
  await shot("vault-drift", drift);
  await drift.close();
});

test("unlock and login", async () => {
  await accountAction(page, acct.username, "Lock");
  await expect(page.getByRole("heading", { name: "Vault locked" })).toBeVisible();
  await shot("unlock");
  await passwordField(page).fill(acct.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await waitForVault(page);

  await signOut(page, acct.username);
  await waitForToastsGone(page);
  await shot("login");
});

test("registration closed states", async () => {
  test.skip(prefix !== "desktop", "desktop capture");
  // An account exists, so the real server reports registration as closed.
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Registration is closed on this instance" })).toBeVisible();
  await shot("register-closed");

  // The setup-token variant depends on server env, so the config response is stubbed for this capture.
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: { registrationOpen: false, setupTokenRequired: true, closedReason: "setup_token_missing" },
    }),
  );
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "This instance needs a setup token first" })).toBeVisible();
  await shot("register-closed-setup-token");
  await page.unroute("**/api/auth/config");
});

test("recover page and the new recovery key", async () => {
  await page.goto("/recover");
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await shot("recover");
  await page.goto("/recover");
  await page.getByLabel("Username").fill(acct.username);
  await page.getByLabel("Recovery key").fill(acct.recoveryKey);
  await passwordField(page, "New password").fill(acct.password);
  await passwordField(page, "Repeat new password").fill(acct.password);
  await page.getByLabel("I understand my saved entries will be erased").check();
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("heading", { name: "Save your new recovery key" })).toBeVisible({ timeout: 30_000 });
  await shot("recover-key");
});
