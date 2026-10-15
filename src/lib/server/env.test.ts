import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const k = Buffer.alloc(32, 7).toString("base64");
const base = {
  DATABASE_URL: "postgres://u:p@localhost:5433/db",
  SERVER_PEPPER: k,
  APP_ORIGIN: "https://auth.example.com",
};

describe("env", () => {
  it("parses a valid configuration", () => {
    const env = parseEnv({ ...base, ALLOW_REGISTRATION: "true", SETUP_TOKEN: "" });
    expect(env.SERVER_PEPPER).toHaveLength(32);
    expect(env.ALLOW_REGISTRATION).toBe(true);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.SETUP_TOKEN).toBeUndefined();
    expect(env.isHttps).toBe(true);
  });

  it("fails with key names but never echoes values", () => {
    const secret = Buffer.alloc(16, 9).toString("base64");
    let msg = "";
    try {
      parseEnv({ ...base, SERVER_PEPPER: secret, APP_ORIGIN: "https://x.example/path" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("SERVER_PEPPER");
    expect(msg).toContain("APP_ORIGIN");
    expect(msg).not.toContain(secret);
    expect(msg).not.toContain("/path");
  });

  it("requires every mandatory key", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*SERVER_PEPPER[\s\S]*APP_ORIGIN/);
  });

  it("requires SETUP_TOKEN to be at least 16 characters when set", () => {
    expect(() => parseEnv({ ...base, SETUP_TOKEN: "short-token" })).toThrow(/SETUP_TOKEN/);
    expect(parseEnv({ ...base, SETUP_TOKEN: "a-long-enough-token" }).SETUP_TOKEN).toBe("a-long-enough-token");
  });

  it("detects loopback origins", () => {
    for (const o of ["http://localhost:3000", "http://127.0.0.1:8080", "http://[::1]:3000"]) {
      expect(parseEnv({ ...base, APP_ORIGIN: o }).isLoopback).toBe(true);
    }
    expect(parseEnv(base).isLoopback).toBe(false);
    expect(parseEnv({ ...base, APP_ORIGIN: "http://localhost.evil.example" }).isLoopback).toBe(false);
  });

  it("rejects non-boolean flags", () => {
    expect(() => parseEnv({ ...base, TRUST_PROXY: "yes" })).toThrow(/TRUST_PROXY/);
  });
});
