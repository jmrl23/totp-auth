import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import {
  RFC_SHA1,
  accountAction,
  importLinks,
  loginViaUi,
  newAccount,
  newProjectContext,
  openAccountMenu,
  passwordField,
  registerViaUi,
  row,
  signOut,
  waitForVault,
} from "./helpers";

test.describe.configure({ mode: "serial" });

type Problem = { kind: string; url: string; text: string };

let context: BrowserContext;
let page: Page;
const problems: Problem[] = [];
const acct = newAccount("e2e-console");

declare global {
  interface Window {
    __csp?: { directive: string; blocked: string; sample: string; source: string }[];
  }
}

/** Collects CSP violations (DOM event), console errors/warnings and uncaught errors. */
function watch(p: Page) {
  p.on("console", (msg) => {
    if (msg.type() === "error" || (msg.type() === "warning" && /Content.Security.Policy|Refused to/i.test(msg.text()))) {
      problems.push({ kind: `console.${msg.type()}`, url: p.url(), text: msg.text() });
    }
  });
  p.on("pageerror", (err) => problems.push({ kind: "pageerror", url: p.url(), text: String(err) }));
}

async function collectViolations(p: Page): Promise<void> {
  const v = await p.evaluate(() => window.__csp?.splice(0) ?? []);
  for (const e of v) {
    problems.push({ kind: "securitypolicyviolation", url: p.url(), text: `${e.directive} blocked ${e.blocked} ${e.source} ${e.sample}` });
  }
}

async function checkpoint(label: string) {
  await page.waitForLoadState("networkidle");
  await collectViolations(page);
  if (process.env.E2E_CSP_LOG === "1") {
    for (const pr of problems.splice(0)) console.log(`[${label}] ${pr.kind}: ${pr.text.slice(0, 2000)}`);
    return;
  }
  expect(problems, `CSP violations or console errors at ${label}`).toEqual([]);
}

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__csp!.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
        sample: e.sample,
        source: `${e.sourceFile}:${e.lineNumber}`,
      });
    });
  });
  page = await context.newPage();
  watch(page);
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

test("/login and /register (open) are clean", async () => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
  await checkpoint("/login");
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await checkpoint("/register (open)");
});

test("registration flow and empty /vault are clean (Argon2 worker + WebAssembly run)", async () => {
  await registerViaUi(page, acct);
  await expect(page.getByRole("heading", { name: "No entries yet" })).toBeVisible();
  await checkpoint("/vault (empty)");
});

test("/vault with entries, add dialog, menus and toasts is clean; toasts are styled", async () => {
  await importLinks(page, acct.username, [
    `otpauth://totp/GitHub:octocat%40example.com?secret=${RFC_SHA1}&issuer=GitHub`,
    "otpauth://totp/Proton:me%40proton.me?secret=KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU&issuer=Proton",
  ]);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Imported 2 entries." });
  await expect(toast).toBeVisible();
  // Sonner's stylesheet must apply: the toaster is a fixed overlay and the toast is a styled card.
  const styles = await page.evaluate(() => {
    const toaster = document.querySelector("[data-sonner-toaster]")!;
    const t = document.querySelector("[data-sonner-toast]")!;
    const ts = getComputedStyle(t);
    return { toaster: getComputedStyle(toaster).position, toastPosition: ts.position, listStyle: ts.listStyleType, padding: ts.paddingTop };
  });
  expect(styles.toaster).toBe("fixed");
  expect(styles.toastPosition).toBe("absolute");
  expect(styles.padding).not.toBe("0px");

  await row(page, "GitHub").getByRole("button", { name: /^Copy code:/ }).click();
  await page.getByRole("banner").getByRole("button", { name: "Add entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add entry" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Enter manually" }).click();
  await dialog.getByRole("button", { name: /^Advanced/ }).click();
  await dialog.getByLabel("Algorithm").click();
  await page.getByRole("option", { name: "SHA-512" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await openAccountMenu(page, acct.username);
  await page.keyboard.press("Escape");
  await row(page, "Proton").getByRole("button", { name: /^Actions for Proton/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep entry" }).click();
  await checkpoint("/vault (entries, dialogs, toast)");
});

test("unlock screen, /register (closed) and sign-in again are clean", async () => {
  await accountAction(page, acct.username, "Lock");
  await expect(page.getByRole("heading", { name: "Vault locked" })).toBeVisible();
  await checkpoint("/vault (locked)");
  await passwordField(page).fill(acct.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await waitForVault(page);
  await signOut(page, acct.username);
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Registration is closed on this instance" })).toBeVisible();
  await checkpoint("/register (closed)");
  await loginViaUi(page, acct);
  await checkpoint("/vault after login");
});

test("CSP style hashes match the stylesheets sonner and vaul inject", async ({ request }) => {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const csp = (await request.get("/login")).headers()["content-security-policy"];
  const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"))!;
  for (const file of ["node_modules/sonner/dist/index.mjs", "node_modules/vaul/dist/index.mjs"]) {
    const src = readFileSync(file, "utf8");
    const m = src.match(/__insertCSS\("((?:[^"\\]|\\.)*)"\)/);
    expect(m, `${file} still injects its CSS with __insertCSS`).not.toBeNull();
    const css = JSON.parse(`"${m![1]}"`) as string;
    const hash = `'sha256-${createHash("sha256").update(css).digest("base64")}'`;
    expect(styleSrc, `${file} stylesheet hash is allowed by style-src`).toContain(hash);
  }
  expect(styleSrc).toContain(`'sha256-${createHash("sha256").update("").digest("base64")}'`);
  expect(styleSrc).not.toContain("'unsafe-inline'");
});
