import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hexlify } from "ethers";
import { ACTION_POLICIES } from "../../shared/constants";
import { presentationStatement } from "../../shared/eip712";
import { POLICIES, type PolicyId } from "../../shared/policies";
import { compactPresentation } from "../../shared/sd-jwt";
import type { ChallengeResponse, PresentationSubmissionT } from "../../shared/api";
import { appConfig } from "../config";
import { loadDeployment } from "../chain";
import { db, nowSeconds } from "../db";
import { ApiError } from "../errors";
import { loadTrustedIssuers } from "../trust";
import { failureCode, finalize, verifyPresentationCore } from "../verifier/core";
import { appendReceipt } from "./receipts";
import { getMerchant, type Merchant } from "./merchants";

/**
 * Verification sessions: a business asks one question (a policy), the holder answers it from
 * their wallet, and the business learns the answer and nothing else.
 *
 *   business ──POST /api/v1/verifications──▶ session (challenge bound to this business)
 *   holder's wallet ──GET …/request──▶ who is asking, what, the challenge
 *   holder's wallet ──POST …/presentation──▶ production verifier core ──▶ outcome + receipt
 *   business ──GET /api/v1/verifications/:id──▶ { ageOver21: true }, match code, receipt
 *
 * The session row never holds the holder's address, DID, credential, disclosures or salt: the
 * presentation is verified in memory and dropped. The challenge's audience names the business
 * (urn:decid:merchant:<id>), so a holder's consent for one business is useless at another.
 */

export const SESSION_TTL = 300; // seconds: long enough to scan a QR code and approve
const MATCH_ALPHABET = "ACDEFHJKMNPRTUVWXY3479"; // no look-alikes (0/O, 1/I/L, 2/Z, 5/S, 8/B)

interface Row {
  id: string;
  merchant_id: string;
  policy: PolicyId;
  reference: string | null;
  nonce: string;
  audience: string;
  chain_id: number;
  registry: string;
  created_at: number;
  expires_at: number;
  status: "pending" | "processing" | "verified" | "rejected";
  failure_code: string | null;
  completed_at: number | null;
  match_code: string | null;
  issuer_name: string | null;
  receipt_seq: number | null;
}

const audienceFor = (merchantId: string) => `urn:decid:merchant:${merchantId}`;

function load(id: string): Row | undefined {
  return db().prepare("SELECT * FROM verify_sessions WHERE id = ?").get(id) as Row | undefined;
}

/** Status as seen from outside: a pending session past its expiry is reported as expired. */
function effectiveStatus(r: Row, now = nowSeconds()): "pending" | "processing" | "verified" | "rejected" | "expired" {
  return r.status === "pending" && r.expires_at <= now ? "expired" : r.status;
}

