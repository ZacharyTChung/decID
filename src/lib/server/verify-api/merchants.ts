import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { appConfig } from "../config";
import { db, nowSeconds } from "../db";
import { ApiError } from "../errors";

/**
 * Businesses ("merchants") that use decID Verify. They authenticate API calls with a secret
 * key, which is shown once at creation and stored only as a SHA-256 hash. The dashboard uses a
 * separate HttpOnly session cookie obtained by presenting the key once.
 */

export interface Merchant {
  id: string;
  name: string;
  kind: "online" | "venue";
  keyPrefix: string;
  createdAt: number;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const KEY_RE = /^dk_test_[A-Za-z0-9_-]{43}$/;
export const BUSINESS_COOKIE = "decid_biz";
const BUSINESS_SESSION_TTL = 8 * 60 * 60;

export function newApiKey(): string {
  return `dk_test_${randomBytes(32).toString("base64url")}`;
}

function row(r: { id: string; name: string; kind: string; key_prefix: string; created_at: number }): Merchant {
  return { id: r.id, name: r.name, kind: r.kind as Merchant["kind"], keyPrefix: r.key_prefix, createdAt: r.created_at };
}

/** Registers a merchant with the given key (or a new one). Returns the key: shown once, never stored. */
export function createMerchant(m: { id: string; name: string; kind: Merchant["kind"]; apiKey?: string }): { merchant: Merchant; apiKey: string } {
  if (!/^[a-z0-9-]{2,40}$/.test(m.id)) throw new ApiError(400, "BAD_MERCHANT_ID", "merchant id must be 2-40 lowercase letters, digits or dashes");
  const apiKey = m.apiKey ?? newApiKey();
  if (!KEY_RE.test(apiKey)) throw new ApiError(400, "BAD_API_KEY", "API keys look like dk_test_<43 base64url characters>");
  db()
    .prepare("INSERT INTO verify_merchants (id, name, kind, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(m.id, m.name, m.kind, hash(apiKey), apiKey.slice(0, 12), nowSeconds());
  return { merchant: getMerchant(m.id)!, apiKey };
}

/** Idempotent registration for the demo businesses, whose keys come from the environment. */
export function ensureMerchant(m: { id: string; name: string; kind: Merchant["kind"]; apiKey: string }): Merchant {
  const existing = db().prepare("SELECT id, key_hash FROM verify_merchants WHERE id = ?").get(m.id) as { id: string; key_hash: string } | undefined;
  if (!existing) return createMerchant(m).merchant;
  if (existing.key_hash !== hash(m.apiKey)) {
    db().prepare("UPDATE verify_merchants SET key_hash = ?, key_prefix = ?, name = ?, kind = ? WHERE id = ?").run(hash(m.apiKey), m.apiKey.slice(0, 12), m.name, m.kind, m.id);
  }
  return getMerchant(m.id)!;
}

export function getMerchant(id: string): Merchant | undefined {
  const r = db().prepare("SELECT id, name, kind, key_prefix, created_at FROM verify_merchants WHERE id = ?").get(id) as Parameters<typeof row>[0] | undefined;
  return r ? row(r) : undefined;
}

export function merchantByKey(apiKey: string): Merchant | undefined {
  if (!KEY_RE.test(apiKey)) return undefined;
  const r = db().prepare("SELECT id, name, kind, key_prefix, created_at FROM verify_merchants WHERE key_hash = ?").get(hash(apiKey)) as Parameters<typeof row>[0] | undefined;
  return r ? row(r) : undefined;
}

/** Authorization: Bearer dk_test_… → the merchant, or 401. */
export function requireMerchant(req: Request): Merchant {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") ?? "");
  const merchant = m ? merchantByKey(m[1]!) : undefined;
  if (!merchant) throw new ApiError(401, "INVALID_API_KEY", "missing or invalid API key");
  return merchant;
}

// ---------------------------------------------------------------- dashboard sessions

export function createBusinessSession(merchantId: string): string {
  const id = randomBytes(32).toString("base64url");
  db().prepare("INSERT INTO business_sessions (id_hash, merchant_id, expires_at) VALUES (?, ?, ?)").run(hash(id), merchantId, nowSeconds() + BUSINESS_SESSION_TTL);
  const secure = appConfig().origin.startsWith("https:") ? "; Secure" : "";
  return `${BUSINESS_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${BUSINESS_SESSION_TTL}${secure}`;
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function requireBusiness(req: Request): Merchant {
  const id = cookieValue(req, BUSINESS_COOKIE);
  const r = id
    ? (db().prepare("SELECT merchant_id FROM business_sessions WHERE id_hash = ? AND expires_at > ?").get(hash(id), nowSeconds()) as { merchant_id: string } | undefined)
    : undefined;
  const merchant = r ? getMerchant(r.merchant_id) : undefined;
  if (!merchant) throw new ApiError(401, "NO_BUSINESS_SESSION", "sign in to the business dashboard");
  return merchant;
}

export function endBusinessSession(req: Request): string {
  const id = cookieValue(req, BUSINESS_COOKIE);
  if (id) db().prepare("DELETE FROM business_sessions WHERE id_hash = ?").run(hash(id));
  return `${BUSINESS_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
