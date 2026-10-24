import { hexlify, randomBytes } from "ethers";
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { ACTION_POLICIES } from "../../src/lib/shared/constants";
import { presentationStatement } from "../../src/lib/shared/eip712";
import { POLICIES, friendlyReason, type PolicyId } from "../../src/lib/shared/policies";
import { compactPresentation, decodeDisclosure } from "../../src/lib/shared/sd-jwt";
import { checkReceiptChain, GENESIS, matchCode, sha256Hex, signReceipt, verifyReceipt, type ChainCheck, type Receipt, type ReceiptJwks, type ReceiptRow } from "../../src/lib/shared/receipt-chain";
import type { ChallengeResponse, PresentationSubmissionT } from "../../src/lib/shared/api";
import { failureCode, finalize, verifyPresentationCore } from "../../src/lib/server/verifier/core";
import { World, type Holder } from "../src/world";

/**
 * decID, hosted in one browser tab. The same flow as the server product (src/lib/server/verify-api)
 * with the same production code for everything that matters:
 *
 *   issuance          src/lib/server/issuer/issue.ts      (via World.issue)
 *   registry, gate    the compiled Solidity contracts, on an in-page EVM (site/src/in-page-chain.ts)
 *   holder answer     src/lib/shared/presentation.ts + an EIP-712 signature (via World.present)
 *   verification      src/lib/server/verifier/core.ts
 *   receipts, codes   src/lib/shared/receipt-chain.ts
 *
 * What differs from the server: sessions and receipts live in memory instead of SQLite, the
 * Pass's activation is sent by the holder's own key (the in-page chain charges no fees, so no
 * gas sponsor is needed), and everything resets when the page reloads. Synthetic people only.
 */

export const SESSION_TTL = 300;

export type MerchantId = "hopline" | "neonhall";
export interface Merchant {
  id: MerchantId;
  name: string;
  kind: "online" | "venue";
}
export const MERCHANTS: Record<MerchantId, Merchant> = {
  hopline: { id: "hopline", name: "Hopline", kind: "online" },
  neonhall: { id: "neonhall", name: "Neon Hall", kind: "venue" },
};

export interface Person {
  id: string;
  label: string;
  holder: Holder;
  issuerName: string;
  claims: Record<string, boolean | string>;
  status: string;
  history: { at: number; merchant: string; shared: string; outcome: "verified" | "rejected"; failureCode: string | null; matchCode: string | null }[];
}

interface Session {
  id: string;
  merchantId: MerchantId;
  policy: PolicyId;
  reference: string | null;
  nonce: string;
  audience: string;
  chainId: number;
  registry: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "processing" | "verified" | "rejected";
  failureCode: string | null;
  completedAt: number | null;
  matchCode: string | null;
  issuerName: string | null;
  receiptSeq: number | null;
  verifyMs: number | null;
}

/** What the business's backend gets back: the same shape as GET /api/v1/verifications/:id. */
export interface MerchantView {
  id: string;
  policy: PolicyId;
  reference: string | null;
  status: "pending" | "processing" | "verified" | "rejected" | "expired";
  createdAt: number;
  completedAt: number | null;
  result: Record<string, boolean> | null;
  failureCode: string | null;
  matchCode: string | null;
  issuer: { name: string } | null;
  receipt: { jws: string; payload: Receipt; valid: boolean } | null;
  verifyMs: number | null;
}

export interface WalletRequest {
  id: string;
  merchant: Merchant;
  policy: { id: PolicyId; question: string; short: string };
  status: MerchantView["status"];
  expiresAt: number;
  challenge: ChallengeResponse;
}

export interface Outcome {
  status: "verified" | "rejected";
  failureCode: string | null;
  matchCode: string | null;
}

export class SessionError extends Error {
  constructor(
    readonly code: "UNKNOWN_SESSION" | "SESSION_EXPIRED" | "SESSION_USED",
    message: string,
  ) {
    super(message);
  }
}

