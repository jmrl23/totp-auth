import { hash, verify } from "@node-rs/argon2";
import { DEFAULT_KDF_PARAMS, type KdfParams } from "@/lib/schemas";
import { b64uEncode, hmacSha256, randomToken } from "./crypto";
import { getEnv } from "./env";

/** argon2id(authKey) with library defaults (Argon2id, m=19456, t=2, p=1). */
export function hashAuthKey(authKey: string): Promise<string> {
  return hash(authKey);
}

/** Constant-time verification. Malformed hashes count as a mismatch. */
export async function verifyAuthKey(authHash: string, authKey: string): Promise<boolean> {
  try {
    return await verify(authHash, authKey);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Does the same argon2 work as a real verification and always returns false. */
export async function verifyDummy(authKey: string): Promise<false> {
  dummyHash ??= hash(randomToken());
  await verifyAuthKey(await dummyHash, authKey);
  return false;
}

/** Deterministic per-username salt for unknown users: HMAC(pepper, "decoy:"+username)[0..16). */
export function decoySalt(username: string): string {
  return b64uEncode(hmacSha256(getEnv().SERVER_PEPPER, `decoy:${username}`).subarray(0, 16));
}

export function decoyKdfParams(): KdfParams {
  return { ...DEFAULT_KDF_PARAMS };
}
