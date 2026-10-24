/**
 * npm run audit-log -- <verify|head|list> [--json]
 *
 *   verify  recompute the issuer audit hash chain and compare it with its on-chain checkpoints
 *           (ReceiptAnchor); exit 0 if both hold, 2 if tampered. The checkpoints catch what the
 *           chain alone can't: the newest entries removed, or history re-hashed by an operator.
 *   head    print the current head hash and entry count (for recording outside the system).
 *   list    print the newest entries
 *
 * Reads DATA_DIR (default .data), and the deployment and RPC_URL for the on-chain check. Needs no keys.
 */
const [command = "verify", ...rest] = process.argv.slice(2);
const asJson = rest.includes("--json");

async function main(): Promise<number> {
  const { listAudit, verifyAuditChain, verifyAuditChainAnchored } = await import("../src/lib/server/issuer/audit");
  const v = verifyAuditChain();
  if (command === "verify") {
    const a = (await verifyAuditChainAnchored()).anchor;
    const anchorOk = !a || "unavailable" in a || a.ok;
    if (asJson) console.log(JSON.stringify({ ...v, anchor: a }, null, 2));
    else {
      console.log(v.ok ? `audit chain intact: ${v.entries} entries, head ${v.head}` : `AUDIT CHAIN BROKEN at entry ${v.firstBrokenSeq}: ${v.problem}`);
      if (!a) console.log("on-chain anchor: not deployed for this network");
      else if ("unavailable" in a) console.log("on-chain anchor: chain unreachable, not compared");
      else console.log(a.ok ? `on-chain anchor: matches (${a.anchoredCount} anchored, ${a.unanchored} pending)` : `ON-CHAIN ANCHOR MISMATCH: ${a.problem}`);
    }
    return v.ok && anchorOk ? 0 : 2;
  }
  if (command === "head") {
    console.log(asJson ? JSON.stringify({ entries: v.entries, head: v.head, ok: v.ok }) : `${v.entries} ${v.head}`);
    return v.ok ? 0 : 2;
  }
  if (command === "list") {
    const entries = listAudit(Number(rest.find((a) => /^\d+$/.test(a)) ?? 20));
    if (asJson) console.log(JSON.stringify(entries, null, 2));
    else for (const e of entries) console.log(`#${e.seq} ${new Date(e.at * 1000).toISOString()} ${e.action} ${e.subject} by ${e.actor} ${JSON.stringify(e.details)}`);
    return 0;
  }
  console.error("usage: npm run audit-log -- <verify|head|list> [--json]");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
