"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, EyeOff, Fingerprint, FlaskConical, Hand, IdCard, Landmark, ShieldAlert, UserPlus, Wallet } from "lucide-react";
import { DecidMark } from "./brand";
import { Credential } from "./credential";
import { MerchantLogo, brandFor } from "./merchant";
import { Group, LargeTitle, PhoneButton, Row, SheetLayer, StepProgress } from "./pass";

/**
 * decID Pass screens shared by the hosted prototype and the Next app: the wallet home (credential,
 * activity, details) and the one-time "Add your ID" flow. Hosts supply the data and actions.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export interface WalletCard {
  holder: string;
  ageOver18: boolean;
  ageOver21: boolean;
  issuer: string;
  validUntil: Date;
  reference: string;
  /** Registry status: "Active", "Revoked", … (undefined while it is being checked). */
  status?: string;
}
export interface WalletActivity {
  merchantId: string;
  merchantName: string;
  detail: string;
  matchCode?: string | null;
}

export function WalletHome({
  people,
  activeId,
  onSwitch,
  onAdd,
  card,
  activity,
  tech,
  onRevoke,
  notice,
  unlock,
}: {
  people: { id: string; label: string }[];
  activeId?: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  card?: WalletCard;
  activity: WalletActivity[];
  tech?: { deviceKey: string; registryEntry: string; hiddenClaims: number };
  onRevoke?: () => Promise<void>;
  notice?: ReactNode;
  /** Device unlock: confirm every share with Face ID, a fingerprint or the phone's PIN. */
  unlock?: { enabled: boolean; available: boolean; onEnable: () => Promise<void>; simulated?: boolean };
}) {
  const [confirmLost, setConfirmLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [unlockError, setUnlockError] = useState<string>();

  if (!card) {
    return (
      <div className="pb-10">
        <LargeTitle title="decID Pass" subtitle="Prove your age without showing your ID." />
        <div className="px-4">
          {/* A preview of the Pass, so the empty state shows what you'll get. */}
          <div className="relative" aria-label="No ID added yet" role="img">
            <div className="pointer-events-none select-none opacity-40 blur-[0.5px] saturate-50" aria-hidden>
              <Credential holder="You" ageOver18 ageOver21 issuer="Your ID issuer" validUntil={new Date(Date.UTC(2027, 9, 1))} documentRef="--------" />
            </div>
            <div className="absolute inset-0 grid place-items-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-ui font-medium text-ink-12 shadow-card backdrop-blur">
                <DecidMark size={16} /> Your Pass appears here
              </span>
            </div>
          </div>
          <div className="mt-4">
            <PhoneButton onClick={onAdd} testId="add-id">
              Add your ID
            </PhoneButton>
          </div>
        </div>
        {notice}
        <Group title="How it works" className="mt-7">
          <Row icon={<Landmark size={18} strokeWidth={1.75} />} label="Verified once" detail="An ID issuer checks you and signs your Pass." />
          <Row icon={<EyeOff size={18} strokeWidth={1.75} />} label="One answer per request" detail="A shop learns “21 or older”, not your birth date." />
          <Row icon={<Hand size={18} strokeWidth={1.75} />} label="Nothing leaves without you" detail="You approve every share. It’s logged on this phone." />
        </Group>
      </div>
    );
  }

  const ok = card.status === "Active";
  return (
    <div className="pb-10">
      <LargeTitle
        title="decID Pass"
        trailing={
          <label className="relative inline-flex items-center">
            <span className="sr-only">Demo person on this phone</span>
            <select id="pass-person" value={activeId} onChange={(e) => (e.target.value === "__new" ? onAdd() : onSwitch(e.target.value))} className="h-8 appearance-none rounded-full border border-ink-6 bg-white pl-3 pr-7 text-ui font-medium text-ink-12">
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="__new">Add a demo person…</option>
            </select>
            <ChevronDown size={14} strokeWidth={2} className="pointer-events-none absolute right-2.5 text-ink-10" aria-hidden />
          </label>
        }
      />
      <div className="px-4">
        <Credential holder={card.holder} ageOver18={card.ageOver18} ageOver21={card.ageOver21} issuer={card.issuer} validUntil={card.validUntil} documentRef={card.reference} revoked={card.status !== undefined && !ok} />
        <p className="mt-3 flex items-center gap-2 px-1 text-ui text-ink-10" data-testid="pass-status">
          <span className={cx("h-2 w-2 rounded-full", card.status === undefined ? "bg-ink-7" : ok ? "bg-ok" : "bg-bad")} aria-hidden />
          {card.status === undefined ? "Checking the registry…" : ok ? "Active. Businesses can check it." : `${card.status === "NotRegistered" ? "Not activated" : card.status}. Businesses will refuse it.`}
        </p>
      </div>
      {notice}

      <Group title="Activity" className="mt-6" footer="Kept on this phone only. decID and your issuer don’t see this list.">
        {activity.length === 0 ? (
          <div className="px-4 py-4 text-ui text-ink-10">Nothing shared yet.</div>
        ) : (
          activity.map((h, i) => <Row key={i} icon={<MerchantLogo merchant={brandFor(h.merchantId, h.merchantName, "online")} size={28} />} label={h.merchantName} detail={h.detail} value={h.matchCode ? <span className="font-mono text-ui">{h.matchCode}</span> : undefined} />)
        )}
      </Group>

      {unlock && (
        <Group
          title="Security"
          className="mt-6"
          footer={
            unlockError ??
            (unlock.enabled
              ? "Every share needs your face, fingerprint or PIN. It stays on this phone; businesses only learn that you unlocked."
              : unlock.available
                ? "Stops anyone else who picks up your phone from using your Pass."
                : "Needs a secure connection (HTTPS or localhost) and a phone with Face ID, a fingerprint sensor or a PIN.") +
              (unlock.simulated ? " Simulated in this prototype; on a phone it’s a real passkey." : "")
          }
        >
          <Row
            icon={<Fingerprint size={18} strokeWidth={1.75} />}
            label="Face ID / fingerprint"
            value={<span data-testid="unlock-status">{unlock.enabled ? "On" : enabling ? "…" : "Off"}</span>}
            onClick={
              !unlock.enabled && unlock.available && !enabling
                ? async () => {
                    setEnabling(true);
                    setUnlockError(undefined);
                    try {
                      await unlock.onEnable();
                    } catch (e) {
                      setUnlockError((e as Error).message);
                    } finally {
                      setEnabling(false);
                    }
                  }
                : undefined
            }
          />
        </Group>
      )}

      <Group title="Credential" className="mt-6">
        <Row label="Issued by" value={<span className="text-ui">{card.issuer}</span>} />
        <Row label="Holds" value={<span className="text-ui">18+ and 21+ answers</span>} />
        {tech && <Row label="Technical details" chevron onClick={() => setShowTech(!showTech)} />}
        {tech && showTech && (
          <div className="space-y-2 bg-ink-2 px-4 py-3 text-meta text-ink-10">
            <p>
              Device key <span className="block break-all font-mono text-ink-12">{tech.deviceKey}</span>
            </p>
            <p>
              Registry entry <span className="block break-all font-mono text-ink-12">{tech.registryEntry}</span>
            </p>
            <p>W3C Verifiable Credential, SD-JWT with {tech.hiddenClaims} hidden claims, Ed25519. The registry entry is a salted hash that doesn’t identify you.</p>
          </div>
        )}
      </Group>

      <Group className="mt-6">
        <Row icon={<UserPlus size={18} strokeWidth={1.75} />} label="Add a demo person" detail="Demo only: one phone can play several people. A real Pass belongs to one person." onClick={onAdd} />
        {ok &&
          onRevoke &&
          (confirmLost ? (
            <div className="px-4 py-3">
              <p className="text-ui text-ink-11">Your issuer revokes this Pass on the public registry. Every business refuses it from the next check. The issuer isn’t told where it was used.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="press h-10 rounded-sm bg-bad-solid text-ui font-medium text-white disabled:opacity-60"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onRevoke();
                    setBusy(false);
                    setConfirmLost(false);
                  }}
                >
                  {busy ? "Revoking…" : "Revoke Pass"}
                </button>
                <button className="press h-10 rounded-sm border border-ink-6 text-ui" onClick={() => setConfirmLost(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <Row icon={<ShieldAlert size={18} strokeWidth={1.75} />} label="Report this phone lost" tone="danger" onClick={() => setConfirmLost(true)} />
          ))}
      </Group>
    </div>
  );
}

export const SAMPLE_PEOPLE = {
  alex: { label: "Alex", fullName: "Alex Rivera", dateOfBirth: "1990-04-04", country: "ZZ", documentNumber: "SYN-ALEX0001", note: "36, passes 21+ checks" },
  sam: { label: "Sam", fullName: "Sam Lee", dateOfBirth: "2010-09-15", country: "QQ", documentNumber: "SYN-SAM00001", note: "16, refused at 21+ checks" },
} as const;
export type SampleKey = keyof typeof SAMPLE_PEOPLE;
export interface IdForm {
  fullName: string;
  dateOfBirth: string;
  country: string;
  documentNumber: string;
}

/** Synthetic licences in the test wallet (the stand-in for Apple Wallet / Google Wallet). */
export const TEST_LICENCES = {
  alex: { label: "Alex", birthDate: "1990-04-04", note: "California licence · 36" },
  jo: { label: "Jo", birthDate: `${new Date().getUTCFullYear() - 19}-02-11`, note: "California licence · 19" },
} as const;
export type TestLicenceKey = keyof typeof TEST_LICENCES;

/** Getting a Pass from the government ID already in a phone wallet (see shared/mdl). */
export interface GovernmentIdOption {
  /** This browser can ask a phone wallet (W3C Digital Credentials API). */
  browserSupport: boolean;
  /** Issuing authorities the deployment trusts (not counting the test one). */
  realIssuers: string[];
  /** The deployment accepts test licences (demo, development). */
  testIds: boolean;
  onUseWallet: (label: string) => void;
  onUseTestWallet: (label: string, birthDate: string) => void;
}

/** The one-time "Add your ID" flow: use the ID in your phone's wallet, or choose an issuer and enter (synthetic) details. */
export function AddIdFlow({
  issuerName,
  steps,
  step,
  error,
  canGoBack,
  onBack,
  onSubmit,
  governmentId,
}: {
  issuerName: string;
  steps: { id: string; label: string; detail: string }[];
  step?: string;
  error?: string;
  canGoBack: boolean;
  onBack: () => void;
  onSubmit: (label: string, form: IdForm) => void;
  governmentId?: GovernmentIdOption;
}) {
  const [stage, setStage] = useState<"issuer" | "details" | "test-wallet">("issuer");
  const [licence, setLicence] = useState<TestLicenceKey>("alex");
  const [walletSheet, setWalletSheet] = useState(false);
  const [who, setWho] = useState<SampleKey | "custom">("alex");
  const [form, setForm] = useState<IdForm>({ ...SAMPLE_PEOPLE.alex });
  const pick = (k: SampleKey | "custom") => {
    setWho(k);
    if (k !== "custom") setForm({ ...SAMPLE_PEOPLE[k] });
  };

  if (step) {
    return (
      <div className="pb-10">
        <LargeTitle title="Verifying" subtitle={steps.some((s) => s.id === "asking-wallet") ? "Your government ID" : issuerName} />
        <div className="px-5 pt-2">
          <StepProgress steps={steps} current={step} />
        </div>
      </div>
    );
  }

  const back = (
    <button type="button" onClick={stage !== "issuer" ? () => setStage("issuer") : onBack} className="press inline-flex h-9 items-center gap-1 rounded-sm px-2 text-[15px] text-accent hover:text-accent-hover">
      <ArrowLeft size={17} strokeWidth={2} aria-hidden /> Back
    </button>
  );

  const gov = governmentId;
  const realWallet = gov && gov.browserSupport && gov.realIssuers.length > 0;
  if (stage === "issuer") {
    return (
      <div className="pb-10">
        <LargeTitle title="Add your ID" subtitle="Choose how to prove who you are. You only do this once." leading={canGoBack ? back : undefined} />
        {gov && (realWallet || gov.testIds) && (
          <Group
            title="ID on this phone"
            className="mb-6"
            footer={
              realWallet
                ? `Your wallet shares only whether you’re over 18 and over 21, signed by ${gov.realIssuers.join(", ")}. Not your name, birth date, photo or address.`
                : "Shares only whether you’re over 18 and over 21, signed by the state. Not your name, birth date, photo or address."
            }
          >
            {realWallet && (
              <Row icon={<Wallet size={18} strokeWidth={1.75} />} label="Driver’s licence in your wallet" detail="Apple Wallet, Google Wallet or your state’s app" chevron onClick={() => gov.onUseWallet("Me")} />
            )}
            {gov.testIds && <Row icon={<FlaskConical size={18} strokeWidth={1.75} />} label="Demo driver’s licence" detail="Pretend your phone’s wallet already holds a licence" chevron onClick={() => setStage("test-wallet")} />}
          </Group>
        )}
        <Group title={gov && (realWallet || gov.testIds) ? "Or verify with an issuer" : "ID issuers"} footer="In a real deployment: your DMV, bank or mobile carrier, which already checked your ID.">
          <Row icon={<Landmark size={18} strokeWidth={1.75} />} label={issuerName} detail="Demo issuer for this prototype" chevron onClick={() => setStage("details")} />
        </Group>
        {error && (
          <p className="mt-4 px-6 text-center text-ui text-bad" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (stage === "test-wallet" && gov) {
    const l = TEST_LICENCES[licence];
    return (
      <div className="pb-10">
        <LargeTitle title="Demo licence" subtitle="Pick whose licence is on this phone. Next, a sheet like Apple Wallet’s asks you to share only “over 18” and “over 21”." leading={back} />
        <Group title="Sample licences" footer="Fake people, signed by a test DMV made for this demo. On a real phone this step is your actual wallet, and only real DMVs are accepted.">
          {(Object.keys(TEST_LICENCES) as TestLicenceKey[]).map((k) => (
            <Row
              key={k}
              icon={<IdCard size={18} strokeWidth={1.75} />}
              label={`${TEST_LICENCES[k].label} Sample`}
              detail={TEST_LICENCES[k].note}
              onClick={() => setLicence(k)}
              value={licence === k ? <span className="text-accent">✓</span> : <span />}
            />
          ))}
        </Group>
        <div className="px-4 pt-6">
          <PhoneButton onClick={() => setWalletSheet(true)} testId="use-test-licence">
            Continue with {TEST_LICENCES[licence].label}’s licence
          </PhoneButton>
          {error && (
            <p className="mt-2 text-center text-ui text-bad" role="alert">
              {error}
            </p>
          )}
        </div>
        {walletSheet && (
          <SheetLayer labelledBy="wallet-sheet-title">
            <div className="rounded-t-[22px] bg-ink-2 px-4 pb-6 pt-3 animate-sheet-in">
              <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-ink-6" aria-hidden />
              <div className="flex items-center gap-3 px-2">
                <span className="grid h-11 w-11 place-items-center rounded-[10px] bg-ink-12 text-white">
                  <DecidMark size={22} />
                </span>
                <div>
                  <h3 id="wallet-sheet-title" className="text-[17px] font-semibold text-ink-12">
                    decID wants to verify your age
                  </h3>
                  <p className="text-ui text-ink-10">Using {l.label} Sample’s licence · test wallet</p>
                </div>
              </div>
              <div className="mt-4 divide-y divide-ink-4 overflow-hidden rounded-[12px] bg-white">
                <div className="flex items-center justify-between px-4 py-3 text-[17px]">
                  <span>Over 18</span>
                  <span className="text-ink-10">Shared</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-[17px]">
                  <span>Over 21</span>
                  <span className="text-ink-10">Shared</span>
                </div>
              </div>
              <p className="mt-2 px-2 text-meta text-ink-10">Not shared: name, birth date, photo, address, licence number. decID won’t keep this information.</p>
              <div className="mt-4 space-y-2">
                <PhoneButton
                  testId="wallet-share"
                  onClick={() => {
                    setWalletSheet(false);
                    gov.onUseTestWallet(l.label, l.birthDate);
                  }}
                >
                  Share
                </PhoneButton>
                <PhoneButton variant="plain" onClick={() => setWalletSheet(false)}>
                  Cancel
                </PhoneButton>
              </div>
            </div>
          </SheetLayer>
        )}
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(who === "custom" ? form.fullName.split(" ")[0] || "Person" : SAMPLE_PEOPLE[who].label, form);
  };
  const field = (id: string, label: string, input: ReactNode) => (
    <label htmlFor={id} className="flex min-h-12 items-center gap-3 px-4">
      <span className="w-28 shrink-0 text-[15px] text-ink-12">{label}</span>
      {input}
    </label>
  );
  const inputCls = "min-w-0 flex-1 bg-transparent py-3 text-right text-[15px] text-ink-11 outline-none placeholder:text-ink-8";

  return (
    <form onSubmit={submit} className="pb-10">
      <LargeTitle title="Your details" subtitle="Synthetic people only." leading={back} />
      <div className="px-4 pb-4">
        <div role="radiogroup" aria-label="Demo person" className="grid grid-cols-3 rounded-sm border border-ink-6 bg-white p-0.5 text-ui">
          {(["alex", "sam", "custom"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={who === k} onClick={() => pick(k)} className={cx("press h-8 rounded-xs", who === k ? "bg-ink-12 font-medium text-white" : "text-ink-11")}>
              {k === "custom" ? "Custom" : SAMPLE_PEOPLE[k].label}
            </button>
          ))}
        </div>
        <p className="mt-2 px-1 text-meta text-ink-10">{who === "custom" ? "Enter any synthetic details." : SAMPLE_PEOPLE[who].note}</p>
      </div>
      <Group footer="The issuer sees these details to vouch for you. Businesses never do. Your Pass keeps yes/no answers, not your birth date.">
        {field("pass-name", "Full name", <input id="pass-name" required className={inputCls} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />)}
        {field("pass-dob", "Date of birth", <input id="pass-dob" type="date" required className={inputCls} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />)}
        {field("pass-country", "Country", <input id="pass-country" required pattern="[A-Z]{2}" maxLength={2} className={inputCls} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />)}
        {field("pass-doc", "ID number", <input id="pass-doc" required className={cx(inputCls, "font-mono text-[14px]")} value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} />)}
      </Group>
      <div className="px-4 pt-6">
        <PhoneButton type="submit" testId="verify-me">
          Verify with {issuerName}
        </PhoneButton>
        {error && (
          <p className="mt-2 text-center text-ui text-bad" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
