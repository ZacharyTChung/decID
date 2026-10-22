"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { SyntheticApplicationT } from "@/lib/shared/api";
import { useApp } from "@/components/providers";
import { Badge, Button, Card, Mono, Notice, Shell, SignInGate, WalletBar, inputClass, useAction } from "@/components/ui";

interface PendingRequest {
  id: string;
  holderDid: string;
  createdAt: number;
  application: Omit<SyntheticApplicationT, "syntheticDataConfirmed">;
}

interface IssuedCredential {
  commitment: string;
  credentialId: string;
  holderDid: string;
  validFrom: number;
  expiresAt: number;
  issuedAt: number;
  revokedAt: number | null;
  revokeTx: string | null;
  onChainStatus: string;
}

function ReviewQueue({ onIssued }: { onIssued: () => void }) {
  const [requests, setRequests] = useState<PendingRequest[]>();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const action = useAction();
  const load = useCallback(async () => {
    const r = await api<{ requests: PendingRequest[] }>("GET", "/api/issuer/requests");
    setRequests(r.requests);
  }, []);
  useEffect(() => {
    void load().catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Card
      title="Review queue"
      subtitle="Synthetic applications awaiting a decision. In this simulation the review is your judgement; no documents are checked. Approving issues a minimal credential that contains none of these fields, and the fields are then erased."
    >
      {!requests || requests.length === 0 ? (
        <p className="text-sm text-slate-500">No pending requests.</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Mono>{r.holderDid}</Mono>
                <span className="text-xs text-slate-500">{new Date(r.createdAt * 1000).toLocaleString()}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(r.application).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-500">{k}</dt>
                    <dd className="font-medium">{String(v)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  busy={action.busy}
                  onClick={() =>
                    action.run(async () => {
                      await api("POST", `/api/issuer/requests/${r.id}/decision`, { decision: "approve" });
                      await load();
                      onIssued();
                    })
                  }
                >
                  Approve and issue
                </Button>
                <input
                  aria-label="Rejection reason"
                  className={`${inputClass} max-w-xs`}
                  placeholder="Rejection reason"
                  value={reasons[r.id] ?? ""}
                  onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
                />
                <Button
                  variant="secondary"
                  busy={action.busy}
                  disabled={(reasons[r.id] ?? "").trim().length < 3}
                  onClick={() =>
                    action.run(async () => {
                      await api("POST", `/api/issuer/requests/${r.id}/decision`, { decision: "reject", reason: reasons[r.id] });
                      await load();
                    })
                  }
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {action.error && <div className="mt-3"><Notice tone="error">{action.error}</Notice></div>}
    </Card>
  );
}

function IssuedList({ version }: { version: number }) {
  const [creds, setCreds] = useState<IssuedCredential[]>();
  const [confirming, setConfirming] = useState<string>();
  const action = useAction();
  const load = useCallback(async () => {
    const r = await api<{ credentials: IssuedCredential[] }>("GET", "/api/issuer/credentials");
    setCreds(r.credentials);
  }, []);
  useEffect(() => {
    void load().catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 8000);
    return () => clearInterval(t);
  }, [load, version]);

  return (
    <Card
      title="Issued credentials"
      subtitle="The issuer's log keeps public values only (commitment, holder DID, validity), never the token or salt. Revocation is an on-chain transaction from the issuer's attestation key."
    >
      {!creds || creds.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing issued yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {creds.map((c) => (
            <li key={c.commitment} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="space-y-1">
                <div>
                  <Mono>{c.holderDid}</Mono>
                </div>
                <div className="text-xs text-slate-500">
                  commitment <Mono>{c.commitment.slice(0, 18)}…</Mono> · expires {new Date(c.expiresAt * 1000).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={c.onChainStatus === "Active" ? "green" : c.onChainStatus === "NotRegistered" ? "amber" : "red"}>{c.onChainStatus === "NotRegistered" ? "Not registered yet" : c.onChainStatus}</Badge>
                {c.onChainStatus !== "Revoked" && c.onChainStatus !== "NotRegistered" && c.onChainStatus !== "RpcUnavailable" && (
                  confirming === c.commitment ? (
                    <>
                      <Button
                        variant="danger"
                        busy={action.busy}
                        onClick={() =>
                          action.run(async () => {
                            await api("POST", "/api/issuer/credentials/revoke", { commitment: c.commitment });
                            setConfirming(undefined);
                            await load();
                          })
                        }
                      >
                        Confirm revoke
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirming(undefined)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => setConfirming(c.commitment)}>
                      Revoke
                    </Button>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {action.error && <div className="mt-3"><Notice tone="error">{action.error}</Notice></div>}
    </Card>
  );
}

function KeyStatusBadge({ status, retiredAt }: { status: "active" | "retired" | "compromised"; retiredAt?: number }) {
  const when = retiredAt ? ` since ${new Date(retiredAt * 1000).toLocaleString()}` : "";
  return <Badge tone={status === "active" ? "green" : status === "retired" ? "slate" : "red"}>{status}{status !== "active" ? when : ""}</Badge>;
}

export default function IssuerPage() {
  const app = useApp();
  const [version, setVersion] = useState(0);
  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-semibold">Issuer</h1>
        <p className="text-sm text-slate-600">
          <Badge tone="amber">Simulated trust authority</Badge> A stand-in identity office for the prototype. It has no real-world authority and verifies nothing about
          real people.
        </p>
      </div>
      <WalletBar />
      {app.config && (
        <Card tone="muted">
          <div className="space-y-1 text-xs text-slate-600">
            {app.config.issuers.map((i) => (
              <div key={i.id} className="space-y-1">
                <div className="font-medium text-slate-800">{i.name}: trust policy keys</div>
                {i.credentialKeys.map((k) => (
                  <div key={k.did} className="flex flex-wrap items-center gap-2">
                    <span>Credential key</span>
                    <Mono>{k.did}</Mono>
                    <KeyStatusBadge status={k.status} retiredAt={k.retiredAt} />
                  </div>
                ))}
                {i.evmAttestationSigners.map((e) => (
                  <div key={e.address} className="flex flex-wrap items-center gap-2">
                    <span>EVM attestation signer</span>
                    <Mono>{e.address}</Mono>
                    <KeyStatusBadge status={e.status} retiredAt={e.retiredAt} />
                  </div>
                ))}
              </div>
            ))}
            <p>Rotate keys with <Mono>npm run rotate-keys</Mono> (see README). Retired keys keep their past credentials valid; compromised keys invalidate them.</p>
            <p>Only wallets on the server’s operator allowlist can sign in here. Hiding this page would not be a security control; the server checks every request.</p>
          </div>
        </Card>
      )}
      <SignInGate role="issuer">
        <ReviewQueue onIssued={() => setVersion((v) => v + 1)} />
        <IssuedList version={version} />
      </SignInGate>
    </Shell>
  );
}
