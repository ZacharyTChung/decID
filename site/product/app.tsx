import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BigButton, Panel, PassCard, StepList } from "../../src/components/pass/ui";
import { cx } from "../../src/components/ui";
import { NEVER_SHARED, POLICIES, friendlyReason } from "../../src/lib/shared/policies";
import type { PassProfile } from "../../src/lib/client/pass";
import { DecidCloud, MERCHANTS, SessionError, type MerchantId, type MerchantView, type Outcome, type Person, type WalletRequest } from "./cloud";

/**
 * decID, the hosted prototype: a business (left) and a phone running decID Pass (right) in one
 * page, both talking to DecidCloud (./cloud.ts), which runs decID's real issuance, registry
 * contracts, verifier and receipt code in this tab.
 */

// ---------------------------------------------------------------- app state

type PhoneScreen = { k: "home" } | { k: "verify"; back?: PhoneScreen } | { k: "request"; id: string; outcome?: Outcome };
type BizTab = "shop" | "door" | "dashboard";
type PersonaKey = keyof typeof PERSONAS;

const PERSONAS = {
  alex: { label: "Alex", fullName: "Alex Rivera", dateOfBirth: "1990-04-04", country: "ZZ", documentNumber: "SYN-ALEX0001", note: "adult" },
  sam: { label: "Sam", fullName: "Sam Lee", dateOfBirth: "2010-09-15", country: "QQ", documentNumber: "SYN-SAM00001", note: "16 years old" },
} as const;

const STEPS = [
  { id: "applying", label: "Send your application", detail: "Synthetic details go to the issuer only. It keeps only what it needs to answer yes/no questions." },
  { id: "issuing", label: "Receive your credential", detail: "Signed by the issuer and stored on this phone. Your age is saved as yes/no answers, not your birth date." },
  { id: "activating", label: "Activate", detail: "A random-looking code goes on the public registry so businesses can check the Pass is still valid." },
];

function useCloud(cloud: DecidCloud | undefined): number {
  return useSyncExternalStore(
    useCallback((fn: () => void) => cloud?.subscribe(fn) ?? (() => undefined), [cloud]),
    () => cloud?.version ?? -1,
  );
}

/** Re-renders every second, for countdowns and expiry. */
function useTick(): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

const profileOf = (p: Person): PassProfile => ({ id: p.id, label: p.label, privateKey: "", address: p.holder.wallet.address, createdAt: 0, bundle: p.holder.bundle, issuerName: p.issuerName });
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- root

