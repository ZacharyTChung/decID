import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { appConfig, issuerSecrets } from "../config";
import { db, nowSeconds } from "../db";
import { ApiError } from "../http";
import { deriveHolderDid } from "../../shared/did-pkh";
import { DC_PROTOCOL, MdocProtocolError, buildRequest, decryptResponse, newReaderKey, sessionTranscript } from "../../shared/mdl/annex-c";
import { MdlVerificationError, verifyMdlResponse } from "../../shared/mdl/verify";
import type { SdClaims } from "../../shared/sd-jwt";
import { mdlTrustAnchors } from "../mdl/trust";
import { approveRequest, type IssuanceResult } from "./service";
import type { Session } from "../auth/session";

/**
 * Getting a decID Pass with the government ID already in the phone's wallet, instead of a
 * (synthetic) application reviewed by the issuer.
 *
 *  1. startMdlRequest: a one-time reader key and an org-iso-mdoc request for age_over_18 and
 *     age_over_21 only (no birth date, name, photo, address or licence number).
 *  2. The browser hands it to the wallet with navigator.credentials.get; the person approves.
 *  3. completeMdlRequest: decrypt, verify the issuing authority's and the phone's signatures and
 *     the binding to this request and origin, then issue the Pass credential to the signed-in
 *     wallet. The ID's answer is discarded; what is kept is the outcome, the issuing authority's
 *     name and a keyed hash of the licence's device key.
 *
 * One licence backs one active Pass: verifying the same licence for another Pass revokes the
 * earlier one (the same path as account recovery), so a licence cannot be lent out to make
 * Passes for others.
 */

const REQUEST_TTL = 5 * 60;

export interface MdlRequestView {
  id: string;
  protocol: typeof DC_PROTOCOL;
  data: { deviceRequest: string; encryptionInfo: string };
  expiresAt: number;
}

export async function startMdlRequest(session: Session): Promise<MdlRequestView> {
  if ((await mdlTrustAnchors()).length === 0) throw new ApiError(503, "MDL_NOT_CONFIGURED", "this deployment does not accept government IDs yet");
  const key = await newReaderKey();
  const data = await buildRequest(key.publicKey);
  const id = randomUUID();
  const now = nowSeconds();
  db()
    .prepare("INSERT INTO mdl_requests (id, holder_address, reader_private_key, encryption_info, origin, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, session.address, key.privateKey, data.encryptionInfo, appConfig().origin, now, now + REQUEST_TTL);
  return { id, protocol: DC_PROTOCOL, data, expiresAt: now + REQUEST_TTL };
}

export interface MdlIssuance extends IssuanceResult {
  issuer: { name: string; test: boolean };
  ageOver18: boolean;
  ageOver21: boolean;
  /** Set when this licence already backed another Pass, which has now been shut down. */
  replacedPass: boolean;
}

export async function completeMdlRequest(session: Session, id: string, response: string): Promise<MdlIssuance> {
  const d = db();
  // One attempt per request: the reader key is deleted in the same statement that reads it.
  const row = d
    .prepare("DELETE FROM mdl_requests WHERE id = ? AND holder_address = ? AND expires_at > ? RETURNING reader_private_key, encryption_info, origin")
    .get(id, session.address, nowSeconds()) as { reader_private_key: string; encryption_info: string; origin: string } | undefined;
  if (!row) throw new ApiError(404, "MDL_REQUEST_NOT_FOUND", "this ID request has expired or was already used; start again");

  let verified;
  try {
    const transcript = await sessionTranscript(row.encryption_info, row.origin);
    const deviceResponse = await decryptResponse(response, row.reader_private_key, transcript.plain);
    verified = await verifyMdlResponse(deviceResponse, transcript.tagged, await mdlTrustAnchors());
  } catch (e) {
    if (e instanceof MdocProtocolError) throw new ApiError(400, "MDL_BAD_RESPONSE", e.message);
    if (e instanceof MdlVerificationError) throw new ApiError(422, e.code, e.message);
    throw e;
  }

  // Age answers: a licence that says 21+ is also 18+; one that says under 18 is also under 21.
  const ageOver18 = verified.ageOver18 ?? (verified.ageOver21 === true ? true : null);
  const ageOver21 = verified.ageOver21 ?? (verified.ageOver18 === false ? false : null);
  if (ageOver18 === null || ageOver21 === null) throw new ApiError(422, "MDL_AGE_NOT_PROVIDED", "the ID did not say whether its holder is over 18 and over 21");
  const country = /^[A-Z]{2}$/.test(verified.issuingCountry ?? "") ? verified.issuingCountry! : "US";
  const claims: SdClaims = { ageOver18, ageOver21, countryOfResidence: country };

  const keyHash = bindingKey(verified.deviceKeyThumbprint);
  const previous = d.prepare("SELECT holder_address FROM mdl_bindings WHERE key_hash = ?").get(keyHash) as { holder_address: string } | undefined;

  const requestId = randomUUID();
  const now = nowSeconds();
  d.prepare(
    `INSERT INTO issuer_requests (id, holder_address, holder_did, chain_id, status, synthetic_json, created_at, recovery_of, method, claims_json, valid_until_cap)
     VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?)`,
  ).run(
    requestId,
    session.address,
    deriveHolderDid(session.chainId, session.address),
    session.chainId,
    now,
    previous?.holder_address ?? null,
    `mdl:${verified.issuer.name}${verified.issuer.test ? " (test)" : ""}`,
    JSON.stringify(claims),
    Math.floor(verified.validUntil.getTime() / 1000),
  );
  let issued: IssuanceResult;
  try {
    // The ID is the evidence, so no person reviews it; the audit log names the issuing authority.
    issued = await approveRequest({ address: "government-id", chainId: session.chainId, role: "issuer", expiresAt: session.expiresAt }, requestId);
  } catch (e) {
    d.prepare("UPDATE issuer_requests SET status = 'rejected', reject_reason = 'issuance failed', claims_json = NULL WHERE id = ? AND status = 'pending'").run(requestId);
    throw e;
  }
  d.prepare(
    `INSERT INTO mdl_bindings (key_hash, holder_address, request_id, bound_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key_hash) DO UPDATE SET holder_address = excluded.holder_address, request_id = excluded.request_id, bound_at = excluded.bound_at`,
  ).run(keyHash, session.address, requestId, now);
  return { ...issued, issuer: verified.issuer, ageOver18, ageOver21, replacedPass: !!previous };
}

/** Keyed, so the stored value can't be matched against a licence's device key by anyone else. */
function bindingKey(deviceKeyThumbprint: string): string {
  const secret = createHmac("sha256", "decid/mdl-binding/v1").update(issuerSecrets().credentialPrivateJwk.d).digest();
  return createHmac("sha256", secret).update(deviceKeyThumbprint).digest("hex");
}
