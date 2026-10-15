"use client";

declare global {
  // Read by get-nonce (react-remove-scroll / react-style-singleton) for the <style> tags it injects.
  var __webpack_nonce__: string | undefined;
}

/**
 * The nonce of the CSP this document was served with, taken from Next's own nonced scripts.
 * Read from the DOM rather than from props: router.refresh() re-renders the layout under a new
 * request (and a new nonce), but the document keeps the CSP of its first load.
 */
export function getCspNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  globalThis.__webpack_nonce__ ??= document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || undefined;
  return globalThis.__webpack_nonce__;
}

/**
 * Makes the CSP nonce available to client libraries that inject <style> tags
 * (react-remove-scroll via get-nonce, Radix Select's viewport style). Renders nothing.
 */
export function CspNonce() {
  getCspNonce();
  return null;
}
