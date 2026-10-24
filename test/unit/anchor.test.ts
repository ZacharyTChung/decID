import path from "node:path";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider } from "ethers";
import { RECEIPT_ANCHOR_ABI } from "@/generated/contracts";
import { db } from "@/lib/server/db";
import { loadDeployment } from "@/lib/server/chain";
import { flushAnchors, readCheckpoints } from "@/lib/server/anchor";
import { createMerchant } from "@/lib/server/verify-api/merchants";
import { appendReceipt, receiptJwks, verifyReceiptChainAnchored } from "@/lib/server/verify-api/receipts";
import { appendAuditAnchored, verifyAuditChainAnchored } from "@/lib/server/issuer/audit";
import { verifyReceiptKey } from "@/lib/server/config";
import { GENESIS, sha256Hex, signReceipt, type Receipt } from "@/lib/shared/receipt-chain";
import { checkAgainstAnchors, receiptStream, streamId } from "@/lib/shared/anchor-check";
import { calculateJwkThumbprint, importJWK } from "jose";

/**
 * On-chain anchoring of the receipt chains and the issuer audit log, on the test chain. The two
 * attacks a hash chain alone can't catch (an operator re-signing history; the newest entries
 * being dropped) are caught by comparing the stored log with its on-chain checkpoints.
 */

const DATA = path.join(process.cwd(), ".test-data", "anchor");
const body = (sid: string, merchant: string, outcome: "satisfied" | "not_satisfied" = "satisfied") => ({
  sid,
  merchant,
  ref: null,
  policy: "age_over_21",
  outcome,
  failureCode: outcome === "satisfied" ? null : "POLICY_NOT_SATISFIED",
  issuer: null,
  registry: { chainId: 31337, address: "0x0000000000000000000000000000000000000001", status: "Active" },
  evidence: "0".repeat(64),
  checkedAt: new Date().toISOString(),
});

// Test files share one chain but not one database: give this file's streams their own namespace.
const NS = `test-${Date.now()}`;
beforeAll(() => {
  rmSync(DATA, { recursive: true, force: true });
  process.env.DATA_DIR = DATA;
  process.env.ANCHOR_NAMESPACE = NS;
});
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

