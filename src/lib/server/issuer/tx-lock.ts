import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { ApiError } from "../http";

/**
 * Serializes transactions from the issuer's EVM key. Two in-flight sends from one account
 * race for the same nonce, and one of them fails. An evaluation probe confirmed this: two app
 * instances sharing the database revoked concurrently, and 2 of 4 revocations failed.
 *
 * Two layers:
 *  1. an in-process queue, so one instance never contends with itself;
 *  2. a lease row in the shared SQLite database, so separate processes take turns. The lease
 *     expires on its own, so a crashed holder blocks others for at most LEASE_MS.
 *
 * This covers app instances that share one database file (one host). Instances on several
 * hosts would need the same lease in a shared database, or a dedicated signer service.
 */

const LEASE_MS = 120_000; // longer than any transaction wait we allow
const ACQUIRE_TIMEOUT_MS = 30_000;
const POLL_MS = 50;

let queue: Promise<unknown> = Promise.resolve();

function tryAcquire(owner: string, now: number): boolean {
  const res = db()
    .prepare(
      `INSERT INTO issuer_tx_lease (id, owner, expires_at_ms) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at_ms = excluded.expires_at_ms
       WHERE issuer_tx_lease.expires_at_ms < ?`,
    )
    .run(owner, now + LEASE_MS, now);
  return res.changes === 1;
}

function release(owner: string): void {
  db().prepare("DELETE FROM issuer_tx_lease WHERE id = 1 AND owner = ?").run(owner);
}

export async function withIssuerLease<T>(fn: () => Promise<T>): Promise<T> {
  const owner = randomUUID();
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (!tryAcquire(owner, Date.now())) {
    if (Date.now() > deadline) throw new ApiError(503, "ISSUER_BUSY", "another issuer transaction is still in progress; try again");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    return await fn();
  } finally {
    release(owner);
  }
}

/** Runs `fn` while holding both the in-process turn and the cross-process lease. */
export function withIssuerTxLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(() => withIssuerLease(fn), () => withIssuerLease(fn));
  queue = run.catch(() => undefined);
  return run;
}
