import { z } from "zod";
import {
  CREDENTIAL_SCHEMA_TYPE,
  CREDENTIAL_SCHEMA_URI,
  CREDENTIAL_STATUS_TYPE,
  CREDENTIAL_TYPE,
  IDENTITY_CONTEXT_URI,
  PROTOCOL_NAMESPACE,
  VC_V2_CONTEXT,
} from "./constants";
import { SD_ALG, SD_DIGEST_COUNT, SdDigest } from "./sd-jwt";

/**
 * IdentityVerifiedCredential, profile v2.
 *
 * A W3C VC Data Model 2.0 credential secured as `application/vc+sd-jwt`
 * (VC-JOSE-COSE "With SD-JWT"). The issuer-signed JWT payload is the credential with
 * `_sd_alg` and the selectively disclosable subject claims replaced by digests in
 * `credentialSubject._sd` (see sd-jwt.ts). A few JWT registered claims duplicate VC
 * properties. The issuer always sets them to identical values, and the verifier rejects any
 * disagreement:
 *
 *   iss == issuer         sub == credentialSubject.id         jti == id
 *   iat == validFrom      exp == validUntil                   (nbf is never set)
 *
 * Always disclosed in the subject: the holder DID and the issuer-asserted boolean
 * `identityVerified`. Selectively disclosable (one disclosure each, holder's choice):
 * `ageOver18`, `ageOver21`, `countryOfResidence`, derived by the issuer at issuance. No name,
 * birth date, document number, address, image or health data ever appears in this credential.
 */

