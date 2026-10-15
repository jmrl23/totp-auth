"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Announce = (message: string) => void;

const AnnouncerContext = createContext<Announce>(() => {});

/**
 * One polite live region for the whole screen. `announce` re-sets the text so the same
 * message ("Copied GitHub code") is read again on a second copy.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const seq = useRef(0);

  const announce = useCallback<Announce>((next) => {
    seq.current += 1;
    // Alternate a trailing no-break space so identical messages still change the DOM text.
    setMessage(seq.current % 2 === 0 ? next : `${next} `);
  }, []);

  const value = useMemo(() => announce, [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="true" role="status" className="sr-only">
        {message}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}
