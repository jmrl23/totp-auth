import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  b64uDecode,
  b64uEncode,
  hmacSha256,
  randomToken,
  sha256Hex,
  timingSafeEqualStr,
} from "./crypto";

describe("crypto helpers", () => {
  it("round-trips base64url without padding", () => {
    const bytes = randomBytes(33);
    const enc = b64uEncode(bytes);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.compare(b64uDecode(enc), bytes)).toBe(0);
  });

  it("computes sha256 hex and HMAC-SHA256 deterministically", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const k = Buffer.from("key");
    expect(hmacSha256(k, "The quick brown fox jumps over the lazy dog").toString("hex")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("compares strings in constant time, including different lengths", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });

  it("creates 32-byte random tokens", () => {
    const t = randomToken();
    expect(b64uDecode(t)).toHaveLength(32);
    expect(randomToken()).not.toBe(t);
  });
});
