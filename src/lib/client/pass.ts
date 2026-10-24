"use client";

import { Interface, Wallet, getAddress } from "ethers";
import { CREDENTIAL_REGISTRY_ABI } from "@/generated/contracts";
import { HolderBundleV2, type HolderBundle } from "@/lib/shared/bundle";
import type { PublicConfigResponse } from "@/lib/shared/api";
import { PRESENTATION_TYPES, presentationDomain } from "@/lib/shared/eip712";
import { preparePresentation } from "@/lib/shared/presentation";
import { decodeDisclosure } from "@/lib/shared/sd-jwt";
import { api } from "./api";

/**
 * decID Pass: the consumer wallet, in the browser. No browser extension, no seed phrase and no
 * cryptocurrency: the device creates its own signing key, the issuer's credential is stored
 * next to it, and registration gas is sponsored by the server.
 *
 * Storage: IndexedDB on this device only ("decid-pass"). It works over plain-HTTP LAN addresses
 * (no crypto.subtle needed), so a phone can join a demo on the same Wi-Fi.
 *
 * Production would keep the key in the platform's secure enclave behind a passkey, and back up
 * the credential end to end encrypted. This prototype keeps the key in IndexedDB.
 *
 * Several "profiles" can live side by side, so one laptop can demonstrate two people.
 */

export interface PassProfile {
  id: string;
  label: string;
  privateKey: string;
  address: string;
  createdAt: number;
  bundle?: HolderBundle;
  issuerName?: string;
  /** The platform passkey (Face ID / fingerprint / PIN) this Pass confirms shares with. */
  passkeyId?: string;
}

export interface HistoryEntry {
  profileId: string;
  at: number;
  merchant: string;
  question: string;
  shared: string;
  outcome: "verified" | "rejected" | "declined";
  failureCode?: string | null;
  matchCode?: string | null;
}

const DB = "decid-pass";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
      req.result.createObjectStore("history", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("this browser cannot store a Pass (IndexedDB unavailable)"));
  });
}

