import { presentationMessage, type PresentationProof } from "./eip712";
import { sdHash, selectDisclosures } from "./sd-jwt";

/**
 * Holder side of a presentation: picks exactly the disclosures the challenge requests and
 * builds the EIP-712 message to sign (which commits to those claim names and to the hash of
 * the exact SD-JWT presentation). Used by the browser, the scripts and the tests.
 */
export function preparePresentation(
  bundle: { credentialJwt: string; disclosures: string[]; commitment: string },
  challenge: { nonce: string; action: string; audience: string; expiresAt: number; requestedClaims: readonly string[] },
  holder: string,
): { disclosures: string[]; message: PresentationProof } {
  const disclosures = selectDisclosures(bundle.disclosures, challenge.requestedClaims);
  return {
    disclosures,
    message: presentationMessage({
      audience: challenge.audience,
      action: challenge.action,
      challenge: challenge.nonce,
      holder,
      commitment: bundle.commitment,
      disclosed: challenge.requestedClaims,
      sdHash: sdHash(bundle.credentialJwt, disclosures),
      expiresAt: challenge.expiresAt,
    }),
  };
}
