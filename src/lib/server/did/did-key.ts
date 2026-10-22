import { driver } from "@digitalbazaar/did-method-key";
import * as Ed25519Multikey from "@digitalbazaar/ed25519-multikey";

/**
 * did:key handling for the issuer's credential signing key, delegated to the
 * maintained Digital Bazaar implementation (@digitalbazaar/did-method-key with
 * the Ed25519 Multikey suite). Only Ed25519 did:keys (multibase header z6Mk)
 * are registered; any other key type fails resolution.
 *
 * VC-JOSE-COSE expects verification material as `JsonWebKey` / `publicKeyJwk`.
 * The driver resolves did:key to a `Multikey` verification method, so we
 * convert it to a JWK with the same library's `toJwk` and expose a
 * JsonWebKey-typed view. This adaptation is documented in docs/CREDENTIAL-PROFILE.md.
 */
const didKeyDriver = driver();
didKeyDriver.use({ multibaseMultikeyHeader: "z6Mk", fromMultibase: Ed25519Multikey.from });

export interface Ed25519PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
}

export interface ResolvedAssertionKey {
  did: string;
  kid: string; // DID URL of the assertionMethod verification method
  type: "JsonWebKey";
  publicKeyJwk: Ed25519PublicJwk;
}

const DID_KEY_ED25519 = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{40,48}$/;

function asPublicJwk(jwk: { kty: string; crv: string; x: string }): Ed25519PublicJwk {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new Error("unexpected key type from did:key resolution");
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

/** Resolves an Ed25519 did:key DID to its assertionMethod key, as a JWK. */
export async function resolveDidKeyAssertionKey(did: string): Promise<ResolvedAssertionKey> {
  if (!DID_KEY_ED25519.test(did)) throw new Error("unsupported or malformed did:key (only Ed25519 z6Mk keys are accepted)");
  const didDocument = await didKeyDriver.get({ did });
  if (didDocument.id !== did) throw new Error("did:key resolution returned a different DID");
  const vm = didKeyDriver.publicMethodFor({ didDocument, purpose: "assertionMethod" });
  const keyPair = await Ed25519Multikey.from(vm);
  const jwk = asPublicJwk(await Ed25519Multikey.toJwk({ keyPair }));
  return { did, kid: vm.id, type: "JsonWebKey", publicKeyJwk: jwk };
}

/** Derives the did:key DID and key id for an Ed25519 public JWK. */
export async function deriveDidKeyFromJwk(publicJwk: Ed25519PublicJwk): Promise<{ did: string; kid: string }> {
  const keyPair = await Ed25519Multikey.fromJwk({ jwk: publicJwk });
  const { didDocument } = await didKeyDriver.fromKeyPair({ verificationKeyPair: keyPair });
  const vm = didKeyDriver.publicMethodFor({ didDocument, purpose: "assertionMethod" });
  return { did: didDocument.id, kid: vm.id };
}
