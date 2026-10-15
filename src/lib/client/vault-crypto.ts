/**
 * Vault entry encryption: AES-256-GCM, fresh random 12-byte IV,
 * AAD = "totp-auth:v1:entry:<id>", plaintext = JSON of EntryPlain.
 */
import { entryPlainSchema, type EncryptedEntryInput, type EntryPlain } from "@/lib/schemas";
import { b64uDecode, b64uEncode, randomBytes, utf8, zero } from "./encoding";

export type VaultCryptoErrorCode = "decrypt_failed" | "invalid_plaintext" | "encrypt_failed";

export class VaultCryptoError extends Error {
  override name = "VaultCryptoError";
  constructor(
    readonly code: VaultCryptoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const entryAad = (id: string) => utf8.encode(`totp-auth:v1:entry:${id}`);

export async function encryptEntry(key: CryptoKey, id: string, plain: EntryPlain): Promise<EncryptedEntryInput> {
  const parsed = entryPlainSchema.safeParse(plain);
  if (!parsed.success) {
    throw new VaultCryptoError("invalid_plaintext", parsed.error.issues[0]?.message ?? "This entry is not valid.");
  }
  const iv = randomBytes(12);
  const data = utf8.encode(JSON.stringify(parsed.data));
  try {
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: entryAad(id) }, key, data);
    return { id, ciphertext: b64uEncode(new Uint8Array(ct)), iv: b64uEncode(iv) };
  } catch {
    throw new VaultCryptoError("encrypt_failed", "This entry could not be encrypted.");
  } finally {
    zero(data);
  }
}

export async function decryptEntry(
  key: CryptoKey,
  id: string,
  enc: { ciphertext: string; iv: string },
): Promise<EntryPlain> {
  let pt: Uint8Array | null = null;
  try {
    const iv = b64uDecode(enc.iv);
    const ct = b64uDecode(enc.ciphertext);
    if (iv.length !== 12) throw new Error("iv");
    pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: entryAad(id) }, key, ct));
  } catch {
    throw new VaultCryptoError("decrypt_failed", "This entry could not be decrypted with your key.");
  }
  try {
    const parsed = entryPlainSchema.safeParse(JSON.parse(utf8.decode(pt)));
    if (!parsed.success) throw new Error("schema");
    return parsed.data;
  } catch {
    throw new VaultCryptoError("invalid_plaintext", "This entry decrypted but its contents are not valid.");
  } finally {
    zero(pt);
  }
}