describe("anchoring logs on-chain", () => {
  it("is deployed with an anchorer role held by the configured key", async () => {
    const d = loadDeployment();
    expect(d.anchor).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const c = new Contract(d.anchor!, RECEIPT_ANCHOR_ABI, new JsonRpcProvider(process.env.RPC_URL));
    expect(await c.getFunction("hasRole")(await c.getFunction("ANCHORER_ROLE")(), d.anchorer)).toBe(true);
  });

  it("anchors a business's receipts in the background, coalescing bursts", async () => {
    createMerchant({ id: "anchor-shop", name: "Anchor Shop", kind: "online" });
    for (let i = 0; i < 6; i++) await appendReceipt("anchor-shop", body(`s${i}`, "anchor-shop"));
    await flushAnchors();
    const cps = (await readCheckpoints(receiptStream("anchor-shop", NS)))!;
    expect(cps.at(-1)!.count).toBe(6);
    expect(cps.length).toBeLessThan(6); // a burst of six receipts took fewer than six transactions
    const v = await verifyReceiptChainAnchored("anchor-shop");
    expect(v.ok).toBe(true);
    expect(v.anchor).toMatchObject({ ok: true, anchoredCount: 6, unanchored: 0 });
  });

  it("catches the operator re-signing history, which the hash chain alone accepts", async () => {
    // The operator holds the real receipt key: flip receipt 2's outcome, re-sign it, and re-chain
    // every later receipt so all signatures and links verify again.
    const jwk = verifyReceiptKey();
    const key = await importJWK(jwk, "Ed25519");
    const kid = await calculateJwkThumbprint({ kty: jwk.kty, crv: jwk.crv, x: jwk.x });
    const rows = db().prepare("SELECT seq, jws FROM verify_receipts WHERE merchant_id = 'anchor-shop' ORDER BY seq").all() as { seq: number; jws: string }[];
    let prev = GENESIS;
    for (const r of rows) {
      const payload = JSON.parse(Buffer.from(r.jws.split(".")[1]!, "base64url").toString()) as Receipt;
      if (r.seq === 2) Object.assign(payload, { outcome: "not_satisfied", failureCode: "POLICY_NOT_SATISFIED" });
      payload.prev = prev;
      const jws = await signReceipt(payload, key, kid);
      db().prepare("UPDATE verify_receipts SET jws = ?, hash = ?, prev_hash = ? WHERE merchant_id = 'anchor-shop' AND seq = ?").run(jws, sha256Hex(jws), prev, r.seq);
      prev = sha256Hex(jws);
    }
    const v = await verifyReceiptChainAnchored("anchor-shop");
    expect(v.ok).toBe(true); // signatures and links are all valid again…
    // …but the chain remembers. The first checkpoint at or after receipt 2 no longer matches
    // (bursts are anchored as fewer checkpoints, so it may be a later one).
    expect(v.anchor).toMatchObject({ ok: false });
    expect((v.anchor as { brokenAt: number }).brokenAt).toBeGreaterThanOrEqual(2);
    expect((v.anchor as { problem: string }).problem).toMatch(/differs from the hash anchored on-chain/);
    expect(await receiptJwks()).toBeTruthy();
  });

  it("catches the newest receipts being dropped", async () => {
    createMerchant({ id: "anchor-venue", name: "Anchor Venue", kind: "venue" });
    for (let i = 0; i < 4; i++) await appendReceipt("anchor-venue", body(`v${i}`, "anchor-venue", i === 3 ? "not_satisfied" : "satisfied"));
    await flushAnchors();
    db().prepare("DELETE FROM verify_receipts WHERE merchant_id = 'anchor-venue' AND seq = 4").run();
    const v = await verifyReceiptChainAnchored("anchor-venue");
    expect(v.ok).toBe(true); // a shorter chain is still a valid chain…
    expect(v.anchor).toMatchObject({ ok: false }); // …but 4 were anchored
    expect((v.anchor as { problem: string }).problem).toMatch(/entries were removed: 4 were anchored on-chain, 3 remain/);
  });

  it("anchors the issuer audit log too, closing its documented tail-truncation gap", async () => {
    for (let i = 0; i < 3; i++) appendAuditAnchored("0x0000000000000000000000000000000000000002", "request.rejected", `req-${i}`, { reason: "test" });
    await flushAnchors();
    const v = await verifyAuditChainAnchored();
    expect(v.ok).toBe(true);
    expect(v.anchor).toMatchObject({ ok: true, anchoredCount: 3 });
    db().prepare("DELETE FROM issuer_audit WHERE seq = 3").run();
    const after = await verifyAuditChainAnchored();
    expect(after.ok).toBe(true);
    expect(after.anchor).toMatchObject({ ok: false });
  });

  it("the pure comparison handles gaps between checkpoints and pending entries", () => {
    const rows = [1, 2, 3, 4, 5].map((seq) => ({ seq, hash: `${seq}`.repeat(64).slice(0, 64) }));
    const cp = (count: number) => ({ count, head: rows[count - 1]!.hash });
    expect(checkAgainstAnchors(rows, [cp(2), cp(4)])).toMatchObject({ ok: true, anchoredCount: 4, unanchored: 1, checkpoints: 2 });
    expect(checkAgainstAnchors(rows, [])).toMatchObject({ ok: true, anchoredCount: 0, unanchored: 5 });
    expect(checkAgainstAnchors(rows, [{ count: 3, head: "f".repeat(64) }])).toMatchObject({ ok: false, brokenAt: 3 });
    expect(streamId("decid:receipts:x")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
