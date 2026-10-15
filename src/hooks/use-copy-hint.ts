"use client";

import { useSyncExternalStore } from "react";

/**
 * Remembers, per browser, that the person has copied a code once, so the phone hint
 * "Tap a row to copy its code." stops taking a line at the top of the list. Storage is a
 * convenience only: when it is unavailable the hint simply stays.
 */
const KEY = "totp-auth:copy-hint-done";
const listeners = new Set<() => void>();
let done = false;

function read(): boolean {
  if (done) return true;
  try {
    done = window.localStorage.getItem(KEY) === "1";
  } catch {
    // storage blocked: keep the in-memory value
  }
  return done;
}

export function markCopyHintDone(): void {
  if (done) return;
  done = true;
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // ignore: the in-memory flag still hides the hint for this visit
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the hint should still be shown. Server render shows it (no flash of layout shift later). */
export function useCopyHintVisible(): boolean {
  return !useSyncExternalStore(subscribe, read, () => false);
}
