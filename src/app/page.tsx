import Link from "next/link";
import { ArrowUpRight, Check, Minus } from "lucide-react";
import { DecidMark, DecidWordmark } from "@/components/product/brand";
import { Credential } from "@/components/product/credential";

/** decID's product page: what it is, why now, how it works, and the way into the working prototype. */

const INCIDENTS = [
  {
    when: "Oct 2025",
    who: "Discord",
    what: "About 70,000 government ID photos, sent in to prove age, exposed through a support vendor.",
    href: "https://therecord.media/discord-government-docs-exposed-breach",
    source: "The Record",
  },
  {
    when: "Jul 2025",
    who: "Tea",
    what: "About 13,000 selfies and photo IDs collected for account verification leaked from an exposed database.",
    href: "https://www.13abc.com/2025/07/26/tea-an-app-women-anonymously-talk-about-men-they-date-has-been-breached-user-ids-exposed/",
    source: "AP via 13abc",
  },
];

const STEPS = [
  ["Get verified once", "An issuer that already knows you, such as a DMV, bank or mobile carrier, signs a credential that lives on your phone. It holds yes/no answers (18+, 21+), not your birth date."],
  ["Share one answer", "A shop or a door asks “Are you 21 or older?”. Your phone shows who is asking and exactly what they’ll learn. You approve, and only that answer is sent, signed for that request."],
  ["The business keeps a receipt, not your ID", "decID checks the signature, that the credential is yours and that it hasn’t been revoked. The business gets “yes” and a signed receipt it can show a regulator."],
];

const KEEPS: [string, boolean, boolean][] = [
  ["Your name", true, false],
  ["Your date of birth", true, false],
  ["Your home address", true, false],
  ["A photo of your ID", true, false],
  ["A selfie", true, false],
  ["Proof that the age was checked", false, true],
];

const TRY = [
  ["/demo", "Demo stage", "A business’s site and a phone side by side, for presenting from one laptop."],
  ["/pass", "decID Pass", "The consumer wallet. Add Alex (36) or Sam (16)."],
  ["/demo/shop", "Hopline", "An online drinks shop with a 21+ checkout."],
  ["/demo/door", "Neon Hall", "A venue’s door screen. Scan it with your phone."],
  ["/business", "decID Verify dashboard", "What a business sees: outcomes, receipts, and the full list of stored fields."],
] as const;

