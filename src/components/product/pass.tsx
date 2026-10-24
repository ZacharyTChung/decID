"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, BatteryFull, ChevronRight, Info, Signal, TriangleAlert, Wifi, X } from "lucide-react";
import { MerchantLogo, type MerchantBrand } from "./merchant";

/**
 * decID Pass building blocks: phone chrome, grouped lists, the consent sheet (modelled on Apple's
 * Verify with Wallet sheet and the EU Digital Identity Wallet's data-sharing request) and the
 * result panel (modelled on the GOV.UK confirmation panel). Presentational only: the hosted
 * prototype and the Next app feed them their own data.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function StatusBar({ dark = false }: { dark?: boolean }) {
  const now = new Date();
  return (
    <div className={cx("flex h-11 shrink-0 items-center justify-between px-7 pt-1 text-[15px] font-semibold", dark ? "text-white" : "text-ink-12")} aria-hidden>
      <span className="num">{now.getHours() % 12 || 12}:{String(now.getMinutes()).padStart(2, "0")}</span>
      <span className="flex items-center gap-1.5">
        <Signal size={15} strokeWidth={2.25} />
        <Wifi size={15} strokeWidth={2.25} />
        <BatteryFull size={20} strokeWidth={1.75} />
      </span>
    </div>
  );
}

/** Where sheets render: the phone frame's screen (so they don't scroll with the content). */
const OverlayTarget = createContext<HTMLElement | null>(null);

/** Renders a sheet over the phone screen when inside a PhoneFrame, or over the viewport otherwise. */
export function SheetLayer({ children, label, labelledBy }: { children: ReactNode; label?: string; labelledBy?: string }) {
  const target = useContext(OverlayTarget);
  const layer = (
    <div className={cx(target ? "absolute" : "fixed", "inset-0 z-30 flex flex-col justify-end bg-ink-12/35 animate-fade-in")} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </div>
  );
  return target ? createPortal(layer, target) : layer;
}

/** A phone body for the demo stage: thin bezel, island, scrollable screen, sheet layer. */
export function PhoneFrame({ children, label = "Phone running decID Pass" }: { children: ReactNode; label?: string }) {
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  return (
    <div className="mx-auto w-full max-w-[392px] rounded-[54px] bg-ink-12 p-[10px] shadow-float" role="region" aria-label={label}>
      <div className="relative flex h-[min(780px,82vh)] flex-col overflow-hidden rounded-[44px] bg-ink-2" data-testid="phone">
        <div className="pointer-events-none absolute left-1/2 top-2.5 z-40 h-[30px] w-[108px] -translate-x-1/2 rounded-full bg-ink-12" aria-hidden />
        <StatusBar />
        <OverlayTarget.Provider value={overlay}>
          <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
        </OverlayTarget.Provider>
        <div ref={setOverlay} className="contents" />
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-40 h-[5px] w-32 -translate-x-1/2 rounded-full bg-ink-12/80" aria-hidden />
      </div>
    </div>
  );
}

/** iOS-style large title, with an optional navigation bar row above it (back on the left, actions on the right). */
export function LargeTitle({ title, subtitle, leading, trailing }: { title: string; subtitle?: string; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <header className="px-5 pb-3">
      <div className="-mx-2 flex h-10 items-center justify-between gap-3">
        <div>{leading}</div>
        <div>{trailing}</div>
      </div>
      <h2 className="text-[30px] font-semibold leading-9 tracking-[-0.02em] text-ink-12">{title}</h2>
      {subtitle && <p className="mt-0.5 text-body text-ink-10">{subtitle}</p>}
    </header>
  );
}

export function Group({ title, footer, children, className }: { title?: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("px-4", className)}>
      {title && <h3 className="px-4 pb-1.5 text-ui font-medium text-ink-10">{title}</h3>}
      <div className="divide-y divide-ink-5 overflow-hidden rounded-lg border border-ink-5 bg-white">{children}</div>
      {footer && <div className="px-4 pt-1.5 text-meta text-ink-10">{footer}</div>}
    </section>
  );
}

