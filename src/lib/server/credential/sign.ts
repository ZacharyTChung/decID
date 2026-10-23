import "server-only";
import { CompactSign, importJWK } from "jose";
import { VC_CTY, VC_TYP } from "../../shared/constants";
import { IdentityVerifiedCredentialV2, type IdentityVerifiedCredential } from "../../shared/credential-profile";

/**
 * Produces the issuer-signed JWT of an application/vc+sd-jwt credential (VC-JOSE-COSE
 * "With SD-JWT"): the SD-JWT payload (credential with `_sd` digests and `_sd_alg`) is the JWS
 * payload, compact serialization, protected header
 * { alg: "Ed25519", typ: "vc+sd-jwt", cty: "vc", kid: <DID URL> }. The disclosures are
 * created alongside (sd-jwt.ts createDisclosures) and travel next to this JWT.
 */
export async function signCredentialJwt(
  credential: IdentityVerifiedCredential,
  privateJwk: { kty: "OKP"; crv: "Ed25519"; x: string; d: string },
  kid: string,
): Promise<string> {
  const vc = IdentityVerifiedCredentialV2.parse(credential);
  const key = await importJWK(privateJwk, "Ed25519");
  return new CompactSign(new TextEncoder().encode(JSON.stringify(vc)))
    .setProtectedHeader({ alg: "Ed25519", typ: VC_TYP, cty: VC_CTY, kid })
    .sign(key);
}
