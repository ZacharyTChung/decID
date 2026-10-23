"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/components/providers";
import { BigButton, Panel, PassCard, PassFrame, StepList } from "@/components/pass/ui";
import { describeError } from "@/lib/client/errors";
import {
  activate,
  activeProfile,
  createProfile,
  credentialStatus,
  deleteProfile,
  getVerified,
  history,
  listProfiles,
  setActive,
  type HistoryEntry,
  type PassProfile,
  type Step,
} from "@/lib/client/pass";
import { deriveHolderDid } from "@/lib/shared/did-pkh";
import { friendlyReason } from "@/lib/shared/policies";

const PERSONAS = {
  alex: { label: "Alex", fullName: "Alex Rivera", dateOfBirth: "1990-04-04", country: "ZZ", documentNumber: "SYN-ALEX0001", note: "adult" },
  sam: { label: "Sam", fullName: "Sam Lee", dateOfBirth: "2010-09-15", country: "QQ", documentNumber: "SYN-SAM00001", note: "16 years old" },
} as const;

/** Only the application fields (the issuer's schema is strict and rejects anything else). */
function applicationOf(k: keyof typeof PERSONAS): { fullName: string; dateOfBirth: string; country: string; documentNumber: string } {
  const { fullName, dateOfBirth, country, documentNumber } = PERSONAS[k];
  return { fullName, dateOfBirth, country, documentNumber };
}

const STEPS = [
  { id: "applying", label: "Send your application", detail: "Synthetic details go to the issuer only. They are erased after the decision." },
  { id: "waiting-review", label: "Issuer review", detail: "The demo issuer approves at once; a real one would check your documents." },
  { id: "issuing", label: "Receive your credential", detail: "Signed by the issuer and stored on this phone. Your age is saved as yes/no answers, not your birth date." },
  { id: "activating", label: "Activate", detail: "A random-looking code goes on the registry so businesses can check it is still valid. decID pays the fee." },
];

