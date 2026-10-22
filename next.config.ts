import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
// The browser talks to the app and (for read-only status when no wallet is on the right chain) to the
// local JSON-RPC node. Wallet transactions go through the wallet extension, which CSP does not govern.
const rpcOrigin = new URL(process.env.RPC_URL || "http://127.0.0.1:8545").origin;

// Next.js injects inline bootstrap scripts, so 'unsafe-inline' is needed without a nonce setup;
// dev mode additionally needs 'unsafe-eval' for fast refresh.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${rpcOrigin}${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // The headless demo runs its own dev server with a separate build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native/ESM server dependencies stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "@digitalbazaar/did-method-key", "@digitalbazaar/ed25519-multikey"],
  // No browser source maps in production builds (nothing server-side should leak through them anyway).
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
