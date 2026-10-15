"use client";
/**
 * Auto-lock: lock the vault after inactivity or after the tab has been hidden for a while.
 * Activity in any tab counts (BroadcastChannel, throttled). The decision itself is pure (shouldLock).
 */
import { useEffect } from "react";
import { lock } from "./auth-flows";
import { useLockState } from "./lock-state";

export type AutoLockConfig = { idleMinutes: number; hiddenMinutes: number };
export const AUTO_LOCK_DEFAULTS: AutoLockConfig = { idleMinutes: 10, hiddenMinutes: 5 };

export type AutoLockState = {
  /** Epoch ms of the last pointer/keyboard/touch activity in any tab. */
  lastActivityAt: number;
  /** Epoch ms when this tab became hidden, or null while visible. */
  hiddenSince: number | null;
};

const MINUTE = 60_000;
const CHECK_INTERVAL_MS = 15_000;
const BROADCAST_THROTTLE_MS = 10_000;

/**
 * Lock when idle for idleMinutes, or hidden for hiddenMinutes. Activity in another tab while this one
 * is hidden restarts the hidden timer, so a background tab never locks a tab that is in use.
 */
export function shouldLock(state: AutoLockState, now: number, config: AutoLockConfig): boolean {
  if (config.idleMinutes > 0 && now - state.lastActivityAt >= config.idleMinutes * MINUTE) return true;
  if (config.hiddenMinutes > 0 && state.hiddenSince !== null) {
    const hiddenFrom = Math.max(state.hiddenSince, state.lastActivityAt);
    if (now - hiddenFrom >= config.hiddenMinutes * MINUTE) return true;
  }
  return false;
}

export type AutoLockController = {
  /** Local activity; returns true when it should be broadcast to other tabs (throttled). */
  activity(): boolean;
  /** Activity reported by another tab. */
  remoteActivity(): void;
  /** Tab visibility changed; evaluates before clearing the hidden timestamp. */
  visibility(hidden: boolean): void;
  /** Evaluate now (interval tick, wake, focus). */
  check(): void;
  readonly state: AutoLockState;
};

/** DOM-free state holder used by useAutoLock; `onLock` fires at most once. */
export function createAutoLockController(opts: {
  config: AutoLockConfig;
  onLock: () => void;
  now?: () => number;
  hidden?: boolean;
}): AutoLockController {
  const now = opts.now ?? Date.now;
  const start = now();
  const state: AutoLockState = { lastActivityAt: start, hiddenSince: opts.hidden ? start : null };
  let lastBroadcast = -Infinity;
  let locked = false;

  const check = () => {
    if (locked) return;
    if (shouldLock(state, now(), opts.config)) {
      locked = true;
      opts.onLock();
    }
  };

  return {
    state,
    activity() {
      check(); // a long sleep must lock even if the first thing after wake is a key press
      if (locked) return false;
      const t = now();
      state.lastActivityAt = t;
      if (t - lastBroadcast >= BROADCAST_THROTTLE_MS) {
        lastBroadcast = t;
        return true;
      }
      return false;
    },
    remoteActivity() {
      if (locked) return;
      state.lastActivityAt = Math.max(state.lastActivityAt, now());
    },
    visibility(hidden) {
      check();
      if (locked) return;
      if (hidden) state.hiddenSince ??= now();
      else state.hiddenSince = null;
    },
    check,
  };
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/** While unlocked, call lock() after inactivity or a long hidden period. Mount once (e.g. in the vault shell). */
export function useAutoLock(config: Partial<AutoLockConfig> = {}): void {
  const lockState = useLockState();
  const idleMinutes = config.idleMinutes ?? AUTO_LOCK_DEFAULTS.idleMinutes;
  const hiddenMinutes = config.hiddenMinutes ?? AUTO_LOCK_DEFAULTS.hiddenMinutes;

  useEffect(() => {
    if (lockState !== "unlocked" || typeof window === "undefined") return;
    const isHidden = () => document.visibilityState === "hidden";
    const controller = createAutoLockController({
      config: { idleMinutes, hiddenMinutes },
      hidden: isHidden(),
      onLock: () => void lock(),
    });

    let channel: BroadcastChannel | null = null;
    try {
      channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("totp-auth-activity");
      if (channel) {
        channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
          if (event.data?.type === "activity") controller.remoteActivity();
        };
      }
    } catch {
      channel = null;
    }

    const onActivity = () => {
      if (controller.activity()) {
        try {
          channel?.postMessage({ type: "activity" });
        } catch {
          // Other tabs fall back to their own activity.
        }
      }
    };
    const onVisibility = () => controller.visibility(isHidden());
    const onWake = () => controller.check();

    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);
    const timer = setInterval(onWake, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
      channel?.close();
    };
  }, [lockState, idleMinutes, hiddenMinutes]);
}
