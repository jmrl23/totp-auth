import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";

/** Narrow single column on the ground colour; full-bleed on phones, centred from `sm`. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="surface-bar pad-safe-top">
        <div className="pad-safe-x">
          <div className="mx-auto flex h-14 w-full max-w-sm items-center">
          <Link href="/" className="rounded-sm">
            <Wordmark />
          </Link>
          </div>
        </div>
      </header>
      <main className="pad-safe-x pad-safe-bottom flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-sm flex-1 pt-8 pb-10 sm:pt-16">{children}</div>
      </main>
    </div>
  );
}

export function AuthHeading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div className="mb-7 space-y-2">
      <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.015em] text-balance">{title}</h1>
      {lead ? <p className="text-[0.9375rem] leading-relaxed text-muted-foreground text-pretty">{lead}</p> : null}
    </div>
  );
}
