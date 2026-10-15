import type { z } from "zod";
import type { Session } from "@/db/schema";
import { errorResponse, errors, HttpError, logError, NO_STORE_HEADERS } from "./errors";
import { getEnv, type Env } from "./env";
import { clientIp, enforce, type Limit } from "./rate-limit";
import { clearedSessionCookie, readSessionToken, serializeCookie, validateSessionToken, type CookieSpec } from "./sessions";

/** Per-route body caps. Bodies are streamed and cut off as soon as they pass the cap. */
export const BODY_LIMITS = {
  auth: 8 * 1024,
  entry: 16 * 1024,
  import: 1024 * 1024,
  password: 4 * 1024 * 1024,
} as const;

type AuthMode = "active" | "optional" | undefined;
type SessionFor<A extends AuthMode> = A extends "active" ? Session : A extends "optional" ? Session | null : null;

export type RouteContext<P, A extends AuthMode> = {
  req: Request;
  params: P;
  env: Env;
  ip: string;
  userAgent: string | null;
  session: SessionFor<A>;
  /** Queue a Set-Cookie header on whatever response the handler returns. */
  setCookie: (spec: CookieSpec) => void;
  /** Reads, size-limits and validates the JSON body. Throws a 400 HttpError on failure. */
  body: <S extends z.ZodType>(schema: S) => Promise<z.output<S>>;
};

export type RouteOptions<P, A extends AuthMode> = {
  /** "active" requires a signed-in session. "optional" loads the session when present. Omit for public routes. */
  auth?: A;
  /** Rate limits applied before the handler runs (keys that need the body are enforced in the handler). */
  limits?: (ctx: RouteContext<P, A>) => Limit[];
  /** Max JSON body in bytes. Default BODY_LIMITS.auth. */
  maxBody?: number;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

/** CSRF / origin guard for state-changing requests. */
export function checkOrigin(req: Request, env: Env): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  if (req.headers.get("origin") !== env.APP_ORIGIN) throw errors.forbidden("Cross-origin request blocked.");
  if (!isJsonContentType(req.headers.get("content-type")))
    throw errors.forbidden("Requests must be sent as application/json.");
}

/** Reads the body as a stream, counting bytes; cancels and throws 413 once past `maxBytes`. */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw errors.payloadTooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw errors.payloadTooLarge();
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw errors.invalidRequest("The request body could not be read.");
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

export async function readJsonBody<S extends z.ZodType>(req: Request, schema: S, maxBytes: number): Promise<z.output<S>> {
  const text = await readBodyText(req, maxBytes);
  let data: unknown;
  try {
    data = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw errors.invalidRequest("The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw errors.invalidRequest(issue?.message ?? "The request is not valid.");
  }
  return parsed.data;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

function finalize(res: Response, cookies: CookieSpec[]): Response {
  // Copy into a fresh Response so headers are always mutable.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(NO_STORE_HEADERS)) headers.set(k, v);
  for (const c of cookies) headers.append("Set-Cookie", serializeCookie(c));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Wraps a route handler: no-store, origin + content-type check for non-GET, session
 * requirement, rate limits, and uniform ApiErrorBody errors that never leak internals.
 */
export function route<P extends Record<string, string> = Record<string, never>, A extends AuthMode = undefined>(
  options: RouteOptions<P, A>,
  handler: (ctx: RouteContext<P, A>) => Promise<Response>,
): (req: Request, context: { params: Promise<P> }) => Promise<Response> {
  return async (req, context) => {
    const cookies: CookieSpec[] = [];
    try {
      const env = getEnv();
      checkOrigin(req, env);

      let session: Session | null = null;
      if (options.auth) {
        const token = readSessionToken(req);
        session = await validateSessionToken(token);
        if (token && !session) cookies.push(clearedSessionCookie());
        if (options.auth !== "optional" && !session) {
          throw errors.unauthorized();
        }
      }

      const ctx: RouteContext<P, A> = {
        req,
        params: ((await context?.params) ?? {}) as P,
        env,
        ip: clientIp(req, env.TRUST_PROXY),
        userAgent: req.headers.get("user-agent"),
        session: session as SessionFor<A>,
        setCookie: (spec) => cookies.push(spec),
        body: (schema) => readJsonBody(req, schema, options.maxBody ?? BODY_LIMITS.auth),
      };
      if (options.limits) await enforce(options.limits(ctx));
      return finalize(await handler(ctx), cookies);
    } catch (err) {
      if (err instanceof HttpError) return finalize(errorResponse(err), cookies);
      logError("unhandled api error", err, { method: req.method, path: new URL(req.url).pathname });
      return finalize(
        errorResponse(new HttpError(500, "server_error", "Something went wrong on the server. Try again.")),
        cookies,
      );
    }
  };
}
