"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConsentSheet, PassScreen, PhoneButton, ShareResult, SheetNotice } from "@/components/product/pass";
import { brandByName } from "@/components/product/merchant";
import { WalletHome } from "@/components/product/wallet";
import { describeError } from "@/lib/client/errors";
import { activeProfile, addHistory, claimsOf, credentialStatus, listProfiles, loadRequest, setActive, share, type Outcome, type PassProfile, type WalletRequest } from "@/lib/client/pass";
import { friendlyReason } from "@/lib/shared/policies";

/** A business's request, answered from decID Pass: the wallet with the consent sheet over it. */

const CLAIM_FOR: Record<string, "ageOver21" | "ageOver18" | null> = { age_over_21: "ageOver21", age_over_18: "ageOver18", identity_verified: null };
const ITEM_FOR: Record<string, string> = { age_over_21: "21 or older", age_over_18: "18 or older", identity_verified: "Verified person" };

function useCountdown(until?: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return until ? Math.max(0, until - now) : 0;
}

export default function ApproveRequest() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [profiles, setProfiles] = useState<PassProfile[]>();
  const [profile, setProfile] = useState<PassProfile>();
  const [req, setReq] = useState<WalletRequest>();
  const [passStatus, setPassStatus] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome | "declined">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const left = useCountdown(req?.expiresAt);

  const load = useCallback(async () => {
    setProfiles(await listProfiles());
    const p = await activeProfile();
    setProfile(p);
    if (p?.bundle) setPassStatus(await credentialStatus(p.bundle).catch(() => "Unknown"));
    setReq(await loadRequest(id));
  }, [id]);

  useEffect(() => {
    void load().catch((e) => setError(describeError(e)));
  }, [load]);

  if (!req) {
    return <PassScreen>{error ? <p className="px-5 pt-10 text-body text-bad" role="alert">{error}</p> : null}</PassScreen>;
  }
  const m = brandByName(req.merchant.name, req.merchant.kind);
  const item = ITEM_FOR[req.policy.id] ?? req.policy.short;
  const home = () => router.push("/pass");

  if (outcome === "declined") {
    return (
      <PassScreen>
        <div className="px-5 pt-10">
          <h2 className="text-[26px] font-semibold leading-8 tracking-[-0.02em]">You didn’t share</h2>
          <p className="mt-2 text-[15px] text-ink-10">Nothing was sent to {m.name}.</p>
          <div className="mt-8">
            <PhoneButton variant="secondary" onClick={home}>
              Back to my Pass
            </PhoneButton>
          </div>
        </div>
      </PassScreen>
    );
  }
  if (outcome) {
    return (
      <PassScreen>
        <ShareResult ok={outcome.status === "verified"} merchant={m} item={item} matchCode={outcome.matchCode} reason={friendlyReason(outcome.failureCode)} onDone={home} doneLabel="Back to my Pass" />
      </PassScreen>
    );
  }

  const b = profile?.bundle;
  const claims = b ? claimsOf(b) : undefined;
  const claim = CLAIM_FOR[req.policy.id] ?? null;
  const closed = req.status !== "pending" || left === 0;

  return (
    <PassScreen>
      <WalletHome
        people={(profiles ?? []).filter((p) => p.bundle).map((p) => ({ id: p.id, label: p.label }))}
        activeId={profile?.id}
        onSwitch={async (pid) => {
          await setActive(pid);
          await load();
        }}
        onAdd={() => router.push(`/pass?next=/pass/r/${req.id}`)}
        card={
          b && claims
            ? { holder: profile!.label, ageOver18: claims.ageOver18 === true, ageOver21: claims.ageOver21 === true, issuer: "Simulated Identity Office", validUntil: new Date(b.authorization.expiresAt * 1000), reference: b.commitment.slice(2, 10).toUpperCase(), status: passStatus }
            : undefined
        }
        activity={[]}
      />
      {closed ? (
        <SheetNotice merchant={m} title={req.status === "pending" ? "This request expired" : "Already answered"} body={req.status === "pending" ? `Ask ${m.name} for a new one.` : "Each request can be answered once."} onClose={home} />
      ) : !b ? (
        <SheetNotice merchant={m} title={`${m.name} asks if you’re ${item.toLowerCase()}`} body="Add your ID to answer. It takes a few seconds, and you only do it once." onClose={home}>
          <PhoneButton onClick={() => router.push(`/pass?next=/pass/r/${req.id}`)}>Add your ID</PhoneButton>
        </SheetNotice>
      ) : (
        <ConsentSheet
          merchant={m}
          item={item}
          answer={claim ? claims?.[claim] === true : true}
          revoked={passStatus !== undefined && passStatus !== "Active"}
          expiresIn={left}
          busy={busy}
          error={error}
          onCancel={async () => {
            await addHistory({ profileId: profile!.id, at: Date.now(), merchant: req.merchant.name, question: req.policy.question, shared: "nothing", outcome: "declined" });
            setOutcome("declined");
          }}
          onShare={async () => {
            setBusy(true);
            setError(undefined);
            try {
              setOutcome(await share(profile!, req));
            } catch (e) {
              setError(describeError(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </PassScreen>
  );
}
