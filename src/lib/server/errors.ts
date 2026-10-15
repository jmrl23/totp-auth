import type { ApiErrorBody, ApiErrorCode } from "@/lib/schemas";

/** An error that is safe to show to the client as-is. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function errorResponse(err: HttpError): Response {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  if (err.retryAfter !== undefined) {
    body.error.retryAfter = err.retryAfter;
    headers["Retry-After"] = String(err.retryAfter);
  }
  return Response.json(body, { status: err.status, headers });
}

export const errors = {
  invalidRequest: (message = "The request is not valid.") => new HttpError(400, "invalid_request", message),
  invalidCredentials: () => new HttpError(401, "invalid_credentials", "Wrong username or password."),
  wrongPassword: () => new HttpError(401, "invalid_credentials", "That password is not right."),
  recoveryFailed: () => new HttpError(401, "invalid_credentials", "That username or recovery key is not right."),
  unauthorized: (message = "Sign in to continue.") => new HttpError(401, "unauthorized", message),
  forbidden: (message = "This request was blocked.") => new HttpError(403, "forbidden", message),
  notFound: (message = "Not found.") => new HttpError(404, "not_found", message),
  conflict: (message: string) => new HttpError(409, "conflict", message),
  registrationClosed: () =>
    new HttpError(403, "registration_closed", "Registration is closed on this instance."),
  limitReached: (message: string) => new HttpError(409, "limit_reached", message),
  payloadTooLarge: () => new HttpError(413, "payload_too_large", "The request is too large."),
  serverError: () => new HttpError(500, "server_error", "Something went wrong on the server. Try again."),
  rateLimited: (retryAfter: number) =>
    new HttpError(429, "rate_limited", `Too many attempts. Try again in ${retryAfter} seconds.`, retryAfter),
};

/** One-line structured log without secrets: only names and codes, never request data. */
export function logError(msg: string, err: unknown, extra: Record<string, string | number> = {}): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error(
    JSON.stringify({
      level: "error",
      msg,
      err: typeof e?.name === "string" ? e.name : typeof err,
      code: typeof e?.code === "string" ? e.code : undefined,
      ...extra,
    }),
  );
}
