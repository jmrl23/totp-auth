/**
 * Test-only helpers: real Postgres test DB (DATABASE_URL points at DATABASE_URL_TEST via
 * vitest.config.ts), table truncation, Request builders and a one-cookie jar.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { closeDb, getDb } from "@/db";
import { runMigrations } from "@/db/migrate";
import { DEFAULT_KDF_PARAMS } from "@/lib/schemas";
import { resetEnvCache } from "../env";

export const TEST_ORIGIN = "http://localhost:3000";

export function configureTestEnv(overrides: Record<string, string | undefined> = {}): void {
  const key = () => randomBytes(32).toString("base64");
  process.env.SERVER_PEPPER ||= key();
  process.env.APP_ORIGIN = TEST_ORIGIN;
  process.env.ALLOW_REGISTRATION = "false";
  process.env.TRUST_PROXY = "false";
  delete process.env.SETUP_TOKEN;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

export async function truncateAll(): Promise<void> {
  await getDb().execute(sql`TRUNCATE users, sessions, entries, rate_limits RESTART IDENTITY CASCADE`);
}

/** Registers vitest hooks: env, migrations once, truncate before each test, close pool after. */
export function setupTestDb(): void {
  if (!process.env.DATABASE_URL?.includes("test")) {
    throw new Error("Refusing to run DB tests against a database whose URL does not contain 'test'.");
  }
  beforeAll(async () => {
    configureTestEnv();
    await runMigrations();
  });
  beforeEach(async () => {
    configureTestEnv();
    await truncateAll();
  });
  afterAll(async () => {
    await closeDb();
  });
}

export const b64u = (n: number) => randomBytes(n).toString("base64url");
export const fakeAuthKey = () => b64u(32);
export const fakeSalt = () => b64u(16);
export const fakeEntry = (id: string = randomUUID()) => ({ id, ciphertext: b64u(64), iv: b64u(12) });
export const kdfParams = { ...DEFAULT_KDF_PARAMS };

export type ReqOptions = {
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  origin?: string | null;
  contentType?: string | null;
  headers?: Record<string, string>;
};

export function makeRequest(method: string, path: string, opts: ReqOptions & { stream?: ReadableStream<Uint8Array> } = {}): Request {
  const headers = new Headers(opts.headers);
  const safe = method === "GET" || method === "HEAD";
  const origin = opts.origin === undefined ? (safe ? null : TEST_ORIGIN) : opts.origin;
  if (origin) headers.set("origin", origin);
  const ct = opts.contentType === undefined ? (safe ? null : "application/json") : opts.contentType;
  if (ct) headers.set("content-type", ct);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  const body = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : safe ? undefined : "");
  if (opts.stream) {
    return new Request(`${TEST_ORIGIN}${path}`, { method, headers, body: opts.stream, duplex: "half" } as RequestInit);
  }
  return new Request(`${TEST_ORIGIN}${path}`, { method, headers, body: safe ? undefined : body });
}

/** Any route handler; `never` keeps every params shape assignable. */
type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;

export type Result<T = unknown> = { status: number; body: T; headers: Headers; res: Response };

const SESSION_COOKIE_NAMES = new Set(["sid", "__Host-sid"]);

/** Holds the session cookie like a browser would ("sid" over http, "__Host-sid" over https). */
export class Jar {
  cookie: string | undefined;
  name = "sid";

  header(): string | undefined {
    return this.cookie ? `${this.name}=${this.cookie}` : undefined;
  }

  absorb(res: Response): void {
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!SESSION_COOKIE_NAMES.has(name)) continue;
      this.name = name;
      this.cookie = /Max-Age=0/.test(sc) || value === "" ? undefined : value;
    }
  }

  async call<T = unknown>(
    handler: Handler,
    method: string,
    path: string,
    opts: ReqOptions & { params?: Record<string, string>; stream?: ReadableStream<Uint8Array> } = {},
  ): Promise<Result<T>> {
    const req = makeRequest(method, path, { cookie: this.header(), ...opts });
    const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) as Promise<never> });
    this.absorb(res);
    const text = await res.clone().text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers, res };
  }
}