function App() {
  const [cloud, setCloud] = useState<DecidCloud>();
  const [bootError, setBootError] = useState<string>();
  const [activeId, setActiveId] = useState<string>();
  const [screen, setScreen] = useState<PhoneScreen>({ k: "home" });
  const [tab, setTab] = useState<BizTab>("shop");
  const [mobileView, setMobileView] = useState<"business" | "phone">("business");
  const [visitedDashboard, setVisitedDashboard] = useState(false);
  useCloud(cloud);

  useEffect(() => {
    DecidCloud.create()
      .then(setCloud)
      .catch((e) => setBootError(describe(e)));
  }, []);

  const openOnPhone = useCallback((id: string) => {
    setScreen({ k: "request", id });
    setMobileView("phone");
  }, []);
  const chooseTab = (t: BizTab) => {
    setTab(t);
    if (t === "dashboard") setVisitedDashboard(true);
  };

  if (bootError) return <Boot error={bootError} />;
  if (!cloud) return <Boot />;
  const active = cloud.people.find((p) => p.id === activeId);

  return (
    <div className="min-h-dvh bg-ink text-white">
      <TopBar />
      <Tour cloud={cloud} visitedDashboard={visitedDashboard} onGo={(t) => (t === "phone" ? setMobileView("phone") : (chooseTab(t), setMobileView("business")))} />
      <div className="sticky top-0 z-10 flex gap-1 border-y border-white/10 bg-ink px-4 py-2 lg:hidden" role="tablist" aria-label="View">
        {(["business", "phone"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={mobileView === v} onClick={() => setMobileView(v)} className={cx("flex-1 rounded-lg px-3 py-2 text-sm font-semibold", mobileView === v ? "bg-white text-ink" : "bg-white/10 text-white/80")}>
            {v === "business" ? "Business" : "Phone (decID Pass)"}
          </button>
        ))}
      </div>
      <main className="mx-auto grid max-w-[1500px] gap-5 px-4 pb-8 pt-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className={cx("min-w-0", mobileView === "phone" && "hidden lg:block")} aria-label="Business side">
          <div role="tablist" aria-label="Business" className="mb-3 flex flex-wrap gap-1 rounded-xl bg-white/10 p-1 text-sm">
            {(
              [
                ["shop", "Hopline · online checkout"],
                ["door", "Neon Hall · venue door"],
                ["dashboard", "decID Verify · business dashboard"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => chooseTab(id)} className={cx("rounded-lg px-3 py-1.5 font-medium", tab === id ? "bg-white text-ink" : "text-white/80 hover:text-white")}>
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl bg-white text-ink ring-1 ring-white/10">
            {tab === "shop" && <Shop cloud={cloud} openOnPhone={openOnPhone} />}
            {tab === "door" && <Door cloud={cloud} openOnPhone={openOnPhone} />}
            {tab === "dashboard" && <Dashboard cloud={cloud} />}
          </div>
        </section>
        <section className={cx("min-w-0", mobileView === "business" && "hidden lg:block")} aria-label="Phone running decID Pass">
          <div className="mx-auto w-full max-w-[400px] rounded-[2.6rem] bg-black p-3 shadow-2xl ring-1 ring-white/15 lg:sticky lg:top-4">
            <div className="mx-auto mb-2 h-1.5 w-20 rounded-full bg-white/20" aria-hidden />
            <div className="h-[740px] max-h-[80vh] overflow-y-auto rounded-[2rem] bg-paper text-ink" data-testid="phone">
              <Phone
                cloud={cloud}
                active={active}
                setActive={setActiveId}
                screen={screen}
                setScreen={setScreen}
                onDone={() => setMobileView("business")}
              />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Boot({ error }: { error?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-4 text-white">
      <div className="max-w-md text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 text-xl font-bold">d</div>
        {error ? (
          <>
            <p className="mt-4 font-semibold">decID could not start in this browser.</p>
            <p className="mt-2 text-sm text-white/70">{error}</p>
            <p className="mt-2 text-sm text-white/70">It needs a recent Chrome, Edge, Safari or Firefox (Ed25519 support in Web Crypto).</p>
          </>
        ) : (
          <>
            <p className="mt-4 font-semibold">Starting decID…</p>
            <p className="mt-2 text-sm text-white/70">Deploying the credential registry to a private test network inside this page and creating the demo issuer’s keys.</p>
          </>
        )}
      </div>
    </div>
  );
}

function TopBar() {
  return (
    <header className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 pt-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 font-bold" aria-hidden>
          d
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight">decID</h1>
          <p className="text-sm text-white/70">Prove you’re 21. Nothing else.</p>
        </div>
      </div>
      <p className="max-w-xl text-xs text-white/60">Working prototype. Everything runs in this browser tab: a simulated issuer, a private test network with decID’s registry contracts, and decID’s real verification code. Synthetic people only; reload to start over.</p>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-[1500px] px-4 pb-8 text-xs text-white/50">
      Prototype: simulated issuer, synthetic data, in-page test network. Not audited; does not verify real identities. Source: github.com/ZacharyTChung/decID
    </footer>
  );
}

// ---------------------------------------------------------------- guided tour

function Tour({ cloud, visitedDashboard, onGo }: { cloud: DecidCloud; visitedDashboard: boolean; onGo: (t: BizTab | "phone") => void }) {
  const hop = cloud.list("hopline");
  const door = cloud.list("neonhall");
  const steps: { id: string; label: string; done: boolean; go: BizTab | "phone" }[] = [
    { id: "pass", label: "Get Alex a decID Pass", done: cloud.people.some((p) => p.claims.ageOver21 === true), go: "phone" },
    { id: "shop", label: "Buy beer at Hopline", done: hop.some((s) => s.status === "verified"), go: "shop" },
    { id: "door", label: "Get into Neon Hall", done: door.some((s) => s.status === "verified"), go: "door" },
    { id: "minor", label: "Try Sam (16) at either", done: [...hop, ...door].some((s) => s.failureCode === "POLICY_NOT_SATISFIED"), go: "phone" },
    { id: "biz", label: "Open the business dashboard", done: visitedDashboard, go: "dashboard" },
  ];
  const next = steps.find((s) => !s.done);
  return (
    <nav aria-label="Try it" className="mx-auto mt-4 max-w-[1500px] px-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        <li className="mr-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-200">Try it</li>
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              onClick={() => onGo(s.go)}
              className={cx(
                "flex items-center gap-2 rounded-full px-3 py-1.5 ring-1",
                s.done ? "bg-brand-500/20 text-brand-100 ring-brand-500/40" : s === next ? "bg-white text-ink ring-white" : "text-white/70 ring-white/15 hover:text-white",
              )}
              data-tour={s.id}
              data-done={s.done || undefined}
            >
              <span className={cx("grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold", s.done ? "bg-brand-500 text-white" : s === next ? "bg-ink text-white" : "bg-white/10")} aria-hidden>
                {s.done ? "✓" : i + 1}
              </span>
              {s.label}
              <span className="sr-only">{s.done ? "(done)" : ""}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------- phone: decID Pass

function Phone({
  cloud,
  active,
  setActive,
  screen,
  setScreen,
  onDone,
}: {
  cloud: DecidCloud;
  active?: Person;
  setActive: (id: string) => void;
  screen: PhoneScreen;
  setScreen: (s: PhoneScreen) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col px-4 pb-8 pt-4">
      <header className="mb-5 flex items-center justify-between gap-3">
        <button className="flex items-center gap-2 font-semibold tracking-tight" onClick={() => setScreen({ k: "home" })}>
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-700 text-sm font-bold text-white" aria-hidden>
            d
          </span>
          <span>
            decID <span className="text-brand-700">Pass</span>
          </span>
        </button>
        {cloud.people.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <span className="sr-only">Demo person</span>
            <select
              id="pass-person"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
              value={active?.id ?? ""}
              onChange={(e) => (e.target.value === "__new" ? setScreen({ k: "verify" }) : (setActive(e.target.value), screen.k === "verify" && setScreen({ k: "home" })))}
            >
              {!active && <option value="">Choose…</option>}
              {cloud.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="__new">+ Another person (demo)</option>
            </select>
          </label>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-5">
        {screen.k === "request" ? (
          <PassRequest key={screen.id} cloud={cloud} id={screen.id} person={active} outcome={screen.outcome} setOutcome={(o) => setScreen({ ...screen, outcome: o })} onVerify={() => setScreen({ k: "verify", back: screen })} onHome={() => setScreen({ k: "home" })} onDone={onDone} />
        ) : screen.k === "verify" || !active ? (
          <PassVerify
            key={cloud.people.length}
            cloud={cloud}
            hasPeople={cloud.people.length > 0}
            onDone={(p) => {
              setActive(p.id);
              setScreen(screen.k === "verify" && screen.back ? screen.back : { k: "home" });
            }}
          />
        ) : (
          <PassHome cloud={cloud} person={active} />
        )}
      </div>
    </div>
  );
}

function PassVerify({ cloud, hasPeople, onDone }: { cloud: DecidCloud; hasPeople: boolean; onDone: (p: Person) => void }) {
  const [form, setForm] = useState<{ fullName: string; dateOfBirth: string; country: string; documentNumber: string } | null>(null);
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const fill = (k: PersonaKey) => {
    setForm({ ...PERSONAS[k] });
    setLabel(PERSONAS[k].label);
  };

  if (!form) {
    return (
      <>
        <div className="mt-2">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">{hasPeople ? "Add another person" : "Prove you’re old enough. Nothing else."}</h2>
          <p className="mt-3 text-slate-600">Get verified once. Then shops and venues can check “21+” in one tap, without ever seeing your name, birth date, address or ID photo.</p>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          <li className="flex gap-2"><span className="text-brand-700" aria-hidden>●</span> No app store, no crypto wallet, no seed phrase.</li>
          <li className="flex gap-2"><span className="text-brand-700" aria-hidden>●</span> Your credential stays on this phone.</li>
          <li className="flex gap-2"><span className="text-brand-700" aria-hidden>●</span> The issuer never learns where you use it.</li>
        </ul>
        <Panel tone="brand" title="Start as a sample person">
          <div className="flex flex-col gap-2 text-sm">
            <button className="rounded-xl bg-white px-3 py-2 text-left ring-1 ring-brand-100 hover:ring-brand-500" onClick={() => fill("alex")}>
              <b>Alex</b> · born 1990 · <span className="text-slate-600">will pass 21+ checks</span>
            </button>
            <button className="rounded-xl bg-white px-3 py-2 text-left ring-1 ring-brand-100 hover:ring-brand-500" onClick={() => fill("sam")}>
              <b>Sam</b> · 16 years old · <span className="text-slate-600">will be refused at 21+ checks</span>
            </button>
          </div>
        </Panel>
      </>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      setStep("applying");
      await new Promise((r) => setTimeout(r, 350)); // let the first step be seen
      const p = await cloud.getVerified(label || form.fullName.split(" ")[0] || "Person", { dateOfBirth: form.dateOfBirth, country: form.country }, setStep);
      setStep("done");
      onDone(p);
    } catch (err) {
      setError(describe(err));
      setStep(undefined);
    }
  };

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Get verified</h2>
        <p className="mt-1 text-sm text-slate-600">Once. After this, you never upload an ID again.</p>
      </div>
      {step ? (
        <Panel>
          <StepList steps={STEPS} current={step} />
        </Panel>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Panel title="Issuer">
            <div className="flex items-center gap-3 text-sm">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-lg" aria-hidden>
                🏛
              </span>
              <div>
                <div className="font-semibold">{cloud.world.issuers[0]!.name}</div>
                <div className="text-slate-600">Simulated. In production: a DMV, bank or telecom that already checked your ID.</div>
              </div>
            </div>
          </Panel>
          <Panel title="Your details (synthetic)">
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              {(Object.keys(PERSONAS) as PersonaKey[]).map((k) => (
                <button key={k} type="button" className="rounded-full bg-brand-50 px-3 py-1 font-medium text-brand-800 ring-1 ring-brand-100" onClick={() => fill(k)}>
                  Fill as {PERSONAS[k].label} ({PERSONAS[k].note})
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="font-medium">Full name</span>
                <input id="pass-name" required className="rounded-xl border border-slate-300 px-3 py-2" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Date of birth</span>
                <input id="pass-dob" type="date" required className="rounded-xl border border-slate-300 px-3 py-2" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Country</span>
                  <input id="pass-country" required pattern="[A-Z]{2}" className="rounded-xl border border-slate-300 px-3 py-2" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">ID number</span>
                  <input id="pass-doc" required className="rounded-xl border border-slate-300 px-3 py-2" value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} />
                </label>
              </div>
            </div>
          </Panel>
          <BigButton type="submit">Verify me</BigButton>
          <p className="text-center text-xs text-slate-600">Synthetic data only. The issuer uses the birth date and country to sign yes/no answers (18+, 21+); the Pass never stores your birth date.</p>
        </form>
      )}
      {error && (
        <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
    </>
  );
}

function PassHome({ cloud, person }: { cloud: DecidCloud; person: Person }) {
  const [busy, setBusy] = useState(false);
  const [confirmLost, setConfirmLost] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const b = person.holder.bundle!;
  return (
    <>
      <PassCard profile={profileOf(person)} status={person.status} />
      <Panel title="Using your Pass">
        <div className="flex flex-col gap-2 text-sm text-slate-700">
          <p>
            <b>Online:</b> choose “Verify age with decID” at checkout.
          </p>
          <p>
            <b>At a door:</b> scan the venue’s code, tap Share, and show the 4-letter code to staff.
          </p>
          <p>
            <b>Every time:</b> you see who is asking and exactly what they learn, before anything is sent.
          </p>
        </div>
      </Panel>
      <Panel title="Where you have shared">
        {person.history.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing yet. This list lives only on this phone.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 text-sm">
            {person.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <b>{h.merchant}</b> · {h.shared}
                </span>
                <span className={h.outcome === "verified" ? "text-emerald-700" : "text-rose-700"}>{h.outcome === "verified" ? `✓ ${h.matchCode ?? ""}` : friendlyReason(h.failureCode)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {person.status === "Active" &&
        (confirmLost ? (
          <Panel>
            <p className="text-sm text-slate-700">The issuer will revoke this Pass on the public registry. Every business will refuse it from the next check on, without the issuer learning where it was used.</p>
            <div className="mt-3 flex gap-2">
              <button
                className="flex-1 rounded-xl bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await cloud.revoke(person);
                  setBusy(false);
                  setConfirmLost(false);
                }}
              >
                {busy ? "Revoking…" : "Revoke this Pass"}
              </button>
              <button className="flex-1 rounded-xl px-3 py-2 text-sm ring-1 ring-slate-300" onClick={() => setConfirmLost(false)}>
                Keep it
              </button>
            </div>
          </Panel>
        ) : (
          <button className="self-start text-sm text-slate-600 underline" onClick={() => setConfirmLost(true)}>
            Report this phone lost
          </button>
        ))}
      <button className="self-start text-sm text-slate-600 underline" onClick={() => setShowTech(!showTech)}>
        {showTech ? "Hide" : "Show"} technical details
      </button>
      {showTech && (
        <Panel title="Technical details">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-slate-600">Device key</dt>
            <dd className="break-all font-mono">{person.holder.wallet.address}</dd>
            <dt className="text-slate-600">On the registry</dt>
            <dd className="break-all font-mono">{b.commitment}</dd>
            <dt className="text-slate-600">Credential</dt>
            <dd>W3C Verifiable Credential, SD-JWT, {b.disclosures.length} hidden claims, Ed25519</dd>
          </dl>
          <p className="mt-2 text-xs text-slate-600">The registry entry is a salted hash. It does not reveal who you are or link to your name.</p>
        </Panel>
      )}
    </>
  );
}

function PassRequest({
  cloud,
  id,
  person,
  outcome,
  setOutcome,
  onVerify,
  onHome,
  onDone,
}: {
  cloud: DecidCloud;
  id: string;
  person?: Person;
  outcome?: Outcome;
  setOutcome: (o: Outcome) => void;
  onVerify: () => void;
  onHome: () => void;
  onDone: () => void;
}) {
  useTick();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [declined, setDeclined] = useState(false);
  let req: WalletRequest;
  try {
    req = cloud.walletRequest(id);
  } catch (e) {
    return <p className="text-sm text-slate-600">{describe(e)}</p>;
  }
  const venue = req.merchant.kind === "venue";
  const header = (
    <div className="flex items-center gap-3">
      <span className={cx("grid h-12 w-12 place-items-center rounded-2xl text-2xl", venue ? "bg-fuchsia-100" : "bg-amber-100")} aria-hidden>
        {venue ? "🎟" : "🛒"}
      </span>
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-600">{venue ? "Venue entry" : "Online checkout"}</div>
        <div className="text-lg font-bold">{req.merchant.name}</div>
      </div>
    </div>
  );

  if (outcome) {
    const ok = outcome.status === "verified";
    return (
      <>
        {header}
        <section className={cx("rounded-3xl p-6 text-center text-white", ok ? "bg-emerald-600" : "bg-rose-600")} aria-live="polite">
          <div className="text-5xl" aria-hidden>
            {ok ? "✓" : "✕"}
          </div>
          <div className="mt-2 text-2xl font-bold">{ok ? `${req.policy.short} confirmed` : friendlyReason(outcome.failureCode)}</div>
          <p className="mt-1 text-sm text-white">{ok ? `${req.merchant.name} now knows only: ${req.policy.short} ✓` : `${req.merchant.name} was told the check did not pass. Nothing else was shared.`}</p>
          {ok && outcome.matchCode && (
            <div className="mt-5 rounded-2xl bg-white/15 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-white/80">{venue ? "Show this code to staff" : "Match code"}</div>
              <div className="mt-1 font-mono text-4xl font-bold tracking-[0.3em]" data-testid="match-code">
                {outcome.matchCode}
              </div>
            </div>
          )}
        </section>
        <p className="text-center text-sm text-slate-600">{venue ? (ok ? "The door screen shows the same code." : "The door screen shows the same answer.") : `${req.merchant.name} has been updated.`}</p>
        <div className="flex flex-col gap-2">
          <button className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-slate-300 lg:hidden" onClick={onDone}>
            Back to {req.merchant.name}
          </button>
          <button className="text-sm font-semibold text-brand-700 underline" onClick={onHome}>
            Back to my Pass
          </button>
        </div>
      </>
    );
  }

  if (req.status !== "pending") {
    return (
      <>
        {header}
        <Panel>
          <p className="text-sm">{req.status === "expired" ? "This request expired. Ask for a new one." : "This request was already answered."}</p>
        </Panel>
      </>
    );
  }

  if (!person) {
    return (
      <>
        {header}
        <Panel>
          <p className="text-lg font-semibold">{req.policy.question}</p>
          <p className="mt-1 text-sm text-slate-600">You need a decID Pass to answer. It takes a few seconds, once.</p>
        </Panel>
        <BigButton onClick={onVerify}>Get verified</BigButton>
      </>
    );
  }

  const claimKey = POLICIES[req.policy.id].resultKey;
  const wouldFail = person.claims[claimKey] !== true;
  const left = Math.max(0, req.expiresAt - cloud.now());
  if (declined) {
    return (
      <>
        {header}
        <Panel>
          <p className="text-sm">You declined. {req.merchant.name} learned nothing.</p>
        </Panel>
        <button className="text-sm font-semibold text-brand-700 underline" onClick={onHome}>
          Back to my Pass
        </button>
      </>
    );
  }
  return (
    <>
      {header}
      <Panel>
        <div className="text-sm text-slate-600">{req.merchant.name} asks:</div>
        <div className="mt-1 text-2xl font-bold">{req.policy.question}</div>
        <div className="mt-2 text-xs text-slate-600 tabular-nums">
          Request expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <section className="rounded-2xl bg-brand-50 p-3 ring-1 ring-brand-100">
          <h3 className="font-semibold">They will learn</h3>
          <ul className="mt-2 space-y-1">
            <li>✓ {req.policy.short}: yes or no</li>
            <li>✓ Who vouched for you</li>
          </ul>
        </section>
        <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <h3 className="font-semibold">They will not see</h3>
          <ul className="mt-2 space-y-1">
            {NEVER_SHARED.map((n) => (
              <li key={n}>✕ {n}</li>
            ))}
          </ul>
        </section>
      </div>
      {wouldFail && <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">Your Pass says you are not {req.policy.short}. If you share, {req.merchant.name} will be told “no” and nothing else.</div>}
      {person.status !== "Active" && <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">This Pass is {person.status.toLowerCase()} on the registry. {req.merchant.name} will refuse it.</div>}
      <BigButton
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            setOutcome(await cloud.share(person, id));
          } catch (e) {
            setError(e instanceof SessionError ? e.message : describe(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Share “{req.policy.short}” with {req.merchant.name}
      </BigButton>
      <BigButton variant="ghost" onClick={() => setDeclined(true)}>
        Decline
      </BigButton>
      {error && (
        <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      <p className="text-center text-xs text-slate-600">Sharing signs this one request with your Pass. It cannot be reused by {req.merchant.name} or anyone else.</p>
    </>
  );
}

// ---------------------------------------------------------------- business: shared hook

/** A business's view of one check, re-read whenever decID's state changes. */
function useCheck(cloud: DecidCloud, merchant: MerchantId) {
  const [id, setId] = useState<string>();
  const [view, setView] = useState<MerchantView>();
  const version = useCloud(cloud);
  const tick = useTick(); // re-read every second too, so an expired check shows as expired
  useEffect(() => {
    if (!id) return setView(undefined);
    let live = true;
    void cloud.getSession(merchant, id).then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [cloud, merchant, id, version, tick]);
  const start = useCallback((policy: "age_over_21", reference: string) => setId(cloud.createSession(merchant, policy, reference).id), [cloud, merchant]);
  const reset = useCallback(() => setId(undefined), []);
  return { id, view: view?.id === id ? view : undefined, status: view?.id === id ? view?.status : undefined, start, reset };
}

// ---------------------------------------------------------------- Hopline

const PRODUCTS = [
  { id: "lager", name: "Dusk Lager", detail: "6 × 330 ml · 4.6%", price: 14, alcohol: true, swatch: "bg-amber-400" },
  { id: "cider", name: "Orchard Cider", detail: "4 × 440 ml · 5.0%", price: 12, alcohol: true, swatch: "bg-lime-500" },
  { id: "rye", name: "Rye Pale Ale", detail: "6 × 330 ml · 5.4%", price: 16, alcohol: true, swatch: "bg-orange-600" },
  { id: "yuzu", name: "Sparkling Yuzu", detail: "6 × 330 ml · alcohol-free", price: 9, alcohol: false, swatch: "bg-yellow-300" },
];

function Shop({ cloud, openOnPhone }: { cloud: DecidCloud; openOnPhone: (id: string) => void }) {
  const [cart, setCart] = useState<Record<string, number>>({ lager: 1, yuzu: 1 });
  const [orderRef, setOrderRef] = useState(() => `HL-${Math.floor(1000 + Math.random() * 9000)}`);
  const [showLegacy, setShowLegacy] = useState(false);
  const check = useCheck(cloud, "hopline");
  const lines = PRODUCTS.filter((p) => cart[p.id]);
  const total = lines.reduce((s, p) => s + p.price * (cart[p.id] ?? 0), 0);
  const needsAge = lines.some((p) => p.alcohol);
  const v = check.view;
  const status = check.status;
  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));
  const received = useMemo(
    () => (v && (v.status === "verified" || v.status === "rejected") ? { result: v.result, issuer: v.issuer, receipt: v.receipt ? { valid: v.receipt.valid, policy: v.receipt.payload.policy, outcome: v.receipt.payload.outcome, seq: v.receipt.payload.seq } : null } : null),
    [v],
  );
  const newOrder = () => {
    check.reset();
    setOrderRef(`HL-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  return (
    <div className="min-h-[720px] bg-[#fbf7f0] text-[#2b1d12]">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-[#2b1d12] px-4 py-4 text-[#fbf7f0]">
        <div className="flex items-center gap-2 text-xl font-black tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-[#2b1d12]" aria-hidden>
            H
          </span>
          Hopline
          <span className="ml-2 hidden text-xs font-medium text-[#d9c3a5] sm:inline">small-batch drinks, delivered</span>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs">Demo shop · not a real store</span>
      </header>
      <div className="grid gap-6 p-4 xl:grid-cols-[1fr_360px]">
        <section aria-label="Products" className="min-w-0">
          <h2 className="text-2xl font-black">This week’s picks</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PRODUCTS.map((p) => (
              <article key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ead9c2]">
                <div className={`h-14 w-10 rounded-lg ${p.swatch}`} aria-hidden />
                <div className="flex-1">
                  <div className="font-bold">{p.name}</div>
                  <div className="text-xs text-[#6b5444]">{p.detail}</div>
                  <div className="mt-1 text-sm font-semibold">${p.price}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button aria-label={`Remove one ${p.name}`} className="h-8 w-8 rounded-full ring-1 ring-[#ead9c2] disabled:opacity-40" onClick={() => add(p.id, -1)} disabled={!!check.id}>
                    −
                  </button>
                  <span className="w-5 text-center text-sm tabular-nums">{cart[p.id] ?? 0}</span>
                  <button aria-label={`Add one ${p.name}`} className="h-8 w-8 rounded-full bg-[#2b1d12] text-white disabled:opacity-40" onClick={() => add(p.id, 1)} disabled={!!check.id}>
                    +
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Checkout">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ead9c2]">
            <h2 className="font-black">Order {orderRef}</h2>
            <ul className="mt-2 text-sm">
              {lines.map((p) => (
                <li key={p.id} className="flex justify-between py-0.5">
                  <span>
                    {cart[p.id]} × {p.name} {p.alcohol && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-900">21+</span>}
                  </span>
                  <span className="tabular-nums">${p.price * (cart[p.id] ?? 0)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-[#ead9c2] pt-2 font-bold">
              <span>Total</span>
              <span className="tabular-nums">${total}</span>
            </div>
          </section>
          {!needsAge ? (
            <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-[#ead9c2]">No age check needed: nothing in your cart is alcoholic.</section>
          ) : status === "verified" ? (
            <section className="rounded-2xl bg-emerald-700 p-5 text-white shadow-sm" aria-live="polite">
              <div className="text-2xl font-black">Order confirmed ✓</div>
              <p className="mt-1 text-sm text-emerald-50">Age confirmed with decID. {orderRef} ships today.</p>
            </section>
          ) : (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ead9c2]">
              <h2 className="font-black">Age check required</h2>
              <p className="mt-1 text-sm text-[#6b5444]">US law requires us to confirm you are 21+ before selling alcohol.</p>
              {!check.id ? (
                <button onClick={() => check.start("age_over_21", orderRef)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 font-semibold text-white hover:bg-brand-600">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-white text-[11px] font-black text-brand-700" aria-hidden>
                    d
                  </span>
                  Verify age with decID
                </button>
              ) : status === "rejected" ? (
                <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-900" aria-live="polite">
                  <b>We can’t sell alcohol on this order.</b> {friendlyReason(v?.failureCode)}. Remove the 21+ items to continue, or{" "}
                  <button className="underline" onClick={() => check.start("age_over_21", orderRef)}>
                    try again
                  </button>
                  .
                </div>
              ) : status === "expired" ? (
                <div className="mt-4 text-sm">
                  The check expired.{" "}
                  <button className="font-semibold underline" onClick={() => check.start("age_over_21", orderRef)}>
                    Start again
                  </button>
                </div>
              ) : (
                <div className="mt-4 grid gap-3" aria-live="polite">
                  <button onClick={() => openOnPhone(check.id!)} className="rounded-xl bg-brand-700 px-4 py-3 font-semibold text-white" data-request-id={check.id}>
                    Continue in decID Pass →
                  </button>
                  <p className="text-xs text-[#6b5444]">Waiting for your answer. On a real phone this opens your Pass app; here it opens the phone on the right. Nothing about you is shared except whether you are 21+.</p>
                </div>
              )}
            </section>
          )}
          {received && (
            <section className="rounded-2xl bg-[#2b1d12] p-4 text-sm text-[#fbf7f0]" aria-label="What Hopline received">
              <h2 className="font-bold">What Hopline received from decID</h2>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed" tabIndex={0}>{JSON.stringify(received, null, 2)}</pre>
              <p className="mt-2 text-xs text-[#d9c3a5]">Not received: name, birth date, address, ID number, ID photo, selfie. Receipt signature checked against decID’s published key.</p>
            </section>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6b5444]">
            <button className="underline" onClick={() => setShowLegacy(!showLegacy)}>
              {showLegacy ? "Hide" : "Compare with"} a typical ID-upload checkout
            </button>
            {check.id && (
              <button className="underline" onClick={newOrder}>
                Start a new order
              </button>
            )}
          </div>
          {showLegacy && (
            <section className="rounded-2xl border-2 border-dashed border-[#d9c3a5] p-4 text-sm text-[#6b5444]">
              <b className="text-[#2b1d12]">Typical age check today</b>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Upload a photo of the front and back of your ID</li>
                <li>Take a selfie for a face match</li>
                <li>Wait while it is reviewed</li>
              </ol>
              <p className="mt-2">The shop or its vendor now stores your ID photo, home address and birth date, on every order.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Neon Hall

function Door({ cloud, openOnPhone }: { cloud: DecidCloud; openOnPhone: (id: string) => void }) {
  const check = useCheck(cloud, "neonhall");
  const [counts, setCounts] = useState({ in: 0, out: 0 });
  const [counted, setCounted] = useState<string>();
  const status = check.status;
  const v = check.view;
  const { id, start } = check;

  // Always have a live entry code on screen; replace it when it expires.
  useEffect(() => {
    if (!id || status === "expired") start("age_over_21", "door-main");
  }, [id, status, start]);
  // After an answer: count it, show it for 8 seconds, then get ready for the next guest.
  useEffect(() => {
    if (!v || (status !== "verified" && status !== "rejected") || counted === v.id) return;
    setCounted(v.id);
    setCounts((c) => (status === "verified" ? { ...c, in: c.in + 1 } : { ...c, out: c.out + 1 }));
  }, [v, status, counted]);
  useEffect(() => {
    if (!counted) return;
    const t = setTimeout(() => start("age_over_21", "door-main"), 8000);
    return () => clearTimeout(t);
  }, [counted, start]);

  const ok = status === "verified";
  const answered = status === "verified" || status === "rejected";
  return (
    <div className={cx("flex min-h-[720px] flex-col p-6 text-white", answered ? (ok ? "bg-emerald-700" : "bg-rose-700") : "bg-[#120a1c]")}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-2xl font-black uppercase tracking-[0.25em] text-fuchsia-300">Neon Hall</div>
        <div className="flex items-center gap-4 text-sm text-white/80 tabular-nums">
          <span>
            Admitted <b className="text-white">{counts.in}</b>
          </span>
          <span>
            Refused <b className="text-white">{counts.out}</b>
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">Demo venue</span>
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center" aria-live="polite">
        {answered ? (
          ok ? (
            <>
              <div className="text-6xl" aria-hidden>
                ✓
              </div>
              <div className="text-5xl font-black tracking-tight sm:text-6xl">21+ VERIFIED</div>
              <p className="text-lg">Check that the guest’s phone shows this code:</p>
              <div className="rounded-3xl bg-white/15 px-8 py-4 font-mono text-5xl font-bold tracking-[0.3em] sm:text-6xl" data-testid="door-match-code">
                {v?.matchCode}
              </div>
              <p className="text-sm text-white">Vouched for by {v?.issuer?.name}. Receipt signed and verified.</p>
            </>
          ) : (
            <>
              <div className="text-6xl" aria-hidden>
                ✕
              </div>
              <div className="text-5xl font-black tracking-tight sm:text-6xl">ENTRY REFUSED</div>
              <p className="text-2xl font-semibold" data-testid="door-reason">
                {friendlyReason(v?.failureCode)}
              </p>
              <p className="text-sm text-white">No name, birth date or photo was shared.</p>
            </>
          )
        ) : (
          <>
            <div className="text-sm font-semibold uppercase tracking-[0.3em] text-fuchsia-200">21+ venue</div>
            <div className="text-4xl font-black sm:text-5xl">Scan to enter</div>
            <p className="max-w-md text-white/80">Open your decID Pass and scan the code. You’ll see exactly what Neon Hall learns before you share.</p>
            <button className="mt-2 rounded-2xl bg-fuchsia-500 px-6 py-4 text-lg font-bold text-white shadow-lg hover:bg-fuchsia-400 disabled:opacity-50" disabled={!id || status !== "pending"} onClick={() => id && openOnPhone(id)} data-request-id={id}>
              Scan with the phone →
            </button>
            <p className="text-xs text-white/60">At a real door the kiosk shows a QR code that the guest’s phone camera scans.</p>
          </>
        )}
      </div>
      <p className="text-center text-xs text-white/60">This screen never shows a name, birth date or photo. Neon Hall stores only the outcome and a signed receipt.</p>
    </div>
  );
}

// ---------------------------------------------------------------- decID Verify dashboard

const FIELD_NOTES: Record<string, string> = {
  id: "random request id",
  merchant_id: "you",
  policy: "what you asked",
  reference: "your order or door reference",
  nonce: "one-time challenge",
  audience: "your merchant name",
  chain_id: "registry network",
  registry: "registry contract",
  created_at: "time",
  expires_at: "time",
  status: "outcome",
  failure_code: "why it failed",
  completed_at: "time",
  match_code: "4-letter door code",
  issuer_name: "who vouched",
  receipt_seq: "receipt number",
};

const NIGHT_GUESTS = 12;

function Dashboard({ cloud }: { cloud: DecidCloud }) {
  const [merchant, setMerchant] = useState<MerchantId>("neonhall");
  const [chain, setChain] = useState<Awaited<ReturnType<DecidCloud["receiptChain"]>>>();
  const [night, setNight] = useState<{ done: number; total: number; lines: string[] } | null>(null);
  const version = useCloud(cloud);
  useEffect(() => {
    let live = true;
    void cloud.receiptChain(merchant).then((c) => live && setChain(c));
    return () => {
      live = false;
    };
  }, [cloud, merchant, version]);
  const stats = cloud.stats(merchant);
  const recent = cloud.list(merchant).filter((r) => r.status !== "pending" || r.reference !== "door-main");
  const policyFails = stats.failures.POLICY_NOT_SATISFIED ?? 0;
  const fraud = stats.rejected - policyFails;
  const tampered = cloud.tamperedReceipt;

  const runNight = async () => {
    setMerchant("neonhall");
    setNight({ done: 0, total: NIGHT_GUESTS + 2, lines: [] });
    await cloud.simulateNight(NIGHT_GUESTS, (done, total, line) => setNight((n) => ({ done, total, lines: [...(n?.lines ?? []), line] })));
  };

  return (
    <div className="min-h-[720px] bg-paper text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-700 text-xs font-bold text-white" aria-hidden>
            d
          </span>
          decID <span className="text-brand-700">Verify</span>
          <span className="ml-1 text-sm font-normal text-slate-600">for business</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Signed in as</span>
          <select id="biz-merchant" className="rounded-lg border border-slate-300 bg-white px-2 py-1" value={merchant} onChange={(e) => setMerchant(e.target.value as MerchantId)}>
            <option value="neonhall">Neon Hall (venue)</option>
            <option value="hopline">Hopline (online)</option>
          </select>
        </label>
      </header>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{MERCHANTS[merchant].name}</h2>
            <p className="text-sm text-slate-600">{MERCHANTS[merchant].kind === "venue" ? "Venue" : "Online store"} · updates live</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">Personal data held: none</span>
        </div>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
          {(
            [
              ["Age checks", stats.verified + stats.rejected],
              ["Passed", stats.verified],
              ["Not old enough", policyFails],
              ["Fraud or invalid, blocked", fraud],
            ] as const
          ).map(([l, n]) => (
            <div key={l} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-3xl font-bold tabular-nums">{n}</div>
              <div className="text-sm text-slate-600">{l}</div>
            </div>
          ))}
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="font-semibold">Outcomes</h3>
            <p className="text-sm text-slate-600">Every completed check, by result.</p>
            <OutcomeBars failures={stats.failures} verified={stats.verified} />
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="font-semibold">Verification time per check</h3>
            <p className="text-sm text-slate-600">Signature, issuer trust, holder binding and live registry status, in milliseconds.</p>
            <TimingChart points={stats.verifyMs} />
          </section>
        </div>

        {merchant === "neonhall" && (
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Simulate a busy night</h3>
                <p className="text-sm text-slate-600">{NIGHT_GUESTS} synthetic guests through the door with the real flow, plus one guest showing a friend’s credential and one Pass reported lost.</p>
              </div>
              <button className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50" disabled={!!night && night.done < night.total} onClick={() => void runNight()}>
                {night && night.done < night.total ? `Running… ${night.done}/${night.total}` : night ? "Run again" : "Run the night"}
              </button>
            </div>
            {night && (
              <ol className="mt-3 grid max-h-48 gap-x-6 overflow-y-auto font-mono text-xs text-slate-700 sm:grid-cols-2" aria-label="Door log" data-testid="night-log" tabIndex={0}>
                {night.lines.map((l, i) => (
                  <li key={i} className={/^(Borrowed|Revoked)/.test(l) ? "font-semibold text-rose-700" : ""}>
                    {l}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="font-semibold">Recent checks</h3>
            <div className="mt-3 max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Recent checks table">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Reference</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Answer</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Code</th>
                    <th scope="col" className="py-2 font-medium">Vouched by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-600">
                        No checks yet. Run one from the {merchant === "neonhall" ? "Neon Hall door" : "Hopline checkout"}
                        {merchant === "neonhall" ? ", or simulate a busy night." : "."}
                      </td>
                    </tr>
                  )}
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 font-mono text-xs">{r.reference ?? "–"}</td>
                      <td className="py-2 pr-3">
                        {r.status === "verified" ? (
                          <span className="font-semibold text-emerald-700">21+ ✓</span>
                        ) : r.status === "rejected" ? (
                          <span className="font-semibold text-rose-700">{friendlyReason(r.failureCode)}</span>
                        ) : (
                          <span className="text-slate-600">{r.status}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.matchCode ?? "–"}</td>
                      <td className="py-2 text-slate-600">{r.issuer?.name ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h3 className="font-semibold">Compliance receipts</h3>
              <p className="mt-1 text-sm text-slate-600">Every check is signed by decID and chained to the previous one, so the record cannot be edited without detection. This is what a business shows a regulator instead of ID photos.</p>
              {chain && (
                <div className={cx("mt-3 rounded-xl px-3 py-2 text-sm font-semibold", chain.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")} data-testid="chain-status">
                  {chain.ok ? `Chain intact · ${chain.count} signed receipt${chain.count === 1 ? "" : "s"}` : `Tampering detected at receipt ${chain.firstBrokenSeq}: ${chain.problem}`}
                </div>
              )}
              {chain && chain.count > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  {tampered ? (
                    <button className="rounded-lg px-3 py-1.5 font-semibold ring-1 ring-slate-300" onClick={() => cloud.undoTamper()}>
                      Restore the original receipt
                    </button>
                  ) : (
                    <button className="rounded-lg px-3 py-1.5 font-semibold text-rose-800 ring-1 ring-rose-200 hover:bg-rose-50" onClick={() => void cloud.tamper(merchant)}>
                      Try it: edit a receipt as an insider
                    </button>
                  )}
                  <span className="text-xs text-slate-600">{tampered ? `Receipt ${tampered.seq}’s outcome was flipped and its hash recomputed. Only decID’s signature gives it away.` : "Flips one receipt’s outcome without decID’s signing key."}</span>
                </div>
              )}
            </section>
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h3 className="font-semibold">Everything you store per check</h3>
              <p className="mt-1 text-sm text-slate-600">The complete record. None of these fields can hold a name, birth date, address, ID number or photo.</p>
              <ul className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                {cloud.storedFields().map((f) => (
                  <li key={f} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                    <code>{f}</code>
                    <span className="text-slate-600">{FIELD_NOTES[f] ?? ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Horizontal bars, one per outcome, labelled directly (identity never by color alone). */
function OutcomeBars({ verified, failures }: { verified: number; failures: Record<string, number> }) {
  const rows: { label: string; n: number; tone: string }[] = [{ label: "Passed", n: verified, tone: "fill-emerald-600" }];
  const notOld = failures.POLICY_NOT_SATISFIED ?? 0;
  rows.push({ label: "Not old enough", n: notOld, tone: "fill-slate-500" });
  for (const [code, n] of Object.entries(failures)) if (code !== "POLICY_NOT_SATISFIED") rows.push({ label: friendlyReason(code), n, tone: "fill-rose-600" });
  const max = Math.max(1, ...rows.map((r) => r.n));
  const W = 520;
  const LABEL = 250;
  const ROW = 34;
  if (verified + Object.values(failures).reduce((a, b) => a + b, 0) === 0) return <EmptyChart text="Outcomes appear after the first check." />;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * ROW + 4}`} className="mt-3 w-full" role="img" aria-label={rows.map((r) => `${r.label}: ${r.n}`).join(", ")}>
      {rows.map((r, i) => {
        const w = Math.max(r.n ? 4 : 0, ((W - LABEL - 44) * r.n) / max);
        const y = i * ROW + 6;
        return (
          <g key={r.label}>
            <title>{`${r.label}: ${r.n}`}</title>
            <text x={0} y={y + 15} className="fill-slate-700 text-[13px]">
              {r.label}
            </text>
            <rect x={LABEL} y={y + 2} width={W - LABEL - 44} height={18} rx={4} className="fill-slate-100" />
            {r.n > 0 && <rect x={LABEL} y={y + 2} width={w} height={18} rx={4} className={r.tone} />}
            <text x={LABEL + w + 6} y={y + 16} className="fill-slate-900 text-[13px] font-semibold tabular-nums">
              {r.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Verifier time per completed check: a line with a dot per check (refusals in rose). */
function TimingChart({ points }: { points: { id: string; ms: number; ok: boolean }[] }) {
  if (points.length === 0) return <EmptyChart text="Timings appear after the first check." />;
  const W = 520;
  const H = 170;
  const L = 40;
  const B = 24;
  const T = 10;
  const top = Math.max(10, Math.ceil(Math.max(...points.map((p) => p.ms)) / 10) * 10);
  const x = (i: number) => (points.length === 1 ? L + (W - L - 10) / 2 : L + ((W - L - 14) * i) / (points.length - 1) + 4);
  const y = (ms: number) => T + (H - T - B) * (1 - ms / top);
  const median = [...points].sort((a, b) => a.ms - b.ms)[Math.floor(points.length / 2)]!.ms;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={`Median verification time ${median.toFixed(0)} ms over ${points.length} checks`}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - 4} y1={y(v)} y2={y(v)} className="stroke-slate-200" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-slate-600 text-[11px] tabular-nums">
              {v}
            </text>
          </g>
        ))}
        <text x={L} y={H - 6} className="fill-slate-600 text-[11px]">
          first check
        </text>
        <text x={W - 4} y={H - 6} textAnchor="end" className="fill-slate-600 text-[11px]">
          latest
        </text>
        {points.length > 1 && <polyline points={points.map((p, i) => `${x(i)},${y(p.ms)}`).join(" ")} fill="none" className="stroke-brand-500" strokeWidth={2} strokeLinejoin="round" />}
        {points.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.ms)} r={4.5} className={cx(p.ok ? "fill-brand-700" : "fill-rose-600", "stroke-white")} strokeWidth={2}>
            <title>{`Check ${i + 1}: ${p.ms.toFixed(1)} ms, ${p.ok ? "passed" : "refused"}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1 text-xs text-slate-600 tabular-nums">
        Median {median.toFixed(0)} ms · {points.length} check{points.length === 1 ? "" : "s"} · <span className="text-brand-700">●</span> passed <span className="text-rose-600">●</span> refused
      </p>
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="mt-3 grid h-28 place-items-center rounded-xl bg-slate-50 text-sm text-slate-600">{text}</div>;
}

// ---------------------------------------------------------------- start

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
export type { ReactNode };
