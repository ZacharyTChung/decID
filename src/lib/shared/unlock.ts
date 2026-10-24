import { sha256, toUtf8Bytes, getBytes } from "ethers";

/**
 * Device unlock for decID Pass: before a share, the Pass asks the phone's platform authenticator
 * (Face ID, Touch ID, fingerprint or device PIN) for a WebAuthn assertion with user verification.
 * Its challenge is derived from the verification session, so the assertion is bound to this one
 * answer and can't be replayed into another. Shared by the wallet and the server.
 */
export function unlockChallenge(sessionId: string, nonce: string): string {
  const bytes = getBytes(sha256(toUtf8Bytes(`decid-unlock|${sessionId}|${nonce}`)));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
