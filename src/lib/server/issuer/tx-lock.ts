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

/** One lease table per signing key that sends transactions (fixed names, never user input). */
const LEASE = { issuer: "issuer_tx_lease", anchorer: "anchor_tx_lease" } as const;
type LeaseTable = (typeof LEASE)[keyof typeof LEASE];
const queues = new Map<LeaseTable, Promise<unknown>>();

function tryAcquire(owner: string, now: number, table: LeaseTable): boolean {
  const res = db()
    .prepare(
      `INSERT INTO ${table} (id, owner, expires_at_ms) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at_ms = excluded.expires_at_ms
       WHERE ${table}.expires_at_ms < ?`,
    )
    .run(owner, now + LEASE_MS, now);
  return res.changes === 1;
}

function release(owner: string, table: LeaseTable): void {
  db().prepare(`DELETE FROM ${table} WHERE id = 1 AND owner = ?`).run(owner);
}

async function withLease<T>(id: LeaseTable, fn: () => Promise<T>): Promise<T> {
  const owner = randomUUID();
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (!tryAcquire(owner, Date.now(), id)) {
    if (Date.now() > deadline) throw new ApiError(503, "ISSUER_BUSY", "another transaction from this key is still in progress; try again");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    return await fn();
  } finally {
    release(owner, id);
  }
}

export function withIssuerLease<T>(fn: () => Promise<T>): Promise<T> {
  return withLease(LEASE.issuer, fn);
}

function withTxLock<T>(id: LeaseTable, fn: () => Promise<T>): Promise<T> {
  const queue = queues.get(id) ?? Promise.resolve();
  const run = queue.then(() => withLease(id, fn), () => withLease(id, fn));
  queues.set(id, run.catch(() => undefined));
  return run;
}

/** Runs `fn` while holding both the in-process turn and the cross-process lease for the issuer key. */
export function withIssuerTxLock<T>(fn: () => Promise<T>): Promise<T> {
  return withTxLock(LEASE.issuer, fn);
}

/** The same, for the anchorer key (src/lib/server/anchor.ts). */
export function withAnchorerTxLock<T>(fn: () => Promise<T>): Promise<T> {
  return withTxLock(LEASE.anchorer, fn);
}
