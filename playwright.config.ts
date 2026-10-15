import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT, serverEnv } from "./e2e/env";

/**
 * E2E runs against a production build (`next build` + `next start` on port 3100) and the
 * dedicated `totp_e2e` database. Set E2E_SKIP_BUILD=1 to reuse an existing .next build.
 */
const build = process.env.E2E_SKIP_BUILD === "1" ? "" : "npx next build && ";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: E2E_ORIGIN,
    permissions: ["clipboard-read", "clipboard-write"],
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, browserName: "chromium" },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: `${build}npx next start -p ${E2E_PORT}`,
    url: `${E2E_ORIGIN}/api/time`,
    env: serverEnv(),
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
