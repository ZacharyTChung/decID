"use client";

import { useEffect, useState } from "react";
import { Hand, LayoutGrid, ShoppingBag } from "lucide-react";
import { useApp } from "@/components/providers";
import { DecidWordmark } from "@/components/product/brand";
import { BrowserFrame } from "@/components/product/merchant";
import { PhoneFrame } from "@/components/product/pass";

/**
 * Demo stage: a business's website (left) and a phone running decID Pass (right) on one screen,
 * for presenting from a single laptop. When the business starts an age check, it asks this page to
 * open the request in the phone (postMessage, same origin only).
 */

const SCENES = [
  { id: "shop", label: "Online checkout", url: "hopline.example/checkout", src: "/demo/shop", Icon: ShoppingBag },
  { id: "door", label: "Venue entry", url: "neonhall.example/door", src: "/demo/door", Icon: Hand },
  { id: "biz", label: "Business dashboard", url: "dashboard.decid.example", src: "/business", Icon: LayoutGrid },
] as const;

const SCRIPT = ["Add Alex’s ID on the phone", "Buy beer at Hopline", "Get into Neon Hall", "Try Sam, who is 16", "See what the business keeps"];

export default function Stage() {
  const app = useApp();
  const [scene, setScene] = useState<(typeof SCENES)[number]["id"]>("shop");
  const [phoneSrc, setPhoneSrc] = useState("/pass");

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
    <div className="min-h-dvh bg-ink-2 font-sans text-ink-12">
      <header className="border-b border-ink-5 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <DecidWordmark />
            <span className="rounded-xs border border-ink-6 px-1.5 py-px text-meta text-ink-10">Demo stage</span>
          </div>
          <nav aria-label="Scenario" className="flex flex-wrap gap-1">
            {SCENES.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setScene(id)} aria-current={scene === id ? "page" : undefined} className={`press inline-flex h-8 items-center gap-2 rounded-sm px-3 text-ui ${scene === id ? "bg-ink-12 text-white" : "text-ink-11 hover:bg-ink-3"}`}>
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </nav>
          <button className="ml-auto text-ui text-ink-10 underline underline-offset-2" onClick={() => setPhoneSrc(`/pass?t=${Date.now()}`)}>
            Phone home
          </button>
        </div>
        <ol className="relative mx-auto flex max-w-[1440px] gap-x-5 overflow-x-auto border-t border-ink-4 bg-ink-1 px-6 py-2 text-ui text-ink-10" aria-label="Script">
          {SCRIPT.map((s, i) => (
            <li key={s} className="inline-flex shrink-0 items-center gap-2">
              <span className="grid h-[18px] w-[18px] place-items-center rounded-full border border-ink-6 text-[11px]" aria-hidden>
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </header>
      {app.config && !app.config.demo && <p className="mx-6 mt-4 rounded-sm bg-warn-soft px-3 py-2 text-ui text-warn">Demo businesses are off. Start the app with npm run product.</p>}
      <main className="mx-auto grid max-w-[1440px] items-start gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_392px]">
        <section className="min-w-0" aria-label="Business website">
          <BrowserFrame url={current.url}>
            {SCENES.map((s) => (
              <iframe key={s.id} title={s.label} src={s.src} className={`h-[760px] w-full ${scene === s.id ? "block" : "hidden"}`} />
            ))}
          </BrowserFrame>
        </section>
        <section className="min-w-0 lg:sticky lg:top-6" aria-label="Phone">
          <PhoneFrame>
            <iframe title="decID Pass on a phone" src={phoneSrc} className="h-full w-full bg-ink-2" />
          </PhoneFrame>
        </section>
      </main>
    </div>
  );
}
