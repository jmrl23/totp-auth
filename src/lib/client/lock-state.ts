"use client";
/**
 * Lock state machine shared by every component in a tab, mirrored across tabs via BroadcastChannel.
 * checking -> signed-out | locked | unlocked. The unlocked vault key lives in memory here.
 */
import { useSyncExternalStore } from "react";
import type { SessionResponse } from "@/lib/schemas";
import { api, isApiError } from "./api";
import { keyStore } from "./key-store";
import { emitSessionEvent, onSessionEvent } from "./session-events";
import type { LockState } from "./types";

type Snapshot = { state: LockState; key: CryptoKey | null; userId: string | null };

let snapshot: Snapshot = { state: "checking", key: null, userId: null };
let generation = 0;
let started = false;
let refreshing: Promise<LockState> | null = null;
const listeners = new Set<() => void>();

/** Session loader; QueryProvider swaps in one that shares the TanStack cache. Returns null on 401. */
type SessionLoader = () => Promise<SessionResponse | null>;
async function defaultSessionLoader(): Promise<SessionResponse | null> {
  try {
    return await api.getSession();
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}
let sessionLoader: SessionLoader = defaultSessionLoader;

export function setSessionLoader(loader: SessionLoader | null): void {
  sessionLoader = loader ?? defaultSessionLoader;
}

function setSnapshot(next: Snapshot): void {
  generation++;
  if (next.state === snapshot.state && next.key === snapshot.key && next.userId === snapshot.userId) return;
  snapshot = next;
  for (const l of [...listeners]) l();
}

export function getLockState(): LockState {
  return snapshot.state;
}

/** The unlocked vault key, or null when locked/signed out. */
export function getVaultKey(): CryptoKey | null {
  return snapshot.state === "unlocked" ? snapshot.key : null;
}

export function getUnlockedUserId(): string | null {
  return snapshot.state === "unlocked" ? snapshot.userId : null;
}

/* ---------- cross-tab ---------- */

type TabMessage = { type: "lock" } | { type: "logout" } | { type: "unlock" };
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  try {
    channel = new BroadcastChannel("totp-auth");
    channel.onmessage = (event: MessageEvent<TabMessage>) => {
      const type = event.data?.type;
      if (type === "lock") {
        setSnapshot({ state: "locked", key: null, userId: snapshot.userId });
        emitSessionEvent("locked");
      } else if (type === "logout") {
        setSnapshot({ state: "signed-out", key: null, userId: null });
        emitSessionEvent("signed-out");
      } else if (type === "unlock") {
        void refreshLockState().then(() => emitSessionEvent("session-changed"));
      }
    };
  } catch {
    channel = null;
  }
  return channel;
}

function broadcast(message: TabMessage): void {
  try {
    getChannel()?.postMessage(message);
  } catch {
    // Other tabs will catch up on their next refresh.
  }
}

/* ---------- transitions ---------- */

/** Re-read session + stored key and settle the state. Concurrent calls share one run. */
export function refreshLockState(): Promise<LockState> {
  if (refreshing) return refreshing;
  const gen = generation;
  const run = (async (): Promise<LockState> => {
    let session: SessionResponse | null;
    try {
      session = await sessionLoader();
    } catch {
      // Offline or server error: trust whatever key this browser holds.
      const stored = snapshot.key ? null : await keyStore.load();
      if (gen !== generation) return snapshot.state;
      if (snapshot.key) return snapshot.state;
      const next: Snapshot = stored
        ? { state: "unlocked", key: stored.key, userId: stored.userId }
        : { state: "locked", key: null, userId: null };
      setSnapshot(next);
      return next.state;
    }
    if (!session) {
      await keyStore.clear();
      if (gen === generation) setSnapshot({ state: "signed-out", key: null, userId: null });
      return snapshot.state;
    }
    const userId = session.user.id;
    if (snapshot.key && snapshot.userId === userId) {
      if (gen === generation) setSnapshot({ state: "unlocked", key: snapshot.key, userId });
      return snapshot.state;
    }
    const stored = await keyStore.load();
    if (gen !== generation) return snapshot.state;
    if (stored && stored.userId === userId) {
      setSnapshot({ state: "unlocked", key: stored.key, userId });
    } else {
      if (stored) await keyStore.clear();
      if (gen !== generation) return snapshot.state;
      setSnapshot({ state: "locked", key: null, userId });
    }
    return snapshot.state;
  })();
  refreshing = run.finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Called by the auth flows once the server accepted the final step. */
export async function setUnlocked(key: CryptoKey, user: { id: string; username: string }): Promise<void> {
  await keyStore.save({ key, userId: user.id, username: user.username });
  setSnapshot({ state: "unlocked", key, userId: user.id });
  broadcast({ type: "unlock" });
  emitSessionEvent("session-changed");
}

export async function setLocked(): Promise<void> {
  setSnapshot({ state: "locked", key: null, userId: snapshot.userId });
  await keyStore.clear();
  broadcast({ type: "lock" });
  emitSessionEvent("locked");
}

export async function setSignedOut(): Promise<void> {
  setSnapshot({ state: "signed-out", key: null, userId: null });
  await keyStore.clear();
  broadcast({ type: "logout" });
  emitSessionEvent("signed-out");
}

// A 401 from any authenticated call drops the key in this tab.
onSessionEvent((event) => {
  if (event === "signed-out" && snapshot.state !== "signed-out") {
    setSnapshot({ state: "signed-out", key: null, userId: null });
    void keyStore.clear();
  }
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    getChannel();
    void refreshLockState();
  }
  return () => listeners.delete(listener);
}

const getServerSnapshot = (): LockState => "checking";

/** Current lock state; updates on lock/logout/sign-in in this tab and on lock/logout in other tabs. */
export function useLockState(): LockState {
  return useSyncExternalStore(subscribe, getLockState, getServerSnapshot);
}

/** Subscribe outside React (used by the query layer). */
export function subscribeLockState(listener: () => void): () => void {
  return subscribe(listener);
}

/** Test hook. */
export function resetLockStateForTests(): void {
  snapshot = { state: "checking", key: null, userId: null };
  generation++;
  started = false;
  refreshing = null;
  listeners.clear();
  sessionLoader = defaultSessionLoader;
  channel?.close();
  channel = null;
}
