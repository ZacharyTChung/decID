import { existsSync, readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet, parseEther } from "ethers";
import { exportJWK, generateKeyPair } from "jose";
import { CREDENTIAL_REGISTRY_ABI } from "../../src/generated/contracts";
import { deriveDidKeyFromJwk, type Ed25519PublicJwk } from "../../src/lib/server/did/did-key";
import { TrustFileSchema } from "../../src/lib/server/trust-schema";
import { DEV_ROLES, devWallet } from "./dev-accounts";
import { parseEnvFile, updateEnvFile, writeTrustFile } from "./setup-keys";

export interface RotateOptions {
  envFile: string;
  trustFile: string;
  /** Which key to rotate. */
  which: "credential" | "evm" | "both";
  /** retired: past credentials stay valid. compromised: everything the old key signed is rejected. */
  reason: "retired" | "compromised";
  rpcUrl: string;
  /** Needed for EVM rotation: the registry to authorize the new signer in (and remove a compromised one from). */
  deploymentFile?: string;
  now?: number;
}

export interface RotateResult {
  newCredentialDid?: string;
  newEvmSigner?: string;
  onChain: string[];
}

/**
 * Rotates the issuer's credential key and/or EVM attestation key.
 *
 * Order matters: chain changes first, files last, so a failure leaves the
 * trust policy and the registry consistent.
 *
 * - The old entry is marked `retired` or `compromised` with retiredAt = now + 1, so a
 *   credential issued in the current second still counts as issued before retirement.
 * - EVM: the new signer is authorized in the registry and funded for revocation gas.
 *   A retired signer stays authorized on-chain (its records stay valid) and its private
 *   key is kept in ISSUER_EVM_RETIRED_PRIVATE_KEYS so its records can still be revoked.
 *   A compromised signer is removed on-chain (epoch bump: all its records become
 *   IssuerInactive) and its private key is discarded.
 *
 * The running app reads keys at startup, so it must be restarted afterwards.
 */
export async function rotateIssuerKeys(opts: RotateOptions): Promise<RotateResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const env = parseEnvFile(opts.envFile);
  const trust = TrustFileSchema.parse(JSON.parse(readFileSync(opts.trustFile, "utf8")));
  const issuer = trust.issuers[0];
  if (!issuer) throw new Error("trust policy has no issuer");
  const envUpdates: Record<string, string> = {};
  const result: RotateResult = { onChain: [] };

  if (opts.which === "credential" || opts.which === "both") {
    const currentPublic = JSON.parse(env.ISSUER_CREDENTIAL_PRIVATE_JWK!) as Ed25519PublicJwk;
    const { did: currentDid } = await deriveDidKeyFromJwk({ kty: "OKP", crv: "Ed25519", x: currentPublic.x });
    const current = issuer.credentialKeys.find((k) => k.did === currentDid);
    if (!current || current.status !== "active") throw new Error("the configured credential key is not the active key in the trust policy");

    const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
    const jwk = await exportJWK(privateKey);
    const publicJwk: Ed25519PublicJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x! };
    const { did, kid } = await deriveDidKeyFromJwk(publicJwk);
    current.status = opts.reason;
    current.retiredAt = now + 1;
    issuer.credentialKeys.push({ did, kid, publicKeyJwk: publicJwk, status: "active", activatedAt: now });
    envUpdates.ISSUER_CREDENTIAL_PRIVATE_JWK = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d });
    result.newCredentialDid = did;
  }

  if (opts.which === "evm" || opts.which === "both") {
    const oldWallet = new Wallet(env.ISSUER_EVM_PRIVATE_KEY!);
    const current = issuer.evmAttestationSigners.find((s) => s.address.toLowerCase() === oldWallet.address.toLowerCase());
    if (!current || current.status !== "active") throw new Error("the configured EVM key is not the active signer in the trust policy");
    const next = Wallet.createRandom();

    if (opts.deploymentFile && existsSync(opts.deploymentFile)) {
      const deployment = JSON.parse(readFileSync(opts.deploymentFile, "utf8")) as { registry: string };
      const provider = new JsonRpcProvider(opts.rpcUrl, undefined, { cacheTimeout: -1 });
      try {
        const chainId = await Promise.race([
          provider.send("eth_chainId", []) as Promise<string>,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`local chain not reachable at ${opts.rpcUrl}`)), 5000)),
        ]);
        if (BigInt(chainId) !== 31337n) throw new Error("refusing to change a non-local chain");
        const admin = devWallet(DEV_ROLES.deployer, provider);
        const registry = new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, admin);
        await (await registry.getFunction("addIssuer")(next.address)).wait();
        result.onChain.push(`addIssuer(${next.address})`);
        await (await admin.sendTransaction({ to: next.address, value: parseEther("10") })).wait();
        if (opts.reason === "compromised") {
          await (await registry.getFunction("removeIssuer")(oldWallet.address)).wait();
          result.onChain.push(`removeIssuer(${oldWallet.address})`);
        }
      } finally {
        provider.destroy();
      }
    } else {
      result.onChain.push("no deployment record: run `npm run deploy` to authorize the new signer");
    }

    current.status = opts.reason;
    current.retiredAt = now + 1;
    issuer.evmAttestationSigners.push({ address: next.address, status: "active", activatedAt: now });
    envUpdates.ISSUER_EVM_PRIVATE_KEY = next.privateKey;
    const retiredKeys = (env.ISSUER_EVM_RETIRED_PRIVATE_KEYS ?? "").split(",").filter(Boolean);
    if (opts.reason === "retired") retiredKeys.push(oldWallet.privateKey);
    envUpdates.ISSUER_EVM_RETIRED_PRIVATE_KEYS = retiredKeys.join(",");
    result.newEvmSigner = next.address;
  }

  writeTrustFile(opts.trustFile, trust);
  updateEnvFile(opts.envFile, envUpdates);
  return result;
}
