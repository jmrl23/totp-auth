import { describe, expect, it } from "vitest";
import { hashRaw } from "@node-rs/argon2";
import type { Options } from "@node-rs/argon2";
import { DEFAULT_KDF_PARAMS, type EntryPlain, type KdfParams } from "@/lib/schemas";
import { b64uDecode, b64uEncode } from "./encoding";
import { deriveKeys, isAcceptableKdfParams, KdfError, newKdfSalt } from "./kdf";
import { decryptEntry, encryptEntry, VaultCryptoError } from "./vault-crypto";

/** The client floor equals the defaults, so tests derive with the real parameters. */
const FAST: KdfParams = { ...DEFAULT_KDF_PARAMS };
const SALT = b64uEncode(new Uint8Array(16).map((_, i) => i + 1));

const plain: EntryPlain = {
  issuer: "ACME",
  label: "alice@example.com",
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
};

describe("base64url", () => {
  it("roundtrips without padding", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const s = b64uEncode(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(b64uDecode(s)).toEqual(bytes);
    }
  });
  it("rejects invalid input", () => {
    expect(() => b64uDecode("a+b/")).toThrow();
    expect(() => b64uDecode("a")).toThrow();
  });
});

describe("newKdfSalt", () => {
  it("is 16 random bytes in base64url", () => {
    const a = newKdfSalt();
    expect(a).toHaveLength(22);
    expect(b64uDecode(a)).toHaveLength(16);
    expect(newKdfSalt()).not.toBe(a);
  });
});

describe("deriveKeys", () => {
  it("is deterministic and matches a reference Argon2id implementation", async () => {
    const a = await deriveKeys("correct horse battery staple", SALT, FAST);
    const b = await deriveKeys("correct horse battery staple", SALT, FAST);
    expect(a.authKey).toBe(b.authKey);
    expect(a.authKey).toHaveLength(43);

    const ref = await hashRaw("correct horse battery staple", {
      algorithm: 2 as unknown as Options["algorithm"], // Argon2id
      salt: b64uDecode(SALT),
      memoryCost: FAST.m,
      timeCost: FAST.t,
      parallelism: FAST.p,
      outputLen: 64,
    });
    expect(a.authKey).toBe(b64uEncode(new Uint8Array(ref.subarray(0, 32))));

    // Both vault keys decrypt each other's ciphertext: same key material.
    const enc = await encryptEntry(a.vaultKey, "4b1f0e1c-3f53-4c55-9d0f-2c6a3a8f1e11", plain);
    await expect(decryptEntry(b.vaultKey, enc.id, enc)).resolves.toEqual(plain);
  }, 30_000);

  it("produces a non-extractable AES-GCM key for encrypt/decrypt only", async () => {
    const { vaultKey } = await deriveKeys("correct horse battery staple", SALT, FAST);
    expect(vaultKey.extractable).toBe(false);
    expect(vaultKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...vaultKey.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(crypto.subtle.exportKey("raw", vaultKey)).rejects.toThrow();
  }, 30_000);

  it("NFKC-normalises the password", async () => {
    const composed = await deriveKeys("café password!", SALT, FAST);
    const decomposed = await deriveKeys("café password!", SALT, FAST);
    expect(composed.authKey).toBe(decomposed.authKey);
  }, 30_000);

  it("differs by salt and password", async () => {
    const a = await deriveKeys("password one!!", SALT, FAST);
    const b = await deriveKeys("password two!!", SALT, FAST);
    const c = await deriveKeys("password one!!", newKdfSalt(), FAST);
    expect(new Set([a.authKey, b.authKey, c.authKey]).size).toBe(3);
  }, 30_000);

  it("refuses parameters below the client floor, above the ceiling, and bad salts", async () => {
    await expect(deriveKeys("pw", SALT, { ...FAST, m: 1024 })).rejects.toBeInstanceOf(KdfError);
    await expect(deriveKeys("pw", SALT, { ...FAST, t: 1 })).rejects.toBeInstanceOf(KdfError);
    // Valid on the wire schema but below the client floor (the defaults).
    await expect(deriveKeys("pw", SALT, { ...FAST, m: 19456, t: 2 })).rejects.toBeInstanceOf(KdfError);
    await expect(deriveKeys("pw", SALT, { ...FAST, m: 65535 })).rejects.toBeInstanceOf(KdfError);
    await expect(deriveKeys("pw", SALT, { ...FAST, t: 2 })).rejects.toBeInstanceOf(KdfError);
    // Above the ceiling.
    await expect(deriveKeys("pw", SALT, { ...FAST, m: 262145 })).rejects.toBeInstanceOf(KdfError);
    await expect(deriveKeys("pw", SALT, { ...FAST, t: 9 })).rejects.toBeInstanceOf(KdfError);
    await expect(deriveKeys("pw", SALT, { ...FAST, p: 5 })).rejects.toBeInstanceOf(KdfError);
    await expect(deriveKeys("pw", SALT, { ...FAST, v: 2 } as unknown as KdfParams)).rejects.toBeInstanceOf(KdfError);
    await expect(deriveKeys("pw", "short", FAST)).rejects.toBeInstanceOf(KdfError);
  });

  it("accepts exactly the bounds", () => {
    expect(isAcceptableKdfParams(DEFAULT_KDF_PARAMS)).toBe(true);
    expect(isAcceptableKdfParams({ ...DEFAULT_KDF_PARAMS, m: 262144, t: 8, p: 4 })).toBe(true);
    expect(isAcceptableKdfParams({ ...DEFAULT_KDF_PARAMS, m: 65535 })).toBe(false);
  });
});

describe("vault crypto", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const otherId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const key = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

  it("roundtrips with a fresh IV each time", async () => {
    const k = await key();
    const a = await encryptEntry(k, id, plain);
    const b = await encryptEntry(k, id, plain);
    expect(a.id).toBe(id);
    expect(b64uDecode(a.iv)).toHaveLength(12);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await decryptEntry(k, id, a)).toEqual(plain);
  });

  it("fails with a typed error when the id (AAD) differs", async () => {
    const k = await key();
    const enc = await encryptEntry(k, id, plain);
    await expect(decryptEntry(k, otherId, enc)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it("fails with a typed error when the ciphertext or IV is tampered", async () => {
    const k = await key();
    const enc = await encryptEntry(k, id, plain);
    const ct = b64uDecode(enc.ciphertext);
    ct[0] ^= 1;
    await expect(decryptEntry(k, id, { ...enc, ciphertext: b64uEncode(ct) })).rejects.toBeInstanceOf(VaultCryptoError);
    const iv = b64uDecode(enc.iv);
    iv[11] ^= 1;
    await expect(decryptEntry(k, id, { ...enc, iv: b64uEncode(iv) })).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(decryptEntry(k, id, { ...enc, iv: "!!" })).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it("fails with a typed error for the wrong key", async () => {
    const enc = await encryptEntry(await key(), id, plain);
    await expect(decryptEntry(await key(), id, enc)).rejects.toMatchObject({ code: "decrypt_failed" });
  });

  it("rejects plaintext that does not match the entry schema", async () => {
    const k = await key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify({ issuer: "", secret: "x" }));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`totp-auth:v1:entry:${id}`) },
      k,
      data,
    );
    await expect(
      decryptEntry(k, id, { ciphertext: b64uEncode(new Uint8Array(ct)), iv: b64uEncode(iv) }),
    ).rejects.toMatchObject({ code: "invalid_plaintext" });
    await expect(encryptEntry(k, id, { ...plain, secret: "bad!" })).rejects.toBeInstanceOf(VaultCryptoError);
  });
});
