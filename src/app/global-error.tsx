"use client";

import { Inter_Tight } from "next/font/google";
import { Wordmark } from "@/components/brand/wordmark";
import "./globals.css";

const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"], display: "swap" });

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body className="min-h-dvh">
        <title>Something went wrong - totp-auth</title>
        <header className="surface-bar pad-safe-top">
          <div className="pad-safe-x mx-auto flex h-14 max-w-sm items-center sm:px-0">
            <Wordmark />
          </div>
        </header>
        <main className="pad-safe-x mx-auto max-w-sm pt-8 sm:pt-16">
          <h1 className="text-[1.75rem] leading-tight font-bold">totp-auth could not start</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            The app hit an error before it could load. Your vault is stored encrypted and is not affected.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Try again
          </button>
          {error.digest ? (
            <p className="tnum mt-6 text-sm text-muted-foreground">Reference for the server log: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
