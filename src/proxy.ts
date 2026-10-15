import { NextResponse, type NextRequest } from "next/server";

/**
 * Hashes of the fixed stylesheets that libraries inject at runtime as <style> elements without a
 * nonce (they offer no nonce option). Allowing these exact hashes keeps style-src strict (no
 * 'unsafe-inline'). Recompute after upgrading sonner or vaul; e2e/07-console.spec.ts checks them.
 * - empty string: sonner and vaul append an empty <style> first, then fill it
 * - sonner 2.0.8 toast stylesheet
 * - vaul 1.1.2 drawer stylesheet
 */
export const STYLE_HASHES = [
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
  "'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='",
  "'sha256-YIjArHm2rkb5J7hX9lUM1bnQ3Kp61MTfluMGkuyKwDw='",
];

/** Builds the strict nonce CSP from docs/ARCHITECTURE.md section 11. */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}' ${STYLE_HASHES.join(" ")}${isDev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function securityHeaders(isHttps: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  };
  if (isHttps) h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return h;
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = buildCsp(nonce, isDev);

  // Next reads the nonce from the request CSP header during rendering and applies it to its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  const isHttps = (process.env.APP_ORIGIN ?? "").startsWith("https://");
  for (const [k, v] of Object.entries(securityHeaders(isHttps))) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes set their own no-store headers in route(); static assets need no CSP.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
