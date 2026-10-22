import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { hexlify, verifyTypedData } from "ethers";
import { CREDENTIAL_TYPE, SCHEMA_ID, type VerifierAction } from "../../shared/constants";
import { commitmentFor } from "../../shared/commitment";
import { fromUtcSeconds } from "../../shared/credential-profile";
import { sameAddress } from "../../shared/did-pkh";
import { PRESENTATION_TYPES, presentationDomain, presentationStatement } from "../../shared/eip712";
import { CHECK_IDS, type CheckResult, type VerificationResult } from "../../shared/verification";
import type { ChallengeResponse, PresentationSubmissionT } from "../../shared/api";
import { appConfig } from "../config";
import { loadDeployment, readRecord, registryContract } from "../chain";
import { db, nowSeconds } from "../db";
import { ApiError } from "../http";
import { verifyCredentialJwt } from "../credential/verify";
import { loadTrustedIssuers } from "../trust";

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

function finalize(checks: CheckResult[], extra: Partial<VerificationResult> = {}): VerificationResult {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const ordered = CHECK_IDS.map((id) => byId.get(id) ?? { id, status: "skipped" as const });
  const verified = ordered.every((c) => c.status === "pass");
  return { verified, checks: ordered, verifiedAt: new Date().toISOString(), ...extra, ...(verified ? {} : { disclosed: undefined }) };
}

