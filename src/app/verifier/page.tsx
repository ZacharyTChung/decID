"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ChallengeResponse } from "@/lib/shared/api";
import { PRESENTATION_TYPES, presentationDomain, presentationStatement } from "@/lib/shared/eip712";
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

function Results({ result }: { result: VerificationResult }) {
  return (
    <Card title="Verification result" subtitle={`Checked at ${new Date(result.verifiedAt).toLocaleTimeString()}. Every check is reported separately.`}>
      <div className="mb-4">
        {result.verified ? <Notice tone="success">Verified. Access to “verified member area” may be granted.</Notice> : <Notice tone="error">Not verified. See the failing check below.</Notice>}
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
          <dl className="mt-2 grid gap-1 text-emerald-900">
            <div>
              identityVerified: <strong>true</strong> ({result.disclosed.credentialType})
            </div>
            <div>
              holder: <Mono>{result.disclosed.holderDid}</Mono>
            </div>
            <div>
              issuer: {result.disclosed.issuerName} <Mono>{result.disclosed.issuerDid}</Mono>
            </div>
            <div>
              valid {result.disclosed.validFrom} → {result.disclosed.validUntil}
            </div>
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
  const [result, setResult] = useState<VerificationResult>();
  const [consent, setConsent] = useState(false);
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
        <Button
          busy={start.busy}
          onClick={() =>
            start.run(async () => {
              setResult(undefined);
              setConsent(false);
              setChallenge(await api<ChallengeResponse>("POST", "/api/verifier/challenges", { action: "access-verified-member-area" }));
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
                <li>The private commitment salt, so the verifier can match the credential to the on-chain record. The verifier does not store it.</li>
                <li>A wallet signature over this request’s nonce, audience, action, chain, registry and commitment, valid only until the request expires.</li>
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
                  const signature = await signer.signTypedData(presentationDomain(c.chainId, c.registry), PRESENTATION_TYPES, {
                    statement: presentationStatement(c.audience, c.action),
                    audience: c.audience,
                    action: c.action,
                    challenge: c.nonce,
                    holder,
                    commitment: bundle.commitment,
                    expiresAt: c.expiresAt,
                  });
                  const r = await api<VerificationResult>("POST", "/api/verifier/presentations", {
                    challengeId: c.challengeId,
                    credentialJwt: bundle.credentialJwt,
                    salt: bundle.salt,
                    proof: { holder, commitment: bundle.commitment, expiresAt: c.expiresAt, signature },
                  });
                  setResult(r);
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

      {result && <Results result={result} />}
      <ActivityLog version={logVersion} />
    </Shell>
  );
}
