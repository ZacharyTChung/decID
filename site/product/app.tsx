import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { Check, Hand, LayoutGrid, ShoppingBag } from "lucide-react";
import { DecidWordmark } from "../../src/components/product/brand";
import { ConsentSheet, PhoneButton, PhoneFrame, ShareResult, SheetNotice } from "../../src/components/product/pass";
import { BrowserFrame, HOPLINE, NEON_HALL, type MerchantBrand } from "../../src/components/product/merchant";
import { HoplineCheckout, type AgeCheck } from "../../src/components/product/checkout";
import { NeonHallDoor } from "../../src/components/product/door";
import { VerifyDashboard, type CheckDetail, type CheckRow } from "../../src/components/product/verify-dashboard";
import { AddIdFlow, WalletHome } from "../../src/components/product/wallet";
import type { CheckStatus } from "../../src/components/product/dashboard";
import { friendlyReason } from "../../src/lib/shared/policies";
import { DecidCloud, type MerchantId, type MerchantView, type Outcome, type Person, SessionError } from "./cloud";

/**
 * decID, the hosted prototype. A business's website (left, in a browser frame) and a phone running
 * decID Pass (right), both talking to DecidCloud (./cloud.ts), which runs decID's real issuance,
 * registry contracts, verifier and receipt code in this tab. Design: docs/DESIGN.md.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const brandOf = (id: MerchantId): MerchantBrand => (id === "hopline" ? HOPLINE : NEON_HALL);

type Scene = "shop" | "door" | "dashboard";
type PhoneScreen = { k: "home" } | { k: "add"; back?: PhoneScreen } | { k: "request"; id: string } | { k: "result"; id: string; outcome: Outcome };

const ISSUE_STEPS = [
  { id: "applying", label: "Send details to the issuer", detail: "Only the issuer sees them." },
  { id: "issuing", label: "Receive your credential", detail: "Signed by the issuer, kept on this phone." },
  { id: "activating", label: "Activate", detail: "A random code goes on the public registry." },
];

function useCloud(cloud: DecidCloud | undefined): number {
  return useSyncExternalStore(
    useCallback((fn: () => void) => cloud?.subscribe(fn) ?? (() => undefined), [cloud]),
    () => cloud?.version ?? -1,
  );
}

function useTick(ms = 1000): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

// ================================================================ shell

function App() {
  const [cloud, setCloud] = useState<DecidCloud>();
  const [bootError, setBootError] = useState<string>();
  const [activeId, setActiveId] = useState<string>();
  const [screen, setScreen] = useState<PhoneScreen>({ k: "home" });
  const [scene, setScene] = useState<Scene>("shop");
  const [mobile, setMobile] = useState<"site" | "phone">("site");
  const [sawDashboard, setSawDashboard] = useState(false);
  useCloud(cloud);

  useEffect(() => {
    DecidCloud.create()
      .then(setCloud)
      .catch((e) => setBootError(describe(e)));
  }, []);

  const openOnPhone = useCallback((id: string) => {
    setScreen({ k: "request", id });
    setMobile("phone");
  }, []);
  const go = (s: Scene) => {
    setScene(s);
    setMobile("site");
    if (s === "dashboard") setSawDashboard(true);
  };

  if (!cloud) return <Boot error={bootError} />;
  const active = cloud.people.find((p) => p.id === activeId);
  const url = scene === "shop" ? "hopline.example/checkout" : scene === "door" ? "neonhall.example/door" : "dashboard.decid.example";

  return (
    <div className="min-h-dvh bg-ink-2 font-sans text-ink-12">
      <header className="border-b border-ink-5 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <DecidWordmark />
            <span className="rounded-xs border border-ink-6 px-1.5 py-px text-meta text-ink-10">Prototype</span>
          </div>
          <nav aria-label="Scenario" className="flex flex-wrap gap-1">
            {(
              [
                ["shop", "Online checkout", ShoppingBag],
                ["door", "Venue entry", Hand],
                ["dashboard", "Business dashboard", LayoutGrid],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => go(id)}
                aria-current={scene === id ? "page" : undefined}
                className={cx("press inline-flex h-8 items-center gap-2 rounded-sm px-3 text-ui", scene === id ? "bg-ink-12 text-white" : "text-ink-11 hover:bg-ink-3")}
              >
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </nav>
          <p className="ml-auto hidden max-w-sm text-meta text-ink-10 xl:block">Runs entirely in this tab: a simulated ID issuer, decID’s registry contracts on a private test network, and decID’s verification code. Reload to start over.</p>
        </div>
        <Walkthrough cloud={cloud} sawDashboard={sawDashboard} onGo={(t) => (t === "phone" ? setMobile("phone") : go(t))} />
      </header>

      <div className="sticky top-0 z-30 border-b border-ink-5 bg-ink-2/95 px-4 py-2 backdrop-blur lg:hidden">
        <div role="tablist" aria-label="View" className="grid grid-cols-2 rounded-sm border border-ink-6 bg-white p-0.5">
          {(["site", "phone"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={mobile === v} onClick={() => setMobile(v)} className={cx("press h-8 rounded-xs text-ui", mobile === v ? "bg-ink-12 font-medium text-white" : "text-ink-11")}>
              {v === "site" ? "Website" : "Phone"}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto grid max-w-[1440px] items-start gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_392px]">
        <section className={cx("min-w-0", mobile === "phone" && "hidden lg:block")} aria-label="Business website">
          <BrowserFrame url={url}>
            {scene === "shop" && <Shop cloud={cloud} openOnPhone={openOnPhone} />}
            {scene === "door" && <Door cloud={cloud} openOnPhone={openOnPhone} />}
            {scene === "dashboard" && <Dashboard cloud={cloud} />}
          </BrowserFrame>
        </section>
        <section className={cx("min-w-0 lg:sticky lg:top-6", mobile === "site" && "hidden lg:block")} aria-label="Phone">
          <PhoneFrame>
            <PassApp cloud={cloud} active={active} setActive={setActiveId} screen={screen} setScreen={setScreen} onBackToSite={() => setMobile("site")} />
          </PhoneFrame>
        </section>
      </main>

      <footer className="mx-auto max-w-[1440px] px-4 pb-10 text-meta text-ink-10 sm:px-6">Prototype. The issuer is simulated, the people are synthetic and the network is private to this page. Not audited; it does not verify real identities. Source: github.com/ZacharyTChung/decID</footer>
    </div>
  );
}

function Boot({ error }: { error?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink-2 px-4 font-sans text-ink-12">
      <div className="max-w-sm">
        <DecidWordmark />
        {error ? (
          <div className="mt-6" role="alert">
            <p className="text-body font-medium">decID couldn’t start in this browser.</p>
            <p className="mt-1 text-ui text-ink-10">{error}. It needs a recent Chrome, Edge, Safari or Firefox.</p>
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-3 text-ui text-ink-10">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.75px] border-ink-12 border-t-transparent" aria-hidden />
            Deploying the registry to a private network in this page…
          </div>
        )}
      </div>
    </div>
  );
}

function Walkthrough({ cloud, sawDashboard, onGo }: { cloud: DecidCloud; sawDashboard: boolean; onGo: (t: Scene | "phone") => void }) {
  const hop = cloud.list("hopline");
  const door = cloud.list("neonhall");
  const steps: { id: string; label: string; done: boolean; go: Scene | "phone" }[] = [
    { id: "pass", label: "Add Alex’s ID on the phone", done: cloud.people.some((p) => p.claims.ageOver21 === true), go: "phone" },
    { id: "shop", label: "Buy beer at Hopline", done: hop.some((s) => s.status === "verified"), go: "shop" },
    { id: "door", label: "Get into Neon Hall", done: door.some((s) => s.status === "verified"), go: "door" },
    { id: "minor", label: "Try Sam, who is 16", done: [...hop, ...door].some((s) => s.failureCode === "POLICY_NOT_SATISFIED"), go: "phone" },
    { id: "biz", label: "See what the business keeps", done: sawDashboard, go: "dashboard" },
  ];
  const next = steps.find((s) => !s.done);
  return (
    <nav aria-label="Walkthrough" className="border-t border-ink-4 bg-ink-1">
      <ol className="relative mx-auto flex max-w-[1440px] gap-x-5 gap-y-1 overflow-x-auto px-4 py-2 text-ui sm:px-6">
        {steps.map((s, i) => (
          <li key={s.id} className="shrink-0">
            <button onClick={() => onGo(s.go)} data-tour={s.id} data-done={s.done || undefined} className={cx("inline-flex items-center gap-2 py-1", s === next ? "font-medium text-ink-12" : s.done ? "text-ink-10" : "text-ink-9 hover:text-ink-12")}>
              <span className={cx("grid h-[18px] w-[18px] place-items-center rounded-full text-[11px]", s.done ? "bg-ink-12 text-white" : s === next ? "border border-ink-12 text-ink-12" : "border border-ink-6 text-ink-9")} aria-hidden>
                {s.done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
              </span>
              {s.label}
              <span className="sr-only">{s.done ? " (done)" : s === next ? " (next)" : ""}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ================================================================ decID Pass (phone)

const ISSUER = "Simulated Identity Office";

function PassApp({ cloud, active, setActive, screen, setScreen, onBackToSite }: { cloud: DecidCloud; active?: Person; setActive: (id: string) => void; screen: PhoneScreen; setScreen: (s: PhoneScreen) => void; onBackToSite: () => void }) {
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();

  if (screen.k === "add") {
    return (
      <AddIdFlow
        key={cloud.people.length}
        issuerName={ISSUER}
        steps={ISSUE_STEPS}
        step={step}
        error={error}
        canGoBack={cloud.people.length > 0 || !!screen.back}
        onBack={() => setScreen(screen.back ?? { k: "home" })}
        onSubmit={async (label, form) => {
          setError(undefined);
          try {
            setStep("applying");
            await new Promise((r) => setTimeout(r, 300));
            const p = await cloud.getVerified(label, { dateOfBirth: form.dateOfBirth, country: form.country }, setStep);
            setActive(p.id);
            setScreen(screen.back ?? { k: "home" });
          } catch (e) {
            setError(describe(e));
          } finally {
            setStep(undefined);
          }
        }}
      />
    );
  }
  if (screen.k === "result") {
    const req = cloud.walletRequest(screen.id);
    const m = brandOf(req.merchant.id);
    return (
      <ShareResult
        ok={screen.outcome.status === "verified"}
        merchant={m}
        item="21 or older"
        matchCode={screen.outcome.matchCode}
        reason={friendlyReason(screen.outcome.failureCode)}
        doneLabel={`Back to ${m.name}`}
        onDone={() => {
          setScreen({ k: "home" });
          onBackToSite();
        }}
      />
    );
  }
  const b = active?.holder.bundle;
  return (
    <>
      <WalletHome
        people={cloud.people.map((p) => ({ id: p.id, label: p.label }))}
        activeId={active?.id}
        onSwitch={setActive}
        onAdd={() => setScreen({ k: "add" })}
        card={
          active && b
            ? {
                holder: active.label,
                ageOver18: active.claims.ageOver18 === true,
                ageOver21: active.claims.ageOver21 === true,
                issuer: ISSUER,
                validUntil: new Date(b.authorization.expiresAt * 1000),
                reference: b.commitment.slice(2, 10).toUpperCase(),
                status: active.status,
              }
            : undefined
        }
        activity={(active?.history ?? []).map((h) => ({
          merchantId: h.merchant === "Hopline" ? "hopline" : "neonhall",
          merchantName: h.merchant,
          detail: `${h.outcome === "verified" ? "Shared “21 or older”" : friendlyReason(h.failureCode)} · ${new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
          matchCode: h.matchCode,
        }))}
        tech={active && b ? { deviceKey: active.holder.wallet.address, registryEntry: b.commitment, hiddenClaims: b.disclosures.length } : undefined}
        onRevoke={active ? () => cloud.revoke(active) : undefined}
      />
      {screen.k === "request" && (
        <Request cloud={cloud} id={screen.id} person={active} onAdd={() => setScreen({ k: "add", back: screen })} onClose={() => setScreen({ k: "home" })} onAnswered={(o) => setScreen({ k: "result", id: screen.id, outcome: o })} />
      )}
    </>
  );
}

function Request({ cloud, id, person, onAdd, onClose, onAnswered }: { cloud: DecidCloud; id: string; person?: Person; onAdd: () => void; onClose: () => void; onAnswered: (o: Outcome) => void }) {
  useTick();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  let req: ReturnType<DecidCloud["walletRequest"]>;
  try {
    req = cloud.walletRequest(id);
  } catch (e) {
    return <SheetNotice onClose={onClose} title="Request not found" body={describe(e)} />;
  }
  const m = brandOf(req.merchant.id);
  if (req.status !== "pending") return <SheetNotice onClose={onClose} title={req.status === "expired" ? "This request expired" : "Already answered"} body={req.status === "expired" ? `Ask ${m.name} for a new one.` : "Each request can be answered once."} />;
  if (!person) {
    return (
      <SheetNotice onClose={onClose} title={`${m.name} asks if you’re 21 or older`} body="Add your ID to answer. It takes a few seconds, and you only do it once." merchant={m}>
        <PhoneButton onClick={onAdd}>Add your ID</PhoneButton>
      </SheetNotice>
    );
  }
  return (
    <ConsentSheet
      merchant={m}
      item="21 or older"
      answer={person.claims.ageOver21 === true}
      revoked={person.status !== "Active"}
      expiresIn={Math.max(0, req.expiresAt - cloud.now())}
      busy={busy}
      error={error}
      onCancel={onClose}
      onShare={async () => {
        setBusy(true);
        setError(undefined);
        try {
          onAnswered(await cloud.share(person, id));
        } catch (e) {
          setError(e instanceof SessionError ? e.message : describe(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

// ================================================================ business side

/** A business's age check, backed by the in-page decID (the Next app backs the same UI over HTTP). */
function useAgeCheck(cloud: DecidCloud, merchant: MerchantId, openOnPhone: (id: string) => void, withQr = false): AgeCheck {
  const [id, setId] = useState<string>();
  const [view, setView] = useState<MerchantView>();
  const [qrSvg, setQr] = useState<string>();
  const version = useCloud(cloud);
  const tick = useTick();
  useEffect(() => {
    if (!id) return setView(undefined);
    let live = true;
    void cloud.getSession(merchant, id).then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [cloud, merchant, id, version, tick]);
  useEffect(() => {
    if (!id || !withQr) return setQr(undefined);
    void QRCode.toString(`decid://request/${id}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0E0B12", light: "#FFFFFF" } }).then(setQr);
  }, [id, withQr]);
  const start = useCallback((reference: string) => setId(cloud.createSession(merchant, "age_over_21", reference).id), [cloud, merchant]);
  const reset = useCallback(() => setId(undefined), []);
  const v = view?.id === id ? view : undefined;
  const done = v && (v.status === "verified" || v.status === "rejected");
  return {
    id,
    status: v?.status,
    failureCode: v?.failureCode,
    matchCode: v?.matchCode,
    issuerName: v?.issuer?.name,
    received: done ? { result: v.result, issuer: v.issuer, receipt: v.receipt ? { valid: v.receipt.valid, policy: v.receipt.payload.policy, outcome: v.receipt.payload.outcome, seq: v.receipt.payload.seq } : null } : undefined,
    qrSvg,
    start,
    reset,
    open: () => id && openOnPhone(id),
  };
}

function Shop({ cloud, openOnPhone }: { cloud: DecidCloud; openOnPhone: (id: string) => void }) {
  return <HoplineCheckout check={useAgeCheck(cloud, "hopline", openOnPhone)} />;
}

function Door({ cloud, openOnPhone }: { cloud: DecidCloud; openOnPhone: (id: string) => void }) {
  return <NeonHallDoor check={useAgeCheck(cloud, "neonhall", openOnPhone, true)} />;
}

const NIGHT_GUESTS = 12;
const toRow = (v: MerchantView): CheckRow => ({ id: v.id, reference: v.reference, status: v.status as CheckStatus, failureCode: v.failureCode, matchCode: v.matchCode, issuerName: v.issuer?.name ?? null, createdAt: v.createdAt, completedAt: v.completedAt });

function Dashboard({ cloud }: { cloud: DecidCloud }) {
  const [merchant, setMerchant] = useState<MerchantId>("neonhall");
  const [chain, setChain] = useState<Awaited<ReturnType<DecidCloud["receiptChain"]>>>();
  const [night, setNight] = useState<{ done: number; total: number; lines: string[] } | null>(null);
  const version = useCloud(cloud);
  const tick = useTick(5000);
  useEffect(() => {
    let live = true;
    void cloud.receiptChain(merchant).then((c) => live && setChain(c));
    return () => {
      live = false;
    };
  }, [cloud, merchant, version]);
  const checks = useMemo(() => cloud.list(merchant).filter((r) => r.status !== "pending").map(toRow), [cloud, merchant, version, tick]);
  const tampered = cloud.tamperedReceipt;
  return (
    <VerifyDashboard
      merchant={brandOf(merchant)}
      merchants={[NEON_HALL, HOPLINE]}
      onMerchant={(id) => setMerchant(id as MerchantId)}
      keyHint={`dk_test_••••${merchant === "hopline" ? "h7Qa" : "n2Xe"}`}
      stats={cloud.stats(merchant)}
      checks={checks}
      chain={chain}
      storedFields={cloud.storedFields()}
      now={cloud.now()}
      receiptKeyId={cloud.receiptKid}
      loadCheck={async (id): Promise<CheckDetail> => {
        const v = await cloud.getSession(merchant, id);
        return { ...toRow(v), answer: v.result ? Object.values(v.result)[0]! : null, verifyMs: v.verifyMs, receipt: v.receipt ? { valid: v.receipt.valid, payload: v.receipt.payload as unknown as Record<string, unknown> } : null };
      }}
      receipts={cloud.receiptRows(merchant).map((r) => ({ seq: r.seq, hash: r.hash, prev: r.prev, outcome: r.body ? (r.body.outcome === "satisfied" ? "21 or older" : friendlyReason(r.body.failureCode)) : "Unreadable", signedAt: r.body?.iat ?? null }))}
      integrity={{ tamperedSeq: tampered && tampered.merchantId === merchant ? tampered.seq : null, tamper: () => void cloud.tamper(merchant), undo: () => cloud.undoTamper() }}
      simulate={
        merchant === "neonhall"
          ? {
              label: "Simulate a busy night",
              description: `${NIGHT_GUESTS} synthetic guests through the real flow, plus a borrowed credential and a Pass reported lost.`,
              progress: night,
              run: () => {
                setNight({ done: 0, total: NIGHT_GUESTS + 2, lines: [] });
                void cloud.simulateNight(NIGHT_GUESTS, (done, total, line) => setNight((n) => ({ done, total, lines: [...(n?.lines ?? []), line] })));
              },
            }
          : undefined
      }
    />
  );
}

// ================================================================ start

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
