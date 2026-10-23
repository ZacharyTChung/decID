import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce (Next.js "proxy", formerly middleware).
 *
 * Scripts must carry this request's nonce ('strict-dynamic' then extends trust to the
 * chunks they load), so injected inline scripts cannot run: there is no 'unsafe-inline'.
 * Next.js reads the nonce from the request's CSP header and stamps it on its own scripts;
 * the root layout renders dynamically (connection()) so every response gets a fresh one.
 *
 * connect-src allows the app itself and the local JSON-RPC node (read-only status when the
 * wallet is not on the local chain). Wallet transactions go through the extension, which
 * page CSP does not govern. Development additionally needs 'unsafe-eval' (React debugging)
 * and websockets (hot reload).
 */
export function proxy(request: NextRequest) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const isDev = process.env.NODE_ENV === "development";
  let rpcOrigin = "http://127.0.0.1:8545";
  try {
    rpcOrigin = new URL(process.env.RPC_URL || rpcOrigin).origin;
  } catch {
    // keep the default
  }

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${rpcOrigin}${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Same-origin framing only: the demo stage (/demo) shows the phone and the business side by side.
    "frame-ancestors 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes return JSON with their own deny-all CSP (next.config.ts).
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