export class DecidCloud {
  readonly people: Person[] = [];
  private sessions = new Map<string, Session>();
  private receipts: Record<MerchantId, (ReceiptRow & { sessionId: string })[]> = { hopline: [], neonhall: [] };
  private tampered: { merchantId: MerchantId; seq: number; original: ReceiptRow & { sessionId: string } } | null = null;
  /** Bumped on every change, so the UI knows when to re-read. */
  version = 0;
  private listeners = new Set<() => void>();

  private constructor(
    readonly world: World,
    private receiptKey: CryptoKey,
    readonly receiptKid: string,
    readonly jwks: ReceiptJwks,
  ) {}

  static async create(): Promise<DecidCloud> {
    const world = await World.create();
    world.issuers[0]!.name = "Simulated Identity Office (demo only)";
    const { privateKey, publicKey } = await generateKeyPair("Ed25519", { extractable: true });
    const pub = await exportJWK(publicKey);
    const jwk = { kty: pub.kty!, crv: pub.crv!, x: pub.x! };
    const kid = await calculateJwkThumbprint(jwk);
    return new DecidCloud(world, privateKey, kid, { keys: [{ ...jwk, kid }] });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  now(): number {
    return this.world.now();
  }

  // ---------------------------------------------------------------- decID Pass (holder side)

  /**
   * Get verified once: the simulated issuer checks the application and issues a credential that
   * stays on the phone; the Pass then activates its random commitment on the registry. The
   * issuer receives only the birth date and country it needs to derive the yes/no answers.
   */
  async getVerified(label: string, application: { dateOfBirth: string; country: string }, onStep?: (s: "issuing" | "activating") => void): Promise<Person> {
    const holder = this.world.newHolder(label);
    onStep?.("issuing");
    const bundle = await this.world.issue(holder, application);
    onStep?.("activating");
    const tx = await this.world.register(holder);
    if (!tx.ok) throw new Error(`activation failed: ${tx.revert ?? "reverted"}`);
    const claims = Object.fromEntries(bundle.disclosures.map((d) => decodeDisclosure(d)).map((d) => [d.name, d.value as boolean | string]));
    const person: Person = { id: hexlify(randomBytes(8)), label, holder, issuerName: this.world.issuers[0]!.name, claims, status: await this.world.status(bundle.commitment), history: [] };
    this.people.push(person);
    this.changed();
    return person;
  }

  /** The issuer revokes a credential (for example, the phone was reported lost). */
  async revoke(person: Person): Promise<void> {
    const tx = await this.world.revoke(person.holder.bundle!);
    if (!tx.ok) throw new Error(`revocation failed: ${tx.revert ?? "reverted"}`);
    person.status = await this.world.status(person.holder.bundle!.commitment);
    this.changed();
  }

  walletRequest(id: string): WalletRequest {
    const s = this.sessions.get(id);
    if (!s) throw new SessionError("UNKNOWN_SESSION", "this request does not exist");
    const p = POLICIES[s.policy];
    const action = ACTION_POLICIES[p.action];
    return {
      id: s.id,
      merchant: MERCHANTS[s.merchantId],
      policy: { id: p.id, question: p.question, short: p.short },
      status: this.effectiveStatus(s),
      expiresAt: s.expiresAt,
      challenge: {
        challengeId: s.id,
        nonce: s.nonce,
        action: p.action,
        audience: s.audience,
        chainId: s.chainId,
        registry: s.registry,
        expiresAt: s.expiresAt,
        requestedClaims: [...action.requested],
        statement: presentationStatement(s.audience, p.action, action.requested),
      },
    };
  }

  /** The holder answers: only the requested claim is disclosed, and the Pass signs. */
  async share(person: Person, requestId: string): Promise<Outcome> {
    const req = this.walletRequest(requestId);
    const sub = await this.world.present(person.holder, req.challenge);
    const out = await this.submit(requestId, sub);
    person.history.unshift({ at: Date.now(), merchant: req.merchant.name, shared: req.policy.short, outcome: out.status, failureCode: out.failureCode, matchCode: out.matchCode });
    this.changed();
    return out;
  }

  // ---------------------------------------------------------------- decID Verify (business side)

  createSession(merchantId: MerchantId, policy: PolicyId, reference?: string): MerchantView {
    const d = this.world.deployment;
    const now = this.now();
    const s: Session = {
      id: crypto.randomUUID(),
      merchantId,
      policy,
      reference: reference ?? null,
      nonce: hexlify(randomBytes(32)),
      audience: `urn:decid:merchant:${merchantId}`,
      chainId: d.chainId,
      registry: d.registry,
      createdAt: now,
      expiresAt: now + SESSION_TTL,
      status: "pending",
      failureCode: null,
      completedAt: null,
      matchCode: null,
      issuerName: null,
      receiptSeq: null,
      verifyMs: null,
    };
    this.sessions.set(s.id, s);
    this.changed();
    return this.view(s);
  }

  /** A business reads its own session; another business's session looks missing. */
  async getSession(merchantId: MerchantId, id: string): Promise<MerchantView> {
    const s = this.sessions.get(id);
    if (!s || s.merchantId !== merchantId) throw new SessionError("UNKNOWN_SESSION", "no such verification");
    return this.viewWithReceipt(s);
  }

  /** The verifier side of an answer: single use, production verifier core, signed receipt. */
  async submit(id: string, sub: Omit<PresentationSubmissionT, "challengeId">): Promise<Outcome> {
    const s = this.sessions.get(id);
    if (!s) throw new SessionError("UNKNOWN_SESSION", "this request does not exist");
    if (this.effectiveStatus(s) === "expired") throw new SessionError("SESSION_EXPIRED", "this request expired; ask for a new one");
    if (s.status !== "pending") throw new SessionError("SESSION_USED", "this request was already answered");
    s.status = "processing";
    const policy = POLICIES[s.policy];
    const started = performance.now();
    const now = this.now();
    let core: Awaited<ReturnType<typeof verifyPresentationCore>>;
    try {
      core = await verifyPresentationCore(
        { nonce: s.nonce, action: policy.action, audience: s.audience, chainId: s.chainId, registry: s.registry, expiresAt: s.expiresAt },
        { ...sub, challengeId: id } as PresentationSubmissionT,
        { deployment: this.world.deployment, issuers: this.world.issuers, now, provider: this.world.provider },
      );
    } catch (e) {
      Object.assign(s, { status: "rejected", failureCode: "INTERNAL", completedAt: now });
      this.changed();
      throw e;
    }
    const verifyMs = performance.now() - started;
    const result = finalize([{ id: "challenge", status: "pass" }, ...core.checks], { registryStatus: core.registryStatus, disclosed: core.disclosed });
    const verified = result.verified;
    const code = verified ? null : (failureCode(core.checks) ?? "FAILED");
    const match = verified ? matchCode(id, sub.proof.signature) : null;
    const seq = await this.appendReceipt(s.merchantId, {
      sid: id,
      merchant: s.merchantId,
      ref: s.reference,
      policy: policy.id,
      outcome: verified ? "satisfied" : "not_satisfied",
      failureCode: code,
      issuer: verified && core.disclosed ? { name: core.disclosed.issuerName, did: core.disclosed.issuerDid } : null,
      registry: { chainId: s.chainId, address: s.registry, status: core.registryStatus ?? null },
      evidence: sha256Hex(`${compactPresentation(sub.credentialJwt, sub.disclosures)}|${sub.proof.signature}`),
      checkedAt: new Date(now * 1000).toISOString(),
    });
    Object.assign(s, {
      status: verified ? "verified" : "rejected",
      failureCode: code,
      completedAt: now,
      matchCode: match,
      issuerName: verified ? (core.disclosed?.issuerName ?? null) : null,
      receiptSeq: seq,
      verifyMs,
    });
    this.changed();
    return { status: s.status as Outcome["status"], failureCode: code, matchCode: match };
  }

  list(merchantId: MerchantId): MerchantView[] {
    // Map keeps insertion order: newest first is simply the reverse.
    return [...this.sessions.values()]
      .filter((s) => s.merchantId === merchantId)
      .reverse()
      .map((s) => this.view(s));
  }

  stats(merchantId: MerchantId) {
    const rows = [...this.sessions.values()].filter((s) => s.merchantId === merchantId);
    const done = rows.filter((r) => r.status === "verified" || r.status === "rejected");
    const failures: Record<string, number> = {};
    for (const r of done) if (r.failureCode) failures[r.failureCode] = (failures[r.failureCode] ?? 0) + 1;
    return {
      total: rows.length,
      verified: done.filter((r) => r.status === "verified").length,
      rejected: done.filter((r) => r.status === "rejected").length,
      pending: rows.filter((r) => this.effectiveStatus(r) === "pending").length,
      failures,
      /** Verifier time per completed check, oldest first (for the dashboard chart). */
      verifyMs: done.filter((r) => r.verifyMs !== null).map((r) => ({ id: r.id, ms: r.verifyMs!, ok: r.status === "verified" })),
    };
  }

  /** The complete list of fields stored per check, to make "no personal data" checkable. */
  storedFields(): string[] {
    return ["id", "merchant_id", "policy", "reference", "nonce", "audience", "chain_id", "registry", "created_at", "expires_at", "status", "failure_code", "completed_at", "match_code", "issuer_name", "receipt_seq"];
  }

  async receiptChain(merchantId: MerchantId): Promise<ChainCheck> {
    return checkReceiptChain(this.receipts[merchantId], this.jwks, merchantId);
  }

  /** The stored chain for the dashboard's Receipts page: each link with its decoded body. */
  receiptRows(merchantId: MerchantId): { seq: number; hash: string; prev: string; sessionId: string; body: Receipt | null }[] {
    return this.receipts[merchantId].map((r) => {
      let body: Receipt | null = null;
      try {
        body = JSON.parse(atob(r.jws.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as Receipt;
      } catch {
        body = null;
      }
      return { seq: r.seq, hash: r.hash, prev: r.prev_hash, sessionId: r.sessionId, body };
    });
  }

  get tamperedReceipt() {
    return this.tampered;
  }

  /**
   * An insider edits a stored receipt (turns a refusal into a pass, or a pass into a refusal)
   * without decID's signing key. The chain check must notice. undo() puts the original back.
   */
  async tamper(merchantId: MerchantId): Promise<void> {
    const rows = this.receipts[merchantId];
    if (!rows.length || this.tampered) return;
    const i = Math.floor((rows.length - 1) / 2);
    const original = rows[i]!;
    const [h, p, sig] = original.jws.split(".") as [string, string, string];
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))) as Receipt;
    payload.outcome = payload.outcome === "satisfied" ? "not_satisfied" : "satisfied";
    const forged = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    // A careful insider also recomputes the stored hash; only decID's signature still gives it away.
    const jws = `${h}.${forged}.${sig}`;
    rows[i] = { ...original, jws, hash: sha256Hex(jws) };
    this.tampered = { merchantId, seq: original.seq, original };
    this.changed();
  }

