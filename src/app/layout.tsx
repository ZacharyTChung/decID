import type { Metadata } from "next";
import { connection } from "next/server";
import { AppProviders } from "@/components/providers";
// Self-hosted fonts (the CSP allows fonts from this origin only).
import "@fontsource/ibm-plex-sans/400";
import "@fontsource/ibm-plex-sans/500";
import "@fontsource/ibm-plex-sans/600";
import "@fontsource/ibm-plex-mono/400";
import "@fontsource/ibm-plex-mono/500";
import "@fontsource-variable/archivo/wdth";
import "@fontsource-variable/big-shoulders-display";
import "./globals.css";

export const metadata: Metadata = {
  title: "decID",
  description: "Prove you’re 21. Nothing else. Reusable, privacy-preserving age verification (prototype: synthetic data, local chain).",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request so the CSP nonce from src/proxy.ts is fresh for every response.
  await connection();
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
