import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearRateLimits, closeDb, resetDatabase } from "./db";
import {
  RFC_SHA1,
  accountAction,
  importLinks,
  isMobileProject,
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
const acct = newAccount("e2e-a11y");
/** Findings for the registration key step, captured while the account is created. */
let keyStep: { unnamed: string[]; violations: string[] } | null = null;

test.beforeAll(async ({ browser }, testInfo) => {
  await resetDatabase();
  context = await newProjectContext(browser, testInfo);
  page = await context.newPage();
  await registerViaUi(page, acct, async (name) => {
    if (name === "register-key") keyStep = { unnamed: await unnamedControls(page), violations: await axeScan(page) };
  });
  await importLinks(page, acct.username, [
    `otpauth://totp/GitHub:octocat%40example.com?secret=${RFC_SHA1}&issuer=GitHub`,
    "otpauth://totp/AWS%20root:root%40example.com?secret=KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU&issuer=AWS%20root",
  ]);
});

test.beforeEach(async () => {
  await clearRateLimits();
});

test.afterAll(async () => {
  await context?.close();
  await closeDb();
});

/** Every visible form control has an accessible name; every button/link has a name. */
async function unnamedControls(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return !(el as HTMLElement).hidden && s.visibility !== "hidden" && s.display !== "none" && (r.width > 0 || r.height > 0);
    };
    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const nameOf = (el: Element) => {
      const aria = el.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim();
        if (t) return t;
      }
      const labels = (el as HTMLInputElement).labels;
      if (labels && labels.length) return [...labels].map(text).join(" ").trim();
      if (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button" || el.getAttribute("role") === "tab" || el.getAttribute("role") === "menuitem" || el.getAttribute("role") === "option" || el.getAttribute("role") === "combobox") {
        const t = text(el);
        if (t) return t;
      }
      return el.getAttribute("title")?.trim() ?? "";
    };
    const out: string[] = [];
    const sel = "input:not([type=hidden]), textarea, select, button, a[href], [role=button], [role=tab], [role=menuitem], [role=combobox], [role=checkbox]";
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el) && el.tagName !== "INPUT") continue;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).hidden) continue;
      if (el.closest("[aria-hidden=true]")) continue;
      if (!nameOf(el)) out.push(el.outerHTML.slice(0, 160));
    }
    return out;
  });
}

type Stop = { desc: string; indicator: boolean };

/** Tabs through the page and records whether each focused element shows a focus indicator. */
async function tabWalk(p: Page, steps: number): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let i = 0; i < steps; i++) {
    await p.keyboard.press("Tab");
    stops.push(
      await p.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { desc: "body", indicator: true };
        const s = getComputedStyle(el);
        const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const ring = s.boxShadow !== "none" && s.boxShadow !== "";
        const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.id;
        return { desc: `${el.tagName.toLowerCase()} "${name}"`, indicator: outline || ring };
      }),
    );
  }
  return stops;
}

/**
 * WCAG A/AA scan with axe-core. @axe-core/playwright is not installed; axe-core itself is
 * present (via eslint-plugin-jsx-a11y), so its browser build is evaluated directly. If it is
 * ever absent the scan is skipped and only the manual checks run.
 */
