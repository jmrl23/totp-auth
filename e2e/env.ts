import "dotenv/config";

export const E2E_PORT = 3100;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

/** Fixed, test-only secrets (32 bytes each, base64). Never use these anywhere real. */
const TEST_PEPPER = Buffer.from("e2e-only-pepper-value-32-bytes!!").toString("base64");

export function e2eDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_E2E;
  if (!url) throw new Error("DATABASE_URL_E2E is not set in .env");
  return url;
}

/** Environment for `next build` and `next start` during e2e runs. */
export function serverEnv(): Record<string, string> {
  return {
    DATABASE_URL: e2eDatabaseUrl(),
    APP_ORIGIN: E2E_ORIGIN,
    ALLOW_REGISTRATION: "false",
    TRUST_PROXY: "false",
    SETUP_TOKEN: "",
    SERVER_PEPPER: TEST_PEPPER,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
