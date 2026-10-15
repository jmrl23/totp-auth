"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon } from "lucide-react";
import { parseOtpauthUri, startQrScan } from "@/lib/client";
import type { EntryPlain } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** startQrScan rejects with QrScanError, whose message is already specific (permission, no camera, https). */
function cameraError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "The camera could not be started. Try again.";
}

/**
 * Camera QR scan. The camera starts only when the person presses Start camera, and the stream
 * stops on success, on Stop, and whenever this panel unmounts (tab change or sheet closed).
 */
export function ScanPanel({ onParsed }: { onParsed: (plain: EntryPlain) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef(true);
  const [status, setStatus] = useState<"idle" | "starting" | "scanning">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, []);

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    setStatus("idle");
  }

  async function start() {
    setError(null);
    const video = videoRef.current;
    if (!video) return;
    setStatus("starting");
    try {
      const stopScan = await startQrScan(video, (text: string) => {
        try {
          const plain = parseOtpauthUri(text);
          stopRef.current?.();
          stopRef.current = null;
          if (aliveRef.current) {
            setStatus("idle");
            onParsed(plain);
          }
        } catch (err) {
          if (aliveRef.current) {
            setError(err instanceof Error ? err.message : "That QR code is not a TOTP setup code.");
          }
        }
      });
      if (!aliveRef.current) {
        stopScan();
        return;
      }
      stopRef.current = stopScan;
      setStatus("scanning");
    } catch (err) {
      if (aliveRef.current) {
        setStatus("idle");
        setError(cameraError(err));
      }
    }
  }

  const live = status !== "idle";
  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-foreground sm:aspect-video">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className={cn("size-full object-cover", !live && "invisible")}
        />
        {!live ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-background">
            <CameraIcon aria-hidden="true" className="size-7" />
            <p className="max-w-[18rem] text-[0.9375rem]">
              Point the camera at the QR code the service shows when you turn on two-factor sign-in.
            </p>
          </div>
        ) : (
          <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-sm border-2 border-background" />
        )}
      </div>
      <div aria-live="polite">
        {status === "scanning" ? <p className="text-sm text-muted-foreground">Looking for a QR code...</p> : null}
        {error ? <p className="text-[0.9375rem] font-medium text-destructive">{error}</p> : null}
      </div>
      {live ? (
        <Button type="button" variant="outline" className="w-full" onClick={stop}>
          Stop camera
        </Button>
      ) : (
        <Button type="button" className="w-full" onClick={() => void start()}>
          <CameraIcon aria-hidden="true" />
          Start camera
        </Button>
      )}
    </div>
  );
}
