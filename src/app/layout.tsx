import type { Metadata } from "next";
import { connection } from "next/server";
import { AppProviders } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decentralized Identity MVP",
  description: "Prototype of a privacy-conscious credential flow. Synthetic data, local chain only.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request so the CSP nonce from src/proxy.ts is fresh for every response.
  await connection();
  return (
    <html lang="en">
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
