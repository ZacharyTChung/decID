import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

/**
 * Local SQLite persistence. Tables are grouped by trust domain:
 *
 *   auth_*      wallet sign-in nonces and sessions (shared auth module)
 *   issuer_*    synthetic applications, issuance log, one-time bundle pickup
 *   verifier_*  presentation challenges (no tokens or salts are ever stored)
 *   rate_limits basic abuse protection
 *
 * Retention: synthetic application fields are erased as soon as the issuer
 * decides; undelivered bundles expire after BUNDLE_PICKUP_TTL and delivered
 * ones are deleted at pickup. See docs/ARCHITECTURE.md for the full table.
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS auth_nonces;      -- replaced by auth_challenges (binds the exact message)
CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce         TEXT PRIMARY KEY,
  message_hash  TEXT NOT NULL,         -- sha256 of the exact SIWE message the server prepared
  expires_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash     TEXT PRIMARY KEY,        -- sha256 of the cookie value; the raw value is never stored
  address     TEXT NOT NULL,           -- EIP-55 checksummed
  chain_id    INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('holder', 'issuer')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issuer_requests (
  id              TEXT PRIMARY KEY,
  holder_address  TEXT NOT NULL,
  holder_did      TEXT NOT NULL,
  chain_id        INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  synthetic_json  TEXT,                -- synthetic application data; NULL once reviewed
  reject_reason   TEXT,
  created_at      INTEGER NOT NULL,
  reviewed_at     INTEGER,
  reviewed_by     TEXT
);
CREATE INDEX IF NOT EXISTS issuer_requests_holder ON issuer_requests(holder_address);

CREATE TABLE IF NOT EXISTS issuer_credentials (
  commitment      TEXT PRIMARY KEY,    -- public value (also on-chain once registered)
  request_id      TEXT NOT NULL UNIQUE REFERENCES issuer_requests(id),
  credential_id   TEXT NOT NULL UNIQUE,
  holder_address  TEXT NOT NULL,
  holder_did      TEXT NOT NULL,
  valid_from      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  issued_at       INTEGER NOT NULL,
  revoked_at      INTEGER,
  revoke_tx       TEXT
);

CREATE TABLE IF NOT EXISTS issuer_bundle_pickup (
  request_id      TEXT PRIMARY KEY REFERENCES issuer_requests(id),
  holder_address  TEXT NOT NULL,
  bundle_json     TEXT NOT NULL,       -- private bundle awaiting one-time pickup
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verifier_challenges (
  id           TEXT PRIMARY KEY,
  nonce        TEXT NOT NULL UNIQUE,   -- 32 random bytes, 0x-hex
  action       TEXT NOT NULL,
  audience     TEXT NOT NULL,
  chain_id     INTEGER NOT NULL,
  registry     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  outcome      TEXT                    -- 'verified' | failure code; no credential data
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket        TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
`;

let instance: { file: string; db: Database.Database } | undefined;

export function db(): Database.Database {
  const file = path.join(dataDir(), "app.sqlite");
  if (!instance || instance.file !== file) {
    instance?.db.close();
    mkdirSync(path.dirname(file), { recursive: true });
    const d = new Database(file);
    d.exec(SCHEMA);
    instance = { file, db: d };
  }
  return instance.db;
}

export function closeDb(): void {
  instance?.db.close();
  instance = undefined;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Deletes expired auth, challenge, pickup and rate-limit rows. Cheap; called opportunistically. */
export function purgeExpired(now = nowSeconds()): void {
  const d = db();
  d.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").run(now);
  d.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  d.prepare("DELETE FROM issuer_bundle_pickup WHERE expires_at <= ?").run(now);
  // Keep consumed/expired challenge rows for one hour as an audit trail (no credential data in them).
  d.prepare("DELETE FROM verifier_challenges WHERE expires_at <= ?").run(now - 3600);
  d.prepare("DELETE FROM rate_limits WHERE window_start <= ?").run(now - 3600);
}