export function createSession(merchant: Merchant, policy: PolicyId, reference?: string) {
  const deployment = loadDeployment();
  const id = randomUUID();
  const now = nowSeconds();
  db()
    .prepare(
      `INSERT INTO verify_sessions (id, merchant_id, policy, reference, nonce, audience, chain_id, registry, created_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(id, merchant.id, policy, reference ?? null, hexlify(randomBytes(32)), audienceFor(merchant.id), deployment.chainId, deployment.registry, now, now + SESSION_TTL);
  return merchantView(merchant, load(id)!, null);
}

function receiptJws(merchantId: string, seq: number | null): string | null {
  if (seq === null) return null;
  return (db().prepare("SELECT jws FROM verify_receipts WHERE merchant_id = ? AND seq = ?").get(merchantId, seq) as { jws: string } | undefined)?.jws ?? null;
}

/** What the business sees. */
export function merchantView(merchant: Merchant, r: Row, receipt: string | null | undefined = receiptJws(merchant.id, r.receipt_seq)) {
  const p = POLICIES[r.policy];
  const status = effectiveStatus(r);
  return {
    id: r.id,
    policy: r.policy,
    reference: r.reference,
    status,
    walletUrl: `${appConfig().origin}/pass/r/${r.id}`,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    completedAt: r.completed_at,
    // "false" only when the holder genuinely does not meet the policy; a forged or broken
    // presentation is not an answer, and is reported only through failureCode.
    result: status === "verified" ? { [p.resultKey]: true } : r.failure_code === "POLICY_NOT_SATISFIED" ? { [p.resultKey]: false } : null,
    failureCode: r.failure_code,
    matchCode: r.match_code,
    issuer: r.issuer_name ? { name: r.issuer_name } : null,
    receipt: receipt ?? null,
  };
}

export function getSessionForMerchant(merchant: Merchant, id: string) {
  const r = load(id);
  // Another business's session is reported exactly like a missing one.
  if (!r || r.merchant_id !== merchant.id) throw new ApiError(404, "UNKNOWN_SESSION", "no such verification");
  return merchantView(merchant, r);
}

export function listSessions(merchant: Merchant, limit = 50) {
  const rows = db().prepare("SELECT * FROM verify_sessions WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?").all(merchant.id, limit) as Row[];
  return rows.map((r) => merchantView(merchant, r));
}

/** What the holder's wallet sees before deciding: who asks, what, and the challenge to sign. */
export function walletRequest(id: string) {
  const r = load(id);
  if (!r) throw new ApiError(404, "UNKNOWN_SESSION", "this request does not exist (it may be from an earlier demo run)");
  const merchant = getMerchant(r.merchant_id)!;
  const p = POLICIES[r.policy];
  const action = ACTION_POLICIES[p.action];
  const challenge: ChallengeResponse = {
    challengeId: r.id,
    nonce: r.nonce,
    action: p.action,
    audience: r.audience,
    chainId: r.chain_id,
    registry: r.registry,
    expiresAt: r.expires_at,
    requestedClaims: [...action.requested],
    statement: presentationStatement(r.audience, p.action, action.requested),
  };
  return {
    id: r.id,
    merchant: { name: merchant.name, kind: merchant.kind },
    policy: { id: p.id, question: p.question, short: p.short },
    status: effectiveStatus(r),
    expiresAt: r.expires_at,
    challenge,
  };
}

function matchCode(id: string, signature: string): string {
  const h = createHash("sha256").update(`${id}|${signature}`).digest();
  return Array.from(h.subarray(0, 4), (b) => MATCH_ALPHABET[b % MATCH_ALPHABET.length]).join("");
}

/** The holder answers. Single use: the first submission consumes the session. */
export async function submitPresentation(id: string, sub: Omit<PresentationSubmissionT, "challengeId">) {
  const now = nowSeconds();
  const deployment = loadDeployment();
  const issuers = loadTrustedIssuers();
  const claimed = db()
    .prepare("UPDATE verify_sessions SET status = 'processing' WHERE id = ? AND status = 'pending' AND expires_at > ? RETURNING *")
    .get(id, now) as Row | undefined;
  if (!claimed) {
    const r = load(id);
    if (!r) throw new ApiError(404, "UNKNOWN_SESSION", "this request does not exist");
    if (effectiveStatus(r, now) === "expired") throw new ApiError(410, "SESSION_EXPIRED", "this request expired; ask for a new one");
    throw new ApiError(409, "SESSION_USED", "this request was already answered");
  }
  const merchant = getMerchant(claimed.merchant_id)!;
  const policy = POLICIES[claimed.policy];

  let core: Awaited<ReturnType<typeof verifyPresentationCore>>;
  try {
    core = await verifyPresentationCore(
      { nonce: claimed.nonce, action: policy.action, audience: claimed.audience, chainId: claimed.chain_id, registry: claimed.registry, expiresAt: claimed.expires_at },
      { ...sub, challengeId: id } as PresentationSubmissionT,
      { deployment, issuers, now },
    );
  } catch (e) {
    // Never leave a session stuck in 'processing'.
    db().prepare("UPDATE verify_sessions SET status = 'rejected', failure_code = 'INTERNAL', completed_at = ? WHERE id = ?").run(now, id);
    throw e;
  }
  const result = finalize([{ id: "challenge", status: "pass" }, ...core.checks], { registryStatus: core.registryStatus, disclosed: core.disclosed });
  const verified = result.verified;
  const code = verified ? null : (failureCode(core.checks) ?? "FAILED");
  const match = verified ? matchCode(id, sub.proof.signature) : null;

  const receipt = await appendReceipt(merchant.id, {
    sid: id,
    merchant: merchant.id,
    ref: claimed.reference,
    policy: policy.id,
    outcome: verified ? "satisfied" : "not_satisfied",
    failureCode: code,
    issuer: verified && core.disclosed ? { name: core.disclosed.issuerName, did: core.disclosed.issuerDid } : null,
    registry: { chainId: claimed.chain_id, address: claimed.registry, status: core.registryStatus ?? null },
    evidence: createHash("sha256").update(`${compactPresentation(sub.credentialJwt, sub.disclosures)}|${sub.proof.signature}`).digest("hex"),
    checkedAt: new Date(now * 1000).toISOString(),
  });
  db()
    .prepare("UPDATE verify_sessions SET status = ?, failure_code = ?, completed_at = ?, match_code = ?, issuer_name = ?, receipt_seq = ? WHERE id = ?")
    .run(verified ? "verified" : "rejected", code, now, match, verified ? (core.disclosed?.issuerName ?? null) : null, receipt.seq, id);

  return { status: verified ? ("verified" as const) : ("rejected" as const), failureCode: code, matchCode: match, merchant: { name: merchant.name }, policy: { id: policy.id, short: policy.short } };
}

/** Dashboard numbers for one business. Everything here comes from rows that hold no personal data. */
export function merchantStats(merchant: Merchant) {
  const now = nowSeconds();
  const rows = db().prepare("SELECT * FROM verify_sessions WHERE merchant_id = ?").all(merchant.id) as Row[];
  const done = rows.filter((r) => r.status === "verified" || r.status === "rejected");
  const failures: Record<string, number> = {};
  for (const r of done) if (r.failure_code) failures[r.failure_code] = (failures[r.failure_code] ?? 0) + 1;
  const times = done.map((r) => (r.completed_at ?? r.created_at) - r.created_at).sort((a, b) => a - b);
  return {
    total: rows.length,
    verified: done.filter((r) => r.status === "verified").length,
    rejected: done.filter((r) => r.status === "rejected").length,
    pending: rows.filter((r) => effectiveStatus(r, now) === "pending").length,
    expired: rows.filter((r) => effectiveStatus(r, now) === "expired").length,
    medianSecondsToAnswer: times.length ? times[Math.floor(times.length / 2)]! : null,
    failures,
  };
}

/** The columns a session row has: shown on the dashboard to make "no personal data" checkable. */
export function storedFields(): string[] {
  return (db().prepare("PRAGMA table_info(verify_sessions)").all() as { name: string }[]).map((c) => c.name);
}
