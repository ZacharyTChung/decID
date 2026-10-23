import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Protocol constants shared by the browser, the server, the scripts and the
 * contract tests. Everything here is public. Nothing secret may be added.
 *
 * The `.invalid` host (RFC 2606 reserved TLD) is deliberate: these IRIs are
 * prototype identifiers that can never collide with a live resource. Verifiers
 * never dereference them; the documents are bundled in this repository and
 * served read-only by the app for inspection. A production profile would
 * publish them at a stable HTTPS origin the issuer controls.
 */
export const PROTOCOL_NAMESPACE = "https://did-mvp.invalid";

export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";
export const IDENTITY_CONTEXT_URI = `${PROTOCOL_NAMESPACE}/contexts/identity-verified/v2`;

export const CREDENTIAL_TYPE = "IdentityVerifiedCredential";
export const CREDENTIAL_SCHEMA_URI = `${PROTOCOL_NAMESPACE}/schemas/identity-verified/v2.json`;
export const CREDENTIAL_SCHEMA_TYPE = "JsonSchema";
export const CREDENTIAL_STATUS_TYPE = "EvmCredentialRegistryStatus2026";

/** On-chain schema identifier: keccak256 of the UTF-8 schema URI. */
export const SCHEMA_ID = keccak256(toUtf8Bytes(CREDENTIAL_SCHEMA_URI));

/** Commitment domain separator. Must equal CredentialRegistry.COMMITMENT_DOMAIN. */
export const COMMITMENT_DOMAIN_LABEL = "did-mvp:credential-commitment:v1";
export const COMMITMENT_DOMAIN = keccak256(toUtf8Bytes(COMMITMENT_DOMAIN_LABEL));

/** Securing profile: W3C VC-JOSE-COSE "With SD-JWT" (issuer-signed JWS compact serialization + disclosures). */
export const VC_TYP = "vc+sd-jwt";
export const VC_CTY = "vc";
export const VC_MEDIA_TYPE = "application/vc+sd-jwt";
/** Algorithm allowlist. Fully-specified Ed25519 (RFC 9864). Nothing else is accepted. */
export const ALLOWED_JWS_ALGS = ["Ed25519"] as const;

/** Upper bound on a compact credential token. Larger inputs are rejected before parsing. */
export const MAX_CREDENTIAL_TOKEN_BYTES = 8 * 1024;

export const HOLDER_BUNDLE_VERSION = "did-mvp.holder-bundle/v2";
export const ENCRYPTED_BUNDLE_VERSION = "did-mvp.encrypted-holder-bundle/v1";

/**
 * Verifier actions and what each requires the holder to disclose. `requested` claims must be
 * disclosed (and nothing else); `require` constrains their values. Every action also requires
 * the always-disclosed identityVerified=true credential itself.
 */
export const VERIFIER_ACTIONS = ["access-verified-member-area", "access-age-restricted-area", "verify-age-over-21"] as const;
export type VerifierAction = (typeof VERIFIER_ACTIONS)[number];
export const ACTION_POLICIES: Record<VerifierAction, { label: string; requested: readonly ("ageOver18" | "ageOver21" | "countryOfResidence")[]; require: Record<string, boolean | string> }> = {
  "access-verified-member-area": { label: "Verified member area", requested: [], require: {} },
  "access-age-restricted-area": { label: "Age-restricted area (18+)", requested: ["ageOver18"], require: { ageOver18: true } },
  "verify-age-over-21": { label: "Age 21+ (alcohol, venues)", requested: ["ageOver21"], require: { ageOver21: true } },
};
