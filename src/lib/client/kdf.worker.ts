/**
 * Dedicated worker that runs Argon2id off the main thread.
 * Loaded with `new Worker(new URL("./kdf.worker.ts", import.meta.url), { type: "module" })`.
 */
import { argon2idRaw, type KdfWorkerRequest, type KdfWorkerResponse } from "./kdf-core";

type WorkerScope = {
  onmessage: ((event: MessageEvent<KdfWorkerRequest>) => void) | null;
  postMessage(message: KdfWorkerResponse, transfer?: Transferable[]): void;
};
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { password, salt, params } = event.data;
  argon2idRaw(password, salt, params).then(
    (out) => {
      password.fill(0);
      scope.postMessage({ ok: true, out }, [out.buffer]);
    },
    (error: unknown) => {
      password.fill(0);
      scope.postMessage({ ok: false, message: error instanceof Error ? error.message : "Key derivation failed." });
    },
  );
};
