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

/**
 * IdentityVerifiedCredential, profile v1.
 *
 * A W3C VC Data Model 2.0 credential secured as `application/vc+jwt`
 * (VC-JOSE-COSE, JWS compact serialization). The unsecured credential is the
 * JWS payload. A few JWT registered claims duplicate VC properties. The issuer
 * always sets them to identical values, and the verifier rejects any disagreement:
 *
 *   iss == issuer         sub == credentialSubject.id         jti == id
 *   iat == validFrom      exp == validUntil                   (nbf is never set)
 *
 * The subject carries exactly two properties: the holder DID and the
 * issuer-asserted boolean `identityVerified`. No name, birth date, document
 * number, address, image or health data ever appears in this credential.
 */

/** Second-precision UTC timestamps (the issuer never emits fractions or offsets). */
const UtcSeconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "must be YYYY-MM-DDTHH:MM:SSZ");
const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const IdentityVerifiedCredentialV1 = z.object({
  "@context": z.tuple([z.literal(VC_V2_CONTEXT), z.literal(IDENTITY_CONTEXT_URI)]),
  id: z.string().regex(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  type: z.tuple([z.literal("VerifiableCredential"), z.literal(CREDENTIAL_TYPE)]),
  issuer: z.string().regex(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/),
  validFrom: UtcSeconds,
  validUntil: UtcSeconds,
  // Verifier policy: the subject may hold nothing beyond these two properties.
  credentialSubject: z.strictObject({
    id: z.string().startsWith("did:pkh:"),
    identityVerified: z.literal(true),
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
});

export type IdentityVerifiedCredential = z.infer<typeof IdentityVerifiedCredentialV1>;

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
    credentialSubject: { id: input.holderDid, identityVerified: true },
    credentialSchema: { id: CREDENTIAL_SCHEMA_URI, type: CREDENTIAL_SCHEMA_TYPE },
    credentialStatus: { type: CREDENTIAL_STATUS_TYPE, chainId: input.chainId, registry: input.registry },
    iss: input.issuerDid,
    sub: input.holderDid,
    jti: input.credentialId,
    iat: input.validFrom,
    exp: input.validUntil,
  };
  return IdentityVerifiedCredentialV1.parse(credential);
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
    title: "IdentityVerifiedCredential v1",
    ...z.toJSONSchema(IdentityVerifiedCredentialV1),
  };
}
