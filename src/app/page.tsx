import Link from "next/link";
import { ArrowUpRight, ChevronRight, EyeOff, Landmark, ReceiptText } from "lucide-react";
import { DecidMark, DecidWordmark } from "@/components/product/brand";
import { Credential } from "@/components/product/credential";

/** decID's product page, in the manner of Apple's product pages: one idea per band, the product shown large. */

const INCIDENTS = [
  {
    when: "October 2025",
    who: "Discord",
    what: "About 70,000 government ID photos, sent in to prove age, exposed through a support vendor.",
    href: "https://therecord.media/discord-government-docs-exposed-breach",
    source: "The Record",
  },
  {
    when: "July 2025",
    who: "Tea",
    what: "About 13,000 selfies and photo IDs collected for account verification leaked from an exposed database.",
    href: "https://www.13abc.com/2025/07/26/tea-an-app-women-anonymously-talk-about-men-they-date-has-been-breached-user-ids-exposed/",
    source: "AP via 13abc",
  },
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
  ["/demo", "Demo stage", "A business’s site and a phone, side by side."],
  ["/pass", "decID Pass", "The wallet. Add Alex (36) or Sam (16)."],
  ["/demo/shop", "Hopline", "An online drinks shop with a 21+ checkout."],
  ["/demo/door", "Neon Hall", "A venue’s door screen."],
  ["/business", "decID Verify", "What a business sees and keeps."],
] as const;

const band = "mx-auto max-w-[980px] px-6";

