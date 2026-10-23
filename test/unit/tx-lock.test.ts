import path from "node:path";
import { rmSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { withIssuerLease, withIssuerTxLock } from "@/lib/server/issuer/tx-lock";

/**
 * The issuer key's cross-process lease. Each `withIssuerLease` call acts like a separate
 * process: it has its own owner id and goes through the shared database row only.
 */
beforeAll(() => {
  const dir = path.join(process.cwd(), ".test-data", "tx-lock");
  rmSync(dir, { recursive: true, force: true });
  process.env.DATA_DIR = dir;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("issuer transaction lease", () => {
  it("never lets two holders run at once, even without the in-process queue", async () => {
    let inside = 0;
    let maxInside = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        withIssuerLease(async () => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await sleep(30);
          order.push(i);
          inside--;
        }),
      ),
    );
    expect(maxInside).toBe(1);
    expect(order.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(db().prepare("SELECT COUNT(*) AS n FROM issuer_tx_lease").get()).toEqual({ n: 0 });
  });

  it("releases on failure, and a stale lease from a crashed process expires", async () => {
    await expect(withIssuerLease(async () => Promise.reject(new Error("tx failed")))).rejects.toThrow("tx failed");
    expect(await withIssuerLease(async () => "next one runs")).toBe("next one runs");

    // A process that died while holding the lease: its row stays until it expires.
    db().prepare("INSERT INTO issuer_tx_lease (id, owner, expires_at_ms) VALUES (1, 'crashed', ?)").run(Date.now() + 200);
    const t0 = Date.now();
    expect(await withIssuerLease(async () => "taken over")).toBe("taken over");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
  });

  it("withIssuerTxLock combines the in-process queue with the lease", async () => {
    const seen: string[] = [];
    await Promise.all(["a", "b", "c"].map((x) => withIssuerTxLock(async () => {
      seen.push(`${x}+`);
      await sleep(10);
      seen.push(`${x}-`);
    })));
    expect(seen).toEqual(["a+", "a-", "b+", "b-", "c+", "c-"]);
  });
});
