"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { openWallet, useAgeCheck } from "@/components/demo/use-age-check";

/**
 * Hopline: a DEMO online drinks shop that uses decID Verify for its 21+ checkout. Everything
 * Hopline knows about the customer's age comes from its own backend's call to decID
 * (src/app/api/demo/[merchant]), which this page shows verbatim.
 */

const PRODUCTS = [
  { id: "lager", name: "Dusk Lager", detail: "6 × 330 ml · 4.6%", price: 14, alcohol: true, swatch: "bg-amber-400" },
  { id: "cider", name: "Orchard Cider", detail: "4 × 440 ml · 5.0%", price: 12, alcohol: true, swatch: "bg-lime-500" },
  { id: "rye", name: "Rye Pale Ale", detail: "6 × 330 ml · 5.4%", price: 16, alcohol: true, swatch: "bg-orange-600" },
  { id: "yuzu", name: "Sparkling Yuzu", detail: "6 × 330 ml · alcohol-free", price: 9, alcohol: false, swatch: "bg-yellow-300" },
];

export default function Shop() {
  const [cart, setCart] = useState<Record<string, number>>({ lager: 1, yuzu: 1 });
  // Created after mount: a random number during render would differ between server and browser.
  const [orderRef, setOrderRef] = useState("HL-…");
  useEffect(() => setOrderRef(`HL-${Math.floor(1000 + Math.random() * 9000)}`), []);
  const [showLegacy, setShowLegacy] = useState(false);
  const { check, status, error, start, reset } = useAgeCheck("hopline");
  const lines = PRODUCTS.filter((p) => cart[p.id]);
  const total = lines.reduce((s, p) => s + p.price * (cart[p.id] ?? 0), 0);
  const needsAge = lines.some((p) => p.alcohol);
  const verified = status?.status === "verified";
  const refused = status?.status === "rejected";
  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));
  const receipt = status?.receipt?.payload as { policy?: string; outcome?: string; checkedAt?: string; seq?: number; issuer?: { name: string } } | undefined;
  const received = useMemo(() => (status ? { result: status.result, issuer: status.issuer, receipt: status.receipt ? { valid: status.receipt.valid, policy: receipt?.policy, outcome: receipt?.outcome, seq: receipt?.seq } : null } : null), [status, receipt]);

  return (
    <div className="min-h-dvh bg-[#fbf7f0] text-[#2b1d12]">
      <header className="border-b border-[#ead9c2] bg-[#2b1d12] text-[#fbf7f0]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2 text-xl font-black tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-[#2b1d12]" aria-hidden>
              H
            </span>
            Hopline
            <span className="ml-2 hidden text-xs font-medium text-[#d9c3a5] sm:inline">small-batch drinks, delivered</span>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs">Demo shop · not a real store</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[1fr_380px]">
        <section aria-label="Products">
          <h1 className="text-2xl font-black">This week’s picks</h1>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PRODUCTS.map((p) => (
              <article key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ead9c2]">
                <div className={`h-14 w-10 rounded-lg ${p.swatch}`} aria-hidden />
                <div className="flex-1">
                  <div className="font-bold">{p.name}</div>
                  <div className="text-xs text-[#7a6250]">{p.detail}</div>
                  <div className="mt-1 text-sm font-semibold">${p.price}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button aria-label={`Remove one ${p.name}`} className="h-8 w-8 rounded-full ring-1 ring-[#ead9c2]" onClick={() => add(p.id, -1)} disabled={!!check}>
                    −
                  </button>
                  <span className="w-5 text-center text-sm tabular-nums">{cart[p.id] ?? 0}</span>
                  <button aria-label={`Add one ${p.name}`} className="h-8 w-8 rounded-full bg-[#2b1d12] text-white" onClick={() => add(p.id, 1)} disabled={!!check}>
                    +
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-4" aria-label="Checkout">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ead9c2]">
            <h2 className="font-black">Order {orderRef}</h2>
            <ul className="mt-2 text-sm">
              {lines.map((p) => (
                <li key={p.id} className="flex justify-between py-0.5">
                  <span>
                    {cart[p.id]} × {p.name} {p.alcohol && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-900">21+</span>}
                  </span>
                  <span className="tabular-nums">${p.price * (cart[p.id] ?? 0)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-[#ead9c2] pt-2 font-bold">
              <span>Total</span>
              <span className="tabular-nums">${total}</span>
            </div>
          </section>

          {!needsAge ? (
            <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-[#ead9c2]">No age check needed: nothing in your cart is alcoholic.</section>
          ) : verified ? (
            <section className="rounded-2xl bg-emerald-600 p-5 text-white shadow-sm" aria-live="polite">
              <div className="text-2xl font-black">Order confirmed ✓</div>
              <p className="mt-1 text-sm text-emerald-50">Age confirmed with decID. {orderRef} ships today.</p>
            </section>
          ) : (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ead9c2]">
              <h2 className="font-black">Age check required</h2>
              <p className="mt-1 text-sm text-[#7a6250]">US law requires us to confirm you are 21+ before selling alcohol.</p>
              {!check ? (
                <button onClick={() => void start(orderRef)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a5c55] px-4 py-3 font-semibold text-white hover:bg-[#0b6e65]">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-white text-[11px] font-black text-[#0a5c55]" aria-hidden>
                    d
                  </span>
                  Verify age with decID
                </button>
              ) : refused ? (
                <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-900" aria-live="polite">
                  <b>We can’t sell alcohol on this order.</b> {status?.reason}. Remove the 21+ items to continue, or{" "}
                  <button className="underline" onClick={() => void start(orderRef)}>
                    try again
                  </button>
                  .
                </div>
              ) : status?.status === "expired" ? (
                <div className="mt-4 text-sm">
                  The check expired.{" "}
                  <button className="font-semibold underline" onClick={() => void start(orderRef)}>
                    Start again
                  </button>
                </div>
              ) : (
                <div className="mt-4 grid gap-3" aria-live="polite">
                  <button onClick={() => openWallet(check.walletUrl)} className="rounded-xl bg-[#0a5c55] px-4 py-3 font-semibold text-white" data-wallet-url={check.walletUrl}>
                    Open decID Pass on this device
                  </button>
                  <div className="flex items-center gap-3 rounded-xl bg-[#fbf7f0] p-3">
                    <div className="h-24 w-24 shrink-0 rounded-lg bg-white p-1" dangerouslySetInnerHTML={{ __html: check.qrSvg }} role="img" aria-label="QR code: scan with your phone to verify" />
                    <p className="text-xs text-[#7a6250]">Or scan with your phone. Waiting for your answer… nothing about you is shared except whether you are 21+.</p>
                  </div>
                </div>
              )}
              {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
            </section>
          )}

          {received && (
            <section className="rounded-2xl bg-[#2b1d12] p-4 text-sm text-[#fbf7f0]" aria-label="What Hopline received">
              <h2 className="font-bold">What Hopline received from decID</h2>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed">{JSON.stringify(received, null, 2)}</pre>
              <p className="mt-2 text-xs text-[#d9c3a5]">Not received: name, birth date, address, ID number, ID photo, selfie. Receipt signature checked against decID’s published key.</p>
            </section>
          )}

          <button className="self-start text-xs text-[#7a6250] underline" onClick={() => setShowLegacy(!showLegacy)}>
            {showLegacy ? "Hide" : "Compare with"} a typical ID-upload checkout
          </button>
          {showLegacy && (
            <section className="rounded-2xl border-2 border-dashed border-[#d9c3a5] p-4 text-sm text-[#7a6250]">
              <b className="text-[#2b1d12]">Typical age check today</b>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Upload a photo of the front and back of your ID</li>
                <li>Take a selfie for a face match</li>
                <li>Wait while it is reviewed</li>
              </ol>
              <p className="mt-2">The shop or its vendor now stores your ID photo, home address and birth date, on every order.</p>
            </section>
          )}
          {check && (
            <button className="self-start text-xs text-[#7a6250] underline" onClick={reset}>
              Reset demo order
            </button>
          )}
          <Link href="/" className="text-xs text-[#7a6250] underline">
            About decID
          </Link>
        </aside>
      </main>
    </div>
  );
}