/** Second-precision UTC timestamps (the issuer never emits fractions or offsets). */
const UtcSeconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "must be YYYY-MM-DDTHH:MM:SSZ");
const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const IdentityVerifiedCredentialV2 = z.strictObject({
  "@context": z.tuple([z.literal(VC_V2_CONTEXT), z.literal(IDENTITY_CONTEXT_URI)]),
  id: z.string().regex(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  type: z.tuple([z.literal("VerifiableCredential"), z.literal(CREDENTIAL_TYPE)]),
  issuer: z.string().regex(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/),
  validFrom: UtcSeconds,
  validUntil: UtcSeconds,
  // Verifier policy: the subject holds nothing beyond these properties; the digests are the
  // only place selectively disclosable claims may be referenced.
  credentialSubject: z.strictObject({
    id: z.string().startsWith("did:pkh:"),
    identityVerified: z.literal(true),
    _sd: z.array(SdDigest).length(SD_DIGEST_COUNT),
  }),
  credentialSchema: z.strictObject({
    id: z.literal(CREDENTIAL_SCHEMA_URI),
    type: z.literal(CREDENTIAL_SCHEMA_TYPE),
  }),
  credentialStatus: z.strictObject({
    type: z.literal(CREDENTIAL_STATUS_TYPE),
    chainId: z.number().int().positive(),
    registry: EvmAddress,
  }),
  // JWT registered claims (duplicates of the VC fields above).
  iss: z.string(),
  sub: z.string(),
  jti: z.string(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  _sd_alg: z.literal(SD_ALG),
});

export type IdentityVerifiedCredential = z.infer<typeof IdentityVerifiedCredentialV2>;

export function toUtcSeconds(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function fromUtcSeconds(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms % 1000 !== 0) throw new Error(`invalid timestamp ${value}`);
  return ms / 1000;
}

export interface BuildCredentialInput {
  credentialId: string; // urn:uuid:...
  issuerDid: string;
  holderDid: string;
  validFrom: number; // unix seconds
  validUntil: number; // unix seconds
  chainId: number;
  registry: string;
  /** Digests of the selectively disclosable claims (real + decoys), from createDisclosures(). */
  sd: string[];
}

export function buildIdentityCredential(input: BuildCredentialInput): IdentityVerifiedCredential {
  if (input.validUntil <= input.validFrom) throw new Error("validUntil must be after validFrom");
  const credential: IdentityVerifiedCredential = {
    "@context": [VC_V2_CONTEXT, IDENTITY_CONTEXT_URI],
    id: input.credentialId,
    type: ["VerifiableCredential", CREDENTIAL_TYPE],
    issuer: input.issuerDid,
    validFrom: toUtcSeconds(input.validFrom),
    validUntil: toUtcSeconds(input.validUntil),
    credentialSubject: { id: input.holderDid, identityVerified: true, _sd: input.sd },
    credentialSchema: { id: CREDENTIAL_SCHEMA_URI, type: CREDENTIAL_SCHEMA_TYPE },
    credentialStatus: { type: CREDENTIAL_STATUS_TYPE, chainId: input.chainId, registry: input.registry },
    iss: input.issuerDid,
    sub: input.holderDid,
    jti: input.credentialId,
    iat: input.validFrom,
    exp: input.validUntil,
    _sd_alg: SD_ALG,
  };
  return IdentityVerifiedCredentialV2.parse(credential);
}

/**
 * Checks that the duplicated JWT claims agree with the VC properties.
 * Returns a list of mismatch descriptions (empty when consistent).
 */
export function jwtClaimMismatches(vc: IdentityVerifiedCredential): string[] {
  const problems: string[] = [];
  if (vc.iss !== vc.issuer) problems.push("iss does not match issuer");
  if (vc.sub !== vc.credentialSubject.id) problems.push("sub does not match credentialSubject.id");
  if (vc.jti !== vc.id) problems.push("jti does not match id");
  if (vc.iat !== fromUtcSeconds(vc.validFrom)) problems.push("iat does not match validFrom");
  if (vc.exp !== fromUtcSeconds(vc.validUntil)) problems.push("exp does not match validUntil");
  return problems;
}

/** JSON-LD context defining this profile's custom terms. Bundled; never fetched. */
export const IDENTITY_CONTEXT_DOCUMENT = {
  "@context": {
    "@version": 1.1,
    "@protected": true,
    [CREDENTIAL_TYPE]: `${PROTOCOL_NAMESPACE}/vocab#${CREDENTIAL_TYPE}`,
    identityVerified: {
      "@id": `${PROTOCOL_NAMESPACE}/vocab#identityVerified`,
      "@type": "http://www.w3.org/2001/XMLSchema#boolean",
    },
    ageOver18: { "@id": `${PROTOCOL_NAMESPACE}/vocab#ageOver18`, "@type": "http://www.w3.org/2001/XMLSchema#boolean" },
    ageOver21: { "@id": `${PROTOCOL_NAMESPACE}/vocab#ageOver21`, "@type": "http://www.w3.org/2001/XMLSchema#boolean" },
    countryOfResidence: { "@id": `${PROTOCOL_NAMESPACE}/vocab#countryOfResidence` },
    // `jti` (duplicate of `id`, see jwtClaimMismatches) is the one JWT claim in our payload that
    // the W3C VC v2 context does not define (it defines iss, sub, iat, exp) and it has no default
    // @vocab, so JSON-LD-aware verifiers would reject it as an undefined term. Same IRI pattern.
    jti: { "@id": "https://www.iana.org/assignments/jwt#jti", "@type": "@id" },
    [CREDENTIAL_STATUS_TYPE]: {
      "@id": `${PROTOCOL_NAMESPACE}/vocab#${CREDENTIAL_STATUS_TYPE}`,
      "@context": {
        "@protected": true,
        chainId: { "@id": `${PROTOCOL_NAMESPACE}/vocab#chainId`, "@type": "http://www.w3.org/2001/XMLSchema#integer" },
        registry: { "@id": `${PROTOCOL_NAMESPACE}/vocab#registry` },
      },
    },
  },
} as const;

/** JSON Schema for the credential, generated from the same zod definition the verifier enforces. */
export function credentialJsonSchema(): unknown {
  return {
    $id: CREDENTIAL_SCHEMA_URI,
    title: "IdentityVerifiedCredential v2 (issuer-signed SD-JWT payload)",
    ...z.toJSONSchema(IdentityVerifiedCredentialV2),
  };
}