  undoTamper(): void {
    if (!this.tampered) return;
    const rows = this.receipts[this.tampered.merchantId];
    rows[this.tampered.seq - 1] = this.tampered.original;
    this.tampered = null;
    this.changed();
  }

  // ---------------------------------------------------------------- a busy night at the door

  /**
   * Runs a queue of synthetic guests through the Neon Hall door with the real flow: each guest
   * is verified once (real issuance and on-chain activation), the door creates a session and the
   * guest's Pass answers it. Two guests try something: one shows a friend's credential from their
   * own phone, and one shows a Pass the issuer has revoked.
   */
  async simulateNight(guests: number, onProgress?: (done: number, total: number, line: string) => void): Promise<void> {
    const total = guests + 2;
    let done = 0;
    const step = (line: string) => onProgress?.(++done, total, line);
    const bornYearsAgo = (age: number) => {
      const d = new Date(this.now() * 1000);
      d.setUTCFullYear(d.getUTCFullYear() - age);
      d.setUTCDate(d.getUTCDate() - 30); // a birthday a month ago: exactly `age` today
      return d.toISOString().slice(0, 10);
    };
    const queue: Holder[] = [];
    for (let i = 0; i < guests; i++) {
      const age = i % 5 === 3 ? 17 + (i % 3) : 21 + ((i * 7) % 25); // every fifth guest is under 21
      const holder = this.world.newHolder(`Guest ${i + 1}`);
      await this.world.issue(holder, { dateOfBirth: bornYearsAgo(age), country: "ZZ" });
      await this.world.register(holder);
      const s = this.createSession("neonhall", "age_over_21", `night-${String(i + 1).padStart(2, "0")}`);
      const out = await this.submit(s.id, await this.world.present(holder, this.walletRequest(s.id).challenge));
      queue.push(holder);
      step(`Guest ${i + 1} (${age}): ${out.status === "verified" ? `admitted · ${out.matchCode}` : "refused · not old enough"}`);
    }
    // A guest shows a friend's credential: the friend's Pass, signed by the guest's own key.
    const friend = queue.find((h) => h.bundle) ?? queue[0]!;
    const borrower = this.world.newHolder("Borrower");
    const s1 = this.createSession("neonhall", "age_over_21", "night-borrowed");
    const o1 = await this.submit(s1.id, await this.world.present(borrower, this.walletRequest(s1.id).challenge, friend.bundle!));
    step(`Borrowed credential: ${o1.status === "verified" ? "admitted" : `refused · ${friendlyReason(o1.failureCode).toLowerCase()}`}`);
    // A Pass reported lost and revoked by the issuer.
    const lost = this.world.newHolder("Lost phone");
    await this.world.issue(lost, { dateOfBirth: bornYearsAgo(30), country: "ZZ" });
    await this.world.register(lost);
    await this.world.revoke(lost.bundle!);
    const s2 = this.createSession("neonhall", "age_over_21", "night-revoked");
    const o2 = await this.submit(s2.id, await this.world.present(lost, this.walletRequest(s2.id).challenge));
    step(`Revoked Pass: ${o2.status === "verified" ? "admitted" : `refused · ${friendlyReason(o2.failureCode).toLowerCase()}`}`);
  }

