import "server-only";
import { Contract, Wallet } from "ethers";
import { RECEIPT_ANCHOR_ABI } from "../../generated/contracts";
import { anchorerPrivateKey } from "./config";
import { loadDeployment, onChain, provider, type Deployment } from "./chain";
import { withAnchorerTxLock } from "./issuer/tx-lock";
import { checkAgainstAnchors, streamId, type AnchorCheck, type Checkpoint } from "../shared/anchor-check";

/**
 * Anchoring: after a log grows (a business's receipt chain, the issuer audit log), its head and
 * entry count are written to the ReceiptAnchor contract. Verification then checks the stored log
 * against every on-chain checkpoint, which catches what a hash chain alone cannot: an operator
 * re-signing history, or the newest entries being dropped.
 *
 * Anchoring runs in the background so a check never waits for a block: requests for the same log
 * coalesce, and a burst of 20 receipts becomes one or two transactions. Production would anchor
 * on a schedule (every N minutes or N entries) to bound gas; the local demo anchors right away.
 */

export interface LogHead {
  count: number;
  head: string; // hex, no 0x
}

function anchorDeployment(): (Deployment & { anchor: string }) | null {
  try {
    const d = loadDeployment();
    return d.anchor ? (d as Deployment & { anchor: string }) : null;
  } catch {
    return null;
  }
}

/** Whether this deployment can anchor at all (contract deployed and a key configured). */
export function anchoringEnabled(): boolean {
  return !!anchorDeployment() && !!anchorerPrivateKey();
}

/** Every checkpoint of a log, oldest first; null when the deployment has no anchor contract. */
export async function readCheckpoints(label: string): Promise<Checkpoint[] | null> {
  const d = anchorDeployment();
  if (!d) return null;
  const c = new Contract(d.anchor, RECEIPT_ANCHOR_ABI, provider());
  const logs = await onChain(() => c.queryFilter(c.filters.Anchored!(streamId(label)), d.deployedAtBlock));
  return logs.map((l) => {
    const args = (l as unknown as { args: { count: bigint; head: string } }).args;
    return { count: Number(args.count), head: args.head.slice(2), block: l.blockNumber, tx: l.transactionHash };
  });
}

/** Checks a stored log against its on-chain checkpoints; null when anchoring isn't deployed. */
export async function checkLogAnchors(label: string, rows: { seq: number; hash: string }[]): Promise<AnchorCheck | null> {
  const cps = await readCheckpoints(label);
  return cps ? checkAgainstAnchors(rows, cps) : null;
}

/** Sends one anchor transaction if the log has grown since the last checkpoint. */
async function anchorNow(label: string, h: LogHead): Promise<void> {
  const d = anchorDeployment();
  const key = anchorerPrivateKey();
  if (!d || !key || h.count === 0) return;
  await withAnchorerTxLock(async () => {
    const signer = new Wallet(key, provider());
    const c = new Contract(d.anchor, RECEIPT_ANCHOR_ABI, signer);
    const stream = streamId(label);
    const latest = (await onChain(() => c.getFunction("latest")(stream))) as { count: bigint };
    if (BigInt(h.count) <= latest.count) return; // already covered (another instance anchored it)
    const tx = await onChain(() => c.getFunction("anchor")(stream, h.count, `0x${h.head}`) as Promise<{ wait(): Promise<unknown> }>);
    await onChain(() => tx.wait());
  });
}

const inFlight = new Map<string, Promise<void>>();
const again = new Set<string>();

/**
 * Asks for `label` to be anchored soon. `read` returns the log's current head at send time, so
 * entries appended while a transaction is in flight are picked up by the follow-up run.
 */
export function requestAnchor(label: string, read: () => LogHead | null): void {
  if (!anchoringEnabled()) return;
  if (inFlight.has(label)) {
    again.add(label);
    return;
  }
  const run = (async () => {
    do {
      again.delete(label);
      const h = read();
      if (h) await anchorNow(label, h);
    } while (again.has(label));
  })()
    .catch((e) => console.warn(`anchoring ${label} failed: ${(e as Error).message}`))
    .finally(() => inFlight.delete(label));
  inFlight.set(label, run);
}

/** Waits for every pending anchor (tests, and the dashboard before it reports). */
export async function flushAnchors(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight.values()]);
}
