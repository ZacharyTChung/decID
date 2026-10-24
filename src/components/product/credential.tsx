"use client";

import { useMemo, useRef } from "react";
import { DecidMark } from "./brand";

/**
 * The decID Pass credential, drawn like a physical identity document: light security-print paper,
 * guilloché linework in two inks, microtext along the edge, one primary field and a small
 * optically variable patch that shifts as the pointer moves. The geometry is generated
 * (hypotrochoid rosettes and phase-shifted waves), not hand-drawn.
 */

export interface CredentialProps {
  holder: string;
  ageOver18?: boolean;
  ageOver21?: boolean;
  issuer: string;
  validUntil: Date;
  documentRef: string;
  revoked?: boolean;
  /** A fixed date label, for server-rendered pages (locale formatting differs between server and browser). */
  validUntilText?: string;
}

const W = 343;
const H = 216;

function rosette(cx: number, cy: number, R: number, r: number, d: number, turns: number, steps = 900): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join("L")}`;
}

function wave(y0: number, amp: number, period: number, phase: number): string {
  const pts: string[] = [];
  for (let x = -4; x <= W + 4; x += 3) pts.push(`${x},${(y0 + amp * Math.sin((x / period) * Math.PI * 2 + phase)).toFixed(1)}`);
  return `M${pts.join("L")}`;
}

function usePrint() {
  return useMemo(
    () => ({
      rosetteBlue: rosette(262, 96, 70, 13, 46, 13),
      rosetteRose: rosette(262, 96, 52, 9, 30, 9),
      waves: Array.from({ length: 14 }, (_, i) => wave(120 + i * 6.5, 7 + (i % 3), 92 + i * 3, i * 0.42)),
    }),
    [],
  );
}

const MICRO = "DECID PASS · SIMULATED IDENTITY OFFICE · AGE CREDENTIAL · NOT VALID AS PHOTO ID · ";

export function Credential({ holder, ageOver18, ageOver21, issuer, validUntil, documentRef, revoked, validUntilText }: CredentialProps) {
  const print = usePrint();
  const card = useRef<HTMLDivElement>(null);
  const primary = ageOver21 ? "21+" : ageOver18 ? "18+" : "Under 18";
  // Pointer-driven sheen on the patch. Set through CSSOM (allowed by the app's CSP), never a style attribute.
  const move = (e: React.PointerEvent) => {
    const r = card.current?.getBoundingClientRect();
    if (!r || !card.current) return;
    card.current.style.setProperty("--sheen", `${(((e.clientX - r.left) / r.width) * 360).toFixed(0)}deg`);
  };

  return (
    <div
      ref={card}
      onPointerMove={move}
      className="credential relative aspect-[1.586] w-full overflow-hidden rounded-xl border border-ink-6 bg-print-paper text-ink-12 shadow-[0_1px_0_rgb(23_27_32/0.04),0_10px_24px_-14px_rgb(23_27_32/0.35)]"
      aria-label={`decID Pass for ${holder}: ${primary}`}
      role="group"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="none">
        <defs>
          <linearGradient id="rainbow" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#eef2fb" />
            <stop offset="0.55" stopColor="#f7f3f6" />
            <stop offset="1" stopColor="#f1f5f4" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#rainbow)" />
        {print.waves.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={i % 2 ? "var(--color-print-rose)" : "var(--color-print-blue)"} strokeWidth="0.45" opacity="0.22" />
        ))}
        <path d={print.rosetteBlue} fill="none" stroke="var(--color-print-blue)" strokeWidth="0.4" opacity="0.28" />
        <path d={print.rosetteRose} fill="none" stroke="var(--color-print-rose)" strokeWidth="0.4" opacity="0.3" />
        <text x="6" y={H - 5} className="font-mono" fontSize="3.6" fill="var(--color-print-blue)" opacity="0.55" letterSpacing="0.4">
          {MICRO.repeat(4)}
        </text>
      </svg>

      <div className="relative flex h-full flex-col justify-between p-[5.5%]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-1.5 text-ink-12">
            <DecidMark size={18} />
            <span className="text-[13px] font-semibold tracking-[-0.01em]">decID</span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-10">Age credential</span>
        </div>

        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-10">Age</div>
          <div className={`font-semibold leading-none tracking-[-0.03em] ${primary.length > 3 ? "text-[30px]" : "text-[44px]"}`}>{primary}</div>
        </div>

        <dl className="grid grid-cols-[auto_auto_auto] gap-x-5 gap-y-1.5 pb-2 text-[11px] leading-tight">
          <Field label="Holder" value={holder} />
          <Field label="18 or older" value={ageOver18 ? "Yes" : "No"} />
          <Field label="21 or older" value={ageOver21 ? "Yes" : "No"} />
          <Field label="Valid until" value={validUntilText ?? validUntil.toLocaleDateString(undefined, { month: "2-digit", year: "numeric" })} mono />
          <Field label="Ref." value={documentRef} mono />
        </dl>
      </div>

      <div className="credential-ovd pointer-events-none absolute bottom-[16%] right-[6%] h-[22%] w-auto rounded-full opacity-80" aria-hidden />
      <span className="sr-only">Issued by {issuer}.</span>
      {revoked && (
        <div className="absolute inset-0 grid place-items-center bg-ink-1/70">
          <span className="rotate-[-8deg] rounded-xs border-2 border-bad px-3 py-1 font-mono text-sm font-medium uppercase tracking-[0.12em] text-bad">Revoked</span>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-10">{label}</dt>
      <dd className={`truncate font-medium text-ink-12 ${mono ? "font-mono text-[10.5px]" : ""}`}>{value}</dd>
    </div>
  );
}

/** The empty slot shown before a credential exists. */
export function CredentialSlot({ children }: { children?: React.ReactNode }) {
  return <div className="grid aspect-[1.586] w-full place-items-center rounded-xl border border-dashed border-ink-7 bg-ink-2 p-6 text-center text-body text-ink-10">{children}</div>;
}
