/**
 * Client key derivation: Argon2id(NFKC(password), salt, params) -> 64 bytes.
 * out[0..32) = authKey (base64url, sent to the server), out[32..64) = vaultKey
 * (AES-256-GCM, non-extractable, never leaves the browser). Raw bytes are zeroed.
 */
import { DEFAULT_KDF_PARAMS, kdfParamsSchema, kdfSaltSchema, type KdfParams } from "@/lib/schemas";
import { b64uDecode, b64uEncode, randomBytes, utf8, zero } from "./encoding";
import { argon2idRaw, KDF_OUTPUT_BYTES, type KdfWorkerResponse } from "./kdf-core";
import type { DerivedKeys } from "./types";

export class KdfError extends Error {
  override name = "KdfError";
}

/** 16 random bytes, base64url. */
export function newKdfSalt(): string {
  return b64uEncode(randomBytes(16));
}

function runInWorker(password: Uint8Array, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./kdf.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error);
      return;
    }
    worker.onmessage = (event: MessageEvent<KdfWorkerResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.out);
      else reject(new KdfError(event.data.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new Error("worker_unavailable"));
    };
    // Transfer the password bytes; the worker zeroes them after use.
    worker.postMessage({ password, salt, params }, [password.buffer]);
  });
}

async function argon2(password: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  const normalized = password.normalize("NFKC");
  if (typeof Worker !== "undefined") {
    const bytes = utf8.encode(normalized);
    try {
      return await runInWorker(bytes, salt, params);
    } catch (error) {
      zero(bytes);
      if (error instanceof KdfError) throw error;
      // Worker could not start (blocked or unsupported): fall back to the main thread.
    }
  }
  const bytes = utf8.encode(normalized);
  try {
    return await argon2idRaw(bytes, salt, params);
  } finally {
    zero(bytes);
  }
}

/**
 * Client-only bounds, stricter than the wire schema: a server (or attacker) cannot talk the browser
 * into weaker-than-default derivation, nor into a denial of service with huge parameters.
 */
export const CLIENT_KDF_FLOOR = { m: DEFAULT_KDF_PARAMS.m, t: DEFAULT_KDF_PARAMS.t } as const;
export const CLIENT_KDF_CEILING = { m: 262144, t: 8, p: 4 } as const;

export function isAcceptableKdfParams(params: KdfParams): boolean {
  return (
    params.m >= CLIENT_KDF_FLOOR.m &&
    params.t >= CLIENT_KDF_FLOOR.t &&
    params.m <= CLIENT_KDF_CEILING.m &&
    params.t <= CLIENT_KDF_CEILING.t &&
    params.p <= CLIENT_KDF_CEILING.p
  );
}

/** Derive authKey and the non-extractable vaultKey. Refuses parameters outside the client bounds. */
export async function deriveKeys(password: string, saltB64u: string, params: KdfParams): Promise<DerivedKeys> {
  const p = kdfParamsSchema.safeParse(params);
  if (!p.success || !isAcceptableKdfParams(p.data)) {
    throw new KdfError("The key derivation settings are outside the allowed range.");
  }
  const s = kdfSaltSchema.safeParse(saltB64u);
  if (!s.success) throw new KdfError("The key derivation salt is invalid.");

  const salt = b64uDecode(s.data);
  let out: Uint8Array | null = null;
  try {
    out = await argon2(password, salt, p.data);
    if (out.length !== KDF_OUTPUT_BYTES) throw new KdfError("Key derivation returned an unexpected length.");
    const authBytes = out.slice(0, 32);
    const vaultBytes = out.slice(32, 64);
    try {
      const authKey = b64uEncode(authBytes);
      const vaultKey = await crypto.subtle.importKey("raw", vaultBytes, { name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      return { authKey, vaultKey };
    } finally {
      zero(authBytes);
      zero(vaultBytes);
    }
  } catch (error) {
    if (error instanceof KdfError) throw error;
    throw new KdfError("Could not derive your keys in this browser.");
  } finally {
    zero(out);
  }
}
