"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Contract } from "ethers";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "@/generated/contracts";
import { api } from "@/lib/client/api";
import type { HolderRequestView } from "@/lib/shared/api";
import { HolderBundleV1, type HolderBundle } from "@/lib/shared/bundle";
import { MIN_EXPORT_PASSWORD_LENGTH, decryptBundle, encryptBundle } from "@/lib/shared/bundle-crypto";
import { deleteFromVault, loadFromVault, saveToVault } from "@/lib/client/vault";
import { useApp } from "@/components/providers";
import { Badge, Button, Card, Field, Mono, Notice, Shell, SignInGate, WalletBar, inputClass, useAction } from "@/components/ui";

const STATUS_NAMES = ["Unregistered", "Valid", "Revoked", "Issuer inactive", "Not yet valid", "Expired"] as const;
type ChainStatus = (typeof STATUS_NAMES)[number] | "Unknown";

function decodePayload(jwt: string): Record<string, unknown> | undefined {
  try {
    const seg = jwt.split(".")[1]!;
    const bin = atob(seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (seg.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

function decodeHeader(jwt: string): Record<string, unknown> | undefined {
  try {
    const seg = jwt.split(".")[0]!;
    return JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (seg.length % 4)) % 4)));
  } catch {
    return undefined;
  }
}

function randomSyntheticApplication() {
  const n = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  const names = ["Avery Testperson", "Jordan Placeholder", "Sam Syntheticson", "Robin Sampleton"];
  return {
    fullName: names[Math.floor(Math.random() * names.length)]!,
    dateOfBirth: `19${70 + Math.floor(Math.random() * 30)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`,
    documentNumber: `SYN-${n}`,
    country: "ZZ",
  };
}

// ---------------------------------------------------------------- request

function RequestSection({ onBundle }: { onBundle: (b: HolderBundle) => void }) {
  const app = useApp();
  const [requests, setRequests] = useState<HolderRequestView[]>();
  const [form, setForm] = useState(randomSyntheticApplication);
  const [confirmed, setConfirmed] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryOf, setRecoveryOf] = useState("");
  const submit = useAction();
  const pickup = useAction();
  const load = useCallback(async () => {
    const r = await api<{ requests: HolderRequestView[] }>("GET", "/api/holder/requests");
    setRequests(r.requests);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [load, app.session?.address]);

  const pending = requests?.some((r) => r.status === "pending");

  return (
    <Card
      title="1. Request an “Identity Verified” credential"
      subtitle="Uses synthetic data only. The issuer sees these fields to make its decision. They are erased from the server once it decides, and they never go into the credential or onto the chain."
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run(async () => {
            await api("POST", "/api/holder/requests", { ...form, syntheticDataConfirmed: confirmed, ...(recovering ? { recoveryOf: recoveryOf.trim() } : {}) });
            setConfirmed(false);
            await load();
          });
        }}
      >
        <Field label="Full name (synthetic)">
          <input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
        </Field>
        <Field label="Date of birth (synthetic)">
          <input className={inputClass} type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} required />
        </Field>
        <Field label="Document number" hint="Must start with SYN- so real document numbers are never typed here.">
          <input className={inputClass} value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value.toUpperCase() })} required />
        </Field>
        <Field label="Country code" hint="Use ZZ (user-assigned code) for synthetic data.">
          <input className={inputClass} value={form.country} maxLength={2} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} required />
        </Field>
        <div className="rounded-lg border border-slate-200 p-3 text-sm sm:col-span-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={recovering} onChange={(e) => setRecovering(e.target.checked)} />
            <span>This replaces a credential held by a wallet I lost (account recovery).</span>
          </label>
          {recovering && (
            <div className="mt-2 space-y-1">
              <Field label="Lost wallet address" hint="The issuer re-verifies you, shuts down that wallet's credentials (so a thief cannot use them), then issues to this wallet.">
                <input className={inputClass} value={recoveryOf} placeholder="0x…" onChange={(e) => setRecoveryOf(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I confirm this is synthetic test data and not anyone’s real identity information.</span>
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" busy={submit.busy} disabled={!confirmed || pending}>
            Submit request
          </Button>
          <Button variant="secondary" onClick={() => setForm(randomSyntheticApplication())}>
            New synthetic values
          </Button>
        </div>
        {pending && <p className="text-xs text-slate-500 sm:col-span-2">You already have a pending request.</p>}
      </form>
      {submit.error && <div className="mt-3"><Notice tone="error">{submit.error}</Notice></div>}

      <h3 className="mt-6 text-sm font-semibold">Your requests</h3>
      {!requests || requests.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No requests yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                <Badge tone={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status === "approved" ? "issued" : r.status}</Badge>
                <span className="text-slate-500">{new Date(r.createdAt * 1000).toLocaleString()}</span>
                {r.recoveryOf && <Badge tone="blue">recovery of {r.recoveryOf.slice(0, 8)}…</Badge>}
                {r.rejectReason && <span className="text-rose-700">Reason: {r.rejectReason}</span>}
              </span>
              {r.bundleAvailable && (
                <Button
                  busy={pickup.busy}
                  onClick={() =>
                    pickup.run(async () => {
                      const res = await api<{ bundle: HolderBundle }>("POST", `/api/holder/requests/${r.id}/bundle`, {});
                      onBundle(HolderBundleV1.parse(res.bundle));
                      await load();
                    })
                  }
                >
                  Receive credential
                </Button>
              )}
              {r.status === "approved" && !r.bundleAvailable && <span className="text-xs text-slate-500">Delivered (the server no longer holds it)</span>}
            </li>
          ))}
        </ul>
      )}
      {pickup.error && <div className="mt-3"><Notice tone="error">{pickup.error}</Notice></div>}
      <p className="mt-3 text-xs text-slate-500">
        Receiving the credential is one-time: the server deletes its copy as it hands the bundle to you, and the bundle then lives only in this tab’s memory. Export
        an encrypted backup before reloading.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- credential