export async function verifyPresentation(sub: PresentationSubmissionT): Promise<VerificationResult> {
  const now = nowSeconds();
  const cfg = appConfig();
  const deployment = loadDeployment();
  const checks: CheckResult[] = [];
  const recordOutcome = (outcome: string) =>
    db().prepare("UPDATE verifier_challenges SET outcome = ? WHERE id = ?").run(outcome, sub.challengeId);
  const fail = (c: CheckResult, extra: Partial<VerificationResult> = {}) => {
    checks.push(c);
    recordOutcome(c.code ?? "FAILED");
    return finalize(checks, extra);
  };

  // 1. Challenge: server-issued, unexpired, single-use, for this verifier and deployment.
  let challenge: ChallengeRow;
  try {
    challenge = consumeChallenge(sub.challengeId, now);
  } catch (e) {
    const err = e as ApiError;
    return finalize([{ id: "challenge", status: "fail", code: err.code, detail: err.message }]);
  }
  if (challenge.audience !== cfg.origin || challenge.chain_id !== deployment.chainId || !sameAddress(challenge.registry, deployment.registry)) {
    return fail({ id: "challenge", status: "fail", code: "CHALLENGE_CONTEXT_CHANGED", detail: "verifier configuration changed since the challenge was issued" });
  }
  checks.push({ id: "challenge", status: "pass" });

  // 2. Wallet control: EIP-712 proof binding nonce, audience, action, holder, commitment, expiry, chain and registry.
  const { proof } = sub;
  if (proof.expiresAt > challenge.expires_at || proof.expiresAt <= now) {
    return fail({ id: "walletControl", status: "fail", code: "PROOF_EXPIRY_INVALID", detail: "proof expiry must be in the future and no later than the challenge expiry" });
  }
  let recovered: string;
  try {
    recovered = verifyTypedData(
      presentationDomain(challenge.chain_id, challenge.registry),
      PRESENTATION_TYPES,
      {
        statement: presentationStatement(challenge.audience, challenge.action),
        audience: challenge.audience,
        action: challenge.action,
        challenge: challenge.nonce,
        holder: proof.holder,
        commitment: proof.commitment,
        expiresAt: proof.expiresAt,
      },
      proof.signature,
    );
  } catch {
    return fail({ id: "walletControl", status: "fail", code: "PROOF_SIGNATURE_INVALID", detail: "presentation proof signature is malformed" });
  }
  if (!sameAddress(recovered, proof.holder)) {
    return fail({ id: "walletControl", status: "fail", code: "PROOF_SIGNER_MISMATCH", detail: "proof was not signed by the claimed holder wallet for this challenge" });
  }
  checks.push({ id: "walletControl", status: "pass" });

  // 3-7. Credential: format, trust, signature, semantics, validity, deployment binding.
  const cred = await verifyCredentialJwt(sub.credentialJwt, {
    issuers: loadTrustedIssuers(),
    now,
    expectedChainId: deployment.chainId,
    expectedRegistry: deployment.registry,
  });
  checks.push(...cred.checks);
  if (!cred.ok || !cred.credential || !cred.issuer || !cred.subject) {
    recordOutcome(cred.checks.at(-1)?.code ?? "CREDENTIAL_INVALID");
    return finalize(checks);
  }
  const vc = cred.credential;

  // 8. Holder binding: the credential subject is the wallet that signed the proof.
  if (!sameAddress(cred.subject.address, proof.holder)) {
    return fail({ id: "holderBinding", status: "fail", code: "SUBJECT_NOT_PRESENTER", detail: "credential subject is a different wallet than the presenter" });
  }
  checks.push({ id: "holderBinding", status: "pass" });

  // 9. Commitment: recomputed from the exact submitted token bytes and salt.
  let recomputed: string;
  try {
    recomputed = commitmentFor(sub.credentialJwt, sub.salt);
  } catch {
    return fail({ id: "commitment", status: "fail", code: "COMMITMENT_INPUT_INVALID", detail: "token or salt malformed" });
  }
  if (recomputed.toLowerCase() !== proof.commitment.toLowerCase()) {
    return fail({ id: "commitment", status: "fail", code: "COMMITMENT_MISMATCH", detail: "token bytes and salt do not produce the signed commitment" });
  }
  checks.push({ id: "commitment", status: "pass" });

  // 10. Live registry state, matched field-by-field against the verified credential.
  let registryStatus: string;
  try {
    const rec = await readRecord(recomputed, deployment);
    registryStatus = rec.exists ? rec.status : "NotRegistered";
    const problems: string[] = [];
    if (!rec.exists) problems.push("no registry record for this commitment");
    else {
      if (!sameAddress(rec.holder, proof.holder)) problems.push("registered holder differs");
      if (!sameAddress(rec.issuer, cred.issuer.evmAttestationSigner)) problems.push("registered issuer is not the trusted attestation signer for this issuer DID");
      if (rec.schemaId.toLowerCase() !== SCHEMA_ID.toLowerCase()) problems.push("registered schema differs");
      if (rec.validFrom !== fromUtcSeconds(vc.validFrom) || rec.expiresAt !== fromUtcSeconds(vc.validUntil)) problems.push("registered validity window differs from credential");
      if (rec.status !== "Active") problems.push(`registry status is ${rec.status}`);
      const valid = (await registryContract(deployment).getFunction("isCredentialValid")(recomputed, proof.holder, SCHEMA_ID)) as boolean;
      if (!valid && rec.status === "Active") problems.push("registry isCredentialValid returned false");
    }
    if (problems.length) {
      const code = !rec.exists ? "NOT_REGISTERED" : rec.status === "Revoked" ? "REVOKED" : rec.status !== "Active" ? `REGISTRY_${rec.status.toUpperCase()}` : "REGISTRY_MISMATCH";
      return fail({ id: "registry", status: "fail", code, detail: problems.join("; ") }, { registryStatus });
    }
  } catch {
    return fail({ id: "registry", status: "fail", code: "RPC_UNAVAILABLE", detail: "could not read the registry; is the local chain running?" });
  }
  checks.push({ id: "registry", status: "pass" });
  recordOutcome("verified");

  return finalize(checks, {
    registryStatus,
    disclosed: {
      holderDid: vc.credentialSubject.id,
      issuerDid: vc.issuer,
      issuerName: cred.issuer.name,
      identityVerified: true,
      validFrom: vc.validFrom,
      validUntil: vc.validUntil,
      credentialType: CREDENTIAL_TYPE,
    },
  });
}
