import "server-only";
import { getAddress, type Signer } from "ethers";
import { HOLDER_BUNDLE_VERSION, SCHEMA_ID } from "../../shared/constants";
import { commitmentFor, randomSalt } from "../../shared/commitment";
import { buildIdentityCredential } from "../../shared/credential-profile";
import { deriveHolderDid } from "../../shared/did-pkh";
import { registryDomain, REGISTRATION_TYPES, type RegistrationAuthorization } from "../../shared/eip712";
import { HolderBundleV2, type HolderBundle } from "../../shared/bundle";
import { createDisclosures, type SdClaims } from "../../shared/sd-jwt";
import type { SyntheticApplicationT } from "../../shared/api";
import { signCredentialJwt } from "../credential/sign";

/**
 * Credential issuance with no storage, network or configuration: given the issuer's keys, an
 * approved application and the deployment, it produces the holder bundle. `approveRequest`
 * wraps it with the database and chain bookkeeping. The in-browser playground (site/) calls
 * it unchanged, so both issue byte-for-byte the same kind of credential.
 */

export const REGISTRATION_WINDOW = 24 * 60 * 60; // authorization must be submitted within 24 h

/**
 * The selectively disclosable claims, computed once at issuance from the application. The birth
 * date itself is never put in the credential; only the age predicates as of issuance are.
 */
export function deriveDisclosableClaims(app: Pick<SyntheticApplicationT, "dateOfBirth" | "country">, at: number): SdClaims {
  const [y, m, d] = app.dateOfBirth.split("-").map(Number) as [number, number, number];
  const now = new Date(at * 1000);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return { ageOver18: age >= 18, ageOver21: age >= 21, countryOfResidence: app.country };
}

export interface IssueInput {
  keys: {
    did: string;
    kid: string;
    credentialPrivateJwk: { kty: "OKP"; crv: "Ed25519"; x: string; d: string };
    /** The EVM attestation key, as an ethers Signer (signs the EIP-712 authorization). */
    attestationSigner: Signer;
  };
  holderAddress: string;
  /** Either an application to derive the claims from, or claims already established (e.g. from a government ID). */
  application?: Pick<SyntheticApplicationT, "dateOfBirth" | "country">;
  claims?: SdClaims;
  deployment: { chainId: number; registry: string; deploymentId: string };
  issuerEpoch: number;
  now: number;
  lifetimeSeconds: number;
  credentialId: string;
}

export interface Issued {
  bundle: HolderBundle;
  holderDid: string;
  validFrom: number;
  validUntil: number;
}

export async function issueCredential(i: IssueInput): Promise<Issued> {
  const holderAddress = getAddress(i.holderAddress);
  const holderDid = deriveHolderDid(i.deployment.chainId, holderAddress);
  const validFrom = i.now;
  const validUntil = i.now + i.lifetimeSeconds;

  // 1. Minimal VC with selectively disclosable claims (from the synthetic application or a verified ID),
  //    signed with the credential key. Only digests go into the signed payload.
  const claims = i.claims ?? (i.application ? deriveDisclosableClaims(i.application, i.now) : undefined);
  if (!claims) throw new Error("issueCredential needs an application or claims");
  const { disclosures, sd } = createDisclosures(claims);
  const vc = buildIdentityCredential({
    credentialId: i.credentialId,
    issuerDid: i.keys.did,
    holderDid,
    validFrom,
    validUntil,
    chainId: i.deployment.chainId,
    registry: i.deployment.registry,
    sd,
  });
  const credentialJwt = await signCredentialJwt(vc, i.keys.credentialPrivateJwk, i.keys.kid);

  // 2. Commitment over the exact token bytes with a fresh 32-byte salt.
  const salt = randomSalt();
  const commitment = commitmentFor(credentialJwt, salt);

  // 3. EIP-712 registration authorization, signed with the separate EVM attestation key.
  const authorization: RegistrationAuthorization = {
    commitment,
    holder: holderAddress,
    issuer: getAddress(await i.keys.attestationSigner.getAddress()),
    schemaId: SCHEMA_ID,
    validFrom,
    expiresAt: validUntil,
    issuerEpoch: i.issuerEpoch,
    deadline: Math.min(i.now + REGISTRATION_WINDOW, validUntil - 1),
    deploymentId: i.deployment.deploymentId,
  };
  const authorizationSignature = await i.keys.attestationSigner.signTypedData(
    registryDomain(i.deployment.chainId, i.deployment.registry),
    REGISTRATION_TYPES,
    authorization,
  );

  const bundle = HolderBundleV2.parse({
    version: HOLDER_BUNDLE_VERSION,
    credentialJwt,
    disclosures,
    salt,
    commitment,
    authorization,
    authorizationSignature,
    deployment: { chainId: i.deployment.chainId, registry: i.deployment.registry },
    issuedAt: new Date(i.now * 1000).toISOString(),
  });
  return { bundle, holderDid, validFrom, validUntil };
}
