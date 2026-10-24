import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Checking an off-chain, hash-chained log against its on-chain checkpoints (contracts/ReceiptAnchor.sol).
 *
 * The off-chain chain check (receipt-chain.ts) proves that the log is internally consistent. The
 * checkpoints prove it is the SAME log that was anchored earlier: an operator who re-signs and
 * re-chains history, or drops the newest entries, produces a log that is internally consistent
 * but disagrees with the chain. Shared by the server and the in-browser prototype.
 */

/**
 * Stream labels. The namespace lets one anchor contract serve several decID deployments without
 * their streams mixing; a deployment pins it in configuration (ANCHOR_NAMESPACE, default "decid").
 */
export const auditStream = (ns = "decid") => `${ns}:issuer-audit`;
export const receiptStream = (merchantId: string, ns = "decid") => `${ns}:receipts:${merchantId}`;
export const AUDIT_STREAM = auditStream();
/** On-chain stream id: a hash of the label, so the contract stores no names. */
export const streamId = (label: string) => keccak256(toUtf8Bytes(label));

export interface Checkpoint {
  count: number;
  /** Hex SHA-256 of the newest entry at that count, without 0x. */
  head: string;
  block?: number;
  tx?: string;
}

export interface AnchorCheck {
  ok: boolean;
  /** Entries covered by the latest checkpoint. */
  anchoredCount: number;
  checkpoints: number;
  /** Entries newer than the latest checkpoint (waiting for the next anchor). */
  unanchored: number;
  latestBlock?: number;
  latestTx?: string;
  /** The first entry that disagrees with a checkpoint. */
  brokenAt?: number;
  problem?: string;
}

const norm = (h: string) => h.toLowerCase().replace(/^0x/, "");

export function checkAgainstAnchors(rows: { seq: number; hash: string }[], checkpoints: Checkpoint[]): AnchorCheck {
  const cps = [...checkpoints].sort((a, b) => a.count - b.count);
  const latest = cps[cps.length - 1];
  const base = { anchoredCount: latest?.count ?? 0, checkpoints: cps.length, latestBlock: latest?.block, latestTx: latest?.tx };
  for (const cp of cps) {
    const row = rows[cp.count - 1];
    if (!row) {
      return { ok: false, ...base, unanchored: 0, brokenAt: rows.length + 1, problem: `entries were removed: ${cp.count} were anchored on-chain, ${rows.length} remain` };
    }
    if (row.seq !== cp.count || norm(row.hash) !== norm(cp.head)) {
      return { ok: false, ...base, unanchored: Math.max(0, rows.length - base.anchoredCount), brokenAt: cp.count, problem: `entry ${cp.count} differs from the hash anchored on-chain${cp.block !== undefined ? ` in block ${cp.block}` : ""}` };
    }
  }
  return { ok: true, ...base, unanchored: Math.max(0, rows.length - base.anchoredCount) };
}
