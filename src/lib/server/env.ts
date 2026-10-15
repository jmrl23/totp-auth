import { z } from "zod";

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const key32 = (name: string) =>
  z
    .string({ error: `${name} is required (32 random bytes, base64; generate with: openssl rand -base64 32).` })
    .trim()
    .refine((s) => BASE64_RE.test(s) && Buffer.from(s, "base64").length === 32, {
      error: `${name} must be exactly 32 bytes encoded as base64 (generate with: openssl rand -base64 32).`,
    })
    .transform((s) => Buffer.from(s, "base64"));

const bool = (name: string) =>
  z
    .enum(["true", "false", "1", "0", ""], { error: `${name} must be "true" or "false".` })
    .optional()
    .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required." })
    .refine((s) => /^postgres(ql)?:\/\//.test(s), { error: "DATABASE_URL must be a postgres:// URL." }),
  SERVER_PEPPER: key32("SERVER_PEPPER"),
  APP_ORIGIN: z
    .string({ error: "APP_ORIGIN is required, for example https://auth.example.com." })
    .trim()
    .refine(
      (s) => {
        try {
          const u = new URL(s);
          return (u.protocol === "https:" || u.protocol === "http:") && u.origin === s.replace(/\/$/, "");
        } catch {
          return false;
        }
      },
      { error: "APP_ORIGIN must be an origin like https://auth.example.com (scheme, host, optional port, no path)." },
    )
    .transform((s) => new URL(s).origin),
  ALLOW_REGISTRATION: bool("ALLOW_REGISTRATION"),
  TRUST_PROXY: bool("TRUST_PROXY"),
  SETUP_TOKEN: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => s === undefined || s.length >= 16, {
      error: "SETUP_TOKEN must be at least 16 characters (generate with: openssl rand -base64 24).",
    }),
});

export type Env = z.output<typeof envSchema> & { isHttps: boolean; isLoopback: boolean };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackOrigin(origin: string): boolean {
  return LOOPBACK_HOSTS.has(new URL(origin).hostname);
}

let cached: Env | undefined;

/** Thrown when configuration is invalid. The message names keys only, never values. */
export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.message}`);
    throw new EnvError(`Invalid server configuration:\n${[...new Set(lines)].join("\n")}`);
  }
  return {
    ...result.data,
    isHttps: result.data.APP_ORIGIN.startsWith("https://"),
    isLoopback: isLoopbackOrigin(result.data.APP_ORIGIN),
  };
}

/**
 * Validated env, parsed once per process. This cache is derived purely from process.env, which
 * must be identical on every instance, so it is not instance-specific state.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Tests only: drop the cached env after mutating process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
