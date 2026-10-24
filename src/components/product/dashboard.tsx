"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * decID Verify dashboard building blocks, after Stripe / Linear / Primer: hairline borders, dense
 * full-bleed tables, dot-plus-text status, monospace identifiers, one accent for data.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type CheckStatus = "verified" | "rejected" | "pending" | "processing" | "expired";

/** Status as a dot plus a plain label. Colour never carries the meaning alone. */
export function StatusLabel({ status, reason }: { status: CheckStatus; reason?: string }) {
  const map: Record<CheckStatus, { dot: string; text: string }> = {
    verified: { dot: "bg-ok", text: "Passed" },
    rejected: { dot: reason === "Not old enough" ? "bg-ink-8" : "bg-bad", text: reason || "Refused" },
    pending: { dot: "bg-warn-dot", text: "Waiting" },
    processing: { dot: "bg-warn-dot", text: "Checking" },
    expired: { dot: "border border-ink-8 bg-transparent", text: "Expired" },
  };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-ui text-ink-12">
      <span className={cx("h-2 w-2 shrink-0 rounded-full", s.dot)} aria-hidden />
      {s.text}
    </span>
  );
}

export function KpiStrip({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg bg-white shadow-card md:grid-cols-4">
      {items.map((k, i) => (
        <div key={k.label} className={cx("px-5 py-4", i % 2 === 1 && "border-l border-ink-4", i >= 2 && "border-t border-ink-4 md:border-t-0", i >= 1 && "md:border-l")}>
          <dt className="text-ui text-ink-10">{k.label}</dt>
          <dd className="num mt-1 font-display text-h1 font-semibold text-ink-12">{k.value}</dd>
          {k.hint && <dd className="mt-0.5 text-meta text-ink-9">{k.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function Panel({ title, description, actions, children, flush }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="min-w-0 rounded-lg bg-white shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-lead font-semibold tracking-[-0.01em] text-ink-12">{title}</h3>
          {description && <p className="mt-0.5 text-ui text-ink-10">{description}</p>}
        </div>
        {actions}
      </header>
      <div className={flush ? "mt-3" : "px-5 pb-5 pt-3"}>{children}</div>
    </section>
  );
}

export function Button({ children, onClick, variant = "secondary", disabled, busy, size = "md", testId }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; busy?: boolean; size?: "sm" | "md"; testId?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      data-testid={testId}
      className={cx(
        "press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-8 px-4 text-ui" : "h-7 px-3 text-meta",
        variant === "primary" && "bg-accent text-white hover:bg-accent-hover",
        variant === "secondary" && "bg-ink-3 text-ink-12 hover:bg-ink-4",
        variant === "danger" && "bg-bad-soft text-bad hover:bg-[#ffe3e3]",
        variant === "ghost" && "text-accent hover:bg-accent-soft",
      )}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

/** Segmented filter control. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] bg-ink-4 p-[2px]">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx("h-7 rounded-[8px] px-3 text-ui transition-colors", value === o.id ? "bg-white font-medium text-ink-12 shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-11 hover:text-ink-12")}
        >
          {o.label}
          {o.count !== undefined && <span className="num ml-1.5 text-ink-9">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const th = "sticky top-0 z-[1] border-b border-ink-4 bg-white px-5 py-2 text-left text-meta font-medium text-ink-10";
export const td = "border-b border-ink-3 px-5 py-3 text-ui text-ink-12";

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-ui text-ink-10">
        {children}
      </td>
    </tr>
  );
}

/** A side drawer for one record. */
export function Drawer({ title, subtitle, onClose, children }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-ink-12/20 animate-fade-in" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[440px] flex-col bg-white shadow-float animate-sheet-in" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-ink-4 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lead font-semibold text-ink-12">{title}</h3>
            {subtitle && <div className="mt-0.5 text-ui text-ink-10">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="press grid h-8 w-8 place-items-center rounded-full bg-ink-3 text-ink-10 hover:bg-ink-4" aria-label="Close">
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

export function DefinitionList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-ui">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-10">{k}</dt>
          <dd className="min-w-0 break-words text-ink-12">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function relativeTime(seconds: number, now: number): string {
  const d = Math.max(0, now - seconds);
  if (d < 10) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Outcomes as horizontal bars, one hue per meaning, every bar labelled with its count. */
export function OutcomeChart({ rows }: { rows: { label: string; n: number; tone: "ok" | "neutral" | "bad" }[] }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return <ChartEmpty>Outcomes appear after the first check.</ChartEmpty>;
  const max = Math.max(...rows.map((r) => r.n));
  return (
    <div className="flex flex-col gap-2.5" role="img" aria-label={rows.map((r) => `${r.label}: ${r.n}`).join(", ")}>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_36px] items-center gap-3 text-ui">
          <span className="truncate text-ink-11" title={r.label}>
            {r.label}
          </span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" aria-hidden>
            <rect width="100" height="8" rx="2" className="fill-ink-3" />
            {r.n > 0 && <rect width={Math.max(1.5, (100 * r.n) / max)} height="8" rx="2" className={r.tone === "ok" ? "fill-ok" : r.tone === "bad" ? "fill-bad" : "fill-ink-8"} />}
          </svg>
          <span className="num text-right font-medium text-ink-12">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

/** Verification time per check: hairline grid, 1.5px line, dots coloured by outcome. */
export function TimingChart({ points }: { points: { id: string; ms: number; ok: boolean }[] }) {
  if (!points.length) return <ChartEmpty>Timings appear after the first check.</ChartEmpty>;
  const W = 520;
  const H = 150;
  const L = 34;
  const B = 20;
  const T = 8;
  const top = Math.max(10, Math.ceil(Math.max(...points.map((p) => p.ms)) / 10) * 10);
  const x = (i: number) => (points.length === 1 ? (L + W) / 2 : L + 6 + ((W - L - 12) * i) / (points.length - 1));
  const y = (ms: number) => T + (H - T - B) * (1 - ms / top);
  const sorted = [...points].sort((a, b) => a.ms - b.ms);
  const median = sorted[Math.floor(sorted.length / 2)]!.ms;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Median verification time ${median.toFixed(0)} ms over ${points.length} checks`}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="stroke-ink-4" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 3.5} textAnchor="end" className="num fill-ink-9 font-mono text-[10px]">
              {v}
            </text>
          </g>
        ))}
        <line x1={L} x2={W} y1={y(median)} y2={y(median)} className="stroke-accent" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
        {points.length > 1 && <polyline points={points.map((p, i) => `${x(i)},${y(p.ms)}`).join(" ")} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" />}
        {points.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.ms)} r={3.5} className={p.ok ? "fill-accent" : "fill-bad"} stroke="#fff" strokeWidth={1.5}>
            <title>{`Check ${i + 1}: ${p.ms.toFixed(1)} ms, ${p.ok ? "passed" : "refused"}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="num mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-meta text-ink-10">
        <span>
          Median <span className="font-mono text-ink-12">{median.toFixed(0)} ms</span> across {points.length} checks
        </span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden /> Passed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-bad" aria-hidden /> Refused
          </span>
        </span>
      </figcaption>
    </figure>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="grid h-28 place-items-center rounded-md bg-ink-2 text-ui text-ink-10">{children}</div>;
}
