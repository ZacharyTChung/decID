/**
 * npm run audit-log -- <verify|head|list> [--json]
 *
 *   verify  recompute the issuer audit hash chain; exit 0 if intact, 2 if tampered
 *   head    print the current head hash and entry count. Record it somewhere the issuer
 *           database cannot reach (a ticket, a signed message, a public post): a later
 *           `verify` plus a matching earlier head proves nothing was edited, removed or
 *           truncated in between.
 *   list    print the newest entries
 *
 * Reads DATA_DIR (default .data). Needs no keys.
 */
const [command = "verify", ...rest] = process.argv.slice(2);
const asJson = rest.includes("--json");

async function main(): Promise<number> {
  const { listAudit, verifyAuditChain } = await import("../src/lib/server/issuer/audit");
  const v = verifyAuditChain();
  if (command === "verify") {
    if (asJson) console.log(JSON.stringify(v, null, 2));
    else if (v.ok) console.log(`audit chain intact: ${v.entries} entries, head ${v.head}`);
    else console.log(`AUDIT CHAIN BROKEN at entry ${v.firstBrokenSeq}: ${v.problem}`);
    return v.ok ? 0 : 2;
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
