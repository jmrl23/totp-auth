"use client";

/**
 * Copies text to the clipboard. Uses the async Clipboard API in secure contexts and falls back
 * to a hidden textarea + execCommand for plain-http self-hosted instances.
 * Resolves true when the copy most likely succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    // CSSOM writes are allowed under the strict style-src CSP (no style attribute is parsed).
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    area.style.opacity = "0";
    const active = document.activeElement as HTMLElement | null;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    active?.focus({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}
