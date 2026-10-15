import { closeDb } from "@/db";

/**
 * Per-process liveness only: set when this instance received SIGTERM so /api/health turns 503 and
 * the load balancer stops routing here while Next drains in-flight requests. No user state.
 */
let draining = false;

export function isDraining(): boolean {
  return draining;
}

/** Grace period before the pg pool is closed; Next stops accepting and drains meanwhile. */
const POOL_CLOSE_DELAY_MS = 5_000;

let installed = false;
export function installShutdownHandlers(): void {
  if (installed) return;
  installed = true;
  const onSignal = () => {
    if (draining) return;
    draining = true;
    // Next's own SIGTERM handler closes the HTTP server, waits for requests, then exits.
    // Close the pool after a short grace; unref() so this timer never delays exit.
    setTimeout(() => {
      closeDb().catch(() => undefined);
    }, POOL_CLOSE_DELAY_MS).unref();
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
}
