"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, Minus, Plus, ShoppingBag, Smartphone } from "lucide-react";
import { friendlyReason } from "../../lib/shared/policies";
import { CanArt, VerifyAgeButton } from "./merchant";

/**
 * Hopline, a demo online drinks shop, with decID's age check in its checkout. The data comes from
 * an AgeCheck the host provides: the hosted prototype backs it with its in-page decID, the Next
 * app with Hopline's own backend talking to decID Verify over HTTP.
 */

export type CheckState = "pending" | "processing" | "verified" | "rejected" | "expired";

export interface AgeCheck {
  /** The current decID request, if one was started. */
  id?: string;
  status?: CheckState;
  failureCode?: string | null;
  matchCode?: string | null;
  issuerName?: string | null;
  /** Exactly what the business's backend received from decID (shown to make "no personal data" visible). */
  received?: unknown;
  qrSvg?: string;
  /** Link that opens this request in decID Pass (on another device, via the QR code). */
  walletUrl?: string;
  error?: string;
  /** The guest unlocked their phone (Face ID, fingerprint or PIN) to answer. */
  userVerified?: boolean | null;
  /** Fraud signals decID attached to this answer. */
  risk?: { kind: string; severity: "high" | "medium" | "low"; title: string; detail: string; action: string }[];
  /** Whether new requests ask the guest to unlock their phone; and a switch for it. */
  requireUnlock?: boolean;
  setRequireUnlock?: (v: boolean) => void;
  start: (reference: string) => void;
  reset: () => void;
  /** Open the request in decID Pass (the demo phone). */
  open: () => void;
}

const PRODUCTS = [
  { id: "dusk", name: "Dusk Lager", detail: "6 × 12 oz cans · 4.6% ABV", price: 14, alcohol: true, band: "#1d2b4f", accent: "#f4d23c", ink: "#1d2b4f", short: "DUSK" },
  { id: "orchard", name: "Orchard Dry Cider", detail: "4 × 16 oz cans · 5.5% ABV", price: 13, alcohol: true, band: "#7a1f2b", accent: "#f2e6d0", ink: "#7a1f2b", short: "ORCH" },
  { id: "yuzu", name: "Yuzu Soda", detail: "6 × 12 oz cans · non-alcoholic", price: 9, alcohol: false, band: "#f4d23c", accent: "#ffffff", ink: "#141414", short: "YUZU" },
];

const money = (n: number) => `$${n.toFixed(2)}`;
const newRef = () => `HL-${Math.floor(1000 + Math.random() * 9000)}`;

