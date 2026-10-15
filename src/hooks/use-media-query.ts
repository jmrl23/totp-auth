"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. The server snapshot is `serverValue`
 * (mobile-first: false for min-width queries), so phones never flash the desktop layout.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Matches Tailwind's `md` breakpoint (48rem). */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 48rem)");
}
