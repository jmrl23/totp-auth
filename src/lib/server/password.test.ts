import { describe, expect, it } from "vitest";
import { decoySalt, hashAuthKey, verifyAuthKey, verifyDummy } from "./password";
import { configureTestEnv, fakeAuthKey } from "./testing/helpers";
import { kdfSaltSchema } from "@/lib/schemas";

configureTestEnv();

describe("auth key hashing", () => {
  it("hashes with argon2id and verifies", async () => {
    const k = fakeAuthKey();
    const h = await hashAuthKey(k);
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyAuthKey(h, k)).toBe(true);
    expect(await verifyAuthKey(h, fakeAuthKey())).toBe(false);
    expect(await verifyAuthKey("not-a-hash", k)).toBe(false);
  });

  it("dummy verification always fails", async () => {
    expect(await verifyDummy(fakeAuthKey())).toBe(false);
  });

  it("decoy salts are stable per username, distinct across names, and schema-valid", () => {
    expect(decoySalt("alice")).toBe(decoySalt("alice"));
    expect(decoySalt("alice")).not.toBe(decoySalt("bob"));
    expect(kdfSaltSchema.safeParse(decoySalt("alice")).success).toBe(true);
  });
});
