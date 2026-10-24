/**
 * npm run verify-receipts -- <export.json> [--jwks-url <url>] [--rpc <url>] [--json]
 *
 * The auditor's check of a business's decID compliance receipts (Business dashboard → Receipts →
 * Export for auditor). It uses only:
 *   - the export file,
 *   - decID's published receipt keys (--jwks-url, e.g. https://<decid>/api/v1/receipt-keys; without
 *     it, the keys inside the file are used and a warning is printed),
 *   - read access to the chain that holds the ReceiptAnchor checkpoints (--rpc, default RPC_URL or
 *     http://127.0.0.1:8545).
 * No decID or business database, no API key. Exit 0 if every check holds, 2 if not, 1 on usage errors.
 */
import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider } from "ethers";
import { RECEIPT_ANCHOR_ABI } from "../src/generated/contracts";
import { streamId, type Checkpoint } from "../src/lib/shared/anchor-check";
import { verifyExport, type ReceiptExport } from "../src/lib/shared/receipt-export";
import type { ReceiptJwks } from "../src/lib/shared/receipt-chain";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && !["--jwks-url", "--rpc"].includes(args[i - 1] ?? ""));
const asJson = args.includes("--json");

async function main(): Promise<number> {
  if (!file) {
    console.error("usage: npm run verify-receipts -- <export.json> [--jwks-url <url>] [--rpc <url>] [--json]");
    return 1;
  }
  const exp = JSON.parse(readFileSync(file, "utf8")) as ReceiptExport;
  const notes: string[] = [];

  let keys: ReceiptJwks = exp.receiptKeys;
  const jwksUrl = opt("--jwks-url");
  if (jwksUrl) keys = (await (await fetch(jwksUrl)).json()) as ReceiptJwks;
  else notes.push("Using the receipt keys inside the file. Pass --jwks-url with decID's published keys for an independent check.");

  let checkpoints: Checkpoint[] | null = null;
  if (exp.anchor) {
    if (streamId(exp.anchor.stream) !== exp.anchor.streamId) throw new Error("the export's stream id doesn't match its stream label");
    const provider = new JsonRpcProvider(opt("--rpc") ?? process.env.RPC_URL ?? "http://127.0.0.1:8545", undefined, { cacheTimeout: -1 });
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== exp.anchor.chainId) throw new Error(`the RPC serves chain ${net.chainId}, the export was anchored on chain ${exp.anchor.chainId}`);
    const c = new Contract(exp.anchor.contract, RECEIPT_ANCHOR_ABI, provider);
    const logs = await c.queryFilter(c.filters.Anchored!(exp.anchor.streamId), 0);
    checkpoints = logs.map((l) => {
      const a = (l as unknown as { args: { count: bigint; head: string } }).args;
      return { count: Number(a.count), head: a.head.slice(2), block: l.blockNumber, tx: l.transactionHash };
    });
    provider.destroy();
  } else {
    notes.push("The export names no anchor contract, so only signatures and links were checked.");
  }

  const r = await verifyExport(exp, keys, checkpoints);
  if (asJson) {
    console.log(JSON.stringify({ ...r, notes }, null, 2));
  } else {
    console.log(`decID receipts for ${exp.merchant.name} (${exp.merchant.id}), exported ${exp.exportedAt}`);
    console.log(`  receipts            ${r.receipts}  (${r.outcomes.satisfied} passed, ${r.outcomes.notSatisfied} refused${Object.keys(r.outcomes.byFailure).length ? `: ${Object.entries(r.outcomes.byFailure).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""})`);
    console.log(`  signatures & links  ${r.chain.ok ? "valid" : `BROKEN at receipt ${r.chain.firstBrokenSeq}: ${r.chain.problem}`}`);
    if (r.anchor) console.log(`  on-chain anchor     ${r.anchor.ok ? `matches ${r.anchor.checkpoints} checkpoint(s), ${r.anchor.anchoredCount} anchored, ${r.anchor.unanchored} newer` : `MISMATCH: ${r.anchor.problem}`}`);
    for (const n of notes) console.log(`  note: ${n}`);
    console.log(r.ok ? "\n✔ RECEIPTS VERIFIED" : "\n✘ RECEIPTS DO NOT VERIFY");
  }
  return r.ok ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`verify-receipts: ${(e as Error).message}`);
    process.exit(1);
  });
