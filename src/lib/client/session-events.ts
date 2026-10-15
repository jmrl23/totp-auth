/** Tiny in-tab event bus so the API layer, lock state and query cache stay in sync without import cycles. */
export type SessionEvent =
  /** The server no longer recognises the session (401 unauthorized) or the user signed out. */
  | "signed-out"
  /** Sign-in, unlock or password change completed: session and vault should be refetched. */
  | "session-changed"
  /** The vault key was dropped (lock). */
  | "locked";

type Listener = (event: SessionEvent) => void;
const listeners = new Set<Listener>();

export function onSessionEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSessionEvent(event: SessionEvent): void {
  for (const l of [...listeners]) {
    try {
      l(event);
    } catch {
      // A listener must never break the caller.
    }
  }
}
