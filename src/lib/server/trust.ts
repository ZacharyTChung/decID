import "server-only";
import { getAddress } from "ethers";
import { z } from "zod";
import { CREDENTIAL_TYPE, SCHEMA_ID } from "../shared/constants";
import { appConfig, readJsonFile } from "./config";
import { ApiError } from "./http";
import { resolveDidKeyAssertionKey, type Ed25519PublicJwk } from "./did/did-key";
import { TrustFileSchema, validAt, type CredentialKeyT, type TrustedIssuerT } from "./trust-schema";

// The schema and lifecycle rules live in trust-schema.ts (no server-only import) so that the
// setup/rotation scripts can share them; they are re-exported here for the app.
export * from "./trust-schema";

export function loadTrustedIssuers(file = appConfig().trustedIssuersFile): TrustedIssuerT[] {
  let raw: unknown;
  try {
    raw = readJsonFile(file, "trusted issuer configuration");
  } catch {
    throw new ApiError(503, "TRUST_POLICY_MISSING", "trusted issuer policy not found: run `npm run setup`");
  }
  const parsed = TrustFileSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(503, "TRUST_POLICY_INVALID", "trusted issuer policy is invalid or outdated: re-run `npm run setup`");
  return parsed.data.issuers.map((i) => ({
    ...i,
    evmAttestationSigners: i.evmAttestationSigners.map((s) => ({ ...s, address: getAddress(s.address) })),
  }));
}

export interface TrustedKey {
  issuer: TrustedIssuerT;
  key: CredentialKeyT;
  publicKeyJwk: Ed25519PublicJwk;
}

export type TrustFailure =
  | "ISSUER_NOT_TRUSTED"
  | "KID_MISMATCH"
  | "KEY_RESOLUTION_FAILED"
  | "KEY_MISMATCH"
  | "KEY_COMPROMISED"
  | "TYPE_NOT_AUTHORIZED";

/**
 * Finds the issuer and key for a signing DID and confirms that did:key resolution
 * (via the maintained library) yields exactly the pinned key and key id.
 * The issuance-time window is checked by the caller after signature verification.
 */
export async function trustedKeyFor(
  issuers: TrustedIssuerT[],
  issuerDid: string,
  headerKid: string,
): Promise<{ ok: true; value: TrustedKey } | { ok: false; reason: TrustFailure }> {
  let issuer: TrustedIssuerT | undefined;
  let key: CredentialKeyT | undefined;
  for (const i of issuers) {
    key = i.credentialKeys.find((k) => k.did === issuerDid);
    if (key) {
      issuer = i;
      break;
    }
  }
  if (!issuer || !key) return { ok: false, reason: "ISSUER_NOT_TRUSTED" };
  if (!issuer.credentialTypes.includes(CREDENTIAL_TYPE) || !issuer.schemaIds.includes(SCHEMA_ID)) {
    return { ok: false, reason: "TYPE_NOT_AUTHORIZED" };
  }
  if (key.status === "compromised") return { ok: false, reason: "KEY_COMPROMISED" };
  if (headerKid !== key.kid) return { ok: false, reason: "KID_MISMATCH" };
  let resolved;
  try {
    resolved = await resolveDidKeyAssertionKey(issuerDid);
  } catch {
    return { ok: false, reason: "KEY_RESOLUTION_FAILED" };
  }
  if (resolved.kid !== key.kid || resolved.publicKeyJwk.x !== key.publicKeyJwk.x) {
    return { ok: false, reason: "KEY_MISMATCH" };
  }
  return { ok: true, value: { issuer, key, publicKeyJwk: resolved.publicKeyJwk } };
}