async function axeScan(p: Page): Promise<string[]> {
  let source: string;
  try {
    const req = createRequire(__filename);
    source = readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    return [];
  }
  await p.evaluate(source);
  const results = await p.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ passes: unknown[]; violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return {
      passes: r.passes.length,
      violations: r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`),
    };
  });
  // Guard against a silent no-op run.
  expect(results.passes).toBeGreaterThan(5);
  return results.violations;
}

test("vault: controls are labelled, keyboard focus is visible, axe finds no WCAG A/AA issues", async () => {
  await waitForVault(page);
  expect(await unnamedControls(page)).toEqual([]);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const stops = await tabWalk(page, 8);
  const names = stops.map((s) => s.desc).join(" | ");
  expect(names).toContain("vault-search");
  expect(names).toContain("Add entry");
  expect(names).toContain("Account menu for e2e-a11y");
  expect(names).toMatch(/Copy code/);
  expect(names).toMatch(/Actions for AWS root/);
  expect(stops.filter((s) => !s.indicator), names).toEqual([]);
  expect(await axeScan(page)).toEqual([]);
});

test("add-entry dialog: every field has a label; axe is clean", async () => {
  await page.getByRole("banner").getByRole("button", { name: "Add entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add entry" });
  await expect(dialog).toBeVisible();
  for (const tab of ["Scan", "Paste link", "Enter manually"]) {
    await dialog.getByRole("tab", { name: tab }).click();
    if (tab === "Enter manually") await dialog.getByRole("button", { name: /^Advanced/ }).click();
    expect(await unnamedControls(page), tab).toEqual([]);
  }
  expect(await axeScan(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("unlock screen: labelled and axe-clean", async () => {
  await accountAction(page, acct.username, "Lock");
  await expect(page.getByRole("heading", { name: "Vault locked" })).toBeVisible();
  expect(await unnamedControls(page)).toEqual([]);
  expect(await axeScan(page)).toEqual([]);
  await passwordField(page).fill(acct.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await waitForVault(page);
});

test("login: labelled, Tab walk shows focus on every control, axe-clean", async () => {
  await signOut(page, acct.username);
  expect(await unnamedControls(page)).toEqual([]);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const stops = await tabWalk(page, 6);
  const names = stops.map((s) => s.desc).join(" | ");
  expect(names).toContain("input");
  expect(names).toContain("Show password");
  expect(names).toContain("Forgot your password?");
  expect(names).toContain("Sign in");
  expect(stops.filter((s) => !s.indicator), names).toEqual([]);
  expect(await axeScan(page)).toEqual([]);
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Registration is closed on this instance" })).toBeVisible();
  expect(await unnamedControls(page)).toEqual([]);
  expect(await axeScan(page)).toEqual([]);
});

test("registration key step: labelled and axe-clean", async () => {
  expect(keyStep, "captured during registration").not.toBeNull();
  expect(keyStep!.unnamed).toEqual([]);
  expect(keyStep!.violations).toEqual([]);
});

test("recover page: labelled, focus visible, axe-clean", async () => {
  await page.goto("/recover");
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  expect(await unnamedControls(page)).toEqual([]);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const stops = await tabWalk(page, 12);
  const names = stops.map((s) => s.desc).join(" | ");
  expect(names).toContain("input");
  expect(names).toContain("Set new password");
  expect(stops.filter((s) => !s.indicator), names).toEqual([]);
  expect(await axeScan(page)).toEqual([]);
});

async function horizontalOverflow(p: Page): Promise<number> {
  return p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("no horizontal scroll at 320 px on /login, /register, /recover and /vault", async () => {
  const original = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 640 });
  try {
    for (const path of ["/login", "/register", "/recover"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
    await page.goto("/login");
    await page.getByLabel("Username").fill(acct.username);
    // sign back in at 320 px wide
    const { loginViaUi } = await import("./helpers");
    await loginViaUi(page, acct);
    expect(await horizontalOverflow(page), "/vault").toBeLessThanOrEqual(0);
    await page.getByRole("banner").getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByRole("dialog", { name: "Add entry" })).toBeVisible();
    expect(await horizontalOverflow(page), "add entry").toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
  } finally {
    await page.setViewportSize(original);
  }
});

test("mobile: primary controls are at least 44 x 44 px", async ({}, testInfo) => {
  test.skip(!isMobileProject(testInfo), "touch targets are checked on the phone project");
  await waitForVault(page);
  const targets = [
    page.getByRole("searchbox", { name: "Search entries by service or account" }),
    page.getByRole("banner").getByRole("button", { name: "Add entry" }),
    page.getByRole("button", { name: `Account menu for ${acct.username}` }),
    page.getByRole("button", { name: /^Copy code:/ }).first(),
    page.getByRole("button", { name: /^Actions for / }).first(),
  ];
  for (const t of targets) {
    const box = await t.boundingBox();
    expect(box, String(t)).not.toBeNull();
    expect(box!.height, String(t)).toBeGreaterThanOrEqual(44);
    expect(box!.width, String(t)).toBeGreaterThanOrEqual(44);
  }
  await signOut(page, acct.username);
  for (const t of [
    page.getByLabel("Username"),
    passwordField(page),
    page.getByRole("button", { name: "Show password" }),
    page.getByRole("button", { name: "Sign in" }),
  ]) {
    const box = await t.boundingBox();
    expect(box!.height, String(t)).toBeGreaterThanOrEqual(44);
    expect(box!.width, String(t)).toBeGreaterThanOrEqual(44);
  }
});
