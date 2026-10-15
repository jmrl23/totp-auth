/**
 * Shared wire contract. Single source of truth for every request, response and
 * plaintext shape. Imported by server route handlers, the client library and the UI.
 * No server-only or browser-only imports here.
 */
import { z } from "zod";

// Zod probes for eval with Function(""), which a strict CSP reports as a violation. Opt out of the JIT path.
z.config({ jitless: true });

/* ---------- primitives ---------- */

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, "Use 3 to 32 letters, digits, dots, dashes or underscores.");

/** base64url, no padding. */
const b64u = (bytes: number) => {
  const len = Math.ceil((bytes * 4) / 3);
  return z.string().length(len).regex(/^[A-Za-z0-9_-]+$/, "Invalid encoding.");
};
/** authKey: 32 bytes derived client-side. Never the password. */
export const authKeySchema = b64u(32);
export const kdfSaltSchema = b64u(16);
export const ivSchema = b64u(12);
export const ciphertextSchema = z
  .string()
  .min(16)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid encoding.");

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH);

/**
 * Account recovery key as displayed: 20 Crockford base32 chars in four groups (XXXXX-XXXXX-XXXXX-XXXXX,
 * 100 bits), case-insensitive, dashes and spaces optional. One key per account, replaced when regenerated.
 */
export const RECOVERY_KEY_LENGTH = 20;
export const recoveryKeySchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[-\s]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{20}$/, "Enter your 20-character recovery key."));

export const uuidSchema = z.uuid();

/* ---------- KDF ---------- */

export const kdfParamsSchema = z.object({
  alg: z.literal("argon2id"),
  /** memory in KiB */
  m: z.number().int().min(19456).max(262144),
  /** iterations */
  t: z.number().int().min(2).max(8),
  /** parallelism */
  p: z.number().int().min(1).max(4),
  /** derivation layout version: out[0..32)=authKey, out[32..64)=vaultKey */
  v: z.literal(1),
});
export type KdfParams = z.infer<typeof kdfParamsSchema>;
export const DEFAULT_KDF_PARAMS: KdfParams = { alg: "argon2id", m: 65536, t: 3, p: 1, v: 1 };

/* ---------- vault plaintext (exists only in the browser) ---------- */

export const OTP_ALGORITHMS = ["SHA1", "SHA256", "SHA512"] as const;
export const OTP_DIGITS = [6, 7, 8] as const;

export function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

export const entryPlainSchema = z.object({
  issuer: z.string().trim().min(1, "Enter the service name.").max(64),
  label: z.string().trim().max(128),
  secret: z
    .string()
    .transform(normalizeSecret)
    .pipe(z.string().regex(/^[A-Z2-7]{16,128}$/, "Enter a valid base32 secret (A to Z, 2 to 7).")),
  algorithm: z.enum(OTP_ALGORITHMS),
  digits: z.union([z.literal(6), z.literal(7), z.literal(8)]),
  period: z.number().int().min(10).max(120),
});
export type EntryPlain = z.infer<typeof entryPlainSchema>;
export const ENTRY_DEFAULTS = { algorithm: "SHA1", digits: 6, period: 30 } as const;

/** What the UI works with after decryption. */
export type VaultEntry = EntryPlain & { id: string; updatedAt: string };

export const MAX_ENTRIES_PER_USER = 500;
export const MAX_IMPORT_BATCH = 200;

/* ---------- errors ---------- */

export const API_ERROR_CODES = [
  "invalid_request",
  "invalid_credentials",
  "rate_limited",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "registration_closed",
  "limit_reached",
  "server_error",
  /** Body over the per-route size cap (HTTP 413). */
  "payload_too_large",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; retryAfter?: number } };

/* ---------- public ---------- */

/** GET /api/auth/config */
export const authConfigResponseSchema = z.object({
  registrationOpen: z.boolean(),
  setupTokenRequired: z.boolean(),
  /**
   * Present only when registrationOpen is false. "setup_token_missing": no account exists yet but
   * the instance is on a public origin without SETUP_TOKEN configured. "closed": an account exists.
   */
  closedReason: z.enum(["setup_token_missing", "closed"]).optional(),
});
export type AuthConfigResponse = z.infer<typeof authConfigResponseSchema>;

/** GET /api/time -> epoch ms on the server. */
export const timeResponseSchema = z.object({ now: z.number() });
export type TimeResponse = z.infer<typeof timeResponseSchema>;

/* ---------- registration ---------- */

/**
 * POST /api/auth/register  (creates the account and an 'active' session, returns the recovery key once).
 * First account wins: registration closes when an account exists unless ALLOW_REGISTRATION=true.
 */