async function tx<T>(store: "kv" | "history", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

const randomId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function listProfiles(): Promise<PassProfile[]> {
  const all = (await tx<PassProfile[]>("kv", "readonly", (s) => s.getAll())).filter((p) => p && typeof p === "object" && "privateKey" in p);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function activeProfile(): Promise<PassProfile | undefined> {
  const id = await tx<string | undefined>("kv", "readonly", (s) => s.get("active"));
  const all = await listProfiles();
  return all.find((p) => p.id === id) ?? all[0];
}

export async function setActive(id: string): Promise<void> {
  await tx("kv", "readwrite", (s) => s.put(id, "active"));
}

export async function createProfile(label: string): Promise<PassProfile> {
  const w = Wallet.createRandom();
  const p: PassProfile = { id: randomId(), label, privateKey: w.privateKey, address: w.address, createdAt: Date.now() };
  await tx("kv", "readwrite", (s) => s.put(p, `profile:${p.id}`));
  await setActive(p.id);
  return p;
}

export async function saveProfile(p: PassProfile): Promise<void> {
  await tx("kv", "readwrite", (s) => s.put(p, `profile:${p.id}`));
}

export async function deleteProfile(id: string): Promise<void> {
  await tx("kv", "readwrite", (s) => s.delete(`profile:${id}`));
}

export async function addHistory(e: HistoryEntry): Promise<void> {
  await tx("history", "readwrite", (s) => s.add(e));
}

export async function history(profileId: string): Promise<HistoryEntry[]> {
  return (await tx<HistoryEntry[]>("history", "readonly", (s) => s.getAll())).filter((e) => e.profileId === profileId).reverse();
}

export const walletOf = (p: PassProfile) => new Wallet(p.privateKey);

/** What the credential says, read from the holder's own disclosures (never sent anywhere by this). */
export function claimsOf(bundle: HolderBundle): Record<string, boolean | string> {
  return Object.fromEntries(bundle.disclosures.map((d) => decodeDisclosure(d)).map((d) => [d.name, d.value as boolean | string]));
}

export function validUntil(bundle: HolderBundle): Date {
  return new Date(bundle.authorization.expiresAt * 1000);
}

// ---------------------------------------------------------------- server conversations

/** Signs in to the app as this holder (SIWE), unless already signed in as them. */
export async function ensureSession(p: PassProfile, config: PublicConfigResponse): Promise<void> {
  const current = await api<{ session: { address: string; role: string } | null }>("GET", "/api/auth/session");
  if (current.session && current.session.role === "holder" && getAddress(current.session.address) === getAddress(p.address)) return;
  const w = walletOf(p);
  const { message } = await api<{ message: string }>("POST", "/api/auth/challenge", { address: w.address, chainId: config.chainId, role: "holder" });
  await api("POST", "/api/auth/verify", { message, signature: await w.signMessage(message) });
}

export type Step = "applying" | "waiting-review" | "asking-wallet" | "checking-id" | "issuing" | "activating" | "done";

/**
 * Get verified: apply to the (simulated) issuer, wait for approval, pick up the credential and
 * activate it on the registry with a sponsored, self-signed transaction.
 */
export async function getVerified(
  p: PassProfile,
  config: PublicConfigResponse,
  application: { fullName: string; dateOfBirth: string; documentNumber: string; country: string },
  onStep: (s: Step) => void,
): Promise<PassProfile> {
  await ensureSession(p, config);
  onStep("applying");
  const created = await api<{ id: string; status?: string }>("POST", "/api/holder/requests", { ...application, syntheticDataConfirmed: true });
  if (created.status !== "approved") {
    onStep("waiting-review");
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const { requests } = await api<{ requests: { id: string; status: string; rejectReason: string | null }[] }>("GET", "/api/holder/requests");
      const mine = requests.find((r) => r.id === created.id);
      if (mine?.status === "approved") break;
      if (mine?.status === "rejected") throw new Error(`The issuer declined: ${mine.rejectReason ?? "no reason given"}`);
    }
  }
  onStep("issuing");
  const { bundle } = await api<{ bundle: HolderBundle }>("POST", `/api/holder/requests/${created.id}/bundle`, {});
  const parsed = HolderBundleV2.parse(bundle);
  const withBundle: PassProfile = { ...p, bundle: parsed, issuerName: config.issuers[0]?.name };
  await saveProfile(withBundle); // keep it even if activation fails; it can be retried
  onStep("activating");
  await activate(withBundle, config);
  onStep("done");
  return withBundle;
}

/** The browser can ask a phone wallet for an ID (W3C Digital Credentials API: Safari 26+, Chrome 141+). */
export function walletIdSupported(): boolean {
  return typeof window !== "undefined" && "DigitalCredential" in window && typeof navigator.credentials?.get === "function";
}

export type IdSource = { kind: "wallet" } | { kind: "test"; birthDate: string };

/**
 * Get verified with the government ID in a phone wallet: decID asks the wallet for "over 18" and
 * "over 21" only, the person approves in the wallet, the server checks the state's and the phone's
 * signatures and issues the Pass to this device's key. Then pick up and activate as usual.
 *
 * With a test source, the test wallet (synthetic licence from the demo's test DMV) answers instead
 * of a real wallet, running the same protocol in this page.
 */
export async function getVerifiedWithId(p: PassProfile, config: PublicConfigResponse, source: IdSource, onStep: (s: Step) => void): Promise<PassProfile> {
  await ensureSession(p, config);
  onStep("asking-wallet");
  const req = await api<{ id: string; protocol: string; data: { deviceRequest: string; encryptionInfo: string } }>("POST", "/api/holder/mdl/requests", {});
  let response: string;
  if (source.kind === "wallet") {
    const cred = (await navigator.credentials.get({
      // The DC API member is not in TypeScript's DOM types yet.
      ...({ digital: { requests: [{ protocol: req.protocol, data: req.data }] } } as object),
      mediation: "required",
    } as CredentialRequestOptions)) as (Credential & { data?: unknown }) | null;
    if (!cred) throw new Error("The wallet didn’t share anything.");
    const data = typeof cred.data === "string" ? (JSON.parse(cred.data) as { response?: string }) : (cred.data as { response?: string } | undefined);
    if (!data?.response) throw new Error("The wallet’s answer wasn’t understood.");
    response = data.response;
  } else {
    const licence = await api<{ mdoc: string; devicePrivateJwk: JsonWebKey }>("POST", "/api/demo/test-licence", { birthDate: source.birthDate });
    const { answerRequest } = await import("@/lib/shared/mdl/test-wallet");
    const mdoc = Uint8Array.from(atob(licence.mdoc.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    response = await answerRequest({ mdoc, devicePrivateJwk: licence.devicePrivateJwk as never }, req.data, window.location.origin);
  }
  onStep("checking-id");
  const issued = await api<{ requestId: string; issuer: { name: string; test: boolean } }>("POST", `/api/holder/mdl/requests/${req.id}/response`, { response });
  onStep("issuing");
  const { bundle } = await api<{ bundle: HolderBundle }>("POST", `/api/holder/requests/${issued.requestId}/bundle`, {});
  // The card names the authority that signed the licence, e.g. "California DMV".
  const withBundle: PassProfile = { ...p, bundle: HolderBundleV2.parse(bundle), issuerName: issued.issuer.name };
  await saveProfile(withBundle);
  onStep("activating");
  await activate(withBundle, config);
  onStep("done");
  return withBundle;
}

/** Registers the credential's commitment from the holder's own key; decID pays the gas. */
export async function activate(p: PassProfile, config: PublicConfigResponse): Promise<void> {
  await ensureSession(p, config);
  const b = p.bundle!;
  const params = await api<{ chainId: number; to: string; nonce: number; gasLimit: string; maxFeePerGas: string; maxPriorityFeePerGas: string }>("GET", "/api/pass/registration");
  const data = new Interface(CREDENTIAL_REGISTRY_ABI).encodeFunctionData("register", [b.authorization, b.authorizationSignature]);
  const rawTx = await walletOf(p).signTransaction({
    type: 2,
    chainId: params.chainId,
    nonce: params.nonce,
    to: params.to,
    data,
    value: 0,
    gasLimit: BigInt(params.gasLimit),
    maxFeePerGas: BigInt(params.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(params.maxPriorityFeePerGas),
  });
  const res = await api<{ status: string }>("POST", "/api/pass/registration", { rawTx });
  if (res.status !== "registered") throw new Error("activation failed on the registry");
}

export async function credentialStatus(b: HolderBundle): Promise<string> {
  return (await api<{ status: string }>("GET", `/api/pass/credential-status/${b.commitment}`)).status;
}

export interface WalletRequest {
  id: string;
  merchant: { name: string; kind: "online" | "venue" };
  policy: { id: string; question: string; short: string };
  status: string;
  expiresAt: number;
  challenge: { challengeId: string; nonce: string; action: string; audience: string; chainId: number; registry: string; expiresAt: number; requestedClaims: string[]; statement: string };
  unlock: { challenge: string; required: boolean };
}

export async function loadRequest(id: string): Promise<WalletRequest> {
  return api<WalletRequest>("GET", `/api/v1/verifications/${id}/request`);
}

export interface Outcome {
  status: "verified" | "rejected";
  failureCode: string | null;
  matchCode: string | null;
  userVerified: boolean;
  merchant: { name: string };
  policy: { id: string; short: string };
}

// ---------------------------------------------------------------- device unlock (passkey)

/** Platform passkeys need a secure context (HTTPS or localhost) and WebAuthn. */
export function unlockAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

/** Turns on Face ID / fingerprint for this Pass: registers a platform passkey with decID. */
export async function enableUnlock(p: PassProfile, config: PublicConfigResponse): Promise<PassProfile> {
  await ensureSession(p, config);
  const { startRegistration } = await import("@simplewebauthn/browser");
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("POST", "/api/pass/passkey/options", {});
  const response = await startRegistration({ optionsJSON });
  const { credentialId } = await api<{ credentialId: string }>("POST", "/api/pass/passkey", { response });
  const next = { ...p, passkeyId: credentialId };
  await saveProfile(next);
  return next;
}

/** Answers a business's request: only the requested claim is disclosed, and the wallet signs. */
export async function share(p: PassProfile, req: WalletRequest): Promise<Outcome> {
  const b = p.bundle!;
  const w = walletOf(p);
  // Device unlock first: if the person can't unlock the phone, nothing is signed or sent.
  let unlock: unknown;
  if (p.passkeyId && unlockAvailable()) {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    unlock = await startAuthentication({
      optionsJSON: { challenge: req.unlock.challenge, rpId: window.location.hostname, allowCredentials: [{ id: p.passkeyId, type: "public-key" }], userVerification: "required", timeout: 60_000 },
    });
  } else if (req.unlock.required) {
    throw new Error(`${req.merchant.name} asks you to confirm with Face ID or your fingerprint. Turn it on for this Pass first.`);
  }
  const { disclosures, message } = preparePresentation(b, req.challenge, w.address);
  const signature = await w.signTypedData(presentationDomain(req.challenge.chainId, req.challenge.registry), PRESENTATION_TYPES, message);
  const out = await api<Outcome>("POST", `/api/v1/verifications/${req.id}/presentation`, {
    credentialJwt: b.credentialJwt,
    disclosures,
    salt: b.salt,
    proof: { holder: w.address, commitment: b.commitment, expiresAt: req.challenge.expiresAt, signature },
    ...(unlock ? { unlock } : {}),
  });
  await addHistory({ profileId: p.id, at: Date.now(), merchant: req.merchant.name, question: req.policy.question, shared: req.policy.short, outcome: out.status, failureCode: out.failureCode, matchCode: out.matchCode });
  return out;
}
