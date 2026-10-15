import { randomBytes } from "node:crypto";
import { RECOVERY_KEY_LENGTH } from "@/lib/schemas";
import { hmacSha256, timingSafeEqualStr } from "./crypto";
import { getEnv } from "./env";

/** Crockford base32 alphabet (no I, L, O, U). 32 symbols, so `byte & 31` is unbiased. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A 20-char key (100 bits) shown as XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(RECOVERY_KEY_LENGTH);
  let s = "";
  for (const b of bytes) s += CROCKFORD[b & 31];
  return [0, 5, 10, 15].map((i) => s.slice(i, i + 5)).join("-");
}

/** Normalizes display form to the stored form: uppercase, no dashes or spaces. */
export function normalizeRecoveryKey(key: string): string {
  return key.replace(/[-\s]/g, "").toUpperCase();
}

export function hashRecoveryKey(key: string): string {
  return hmacSha256(getEnv().SERVER_PEPPER, normalizeRecoveryKey(key)).toString("hex");
}

/** Constant-time check of a submitted key against the stored hash. */
export function recoveryKeyMatches(storedHash: string, key: string): boolean {
  return timingSafeEqualStr(storedHash, hashRecoveryKey(key));
}

/** Hash for unknown usernames, so a miss costs the same HMAC and compare as a hit. */
export function decoyRecoveryHash(username: string): string {
  return hmacSha256(getEnv().SERVER_PEPPER, `decoy-recovery:${username}`).toString("hex");
}
