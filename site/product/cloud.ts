import { Contract, ContractFactory, Wallet, hexlify, randomBytes, type HDNodeWallet, type InterfaceAbi } from "ethers";
import anchorArtifact from "../../artifacts/contracts/ReceiptAnchor.sol/ReceiptAnchor.json";
import { checkAgainstAnchors, receiptStream, streamId, type AnchorCheck, type Checkpoint } from "../../src/lib/shared/anchor-check";
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { ACTION_POLICIES } from "../../src/lib/shared/constants";
import { presentationStatement } from "../../src/lib/shared/eip712";
import { POLICIES, friendlyReason, type PolicyId } from "../../src/lib/shared/policies";
import { compactPresentation, decodeDisclosure } from "../../src/lib/shared/sd-jwt";
import { checkReceiptChain, GENESIS, matchCode, sha256Hex, signReceipt, verifyReceipt, type ChainCheck, type Receipt, type ReceiptJwks, type ReceiptRow } from "../../src/lib/shared/receipt-chain";
import type { ChallengeResponse, PresentationSubmissionT } from "../../src/lib/shared/api";
import { failureCode, finalize, verifyPresentationCore } from "../../src/lib/server/verifier/core";
import { World, type Holder } from "../src/world";
import { detectRisk, riskForCheck, type CheckRecord, type RiskAlert } from "../../src/lib/shared/risk";
import { answerQuestion, type AssistantAnswer } from "../../src/lib/shared/assistant";
import { HEALTH_FACTS, issueHealthRecord, presentHealthFact, verifyHealthFact, type HealthCheckResult, type HealthFact, type HealthRecord } from "../../src/lib/shared/health";
import { buildRequest, decryptResponse, newReaderKey, sessionTranscript } from "../../src/lib/shared/mdl/annex-c";
import { verifyMdlResponse } from "../../src/lib/shared/mdl/verify";
import { answerRequest, createTestAuthority, provisionTestLicence, type TestAuthority, type TestWallet } from "../../src/lib/shared/mdl/test-wallet";

/**
 * decID, hosted in one browser tab. The same flow as the server product (src/lib/server/verify-api)
 * with the same production code for everything that matters:
 *
 *   issuance          src/lib/server/issuer/issue.ts      (via World.issue)
 *   registry, gate    the compiled Solidity contracts, on an in-page EVM (site/src/in-page-chain.ts)
 *   holder answer     src/lib/shared/presentation.ts + an EIP-712 signature (via World.present)
 *   verification      src/lib/server/verifier/core.ts
 *   receipts, codes   src/lib/shared/receipt-chain.ts
 *   government ID     src/lib/shared/mdl (ISO 18013-7 Annex C request, licence verification), with
 *                     a test DMV and a test phone wallet standing in for Apple / Google Wallet
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
  /** A health record from the demo clinic: each fact shared one at a time. */
  health?: HealthRecord;
  /** Face ID / fingerprint turned on for this Pass (simulated in the hosted prototype). */
  unlock?: boolean;
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
  requireUnlock: boolean;
  userVerified: boolean | null;
  passTag: string | null;
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
  userVerified: boolean | null;
  risk: RiskAlert[];
}