const EXPIRY_WARNING_DAYS = 30;

/** Time left on the credential, with a renewal hint when it is close to (or past) expiry. */
function ExpiryNotice({ validUntil }: { validUntil?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const until = validUntil ? Date.parse(validUntil) : NaN;
  if (!Number.isFinite(until)) return null;
  const days = Math.floor((until - now) / 86_400_000);
  if (until <= now) {
    return (
      <div className="mt-2">
        <Notice tone="error">This credential has expired. Verifiers and the gate will reject it; submit a new request to be re-verified.</Notice>
      </div>
    );
  }
  if (days < EXPIRY_WARNING_DAYS) {
    return (
      <div className="mt-2">
        <Notice tone="warn">
          Expires in {days < 1 ? "less than a day" : `${days} day${days === 1 ? "" : "s"}`}. Submit a new request before then to stay verified.
        </Notice>
      </div>
    );
  }
  return <p className="mt-2 text-xs text-slate-500">Valid for another {days} days.</p>;
}

function CredentialSection({ bundle }: { bundle: HolderBundle }) {
  const app = useApp();
  const [status, setStatus] = useState<ChainStatus>("Unknown");
  const [statusError, setStatusError] = useState<string>();
  const [showTech, setShowTech] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [txNote, setTxNote] = useState<string>();
  const register = useAction();
  const gate = useAction();
  const payload = decodePayload(bundle.credentialJwt);
  const header = decodeHeader(bundle.credentialJwt);
  const subject = payload?.credentialSubject as { id?: string } | undefined;
  const ownsBundle = app.address?.toLowerCase() === bundle.authorization.holder.toLowerCase();
  const wrongDeployment =
    !!app.config &&
    (bundle.deployment.registry.toLowerCase() !== app.config.registry.toLowerCase() ||
      bundle.deployment.chainId !== app.config.chainId ||
      bundle.authorization.deploymentId.toLowerCase() !== app.config.deploymentId.toLowerCase());

  const refresh = useCallback(async () => {
    if (!app.config) return;
    try {
      const registry = new Contract(app.config.registry, CREDENTIAL_REGISTRY_ABI, app.readProvider());
      const s = Number(await registry.getFunction("credentialStatus")(bundle.commitment));
      setStatus(STATUS_NAMES[s] ?? "Unknown");
      setStatusError(undefined);
    } catch {
      setStatus("Unknown");
      setStatusError("Could not read the registry. Is the local chain running?");
    }
  }, [app, bundle.commitment]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  // The bundle is private to its holder: while another wallet is connected, show nothing from it.
  if (!ownsBundle) {
    return (
      <Card title="2. Your credential" tone="warn">
        <Notice tone="warn">
          The credential loaded in this tab belongs to {bundle.authorization.holder}. Its details are hidden while a different wallet is connected. Switch back to that account
          to use it.
        </Notice>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => app.setBundle(undefined)}>
            Forget it in this tab
          </Button>
        </div>
      </Card>
    );
  }

  const tone = status === "Valid" ? "green" : status === "Unregistered" || status === "Not yet valid" ? "amber" : status === "Unknown" ? "slate" : "red";

  return (
    <Card title="2. Your credential" subtitle="Held off-chain, by you. The chain only ever sees a random-looking commitment to it.">
      {wrongDeployment && <Notice tone="error">This credential was issued for a different chain or registry deployment (for example before a reset). It cannot be used here.</Notice>}

      <div className="mt-3 rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 text-white shadow">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-300">Identity Verified credential</div>
            <div className="mt-1 text-lg font-semibold">identityVerified: true</div>
          </div>
          <Badge tone={tone}>{status}</Badge>
        </div>
        <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">Subject (you)</dt>
            <dd className="break-all font-mono">{subject?.id}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Issuer (simulated office)</dt>
            <dd className="break-all font-mono">{String(payload?.issuer ?? "")}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Valid from</dt>
            <dd>{String(payload?.validFrom ?? "")}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Valid until</dt>
            <dd>{String(payload?.validUntil ?? "")}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-slate-300">No name, birth date, document number or photo is in this credential.</p>
      </div>
      {statusError && <div className="mt-2"><Notice tone="error">{statusError}</Notice></div>}
      <ExpiryNotice validUntil={typeof payload?.validUntil === "string" ? payload.validUntil : undefined} />

      <div className="mt-4">
        <Button variant="secondary" onClick={() => setShowTech(!showTech)}>
          {showTech ? "Hide" : "Show"} technical details
        </Button>
      </div>
      {showTech && (
        <div className="mt-3 space-y-3 text-xs">
          <p className="text-slate-500">Decoded for display only. Decoding is not verification; the verifier checks signatures and the registry.</p>
          <div>
            <div className="font-semibold">JOSE protected header</div>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-3 text-slate-100">{JSON.stringify(header, null, 2)}</pre>
          </div>
          <div>
            <div className="font-semibold">Credential (JWS payload, application/vc+jwt)</div>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-3 text-slate-100">{JSON.stringify(payload, null, 2)}</pre>
          </div>
          <div>
            <div className="font-semibold">On-chain commitment</div>
            <Mono>{bundle.commitment}</Mono>
          </div>
          <div>
            <div className="font-semibold">Issuer registration authorization (EIP-712)</div>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-3 text-slate-100">{JSON.stringify(bundle.authorization, null, 2)}</pre>
          </div>
          <div>
            <Button variant="secondary" onClick={() => setShowSecrets(!showSecrets)}>
              {showSecrets ? "Hide" : "Reveal"} private salt
            </Button>
            {showSecrets && (
              <p className="mt-2">
                <Mono>{bundle.salt}</Mono> <span className="text-rose-700">Private. Anyone with the salt and token can link this commitment to your credential.</span>
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold">3. Register on-chain</h3>
          <p className="mt-1 text-xs text-slate-600">
            Publicly visible, forever: the commitment, your wallet address, the issuer’s address, the schema id, the validity window and the transaction. The credential, salt
            and synthetic data are not sent.
          </p>
          <div className="mt-3">
            <Button
              busy={register.busy}
              disabled={!ownsBundle || !app.onExpectedChain || wrongDeployment || status !== "Unregistered"}
              onClick={() =>
                register.run(async () => {
                  const signer = await app.signer();
                  const registry = new Contract(app.config!.registry, CREDENTIAL_REGISTRY_ABI, signer);
                  await registry.getFunction("register").staticCall(bundle.authorization, bundle.authorizationSignature);
                  const tx = await registry.getFunction("register")(bundle.authorization, bundle.authorizationSignature);
                  setTxNote(`Registration submitted (${tx.hash.slice(0, 12)}…), waiting for confirmation…`);
                  const receipt = await tx.wait();
                  setTxNote(receipt?.status === 1 ? `Registered in block ${receipt.blockNumber}.` : "Registration transaction failed.");
                  await refresh();
                })
              }
            >
              Register credential
            </Button>
          </div>
          {register.error && <div className="mt-2"><Notice tone="error">{register.error}</Notice></div>}
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold">4. Use the gated action</h3>
          <p className="mt-1 text-xs text-slate-600">
            Calls <Mono>DemoGate.checkIn</Mono>. The contract asks the registry whether this commitment is valid for your wallet and the required schema. It never sees the
            credential.
          </p>
          <div className="mt-3">
            <Button
              busy={gate.busy}
              disabled={!ownsBundle || !app.onExpectedChain || wrongDeployment}
              onClick={() =>
                gate.run(async () => {
                  const signer = await app.signer();
                  const demoGate = new Contract(app.config!.gate, DEMO_GATE_ABI, signer);
                  await demoGate.getFunction("checkIn").staticCall(bundle.commitment);
                  const tx = await demoGate.getFunction("checkIn")(bundle.commitment);
                  setTxNote(`Check-in submitted (${tx.hash.slice(0, 12)}…), waiting for confirmation…`);
                  const receipt = await tx.wait();
                  const count = await demoGate.getFunction("checkIns")(app.address);
                  setTxNote(receipt?.status === 1 ? `Checked in to the verified member area (total check-ins: ${count}).` : "Check-in transaction failed.");
                })
              }
            >
              Check in to member area
            </Button>
          </div>
          {gate.error && <div className="mt-2"><Notice tone="error">{gate.error}</Notice></div>}
        </div>
      </div>
      {txNote && <div className="mt-3"><Notice tone="success">{txNote}</Notice></div>}

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold">5. Present to a verifier</h3>
        <p className="mt-1 text-xs text-slate-600">Open the verifier, start a fresh verification request, and approve sharing. You will see exactly what is shared before signing.</p>
        <div className="mt-3">
          <Link className="text-sm font-medium text-sky-700 underline" href="/verifier">
            Go to the verifier →
          </Link>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- backup

/** Encrypted device vault: survives reloads without ever storing the bundle or passphrase in plaintext. */
function VaultSection() {
  const app = useApp();
  const [stored, setStored] = useState<boolean>();
  const [savePass, setSavePass] = useState("");
  const [unlockPass, setUnlockPass] = useState("");
  const [note, setNote] = useState<string>();
  const save = useAction();
  const unlock = useAction();
  const forget = useAction();
  const address = app.address;

  useEffect(() => {
    setStored(undefined);
    setNote(undefined);
    if (!address) return;
    let live = true;
    void loadFromVault(address)
      .then((v) => live && setStored(!!v))
      .catch(() => live && setStored(false));
    return () => {
      live = false;
    };
  }, [address]);

  if (!address) return null;
  const ownsBundle = app.bundle?.authorization.holder.toLowerCase() === address.toLowerCase();

  return (
    <Card
      title="Keep it on this device"
      subtitle="Saves the credential in this browser, encrypted with a passphrase you choose (PBKDF2-SHA-256, 600,000 iterations → AES-256-GCM). Only ciphertext is stored; the passphrase is never stored or sent."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {ownsBundle && (
          <div className="space-y-2">
            <Field label="Vault passphrase" hint={`At least ${MIN_EXPORT_PASSWORD_LENGTH} characters. Needed after every reload.`}>
              <input className={inputClass} type="password" autoComplete="new-password" value={savePass} onChange={(e) => setSavePass(e.target.value)} />
            </Field>
            <Button
              busy={save.busy}
              disabled={savePass.length < MIN_EXPORT_PASSWORD_LENGTH}
              onClick={() =>
                save.run(async () => {
                  await saveToVault(address, await encryptBundle(app.bundle!, savePass));
                  setSavePass("");
                  setStored(true);
                  setNote("Saved, encrypted, on this device.");
                })
              }
            >
              {stored ? "Replace saved credential" : "Save encrypted on this device"}
            </Button>
            {save.error && <Notice tone="error">{save.error}</Notice>}
          </div>
        )}
        {stored && !app.bundle && (
          <div className="space-y-2">
            <Field label="Unlock passphrase">
              <input className={inputClass} type="password" autoComplete="current-password" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} />
            </Field>
            <Button
              busy={unlock.busy}
              disabled={!unlockPass}
              onClick={() =>
                unlock.run(async () => {
                  const envelope = await loadFromVault(address);
                  if (!envelope) throw new Error("Nothing saved on this device for this wallet.");
                  app.setBundle(await decryptBundle(envelope, unlockPass));
                  setUnlockPass("");
                  setNote("Unlocked. The decrypted credential is kept in this tab's memory only.");
                })
              }
            >
              Unlock saved credential
            </Button>
            {unlock.error && <Notice tone="error">{unlock.error}</Notice>}
          </div>
        )}
        {!ownsBundle && !stored && stored !== undefined && <p className="text-sm text-slate-500">Nothing saved on this device for this wallet.</p>}
      </div>
      {stored && (
        <div className="mt-3">
          <Button
            variant="secondary"
            busy={forget.busy}
            onClick={() =>
              forget.run(async () => {
                await deleteFromVault(address);
                setStored(false);
                setNote("Removed from this device.");
              })
            }
          >
            Remove from this device
          </Button>
        </div>
      )}
      {note && <div className="mt-3"><Notice tone="success">{note}</Notice></div>}
    </Card>
  );
}

function BackupSection() {
  const app = useApp();
  const [password, setPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [file, setFile] = useState<File>();
  const [note, setNote] = useState<string>();
  const exp = useAction();
  const imp = useAction();
  return (
    <Card
      title="Encrypted backup"
      subtitle={`Your bundle exists only in this tab's memory and a reload forgets it. Export encrypts it with your password (PBKDF2-SHA-256, 600,000 iterations → AES-256-GCM). The password is never stored or sent.`}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Field label="Export password" hint={`At least ${MIN_EXPORT_PASSWORD_LENGTH} characters.`}>
            <input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button
            busy={exp.busy}
            disabled={!app.bundle || password.length < MIN_EXPORT_PASSWORD_LENGTH}
            onClick={() =>
              exp.run(async () => {
                const env = await encryptBundle(app.bundle!, password);
                const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `credential-backup-${app.bundle!.commitment.slice(2, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                setPassword("");
                setNote("Encrypted backup downloaded.");
              })
            }
          >
            Download encrypted backup
          </Button>
          {exp.error && <Notice tone="error">{exp.error}</Notice>}
        </div>
        <div className="space-y-2">
          <Field label="Backup file">
            <input className={inputClass} type="file" accept="application/json" onChange={(e) => setFile(e.target.files?.[0])} />
          </Field>
          <Field label="Backup password">
            <input className={inputClass} type="password" autoComplete="current-password" value={importPassword} onChange={(e) => setImportPassword(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            busy={imp.busy}
            disabled={!file || !importPassword}
            onClick={() =>
              imp.run(async () => {
                const env = JSON.parse(await file!.text());
                app.setBundle(await decryptBundle(env, importPassword));
                setImportPassword("");
                setNote("Backup decrypted and loaded into memory.");
              })
            }
          >
            Import backup
          </Button>
          {imp.error && <Notice tone="error">{imp.error}</Notice>}
        </div>
      </div>
      {note && <div className="mt-3"><Notice tone="success">{note}</Notice></div>}
    </Card>
  );
}

export default function HolderPage() {
  const app = useApp();
  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-semibold">Holder</h1>
        <p className="text-sm text-slate-600">You control a wallet, request a credential, keep it privately, and decide when to present it.</p>
      </div>
      <WalletBar />
      <SignInGate role="holder">
        <RequestSection onBundle={(b) => app.setBundle(b)} />
      </SignInGate>
      {app.bundle ? <CredentialSection bundle={app.bundle} /> : <Card tone="muted"><p className="text-sm text-slate-600">No credential loaded. Receive one after approval, unlock one saved on this device, or import an encrypted backup below.</p></Card>}
      <VaultSection />
      <BackupSection />
    </Shell>
  );
}
