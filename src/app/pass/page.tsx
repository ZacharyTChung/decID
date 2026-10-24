"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/components/providers";
import { AddIdFlow, WalletHome, type IdForm } from "@/components/product/wallet";
import { PassScreen, PhoneButton } from "@/components/product/pass";
import { describeError } from "@/lib/client/errors";
import { activate, activeProfile, claimsOf, createProfile, credentialStatus, getVerified, getVerifiedWithId, history, listProfiles, saveProfile, setActive, walletIdSupported, type HistoryEntry, type IdSource, type PassProfile, type Step } from "@/lib/client/pass";
import { deriveHolderDid } from "@/lib/shared/did-pkh";
import { friendlyReason } from "@/lib/shared/policies";

/**
 * decID Pass on this device (the Next app). The credential and key live in IndexedDB on this
 * device (src/lib/client/pass.ts); this page is the shared wallet UI (src/components/product).
 */

const STEPS = [
  { id: "applying", label: "Send details to the issuer", detail: "Only the issuer sees them. They’re erased after the decision." },
  { id: "waiting-review", label: "Issuer review", detail: "The demo issuer approves at once." },
  { id: "issuing", label: "Receive your credential", detail: "Signed by the issuer, kept on this phone." },
  { id: "activating", label: "Activate", detail: "A random code goes on the public registry. decID pays the fee." },
];

const ID_STEPS = [
  { id: "asking-wallet", label: "Ask your wallet", detail: "It shares only “over 18” and “over 21”." },
  { id: "checking-id", label: "Check the state’s signature", detail: "And that this answer was made on your phone, for this request." },
  { id: "issuing", label: "Receive your Pass", detail: "Signed by decID’s issuer, kept on this phone." },
  { id: "activating", label: "Activate", detail: "A random code goes on the public registry. decID pays the fee." },
];

function PassHome() {
  const app = useApp();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [profiles, setProfiles] = useState<PassProfile[]>();
  const [profile, setProfile] = useState<PassProfile>();
  const [status, setStatus] = useState<string>();
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState<Step>();
  const [flow, setFlow] = useState<"form" | "id">("form");
  const [error, setError] = useState<string>();

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

  const addId = async (label: string, form: IdForm) => {
    if (!app.config) return;
    setError(undefined);
    setFlow("form");
    try {
      // Reuse a person that was created but never verified; otherwise start a new one.
      let p = profile && !profile.bundle ? profile : await createProfile(label);
      if (p.label !== label) {
        p = { ...p, label };
        await saveProfile(p);
      }
      // Only the application fields (the issuer's schema is strict).
      const { fullName, dateOfBirth, country, documentNumber } = form;
      await getVerified(p, app.config, { fullName, dateOfBirth, country, documentNumber }, setStep);
      setAdding(false);
      await reload();
      if (next?.startsWith("/pass/r/")) router.push(next);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setStep(undefined);
    }
  };

  const addWithId = async (label: string, source: IdSource) => {
    if (!app.config) return;
    setError(undefined);
    setFlow("id");
    try {
      let p = profile && !profile.bundle ? profile : await createProfile(label);
      if (p.label !== label) {
        p = { ...p, label };
        await saveProfile(p);
      }
      await getVerifiedWithId(p, app.config, source, setStep);
      setAdding(false);
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

  if (!profiles) return <PassScreen>{null}</PassScreen>;

  const verified = profiles.filter((p) => p.bundle);
  if (adding || !profile?.bundle) {
    return (
      <PassScreen>
        <AddIdFlow
          issuerName="Simulated Identity Office"
          steps={flow === "id" ? ID_STEPS : STEPS}
          step={step}
          error={error}
          canGoBack={verified.length > 0}
          onBack={() => setAdding(false)}
          onSubmit={(label, form) => void addId(label, form)}
          governmentId={
            app.config?.governmentId && {
              browserSupport: walletIdSupported(),
              realIssuers: app.config.governmentId.issuers.filter((i) => !i.test).map((i) => i.name),
              testIds: app.config.governmentId.acceptsTestIds,
              onUseWallet: (label) => void addWithId(label, { kind: "wallet" }),
              onUseTestWallet: (label, birthDate) => void addWithId(label, { kind: "test", birthDate }),
            }
          }
        />
      </PassScreen>
    );
  }

  const b = profile.bundle;
  const claims = claimsOf(b);
  const wrongDeployment = app.config && (b.deployment.registry.toLowerCase() !== app.config.registry.toLowerCase() || b.authorization.deploymentId !== app.config.deploymentId);
  return (
    <PassScreen>
      <WalletHome
        people={verified.map((p) => ({ id: p.id, label: p.label }))}
        activeId={profile.id}
        onSwitch={async (id) => {
          await setActive(id);
          await reload();
        }}
        onAdd={() => setAdding(true)}
        card={{
          holder: profile.label,
          ageOver18: claims.ageOver18 === true,
          ageOver21: claims.ageOver21 === true,
          issuer: profile.issuerName && profile.issuerName !== app.config?.issuers[0]?.name ? profile.issuerName : "Simulated Identity Office",
          validUntil: new Date(b.authorization.expiresAt * 1000),
          reference: b.commitment.slice(2, 10).toUpperCase(),
          status,
        }}
        activity={hist.map((h) => ({
          merchantId: h.merchant.toLowerCase().replace(/[^a-z]/g, ""),
          merchantName: h.merchant,
          detail: `${h.outcome === "verified" ? `Shared “${h.shared === "21+" ? "21 or older" : h.shared}”` : h.outcome === "declined" ? "Declined" : friendlyReason(h.failureCode)} · ${new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
          matchCode: h.matchCode,
        }))}
        tech={{ deviceKey: app.config ? deriveHolderDid(app.config.chainId, profile.address) : profile.address, registryEntry: b.commitment, hiddenClaims: b.disclosures.length }}
        notice={
          <div className="mt-4 space-y-3 px-4">
            {wrongDeployment && <p className="rounded-md bg-warn-soft px-3 py-2.5 text-ui text-warn">This Pass was issued on an earlier demo network. Add another person to get a fresh one.</p>}
            {status === "NotRegistered" && !wrongDeployment && (
              <PhoneButton onClick={() => void retryActivation()} busy={step === "activating"}>
                Activate my Pass
              </PhoneButton>
            )}
            {next?.startsWith("/pass/r/") && (
              <Link href={next} className="press flex h-[50px] items-center justify-center rounded-lg bg-ink-12 text-[16px] font-medium text-white">
                Continue to the request
              </Link>
            )}
            {error && (
              <p role="alert" className="rounded-md bg-bad-soft px-3 py-2.5 text-ui text-bad">
                {error}
              </p>
            )}
          </div>
        }
      />
    </PassScreen>
  );
}

export default function PassPage() {
  return (
    <Suspense fallback={null}>
      <PassHome />
    </Suspense>
  );
}
