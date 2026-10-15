"use client";

import Link from "next/link";
import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <AuthFrame>
      <AuthHeading
        title="Something went wrong"
        lead="This page failed to load. Your vault and its data are not affected. Try again, or reload the app."
      />
      <div className="flex flex-col gap-2">
        <Button size="lg" className="w-full" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild size="lg" variant="outline" className="w-full">
          <Link href="/">Reload the app</Link>
        </Button>
      </div>
      {error.digest ? (
        <p className="tnum mt-6 text-sm text-muted-foreground">Reference for the server log: {error.digest}</p>
      ) : null}
    </AuthFrame>
  );
}
