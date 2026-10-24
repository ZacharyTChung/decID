"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgeCheck } from "@/components/product/checkout";
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
  userVerified: boolean | null;
  risk: { kind: string; severity: "high" | "medium" | "low"; title: string; detail: string; action: string }[];
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
  const [requireUnlock, setRequireUnlock] = useState(false);
  const requireRef = useRef(false);
  requireRef.current = requireUnlock;

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
  };

  const inFlight = useRef(false);
  const start = useCallback(
    async (reference?: string) => {
      // One request at a time: a door asking for "the next guest" twice must not open two checks.
      if (inFlight.current) return undefined;
      inFlight.current = true;
      stop();
      setError(undefined);
      setStatus(undefined);
      // Drop the previous QR code at once: it belongs to an answered request, and a phone that
      // scanned it in the gap would be told "already answered".
      setCheck(undefined);
      try {
        const c = await api<Check>("POST", `/api/demo/${merchant}/sessions`, { ...(reference ? { reference } : {}), ...(requireRef.current ? { requireUserVerification: true } : {}) });
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
      } finally {
        inFlight.current = false;
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
  return { check, status, error, start, reset, requireUnlock, setRequireUnlock };
}

/** The shared checkout and door UI (src/components/product) read an AgeCheck; this adapts the HTTP flow. */
export function useHttpAgeCheck(merchant: "hopline" | "neonhall"): AgeCheck {
  const { check, status, error, start, reset, requireUnlock, setRequireUnlock } = useAgeCheck(merchant);
  const begin = useCallback((reference: string) => void start(reference), [start]);
  const done = status && (status.status === "verified" || status.status === "rejected");
  const p = status?.receipt?.payload as { policy?: string; outcome?: string; seq?: number } | undefined;
  const received = useMemo(
    () => (done ? { result: status.result, issuer: status.issuer, userVerified: status.userVerified, risk: status.risk.map((r) => r.title), receipt: status.receipt ? { valid: status.receipt.valid, policy: p?.policy, outcome: p?.outcome, seq: p?.seq } : null } : undefined),
    [done, status, p],
  );
  return {
    id: check?.id,
    status: check ? (status?.status ?? "pending") : undefined,
    failureCode: status?.failureCode,
    matchCode: status?.matchCode,
    issuerName: status?.issuer?.name,
    received,
    qrSvg: check?.qrSvg,
    walletUrl: check?.walletUrl,
    error,
    userVerified: status?.userVerified,
    risk: status?.risk,
    requireUnlock,
    setRequireUnlock,
    start: begin,
    reset,
    open: () => check && openWallet(check.walletUrl),
  };
}
