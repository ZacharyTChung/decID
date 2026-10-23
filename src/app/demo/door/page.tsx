"use client";

import { useEffect, useRef, useState } from "react";
import { openWallet, useAgeCheck } from "@/components/demo/use-age-check";

/**
 * Neon Hall: a DEMO 21+ venue door. The screen shows a fresh QR code for each guest; the guest
 * scans it with their phone and taps Share in decID Pass. The screen turns green or red and
 * shows a 4-letter match code that must equal the one on the guest's phone, so a friend's
 * phone cannot be used to get someone else in. The screen never shows a name, age or photo.
 */

const RESET_AFTER_MS = 8000;

export default function Door() {
  const { check, status, error, start } = useAgeCheck("neonhall");
  const [admitted, setAdmitted] = useState(0);
  const [refused, setRefused] = useState(0);
  const counted = useRef<string | undefined>(undefined);

  useEffect(() => {
    void start("door-main");
  }, [start]);

  useEffect(() => {
    if (!check || !status || counted.current === check.id) return;
    if (status.status === "verified" || status.status === "rejected") {
      counted.current = check.id;
      if (status.status === "verified") setAdmitted((n) => n + 1);
      else setRefused((n) => n + 1);
      const t = setTimeout(() => void start("door-main"), RESET_AFTER_MS);
      return () => clearTimeout(t);
    }
    if (status.status === "expired") void start("door-main");
  }, [check, status, start]);

  const done = status?.status === "verified" || status?.status === "rejected";
  const ok = status?.status === "verified";

  return (
    <div className={`flex min-h-dvh flex-col text-white transition-colors duration-500 ${done ? (ok ? "bg-emerald-600" : "bg-rose-700") : "bg-[#0d0716]"}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="text-2xl font-black tracking-[0.2em] text-fuchsia-300">NEON HALL</div>
        <div className="flex gap-4 text-sm text-white/70">
          <span>
            Admitted <b className="tabular-nums text-white" data-testid="admitted">{admitted}</b>
          </span>
          <span>
            Refused <b className="tabular-nums text-white">{refused}</b>
          </span>
          <span className="rounded-full bg-white/10 px-3 py-0.5 text-xs">Demo venue</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-10 text-center" aria-live="polite">
        {done ? (
          <>
            <div className="text-7xl" aria-hidden>
              {ok ? "✓" : "✕"}
            </div>
            <h1 className="text-5xl font-black tracking-tight md:text-7xl">{ok ? "21+ VERIFIED" : "ENTRY REFUSED"}</h1>
            {ok ? (
              <>
                <p className="text-lg text-emerald-50">Check that the guest’s phone shows this code:</p>
                <div className="rounded-3xl bg-white/15 px-10 py-5 font-mono text-6xl font-black tracking-[0.35em]" data-testid="door-match-code">
                  {status?.matchCode}
                </div>
                <p className="text-sm text-emerald-50">Vouched for by {status?.issuer?.name}. Receipt {status?.receipt?.valid ? "signed and verified" : "missing"}.</p>
              </>
            ) : (
              <p className="text-2xl text-rose-50" data-testid="door-reason">
                {status?.reason}
              </p>
            )}
            <p className="text-xs text-white/60">Next guest in a few seconds…</p>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Scan to enter <span className="text-fuchsia-300">· 21+</span>
            </h1>
            <p className="max-w-md text-white/70">Open your phone’s camera and point it at the code. Your decID Pass shares one thing: that you are 21 or older.</p>
            {check ? (
              <div className="rounded-3xl bg-white p-4 shadow-[0_0_80px_rgba(232,121,249,0.35)]">
                <div className="h-60 w-60 md:h-72 md:w-72" dangerouslySetInnerHTML={{ __html: check.qrSvg }} role="img" aria-label="Entry QR code" data-wallet-url={check.walletUrl} />
              </div>
            ) : (
              <div className="grid h-60 w-60 place-items-center rounded-3xl bg-white/5 text-white/60">Preparing…</div>
            )}
            {check && (
              <button className="text-sm text-white/70 underline" onClick={() => openWallet(check.walletUrl)}>
                No phone handy? Open the Pass on this device
              </button>
            )}
            {status?.status === "processing" && <p className="text-fuchsia-200">Checking…</p>}
            {error && <p className="text-rose-300">{error}</p>}
          </>
        )}
      </main>
      <footer className="px-6 pb-4 text-center text-xs text-white/50">This screen never shows a name, birth date or photo. Neon Hall stores only the outcome and a signed receipt.</footer>
    </div>
  );
}
