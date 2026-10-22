import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decentralized Identity MVP",
  description: "Prototype of a privacy-conscious credential flow. Synthetic data, local chain only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
