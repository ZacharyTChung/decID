"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useApp } from "@/components/providers";
import { api, ClientApiError } from "@/lib/client/api";
import { DecidWordmark } from "@/components/product/brand";
import { HOPLINE, NEON_HALL, brandFor } from "@/components/product/merchant";
import { VerifyDashboard, type CheckRow } from "@/components/product/verify-dashboard";
import type { CheckStatus } from "@/components/product/dashboard";

/**
 * decID Verify business dashboard: what a business sees about its age checks. Signed in with
 * the business's API key (exchanged for an HttpOnly cookie), or, in demo mode, with one click.
 */

interface Overview {
  merchant: { id: string; name: string; kind: "online" | "venue"; keyPrefix: string };
  stats: { total: number; verified: number; rejected: number; pending: number; expired: number; medianSecondsToAnswer: number | null; failures: Record<string, number> };
  receipts: { ok: boolean; count: number; head: string; firstBrokenSeq?: number; problem?: string };
  storedFields: string[];
  recent: { id: string; reference: string | null; status: CheckStatus; createdAt: number; completedAt: number | null; result: Record<string, boolean> | null; failureCode: string | null; matchCode: string | null; issuer: { name: string } | null }[];
}

export default function Business() {
  const app = useApp();
  const [o, setO] = useState<Overview | null>();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setO(await api<Overview>("GET", "/api/business/overview"));
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 401) setO(null);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      await api("POST", "/api/business/session", { apiKey: key.trim() });
      setKey("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const demoSignIn = async (merchant: string) => {
    setError(undefined);
    try {
      await api("POST", "/api/demo/business-session", { merchant });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (o === undefined) return <div className="min-h-dvh bg-ink-2" />;

  if (o === null) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-2 px-4 font-sans text-ink-12">
        <div className="w-full max-w-sm">
          <DecidWordmark product="Verify" />
          <div className="mt-6 rounded-md border border-ink-5 bg-white p-6">
            <h1 className="text-h3 font-medium">Sign in</h1>
            <p className="mt-1 text-ui text-ink-10">Use your business’s API key.</p>
            <form onSubmit={signIn} className="mt-5 flex flex-col gap-3">
              <label htmlFor="biz-key" className="text-ui font-medium">
                API key
              </label>
              <input id="biz-key" className="h-9 rounded-sm border border-ink-6 px-3 font-mono text-ui outline-none focus:border-accent" value={key} onChange={(e) => setKey(e.target.value)} placeholder="dk_test_…" autoComplete="off" />
              <button className="press mt-1 h-9 rounded-sm bg-ink-12 text-ui font-medium text-white hover:bg-ink-11">Sign in</button>
            </form>
            {app.config?.demo && (
              <div className="mt-6 border-t border-ink-5 pt-4">
                <p className="text-ui text-ink-10">Demo businesses</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[HOPLINE, NEON_HALL].map((m) => (
                    <button key={m.id} onClick={() => void demoSignIn(m.id)} className="press h-9 rounded-sm border border-ink-6 text-ui font-medium hover:bg-ink-2">
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <p className="mt-3 text-ui text-bad" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const rows: CheckRow[] = o.recent.filter((r) => r.status !== "pending").map((r) => ({ id: r.id, reference: r.reference, status: r.status, failureCode: r.failureCode, matchCode: r.matchCode, issuerName: r.issuer?.name ?? null, createdAt: r.createdAt, completedAt: r.completedAt }));
  const merchant = brandFor(o.merchant.id, o.merchant.name, o.merchant.kind);
  return (
    <div className="flex min-h-dvh flex-col bg-ink-1">
      <VerifyDashboard
        className="flex-1"
        merchant={merchant}
        merchants={[merchant]}
        onMerchant={() => undefined}
        keyHint={`${o.merchant.keyPrefix}…`}
        stats={o.stats}
        checks={rows}
        chain={o.receipts}
        storedFields={o.storedFields}
        now={Math.floor(Date.now() / 1000)}
        loadCheck={async (id) => {
          const r = o.recent.find((x) => x.id === id)!;
          return { ...rows.find((x) => x.id === id)!, answer: r.result ? Object.values(r.result)[0]! : null, receipt: null };
        }}
        accountMenu={
          <button
            className="mt-2 text-meta text-ink-10 underline underline-offset-2"
            onClick={async () => {
              await api("POST", "/api/business/logout", {});
              setO(null);
            }}
          >
            Sign out
          </button>
        }
      />
    </div>
  );
}