export default function Home() {
  return (
    <div className="min-h-dvh bg-white font-sans text-ink-12">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-[980px] items-center justify-between gap-6 px-6">
          <Link href="/" aria-label="decID home">
            <DecidWordmark />
          </Link>
          <nav className="flex items-center gap-6 text-meta text-ink-11" aria-label="Main">
            <a href="#how" className="hidden hover:text-ink-12 sm:block">
              How it works
            </a>
            <a href="#business" className="hidden hover:text-ink-12 sm:block">
              Businesses
            </a>
            <Link href="/lab" className="hidden hover:text-ink-12 md:block">
              Protocol lab
            </Link>
            <Link href="/demo" className="press rounded-full bg-accent px-3 py-1 font-medium text-white hover:bg-accent-hover">
              Try it
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="overflow-hidden pt-20 text-center">
          <div className={band}>
            <p className="text-lead font-semibold text-accent">decID Pass</p>
            <h1 className="mx-auto mt-2 max-w-[820px] font-display text-[48px] font-semibold leading-[1.05] tracking-[-0.035em] text-balance sm:text-[72px]">Prove you’re 21. Nothing else.</h1>
            <p className="mx-auto mt-5 max-w-[640px] text-[21px] leading-[1.4] tracking-[-0.01em] text-ink-10">Get verified once. Then answer “21 or older?” with one tap, online or at the door, without ever showing your ID.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-lead">
              <Link href="/demo" className="press rounded-full bg-accent px-6 py-2.5 text-white hover:bg-accent-hover">
                Try the prototype
              </Link>
              <a href="#how" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                Learn more <ChevronRight size={18} strokeWidth={2} aria-hidden />
              </a>
            </div>
          </div>
          <div className="relative mx-auto mt-16 w-full max-w-[520px] px-6 pb-24">
            <Credential holder="Alex" ageOver18 ageOver21 issuer="Simulated Identity Office" validUntil={new Date(0)} validUntilText="10/2027" documentRef="4B427F10" />
            <div className="relative mx-auto -mt-3 w-[86%] rounded-[22px] bg-white p-5 text-left shadow-float ring-1 ring-black/5">
              <p className="text-ui text-ink-10">Neon Hall asks</p>
              <p className="mt-0.5 text-[19px] font-semibold tracking-[-0.01em]">Are you 21 or older?</p>
              <div className="mt-3 flex items-center justify-between rounded-[12px] bg-ink-2 px-4 py-3 text-body">
                <span>21 or older</span>
                <span className="font-medium">Yes</span>
              </div>
              <p className="mt-3 text-meta text-ink-10">Not shared: name, date of birth, address, ID number, photo.</p>
            </div>
          </div>
        </section>

        <section className="bg-ink-2 py-24">
          <div className={band}>
            <h2 className="mx-auto max-w-[720px] text-center font-display text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-[48px]">Age checks became law. ID uploads became a liability.</h2>
            <p className="mx-auto mt-5 max-w-[680px] text-center text-[19px] leading-[1.45] text-ink-10">
              The UK’s Online Safety Act age checks began in July 2025, and the US Supreme Court upheld Texas’s age-verification law in June 2025. The usual method, an ID photo plus a selfie, builds exactly the stockpiles attackers look for.
            </p>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              {INCIDENTS.map((i) => (
                <article key={i.who} className="rounded-[28px] bg-white p-8">
                  <p className="text-ui text-ink-10">{i.when}</p>
                  <h3 className="mt-1 font-display text-h2 font-semibold">{i.who}</h3>
                  <p className="mt-3 text-lead text-ink-11">{i.what}</p>
                  <a href={i.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-body text-accent hover:underline">
                    {i.source} <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="py-24">
          <div className={band}>
            <h2 className="text-center font-display text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[48px]">Simple by design.</h2>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {(
                [
                  [Landmark, "Verified once", "A DMV, bank or mobile carrier that already knows you signs a credential that lives on your phone. It holds yes/no answers, not your birth date."],
                  [EyeOff, "One answer per request", "Your phone shows who is asking and what they’ll learn. You approve, and only “21 or older: yes” is sent, signed for that request alone."],
                  [ReceiptText, "A receipt, not your ID", "The business gets a yes and a signed receipt for its regulator. The issuer never learns where you used your Pass."],
                ] as const
              ).map(([Icon, title, body]) => (
                <article key={title} className="rounded-[28px] bg-ink-2 p-8">
                  <Icon size={28} strokeWidth={1.5} className="text-ink-12" aria-hidden />
                  <h3 className="mt-5 text-h3 font-semibold">{title}</h3>
                  <p className="mt-2 text-body text-ink-10">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-ink-2 py-24">
          <div className={band}>
            <h2 className="mx-auto max-w-[720px] text-center font-display text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-[48px]">A business can’t leak what it never received.</h2>
            <div className="mx-auto mt-12 max-w-[760px] overflow-x-auto rounded-[28px] bg-white p-4 sm:p-8" role="region" aria-label="What each method stores" tabIndex={0}>
              <table className="w-full min-w-[440px] border-collapse text-body">
                <thead>
                  <tr className="text-left text-ui text-ink-10">
                    <th className="pb-3 pr-4 font-normal">Stored per check</th>
                    <th className="px-4 pb-3 font-normal">ID upload + selfie</th>
                    <th className="pb-3 pl-4 font-normal">
                      <span className="inline-flex items-center gap-1.5 text-ink-12">
                        <DecidMark size={14} /> decID
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {KEEPS.map(([label, upload, decid]) => (
                    <tr key={label} className="border-t border-ink-4">
                      <td className="py-3.5 pr-4">{label}</td>
                      <td className={`px-4 py-3.5 ${upload ? "text-bad" : "text-ink-10"}`}>{upload ? "Kept" : "No"}</td>
                      <td className={`py-3.5 pl-4 ${decid ? "font-medium text-ok" : "text-ink-10"}`}>{decid ? "Signed receipt" : "Never received"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="business" className="py-24">
          <div className={`${band} grid items-center gap-12 lg:grid-cols-2`}>
            <div>
              <p className="text-lead font-semibold text-accent">decID Verify</p>
              <h2 className="mt-2 font-display text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">For businesses, a few lines of code.</h2>
              <p className="mt-5 text-[19px] leading-[1.45] text-ink-10">Ask one question, read one answer, keep one signed receipt. It works the same at an online checkout and at a door.</p>
              <Link href="/business" className="mt-6 inline-flex items-center gap-0.5 text-lead text-accent hover:underline">
                See the dashboard <ChevronRight size={18} strokeWidth={2} aria-hidden />
              </Link>
            </div>
            <pre tabIndex={0} className="overflow-x-auto rounded-[22px] bg-ink-12 p-6 font-mono text-[13px] leading-[21px] text-ink-4">
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

        <section className="bg-ink-2 py-24">
          <div className={band}>
            <h2 className="text-center font-display text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[48px]">Try the whole thing.</h2>
            <p className="mt-4 text-center text-[19px] text-ink-10">Runs on this machine, on a local test network, with synthetic people.</p>
            <ul className="mx-auto mt-10 max-w-[760px] divide-y divide-ink-4 overflow-hidden rounded-[22px] bg-white">
              {TRY.map(([href, title, body]) => (
                <li key={href}>
                  <Link href={href} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-ink-1">
                    <span className="min-w-0 flex-1">
                      <span className="block text-lead font-medium">{title}</span>
                      <span className="block text-ui text-ink-10">{body}</span>
                    </span>
                    <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-ink-8" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-4 bg-ink-2">
        <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-between gap-3 px-6 py-5 text-meta text-ink-10">
          <span>decID is a prototype: simulated issuer, synthetic data, local test network. Not audited; it does not verify real identities.</span>
          <span className="flex gap-5">
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