export default function Home() {
  return (
    <div className="min-h-dvh bg-white font-sans text-ink-12">
      <header className="border-b border-ink-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/" aria-label="decID home">
            <DecidWordmark />
          </Link>
          <nav className="flex items-center gap-1 text-ui" aria-label="Main">
            <a href="#how" className="hidden rounded-sm px-3 py-1.5 text-ink-11 hover:bg-ink-3 sm:block">
              How it works
            </a>
            <a href="#business" className="hidden rounded-sm px-3 py-1.5 text-ink-11 hover:bg-ink-3 sm:block">
              For businesses
            </a>
            <Link href="/lab" className="hidden rounded-sm px-3 py-1.5 text-ink-11 hover:bg-ink-3 md:block">
              Protocol lab
            </Link>
            <Link href="/demo" className="press ml-2 rounded-sm bg-ink-12 px-3.5 py-1.5 font-medium text-white hover:bg-ink-11">
              Try the prototype
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div>
            <p className="text-ui font-medium text-accent">Age verification without the ID upload</p>
            <h1 className="mt-4 text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-balance sm:text-[56px]">Prove you’re 21. Nothing else.</h1>
            <p className="mt-5 max-w-[34rem] text-lead text-ink-11">
              Shops, venues and platforms now have to check ages, and most do it by collecting photos of IDs, which then leak. decID lets people prove “21 or older” with one tap, and lets businesses comply without holding anyone’s personal data.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" className="press inline-flex h-11 items-center rounded-sm bg-ink-12 px-5 text-body font-medium text-white hover:bg-ink-11">
                See it work
              </Link>
              <Link href="/pass" className="press inline-flex h-11 items-center rounded-sm border border-ink-6 px-5 text-body font-medium hover:bg-ink-2">
                Get your Pass
              </Link>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[400px]">
            <Credential holder="Alex" ageOver18 ageOver21 issuer="Simulated Identity Office" validUntil={new Date(0)} validUntilText="10/2027" documentRef="4B427F10" />
            <div className="relative -mt-6 ml-6 rounded-lg border border-ink-5 bg-white p-4 shadow-float">
              <p className="text-ui text-ink-10">Neon Hall asks</p>
              <p className="mt-0.5 text-[17px] font-semibold">Are you 21 or older?</p>
              <div className="mt-3 flex items-center justify-between rounded-sm border border-ink-5 px-3 py-2 text-ui">
                <span>21 or older</span>
                <span className="font-medium">Yes</span>
              </div>
              <p className="mt-2 text-meta text-ink-10">Not shared: name, date of birth, address, ID number, photo.</p>
            </div>
          </div>
        </section>

        <section className="border-t border-ink-5 bg-ink-2">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className="text-h2 font-semibold text-balance">Age checks became law. ID uploads became a liability.</h2>
              <p className="mt-3 text-body text-ink-11">
                The UK’s Online Safety Act age checks took effect in July 2025. The US Supreme Court upheld Texas’s age-verification law in June 2025. US states that allow alcohol delivery require the seller to verify the buyer’s age. The usual method, an ID photo plus a selfie, builds exactly the stockpiles attackers look for.
              </p>
            </div>
            <ul className="divide-y divide-ink-5 border-y border-ink-5">
              {INCIDENTS.map((i) => (
                <li key={i.who} className="grid gap-x-6 gap-y-1 py-5 sm:grid-cols-[96px_minmax(0,1fr)]">
                  <span className="num font-mono text-ui text-ink-10">{i.when}</span>
                  <div>
                    <p className="text-body">
                      <span className="font-semibold">{i.who}.</span> {i.what}
                    </p>
                    <a href={i.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-ui text-accent hover:text-accent-hover">
                      {i.source} <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-h2 font-semibold">How it works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-ink-5">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="md:px-6 md:first:pl-0 md:last:pr-0">
                <span className="num font-mono text-ui text-ink-9">0{i + 1}</span>
                <h3 className="mt-2 text-lead font-semibold">{title}</h3>
                <p className="mt-2 text-body text-ink-11">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-ink-5">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className="text-h2 font-semibold text-balance">What the business ends up holding</h2>
              <p className="mt-3 text-body text-ink-11">
                A business can’t leak what it never received. With decID, every check leaves a signed, hash-chained receipt instead of a copy of someone’s ID, and the issuer that vouched for the customer never learns where the Pass was used.
              </p>
            </div>
            <div className="overflow-x-auto" role="region" aria-label="Comparison" tabIndex={0}>
              <table className="w-full min-w-[420px] border-collapse text-body">
                <thead>
                  <tr className="text-left text-ui text-ink-10">
                    <th className="border-b border-ink-5 py-2 pr-4 font-medium">Stored per check</th>
                    <th className="border-b border-ink-5 px-4 py-2 font-medium">ID upload + selfie</th>
                    <th className="border-b border-ink-5 py-2 pl-4 font-medium">
                      <span className="inline-flex items-center gap-1.5 text-ink-12">
                        <DecidMark size={14} /> decID
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {KEEPS.map(([label, upload, decid]) => (
                    <tr key={label}>
                      <td className="border-b border-ink-4 py-2.5 pr-4">{label}</td>
                      <td className="border-b border-ink-4 px-4 py-2.5">{upload ? <span className="inline-flex items-center gap-1.5 text-bad"><Check size={15} strokeWidth={2} aria-hidden /> Kept</span> : <span className="inline-flex items-center gap-1.5 text-ink-9"><Minus size={15} strokeWidth={2} aria-hidden /> No</span>}</td>
                      <td className="border-b border-ink-4 py-2.5 pl-4">{decid ? <span className="inline-flex items-center gap-1.5 text-ok"><Check size={15} strokeWidth={2} aria-hidden /> Signed receipt</span> : <span className="inline-flex items-center gap-1.5 text-ink-9"><Minus size={15} strokeWidth={2} aria-hidden /> Never received</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="business" className="border-t border-ink-5 bg-ink-2">
          <div className="mx-auto grid max-w-6xl items-start gap-10 px-6 py-16 lg:grid-cols-2">
            <div>
              <h2 className="text-h2 font-semibold">For businesses: a few lines of code</h2>
              <p className="mt-3 text-body text-ink-11">Create a check, send the customer to the link (or show it as a QR code at the door), and read the answer. You get a yes or no, a match code and a signed receipt. Your database never holds a birth date.</p>
              <ul className="mt-5 space-y-2 text-body text-ink-11">
                <li className="flex gap-2">
                  <Check size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-12" aria-hidden /> One API for online checkout and in-person entry
                </li>
                <li className="flex gap-2">
                  <Check size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-12" aria-hidden /> Receipts verify against decID’s published key
                </li>
                <li className="flex gap-2">
                  <Check size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-12" aria-hidden /> Open standards: W3C Verifiable Credentials with SD-JWT
                </li>
              </ul>
              <Link href="/business" className="press mt-6 inline-flex h-10 items-center rounded-sm border border-ink-6 bg-white px-4 text-ui font-medium hover:bg-ink-1">
                Open the business dashboard
              </Link>
            </div>
            <pre tabIndex={0} className="overflow-x-auto rounded-md bg-ink-12 p-5 font-mono text-[13px] leading-[21px] text-ink-4">
              {`const decid = new DecidVerify({ apiKey, baseUrl });

const check = await decid.createVerification({
  policy: "age_over_21",
  reference: "order-1042",
});
// send the customer to check.walletUrl

const done = await decid.getVerification(check.id);
done.result;   // { ageOver21: true }
done.receipt;  // signed, for your auditors`}
            </pre>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-h2 font-semibold">Try the whole thing</h2>
          <p className="mt-2 text-body text-ink-10">Everything below runs on this machine, on a local test network, with synthetic people.</p>
          <ul className="mt-6 divide-y divide-ink-5 border-y border-ink-5">
            {TRY.map(([href, title, body]) => (
              <li key={href}>
                <Link href={href} className="group grid items-center gap-x-6 gap-y-1 py-4 sm:grid-cols-[220px_minmax(0,1fr)_auto]">
                  <span className="text-body font-medium group-hover:text-accent">{title}</span>
                  <span className="text-ui text-ink-10">{body}</span>
                  <ArrowUpRight size={16} strokeWidth={1.75} className="hidden text-ink-8 group-hover:text-accent sm:block" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-ink-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-meta text-ink-10">
          <span>decID is a prototype: a simulated issuer, synthetic data and a local test network. Not audited; it does not verify real identities.</span>
          <span className="flex gap-4">
            <Link href="/lab" className="hover:text-ink-12">
              Protocol lab
            </Link>
            <a href="https://github.com/ZacharyTChung/decID" target="_blank" rel="noopener noreferrer" className="hover:text-ink-12">
              Source
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
