"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/providers";

/**
 * Demo stage: a business (left) and a phone running decID Pass (right) on one screen, for
 * presenting from a single laptop. When the business starts an age check, it asks this page to
 * open the request in the phone frame (postMessage, same origin only).
 */

const SCENES = [
  { id: "shop", label: "Hopline · online checkout", src: "/demo/shop" },
  { id: "door", label: "Neon Hall · venue door", src: "/demo/door" },
  { id: "biz", label: "Business dashboard", src: "/business" },
] as const;

const SCRIPT = [
  ["The problem", "Laws now require age checks; the usual fix (upload your ID) creates honeypots. Discord and Tea both leaked ID photos in 2025."],
  ["Get a Pass", "In the phone, choose Alex, then Verify me. One-time issuance by a (simulated) trusted issuer; it stores yes/no age answers, not a birth date."],
  ["Online checkout", "Hopline: Verify age with decID. The phone shows who asks and exactly what they learn. Share. The shop gets { ageOver21: true } and a signed receipt, nothing else."],
  ["At the door", "Switch to Neon Hall. Share from the phone: the screen turns green and both show the same 4-letter code."],
  ["Under 21", "In the phone, add another person, Sam (16), and verify. At the door Sam is refused, and still nothing personal is shared."],
  ["For the business", "Open the dashboard: volume, outcomes, an intact signed receipt chain, and the full list of stored fields, none of them personal."],
];

export default function Stage() {
  const app = useApp();
  const [scene, setScene] = useState<(typeof SCENES)[number]["id"]>("shop");
  const [phoneSrc, setPhoneSrc] = useState("/pass");
  const [showScript, setShowScript] = useState(true);
  const phone = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; path?: string };
      if (data?.type === "decid:open-wallet" && typeof data.path === "string" && data.path.startsWith("/pass/r/")) {
        setPhoneSrc(`${data.path}?t=${Date.now()}`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const current = SCENES.find((s) => s.id === scene)!;
  return (
    <div className="flex min-h-dvh flex-col bg-ink text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-xs font-bold" aria-hidden>
            d
          </span>
          decID demo stage
        </Link>
        <div role="tablist" aria-label="Business" className="flex flex-wrap gap-1 rounded-xl bg-white/10 p-1 text-sm">
          {SCENES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={scene === s.id}
              className={`rounded-lg px-3 py-1.5 font-medium ${scene === s.id ? "bg-white text-ink" : "text-white/80 hover:text-white"}`}
              onClick={() => setScene(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button className="text-white/70 underline" onClick={() => setShowScript(!showScript)}>
            {showScript ? "Hide" : "Show"} script
          </button>
          <button className="text-white/70 underline" onClick={() => setPhoneSrc(`/pass?t=${Date.now()}`)}>
            Phone home
          </button>
        </div>
      </header>
      {app.config && !app.config.demo && (
        <p className="mx-4 mb-2 rounded-lg bg-amber-200 px-3 py-2 text-sm text-amber-950">Demo businesses are off. Start the app with npm run product.</p>
      )}
      <main className={`grid flex-1 gap-4 px-4 pb-4 ${showScript ? "lg:grid-cols-[minmax(0,1fr)_400px_280px]" : "lg:grid-cols-[minmax(0,1fr)_400px]"}`}>
        <section className="min-h-[70vh] overflow-hidden rounded-2xl bg-white ring-1 ring-white/10" aria-label={current.label}>
          {SCENES.map((s) => (
            <iframe key={s.id} title={s.label} src={s.src} className={`h-full min-h-[70vh] w-full ${scene === s.id ? "block" : "hidden"}`} />
          ))}
        </section>
        <section className="flex items-start justify-center" aria-label="Phone running decID Pass">
          <div className="w-full max-w-[400px] rounded-[2.6rem] bg-black p-3 shadow-2xl ring-1 ring-white/15">
            <div className="mx-auto mb-2 h-1.5 w-20 rounded-full bg-white/20" aria-hidden />
            <iframe ref={phone} title="decID Pass on a phone" src={phoneSrc} className="h-[760px] max-h-[78vh] w-full rounded-[2rem] bg-paper" />
          </div>
        </section>
        {showScript && (
          <aside className="rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10" aria-label="Demo script">
            <h2 className="font-semibold">Script</h2>
            <ol className="mt-3 flex flex-col gap-3">
              {SCRIPT.map(([t, d], i) => (
                <li key={t}>
                  <div className="font-semibold text-brand-200">
                    {i + 1}. {t}
                  </div>
                  <p className="text-white/70">{d}</p>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </main>
    </div>
  );
}
