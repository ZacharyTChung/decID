import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Server-only configuration. Nothing in this module may be imported by client
 * components (`server-only` makes the build fail if that happens).
 *
 * Configuration is split by trust domain so each module reads only what it
 * needs. In particular the verifier never calls `issuerSecrets()`.
 */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export function projectRoot(): string {
  return env("PROJECT_ROOT") ?? process.cwd();
}

export function dataDir(): string {
  return path.resolve(projectRoot(), env("DATA_DIR") ?? ".data");
}

export interface PublicAppConfig {
  origin: string; // exact origin expected in Origin headers and SIWE/presentation audience
  domain: string; // host[:port] used as SIWE domain
  rpcUrl: string;
  deploymentFile: string;
  trustedIssuersFile: string;
}

export function appConfig(): PublicAppConfig {
  const origin = new URL(env("APP_ORIGIN") ?? "http://localhost:3000").origin;
  return {
    origin,
    domain: new URL(origin).host,
    rpcUrl: env("RPC_URL") ?? "http://127.0.0.1:8545",
    deploymentFile: path.resolve(projectRoot(), env("DEPLOYMENT_FILE") ?? "deployments/localhost.json"),
    trustedIssuersFile: path.resolve(projectRoot(), env("TRUSTED_ISSUERS_FILE") ?? "config/trusted-issuers.local.json"),
  };
}

/** Wallet addresses allowed to sign in with the issuer-operator role. */
export function issuerOperatorAddresses(): string[] {
  return (env("ISSUER_OPERATOR_ADDRESSES") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const IssuerSecrets = z.object({
  credentialPrivateJwk: z.object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string(), d: z.string() }),
  evmPrivateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  // Retired attestation keys, kept only to revoke records they authorized (only a record's own issuer may revoke).
  retiredEvmPrivateKeys: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
});
export type IssuerSecretsT = z.infer<typeof IssuerSecrets>;

/** Issuer signing material. Used only by the issuer module. Never logged. */
export function issuerSecrets(): IssuerSecretsT {
  const jwk = env("ISSUER_CREDENTIAL_PRIVATE_JWK");
  const evm = env("ISSUER_EVM_PRIVATE_KEY");
  if (!jwk || !evm) {
    throw new Error("issuer keys are not configured: run `npm run setup` to generate .env.local");
  }
  const retired = (env("ISSUER_EVM_RETIRED_PRIVATE_KEYS") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  return IssuerSecrets.parse({ credentialPrivateJwk: JSON.parse(jwk), evmPrivateKey: evm, retiredEvmPrivateKeys: retired });
}

/**
 * decID Verify's receipt-signing key (Ed25519). Receipts attest to a verification outcome and
 * carry no personal data. Kept separate from the issuer's keys: the verification service is a
 * different party than any issuer.
 */
export function verifyReceiptKey(): { kty: "OKP"; crv: "Ed25519"; x: string; d: string } {
  const jwk = env("VERIFY_RECEIPT_PRIVATE_JWK");
  if (!jwk) throw new Error("receipt signing key is not configured: run `npm run setup`");
  return z.object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string(), d: z.string() }).parse(JSON.parse(jwk));
}

/**
 * decID Pass gas sponsor: pays for holders' registration transactions so consumers never need
 * cryptocurrency. Local chain only (a Hardhat development account); production would use an
 * ERC-4337 paymaster. Undefined means sponsoring is off.
 */
export function sponsorPrivateKey(): string | undefined {
  return env("SPONSOR_PRIVATE_KEY");
}

/** Demo conveniences (one-click business sign-in, auto-approving issuer). Off unless set. */
export function demoMode(): boolean {
  return env("DEMO_MODE") === "1";
}
export function issuerAutoApprove(): boolean {
  return env("ISSUER_AUTO_APPROVE") === "1";
}

export function credentialLifetimeSeconds(): number {
  const days = Number(env("CREDENTIAL_LIFETIME_DAYS") ?? "365");
  if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new Error("invalid CREDENTIAL_LIFETIME_DAYS");
  return Math.round(days * 86400);
}

export function readJsonFile<T>(file: string, what: string): T {
  if (!existsSync(file)) throw new Error(`${what} not found at ${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
