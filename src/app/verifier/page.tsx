"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ChallengeResponse } from "@/lib/shared/api";
import { PRESENTATION_TYPES, presentationDomain } from "@/lib/shared/eip712";
import { preparePresentation } from "@/lib/shared/presentation";
import { ACTION_POLICIES, VERIFIER_ACTIONS, type VerifierAction } from "@/lib/shared/constants";
import { decodeDisclosure } from "@/lib/shared/sd-jwt";
import { CHECK_LABELS, type VerificationResult } from "@/lib/shared/verification";
import { useApp } from "@/components/providers";
import { Badge, Button, Card, Mono, Notice, Shell, WalletBar, useAction } from "@/components/ui";

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = until - now;
  return left > 0 ? <Badge tone="blue">expires in {left}s</Badge> : <Badge tone="red">expired</Badge>;
}

interface LogEntry {
  ref: string;
  action: string;
  createdAt: number;
  status: "verified" | "rejected" | "unused" | "expired";
  code: string | null;
}

/** Recent outcomes at this verifier. Challenge rows hold no holder, credential or salt. */
function ActivityLog({ version }: { version: number }) {
  const [entries, setEntries] = useState<LogEntry[]>();
  useEffect(() => {
    void api<{ entries: LogEntry[] }>("GET", "/api/verifier/history")
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
  }, [version]);
  return (
    <Card title="Recent verification activity" subtitle="What this verifier keeps: request reference, action, time and outcome code. No wallet address, credential or salt is stored.">
      {!entries || entries.length === 0 ? (
        <p className="text-sm text-slate-500">No verification requests yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 font-medium">Request</th>
              <th className="py-1 font-medium">Time</th>
              <th className="py-1 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((e) => (
              <tr key={e.ref + e.createdAt}>
                <td className="py-1.5">
                  <Mono>{e.ref}</Mono>
                </td>
                <td className="py-1.5 text-slate-600">{new Date(e.createdAt * 1000).toLocaleTimeString()}</td>
                <td className="py-1.5">
                  <Badge tone={e.status === "verified" ? "green" : e.status === "rejected" ? "red" : "slate"}>
                    {e.status === "rejected" && e.code ? `rejected: ${e.code}` : e.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Results({ result, action }: { result: VerificationResult; action: VerifierAction }) {
  return (
    <Card title="Verification result" subtitle={`Checked at ${new Date(result.verifiedAt).toLocaleTimeString()}. Every check is reported separately.`}>
      <div className="mb-4">
        {result.verified ? <Notice tone="success">Verified. Access to “{ACTION_POLICIES[action].label}” may be granted.</Notice> : <Notice tone="error">Not verified. See the failing check below.</Notice>}
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {result.checks.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <span>{CHECK_LABELS[c.id]}</span>
            <span className="flex flex-col items-end gap-1">
              <Badge tone={c.status === "pass" ? "green" : c.status === "fail" ? "red" : "slate"}>{c.status === "pass" ? "pass" : c.status === "fail" ? `fail: ${c.code}` : "not reached"}</Badge>
              {c.status === "fail" && c.detail && <span className="text-xs text-rose-700">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {result.registryStatus && (
        <p className="mt-3 text-sm">
          Live registry status: <Badge tone={result.registryStatus === "Active" ? "green" : "red"}>{result.registryStatus}</Badge>
        </p>
      )}
      {result.disclosed && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm">
          <div className="font-semibold text-emerald-900">What the verifier learned (minimum disclosure)</div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-emerald-900">
            <dt className="font-medium">Claim</dt>
            <dd>
              identityVerified: <strong>true</strong> ({result.disclosed.credentialType})
            </dd>
            <dt className="font-medium">Holder</dt>
            <dd>
              <Mono>{result.disclosed.holderDid}</Mono>
            </dd>
            <dt className="font-medium">Issuer</dt>
            <dd>
              {result.disclosed.issuerName} <Mono>{result.disclosed.issuerDid}</Mono>
            </dd>
            <dt className="font-medium">Valid</dt>
            <dd>
              {result.disclosed.validFrom} → {result.disclosed.validUntil}
            </dd>
            <dt className="font-medium">Disclosed claims</dt>
            <dd>
              {Object.keys(result.disclosed.claims).length === 0
                ? "none requested"
                : Object.entries(result.disclosed.claims).map(([k, v]) => (
                    <span key={k} className="mr-3">
                      {k}: <strong>{String(v)}</strong>
                    </span>
                  ))}
            </dd>
          </dl>
          <p className="mt-2 text-xs text-emerald-800">The original application (name, birth date, document number) is not available to the verifier, and it does not keep the token or salt.</p>
        </div>
      )}
    </Card>
  );
}

export default function VerifierPage() {
  const app = useApp();
  const [challenge, setChallenge] = useState<ChallengeResponse>();
  const [result, setResult] = useState<{ result: VerificationResult; action: VerifierAction }>();
  const [consent, setConsent] = useState(false);
  const [action, setAction] = useState<VerifierAction>("access-verified-member-area");
  const [logVersion, setLogVersion] = useState(0);
  const start = useAction();
  const present = useAction();
  const bundle = app.bundle;
  const ownsBundle = !!bundle && !!app.address && bundle.authorization.holder.toLowerCase() === app.address.toLowerCase();
  const canPresent = !!challenge && ownsBundle && app.onExpectedChain && consent;

  // A different wallet or chain is a different presenter: drop the request and any result shown for the old one.
  useEffect(() => {
    setChallenge(undefined);
    setResult(undefined);
    setConsent(false);
  }, [app.address, app.chainId]);

  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-semibold">Verifier</h1>
        <p className="text-sm text-slate-600">
          A relying service that checks a presented credential and the live registry before granting access. It needs no issuer private key: only the public trust policy and
          chain state.
        </p>
      </div>

      <Card title="1. Start a fresh verification request" subtitle="The server creates an unpredictable 32-byte nonce for one action. It expires after 2 minutes and can be used once.">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="verifier-action" className="text-slate-600">
            Action
          </label>
          <select id="verifier-action" className="rounded-md border border-slate-300 px-2 py-1" value={action} onChange={(e) => setAction(e.target.value as VerifierAction)}>
            {VERIFIER_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_POLICIES[a].label}
                {ACTION_POLICIES[a].requested.length ? ` (requests ${ACTION_POLICIES[a].requested.join(", ")})` : ""}
              </option>
            ))}
          </select>
        </div>
        <Button
          busy={start.busy}
          onClick={() =>
            start.run(async () => {
              setResult(undefined);
              setConsent(false);
              setChallenge(await api<ChallengeResponse>("POST", "/api/verifier/challenges", { action }));
              setLogVersion((v) => v + 1);
            })
          }
        >
          New verification request
        </Button>
        {start.error && <div className="mt-3"><Notice tone="error">{start.error}</Notice></div>}
        {challenge && (
          <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Action</dt>
              <dd>{challenge.action}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Requested optional claims</dt>
              <dd>{challenge.requestedClaims.length ? challenge.requestedClaims.join(", ") : "none"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Audience (this verifier)</dt>
              <dd>{challenge.audience}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Nonce</dt>
              <dd>
                <Mono>{challenge.nonce}</Mono>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Chain / registry</dt>
              <dd>
                {challenge.chainId} / <Mono>{challenge.registry}</Mono>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Validity</dt>
              <dd>
                <Countdown until={challenge.expiresAt} />
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <Card
        title="2. Holder: review and approve sharing"
        subtitle="This step happens in the holder's wallet. In a real deployment the holder would open the verifier's request on their own device."
      >
        <WalletBar />
        {!bundle ? (
          <p className="mt-3 text-sm text-slate-600">No credential is loaded in this browser tab. Receive or import one on the Holder page first.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="font-medium">You are about to share with {challenge?.audience ?? "the verifier"}:</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
                <li>The signed credential: your holder DID, the issuer DID, the validity dates, and identityVerified = true.</li>
                <li>
                  Optional claims:{" "}
                  {!challenge || challenge.requestedClaims.length === 0 ? (
                    <>none. Your age and country claims stay hidden; the verifier sees only unreadable digests.</>
                  ) : (
                    <>
                      only{" "}
                      {challenge.requestedClaims
                        .map((name) => {
                          const d = bundle.disclosures.find((x) => decodeDisclosure(x).name === name);
                          return d ? `${name} = ${String(decodeDisclosure(d).value)}` : `${name} (not in your credential)`;
                        })
                        .join(", ")}
                      . Your other optional claims stay hidden.
                    </>
                  )}
                </li>
                <li>The private commitment salt, so the verifier can match the credential to the on-chain record. The verifier does not store it.</li>
                <li>A wallet signature over this request’s nonce, audience, action, chain, registry, commitment and exactly these disclosures, valid only until the request expires.</li>
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Not shared: the synthetic application data (the issuer erased it). The verifier will be able to link this presentation to your wallet address and on-chain
                record.
              </p>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I consent to share the above for “{challenge?.action ?? "…"}”.</span>
            </label>
            <Button
              busy={present.busy}
              disabled={!canPresent}
              onClick={() =>
                present.run(async () => {
                  const c = challenge!;
                  const signer = await app.signer();
                  const holder = await signer.getAddress();
                  const { disclosures, message } = preparePresentation(bundle, c, holder);
                  const signature = await signer.signTypedData(presentationDomain(c.chainId, c.registry), PRESENTATION_TYPES, message);
                  const r = await api<VerificationResult>("POST", "/api/verifier/presentations", {
                    challengeId: c.challengeId,
                    credentialJwt: bundle.credentialJwt,
                    disclosures,
                    salt: bundle.salt,
                    proof: { holder, commitment: bundle.commitment, expiresAt: c.expiresAt, signature },
                  });
                  setResult({ result: r, action: c.action as VerifierAction });
                  setLogVersion((v) => v + 1);
                  setConsent(false);
                  setChallenge(undefined); // single-use: it was consumed by this submission
                })
              }
            >
              Sign and present
            </Button>
            {!challenge && <p className="text-xs text-slate-500">Start a verification request first. Each request can be used once.</p>}
            {bundle && app.address && !ownsBundle && (
              <Notice tone="warn">The loaded credential belongs to {bundle.authorization.holder}; connect that wallet to present it.</Notice>
            )}
            {present.error && <Notice tone="error">{present.error}</Notice>}
          </div>
        )}
      </Card>

      {result && <Results result={result.result} action={result.action} />}
      <ActivityLog version={logVersion} />
    </Shell>
  );
}
