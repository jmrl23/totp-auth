import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_LOCK_DEFAULTS, createAutoLockController, shouldLock } from "./auto-lock";

const MIN = 60_000;
const cfg = AUTO_LOCK_DEFAULTS;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("shouldLock", () => {
  it("locks after idleMinutes without activity", () => {
    const t0 = Date.now();
    const s = { lastActivityAt: t0, hiddenSince: null };
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(shouldLock(s, Date.now(), cfg)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldLock(s, Date.now(), cfg)).toBe(true);
  });

  it("locks after hiddenMinutes hidden", () => {
    const t0 = Date.now();
    const s = { lastActivityAt: t0, hiddenSince: t0 };
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(shouldLock(s, Date.now(), cfg)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldLock(s, Date.now(), cfg)).toBe(true);
  });

  it("activity in another tab restarts the hidden timer", () => {
    const t0 = Date.now();
    const s = { lastActivityAt: t0 + 4 * MIN, hiddenSince: t0 };
    expect(shouldLock(s, t0 + 8 * MIN, cfg)).toBe(false);
    expect(shouldLock(s, t0 + 9 * MIN, cfg)).toBe(true);
  });

  it("a zero setting disables that rule", () => {
    const s = { lastActivityAt: 0, hiddenSince: 0 };
    expect(shouldLock(s, 999 * MIN, { idleMinutes: 0, hiddenMinutes: 0 })).toBe(false);
  });
});

describe("createAutoLockController", () => {
  it("locks once after idle, and activity postpones it", () => {
    const onLock = vi.fn();
    const c = createAutoLockController({ config: cfg, onLock });
    vi.advanceTimersByTime(9 * MIN);
    c.activity();
    vi.advanceTimersByTime(9 * MIN);
    c.check();
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1 * MIN);
    c.check();
    c.check();
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("locks on wake after a long sleep, before counting the wake-up key press", () => {
    const onLock = vi.fn();
    const c = createAutoLockController({ config: cfg, onLock });
    vi.setSystemTime(Date.now() + 60 * MIN); // laptop slept: no timers fired
    expect(c.activity()).toBe(false);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("evaluates on visibilitychange so a long-hidden tab locks when shown", () => {
    const onLock = vi.fn();
    const c = createAutoLockController({ config: { idleMinutes: 60, hiddenMinutes: 5 }, onLock });
    c.visibility(true);
    vi.advanceTimersByTime(6 * MIN);
    c.visibility(false);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("does not lock a briefly hidden tab and resets on show", () => {
    const onLock = vi.fn();
    const c = createAutoLockController({ config: { idleMinutes: 60, hiddenMinutes: 5 }, onLock });
    c.visibility(true);
    vi.advanceTimersByTime(4 * MIN);
    c.visibility(false);
    expect(c.state.hiddenSince).toBeNull();
    vi.advanceTimersByTime(4 * MIN);
    c.check();
    expect(onLock).not.toHaveBeenCalled();
  });

  it("remote activity keeps a hidden tab unlocked", () => {
    const onLock = vi.fn();
    const c = createAutoLockController({ config: cfg, onLock, hidden: true });
    vi.advanceTimersByTime(4 * MIN);
    c.remoteActivity();
    vi.advanceTimersByTime(4 * MIN);
    c.check();
    expect(onLock).not.toHaveBeenCalled();
  });

  it("throttles broadcasts to once per 10 s", () => {
    const c = createAutoLockController({ config: cfg, onLock: vi.fn() });
    expect(c.activity()).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(c.activity()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(c.activity()).toBe(true);
  });
});
