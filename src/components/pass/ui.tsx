"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import type { PassProfile } from "@/lib/client/pass";
import { claimsOf, validUntil } from "@/lib/client/pass";

/** The phone-sized frame every decID Pass screen lives in. */
export function PassFrame({ children, profiles, active, onSwitch, onAdd }: { children: ReactNode; profiles?: PassProfile[]; active?: PassProfile; onSwitch?: (id: string) => void; onAdd?: () => void }) {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-4">
        <header className="mb-5 flex items-center justify-between gap-3">
          <Link href="/pass" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-700 text-sm font-bold text-white" aria-hidden>
              d
            </span>
            <span>
              decID <span className="text-brand-700">Pass</span>
            </span>
          </Link>
          {profiles && profiles.length > 0 && onSwitch && (
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <span className="sr-only">Demo person</span>
              <select
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                value={active?.id}
                onChange={(e) => (e.target.value === "__new" ? onAdd?.() : onSwitch(e.target.value))}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {onAdd && <option value="__new">+ Another person (demo)</option>}
              </select>
            </label>
          )}
        </header>
        <main className="flex flex-1 flex-col gap-5">{children}</main>
      </div>
    </div>
  );
}

export function PassCard({ profile, status }: { profile: PassProfile; status?: string }) {
  const b = profile.bundle!;
  const c = claimsOf(b);
  const active = status === "Active";
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-5 text-white shadow-lg" aria-label="Your decID Pass">
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full border-[18px] border-white/5" aria-hidden />
      <div className="pointer-events-none absolute -bottom-16 -left-8 h-44 w-44 rounded-full border-[14px] border-white/5" aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-brand-100">decID Pass</div>
          <div className="mt-1 text-lg font-semibold">{profile.label}</div>
        </div>
        <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", active ? "bg-emerald-400/20 text-emerald-100" : "bg-amber-300/20 text-amber-100")}>
          {status === undefined ? "Checking…" : active ? "Active" : status === "NotRegistered" ? "Not activated" : status}
        </span>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Claim ok={c.ageOver18 === true} label="18+" />
        <Claim ok={c.ageOver21 === true} label="21+" />
        <Claim ok label="Verified person" />
      </div>
      <div className="mt-6 flex items-end justify-between gap-3 text-xs text-brand-100">
        <div>
          Verified by
          <div className="text-sm font-medium text-white">{profile.issuerName ?? "Demo issuer"}</div>
        </div>
        <div className="text-right">
          Valid until
          <div className="text-sm font-medium text-white">{validUntil(b).toLocaleDateString()}</div>
        </div>
      </div>
    </div>
  );
}

function Claim({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold", ok ? "bg-white text-brand-800" : "bg-white/10 text-white/60 line-through")}>
      <span aria-hidden>{ok ? "✓" : "✕"}</span>
      {label}
      <span className="sr-only">{ok ? "yes" : "no"}</span>
    </span>
  );
}

export function Panel({ title, children, tone = "default" }: { title?: ReactNode; children: ReactNode; tone?: "default" | "brand" }) {
  return (
    <section className={cx("rounded-2xl p-4", tone === "brand" ? "bg-brand-50 ring-1 ring-brand-100" : "bg-white shadow-sm ring-1 ring-slate-200")}>
      {title && <h2 className="mb-2 text-sm font-semibold text-slate-900">{title}</h2>}
      {children}
    </section>
  );
}

export function BigButton({ children, onClick, disabled, busy, variant = "primary", type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; variant?: "primary" | "ghost"; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" ? "bg-brand-700 text-white hover:bg-brand-600" : "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50",
      )}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function StepList({ steps, current }: { steps: { id: string; label: string; detail: string }[]; current: string }) {
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => {
        const state = i < idx || current === "done" ? "done" : i === idx ? "now" : "next";
        return (
          <li key={s.id} className="flex items-start gap-3">
            <span
              className={cx(
                "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold",
                state === "done" && "bg-brand-700 text-white",
                state === "now" && "bg-brand-100 text-brand-800 ring-2 ring-brand-500",
                state === "next" && "bg-slate-200 text-slate-600",
              )}
              aria-hidden
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <div>
              <div className={cx("text-sm font-semibold", state === "next" ? "text-slate-600" : "text-slate-900")}>
                {s.label} {state === "now" && <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500 align-middle" aria-hidden />}
              </div>
              <div className="text-xs text-slate-600">{s.detail}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
