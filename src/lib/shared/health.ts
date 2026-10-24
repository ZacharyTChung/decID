import { SignJWT, jwtVerify, type CryptoKey, type JWK, importJWK } from "jose";
import { verifyMessage, type Wallet, type HDNodeWallet } from "ethers";
import { decodeDisclosure, disclosureDigest, encodeDisclosure, sdHash } from "./sd-jwt";

/**
 * decID Health: the same idea as the age Pass, for health facts. A clinic signs a health record
 * whose facts are each selectively disclosable (SD-JWT digests). A school, employer or team asks
 * one question ("measles immunity on record?") and learns that one answer: never the record,
 * diagnoses, dates or anything else. The holder's phone key signs each answer for that one
 * request, so a copied record or a replayed answer fails.
 *
 * Synthetic data only. Real health data carries legal duties (e.g. HIPAA in the US); this module
 * is a demonstration of the data flow, not a compliant health records system.
 */

export const HEALTH_FACTS = {
  measlesImmune: { label: "Measles (MMR) immunity", question: "Is measles (MMR) immunity on record?" },
  tbScreenClear: { label: "TB screening clear", question: "Is a TB screening from the last 12 months clear?" },
  fluVaccine: { label: "Flu vaccine this season", question: "Has this season’s flu vaccine been given?" },
  sportsClearance: { label: "Cleared for sports", question: "Is a sports physical clearance on record?" },
} as const;
export type HealthFact = keyof typeof HEALTH_FACTS;
export const HEALTH_FACT_NAMES = Object.keys(HEALTH_FACTS) as HealthFact[];

export interface HealthRecord {
  jwt: string;
  disclosures: string[];
}
export interface HealthPresentation {
  jwt: string;
  disclosure: string;
  holder: string;
  signature: string;
}
export interface HealthCheckResult {
  ok: boolean;
  /** The one fact asked, if the presentation verified. */
  answer: boolean | null;
  reason: null | "BAD_SIGNATURE" | "EXPIRED" | "NOT_IN_RECORD" | "WRONG_FACT" | "HOLDER_MISMATCH" | "REVOKED";
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const salt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/** The clinic issues a record to the holder's phone key. Every fact is hidden behind a digest. */
export async function issueHealthRecord(o: { clinicKey: CryptoKey; clinicKid: string; clinic: string; holder: string; facts: Record<HealthFact, boolean>; now: number; lifetimeDays?: number }): Promise<HealthRecord> {
  const disclosures = HEALTH_FACT_NAMES.map((f) => encodeDisclosure(salt(), f, o.facts[f]));
  const sd = disclosures.map(disclosureDigest);
  while (sd.length < 8) sd.push(disclosureDigest(salt())); // decoys: the digest count reveals nothing
  const jwt = await new SignJWT({ vct: "urn:decid:health-record:v1", holder: o.holder, _sd: sd.sort(), _sd_alg: "sha-256" })
    .setProtectedHeader({ alg: "EdDSA", typ: "vc+sd-jwt", kid: o.clinicKid })
    .setIssuer(o.clinic)
    .setJti(crypto.randomUUID())
    .setIssuedAt(o.now)
    .setExpirationTime(o.now + (o.lifetimeDays ?? 365) * 86400)
    .sign(o.clinicKey);
  return { jwt, disclosures };
}

const message = (audience: string, nonce: string, hash: string) => `decID Health\naudience: ${audience}\nnonce: ${nonce}\npresentation: ${hash}`;

/** The holder answers one question: one disclosure, signed for this request by the phone's key. */
export async function presentHealthFact(record: HealthRecord, fact: HealthFact, wallet: Wallet | HDNodeWallet, request: { audience: string; nonce: string }): Promise<HealthPresentation> {
  const disclosure = record.disclosures.find((d) => decodeDisclosure(d).name === fact);
  if (!disclosure) throw new Error("this record does not hold that fact");
  const signature = await wallet.signMessage(message(request.audience, request.nonce, sdHash(record.jwt, [disclosure])));
  return { jwt: record.jwt, disclosure, holder: wallet.address, signature };
}

/** The asker's check: clinic signature and expiry, the disclosure is in the record, the right fact, the holder's own phone signed this request. */
export async function verifyHealthFact(p: HealthPresentation, o: { clinicJwk: JWK; fact: HealthFact; audience: string; nonce: string; now: number; revoked?: Set<string> }): Promise<HealthCheckResult> {
  const fail = (reason: HealthCheckResult["reason"]): HealthCheckResult => ({ ok: false, answer: null, reason });
  let payload: { holder?: string; _sd?: string[]; jti?: string; exp?: number };
  try {
    ({ payload } = await jwtVerify(p.jwt, await importJWK(o.clinicJwk, "EdDSA"), { algorithms: ["EdDSA"], currentDate: new Date(o.now * 1000) }));
  } catch (e) {
    return fail((e as { code?: string }).code === "ERR_JWT_EXPIRED" ? "EXPIRED" : "BAD_SIGNATURE");
  }
  if (payload.jti && o.revoked?.has(payload.jti)) return fail("REVOKED");
  if (!payload._sd?.includes(disclosureDigest(p.disclosure))) return fail("NOT_IN_RECORD");
  const d = decodeDisclosure(p.disclosure);
  if (d.name !== o.fact || typeof d.value !== "boolean") return fail("WRONG_FACT");
  let signer = "";
  try {
    signer = verifyMessage(message(o.audience, o.nonce, sdHash(p.jwt, [p.disclosure])), p.signature);
  } catch {
    // unreadable signature
  }
  if (!payload.holder || signer.toLowerCase() !== payload.holder.toLowerCase() || signer.toLowerCase() !== p.holder.toLowerCase()) return fail("HOLDER_MISMATCH");
  return { ok: true, answer: d.value, reason: null };
}
