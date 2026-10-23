"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";

/**
 * Client side of a demo business's age check. The business's own backend (src/app/api/demo)
 * holds the decID API key and talks to decID Verify; this page only talks to that backend.
 */

export interface CheckStatus {
  status: "pending" | "processing" | "verified" | "rejected" | "expired";
  result: Record<string, boolean> | null;
  failureCode: string | null;
  reason: string;
  matchCode: string | null;
  issuer: { name: string } | null;
  receipt: { valid: boolean; payload?: Record<string, unknown> } | null;
  reference: string | null;
}

export interface Check {
  id: string;
  walletUrl: string;
  qrSvg: string;
  expiresAt: number;
}

/** Inside the demo stage, ask the stage to open the wallet in its phone frame. */
export function openWallet(url: string) {
  const path = new URL(url).pathname;
  if (window.parent !== window) {
    window.parent.postMessage({ type: "decid:open-wallet", path }, window.location.origin);
  } else {
    window.open(path, "_blank", "noopener");
  }
}

export function useAgeCheck(merchant: "hopline" | "neonhall") {
  const [check, setCheck] = useState<Check>();
  const [status, setStatus] = useState<CheckStatus>();
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
  };

  const start = useCallback(
    async (reference?: string) => {
      stop();
      setError(undefined);
      setStatus(undefined);
      // Drop the previous QR code at once: it belongs to an answered request, and a phone that
      // scanned it in the gap would be told "already answered".
      setCheck(undefined);
      try {
        const c = await api<Check>("POST", `/api/demo/${merchant}/sessions`, reference ? { reference } : {});
        setCheck(c);
        timer.current = setInterval(async () => {
          try {
            const s = await api<CheckStatus>("GET", `/api/demo/${merchant}/sessions/${c.id}`);
            setStatus(s);
            if (s.status !== "pending" && s.status !== "processing") stop();
          } catch (e) {
            setError((e as Error).message);
            stop();
          }
        }, 1000);
        return c;
      } catch (e) {
        setError((e as Error).message);
        return undefined;
      }
    },
    [merchant],
  );

  useEffect(() => stop, []);
  const reset = () => {
    stop();
    setCheck(undefined);
    setStatus(undefined);
  };
  return { check, status, error, start, reset };
}