export function HoplineCheckout({ check }: { check: AgeCheck }) {
  const [qty, setQty] = useState<Record<string, number>>({ dusk: 1, orchard: 0, yuzu: 1 });
  // A fixed first reference keeps server and client renders identical; later orders get random ones.
  const [orderRef, setOrderRef] = useState("HL-4821");
  const [placed, setPlaced] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const lines = PRODUCTS.filter((p) => qty[p.id]);
  const subtotal = lines.reduce((s, p) => s + p.price * qty[p.id]!, 0);
  const delivery = subtotal >= 40 || subtotal === 0 ? 0 : 5;
  const tax = Math.round(subtotal * 0.0725 * 100) / 100;
  const total = subtotal + delivery + tax;
  const needsAge = lines.some((p) => p.alcohol);
  const verified = check.status === "verified";
  const newOrder = () => {
    check.reset();
    setPlaced(false);
    setOrderRef(newRef());
  };

  return (
    <div className="min-h-[720px] bg-white font-hop text-[#141414]">
      <header className="border-b border-[#e6e6e6]">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <span className="text-[26px] font-[800] uppercase leading-none tracking-[0.02em] [font-stretch:72%]">Hopline</span>
          <nav className="hidden gap-6 text-[14px] font-medium md:flex" aria-label="Hopline">
            <span>Beer</span>
            <span>Cider</span>
            <span>Non-alc</span>
            <span>Gift sets</span>
          </nav>
          <span className="inline-flex items-center gap-2 text-[14px] font-medium">
            <ShoppingBag size={20} strokeWidth={1.75} aria-label="Bag" />
            <span className="num">{lines.reduce((a, p) => a + qty[p.id]!, 0)}</span>
          </span>
        </div>
        <div className="bg-[#141414] px-6 py-1.5 text-center text-[12px] font-medium tracking-[0.02em] text-[#f4d23c]">Free delivery on orders over $40 · Alcohol only to adults 21+</div>
      </header>

      {placed ? (
        <div className="mx-auto max-w-xl px-6 py-12">
          <CheckCircle2 size={36} strokeWidth={1.5} className="text-ok" aria-hidden />
          <h1 className="mt-4 text-[34px] font-[800] uppercase leading-none [font-stretch:72%]">Order confirmed</h1>
          <p className="mt-3 text-[15px] text-[#4a4a4a]">{orderRef} ships today. We confirmed your age with decID, so we never needed a copy of your ID.</p>
          {check.received ? <ReceivedPanel data={check.received} /> : null}
          <button onClick={newOrder} className="press mt-8 h-11 rounded-sm border border-[#141414] px-5 text-[14px] font-semibold">
            Start a new order
          </button>
        </div>
      ) : (
        <div className="grid gap-10 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0" aria-label="Your order">
            <h1 className="text-[34px] font-[800] uppercase leading-none [font-stretch:72%]">Checkout</h1>
            <p className="mt-2 text-[14px] text-[#5c5c5c]">Order {orderRef}</p>
            <ul className="mt-6 divide-y divide-[#ececec] border-y border-[#ececec]">
              {PRODUCTS.map((p) => (
                <li key={p.id} className="flex items-center gap-4 py-4">
                  <div className="grid h-20 w-16 shrink-0 place-items-center rounded-sm bg-[#f5f5f3]">
                    <CanArt label={p.short} band={p.band} accent={p.accent} ink={p.ink} size={62} />
                  </div>
                  <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[16px] font-semibold">{p.name}</span>
                        {p.alcohol && <span className="rounded-xs border border-[#141414] px-1 text-[11px] font-semibold leading-4">21+</span>}
                      </div>
                      <div className="text-[13px] text-[#5c5c5c]">{p.detail}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 sm:mt-0">
                      <div className="flex items-center rounded-sm border border-[#d9d9d9]">
                        <button aria-label={`Remove one ${p.name}`} disabled={!!check.id} onClick={() => setQty((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))} className="press grid h-8 w-8 place-items-center disabled:opacity-30">
                          <Minus size={14} strokeWidth={2} />
                        </button>
                        <span className="num w-6 text-center text-[14px] font-medium">{qty[p.id] ?? 0}</span>
                        <button aria-label={`Add one ${p.name}`} disabled={!!check.id} onClick={() => setQty((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))} className="press grid h-8 w-8 place-items-center disabled:opacity-30">
                          <Plus size={14} strokeWidth={2} />
                        </button>
                      </div>
                      <span className="num w-16 text-right text-[15px] font-semibold">{money(p.price * (qty[p.id] ?? 0))}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <aside className="min-w-0" aria-label="Order summary">
            <div className="rounded-sm border border-[#e3e3e3] p-5">
              <dl className="num space-y-2 text-[14px]">
                <div className="flex justify-between">
                  <dt className="text-[#5c5c5c]">Subtotal</dt>
                  <dd>{money(subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5c5c5c]">Delivery</dt>
                  <dd>{delivery ? money(delivery) : "Free"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5c5c5c]">Estimated tax</dt>
                  <dd>{money(tax)}</dd>
                </div>
                <div className="flex justify-between border-t border-[#ececec] pt-3 text-[17px] font-semibold">
                  <dt>Total</dt>
                  <dd>{money(total)}</dd>
                </div>
              </dl>

              {needsAge && (
                <div className="mt-6 border-t border-[#ececec] pt-5 font-sans">
                  <h2 className="text-[15px] font-semibold">Age verification</h2>
                  <AgeBlock check={check} orderRef={orderRef} />
                </div>
              )}

              <button
                onClick={() => setPlaced(true)}
                disabled={needsAge && !verified}
                data-testid="place-order"
                className="press mt-6 h-12 w-full rounded-sm bg-[#f4d23c] text-[16px] font-[800] uppercase tracking-[0.02em] text-[#141414] [font-stretch:80%] hover:bg-[#ffdd45] disabled:cursor-not-allowed disabled:bg-[#efefef] disabled:text-[#9a9a9a]"
              >
                Place order · {money(total)}
              </button>
              {needsAge && !verified && <p className="mt-2 text-center font-sans text-[12px] text-[#6b6b6b]">Verify your age to place this order.</p>}
            </div>
            <button onClick={() => setLegacy(!legacy)} className="mt-4 font-sans text-[12px] text-[#5c5c5c] underline underline-offset-2">
              {legacy ? "Hide" : "How most shops check age today"}
            </button>
            {legacy && (
              <div className="mt-2 rounded-sm bg-[#f5f5f3] p-4 font-sans text-[13px] text-[#4a4a4a]">
                Upload the front and back of your driver’s licence, then take a selfie. The shop or its vendor keeps those images, with your address and birth date, for every order.
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function AgeBlock({ check, orderRef }: { check: AgeCheck; orderRef: string }) {
  const [showReceipt, setShowReceipt] = useState(false);
  const s = check.status;
  if (!check.id) {
    return (
      <>
        <p className="mt-1 text-[13px] leading-5 text-[#4a4a4a]">Alcohol can only be sold to people 21 or older. With decID, Hopline receives a yes or no, never your ID.</p>
        <div className="mt-3">
          <VerifyAgeButton onClick={() => check.start(orderRef)} />
        </div>
        {check.error && <p className="mt-2 text-[12px] text-bad">{check.error}</p>}
      </>
    );
  }
  if (s === "verified") {
    return (
      <div className="mt-2" data-testid="age-verified">
        <p className="flex items-center gap-2 text-[14px] font-medium text-ok">
          <CheckCircle2 size={17} strokeWidth={1.75} aria-hidden /> 21 or older, confirmed by decID
        </p>
        <button onClick={() => setShowReceipt(!showReceipt)} className="mt-1 text-[12px] text-[#5c5c5c] underline underline-offset-2">
          {showReceipt ? "Hide" : "What Hopline received"}
        </button>
        {showReceipt && check.received ? <ReceivedPanel data={check.received} /> : null}
      </div>
    );
  }
  if (s === "rejected") {
    return (
      <div className="mt-2 rounded-sm bg-bad-soft p-3 text-[13px] text-bad" role="status">
        <p className="flex items-center gap-2 font-medium">
          <CircleAlert size={16} strokeWidth={1.75} aria-hidden /> We can’t sell alcohol on this order
        </p>
        <p className="mt-1 text-ink-11">{friendlyReason(check.failureCode)}. Remove the 21+ items to continue, or try again.</p>
        <button className="mt-1 font-medium underline" onClick={() => check.start(orderRef)}>
          Try again
        </button>
      </div>
    );
  }
  if (s === "expired") {
    return (
      <p className="mt-2 text-[13px] text-[#4a4a4a]">
        The request expired.{" "}
        <button className="font-medium underline" onClick={() => check.start(orderRef)}>
          Start again
        </button>
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-sm border border-ink-6 p-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-[1.75px] border-ink-12 border-t-transparent" aria-hidden />
        <div>
          <p className="text-[14px] font-medium text-ink-12">Waiting for decID Pass</p>
          <p className="text-[12px] text-ink-10">Approve the request on your phone.</p>
        </div>
      </div>
      {check.qrSvg && (
        <div className="mt-3 flex items-center gap-3 rounded-sm bg-ink-2 p-2.5">
          <div className="h-20 w-20 shrink-0 rounded-xs bg-white p-1 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label="QR code for decID Pass" dangerouslySetInnerHTML={{ __html: check.qrSvg }} />
          <p className="text-[12px] text-ink-10">On another device? Scan this with your phone’s camera.</p>
        </div>
      )}
      <button onClick={check.open} data-request-id={check.id} data-wallet-url={check.walletUrl} className="press mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-ink-6 text-[13px] font-medium text-ink-12 hover:bg-ink-2">
        <Smartphone size={15} strokeWidth={1.75} aria-hidden /> Open on the demo phone
      </button>
      <button onClick={check.reset} className="mt-2 w-full text-center text-[12px] text-ink-10 underline underline-offset-2">
        Cancel
      </button>
    </div>
  );
}

export function ReceivedPanel({ data }: { data: unknown }) {
  return (
    <figure className="mt-3 font-sans" aria-label="What Hopline received">
      <figcaption className="mb-1.5 text-[12px] text-[#5c5c5c]">Everything Hopline received from decID. No name, birth date, address, ID number or photo.</figcaption>
      <pre tabIndex={0} className="overflow-x-auto rounded-sm bg-ink-12 p-3 font-mono text-[12px] leading-[18px] text-ink-3">
        {JSON.stringify(data, null, 2)}
      </pre>
    </figure>
  );
}
