import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
        ],
      },
    ];
  },
};

export default nextConfig;
