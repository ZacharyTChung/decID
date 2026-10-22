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
export const IDENTITY_CONTEXT_URI = `${PROTOCOL_NAMESPACE}/contexts/identity-verified/v1`;

export const CREDENTIAL_TYPE = "IdentityVerifiedCredential";
export const CREDENTIAL_SCHEMA_URI = `${PROTOCOL_NAMESPACE}/schemas/identity-verified/v1.json`;
export const CREDENTIAL_SCHEMA_TYPE = "JsonSchema";
export const CREDENTIAL_STATUS_TYPE = "EvmCredentialRegistryStatus2026";

/** On-chain schema identifier: keccak256 of the UTF-8 schema URI. */
export const SCHEMA_ID = keccak256(toUtf8Bytes(CREDENTIAL_SCHEMA_URI));

/** Commitment domain separator. Must equal CredentialRegistry.COMMITMENT_DOMAIN. */
export const COMMITMENT_DOMAIN_LABEL = "did-mvp:credential-commitment:v1";
export const COMMITMENT_DOMAIN = keccak256(toUtf8Bytes(COMMITMENT_DOMAIN_LABEL));

/** JOSE securing profile (W3C VC-JOSE-COSE, JWS compact serialization). */
export const VC_JWT_TYP = "vc+jwt";
export const VC_JWT_CTY = "vc";
export const VC_MEDIA_TYPE = "application/vc+jwt";
/** Algorithm allowlist. Fully-specified Ed25519 (RFC 9864). Nothing else is accepted. */
export const ALLOWED_JWS_ALGS = ["Ed25519"] as const;

/** Upper bound on a compact credential token. Larger inputs are rejected before parsing. */
export const MAX_CREDENTIAL_TOKEN_BYTES = 8 * 1024;

export const HOLDER_BUNDLE_VERSION = "did-mvp.holder-bundle/v1";
export const ENCRYPTED_BUNDLE_VERSION = "did-mvp.encrypted-holder-bundle/v1";

/** The only verifier action this prototype supports. */
export const VERIFIER_ACTIONS = ["access-verified-member-area"] as const;
export type VerifierAction = (typeof VERIFIER_ACTIONS)[number];
