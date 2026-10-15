import { describe, expect, it } from "vitest";
import {
  decoyRecoveryHash,
  generateRecoveryKey,
  hashRecoveryKey,
  normalizeRecoveryKey,
  recoveryKeyMatches,
} from "./recovery-key";
import { configureTestEnv } from "./testing/helpers";
import { recoveryKeySchema } from "@/lib/schemas";

configureTestEnv();

describe("recovery key", () => {
  it("generates XXXXX-XXXXX-XXXXX-XXXXX in Crockford base32", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRecoveryKey()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    }
  });

  it("does not repeat", () => {
    const keys = new Set(Array.from({ length: 200 }, generateRecoveryKey));
    expect(keys.size).toBe(200);
  });

  it("normalizes case, dashes and spaces to one stored form", () => {
    expect(normalizeRecoveryKey("abcde-fghjk-mnpqr-stvwx")).toBe("ABCDEFGHJKMNPQRSTVWX");
    expect(normalizeRecoveryKey(" abcde fghjk mnpqr stvwx ")).toBe("ABCDEFGHJKMNPQRSTVWX");
    expect(recoveryKeySchema.parse("abcde-fghjk-mnpqr-stvwx")).toBe("ABCDEFGHJKMNPQRSTVWX");
    expect(recoveryKeySchema.safeParse("ABCDE-FGHJK").success).toBe(false);
    expect(recoveryKeySchema.safeParse("ABCDE-FGHJK-MNPQR-STVWI").success).toBe(false);
  });

  it("hashes display and stored forms to the same value, never to the key itself", () => {
    const key = generateRecoveryKey();
    const hash = hashRecoveryKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashRecoveryKey(key.toLowerCase().replace(/-/g, "")));
    expect(hash).not.toContain(normalizeRecoveryKey(key));
  });

  it("matches only the right key", () => {
    const key = generateRecoveryKey();
    const hash = hashRecoveryKey(key);
    expect(recoveryKeyMatches(hash, key)).toBe(true);
    expect(recoveryKeyMatches(hash, key.toLowerCase())).toBe(true);
    expect(recoveryKeyMatches(hash, generateRecoveryKey())).toBe(false);
  });

  it("gives unknown usernames a stable decoy hash that matches no key", () => {
    const d = decoyRecoveryHash("ghost");
    expect(d).toBe(decoyRecoveryHash("ghost"));
    expect(d).not.toBe(decoyRecoveryHash("other"));
    expect(recoveryKeyMatches(d, generateRecoveryKey())).toBe(false);
  });
});
