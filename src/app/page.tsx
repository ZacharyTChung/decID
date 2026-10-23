import Link from "next/link";

/**
 * decID product home. Server-rendered and static: no wallet, no session, no data.
 */

const INCIDENTS = [
  {
    when: "October 2025",
    who: "Discord",
    what: "About 70,000 government ID photos, submitted to prove age, were exposed through a support vendor.",
    href: "https://therecord.media/discord-government-docs-exposed-breach",
  },
  {
    when: "July 2025",
    who: "Tea",
    what: "About 13,000 selfies and photo IDs collected for account verification leaked from an exposed database.",
    href: "https://www.13abc.com/2025/07/26/tea-an-app-women-anonymously-talk-about-men-they-date-has-been-breached-user-ids-exposed/",
  },
];

const DIFFERENT = [
  { title: "The business keeps nothing", text: "It receives one yes/no answer. No name, birth date, address, ID number or photo ever reaches it, so there is nothing to leak." },
  { title: "Signed compliance receipts", text: "Every check produces a signed, tamper-evident receipt. A business can prove to a regulator that it checked, without holding the data." },
  { title: "The issuer can’t track you", text: "Businesses check validity on a public registry, not by calling the issuer, so the bank or DMV that vouched for you never learns where you used it." },
  { title: "One Pass, online and at the door", text: "The same credential works at an online checkout and at a venue entrance. A 4-letter match code stops someone else’s phone being used." },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-700 text-sm font-bold text-white" aria-hidden>
            d
          </span>
          decID
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-slate-700">
          <a href="#how" className="hover:text-brand-700">How it works</a>
          <a href="#business" className="hover:text-brand-700">For businesses</a>
          <Link href="/demo" className="hover:text-brand-700">Live demo</Link>
          <Link href="/lab" className="hover:text-brand-700">Protocol lab</Link>
          <Link href="/pass" className="rounded-xl bg-brand-700 px-3.5 py-2 text-white hover:bg-brand-600">Get your Pass</Link>
        </nav>
      </header>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-6 md:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">Age verification without the ID upload</p>
            <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight text-balance md:text-6xl">Prove you’re 21. Nothing else.</h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Laws now require shops, venues and platforms to check ages. Most do it by collecting photos of IDs, which then leak. decID lets people prove “21+” in one tap,
              and lets businesses comply without storing anyone’s personal data.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" className="rounded-2xl bg-brand-700 px-5 py-3 font-semibold text-white hover:bg-brand-600">See it work</Link>
              <Link href="/pass" className="rounded-2xl bg-white px-5 py-3 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">Get your Pass</Link>
            </div>
          </div>
          <div className="mx-auto w-full max-w-sm rounded-[2.2rem] bg-ink p-3 shadow-2xl" aria-label="Example: the decID Pass approval screen">
            <div className="rounded-[1.7rem] bg-paper p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-fuchsia-100 text-2xl" aria-hidden>🎟</span>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-600">Venue entry</div>
                  <div className="text-lg font-bold">Neon Hall</div>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="text-xs text-slate-600">Neon Hall asks:</div>
                <div className="text-xl font-bold">Are you 21 or older?</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-2xl bg-brand-50 p-3 ring-1 ring-brand-100">
                  <div className="font-semibold">They learn</div>
                  <div className="mt-1">✓ 21+: yes or no</div>
                </div>
                <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                  <div className="font-semibold">They never see</div>
                  <div className="mt-1 text-slate-600">✕ Name ✕ Birth date ✕ Address ✕ ID photo</div>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-brand-700 py-3 text-center font-semibold text-white">Share “21+”</div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- problem */}
        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="max-w-3xl text-3xl font-bold tracking-tight text-balance">Age checks became law. ID uploads became a liability.</h2>
            <p className="mt-3 max-w-3xl text-slate-600">
              The UK’s Online Safety Act age checks took effect in July 2025, the US Supreme Court upheld Texas’s age-verification law in June 2025, and US states that allow
              alcohol to be shipped to consumers require the seller to verify the buyer’s age. The usual method, a photo of an ID plus a selfie, creates exactly the stockpiles attackers look for:
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {INCIDENTS.map((i) => (
                <article key={i.who} className="rounded-2xl bg-paper p-5 ring-1 ring-slate-200">
                  <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">{i.when}</div>
                  <h3 className="mt-1 text-lg font-bold">{i.who}</h3>
                  <p className="mt-1 text-slate-700">{i.what}</p>
                  <a href={i.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-brand-700 underline">
                    Source
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- how */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-14">
          <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ["Get verified once", "A trusted issuer (a DMV, bank or telecom that already knows you) signs a credential that sits on your phone. It stores “18+: yes, 21+: yes”, not your birth date."],
              ["Share one answer", "A shop or door asks “Are you 21?”. Your phone shows exactly what they will learn, and you tap Share. Only that one answer leaves your phone, signed for that request only."],
              ["They check, and keep nothing", "decID verifies the issuer’s signature, that it is your credential, and that it was not revoked. The business gets “21+ ✓” and a signed receipt."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white" aria-hidden>{i + 1}</div>
                <h3 className="mt-3 text-lg font-bold">{t}</h3>
                <p className="mt-1 text-slate-600">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------------------------------------------------- different */}
        <section className="bg-brand-900 text-white">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-3xl font-bold tracking-tight">What makes decID different</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {DIFFERENT.map((d) => (
                <div key={d.title} className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                  <h3 className="text-lg font-bold">{d.title}</h3>
                  <p className="mt-1 text-brand-100">{d.text}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-3xl text-sm text-brand-100">
              Built on open standards (W3C Verifiable Credentials with SD-JWT selective disclosure), so credentials are not locked to decID.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------- business */}
        <section id="business" className="mx-auto grid max-w-6xl scroll-mt-6 gap-8 px-4 py-14 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">For businesses: a few lines of code</h2>
            <p className="mt-3 text-slate-600">
              Create a check, send the customer to the link (or show it as a QR code at the door), and read the answer. You get a yes/no, a match code and a signed
              receipt. Your database never holds a birth date.
            </p>
            <Link href="/business" className="mt-5 inline-block rounded-2xl bg-white px-5 py-3 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">
              Open the business dashboard
            </Link>
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-ink p-5 text-sm leading-relaxed text-brand-100">
            <code>{`const decid = new DecidVerify({ apiKey, baseUrl });

const check = await decid.createVerification({
  policy: "age_over_21",
  reference: "order-1042",
});
// send the customer to check.walletUrl

const done = await decid.getVerification(check.id);
done.result;   // { ageOver21: true }
done.receipt;  // signed, for your auditors`}</code>
          </pre>
        </section>

        {/* ---------------------------------------------------------- demo */}
        <section className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-3xl font-bold tracking-tight">Try the whole thing</h2>
            <p className="mt-2 text-slate-600">Everything below runs on this machine, on a local test network, with synthetic people.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["/demo", "Demo stage", "A phone and a business side by side, for presenting on one screen."],
                  ["/pass", "decID Pass", "The consumer wallet. Get verified as Alex (adult) or Sam (16)."],
                  ["/demo/shop", "Hopline", "An online drinks shop with a 21+ checkout."],
                  ["/demo/door", "Neon Hall", "A venue door screen. Scan its QR code with your phone."],
                ] as const
              ).map(([href, t, d]) => (
                <Link key={href} href={href} className="rounded-2xl bg-paper p-5 ring-1 ring-slate-200 transition hover:ring-brand-500">
                  <div className="font-bold">{t} →</div>
                  <p className="mt-1 text-sm text-slate-600">{d}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-600">
        decID is a prototype: a simulated issuer, synthetic data, a local test network. It is not audited and does not verify real identities.{" "}
        <Link href="/lab" className="underline">Protocol lab</Link> ·{" "}
        <a href="https://github.com/ZacharyTChung/decID" className="underline" target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </footer>
    </div>
  );
}
