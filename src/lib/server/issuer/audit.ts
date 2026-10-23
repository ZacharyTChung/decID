import "server-only";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { db, nowSeconds } from "../db";

/**
 * Tamper-evident issuer audit log: an append-only hash chain in SQLite.
 *
 *   hash_n = SHA-256( hash_{n-1} || canonicalJSON({ seq, at, actor, action, subject, details }) )
 *   hash_0's predecessor is 64 zero hex digits.
 *
 * Editing, reordering or deleting any entry breaks every later link, and verifyAuditChain()
 * reports the first broken sequence number. Truncating the newest entries is NOT detectable
 * from the chain alone; publish or store the head hash elsewhere (e.g. `npm run audit-log -- head`)
 * to detect that too.
 *
 * Entries hold pseudonymous identifiers (holder DID, commitment, request id) and operator
 * addresses, never synthetic application data, tokens or salts.
 */

export const AUDIT_GENESIS = "0".repeat(64);

export type AuditAction =
  | "request.rejected"
  | "credential.issued"
  | "credential.revoked"
  | "credential.superseded";

export interface AuditEntry {
  seq: number;
  at: number;
  actor: string;
  action: AuditAction;
  subject: string;
  details: Record<string, string | number | boolean | null>;
  prevHash: string;
  hash: string;
}

/** JSON with object keys sorted at every level, so the hash input is byte-for-byte reproducible. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function entryHash(prevHash: string, e: Pick<AuditEntry, "seq" | "at" | "actor" | "action" | "subject" | "details">): string {
  const body = canonicalJson({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, subject: e.subject, details: e.details });
  return createHash("sha256").update(prevHash).update(body).digest("hex");
}

export function ensureAuditTable(d: Database.Database): void {
  d.exec(`CREATE TABLE IF NOT EXISTS issuer_audit (
    seq        INTEGER PRIMARY KEY,
    at         INTEGER NOT NULL,
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    subject    TEXT NOT NULL,
    details    TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
  )`);
}

/** Appends one entry atomically (inside an immediate transaction, so concurrent appends cannot fork the chain). */
export function appendAudit(actor: string, action: AuditAction, subject: string, details: AuditEntry["details"] = {}): AuditEntry {
  const d = db();
  ensureAuditTable(d);
  return d.transaction(() => {
    const last = d.prepare("SELECT seq, hash FROM issuer_audit ORDER BY seq DESC LIMIT 1").get() as { seq: number; hash: string } | undefined;
    const entry = { seq: (last?.seq ?? 0) + 1, at: nowSeconds(), actor, action, subject, details };
    const prevHash = last?.hash ?? AUDIT_GENESIS;
    const hash = entryHash(prevHash, entry);
    d.prepare("INSERT INTO issuer_audit (seq, at, actor, action, subject, details, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      entry.seq,
      entry.at,
      actor,
      action,
      subject,
      canonicalJson(details),
      prevHash,
      hash,
    );
    return { ...entry, prevHash, hash };
  }).immediate();
}

function rows(d: Database.Database): AuditEntry[] {
  ensureAuditTable(d);
  return (d.prepare("SELECT * FROM issuer_audit ORDER BY seq").all() as {
    seq: number;
    at: number;
    actor: string;
    action: AuditAction;
    subject: string;
    details: string;
    prev_hash: string;
    hash: string;
  }[]).map((r) => ({ seq: r.seq, at: r.at, actor: r.actor, action: r.action, subject: r.subject, details: JSON.parse(r.details), prevHash: r.prev_hash, hash: r.hash }));
}

export function listAudit(limit = 50): AuditEntry[] {
  return rows(db()).slice(-limit).reverse();
}

export interface AuditVerification {
  ok: boolean;
  entries: number;
  head: string;
  firstBrokenSeq?: number;
  problem?: string;
}

/** Recomputes the whole chain. Detects edits, reordering and deletions anywhere but the tail. */
export function verifyAuditChain(d: Database.Database = db()): AuditVerification {
  const all = rows(d);
  let prev = AUDIT_GENESIS;
  for (let i = 0; i < all.length; i++) {
    const e = all[i]!;
    if (e.seq !== i + 1) return { ok: false, entries: all.length, head: prev, firstBrokenSeq: e.seq, problem: `sequence gap: expected ${i + 1}, found ${e.seq}` };
    if (e.prevHash !== prev) return { ok: false, entries: all.length, head: prev, firstBrokenSeq: e.seq, problem: "link to previous entry broken" };
    if (entryHash(prev, e) !== e.hash) return { ok: false, entries: all.length, head: prev, firstBrokenSeq: e.seq, problem: "entry content does not match its hash" };
    prev = e.hash;
  }
  return { ok: true, entries: all.length, head: prev };
}
