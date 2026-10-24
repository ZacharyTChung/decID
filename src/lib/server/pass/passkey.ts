import "server-only";
import { randomBytes } from "node:crypto";
import { generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { appConfig } from "../config";
import { db, nowSeconds } from "../db";
import { ApiError } from "../errors";
import type { Session } from "../auth/session";

/**
 * decID Pass device unlock with a platform passkey (WebAuthn, user verification required): Face
 * ID, Touch ID, a fingerprint or the device PIN. The biometric never leaves the phone; decID
 * stores only the passkey's public key, tied to the Pass's wallet address.
 *
 * At a share, the Pass includes an assertion over unlockChallenge(session, nonce) (see
 * shared/unlock.ts). decID verifies it against the holder whose presentation just verified, so
 * the receipt can say "the phone's owner unlocked it to answer", and a business can require that.
 */

const CHALLENGE_TTL = 300;
const rp = () => {
  const origin = appConfig().origin;
  return { origin, rpID: new URL(origin).hostname };
};

export async function passkeyRegistrationOptions(session: Session) {
  const existing = db().prepare("SELECT credential_id FROM pass_passkeys WHERE holder_address = ?").all(session.address) as { credential_id: string }[];
  const options = await generateRegistrationOptions({
    rpName: "decID Pass",
    rpID: rp().rpID,
    userName: "decID Pass",
    userDisplayName: "decID Pass",
    // A random handle: the passkey names no person and no wallet address.
    userID: new Uint8Array(randomBytes(16)),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
  });
  db()
    .prepare("INSERT INTO pass_passkey_challenges (holder_address, challenge, expires_at) VALUES (?, ?, ?) ON CONFLICT(holder_address) DO UPDATE SET challenge = excluded.challenge, expires_at = excluded.expires_at")
    .run(session.address, options.challenge, nowSeconds() + CHALLENGE_TTL);
  return options;
}

export async function registerPasskey(session: Session, response: RegistrationResponseJSON): Promise<{ credentialId: string }> {
  const row = db()
    .prepare("DELETE FROM pass_passkey_challenges WHERE holder_address = ? AND expires_at > ? RETURNING challenge")
    .get(session.address, nowSeconds()) as { challenge: string } | undefined;
  if (!row) throw new ApiError(400, "PASSKEY_CHALLENGE_EXPIRED", "start the Face ID / fingerprint setup again");
  let v;
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge: row.challenge, expectedOrigin: rp().origin, expectedRPID: rp().rpID, requireUserVerification: true });
  } catch (e) {
    throw new ApiError(400, "PASSKEY_INVALID", `the passkey could not be verified: ${(e as Error).message}`);
  }
  if (!v.verified || !v.registrationInfo) throw new ApiError(400, "PASSKEY_INVALID", "the passkey could not be verified");
  const c = v.registrationInfo.credential;
  db()
    .prepare("INSERT INTO pass_passkeys (credential_id, holder_address, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(c.id, session.address, Buffer.from(c.publicKey).toString("base64url"), c.counter, JSON.stringify(c.transports ?? []), nowSeconds());
  return { credentialId: c.id };
}

/**
 * Checks a share's unlock assertion. Returns true only for a valid, user-verified assertion over
 * the expected challenge, from a passkey this holder registered. Never throws for a bad
 * assertion: an unverified unlock is reported as `false`, and the business decides.
 */
export async function verifyUnlock(holderAddress: string, expectedChallenge: string, response: AuthenticationResponseJSON | undefined): Promise<boolean> {
  if (!response) return false;
  const row = db()
    .prepare("SELECT credential_id, public_key, counter, transports FROM pass_passkeys WHERE credential_id = ? AND holder_address = ?")
    .get(response.id, holderAddress) as { credential_id: string; public_key: string; counter: number; transports: string | null } | undefined;
  if (!row) return false;
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
      requireUserVerification: true,
      credential: { id: row.credential_id, publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")), counter: row.counter, transports: row.transports ? JSON.parse(row.transports) : undefined },
    });
    if (!v.verified) return false;
    db().prepare("UPDATE pass_passkeys SET counter = ? WHERE credential_id = ?").run(v.authenticationInfo.newCounter, row.credential_id);
    return true;
  } catch {
    return false;
  }
}

export function hasPasskey(holderAddress: string): boolean {
  return !!db().prepare("SELECT 1 FROM pass_passkeys WHERE holder_address = ?").get(holderAddress);
}
