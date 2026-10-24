import { Verifier, MDLError } from "@auth0/mdl";
import { X509Certificate } from "@peculiar/x509";
import { COSEKeyToJWK } from "cose-kit";
import { calculateJwkThumbprint, type JWK } from "jose";
import { MDL_DOCTYPE, MDL_NAMESPACE } from "./annex-c";

/**
 * Checks a mobile driving licence (ISO/IEC 18013-5 mdoc) DeviceResponse:
 *   1. the document signer certificate chains to a trusted issuing authority (IACA) root, e.g. a
 *      state DMV's, and its signature covers the data (the MSO);
 *   2. every returned element matches its signed digest;
 *   3. the phone signed this exact session (the device key named in the MSO), so a copied licence
 *      or a replayed answer fails;
 *   4. the document is a licence, valid now, and contains the age answers asked for.
 *
 * Returns only the answers and non-personal facts about the issuer. Anything else a wallet returns
 * is ignored and never leaves this function.
 */

export interface TrustAnchor {
  /** A human-readable name, e.g. "California DMV" or "decID test IACA". */
  name: string;
  pem: string;
  /** A test root: accepted only when the deployment allows test IDs. */
  test: boolean;
}

export interface VerifiedMdl {
  ageOver18: boolean | null;
  ageOver21: boolean | null;
  issuingCountry: string | null;
  issuingJurisdiction: string | null;
  issuer: { name: string; test: boolean };
  validUntil: Date;
  /**
   * A stable fingerprint of the licence's device key (from the issuer-signed MSO). It identifies
   * this licence on this phone without naming anyone, so one licence can back one active Pass.
   */
  deviceKeyThumbprint: string;
}

export type MdlFailure =
  | "MDL_UNTRUSTED_ISSUER"
  | "MDL_BAD_SIGNATURE"
  | "MDL_NOT_DEVICE_SIGNED"
  | "MDL_EXPIRED"
  | "MDL_WRONG_DOCUMENT"
  | "MDL_AGE_NOT_PROVIDED"
  | "MDL_MALFORMED";

export class MdlVerificationError extends Error {
  constructor(
    readonly code: MdlFailure,
    message: string,
  ) {
    super(message);
  }
}

const FAILURE_BY_CHECK: Record<string, MdlFailure> = {
  ISSUER_CERTIFICATE_VALIDITY: "MDL_UNTRUSTED_ISSUER",
  ISSUER_SIGNATURE_VALIDITY: "MDL_BAD_SIGNATURE",
  MSO_SIGNED_DATE_WITHIN_CERTIFICATE_VALIDITY: "MDL_BAD_SIGNATURE",
  MSO_VALIDITY_AT_VERIFICATION_TIME: "MDL_EXPIRED",
  ISSUER_SUBJECT_COUNTRY_NAME_PRESENCE: "MDL_UNTRUSTED_ISSUER",
  DOCUMENT_DEVICE_SIGNATURE_PRESENCE: "MDL_NOT_DEVICE_SIGNED",
  DEVICE_AUTH_SIGNATURE_OR_MAC_PRESENCE: "MDL_NOT_DEVICE_SIGNED",
  SESSION_TRANSCRIPT_PROVIDED: "MDL_NOT_DEVICE_SIGNED",
  DEVICE_KEY_AVAILABLE_IN_ISSUERAUTH: "MDL_NOT_DEVICE_SIGNED",
  DEVICE_SIGNATURE_VALIDITY: "MDL_NOT_DEVICE_SIGNED",
  DEVICE_MAC_PRESENCE: "MDL_NOT_DEVICE_SIGNED",
  DEVICE_MAC_VALIDITY: "MDL_NOT_DEVICE_SIGNED",
  ATTRIBUTE_DIGEST_MATCH: "MDL_BAD_SIGNATURE",
  ISSUER_AUTH_NAMESPACE_DIGEST_PRESENCE: "MDL_BAD_SIGNATURE",
  ISSUING_COUNTRY_MATCHES_CERTIFICATE: "MDL_BAD_SIGNATURE",
  ISSUING_JURISDICTION_MATCHES_CERTIFICATE: "MDL_BAD_SIGNATURE",
};

export async function verifyMdlResponse(
  deviceResponse: Uint8Array,
  transcriptTagged: Uint8Array,
  anchors: TrustAnchor[],
): Promise<VerifiedMdl> {
  if (anchors.length === 0) throw new MdlVerificationError("MDL_UNTRUSTED_ISSUER", "no ID issuers are trusted by this deployment");
  let mdoc;
  try {
    mdoc = await new Verifier(anchors.map((a) => a.pem)).verify(deviceResponse, { encodedSessionTranscript: transcriptTagged });
  } catch (e) {
    if (e instanceof MDLError) {
      const code = FAILURE_BY_CHECK[e.code ?? ""] ?? "MDL_BAD_SIGNATURE";
      throw new MdlVerificationError(code, e.message);
    }
    throw new MdlVerificationError("MDL_MALFORMED", `the wallet's answer could not be read: ${(e as Error).message}`);
  }
  if (mdoc.documents.length !== 1) throw new MdlVerificationError("MDL_WRONG_DOCUMENT", "expected exactly one document");
  const doc = mdoc.documents[0]!;
  const { issuerAuth } = doc.issuerSigned;
  const mso = issuerAuth.decodedPayload;
  if (doc.docType !== MDL_DOCTYPE || mso.docType !== MDL_DOCTYPE) throw new MdlVerificationError("MDL_WRONG_DOCUMENT", "the document is not a mobile driving licence");

  // Which trusted root signed it (the library accepts any of them).
  const leaf = new X509Certificate(new Uint8Array(issuerAuth.x5chain![0]!));
  let anchor: TrustAnchor | undefined;
  for (const a of anchors) {
    const root = new X509Certificate(a.pem);
    if (leaf.issuer === root.subject && (await leaf.verify({ publicKey: root.publicKey, signatureOnly: true }).catch(() => false))) {
      anchor = a;
      break;
    }
  }
  if (!anchor) throw new MdlVerificationError("MDL_UNTRUSTED_ISSUER", "the licence was not signed by a trusted issuing authority");

  const values = doc.getIssuerNameSpace(MDL_NAMESPACE) as Record<string, unknown>;
  const bool = (k: string) => (typeof values[k] === "boolean" ? (values[k] as boolean) : null);
  const str = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : null);
  const ageOver18 = bool("age_over_18");
  const ageOver21 = bool("age_over_21");
  if (ageOver18 === null && ageOver21 === null) throw new MdlVerificationError("MDL_AGE_NOT_PROVIDED", "the licence did not share an age answer");

  const deviceKey = mso.deviceKeyInfo?.deviceKey;
  if (!deviceKey) throw new MdlVerificationError("MDL_NOT_DEVICE_SIGNED", "the licence names no device key");
  const jwk = COSEKeyToJWK(deviceKey as unknown as Map<number, unknown>) as JWK;
  const deviceKeyThumbprint = await calculateJwkThumbprint({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as JWK);

  return {
    ageOver18,
    ageOver21,
    issuingCountry: str("issuing_country") ?? issuerAuth.countryName ?? null,
    issuingJurisdiction: str("issuing_jurisdiction") ?? issuerAuth.stateOrProvince ?? null,
    issuer: { name: anchor.name, test: anchor.test },
    validUntil: mso.validityInfo.validUntil,
    deviceKeyThumbprint,
  };
}
