/**
 * Typed fetch wrappers for every endpoint in docs/ARCHITECTURE.md.
 * Responses are validated with the shared Zod schemas. Errors are always `ApiError`.
 */
import { z } from "zod";
import {
  API_ERROR_CODES,
  authConfigResponseSchema,
  entryResponseSchema,
  importResponseSchema,
  preloginResponseSchema,
  recoverResponseSchema,
  regenerateRecoveryKeyResponseSchema,
  registerResponseSchema,
  sessionResponseSchema,
  timeResponseSchema,
  vaultResponseSchema,
  type ApiErrorCode,
  type AuthConfigResponse,
  type ChangePasswordRequest,
  type EncryptedEntryInput,
  type EntryResponse,
  type ImportRequest,
  type ImportResponse,
  type LoginRequest,
  type PreloginRequest,
  type PreloginResponse,
  type RecoverRequest,
  type RecoverResponse,
  type RegenerateRecoveryKeyRequest,
  type RegisterRequest,
  type RegisterResponse,
  type SessionResponse,
  type TimeResponse,
  type UnlockRequest,
  type VaultResponse,
} from "@/lib/schemas";
import { emitSessionEvent } from "./session-events";

/**
 * Server codes plus client-side ones:
 * - network: the request never reached the server
 * - server_error: 5xx (or any error) without a usable error body
 * - invalid_response: the server answered with something that does not match the contract
 * - crypto: key derivation or vault decryption failed in this browser
 */
export type ClientErrorCode =
  | ApiErrorCode
  | "network"
  | "server_error"
  | "invalid_response"
  | "crypto";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";

const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    retryAfter: z.number().optional(),
  }),
});

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/** Defaults used when the server sends a code without a message. */
const DEFAULT_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  payload_too_large: "That is too much data to send at once. Try fewer entries.",
  server_error: "The server had a problem. Try again in a moment.",
};

function fallbackMessage(status: number): string {
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 403) return "This request was refused.";
  if (status === 404) return "Not found.";
  if (status === 413) return "That is too much data to send at once. Try fewer entries.";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  return "The request could not be completed.";
}

function fallbackCode(status: number): ClientErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid_request";
  return "server_error";
}

/** Build an ApiError from a non-2xx response. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  const headerRetry = parseRetryAfter(res.headers.get("Retry-After"));
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) {
    const { code, message, retryAfter } = parsed.data.error;
    return new ApiError(res.status, code, message.trim() || DEFAULT_MESSAGES[code] || fallbackMessage(res.status), retryAfter ?? headerRetry);
  }
  return new ApiError(res.status, fallbackCode(res.status), fallbackMessage(res.status), headerRetry);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Needs an active session: a 401 `unauthorized` signs this tab out. */
  authed?: boolean;
  signal?: AbortSignal;
};

export type ApiClientOptions = {
  fetch?: FetchLike;
  baseUrl?: string;
  /** Called on 401 `unauthorized` for calls that need a session. Defaults to emitting "signed-out". */
  onUnauthorized?: () => void;
};

export function createApi(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const onUnauthorized = options.onUnauthorized ?? (() => emitSessionEvent("signed-out"));

  async function request<T>(path: string, schema: z.ZodType<T> | null, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (method !== "GET") headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, {
        method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "network", NETWORK_MESSAGE);
    }
    if (!res.ok) {
      const err = await errorFromResponse(res);
      if (opts.authed && err.status === 401 && err.code === "unauthorized") onUnauthorized();
      throw err;
    }
    if (schema === null) return undefined as T;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError(res.status, "invalid_response", "The server sent an unreadable response.");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(res.status, "invalid_response", "The server sent an unexpected response.");
    }
    return parsed.data;
  }

  const post = <T>(path: string, schema: z.ZodType<T> | null, body: unknown, authed = false) =>
    request(path, schema, { method: "POST", body, authed });

  return {
    /** GET /api/time */
    getTime: (signal?: AbortSignal): Promise<TimeResponse> => request("/api/time", timeResponseSchema, { signal }),
    /** GET /api/auth/config */
    getAuthConfig: (): Promise<AuthConfigResponse> => request("/api/auth/config", authConfigResponseSchema),
    /** POST /api/auth/prelogin */
    prelogin: (body: PreloginRequest): Promise<PreloginResponse> =>
      post("/api/auth/prelogin", preloginResponseSchema, body),
    /** POST /api/auth/login -> 204 (sets the session) */
    login: (body: LoginRequest): Promise<void> => post("/api/auth/login", null, body),
    /** POST /api/auth/register (creates the account and its session, returns the recovery key once) */
    register: (body: RegisterRequest): Promise<RegisterResponse> =>
      post("/api/auth/register", registerResponseSchema, body),
    /** POST /api/auth/recover: recovery key + new password; erases the old vault, returns the new key. */
    recover: (body: RecoverRequest): Promise<RecoverResponse> =>
      post("/api/auth/recover", recoverResponseSchema, body),
    /** GET /api/auth/session (throws ApiError 401 when signed out) */
    getSession: (signal?: AbortSignal): Promise<SessionResponse> =>
      request("/api/auth/session", sessionResponseSchema, { authed: true, signal }),
    /** POST /api/auth/unlock (401 invalid_credentials on a wrong password) */
    unlock: (body: UnlockRequest): Promise<void> => post("/api/auth/unlock", null, body, true),
    /** POST /api/auth/logout */
    logout: (): Promise<void> => post("/api/auth/logout", null, {}, false),
    /** POST /api/account/recovery-key: proves the password, replaces the key, returns the new one once. */
    regenerateRecoveryKey: (body: RegenerateRecoveryKeyRequest): Promise<RegisterResponse> =>
      post("/api/account/recovery-key", regenerateRecoveryKeyResponseSchema, body, true),
    /** POST /api/account/password */
    changePassword: (body: ChangePasswordRequest): Promise<void> => post("/api/account/password", null, body, true),
    /** GET /api/vault */
    getVault: (signal?: AbortSignal): Promise<VaultResponse> =>
      request("/api/vault", vaultResponseSchema, { authed: true, signal }),
    /** POST /api/vault/entries -> 201 { entry } */
    createEntry: (body: EncryptedEntryInput): Promise<EntryResponse> =>
      post("/api/vault/entries", entryResponseSchema, body, true),
    /** PUT /api/vault/entries/[id] */
    updateEntry: (id: string, body: { ciphertext: string; iv: string }): Promise<EntryResponse> =>
      request(`/api/vault/entries/${encodeURIComponent(id)}`, entryResponseSchema, {
        method: "PUT",
        body,
        authed: true,
      }),
    /** DELETE /api/vault/entries/[id] -> 204 */
    deleteEntry: (id: string): Promise<void> =>
      request(`/api/vault/entries/${encodeURIComponent(id)}`, null, { method: "DELETE", authed: true }),
    /** POST /api/vault/import -> 201 { created } */
    importEntries: (body: ImportRequest): Promise<ImportResponse> =>
      post("/api/vault/import", importResponseSchema, body, true),
  };
}

export type Api = ReturnType<typeof createApi>;

/** Shared client used by the flows and hooks. */
export const api: Api = createApi();