export interface WalletRequest {
  id: string;
  requireUnlock: boolean;
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

export type TamperKind = "insider" | "operator" | "truncate";

const decodePayload = (jws: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(jws.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))) as Receipt;
const encodePayload = (p: Receipt) => btoa(JSON.stringify(p)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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
  /** The receipts as they were before a simulated attack, so the demo can restore them. */
  private tampered: { merchantId: MerchantId; kind: TamperKind; seq: number; backup: (ReceiptRow & { sessionId: string })[] } | null = null;
  /** Keys the per-business, per-day Pass pseudonym used by the fraud signals. */
  private readonly tagSecret = hexlify(randomBytes(32));
  /** Bumped on every change, so the UI knows when to re-read. */
  version = 0;
  private listeners = new Set<() => void>();

  private constructor(
    readonly world: World,
    private receiptKey: CryptoKey,
    readonly receiptKid: string,
    readonly jwks: ReceiptJwks,
    /** ReceiptAnchor (contracts/ReceiptAnchor.sol) on the in-page chain, and the key allowed to anchor. */
    readonly anchor: Contract,
    private anchorer: HDNodeWallet,
  ) {}

  static async create(): Promise<DecidCloud> {
    const world = await World.create();
    world.issuers[0]!.name = "Simulated Identity Office (demo only)";
    const { privateKey, publicKey } = await generateKeyPair("Ed25519", { extractable: true });
    const pub = await exportJWK(publicKey);
    const jwk = { kty: pub.kty!, crv: pub.crv!, x: pub.x! };
    const kid = await calculateJwkThumbprint(jwk);
    // The same ReceiptAnchor contract as `npm run deploy`, with its own anchorer key.
    const anchorer = Wallet.createRandom(world.provider);
    const anchor = (await new ContractFactory(anchorArtifact.abi as InterfaceAbi, anchorArtifact.bytecode, world.deployer).deploy(world.deployer.address)) as Contract;
    await anchor.waitForDeployment();
    await (await anchor.getFunction("grantRole")(await anchor.getFunction("ANCHORER_ROLE")(), anchorer.address)).wait();
    return new DecidCloud(world, privateKey, kid, { keys: [{ ...jwk, kid }] }, anchor, anchorer);
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

  // ---------------------------------------------------------------- government ID (test wallet)

  private dmv?: TestAuthority;
  /** Licences in the test wallet, by name: provisioned once, like a licence added to a phone. */
  private licences = new Map<string, TestWallet>();
  /** One licence backs one active Pass: device-key thumbprint → the person whose Pass it backs. */
  private idBindings = new Map<string, string>();

  /**
   * Get verified with the licence in the phone's wallet: decID asks for "over 18" and "over 21"
   * only; the test wallet answers (signed by the licence's device key, encrypted to decID); decID
   * checks the test DMV's and the phone's signatures and issues the Pass. If the same licence
   * already backs another Pass, that one is revoked first.
   */
  async getVerifiedWithId(label: string, birthDate: string, onStep?: (s: "asking-wallet" | "checking-id" | "issuing" | "activating") => void): Promise<{ person: Person; replaced: Person | null }> {
    this.dmv ??= await createTestAuthority();
    let licence = this.licences.get(label);
    if (!licence) {
      licence = await provisionTestLicence(this.dmv, { birthDate, givenName: label });
      this.licences.set(label, licence);
    }
    onStep?.("asking-wallet");
    const origin = typeof location === "undefined" ? "https://decid.example" : location.origin;
    const reader = await newReaderKey();
    const request = await buildRequest(reader.publicKey);
    const response = await answerRequest(licence, request, origin);
    onStep?.("checking-id");
    const t = await sessionTranscript(request.encryptionInfo, origin);
    const id = await verifyMdlResponse(await decryptResponse(response, reader.privateKey, t.plain), t.tagged, [{ name: this.dmv.name, pem: this.dmv.rootPem, test: true }]);
    const previousId = this.idBindings.get(id.deviceKeyThumbprint);
    const replaced = this.people.find((p) => p.id === previousId) ?? null;
    if (replaced && replaced.status === "Active") await this.revoke(replaced);
    const holder = this.world.newHolder(label);
    onStep?.("issuing");
    const bundle = await this.world.issue(holder, {
      claims: { ageOver18: id.ageOver18 ?? id.ageOver21 === true, ageOver21: id.ageOver21 ?? false, countryOfResidence: id.issuingCountry ?? "US" },
      validUntil: Math.floor(id.validUntil.getTime() / 1000),
    });
    onStep?.("activating");
    const tx = await this.world.register(holder);
    if (!tx.ok) throw new Error(`activation failed: ${tx.revert ?? "reverted"}`);
    const claims = Object.fromEntries(bundle.disclosures.map((d) => decodeDisclosure(d)).map((d) => [d.name, d.value as boolean | string]));
    const person: Person = { id: hexlify(randomBytes(8)), label, holder, issuerName: this.dmv.name, claims, status: await this.world.status(bundle.commitment), history: [] };
    this.people.push(person);
    this.idBindings.set(id.deviceKeyThumbprint, person.id);
    this.changed();
    return { person, replaced };
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
      requireUnlock: s.requireUnlock,
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
    if (req.requireUnlock && !person.unlock) throw new Error(`${req.merchant.name} asks you to confirm with Face ID or your fingerprint. Turn it on for this Pass first.`);
    const sub = await this.world.present(person.holder, req.challenge);
    // In the hosted prototype the phone's Face ID is simulated; on the server it is a verified passkey assertion.
    const out = await this.submit(requestId, sub, { userVerified: !!person.unlock });
    person.history.unshift({ at: Date.now(), merchant: req.merchant.name, shared: req.policy.short, outcome: out.status, failureCode: out.failureCode, matchCode: out.matchCode });
    this.changed();
    return out;
  }

  // ---------------------------------------------------------------- decID Verify (business side)

  // ---------------------------------------------------------------- decID Health (synthetic)

  readonly clinicName = "Riverside Clinic (demo)";
  private clinic?: { key: CryptoKey; jwk: Awaited<ReturnType<typeof exportJWK>>; kid: string };
  private healthChecks = new Map<string, { id: string; fact: HealthFact; nonce: string; audience: string; result: HealthCheckResult | null }>();

  /** The demo clinic issues a synthetic health record to the person's phone key. */
  async addHealthRecord(person: Person): Promise<void> {
    if (!this.clinic) {
      const { privateKey, publicKey } = await generateKeyPair("Ed25519", { extractable: true });
      const jwk = await exportJWK(publicKey);
      this.clinic = { key: privateKey, jwk, kid: await calculateJwkThumbprint(jwk) };
    }
    // Synthetic facts: Sam's measles immunity is not on record, to show a "No".
    const facts = { measlesImmune: person.label !== "Sam", tbScreenClear: true, fluVaccine: person.label === "Alex", sportsClearance: true };
    person.health = await issueHealthRecord({ clinicKey: this.clinic.key, clinicKid: this.clinic.kid, clinic: this.clinicName, holder: person.holder.wallet.address, facts, now: this.now() });
    this.changed();
  }

  /** Whether any health question has been answered (for the walkthrough). */
  healthAnswered(): boolean {
    return [...this.healthChecks.values()].some((c) => c.result !== null);
  }

  /** A school's health office asks one question. */
  createHealthCheck(fact: HealthFact): string {
    const id = crypto.randomUUID();
    this.healthChecks.set(id, { id, fact, nonce: hexlify(randomBytes(16)), audience: "urn:decid:merchant:lakeside", result: null });
    this.changed();
    return id;
  }

  healthCheck(id: string) {
    const c = this.healthChecks.get(id);
    if (!c) throw new Error("this request does not exist");
    return { ...c, label: HEALTH_FACTS[c.fact].label, question: HEALTH_FACTS[c.fact].question };
  }

  /** The person shares that one fact; the school verifies it (clinic signature, digest, phone signature). */
  async shareHealth(person: Person, id: string): Promise<HealthCheckResult> {
    const c = this.healthChecks.get(id);
    if (!c || c.result) throw new Error("this request was already answered");
    if (!person.health || !this.clinic) throw new Error("add a health record first");
    const p = await presentHealthFact(person.health, c.fact, person.holder.wallet, c);
    c.result = await verifyHealthFact(p, { clinicJwk: this.clinic.jwk, fact: c.fact, audience: c.audience, nonce: c.nonce, now: this.now() });
    this.changed();
    return c.result;
  }

  /** Turns on (simulated) Face ID / fingerprint for a Pass. */
  enableUnlock(person: Person): void {
    person.unlock = true;
    this.changed();
  }

  createSession(merchantId: MerchantId, policy: PolicyId, reference?: string, opts: { requireUnlock?: boolean } = {}): MerchantView {
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
      requireUnlock: !!opts.requireUnlock,
      userVerified: null,
      passTag: null,
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
  async submit(id: string, sub: Omit<PresentationSubmissionT, "challengeId">, opts: { userVerified?: boolean } = {}): Promise<Outcome> {
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
    const userVerified = result.verified && !!opts.userVerified;
    const verified = result.verified && (!s.requireUnlock || userVerified);
    const code = verified ? null : result.verified ? "USER_NOT_VERIFIED" : (failureCode(core.checks) ?? "FAILED");
    const match = verified ? matchCode(id, sub.proof.signature) : null;
    s.userVerified = userVerified;
    s.passTag = /^0x[0-9a-fA-F]{64}$/.test(sub.proof.commitment) ? sha256Hex(`${this.tagSecret}|${s.merchantId}|${sub.proof.commitment.toLowerCase()}|${new Date(now * 1000).toISOString().slice(0, 10)}`).slice(0, 16) : null;
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
      userVerified,
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
    return ["id", "merchant_id", "policy", "reference", "nonce", "audience", "chain_id", "registry", "created_at", "expires_at", "status", "failure_code", "completed_at", "match_code", "issuer_name", "receipt_seq", "require_uv", "user_verified", "pass_tag"];
  }

  /** The chain check (signatures and links) plus the comparison with the on-chain checkpoints. */
  async receiptChain(merchantId: MerchantId): Promise<ChainCheck & { anchor: AnchorCheck }> {
    const rows = this.receipts[merchantId];
    const chain = await checkReceiptChain(rows, this.jwks, merchantId);
    return { ...chain, anchor: checkAgainstAnchors(rows, await this.checkpoints(merchantId)) };
  }

  /** Every on-chain checkpoint of a business's receipts, read from the contract's events. */
  async checkpoints(merchantId: MerchantId): Promise<Checkpoint[]> {
    const logs = await this.anchor.queryFilter(this.anchor.filters.Anchored!(streamId(receiptStream(merchantId))), 0);
    return logs.map((l) => {
      const args = (l as unknown as { args: { count: bigint; head: string } }).args;
      return { count: Number(args.count), head: args.head.slice(2), block: l.blockNumber, tx: l.transactionHash };
    });
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
   * Three attacks on a business's stored receipts, for the integrity demo. undoTamper() restores.
   *
   *   insider   edits one receipt without decID's key: the signature no longer verifies.
   *   operator  holds decID's key: re-signs an edited receipt and re-chains everything after it.
   *             Every signature and link verifies again; only the on-chain checkpoints disagree.
   *   truncate  deletes the newest receipt: a shorter chain is still a valid chain; only the
   *             anchored count gives it away.
   */
  async tamper(merchantId: MerchantId, kind: TamperKind = "insider"): Promise<void> {
    const rows = this.receipts[merchantId];
    if (!rows.length || this.tampered) return;
    const backup = rows.map((r) => ({ ...r }));
    const i = kind === "truncate" ? rows.length - 1 : Math.floor((rows.length - 1) / 2);
    const target = rows[i]!;
    if (kind === "truncate") {
      rows.pop();
    } else {
      const payload = decodePayload(target.jws);
      payload.outcome = payload.outcome === "satisfied" ? "not_satisfied" : "satisfied";
      payload.failureCode = payload.outcome === "satisfied" ? null : "POLICY_NOT_SATISFIED";
      if (kind === "insider") {
        // A careful insider also recomputes the stored hash; only decID's signature gives it away.
        const [h, , sig] = target.jws.split(".") as [string, string, string];
        const jws = `${h}.${encodePayload(payload)}.${sig}`;
        rows[i] = { ...target, jws, hash: sha256Hex(jws) };
      } else {
        // The operator re-signs this receipt and every later one, re-linking the chain.
        let prev = i === 0 ? GENESIS : rows[i - 1]!.hash;
        for (let j = i; j < rows.length; j++) {
          const p = j === i ? payload : decodePayload(rows[j]!.jws);
          p.prev = prev;
          const jws = await signReceipt(p, this.receiptKey, this.receiptKid);
          rows[j] = { ...rows[j]!, jws, hash: sha256Hex(jws), prev_hash: prev };
          prev = rows[j]!.hash;
        }
      }
    }
    this.tampered = { merchantId, kind, seq: target.seq, backup };
    this.changed();
  }

  undoTamper(): void {
    if (!this.tampered) return;
    this.receipts[this.tampered.merchantId] = this.tampered.backup;
    this.tampered = null;
    this.changed();
  }

  // ---------------------------------------------------------------- a busy night at the door

  /**
   * Runs a queue of synthetic guests through the Neon Hall door with the real flow: each guest
   * is verified once (real issuance and on-chain activation), the door creates a session and the
   * guest's Pass answers it. Then trouble: a guest's Pass is handed back through the queue, someone
   * tries three edited Passes, a guest shows a friend's credential from their own phone, and one
   * shows a Pass the issuer has revoked. The fraud signals (Risk page) pick these up.
   */
  async simulateNight(guests: number, onProgress?: (done: number, total: number, line: string) => void): Promise<void> {
    const total = guests + 6;
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
    // Pass-back: the first admitted guest's phone comes back through the queue.
    const first = queue[0]!;
    const sBack = this.createSession("neonhall", "age_over_21", "night-again");
    const oBack = await this.submit(sBack.id, await this.world.present(first, this.walletRequest(sBack.id).challenge));
    step(`Same Pass again: ${oBack.status === "verified" ? "admitted · flagged as pass-back" : "refused"}`);
    // Someone tries Passes with an edited credential (the issuer's signature no longer matches).
    for (let i = 1; i <= 3; i++) {
      const sf = this.createSession("neonhall", "age_over_21", `night-fake-${i}`);
      // The forger edits the credential and signs the presentation over the edited copy with their own key.
      const [h, p, sig] = first.bundle!.credentialJwt.split(".");
      const forger = this.world.newHolder(`Forger ${i}`);
      const edited = { ...first.bundle!, credentialJwt: `${h}.${p}.${sig!.slice(0, -4)}${sig!.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}` };
      forger.bundle = edited;
      const of = await this.submit(sf.id, await this.world.present(forger, this.walletRequest(sf.id).challenge));
      step(`Fake Pass ${i}: ${of.status === "verified" ? "admitted" : `refused · ${friendlyReason(of.failureCode).toLowerCase()}`}`);
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
      userVerified: s.userVerified,
      risk: status === "verified" || status === "rejected" ? riskForCheck(this.records(s.merchantId), s.id, MERCHANTS[s.merchantId].kind) : [],
    };
  }

  // ---------------------------------------------------------------- fraud signals and the assistant

  /** The business's checks in the shape the fraud engine and the assistant read (as on the server). */
  records(merchantId: MerchantId): CheckRecord[] {
    return [...this.sessions.values()]
      .filter((s) => s.merchantId === merchantId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => ({ id: s.id, createdAt: s.createdAt, completedAt: s.completedAt, status: this.effectiveStatus(s), policy: s.policy, reference: s.reference, failureCode: s.failureCode, receiptSeq: s.receiptSeq, passTag: s.passTag, userVerified: s.userVerified }));
  }

  risk(merchantId: MerchantId): { alerts: RiskAlert[]; checksAnalysed: number } {
    const records = this.records(merchantId);
    return { alerts: detectRisk(records, MERCHANTS[merchantId].kind, this.now()), checksAnalysed: records.length };
  }

  /** The compliance assistant (src/lib/shared/assistant.ts), over this business's in-page records. */
  async ask(merchantId: MerchantId, question: string): Promise<AssistantAnswer> {
    const records = this.records(merchantId);
    return answerQuestion(question, {
      merchant: MERCHANTS[merchantId],
      records,
      chain: await this.receiptChain(merchantId),
      alerts: detectRisk(records, MERCHANTS[merchantId].kind, this.now()),
      storedFields: this.storedFields(),
      now: this.now(),
    });
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
    // Checkpoint the new head on-chain (the server does this in the background; here blocks are instant).
    const a = this.anchor.connect(this.anchorer) as Contract;
    await (await a.getFunction("anchor")(streamId(receiptStream(merchantId)), receipt.seq, `0x${sha256Hex(jws)}`)).wait();
    return receipt.seq;
  }
}