  // ---------------------------------------------------------------- internals

  private effectiveStatus(s: Session): MerchantView["status"] {
    return s.status === "pending" && s.expiresAt <= this.now() ? "expired" : s.status;
  }

  private view(s: Session): MerchantView {
    const p = POLICIES[s.policy];
    const status = this.effectiveStatus(s);
    return {
      id: s.id,
      policy: s.policy,
      reference: s.reference,
      status,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      // "false" only when the holder genuinely does not meet the policy (as on the server).
      result: status === "verified" ? { [p.resultKey]: true } : s.failureCode === "POLICY_NOT_SATISFIED" ? { [p.resultKey]: false } : null,
      failureCode: s.failureCode,
      matchCode: s.matchCode,
      issuer: s.issuerName ? { name: s.issuerName } : null,
      receipt: null,
      verifyMs: s.verifyMs,
    };
  }

  private async viewWithReceipt(s: Session): Promise<MerchantView> {
    const v = this.view(s);
    const row = s.receiptSeq ? this.receipts[s.merchantId][s.receiptSeq - 1] : undefined;
    if (!row) return v;
    // The business checks the signature itself, against decID's published key.
    let payload: Receipt;
    let valid = true;
    try {
      payload = await verifyReceipt(row.jws, this.jwks);
    } catch {
      valid = false;
      payload = JSON.parse(atob(row.jws.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as Receipt;
    }
    return { ...v, receipt: { jws: row.jws, payload, valid } };
  }

  private async appendReceipt(merchantId: MerchantId, body: Omit<Receipt, "seq" | "prev" | "iat">): Promise<number> {
    const rows = this.receipts[merchantId];
    const last = rows[rows.length - 1];
    const receipt: Receipt = { ...body, seq: rows.length + 1, prev: last?.hash ?? GENESIS, iat: this.now() };
    const jws = await signReceipt(receipt, this.receiptKey, this.receiptKid);
    rows.push({ seq: receipt.seq, jws, hash: sha256Hex(jws), prev_hash: receipt.prev, sessionId: body.sid });
    return receipt.seq;
  }
}