export const registerRequestSchema = z.object({
  username: usernameSchema,
  authKey: authKeySchema,
  kdfSalt: kdfSaltSchema,
  kdfParams: kdfParamsSchema,
  setupToken: z.string().max(256).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
/** recoveryKey is shown as XXXXX-XXXXX-XXXXX-XXXXX. The server keeps only a keyed hash of it. */
export const registerResponseSchema = z.object({ recoveryKey: z.string() });
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

/* ---------- login ---------- */

/** POST /api/auth/prelogin */
export const preloginRequestSchema = z.object({ username: usernameSchema });
export type PreloginRequest = z.infer<typeof preloginRequestSchema>;
export const preloginResponseSchema = z.object({ kdfSalt: kdfSaltSchema, kdfParams: kdfParamsSchema });
export type PreloginResponse = z.infer<typeof preloginResponseSchema>;

/** POST /api/auth/login -> 204, sets the 'active' session cookie. */
export const loginRequestSchema = z.object({ username: usernameSchema, authKey: authKeySchema });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * POST /api/auth/recover (public). Forgotten password: prove the recovery key, set a new password.
 * The old vault cannot be decrypted without the old password, so the server DELETES every entry,
 * signs out every session, swaps the credentials, replaces the recovery key and returns the new one.
 * Sets an 'active' session cookie. Wrong username or key: 401 invalid_credentials (same body for both).
 */
export const recoverRequestSchema = z.object({
  username: usernameSchema,
  recoveryKey: recoveryKeySchema,
  newAuthKey: authKeySchema,
  newKdfSalt: kdfSaltSchema,
  newKdfParams: kdfParamsSchema,
});
export type RecoverRequest = z.input<typeof recoverRequestSchema>;
export const recoverResponseSchema = registerResponseSchema;
export type RecoverResponse = z.infer<typeof recoverResponseSchema>;

/** POST /api/auth/unlock (needs 'active' session): re-checks the password after Lock. */
export const unlockRequestSchema = z.object({ authKey: authKeySchema });
export type UnlockRequest = z.infer<typeof unlockRequestSchema>;

/** GET /api/auth/session (200 or 401) */
export const sessionResponseSchema = z.object({
  user: z.object({
    id: uuidSchema,
    username: usernameSchema,
    kdfSalt: kdfSaltSchema,
    kdfParams: kdfParamsSchema,
  }),
  /** When the current recovery key was issued (ISO). */
  recoveryKeyCreatedAt: z.string(),
  expiresAt: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** POST /api/auth/logout -> 204 */

/* ---------- account ---------- */

/**
 * POST /api/account/recovery-key (needs 'active' session). Proves the password, replaces the recovery key,
 * returns the new key once. The old key stops working immediately.
 */
export const regenerateRecoveryKeyRequestSchema = z.object({ authKey: authKeySchema });
export type RegenerateRecoveryKeyRequest = z.infer<typeof regenerateRecoveryKeyRequestSchema>;
export const regenerateRecoveryKeyResponseSchema = registerResponseSchema;

/**
 * POST /api/account/password (needs 'active' session)
 * Client re-encrypts every entry with the new vault key and swaps everything in one transaction.
 * Revokes all other sessions.
 */
export const changePasswordRequestSchema = z.object({
  currentAuthKey: authKeySchema,
  newAuthKey: authKeySchema,
  newKdfSalt: kdfSaltSchema,
  newKdfParams: kdfParamsSchema,
  /** Every existing entry, re-encrypted. Must cover all of the user's entries exactly. */
  entries: z
    .array(z.object({ id: uuidSchema, ciphertext: ciphertextSchema, iv: ivSchema }))
    .max(MAX_ENTRIES_PER_USER),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/* ---------- vault ---------- */

export const encryptedEntrySchema = z.object({
  id: uuidSchema,
  ciphertext: ciphertextSchema,
  iv: ivSchema,
});
export type EncryptedEntryInput = z.infer<typeof encryptedEntrySchema>;
export const encryptedEntryRowSchema = encryptedEntrySchema.extend({ updatedAt: z.string() });
export type EncryptedEntryRow = z.infer<typeof encryptedEntryRowSchema>;

/** GET /api/vault */
export const vaultResponseSchema = z.object({ entries: z.array(encryptedEntryRowSchema) });
export type VaultResponse = z.infer<typeof vaultResponseSchema>;

/** POST /api/vault/entries  (client-generated uuid; 409 if the id exists) -> 201 { entry } */
export const createEntryRequestSchema = encryptedEntrySchema;
/** PUT /api/vault/entries/[id] */
export const updateEntryRequestSchema = z.object({ ciphertext: ciphertextSchema, iv: ivSchema });
export const entryResponseSchema = z.object({ entry: encryptedEntryRowSchema });
export type EntryResponse = z.infer<typeof entryResponseSchema>;
/** DELETE /api/vault/entries/[id] -> 204 */

/** POST /api/vault/import -> 201 { created } ; ids that already exist are skipped */
export const importRequestSchema = z.object({
  entries: z.array(encryptedEntrySchema).min(1).max(MAX_IMPORT_BATCH),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;
export const importResponseSchema = z.object({ created: z.number().int() });
export type ImportResponse = z.infer<typeof importResponseSchema>;
