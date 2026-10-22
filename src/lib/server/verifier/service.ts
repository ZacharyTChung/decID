import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { hexlify } from "ethers";
import type { VerifierAction } from "../../shared/constants";
import { sameAddress } from "../../shared/did-pkh";
import { presentationStatement } from "../../shared/eip712";
import type { VerificationResult } from "../../shared/verification";
import type { ChallengeResponse, PresentationSubmissionT } from "../../shared/api";
import { appConfig } from "../config";
import { loadDeployment } from "../chain";
import { db, nowSeconds } from "../db";
import { ApiError } from "../http";
import { loadTrustedIssuers } from "../trust";
import { failureCode, finalize, verifyPresentationCore } from "./core";

/**
 * Verifier service. It needs only public inputs: the trusted issuer policy
 * (public keys and addresses), the deployment record, and chain RPC access.
 * It never loads issuer private keys, and it never stores the presented token
 * or salt. Only the challenge row and an outcome code are kept.
 */

export const CHALLENGE_TTL = 120; // seconds

export function createChallenge(action: VerifierAction): ChallengeResponse {
  const cfg = appConfig();
  const deployment = loadDeployment();
  const id = randomUUID();
  const nonce = hexlify(randomBytes(32));
  const now = nowSeconds();
  const expiresAt = now + CHALLENGE_TTL;
  db()
    .prepare(
      `INSERT INTO verifier_challenges (id, nonce, action, audience, chain_id, registry, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, nonce, action, cfg.origin, deployment.chainId, deployment.registry, now, expiresAt);
  return {
    challengeId: id,
    nonce,
    action,
    audience: cfg.origin,
    chainId: deployment.chainId,
    registry: deployment.registry,
    expiresAt,
    statement: presentationStatement(cfg.origin, action),
  };
}

interface ChallengeRow {
  id: string;
  nonce: string;
  action: string;
  audience: string;
  chain_id: number;
  registry: string;
  expires_at: number;
  consumed_at: number | null;
}

/**
 * Consumes the challenge atomically: the conditional UPDATE succeeds for exactly
 * one caller, so concurrent submissions of the same challenge cannot both proceed.
 */
function consumeChallenge(id: string, now: number): ChallengeRow {
  const row = db()
    .prepare(
      `UPDATE verifier_challenges SET consumed_at = ?
       WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
       RETURNING id, nonce, action, audience, chain_id, registry, expires_at, consumed_at`,
    )
    .get(now, id, now) as ChallengeRow | undefined;
  if (row) return row;
  const existing = db().prepare("SELECT consumed_at, expires_at FROM verifier_challenges WHERE id = ?").get(id) as
    | { consumed_at: number | null; expires_at: number }
    | undefined;
  if (!existing) throw new ApiError(400, "CHALLENGE_UNKNOWN", "unknown challenge");
  if (existing.consumed_at !== null) throw new ApiError(409, "CHALLENGE_REUSED", "challenge was already used");
  throw new ApiError(400, "CHALLENGE_EXPIRED", "challenge expired");
}

export async function verifyPresentation(sub: PresentationSubmissionT): Promise<VerificationResult> {
  const now = nowSeconds();
  const cfg = appConfig();
  // Load configuration before consuming the challenge, so a misconfigured verifier does not burn it.
  const deployment = loadDeployment();
  const issuers = loadTrustedIssuers();
  const recordOutcome = (outcome: string) =>
    db().prepare("UPDATE verifier_challenges SET outcome = ? WHERE id = ?").run(outcome, sub.challengeId);

  // 1. Challenge: server-issued, unexpired, single-use, for this verifier and deployment.
  let challenge: ChallengeRow;
  try {
    challenge = consumeChallenge(sub.challengeId, now);
  } catch (e) {
    const err = e as ApiError;
    return finalize([{ id: "challenge", status: "fail", code: err.code, detail: err.message }]);
  }
  if (challenge.audience !== cfg.origin || challenge.chain_id !== deployment.chainId || !sameAddress(challenge.registry, deployment.registry)) {
    recordOutcome("CHALLENGE_CONTEXT_CHANGED");
    return finalize([{ id: "challenge", status: "fail", code: "CHALLENGE_CONTEXT_CHANGED", detail: "verifier configuration changed since the challenge was issued" }]);
  }

  // 2-10. Everything else is the shared, stateless core.
  const core = await verifyPresentationCore(
    {
      nonce: challenge.nonce,
      action: challenge.action,
      audience: challenge.audience,
      chainId: challenge.chain_id,
      registry: challenge.registry,
      expiresAt: challenge.expires_at,
    },
    sub,
    { deployment, issuers, now },
  );
  const result = finalize([{ id: "challenge", status: "pass" }, ...core.checks], { registryStatus: core.registryStatus, disclosed: core.disclosed });
  recordOutcome(result.verified ? "verified" : (failureCode(core.checks) ?? "FAILED"));
  return result;
}

export interface VerificationLogEntry {
  ref: string; // first 8 characters of the challenge id
  action: string;
  createdAt: number;
  status: "verified" | "rejected" | "unused" | "expired";
  code: string | null; // stable failure code for rejected attempts
}

/**
 * The verifier's recent activity, from challenge rows only. They hold no holder address,
 * credential, salt or proof, so this log cannot reveal who presented what.
 */
export function recentVerifications(limit = 20): VerificationLogEntry[] {
  const now = nowSeconds();
  const rows = db()
    .prepare("SELECT id, action, created_at, expires_at, consumed_at, outcome FROM verifier_challenges ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(limit) as { id: string; action: string; created_at: number; expires_at: number; consumed_at: number | null; outcome: string | null }[];
  return rows.map((r) => ({
    ref: r.id.slice(0, 8),
    action: r.action,
    createdAt: r.created_at,
    status: r.outcome === "verified" ? "verified" : r.outcome || r.consumed_at !== null ? "rejected" : r.expires_at <= now ? "expired" : "unused",
    code: r.outcome && r.outcome !== "verified" ? r.outcome : null,
  }));
}
