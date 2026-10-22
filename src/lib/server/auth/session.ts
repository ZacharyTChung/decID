import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getAddress } from "ethers";
import { SiweMessage } from "siwe";
import { appConfig, issuerOperatorAddresses } from "../config";
import { loadDeployment, provider } from "../chain";
import { db, nowSeconds } from "../db";
import { ApiError, readCookie } from "../http";

/**
 * Wallet sign-in with ERC-4361 (Sign-In with Ethereum) using the `siwe` library,
 * backed by server-side sessions in SQLite.
 *
 * - The server issues a single-use nonce (5 min) and prepares the exact SIWE
 *   message, so domain, URI, chain id and expiry are server-chosen.
 * - Verification consumes the nonce atomically before checking the signature.
 * - The session cookie is a random 256-bit value. Only its SHA-256 is stored.
 *   It is HttpOnly and SameSite=Strict, and lives for one hour.
 * - The role is fixed at sign-in. `issuer` requires the address to be in
 *   ISSUER_OPERATOR_ADDRESSES; the UI cannot grant it.
 *
 * Sign-in proves wallet control for this app session only. It is NOT consent
 * to present a credential; presentations use a separate per-challenge proof.
 */

export type Role = "holder" | "issuer";
export const SESSION_COOKIE = "did_mvp_sid";
const NONCE_TTL = 5 * 60;
const SESSION_TTL = 60 * 60;

export interface Session {
  address: string;
  chainId: number;
  role: Role;
  expiresAt: number;
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function checksummed(address: string): string {
  try {
    return getAddress(address);
  } catch {
    throw new ApiError(400, "BAD_ADDRESS", "address has an invalid EIP-55 checksum");
  }
}

export function createSignInMessage(rawAddress: string, chainId: number, role: Role): string {
  const address = checksummed(rawAddress);
  const cfg = appConfig();
  const deployment = loadDeployment();
  if (chainId !== deployment.chainId) {
    throw new ApiError(400, "WRONG_CHAIN", `wallet is on chain ${chainId}; this app uses chain ${deployment.chainId}`);
  }
  if (role === "issuer" && !issuerOperatorAddresses().includes(address.toLowerCase())) {
    throw new ApiError(403, "NOT_ISSUER_OPERATOR", "this wallet is not an authorized issuer operator");
  }
  const nonce = randomBytes(16).toString("hex");
  const now = nowSeconds();
  const message = new SiweMessage({
    scheme: new URL(cfg.origin).protocol.replace(":", ""),
    domain: cfg.domain,
    address,
    statement: `Sign in to the Decentralized Identity MVP as ${role}. This does not authorize any transaction or credential presentation.`,
    uri: cfg.origin,
    version: "1",
    chainId,
    nonce,
    issuedAt: new Date(now * 1000).toISOString(),
    expirationTime: new Date((now + NONCE_TTL) * 1000).toISOString(),
    resources: [`${cfg.origin}/roles/${role}`],
  });
  const prepared = message.prepareMessage();
  // Bind the nonce to the exact text, so the client cannot sign an edited variant
  // (e.g. without the expiration time or with a different statement).
  db()
    .prepare("INSERT INTO auth_challenges (nonce, message_hash, expires_at) VALUES (?, ?, ?)")
    .run(nonce, hashId(prepared), now + NONCE_TTL);
  return prepared;
}

export async function verifySignIn(messageText: string, signature: string): Promise<{ session: Session; cookie: string }> {
  const cfg = appConfig();
  let message: SiweMessage;
  try {
    message = new SiweMessage(messageText);
  } catch {
    throw new ApiError(400, "BAD_SIWE_MESSAGE", "malformed sign-in message");
  }
  // Consume the nonce first, atomically: a nonce can back at most one verification attempt.
  const consumed = db()
    .prepare("DELETE FROM auth_challenges WHERE nonce = ? AND expires_at > ? RETURNING message_hash")
    .get(message.nonce, nowSeconds()) as { message_hash: string } | undefined;
  if (!consumed) throw new ApiError(401, "NONCE_INVALID", "sign-in nonce is unknown, used or expired");
  if (consumed.message_hash !== hashId(messageText)) {
    throw new ApiError(401, "SIWE_MESSAGE_ALTERED", "the signed message differs from the one this server issued");
  }

  const result = await message.verify(
    { signature, domain: cfg.domain, nonce: message.nonce, scheme: new URL(cfg.origin).protocol.replace(":", "") },
    // With a provider, siwe falls back to EIP-1271 (isValidSignature on the EIP-191 hash) when the
    // signature does not recover to the message address, so contract wallets can sign in.
    { suppressExceptions: true, provider: provider() as never },
  );
  if (!result.success) throw new ApiError(401, "SIWE_INVALID", "sign-in signature or message did not verify");
  if (message.uri !== cfg.origin) throw new ApiError(401, "SIWE_INVALID", "sign-in URI mismatch");
  const deployment = loadDeployment();
  if (message.chainId !== deployment.chainId) throw new ApiError(401, "WRONG_CHAIN", "sign-in chain mismatch");

  const roleResource = (message.resources ?? []).find((r) => r.startsWith(`${cfg.origin}/roles/`));
  const role = roleResource?.slice(`${cfg.origin}/roles/`.length);
  if (role !== "holder" && role !== "issuer") throw new ApiError(400, "BAD_ROLE", "unknown role");
  const address = getAddress(message.address);
  if (role === "issuer" && !issuerOperatorAddresses().includes(address.toLowerCase())) {
    throw new ApiError(403, "NOT_ISSUER_OPERATOR", "this wallet is not an authorized issuer operator");
  }

  const id = randomBytes(32).toString("base64url");
  const now = nowSeconds();
  const session: Session = { address, chainId: message.chainId, role, expiresAt: now + SESSION_TTL };
  db()
    .prepare("INSERT INTO auth_sessions (id_hash, address, chain_id, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(hashId(id), address, session.chainId, role, now, session.expiresAt);
  return { session, cookie: sessionCookie(id, SESSION_TTL) };
}

function sessionCookie(value: string, maxAge: number): string {
  const secure = appConfig().origin.startsWith("https:") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearedSessionCookie(): string {
  return sessionCookie("", 0);
}

export function currentSession(req: Request): Session | undefined {
  const id = readCookie(req, SESSION_COOKIE);
  if (!id) return undefined;
  const row = db()
    .prepare("SELECT address, chain_id, role, expires_at FROM auth_sessions WHERE id_hash = ? AND expires_at > ?")
    .get(hashId(id), nowSeconds()) as { address: string; chain_id: number; role: Role; expires_at: number } | undefined;
  if (!row) return undefined;
  return { address: row.address, chainId: row.chain_id, role: row.role, expiresAt: row.expires_at };
}

export function requireSession(req: Request, role: Role): Session {
  const session = currentSession(req);
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "sign in with your wallet first");
  if (session.role !== role) throw new ApiError(403, "FORBIDDEN", `this action requires the ${role} role`);
  // Re-check the issuer allowlist on every privileged call so removing an operator takes effect immediately.
  if (role === "issuer" && !issuerOperatorAddresses().includes(session.address.toLowerCase())) {
    throw new ApiError(403, "FORBIDDEN", "issuer operator access was withdrawn");
  }
  return session;
}

export function destroySession(req: Request): void {
  const id = readCookie(req, SESSION_COOKIE);
  if (id) db().prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(hashId(id));
}
