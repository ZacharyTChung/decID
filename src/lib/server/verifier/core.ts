import "server-only";
import { TypedDataEncoder, verifyTypedData } from "ethers";
import { CREDENTIAL_TYPE, SCHEMA_ID } from "../../shared/constants";
import { commitmentFor } from "../../shared/commitment";
import { fromUtcSeconds } from "../../shared/credential-profile";
import { sameAddress } from "../../shared/did-pkh";
import { PRESENTATION_TYPES, presentationDomain, presentationStatement } from "../../shared/eip712";
import { CHECK_IDS, type CheckResult, type DisclosedClaims, type VerificationResult } from "../../shared/verification";
import { isValidContractSignature } from "../auth/contract-signature";
import { readRecord, type Deployment } from "../chain";
import { verifyCredentialJwt } from "../credential/verify";
import { trustedEvmSigner, type TrustedIssuerT } from "../trust";

/**
 * Presentation verification with no server state: everything after the challenge check.
 * Inputs are public only (trust policy, deployment record, chain RPC) plus what the holder
 * presents. It is shared by the verifier API (which adds single-use challenge bookkeeping)
 * and the standalone CLI (scripts/verify.ts), so both apply exactly the same checks.
 */

/** The verifier's challenge as the holder signed it. */
export interface PresentationContext {
  nonce: string;
  action: string;
  audience: string;
  chainId: number;
  registry: string;
  expiresAt: number;
}

export interface Presented {
  credentialJwt: string;
  salt: string;
  proof: { holder: string; commitment: string; expiresAt: number; signature: string };
}

export interface CoreDeps {
  deployment: Deployment;
  issuers: TrustedIssuerT[];
  now: number;
}

export interface CoreResult {
  checks: CheckResult[];
  registryStatus?: string;
  disclosed?: DisclosedClaims;
}

/** Orders checks, marks unreached ones as skipped, and decides `verified`. */
export function finalize(checks: CheckResult[], extra: Partial<VerificationResult> = {}): VerificationResult {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const ordered = CHECK_IDS.map((id) => byId.get(id) ?? { id, status: "skipped" as const });
  const verified = ordered.every((c) => c.status === "pass");
  return { verified, checks: ordered, verifiedAt: new Date().toISOString(), ...extra, ...(verified ? {} : { disclosed: undefined }) };
}

/** The stable code of the first failed check, if any. */
export function failureCode(checks: CheckResult[]): string | undefined {
  return checks.find((c) => c.status === "fail")?.code;
}

export async function verifyPresentationCore(ctx: PresentationContext, sub: Presented, deps: CoreDeps): Promise<CoreResult> {
  const { deployment, issuers, now } = deps;
  const checks: CheckResult[] = [];
  const fail = (c: CheckResult, registryStatus?: string): CoreResult => {
    checks.push(c);
    return { checks, registryStatus };
  };

  // 2. Wallet control: EIP-712 proof binding nonce, audience, action, holder, commitment, expiry, chain and registry.
  const { proof } = sub;
  if (proof.expiresAt > ctx.expiresAt || proof.expiresAt <= now) {
    return fail({ id: "walletControl", status: "fail", code: "PROOF_EXPIRY_INVALID", detail: "proof expiry must be in the future and no later than the challenge expiry" });
  }
  const domain = presentationDomain(ctx.chainId, ctx.registry);
  const proofMessage = {
    statement: presentationStatement(ctx.audience, ctx.action),
    audience: ctx.audience,
    action: ctx.action,
    challenge: ctx.nonce,
    holder: proof.holder,
    commitment: proof.commitment,
    expiresAt: proof.expiresAt,
  };
  // EOA: the signature must recover to the holder. Contract account (EIP-1271): the holder
  // contract must accept the signature for the EIP-712 digest of exactly this message.
  let recovered: string | undefined;
  try {
    recovered = verifyTypedData(domain, PRESENTATION_TYPES, proofMessage, proof.signature);
  } catch {
    recovered = undefined; // not a plain ECDSA signature; may still be a contract-wallet signature
  }
  if (recovered && sameAddress(recovered, proof.holder)) {
    checks.push({ id: "walletControl", status: "pass" });
  } else if (await isValidContractSignature(proof.holder, TypedDataEncoder.hash(domain, PRESENTATION_TYPES, proofMessage), proof.signature)) {
    checks.push({ id: "walletControl", status: "pass", detail: "EIP-1271 contract wallet" });
  } else if (!recovered) {
    return fail({ id: "walletControl", status: "fail", code: "PROOF_SIGNATURE_INVALID", detail: "presentation proof signature is malformed or not accepted by the holder contract" });
  } else {
    return fail({ id: "walletControl", status: "fail", code: "PROOF_SIGNER_MISMATCH", detail: "proof was not signed by the claimed holder wallet for this challenge" });
  }

  // 3-7. Credential: format, trust, signature, semantics, validity, deployment binding.
  const cred = await verifyCredentialJwt(sub.credentialJwt, {
    issuers,
    now,
    expectedChainId: deployment.chainId,
    expectedRegistry: deployment.registry,
  });
  checks.push(...cred.checks);
  if (!cred.ok || !cred.credential || !cred.issuer || !cred.subject) return { checks };
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
    const rec = await readRecord(recomputed, deployment, { holder: proof.holder, schemaId: SCHEMA_ID });
    registryStatus = rec.exists ? rec.status : "NotRegistered";
    const problems: string[] = [];
    if (!rec.exists) problems.push("no registry record for this commitment");
    else {
      if (!sameAddress(rec.holder, proof.holder)) problems.push("registered holder differs");
      if (!trustedEvmSigner(cred.issuer, rec.issuer, fromUtcSeconds(vc.validFrom))) {
        problems.push("registered issuer is not a trusted attestation signer of this issuer (or was not active at issuance)");
      }
      if (rec.schemaId.toLowerCase() !== SCHEMA_ID.toLowerCase()) problems.push("registered schema differs");
      if (rec.validFrom !== fromUtcSeconds(vc.validFrom) || rec.expiresAt !== fromUtcSeconds(vc.validUntil)) problems.push("registered validity window differs from credential");
      if (rec.status !== "Active") problems.push(`registry status is ${rec.status}`);
      if (rec.validFor !== true && rec.status === "Active") problems.push("registry isCredentialValid returned false");
    }
    if (problems.length) {
      const code = !rec.exists ? "NOT_REGISTERED" : rec.status === "Revoked" ? "REVOKED" : rec.status !== "Active" ? `REGISTRY_${rec.status.toUpperCase()}` : "REGISTRY_MISMATCH";
      return fail({ id: "registry", status: "fail", code, detail: problems.join("; ") }, registryStatus);
    }
  } catch {
    return fail({ id: "registry", status: "fail", code: "RPC_UNAVAILABLE", detail: "could not read the registry; is the local chain running?" });
  }
  checks.push({ id: "registry", status: "pass" });

  return {
    checks,
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
  };
}