function PassHome() {
  const app = useApp();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [profiles, setProfiles] = useState<PassProfile[]>();
  const [profile, setProfile] = useState<PassProfile>();
  const [status, setStatus] = useState<string>();
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  const [step, setStep] = useState<Step>();
  const [error, setError] = useState<string>();
  const [form, setForm] = useState(() => applicationOf("alex"));
  const [showTech, setShowTech] = useState(false);

  const reload = useCallback(async () => {
    const all = await listProfiles();
    const p = await activeProfile();
    setProfiles(all);
    setProfile(p);
    setHist(p ? await history(p.id) : []);
    setStatus(undefined);
    if (p?.bundle) setStatus(await credentialStatus(p.bundle).catch(() => "Unknown"));
  }, []);

  useEffect(() => {
    void reload().catch((e) => setError(describeError(e)));
  }, [reload]);

  const create = async (persona?: keyof typeof PERSONAS) => {
    setError(undefined);
    const p = await createProfile(persona ? PERSONAS[persona].label : `Person ${(profiles?.length ?? 0) + 1}`);
    if (persona) setForm(applicationOf(persona));
    await reload();
    return p;
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile || !app.config) return;
    setError(undefined);
    try {
      const done = await getVerified(profile, app.config, form, setStep);
      setProfile(done);
      await reload();
      if (next?.startsWith("/pass/r/")) router.push(next);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setStep(undefined);
    }
  };

  const retryActivation = async () => {
    if (!profile || !app.config) return;
    setError(undefined);
    try {
      setStep("activating");
      await activate(profile, app.config);
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setStep(undefined);
    }
  };

  const wrongDeployment =
    profile?.bundle && app.config && (profile.bundle.deployment.registry.toLowerCase() !== app.config.registry.toLowerCase() || profile.bundle.authorization.deploymentId !== app.config.deploymentId);

  const frame = (children: React.ReactNode) => (
    <PassFrame
      profiles={profiles}
      active={profile}
      onSwitch={async (id) => {
        await setActive(id);
        await reload();
      }}
      onAdd={() => void create()}
    >
      {children}
      {error && (
        <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
    </PassFrame>
  );

  if (!profiles) return frame(<p className="text-sm text-slate-600">Opening your Pass…</p>);

  // ---------------------------------------------------------------- welcome
  if (!profile) {
    return frame(
      <>
        <div className="mt-4">
          <h1 className="text-3xl font-bold leading-tight tracking-tight">Prove you’re old enough. Nothing else.</h1>
          <p className="mt-3 text-slate-600">Get verified once. Then shops and venues can check “21+” in one tap, without ever seeing your name, birth date, address or ID photo.</p>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          <li className="flex gap-2"><span className="text-brand-700" aria-hidden>●</span> No app store, no crypto wallet, no seed phrase.</li>
          <li className="flex gap-2"><span className="text-brand-700" aria-hidden>●</span> Your credential stays on this phone.</li>
          <li className="flex gap-2"><span className="text-brand-700" aria-hidden>●</span> The issuer never learns where you use it.</li>
        </ul>
        <BigButton onClick={() => void create("alex")}>Create my Pass</BigButton>
        <Panel tone="brand" title="Demo: start as a sample person">
          <div className="flex flex-col gap-2 text-sm">
            <button className="rounded-xl bg-white px-3 py-2 text-left ring-1 ring-brand-100 hover:ring-brand-500" onClick={() => void create("alex")}>
              <b>Alex</b> · born 1990 · <span className="text-slate-600">will pass 21+ checks</span>
            </button>
            <button className="rounded-xl bg-white px-3 py-2 text-left ring-1 ring-brand-100 hover:ring-brand-500" onClick={() => void create("sam")}>
              <b>Sam</b> · 16 years old · <span className="text-slate-600">will be refused at 21+ checks</span>
            </button>
          </div>
        </Panel>
        <p className="text-center text-xs text-slate-600">Prototype on a local test network. Synthetic data only.</p>
      </>,
    );
  }

  // ---------------------------------------------------------------- get verified
  if (!profile.bundle || step) {
    return frame(
      <>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Get verified</h1>
          <p className="mt-1 text-sm text-slate-600">Once. After this, you never upload an ID again.</p>
        </div>
        {step ? (
          <Panel>
            <StepList steps={STEPS} current={step} />
          </Panel>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-4">
            <Panel title="Issuer">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-lg" aria-hidden>
                  🏛
                </span>
                <div className="text-sm">
                  <div className="font-semibold">{app.config?.issuers[0]?.name ?? "Demo issuer"}</div>
                  <div className="text-slate-600">Simulated. In production: a DMV, bank or telecom that already checked your ID.</div>
                </div>
              </div>
            </Panel>
            <Panel title="Your details (synthetic)">
              <div className="mb-3 flex gap-2 text-xs">
                {(Object.keys(PERSONAS) as (keyof typeof PERSONAS)[]).map((k) => (
                  <button key={k} type="button" className="rounded-full bg-brand-50 px-3 py-1 font-medium text-brand-800 ring-1 ring-brand-100" onClick={() => setForm(applicationOf(k))}>
                    Fill as {PERSONAS[k].label} ({PERSONAS[k].note})
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Full name</span>
                  <input id="pass-name" className="rounded-xl border border-slate-300 px-3 py-2" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required minLength={2} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Date of birth</span>
                  <input id="pass-dob" type="date" className="rounded-xl border border-slate-300 px-3 py-2" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} required />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">Country</span>
                    <select id="pass-country" className="rounded-xl border border-slate-300 bg-white px-3 py-2" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                      <option value="ZZ">Zedland (ZZ)</option>
                      <option value="QQ">Quarkia (QQ)</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">ID number</span>
                    <input id="pass-doc" className="rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs" value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value.toUpperCase() })} pattern="SYN-[A-Z0-9]{4,16}" required />
                  </label>
                </div>
                <p className="text-xs text-slate-600">Synthetic data only. ID numbers start with SYN-. Do not enter real details.</p>
              </div>
            </Panel>
            <BigButton type="submit" disabled={!app.config}>
              Verify me
            </BigButton>
          </form>
        )}
      </>,
    );
  }

  // ---------------------------------------------------------------- the Pass
  return frame(
    <>
      <PassCard profile={profile} status={status} />
      {wrongDeployment && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This Pass was issued on an earlier demo network. Create a new person (top right) to get a fresh one.
        </div>
      )}
      {status === "NotRegistered" && !wrongDeployment && <BigButton onClick={() => void retryActivation()}>Activate my Pass</BigButton>}
      <Panel title="Using your Pass">
        <ul className="flex flex-col gap-2 text-sm text-slate-700">
          <li><b>At a door:</b> scan the venue’s QR code with your camera, then tap Share. Show the 4-letter code to staff.</li>
          <li><b>Online:</b> choose “Verify with decID” at checkout.</li>
          <li><b>Every time:</b> you see who is asking and exactly what they learn, before anything is sent.</li>
        </ul>
        {next?.startsWith("/pass/r/") && (
          <Link href={next} className="mt-3 inline-block text-sm font-semibold text-brand-700 underline">
            Continue to the request →
          </Link>
        )}
      </Panel>
      <Panel title="Where you have shared">
        {hist.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing yet. This list lives only on this phone.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {hist.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-medium">{h.merchant}</div>
                  <div className="text-xs text-slate-600">
                    Shared only “{h.shared}” · {new Date(h.at).toLocaleString()}
                  </div>
                </div>
                <span className={h.outcome === "verified" ? "text-xs font-semibold text-emerald-700" : "text-xs font-semibold text-rose-700"}>
                  {h.outcome === "verified" ? "Accepted" : h.outcome === "declined" ? "Declined" : friendlyReason(h.failureCode)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <button className="self-start text-xs text-slate-600 underline" onClick={() => setShowTech(!showTech)}>
        {showTech ? "Hide" : "Show"} technical details
      </button>
      {showTech && (
        <Panel title="Under the hood">
          <dl className="grid gap-2 text-xs">
            <dt className="text-slate-600">Your identifier (only the issuer and businesses you share with see it)</dt>
            <dd className="break-all font-mono">{app.config ? deriveHolderDid(app.config.chainId, profile.address) : profile.address}</dd>
            <dt className="text-slate-600">Registry commitment (public; reveals nothing by itself)</dt>
            <dd className="break-all font-mono">{profile.bundle.commitment}</dd>
            <dt className="text-slate-600">Credential format</dt>
            <dd>W3C Verifiable Credential secured as SD-JWT. Each optional claim is hidden behind a salted hash.</dd>
          </dl>
          <button
            className="mt-3 text-xs font-semibold text-rose-700 underline"
            onClick={async () => {
              await deleteProfile(profile.id);
              await reload();
            }}
          >
            Remove this Pass from this device
          </button>
        </Panel>
      )}
    </>,
  );
}

export default function PassPage() {
  return (
    <Suspense fallback={null}>
      <PassHome />
    </Suspense>
  );
}
