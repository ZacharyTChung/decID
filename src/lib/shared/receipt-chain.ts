import { CompactSign, compactVerify, decodeProtectedHeader, importJWK, type CryptoKey } from "jose";
import { sha256, toUtf8Bytes } from "ethers";

/**
 * decID Verify compliance receipts and door match codes: the parts that need no database, shared
 * by the server (src/lib/server/verify-api) and the in-browser hosted prototype (site/product).
 *
 * A receipt is an Ed25519 JWS over a JSON body that names the policy, the outcome, the issuer
 * that vouched and the registry status, and links to the hash of the business's previous
 * receipt. It holds no personal data: no name, birth date, address, wallet address or DID.
 */

export const RECEIPT_TYP = "decid-receipt+jwt";
export const GENESIS = "0".repeat(64);
const MATCH_ALPHABET = "ACDEFHJKMNPRTUVWXY3479"; // no look-alikes (0/O, 1/I/L, 2/Z, 5/S, 8/B)

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
  /** The holder unlocked their phone (Face ID, fingerprint or device PIN) for this answer. Absent in older receipts. */
  userVerified?: boolean;
}
export interface Receipt extends ReceiptBody {
  seq: number;
  prev: string;
  iat: number;
}
export interface ReceiptJwks {
  keys: { kid?: string; kty: string; crv?: string; x?: string }[];
}
/** One stored link of a business's chain. */
export interface ReceiptRow {
  seq: number;
  jws: string;
  hash: string;
  prev_hash: string;
}
export interface ChainCheck {
  ok: boolean;
  count: number;
  head: string;
  firstBrokenSeq?: number;
  problem?: string;
}

/** Lowercase hex SHA-256 of a UTF-8 string (no 0x prefix). */
export const sha256Hex = (s: string) => sha256(toUtf8Bytes(s)).slice(2);

export async function signReceipt(receipt: Receipt, key: CryptoKey | Uint8Array, kid: string): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(receipt))).setProtectedHeader({ alg: "Ed25519", typ: RECEIPT_TYP, kid }).sign(key);
}

/** Verifies a receipt's signature against the given public keys and returns its payload. */
export async function verifyReceipt(jws: string, jwks: ReceiptJwks): Promise<Receipt> {
  const header = decodeProtectedHeader(jws);
  if (header.typ !== RECEIPT_TYP || header.alg !== "Ed25519") throw new Error("not a decID receipt");
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown receipt key");
  const { payload } = await compactVerify(jws, await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x }, "Ed25519"), { algorithms: ["Ed25519"] });
  return JSON.parse(new TextDecoder().decode(payload)) as Receipt;
}

/** Re-verifies every signature and link in one business's receipt chain (rows in seq order). */
export async function checkReceiptChain(rows: ReceiptRow[], jwks: ReceiptJwks, merchantId: string): Promise<ChainCheck> {
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const fail = (problem: string): ChainCheck => ({ ok: false, count: rows.length, head: prev, firstBrokenSeq: r.seq, problem });
    if (r.seq !== i + 1) return fail(`sequence gap: expected ${i + 1}`);
    if (sha256Hex(r.jws) !== r.hash) return fail("stored hash does not match the receipt");
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

/** The 4-character code a door screen and the guest's phone both show for one verified answer. */
export function matchCode(sessionId: string, signature: string): string {
  const h = sha256(toUtf8Bytes(`${sessionId}|${signature}`));
  return Array.from({ length: 4 }, (_, i) => MATCH_ALPHABET[parseInt(h.slice(2 + i * 2, 4 + i * 2), 16) % MATCH_ALPHABET.length]).join("");
}
