import "server-only";
import { createHash } from "node:crypto";
import { CompactSign, calculateJwkThumbprint, compactVerify, importJWK } from "jose";
import { verifyReceiptKey } from "../config";
import { db, nowSeconds } from "../db";

/**
 * Compliance receipts. For every completed verification, decID Verify signs a receipt for the
 * business: which policy was checked, the outcome, which issuer vouched, the registry status
 * at the time, and a digest of the evidence. A receipt holds no personal data: no name, birth
 * date, address, wallet address or DID.
 *
 * Each business's receipts form their own hash chain (every receipt names the hash of the
 * previous one), so a business can show an auditor an unbroken record. Signatures verify
 * against the public keys at GET /api/v1/receipt-keys.
 */

export const RECEIPT_TYP = "decid-receipt+jwt";
export const GENESIS = "0".repeat(64);

export interface ReceiptBody {
  sid: string; // verification session id
  merchant: string;
  ref: string | null; // the business's own reference
  policy: string;
  outcome: "satisfied" | "not_satisfied";
  failureCode: string | null;
  issuer: { name: string; did: string } | null; // the issuer whose credential vouched (when satisfied)
  registry: { chainId: number; address: string; status: string | null };
  evidence: string; // SHA-256 of the presentation the holder signed; the holder keeps it
  checkedAt: string;
}
export interface Receipt extends ReceiptBody {
  seq: number;
  prev: string;
  iat: number;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function signingKey() {
  const jwk = verifyReceiptKey();
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  return { key: await importJWK(jwk, "Ed25519"), kid: await calculateJwkThumbprint(pub), pub };
}

export async function receiptJwks() {
  const { kid, pub } = await signingKey();
  return { keys: [{ ...pub, kid, alg: "Ed25519", use: "sig" }] };
}

/** Signs and appends a receipt to the merchant's chain. Safe under concurrency (retries on a seq clash). */
export async function appendReceipt(merchantId: string, body: ReceiptBody): Promise<{ seq: number; jws: string }> {
  const { key, kid } = await signingKey();
  for (let attempt = 0; attempt < 8; attempt++) {
    const last = db().prepare("SELECT seq, hash FROM verify_receipts WHERE merchant_id = ? ORDER BY seq DESC LIMIT 1").get(merchantId) as { seq: number; hash: string } | undefined;
    const receipt: Receipt = { ...body, seq: (last?.seq ?? 0) + 1, prev: last?.hash ?? GENESIS, iat: nowSeconds() };
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(receipt))).setProtectedHeader({ alg: "Ed25519", typ: RECEIPT_TYP, kid }).sign(key);
    try {
      db()
        .prepare("INSERT INTO verify_receipts (merchant_id, seq, session_id, jws, hash, prev_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(merchantId, receipt.seq, body.sid, jws, sha256(jws), receipt.prev, receipt.iat);
      return { seq: receipt.seq, jws };
    } catch (e) {
      if (!/UNIQUE|PRIMARY KEY/.test(String((e as Error).message))) throw e;
      // Another request took this sequence number: re-read the head and sign again.
    }
  }
  throw new Error("could not append receipt");
}

/** Verifies a receipt's signature against the given public keys and returns its payload. */
export async function verifyReceipt(jws: string, jwks: { keys: { kid?: string; kty: string; crv?: string; x?: string }[] }): Promise<Receipt> {
  const header = JSON.parse(Buffer.from(jws.split(".")[0]!, "base64url").toString());
  if (header.typ !== RECEIPT_TYP || header.alg !== "Ed25519") throw new Error("not a decID receipt");
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown receipt key");
  const { payload } = await compactVerify(jws, await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x }, "Ed25519"), { algorithms: ["Ed25519"] });
  return JSON.parse(new TextDecoder().decode(payload)) as Receipt;
}

export interface ChainCheck {
  ok: boolean;
  count: number;
  head: string;
  firstBrokenSeq?: number;
  problem?: string;
}

/** Re-verifies every signature and link in a merchant's receipt chain. */
export async function verifyReceiptChain(merchantId: string): Promise<ChainCheck> {
  const jwks = await receiptJwks();
  const rows = db().prepare("SELECT seq, jws, hash, prev_hash FROM verify_receipts WHERE merchant_id = ? ORDER BY seq").all(merchantId) as { seq: number; jws: string; hash: string; prev_hash: string }[];
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const fail = (problem: string): ChainCheck => ({ ok: false, count: rows.length, head: prev, firstBrokenSeq: r.seq, problem });
    if (r.seq !== i + 1) return fail(`sequence gap: expected ${i + 1}`);
    if (sha256(r.jws) !== r.hash) return fail("stored hash does not match the receipt");
    let payload: Receipt;
    try {
      payload = await verifyReceipt(r.jws, jwks);
    } catch {
      return fail("signature does not verify");
    }
    if (payload.prev !== prev || r.prev_hash !== prev) return fail("link to the previous receipt is broken");
    if (payload.seq !== r.seq || payload.merchant !== merchantId) return fail("receipt content does not match its position");
    prev = r.hash;
  }
  return { ok: true, count: rows.length, head: prev };
}
