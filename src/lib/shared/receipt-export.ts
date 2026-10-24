import { checkAgainstAnchors, type AnchorCheck, type Checkpoint } from "./anchor-check";
import { checkReceiptChain, sha256Hex, verifyReceipt, type ChainCheck, type Receipt, type ReceiptJwks, type ReceiptRow } from "./receipt-chain";

/**
 * A business's compliance receipts, exported for an auditor or regulator, and the independent
 * check of such an export. The check needs only the export, decID's published receipt keys and
 * read access to the chain: no decID database, no business database, no API key.
 *
 * The export holds no personal data: each receipt names the policy, the outcome, the issuer that
 * vouched and a digest of the evidence, never the customer.
 */

export const EXPORT_FORMAT = "decid-receipts/v1";

export interface ReceiptExport {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  merchant: { id: string; name: string };
  /** decID's receipt keys at export time. An auditor should prefer the published ones. */
  receiptKeys: ReceiptJwks;
  /** Where the checkpoints live; null when the deployment has no anchor contract. */
  anchor: { chainId: number; contract: string; stream: string; streamId: string } | null;
  receipts: { seq: number; jws: string }[];
}

export interface ExportCheck {
  receipts: number;
  chain: ChainCheck;
  anchor: AnchorCheck | null;
  outcomes: { satisfied: number; notSatisfied: number; byFailure: Record<string, number> };
  ok: boolean;
}

/** Rebuilds the stored chain rows from the receipts themselves (hash and back-link). */
export function rowsFromExport(e: Pick<ReceiptExport, "receipts">): ReceiptRow[] {
  return e.receipts.map((r) => {
    let prev = "";
    try {
      prev = (JSON.parse(new TextDecoder().decode(base64urlDecode(r.jws.split(".")[1] ?? ""))) as Receipt).prev;
    } catch {
      // an unreadable receipt fails the signature check below
    }
    return { seq: r.seq, jws: r.jws, hash: sha256Hex(r.jws), prev_hash: prev };
  });
}

export async function verifyExport(e: ReceiptExport, keys: ReceiptJwks, checkpoints: Checkpoint[] | null): Promise<ExportCheck> {
  if (e.format !== EXPORT_FORMAT) throw new Error(`unknown export format: ${String(e.format)}`);
  const rows = rowsFromExport(e);
  const chain = await checkReceiptChain(rows, keys, e.merchant.id);
  const anchor = checkpoints ? checkAgainstAnchors(rows, checkpoints) : null;
  const outcomes = { satisfied: 0, notSatisfied: 0, byFailure: {} as Record<string, number> };
  for (const r of e.receipts) {
    try {
      const p = await verifyReceipt(r.jws, keys);
      if (p.outcome === "satisfied") outcomes.satisfied++;
      else {
        outcomes.notSatisfied++;
        const k = p.failureCode ?? "UNKNOWN";
        outcomes.byFailure[k] = (outcomes.byFailure[k] ?? 0) + 1;
      }
    } catch {
      // counted as a chain failure above
    }
  }
  return { receipts: rows.length, chain, anchor, outcomes, ok: chain.ok && (anchor === null || anchor.ok) };
}

function base64urlDecode(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}
