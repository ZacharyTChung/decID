"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BigButton, Panel, PassFrame } from "@/components/pass/ui";
import { describeError } from "@/lib/client/errors";
import { activeProfile, addHistory, claimsOf, credentialStatus, listProfiles, loadRequest, setActive, share, type Outcome, type PassProfile, type WalletRequest } from "@/lib/client/pass";
import { NEVER_SHARED, friendlyReason } from "@/lib/shared/policies";

const CLAIM_FOR: Record<string, "ageOver21" | "ageOver18" | null> = { age_over_21: "ageOver21", age_over_18: "ageOver18", identity_verified: null };

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

  const frame = (children: React.ReactNode) => (
    <PassFrame
      profiles={profiles}
      active={profile}
      onSwitch={async (pid) => {
        await setActive(pid);
        setOutcome(undefined);
        await load();
      }}
    >
      {children}
      {error && (
        <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
    </PassFrame>
  );

  if (!req) return frame(<p className="text-sm text-slate-600">{error ? "" : "Loading the request…"}</p>);

  const venue = req.merchant.kind === "venue";
  const header = (
    <div className="flex items-center gap-3">
      <span className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${venue ? "bg-fuchsia-100" : "bg-amber-100"}`} aria-hidden>
        {venue ? "🎟" : "🛒"}
      </span>
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-600">{venue ? "Venue entry" : "Online checkout"}</div>
        <div className="text-xl font-bold">{req.merchant.name}</div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- after answering
  if (outcome) {
    if (outcome === "declined") {
      return frame(
        <>
          {header}
          <Panel>
            <p className="text-lg font-semibold">You declined.</p>
            <p className="mt-1 text-sm text-slate-600">Nothing was sent to {req.merchant.name}.</p>
          </Panel>
          <Link href="/pass" className="text-center text-sm font-semibold text-brand-700 underline">Back to my Pass</Link>
        </>,
      );
    }
    const ok = outcome.status === "verified";
    return frame(
      <>
        {header}
        <section className={`rounded-3xl p-6 text-center ${ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`} aria-live="polite">
          <div className="text-5xl" aria-hidden>{ok ? "✓" : "✕"}</div>
          <div className="mt-2 text-2xl font-bold">{ok ? `${outcome.policy.short} confirmed` : friendlyReason(outcome.failureCode)}</div>
          <p className="mt-1 text-sm text-white/85">
            {ok ? `${req.merchant.name} now knows only: ${outcome.policy.short} ✓` : `${req.merchant.name} was told the check did not pass. Nothing else was shared.`}
          </p>
          {ok && outcome.matchCode && (
            <div className="mt-5 rounded-2xl bg-white/15 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-white/80">{venue ? "Show this code to staff" : "Match code"}</div>
              <div className="mt-1 font-mono text-4xl font-bold tracking-[0.3em]" data-testid="match-code">{outcome.matchCode}</div>
            </div>
          )}
        </section>
        <p className="text-center text-sm text-slate-600">{venue ? "The door screen shows the same code." : `You can return to ${req.merchant.name}; it has been updated.`}</p>
        <Link href="/pass" className="text-center text-sm font-semibold text-brand-700 underline">Back to my Pass</Link>
      </>,
    );
  }

  // ---------------------------------------------------------------- deciding
  const claim = CLAIM_FOR[req.policy.id] ?? null;
  const mine = profile?.bundle ? claimsOf(profile.bundle) : undefined;
  const wouldFail = claim && mine && mine[claim] === false;
  const closed = req.status !== "pending" || left === 0;

  return frame(
    <>
      {header}
      <Panel>
        <div className="text-sm text-slate-600">{req.merchant.name} asks:</div>
        <div className="mt-1 text-2xl font-bold leading-snug">{req.policy.question}</div>
        <div className="mt-2 text-xs text-slate-600">{closed ? (req.status === "pending" ? "This request expired." : "This request was already answered.") : `Request expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</div>
      </Panel>
      <div className="grid grid-cols-2 gap-3">
        <Panel tone="brand" title="They will learn">
          <ul className="text-sm text-slate-800">
            <li>✓ {req.policy.short}: yes or no</li>
            <li>✓ Who vouched for you</li>
          </ul>
        </Panel>
        <Panel title="They will not see">
          <ul className="text-sm text-slate-600">
            {NEVER_SHARED.map((n) => (
              <li key={n}>✕ {n}</li>
            ))}
          </ul>
        </Panel>
      </div>
      {!profile?.bundle ? (
        <Panel>
          <p className="text-sm">You don’t have a decID Pass on this device yet.</p>
          <Link href={`/pass?next=/pass/r/${req.id}`} className="mt-3 block rounded-2xl bg-brand-700 px-4 py-3 text-center font-semibold text-white">
            Get my Pass (2 minutes)
          </Link>
        </Panel>
      ) : (
        <>
          {passStatus && passStatus !== "Active" && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Your Pass is {passStatus === "NotRegistered" ? "not activated yet" : passStatus.toLowerCase()}, so this check will not pass.</div>
          )}
          {wouldFail && <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Your Pass says you are not {req.policy.short}. If you share, {req.merchant.name} will be told “no”, and nothing else.</div>}
          <BigButton
            busy={busy}
            disabled={closed}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                setOutcome(await share(profile, req));
              } catch (e) {
                setError(describeError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Share “{req.policy.short}” with {req.merchant.name}
          </BigButton>
          <BigButton
            variant="ghost"
            onClick={async () => {
              await addHistory({ profileId: profile.id, at: Date.now(), merchant: req.merchant.name, question: req.policy.question, shared: "nothing", outcome: "declined" });
              setOutcome("declined");
            }}
          >
            Decline
          </BigButton>
          <p className="text-center text-xs text-slate-600">Sharing signs this one request with your Pass. It cannot be reused by {req.merchant.name} or anyone else.</p>
        </>
      )}
    </>,
  );
}
