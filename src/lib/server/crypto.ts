import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function b64uEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function b64uDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/** 32 random bytes, base64url. Used for session tokens. */
export function randomToken(bytes = 32): string {
  return b64uEncode(randomBytes(bytes));
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256(key: Uint8Array, data: string | Uint8Array): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Constant-time string equality. Hashing first removes the length side channel. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
