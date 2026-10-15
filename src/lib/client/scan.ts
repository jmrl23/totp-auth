/**
 * Camera QR scanning with jsQR: back camera, downscaled frames, about 8 decodes per second.
 */
import jsQR from "jsqr";

export type QrScanErrorCode = "permission_denied" | "no_camera" | "camera_in_use" | "unsupported" | "insecure_context" | "unknown";

export class QrScanError extends Error {
  override name = "QrScanError";
  constructor(
    readonly code: QrScanErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<QrScanErrorCode, string> = {
  permission_denied: "Camera access was blocked. Allow the camera for this site in your browser settings, or paste the link instead.",
  no_camera: "No camera was found on this device. Paste the link or enter the secret instead.",
  camera_in_use: "The camera is in use by another app. Close it and try again.",
  unsupported: "This browser cannot use the camera here. Paste the link or enter the secret instead.",
  insecure_context: "The camera only works over HTTPS. Open this site over HTTPS, or paste the link instead.",
  unknown: "The camera could not be started. Paste the link or enter the secret instead.",
};

function scanError(code: QrScanErrorCode): QrScanError {
  return new QrScanError(code, MESSAGES[code]);
}

function mapMediaError(error: unknown): QrScanError {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return scanError("permission_denied");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return scanError("no_camera");
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return scanError("camera_in_use");
  }
  return scanError("unknown");
}

const SCAN_INTERVAL_MS = 125; // ~8 fps
const MAX_SIDE = 640;

/**
 * Start the camera into `video` and call `onResult` with each newly decoded QR text.
 * Resolves to `stop()`, which always stops every camera track. Rejects with QrScanError.
 */
export async function startQrScan(video: HTMLVideoElement, onResult: (text: string) => void): Promise<() => void> {
  if (typeof window !== "undefined" && window.isSecureContext === false) throw scanError("insecure_context");
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw scanError("unsupported");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    throw mapMediaError(error);
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: string | null = null;
  const stop = () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const track of stream.getTracks()) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };

  try {
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    stop();
    throw mapMediaError(error);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    stop();
    throw scanError("unsupported");
  }

  const scan = () => {
    if (stopped) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w > 0 && h > 0) {
      const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      const cw = Math.round(w * scale);
      const ch = Math.round(h * scale);
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      ctx.drawImage(video, 0, 0, cw, ch);
      const { data } = ctx.getImageData(0, 0, cw, ch);
      const result = jsQR(data, cw, ch, { inversionAttempts: "dontInvert" });
      if (result?.data && result.data !== last) {
        last = result.data;
        try {
          onResult(result.data);
        } catch {
          // Callback errors must not stop the camera loop.
        }
      }
    }
    if (!stopped) timer = setTimeout(scan, SCAN_INTERVAL_MS);
  };
  timer = setTimeout(scan, SCAN_INTERVAL_MS);
  return stop;
}
