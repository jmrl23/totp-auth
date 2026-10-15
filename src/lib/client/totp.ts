/**
 * TOTP code generation (RFC 6238 over RFC 4226) and otpauth:// URI parsing/building.
 * Pure functions: no DOM, no React. Safe to import anywhere.
 */
import * as OTPAuth from "otpauth";
import {
  ENTRY_DEFAULTS,
  OTP_ALGORITHMS,
  entryPlainSchema,
  normalizeSecret,
  type EntryPlain,
} from "@/lib/schemas";
import type { CodeResult } from "./types";

/** Thrown for any otpauth input that cannot be used. `message` is written for people. */
export class OtpauthError extends Error {
  override name = "OtpauthError";
}

type CodeInput = Pick<EntryPlain, "secret" | "algorithm" | "digits" | "period">;

/* ---------- code generation ---------- */

/** Codes only change once per period, so cache them per (entry, counter). */
const CODE_CACHE_LIMIT = 2048;
const codeCache = new Map<string, string>();

function cachedCode(entry: CodeInput, counter: number): string {
  const cacheKey = `${entry.algorithm}|${entry.digits}|${entry.secret}|${counter}`;
  const hit = codeCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const code = OTPAuth.HOTP.generate({
    secret: OTPAuth.Secret.fromBase32(entry.secret),
    algorithm: entry.algorithm,
    digits: entry.digits,
    counter,
  });
  if (codeCache.size >= CODE_CACHE_LIMIT) codeCache.clear();
  codeCache.set(cacheKey, code);
  return code;
}

/** "482 913" (6), "482 9130" (7: 3+4), "4829 1305" (8: 4+4). */
export function formatCode(code: string): string {
  const head = code.length === 8 ? 4 : 3;
  if (code.length <= head) return code;
  return `${code.slice(0, head)} ${code.slice(head)}`;
}

/** Current code for `entry` at epoch milliseconds `nowMs` (use the server-corrected time from useNow). */
export function generateCode(entry: CodeInput, nowMs: number): CodeResult {
  const periodMs = entry.period * 1000;
  const counter = Math.floor(nowMs / periodMs);
  const intoPeriodMs = nowMs - counter * periodMs; // 0..periodMs-1, also correct for negative times
  const code = cachedCode(entry, counter);
  const secondsLeft = entry.period - Math.floor(intoPeriodMs / 1000);
  return {
    code,
    formatted: formatCode(code),
    secondsLeft,
    elapsed: intoPeriodMs / periodMs,
    expiring: secondsLeft <= 5,
  };
}

/* ---------- otpauth:// parsing ---------- */

const URI_RE = /^otpauth:\/\/([^/?#]*)\/?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i;

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new OtpauthError("The account name in this link is not encoded correctly.");
  }
}

function firstSchemaMessage(input: unknown): EntryPlain {
  const parsed = entryPlainSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path[0];
  if (field === "issuer" && issue?.code === "too_big") {
    throw new OtpauthError("The service name in this link is longer than 64 characters.");
  }
  if (field === "label" && issue?.code === "too_big") {
    throw new OtpauthError("The account name in this link is longer than 128 characters.");
  }
  throw new OtpauthError(issue?.message ?? "This link could not be read.");
}

/**
 * Parse an `otpauth://totp/...` URI into an entry.
 * Issuer comes from the `issuer` parameter, else from a `Issuer:account` label prefix,
 * else the account name is used as the issuer. Rejects HOTP and unsupported parameters.
 */
