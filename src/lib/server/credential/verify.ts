import "server-only";
import { compactVerify, decodeProtectedHeader, importJWK } from "jose";
import { ALLOWED_JWS_ALGS, VC_JWT_CTY, VC_JWT_TYP } from "../../shared/constants";
import { credentialTokenBytes } from "../../shared/commitment";
import {
  IdentityVerifiedCredentialV1,
  fromUtcSeconds,
  jwtClaimMismatches,
  type IdentityVerifiedCredential,
} from "../../shared/credential-profile";
import { parseHolderDid, sameAddress, type PkhAccount } from "../../shared/did-pkh";
import type { CheckResult } from "../../shared/verification";
import { trustedKeyFor, type TrustedIssuerT } from "../trust";

/**
 * Verifies an application/vc+jwt credential.
 *
 * Decoding is not verification: the header is decoded before verification only
 * to read `alg`/`typ`/`cty`/`kid` for policy and key discovery, and the payload
 * is not parsed at all until the signature has been verified with a key taken
 * from the trusted issuer policy. Header-supplied keys (jwk, jku, x5u, x5c) are
 * refused outright.
 */

const FORBIDDEN_HEADERS = ["jwk", "jku", "x5u", "x5c", "x5t", "x5t#S256", "crit", "b64", "zip", "enc"];

export interface CredentialVerificationContext {
  issuers: TrustedIssuerT[];
  now: number; // unix seconds
  expectedChainId: number;
  expectedRegistry: string;
}

export interface CredentialVerification {
  ok: boolean;
  checks: CheckResult[];
  credential?: IdentityVerifiedCredential;
  issuer?: TrustedIssuerT;
  subject?: PkhAccount;
}

export async function verifyCredentialJwt(token: string, ctx: CredentialVerificationContext): Promise<CredentialVerification> {
  const checks: CheckResult[] = [];
  const fail = (id: CheckResult["id"], code: string, detail: string): CredentialVerification => {
    checks.push({ id, status: "fail", code, detail });
    return { ok: false, checks };
  };

  // 1. Format, size, header policy.
  let headerKid: string;
  try {
    credentialTokenBytes(token);
    const header = decodeProtectedHeader(token);
    if (!header.alg || header.alg === "none") return fail("tokenFormat", "UNSIGNED_TOKEN", "unsigned tokens are rejected");
    if (!(ALLOWED_JWS_ALGS as readonly string[]).includes(header.alg)) {
      return fail("tokenFormat", "ALG_NOT_ALLOWED", `algorithm ${header.alg} is not in the allowlist`);
    }
    if (header.typ !== VC_JWT_TYP) return fail("tokenFormat", "BAD_TYP", `typ must be ${VC_JWT_TYP}`);
    if (header.cty !== undefined && header.cty !== VC_JWT_CTY) return fail("tokenFormat", "BAD_CTY", `cty must be ${VC_JWT_CTY}`);
    for (const h of FORBIDDEN_HEADERS) {
      if (h in header) return fail("tokenFormat", "FORBIDDEN_HEADER", `header parameter ${h} is not accepted`);
    }
    if (typeof header.kid !== "string" || !header.kid.includes("#")) {
      return fail("tokenFormat", "MISSING_KID", "kid must be a DID URL");
    }
    headerKid = header.kid;
  } catch {
    return fail("tokenFormat", "MALFORMED_TOKEN", "not a well-formed JWS compact serialization");
  }
  checks.push({ id: "tokenFormat", status: "pass" });

  // 2. Issuer trust: key discovery from the kid's DID, pinned in the trust policy.
  const issuerDid = headerKid.slice(0, headerKid.indexOf("#"));
  const trusted = await trustedKeyFor(ctx.issuers, issuerDid, headerKid);
  if (!trusted.ok) return fail("issuerTrust", trusted.reason, "issuer is not trusted for this credential type, or key binding failed");
  checks.push({ id: "issuerTrust", status: "pass", detail: trusted.value.issuer.name });

  // 3. Signature, with the trusted key and the algorithm allowlist enforced again by jose.
  let payloadBytes: Uint8Array;
  try {
    const key = await importJWK(trusted.value.publicKeyJwk, "Ed25519");
    const result = await compactVerify(token, key, { algorithms: [...ALLOWED_JWS_ALGS] });
    payloadBytes = result.payload;
  } catch {
    return fail("tokenSignature", "BAD_SIGNATURE", "signature does not verify with the trusted issuer key");
  }
  checks.push({ id: "tokenSignature", status: "pass" });

  // 4. Semantics: profile schema, issuer agreement, JWT/VC claim agreement.
  let credential: IdentityVerifiedCredential;
  try {
    const parsed = IdentityVerifiedCredentialV1.safeParse(JSON.parse(new TextDecoder().decode(payloadBytes)));
    if (!parsed.success) return fail("credentialSemantics", "SCHEMA_INVALID", parsed.error.issues.map((i) => i.path.join(".") || i.message).join("; "));
    credential = parsed.data;
  } catch {
    return fail("credentialSemantics", "PAYLOAD_NOT_JSON", "payload is not JSON");
  }
  if (credential.issuer !== issuerDid) return fail("credentialSemantics", "ISSUER_KID_MISMATCH", "issuer does not match the signing key's DID");
  const mismatches = jwtClaimMismatches(credential);
  if (mismatches.length) return fail("credentialSemantics", "JWT_CLAIM_MISMATCH", mismatches.join("; "));
  checks.push({ id: "credentialSemantics", status: "pass" });

  // 5. Validity window: validFrom <= now < validUntil.
  const from = fromUtcSeconds(credential.validFrom);
  const until = fromUtcSeconds(credential.validUntil);
  if (until <= from) return fail("validityWindow", "BAD_VALIDITY_WINDOW", "validUntil is not after validFrom");
  if (ctx.now < from) return fail("validityWindow", "NOT_YET_VALID", `valid from ${credential.validFrom}`);
  if (ctx.now >= until) return fail("validityWindow", "EXPIRED", `expired at ${credential.validUntil}`);
  checks.push({ id: "validityWindow", status: "pass" });

  // 6. Intended deployment: chain id and registry address.
  if (
    credential.credentialStatus.chainId !== ctx.expectedChainId ||
    !sameAddress(credential.credentialStatus.registry, ctx.expectedRegistry)
  ) {
    return fail("deploymentBinding", "WRONG_DEPLOYMENT", "credential was issued for a different chain or registry");
  }
  let subject: PkhAccount;
  try {
    subject = parseHolderDid(credential.credentialSubject.id);
  } catch (e) {
    return fail("deploymentBinding", "BAD_SUBJECT_DID", (e as Error).message);
  }
  if (subject.chainId !== ctx.expectedChainId) {
    return fail("deploymentBinding", "SUBJECT_WRONG_CHAIN", "subject DID names a different chain");
  }
  checks.push({ id: "deploymentBinding", status: "pass" });

  return { ok: true, checks, credential, issuer: trusted.value.issuer, subject };
}
