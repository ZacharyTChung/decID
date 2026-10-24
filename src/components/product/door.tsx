"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Smartphone, TriangleAlert } from "lucide-react";
import { friendlyReason } from "../../lib/shared/policies";
import type { AgeCheck } from "./checkout";

/**
 * Neon Hall's door kiosk. Idle: a live entry code (QR) with a moving scan line and a running
 * clock, so a screenshot can't pass for the live screen. After an answer: a full-bleed verdict
 * readable from two metres, the match code, and the staff decision (after Apple's ID Verifier
 * "Matches person / Doesn't match").
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function NeonHallDoor({ check, className }: { check: AgeCheck; className?: string }) {
  const [counts, setCounts] = useState({ in: 0, out: 0 });
  const [counted, setCounted] = useState<string>();
  const [now, setNow] = useState<Date>();
  const { id, status, start } = check;

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // Always have a live entry code on screen; replace it when it expires.
  useEffect(() => {
    if (!id || status === "expired") start("door-1");
  }, [id, status, start]);
  // Count each answer once, then get ready for the next guest after a few seconds.
  useEffect(() => {
    if (!id || (status !== "verified" && status !== "rejected") || counted === id) return;
    setCounted(id);
    setCounts((c) => (status === "verified" ? { ...c, in: c.in + 1 } : { ...c, out: c.out + 1 }));
  }, [id, status, counted]);
  const next = useCallback(() => start("door-1"), [start]);
  useEffect(() => {
    if (!counted) return;
    const t = setTimeout(next, 9000);
    return () => clearTimeout(t);
  }, [counted, next]);

  const answered = status === "verified" || status === "rejected";
  const ok = status === "verified";
  const clock = now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) ?? "";

  return (
    <div className={cx("relative flex min-h-[720px] flex-col font-neon text-white", className, answered ? (ok ? "bg-ok-solid" : "bg-bad-solid") : "bg-[#0e0b12]")}>
      <header className="flex items-center justify-between px-8 pt-6 font-sans text-[13px]">
        <span className="font-neon text-[26px] font-[800] uppercase leading-none tracking-[0.04em]">
          Neon<span className="text-[#ff3ea5]">·</span>Hall
        </span>
        <span className="num flex items-center gap-4 text-white">
          <span>Door 1</span>
          <span className="font-mono" data-testid="door-clock">
            {clock}
          </span>
        </span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-8 py-8 text-center" aria-live="polite">
        {!answered ? (
          <>
            <p className="font-sans text-[13px] uppercase tracking-[0.14em] text-[#ff8ccb]">21+ tonight</p>
            <h2 className="mt-2 text-[56px] font-[800] uppercase leading-[0.95]">Scan to enter</h2>
            <p className="mt-3 max-w-md font-sans text-[15px] leading-[22px] text-white/85">Open decID Pass and scan the code. You’ll see exactly what Neon Hall learns before you share.</p>
            <div className="relative mt-8 rounded-md bg-white p-4">
              {check.qrSvg ? <div className="h-44 w-44 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label="Entry code for decID Pass" data-wallet-url={check.walletUrl} dangerouslySetInnerHTML={{ __html: check.qrSvg }} /> : <div className="h-44 w-44" />}
              <span className="door-scan pointer-events-none absolute inset-x-4 top-4 h-0.5 bg-[#ff3ea5]/70" aria-hidden />
            </div>
            <button disabled={!id || status !== "pending"} onClick={check.open} data-request-id={id} className="press mt-6 inline-flex h-10 items-center gap-2 rounded-sm border border-white/30 px-4 font-sans text-[13px] font-medium text-white hover:bg-white/10 disabled:opacity-40">
              <Smartphone size={15} strokeWidth={1.75} aria-hidden /> Scan with the demo phone
            </button>
            {check.error && <p className="mt-3 font-sans text-[13px] text-[#ff8ccb]">{check.error}</p>}
            {check.setRequireUnlock && (
              <label className="mt-5 inline-flex cursor-pointer items-center gap-2 font-sans text-[13px] text-white/90">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#ff3ea5]"
                  checked={!!check.requireUnlock}
                  data-testid="door-require-unlock"
                  onChange={(e) => {
                    check.setRequireUnlock!(e.target.checked);
                    // The code on screen was made with the old setting: replace it.
                    setTimeout(() => start("door-1"), 0);
                  }}
                />
                Guests must unlock with Face ID / fingerprint
              </label>
            )}
          </>
        ) : ok ? (
          <>
            <h2 className="text-[96px] font-[800] uppercase leading-[0.9]">OK to enter</h2>
            <p className="mt-6 font-sans text-[15px] text-white">Ask the guest to show their phone. The codes must match.</p>
            <div className="mt-3 font-mono text-[80px] font-medium leading-none tracking-[0.16em]" data-testid="door-match-code">
              {check.matchCode}
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-3 font-sans">
              <button onClick={next} className="press h-11 rounded-sm bg-white px-5 text-[14px] font-semibold text-ok-solid">
                Codes match · next guest
              </button>
              <button
                onClick={() => {
                  setCounts((c) => ({ in: c.in - 1, out: c.out + 1 }));
                  next();
                }}
                className="press h-11 rounded-sm border border-white/50 px-5 text-[14px] font-semibold text-white hover:bg-white/10"
              >
                Codes don’t match
              </button>
            </div>
            <p className="mt-6 font-sans text-[13px] text-white">21 or older, vouched for by {check.issuerName}. Receipt signed.</p>
            <p className="mt-2 inline-flex items-center gap-1.5 font-sans text-[13px] text-white" data-testid="door-unlock">
              <Fingerprint size={15} strokeWidth={1.75} aria-hidden />
              {check.userVerified ? "The guest unlocked their phone with Face ID, fingerprint or PIN." : "No device unlock on this answer."}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-[96px] font-[800] uppercase leading-[0.9]">Do not admit</h2>
            <p className="mt-4 text-[40px] font-[700] uppercase leading-none" data-testid="door-reason">
              {friendlyReason(check.failureCode)}
            </p>
            <p className="mt-5 font-sans text-[14px] text-white">No name, birth date or photo was shared.</p>
            <button onClick={next} className="press mt-8 h-11 rounded-sm bg-white px-5 font-sans text-[14px] font-semibold text-bad-solid">
              Next guest
            </button>
          </>
        )}
      </div>

      {answered && check.risk && check.risk.length > 0 && (
        <div className="mx-6 mb-4 rounded-md bg-[#fff4d6] px-5 py-4 font-sans text-[#5c3d00]" role="alert" data-testid="door-risk">
          {check.risk.map((r) => (
            <div key={r.title} className="flex gap-3">
              <TriangleAlert size={20} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="text-[16px] font-semibold">{r.title}</p>
                <p className="text-[13px] leading-5">{r.detail}</p>
                <p className="mt-1 text-[13px] font-medium leading-5">{r.action}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/20 px-8 py-4 font-sans text-[12px] text-white">
        <span className="num">
          Admitted {counts.in} · Refused {counts.out}
        </span>
        <span>This screen never shows names, birth dates or photos.</span>
      </footer>
      {answered && <span className="door-countdown absolute bottom-0 left-0 h-1 bg-white/60" aria-hidden />}
    </div>
  );
}
