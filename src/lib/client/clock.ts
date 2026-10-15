"use client";
/**
 * One shared, server-corrected clock for every code on the page.
 * offset = serverNow + rtt/2 - clientNow, best (lowest rtt) of up to 3 samples,
 * synced at start, every 10 minutes and when the tab becomes visible again.
 */
import { useSyncExternalStore } from "react";
import { api } from "./api";

export type TimeSample = { serverNow: number; rtt: number; clientNow: number };

export const DRIFT_NOTICE_MS = 2000;
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const VISIBLE_RESYNC_MIN_MS = 30 * 1000;
const FAST_TICK_MS = 100;
const SLOW_TICK_MS = 1000;

export function offsetFromSample(s: TimeSample): number {
  return s.serverNow + s.rtt / 2 - s.clientNow;
}

/** Offset from the lowest-rtt sample, or null with no samples. */
export function bestOffset(samples: TimeSample[]): number | null {
  if (samples.length === 0) return null;
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  return Math.round(offsetFromSample(best));
}

export type MeasureOptions = {
  /** Returns server epoch ms. */
  fetchServerNow: () => Promise<number>;
  /** Client epoch ms. */
  now?: () => number;
  /** Monotonic ms for rtt (defaults to performance.now, else `now`). */
  monotonic?: () => number;
  samples?: number;
};

/** Take up to `samples` sequential measurements; failed requests are skipped. */
export async function measureOffset(opts: MeasureOptions): Promise<number | null> {
  const now = opts.now ?? Date.now;
  const mono =
    opts.monotonic ?? (typeof performance !== "undefined" ? () => performance.now() : opts.now ?? Date.now);
  const count = opts.samples ?? 3;
  const samples: TimeSample[] = [];
  for (let i = 0; i < count; i++) {
    const start = mono();
    try {
      const serverNow = await opts.fetchServerNow();
      const rtt = Math.max(0, mono() - start);
      samples.push({ serverNow, rtt, clientNow: now() });
    } catch {
      // try the next sample
    }
  }
  return bestOffset(samples);
}

/* ---------- shared store ---------- */

type ClockDeps = {
  fetchServerNow: () => Promise<number>;
  now: () => number;
};

let deps: ClockDeps = {
  fetchServerNow: async () => (await api.getTime()).now,
  now: () => Date.now(),
};

let offset = 0;
let driftMs: number | null = null;
let current = typeof window === "undefined" ? 0 : Date.now();
let driftSnapshot: { driftMs: number | null } = { driftMs: null };

const nowListeners = new Set<() => void>();
const driftListeners = new Set<() => void>();

let running = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncAt = -Infinity;
let syncing: Promise<void> | null = null;
let reducedMotionQuery: MediaQueryList | null = null;

function emitNow(): void {
  for (const l of [...nowListeners]) l();
}

function tick(): void {
  const next = deps.now() + offset;
  if (next !== current) {
    current = next;
    emitNow();
  }
}

export function syncClock(): Promise<void> {
  if (syncing) return syncing;
  lastSyncAt = deps.now();
  syncing = measureOffset({ fetchServerNow: deps.fetchServerNow, now: deps.now })
    .then((measured) => {
      if (measured === null) return;
      offset = measured;
      driftMs = measured;
      driftSnapshot = { driftMs };
      for (const l of [...driftListeners]) l();
      tick();
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function tickInterval(): number {
  return reducedMotionQuery?.matches ? SLOW_TICK_MS : FAST_TICK_MS;
}

function startTicking(): void {
  stopTicking();
  if (isHidden() || nowListeners.size === 0) return;
  tick();
  tickTimer = setInterval(tick, tickInterval());
}

function stopTicking(): void {
  if (tickTimer !== null) clearInterval(tickTimer);
  tickTimer = null;
}

function onVisibility(): void {
  if (isHidden()) {
    stopTicking();
    return;
  }
  startTicking();
  if (deps.now() - lastSyncAt >= VISIBLE_RESYNC_MIN_MS) void syncClock();
}

function onMotionChange(): void {
  if (tickTimer !== null) startTicking();
}

function start(): void {
  if (running) return;
  running = true;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionQuery.addEventListener?.("change", onMotionChange);
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  void syncClock();
  syncTimer = setInterval(() => void syncClock(), SYNC_INTERVAL_MS);
}

function stop(): void {
  if (!running) return;
  running = false;
  stopTicking();
  if (syncTimer !== null) clearInterval(syncTimer);
  syncTimer = null;
  reducedMotionQuery?.removeEventListener?.("change", onMotionChange);
  reducedMotionQuery = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
}

function maybeStop(): void {
  if (nowListeners.size === 0 && driftListeners.size === 0) stop();
  else if (nowListeners.size === 0) stopTicking();
}

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  start();
  if (tickTimer === null) startTicking();
  return () => {
    nowListeners.delete(listener);
    maybeStop();
  };
}

function subscribeDrift(listener: () => void): () => void {
  driftListeners.add(listener);
  start();
  return () => {
    driftListeners.delete(listener);
    maybeStop();
  };
}

/** Server-corrected epoch ms of the last tick (0 during server rendering). */
export function getNow(): number {
  return current;
}

/** Server-corrected epoch ms, re-rendering every 100 ms (1000 ms under reduced motion); paused while hidden. */
export function useNow(): number {
  return useSyncExternalStore(subscribeNow, getNow, () => 0);
}

/** Measured server minus client time. null until the first sync succeeds. Notice when |driftMs| > DRIFT_NOTICE_MS. */
export function useClockDrift(): { driftMs: number | null } {
  return useSyncExternalStore(
    subscribeDrift,
    () => driftSnapshot,
    () => SERVER_DRIFT,
  );
}
const SERVER_DRIFT: { driftMs: number | null } = { driftMs: null };

/** Test hook: inject time sources and reset state. */
export function configureClockForTests(next: Partial<ClockDeps>): void {
  stop();
  nowListeners.clear();
  driftListeners.clear();
  deps = { ...deps, ...next };
  offset = 0;
  driftMs = null;
  driftSnapshot = { driftMs: null };
  current = deps.now();
  lastSyncAt = -Infinity;
}

export function getClockOffset(): number {
  return offset;
}