export function Row({ icon, label, detail, value, onClick, chevron, tone, children }: { icon?: ReactNode; label: ReactNode; detail?: ReactNode; value?: ReactNode; onClick?: () => void; chevron?: boolean; tone?: "danger"; children?: ReactNode }) {
  const body = (
    <>
      {icon && <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-sm", tone === "danger" ? "text-bad" : "text-ink-11")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[15px] leading-5", tone === "danger" ? "text-bad" : "text-ink-12")}>{label}</span>
        {detail && <span className="mt-0.5 block text-ui text-ink-10">{detail}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 text-[15px] text-ink-10">{value}</span>}
      {chevron && <ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-ink-8" aria-hidden />}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="press flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-2">
      {body}
    </button>
  ) : (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">{body}</div>
  );
}

export function PhoneButton({ children, onClick, busy, disabled, variant = "primary", type = "button", testId }: { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; variant?: "primary" | "secondary" | "plain"; type?: "button" | "submit"; testId?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-testid={testId}
      className={cx(
        "press flex h-[50px] w-full items-center justify-center gap-2 rounded-lg text-[16px] font-medium disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-ink-12 text-white hover:bg-ink-11",
        variant === "secondary" && "border border-ink-6 bg-white text-ink-12 hover:bg-ink-2",
        variant === "plain" && "text-accent hover:text-accent-hover",
      )}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-[1.75px] border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export interface ConsentProps {
  merchant: MerchantBrand;
  /** "21 or older" */
  item: string;
  /** What the holder's own credential says, so they know the answer before sharing. */
  answer: boolean;
  expiresIn: number;
  revoked?: boolean;
  busy?: boolean;
  error?: string;
  onShare: () => void;
  onCancel: () => void;
}

const NOT_SHARED = "Your name, date of birth, address, ID number, photo and any other details on your ID.";

export function ConsentSheet({ merchant, item, answer, expiresIn, revoked, busy, error, onShare, onCancel }: ConsentProps) {
  const purpose = merchant.kind === "venue" ? `${merchant.name} has to confirm that every guest is 21 or older before entry.` : `${merchant.name} has to confirm that buyers of alcohol are 21 or older.`;
  return (
    <SheetLayer labelledBy="consent-title">
      <div className="max-h-[92%] overflow-y-auto rounded-t-[22px] bg-white px-5 pb-7 pt-2 shadow-sheet animate-sheet-in">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink-6" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <MerchantLogo merchant={merchant} size={44} />
            <div>
              <h3 id="consent-title" className="text-[17px] font-semibold leading-6 text-ink-12">
                {merchant.name}
              </h3>
              <p className="flex items-center gap-1 text-ui text-ink-10">
                {merchant.domain}
                <BadgeCheck size={14} strokeWidth={1.75} className="text-accent" aria-label="Verified business" />
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="press grid h-8 w-8 place-items-center rounded-full bg-ink-3 text-ink-10 hover:bg-ink-4" aria-label="Cancel">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <p className="mt-4 text-[15px] leading-[22px] text-ink-11">{purpose}</p>

        <h4 className="mt-5 text-ui font-medium text-ink-10">Requested</h4>
        <div className="mt-1.5 flex items-center justify-between rounded-md border border-ink-5 px-3.5 py-3">
          <span className="text-[15px] font-medium text-ink-12">{item}</span>
          <span className={cx("text-[15px]", answer ? "text-ink-12" : "font-medium text-bad")}>{answer ? "Yes" : "No"}</span>
        </div>

        <h4 className="mt-4 text-ui font-medium text-ink-10">Not shared</h4>
        <p className="mt-1 text-body text-ink-11">{NOT_SHARED}</p>

        <p className="mt-4 flex gap-2 text-ui text-ink-10">
          <Info size={15} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
          <span>
            {merchant.name} keeps the answer and a signed receipt, not your details. Your ID issuer is not told where you used it.
          </span>
        </p>

        {(!answer || revoked) && (
          <p className="mt-4 flex gap-2 rounded-md bg-warn-soft px-3 py-2.5 text-ui text-warn" role="status">
            <TriangleAlert size={15} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
            <span>{revoked ? `This ID has been revoked. ${merchant.name} will be told it is not valid.` : `Your ID says you are not ${item.toLowerCase()}. If you share, ${merchant.name} will be told “No” and nothing else.`}</span>
          </p>
        )}

        <div className="mt-5 grid gap-2">
          <PhoneButton onClick={onShare} busy={busy} testId="share">
            Share with {merchant.name}
          </PhoneButton>
          <PhoneButton variant="plain" onClick={onCancel}>
            Don’t share
          </PhoneButton>
        </div>
        {error && (
          <p className="mt-2 text-center text-ui text-bad" role="alert">
            {error}
          </p>
        )}
        <p className="num mt-3 text-center text-meta text-ink-10">Request expires in {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, "0")}</p>
      </div>
    </SheetLayer>
  );
}

/** A full-width verdict panel, after the GOV.UK confirmation panel. */
export function ShareResult({ ok, merchant, item, matchCode, reason, onDone, doneLabel }: { ok: boolean; merchant: MerchantBrand; item: string; matchCode?: string | null; reason?: string; onDone: () => void; doneLabel?: string }) {
  const venue = merchant.kind === "venue";
  return (
    <div className="flex min-h-full flex-col px-4 pb-8 pt-4">
      <section className={cx("rounded-lg px-5 pb-6 pt-7 text-white", ok ? "bg-ok-solid" : "bg-ink-12")} aria-live="polite">
        {ok ? <CheckRing /> : <X size={40} strokeWidth={1.75} aria-hidden />}
        <h3 className="mt-4 text-[26px] font-semibold leading-8 tracking-[-0.02em]">{ok ? `Shared with ${merchant.name}` : reason}</h3>
        <p className="mt-1.5 text-[15px] leading-[22px] text-white">{ok ? `${merchant.name} now knows one thing: you are ${item.toLowerCase()}.` : `${merchant.name} was told the check did not pass. Nothing else was shared.`}</p>
        {ok && matchCode && (
          <div className="mt-6 border-t border-white/25 pt-4">
            <div className="text-ui text-white">{venue ? "Show this code to door staff" : "Match code"}</div>
            <div className="mt-1 font-mono text-[44px] font-medium leading-none tracking-[0.18em]" data-testid="match-code">
              {matchCode}
            </div>
          </div>
        )}
      </section>
      <p className="mt-4 px-1 text-body text-ink-10">{venue ? (ok ? "The door screen shows the same code. Staff compare them before letting you in." : "The door screen shows the same answer.") : `${merchant.name}’s checkout has been updated.`}</p>
      <div className="mt-auto pt-6">
        <PhoneButton variant="secondary" onClick={onDone}>
          {doneLabel ?? "Done"}
        </PhoneButton>
      </div>
    </div>
  );
}

/** The one choreographed moment: a ring that draws, then a tick. */
export function CheckRing({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" aria-hidden>
      <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="151" className="origin-center -rotate-90 animate-ring" />
      <path d="M16 27l7 7 14-15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40" className="animate-tick" />
    </svg>
  );
}

export function StepProgress({ steps, current }: { steps: { id: string; label: string; detail: string }[]; current: string }) {
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => {
        const state = current === "done" || i < idx ? "done" : i === idx ? "now" : "next";
        return (
          <li key={s.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && <span className={cx("absolute left-[11px] top-7 h-[calc(100%-28px)] w-px", state === "done" ? "bg-ink-12" : "bg-ink-5")} aria-hidden />}
            <span
              className={cx(
                "relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                state === "done" && "border-ink-12 bg-ink-12 text-white",
                state === "now" && "border-ink-12 bg-white",
                state === "next" && "border-ink-6 bg-white",
              )}
              aria-hidden
            >
              {state === "done" ? (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : state === "now" ? (
                <span className="h-3 w-3 animate-spin rounded-full border-[1.75px] border-ink-12 border-t-transparent" />
              ) : null}
            </span>
            <div>
              <div className={cx("text-[15px] font-medium leading-6", state === "next" ? "text-ink-9" : "text-ink-12")}>{s.label}</div>
              <div className="text-ui text-ink-10">{s.detail}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A short sheet for states that need no decision (expired, already answered, no ID yet). */
export function SheetNotice({ title, body, onClose, merchant, children, closeLabel = "Close" }: { title: string; body: string; onClose: () => void; merchant?: MerchantBrand; children?: ReactNode; closeLabel?: string }) {
  return (
    <SheetLayer label={title}>
      <div className="rounded-t-[22px] bg-white px-5 pb-7 pt-2 shadow-sheet animate-sheet-in">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-ink-6" aria-hidden />
        {merchant && <MerchantLogo merchant={merchant} size={40} />}
        <h3 className="mt-3 text-[19px] font-semibold leading-6 text-ink-12">{title}</h3>
        <p className="mt-1 text-[15px] leading-[22px] text-ink-10">{body}</p>
        <div className="mt-5 grid gap-2">
          {children}
          <PhoneButton variant="plain" onClick={onClose}>
            {closeLabel}
          </PhoneButton>
        </div>
      </div>
    </SheetLayer>
  );
}

/** decID Pass as a full page on a phone (the Next app), outside the demo phone frame. */
export function PassScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink-2 font-sans text-ink-12">
      <div className="mx-auto w-full max-w-md pt-3">{children}</div>
    </div>
  );
}
