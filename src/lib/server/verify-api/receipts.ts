import "server-only";
import { calculateJwkThumbprint, importJWK } from "jose";
import { checkReceiptChain, GENESIS, sha256Hex, signReceipt, type ChainCheck, type Receipt, type ReceiptBody } from "../../shared/receipt-chain";
import { verifyReceiptKey } from "../config";
import { db, nowSeconds } from "../db";
import { checkLogAnchors, requestAnchor } from "../anchor";
import { anchorNamespace } from "../config";
import { receiptStream, type AnchorCheck } from "../../shared/anchor-check";

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

export { RECEIPT_TYP, GENESIS, verifyReceipt, type ChainCheck, type Receipt, type ReceiptBody } from "../../shared/receipt-chain";

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
    const jws = await signReceipt(receipt, key, kid);
    try {
      db()
        .prepare("INSERT INTO verify_receipts (merchant_id, seq, session_id, jws, hash, prev_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(merchantId, receipt.seq, body.sid, jws, sha256Hex(jws), receipt.prev, receipt.iat);
      // Checkpoint the new head on-chain in the background (see ../anchor.ts).
      requestAnchor(receiptStream(merchantId, anchorNamespace()), () => receiptHead(merchantId));
      return { seq: receipt.seq, jws };
    } catch (e) {
      if (!/UNIQUE|PRIMARY KEY/.test(String((e as Error).message))) throw e;
      // Another request took this sequence number: re-read the head and sign again.
    }
  }
  throw new Error("could not append receipt");
}

function receiptHead(merchantId: string): { count: number; head: string } | null {
  const r = db().prepare("SELECT seq, hash FROM verify_receipts WHERE merchant_id = ? ORDER BY seq DESC LIMIT 1").get(merchantId) as { seq: number; hash: string } | undefined;
  return r ? { count: r.seq, head: r.hash } : null;
}

/**
 * The chain check plus the on-chain comparison. `anchor` is null when the deployment has no
 * anchor contract, and reports `unavailable` when the chain can't be read right now.
 */
export async function verifyReceiptChainAnchored(merchantId: string): Promise<ChainCheck & { anchor: (AnchorCheck & { unavailable?: false }) | { unavailable: true } | null }> {
  const chain = await verifyReceiptChain(merchantId);
  const rows = db().prepare("SELECT seq, hash FROM verify_receipts WHERE merchant_id = ? ORDER BY seq").all(merchantId) as { seq: number; hash: string }[];
  try {
    return { ...chain, anchor: await checkLogAnchors(receiptStream(merchantId, anchorNamespace()), rows) };
  } catch {
    return { ...chain, anchor: { unavailable: true } };
  }
}

/** Re-verifies every signature and link in a merchant's receipt chain. */
export async function verifyReceiptChain(merchantId: string): Promise<ChainCheck> {
  const jwks = await receiptJwks();
  const rows = db().prepare("SELECT seq, jws, hash, prev_hash FROM verify_receipts WHERE merchant_id = ? ORDER BY seq").all(merchantId) as { seq: number; jws: string; hash: string; prev_hash: string }[];
  return checkReceiptChain(rows, jwks, merchantId);
}
