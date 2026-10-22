import "server-only";
import { getAddress } from "ethers";
import { z } from "zod";
import { CREDENTIAL_TYPE, SCHEMA_ID } from "../shared/constants";
import { appConfig, readJsonFile } from "./config";
import { ApiError } from "./http";
import { resolveDidKeyAssertionKey, type Ed25519PublicJwk } from "./did/did-key";

/**
 * Explicit trust policy for credential issuers.
 *
 * Each entry binds, out of band, three things that are otherwise unrelated:
 *   - the issuer DID (did:key) that appears in credentials,
 *   - the exact credential verification key (kid + public JWK),
 *   - the EVM address that signs on-chain registration authorizations.
 *
 * A credential is only accepted if its issuer DID is listed here. The key used
 * to verify it comes from this file cross-checked against did:key resolution,
 * never from the token or the presenter. Self-issued DIDs are therefore
 * rejected unless an operator adds them to this file.
 */
const TrustedIssuer = z.strictObject({
  name: z.string().min(1),
  did: z.string().startsWith("did:key:"),
  kid: z.string(),
  publicKeyJwk: z.strictObject({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string() }),
  evmAttestationSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  credentialTypes: z.array(z.string()).min(1),
  schemaIds: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).min(1),
});
const TrustFile = z.strictObject({ version: z.literal(1), issuers: z.array(TrustedIssuer) });

export type TrustedIssuerT = z.infer<typeof TrustedIssuer>;

export function loadTrustedIssuers(file = appConfig().trustedIssuersFile): TrustedIssuerT[] {
  let raw: unknown;
  try {
    raw = readJsonFile(file, "trusted issuer configuration");
  } catch {
    throw new ApiError(503, "TRUST_POLICY_MISSING", "trusted issuer policy not found: run `npm run setup`");
  }
  const parsed = TrustFile.safeParse(raw);
  if (!parsed.success) throw new ApiError(503, "TRUST_POLICY_INVALID", "trusted issuer policy is invalid: re-run `npm run setup`");
  return parsed.data.issuers.map((i) => ({
    ...i,
    evmAttestationSigner: getAddress(i.evmAttestationSigner),
  }));
}

export interface TrustedKey {
  issuer: TrustedIssuerT;
  publicKeyJwk: Ed25519PublicJwk;
}

export type TrustFailure =
  | "ISSUER_NOT_TRUSTED"
  | "KID_MISMATCH"
  | "KEY_RESOLUTION_FAILED"
  | "KEY_MISMATCH"
  | "TYPE_NOT_AUTHORIZED";

/**
 * Looks up the issuer in the trust file and confirms that did:key resolution
 * (via the maintained library) yields exactly the pinned key and key id.
 */
export async function trustedKeyFor(
  issuers: TrustedIssuerT[],
  issuerDid: string,
  headerKid: string,
): Promise<{ ok: true; value: TrustedKey } | { ok: false; reason: TrustFailure }> {
  const issuer = issuers.find((i) => i.did === issuerDid);
  if (!issuer) return { ok: false, reason: "ISSUER_NOT_TRUSTED" };
  if (!issuer.credentialTypes.includes(CREDENTIAL_TYPE) || !issuer.schemaIds.includes(SCHEMA_ID)) {
    return { ok: false, reason: "TYPE_NOT_AUTHORIZED" };
  }
  if (headerKid !== issuer.kid) return { ok: false, reason: "KID_MISMATCH" };
  let resolved;
  try {
    resolved = await resolveDidKeyAssertionKey(issuerDid);
  } catch {
    return { ok: false, reason: "KEY_RESOLUTION_FAILED" };
  }
  if (resolved.kid !== issuer.kid || resolved.publicKeyJwk.x !== issuer.publicKeyJwk.x) {
    return { ok: false, reason: "KEY_MISMATCH" };
  }
  return { ok: true, value: { issuer, publicKeyJwk: resolved.publicKeyJwk } };
}
