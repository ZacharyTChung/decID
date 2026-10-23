"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useApp } from "@/components/providers";
import { api, ClientApiError } from "@/lib/client/api";
import { friendlyReason } from "@/lib/shared/policies";

/**
 * decID Verify business dashboard: what a business sees about its age checks. Signed in with
 * the business's API key (exchanged for an HttpOnly cookie), or, in demo mode, with one click.
 */

interface Overview {
  merchant: { id: string; name: string; kind: string; keyPrefix: string };
  stats: { total: number; verified: number; rejected: number; pending: number; expired: number; medianSecondsToAnswer: number | null; failures: Record<string, number> };
  receipts: { ok: boolean; count: number; head: string; firstBrokenSeq?: number; problem?: string };
  storedFields: string[];
  recent: { id: string; policy: string; reference: string | null; status: string; createdAt: number; completedAt: number | null; result: Record<string, boolean> | null; failureCode: string | null; matchCode: string | null; issuer: { name: string } | null }[];
}

const FIELD_NOTES: Record<string, string> = {
  id: "random request id",
  merchant_id: "you",
  policy: "what you asked",
  reference: "your order or door reference",
  nonce: "one-time challenge",
  audience: "your merchant URN",
  chain_id: "registry network",
  registry: "registry address",
  created_at: "time",
  expires_at: "time",
  status: "outcome",
  failure_code: "why it failed",
  completed_at: "time",
  match_code: "4-letter door code",
  issuer_name: "who vouched",
  receipt_seq: "receipt number",
};

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
  const demoSignIn = async (merchant: "hopline" | "neonhall") => {
    setError(undefined);
    try {
      await api("POST", "/api/demo/business-session", { merchant });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-700 text-xs font-bold text-white" aria-hidden>
              d
            </span>
            decID <span className="text-brand-700">Verify</span>
            <span className="ml-1 text-sm font-normal text-slate-600">for business</span>
          </Link>
          {o && (
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{o.merchant.name}</span>
              <button
                className="text-slate-600 underline"
                onClick={async () => {
                  await api("POST", "/api/business/logout", {});
                  setO(null);
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {o === undefined ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : o === null ? (
          <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h1 className="text-xl font-bold">Sign in to your dashboard</h1>
            <form onSubmit={signIn} className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">API key</span>
                <input id="biz-key" className="rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} placeholder="dk_test_…" autoComplete="off" />
              </label>
              <button className="rounded-xl bg-brand-700 px-4 py-2.5 font-semibold text-white hover:bg-brand-600">Sign in</button>
            </form>
            {app.config?.demo && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <p className="text-sm text-slate-600">Demo businesses:</p>
                <div className="mt-2 flex gap-2">
                  <button className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950" onClick={() => void demoSignIn("hopline")}>
                    Hopline (online)
                  </button>
                  <button className="rounded-xl bg-fuchsia-100 px-3 py-2 text-sm font-semibold text-fuchsia-950" onClick={() => void demoSignIn("neonhall")}>
                    Neon Hall (venue)
                  </button>
                </div>
              </div>
            )}
            {error && <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{o.merchant.name}</h1>
                <p className="text-sm text-slate-600">
                  {o.merchant.kind === "venue" ? "Venue" : "Online store"} · API key {o.merchant.keyPrefix}… · updates live
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">Personal data held: none</span>
            </div>

            <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Summary">
              {[
                ["Age checks", o.stats.total],
                ["Passed", o.stats.verified],
                ["Not old enough", o.stats.failures.POLICY_NOT_SATISFIED ?? 0],
                ["Invalid or fraudulent", o.stats.rejected - (o.stats.failures.POLICY_NOT_SATISFIED ?? 0)],
                ["Median time to answer", o.stats.medianSecondsToAnswer === null ? "–" : `${o.stats.medianSecondsToAnswer}s`],
              ].map(([l, v]) => (
                <div key={l} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <div className="text-3xl font-bold tabular-nums">{v}</div>
                  <div className="text-sm text-slate-600">{l}</div>
                </div>
              ))}
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="font-semibold">Recent checks</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th scope="col" className="py-2 pr-3 font-medium">Time</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Reference</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Answer</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Code</th>
                        <th scope="col" className="py-2 font-medium">Vouched by</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {o.recent.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-600">
                            No checks yet. Run one from the {o.merchant.kind === "venue" ? "Neon Hall door" : "Hopline checkout"}.
                          </td>
                        </tr>
                      )}
                      {o.recent.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 pr-3 tabular-nums text-slate-600">{new Date(r.createdAt * 1000).toLocaleTimeString()}</td>
                          <td className="py-2 pr-3 font-mono text-xs">{r.reference ?? "–"}</td>
                          <td className="py-2 pr-3">
                            {r.status === "verified" ? (
                              <span className="font-semibold text-emerald-700">21+ ✓</span>
                            ) : r.status === "rejected" ? (
                              <span className="font-semibold text-rose-700">{friendlyReason(r.failureCode)}</span>
                            ) : (
                              <span className="text-slate-600">{r.status}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">{r.matchCode ?? "–"}</td>
                          <td className="py-2 text-slate-600">{r.issuer?.name ?? "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="flex flex-col gap-6">
                <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <h2 className="font-semibold">Compliance receipts</h2>
                  <p className="mt-1 text-sm text-slate-600">Every check is signed by decID and chained to the previous one, so the record cannot be edited or trimmed in the middle without detection.</p>
                  <div className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${o.receipts.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                    {o.receipts.ok ? `Chain intact · ${o.receipts.count} signed receipts` : `Chain broken at receipt ${o.receipts.firstBrokenSeq}: ${o.receipts.problem}`}
                  </div>
                  <div className="mt-2 break-all font-mono text-[11px] text-slate-600">head {o.receipts.head}</div>
                </section>
                <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <h2 className="font-semibold">Everything you store per check</h2>
                  <p className="mt-1 text-sm text-slate-600">The complete list of fields in a verification record. None of them can hold a name, birth date, address, ID number or photo.</p>
                  <ul className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                    {o.storedFields.map((f) => (
                      <li key={f} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                        <code>{f}</code>
                        <span className="text-slate-600">{FIELD_NOTES[f] ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
