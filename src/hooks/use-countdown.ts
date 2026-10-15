"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A one-off countdown for rate-limit waits (`Retry-After`). Runs a timer only while counting.
 * `secondsLeft` is 0 when idle.
 */
export function useCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(
    (seconds: number) => {
      clear();
      const total = Math.max(1, Math.ceil(seconds));
      const end = Date.now() + total * 1000;
      setSecondsLeft(total);
      timer.current = window.setInterval(() => {
        const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left === 0) clear();
      }, 250);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return { secondsLeft, start };
}