export function parseOtpauthUri(input: string): EntryPlain {
  const uri = input.trim();
  const m = URI_RE.exec(uri);
  if (!m) throw new OtpauthError("This is not an otpauth:// link.");
  const type = m[1].toLowerCase();
  if (type === "hotp") {
    throw new OtpauthError("This is a counter-based (HOTP) code. Only time-based (TOTP) codes are supported.");
  }
  if (type !== "totp") {
    throw new OtpauthError(`"${m[1]}" codes are not supported. Only time-based (TOTP) codes are supported.`);
  }

  const rawLabel = m[2];
  const params = new URLSearchParams(m[3] ?? "");
  const issuerParam = params.get("issuer")?.trim() || "";

  const fullLabel = decodePart(rawLabel).trim();
  let labelIssuer = "";
  let account = fullLabel;
  if (!(issuerParam && fullLabel === issuerParam)) {
    let sep = rawLabel.indexOf(":");
    let sepLen = 1;
    if (sep < 0) {
      sep = rawLabel.toUpperCase().indexOf("%3A");
      sepLen = 3;
    }
    if (sep >= 0) {
      labelIssuer = decodePart(rawLabel.slice(0, sep)).trim();
      account = decodePart(rawLabel.slice(sep + sepLen)).trim();
    }
  } else {
    account = "";
  }

  let issuer = issuerParam || labelIssuer;
  if (!issuer) {
    issuer = account;
    account = "";
  }
  if (!issuer) throw new OtpauthError("This link has no service or account name.");

  const rawSecret = params.get("secret");
  if (!rawSecret || !normalizeSecret(rawSecret)) throw new OtpauthError("This link has no secret.");

  const algParam = params.get("algorithm");
  let algorithm: EntryPlain["algorithm"] = ENTRY_DEFAULTS.algorithm;
  if (algParam !== null) {
    const norm = algParam.replace(/-/g, "").toUpperCase();
    const found = OTP_ALGORITHMS.find((a) => a === norm);
    if (!found) throw new OtpauthError(`The ${algParam} algorithm is not supported. Use SHA1, SHA256 or SHA512.`);
    algorithm = found;
  }

  const digitsParam = params.get("digits");
  let digits: EntryPlain["digits"] = ENTRY_DEFAULTS.digits;
  if (digitsParam !== null) {
    const d = digitsParam.trim();
    if (d !== "6" && d !== "7" && d !== "8") {
      throw new OtpauthError(`Codes with ${digitsParam} digits are not supported. Use 6, 7 or 8 digits.`);
    }
    digits = Number(d) as EntryPlain["digits"];
  }

  const periodParam = params.get("period");
  let period: number = ENTRY_DEFAULTS.period;
  if (periodParam !== null) {
    const p = periodParam.trim();
    const n = Number(p);
    if (!/^\d+$/.test(p) || n < 10 || n > 120) {
      throw new OtpauthError(`A period of ${periodParam} seconds is not supported. Use 10 to 120 seconds.`);
    }
    period = n;
  }

  return firstSchemaMessage({ issuer, label: account, secret: rawSecret, algorithm, digits, period });
}

/** Build a standard `otpauth://totp/` URI that other authenticator apps accept. */
export function buildOtpauthUri(entry: EntryPlain): string {
  const issuer = encodeURIComponent(entry.issuer);
  const path = entry.label ? `${issuer}:${encodeURIComponent(entry.label)}` : issuer;
  const query = [
    `secret=${normalizeSecret(entry.secret)}`,
    `issuer=${issuer}`,
    `algorithm=${entry.algorithm}`,
    `digits=${entry.digits}`,
    `period=${entry.period}`,
  ].join("&");
  return `otpauth://totp/${path}?${query}`;
}

export type EntryInput = { kind: "uri"; entry: EntryPlain } | { kind: "secret"; secret: string };

/**
 * For the "Paste link" field: accepts an otpauth:// URI or a bare base32 secret.
 * A bare secret returns only the normalised secret; the UI asks for the service name.
 */
export function parseEntryInput(text: string): EntryInput {
  const trimmed = text.trim();
  if (/^otpauth:/i.test(trimmed)) return { kind: "uri", entry: parseOtpauthUri(trimmed) };
  const secret = entryPlainSchema.shape.secret.safeParse(trimmed);
  if (secret.success) return { kind: "secret", secret: secret.data };
  throw new OtpauthError("Paste an otpauth:// link or a base32 secret (letters A to Z and digits 2 to 7).");
}
