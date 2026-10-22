import "server-only";
import { CompactSign, importJWK } from "jose";
import { VC_JWT_CTY, VC_JWT_TYP } from "../../shared/constants";
import { IdentityVerifiedCredentialV1, type IdentityVerifiedCredential } from "../../shared/credential-profile";

/**
 * Secures a credential as application/vc+jwt (VC-JOSE-COSE §3.1.1):
 * the unsecured credential JSON is the JWS payload, compact serialization,
 * protected header { alg: "Ed25519", typ: "vc+jwt", cty: "vc", kid: <DID URL> }.
 */
export async function signCredentialJwt(
  credential: IdentityVerifiedCredential,
  privateJwk: { kty: "OKP"; crv: "Ed25519"; x: string; d: string },
  kid: string,
): Promise<string> {
  const vc = IdentityVerifiedCredentialV1.parse(credential);
  const key = await importJWK(privateJwk, "Ed25519");
  return new CompactSign(new TextEncoder().encode(JSON.stringify(vc)))
    .setProtectedHeader({ alg: "Ed25519", typ: VC_JWT_TYP, cty: VC_JWT_CTY, kid })
    .sign(key);
}
