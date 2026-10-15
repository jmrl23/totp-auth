/**
 * Argon2id core shared by the Web Worker and the main-thread fallback.
 * Takes password bytes (already NFKC + UTF-8) and returns the raw 64-byte output.
 */
import { argon2id } from "hash-wasm";
import type { KdfParams } from "@/lib/schemas";

export const KDF_OUTPUT_BYTES = 64;

export async function argon2idRaw(
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = await argon2id({
    password,
    salt,
    iterations: params.t,
    parallelism: params.p,
    memorySize: params.m,
    hashLength: KDF_OUTPUT_BYTES,
    outputType: "binary",
  });
  const copy = new Uint8Array(out);
  out.fill(0);
  return copy;
}

/** Messages exchanged with kdf.worker.ts. */
export type KdfWorkerRequest = { password: Uint8Array; salt: Uint8Array; params: KdfParams };
export type KdfWorkerResponse = { ok: true; out: Uint8Array } | { ok: false; message: string };
