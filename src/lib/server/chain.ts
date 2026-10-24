import "server-only";
import { Contract, Interface, JsonRpcProvider, getAddress, type Provider } from "ethers";
import { z } from "zod";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "../../generated/contracts";
import { appConfig, readJsonFile } from "./config";
import { ApiError } from "./errors";
import { SCHEMA_ID } from "../shared/constants";

/**
 * Deployment record written by `npm run deploy` (scripts/deploy.ts).
 * Frontend and backend both read it, the frontend through GET /api/config, so
 * addresses are never copied by hand.
 */
export const DeploymentSchema = z.strictObject({
  chainId: z.number().int().positive(),
  registry: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  gate: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  deploymentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  admin: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  issuerSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** ReceiptAnchor contract and the account allowed to anchor (absent in deployments that predate anchoring). */
  anchor: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  anchorer: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  schemaId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  deployedAtBlock: z.number().int().nonnegative(),
  deployedAt: z.string(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export function loadDeployment(): Deployment {
  let raw: unknown;
  try {
    raw = readJsonFile(appConfig().deploymentFile, "deployment record");
  } catch {
    throw new ApiError(503, "NOT_DEPLOYED", "contracts are not deployed: start `npm run chain`, then run `npm run deploy`");
  }
  const parsed = DeploymentSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(503, "NOT_DEPLOYED", "deployment record is outdated or invalid: run `npm run deploy`");
  const d = parsed.data;
  // The gate is deployed for one credential schema; after a profile upgrade it must be redeployed.
  if (d.schemaId.toLowerCase() !== SCHEMA_ID.toLowerCase()) {
    throw new ApiError(503, "NOT_DEPLOYED", "deployment was made for an older credential profile: run `npm run deploy`");
  }
  return { ...d, registry: getAddress(d.registry), gate: getAddress(d.gate) };
}

let cached: { url: string; provider: JsonRpcProvider } | undefined;

export function provider(): JsonRpcProvider {
  const url = appConfig().rpcUrl;
  if (!cached || cached.url !== url) {
    // batchStallTime 0: calls made in the same tick still go out as one JSON-RPC batch, but
    // without ethers' default 10 ms wait for more calls (which dominated verification latency).
    cached = { url, provider: new JsonRpcProvider(url, undefined, { staticNetwork: false, cacheTimeout: -1, batchStallTime: 0 }) };
  }
  return cached.provider;
}

export function registryContract(d: Deployment = loadDeployment(), p: Provider = provider()): Contract {
  return new Contract(d.registry, CREDENTIAL_REGISTRY_ABI, p);
}

export function gateContract(d: Deployment = loadDeployment()): Contract {
  return new Contract(d.gate, DEMO_GATE_ABI, provider());
}

const registryErrors = new Interface(CREDENTIAL_REGISTRY_ABI);

/**
 * Runs a chain interaction and maps failures to stable API errors:
 * contract reverts → 409 TX_REVERTED (with the decoded error name), anything else → 503 RPC_UNAVAILABLE.
 */
export async function onChain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const e = err as { code?: string; data?: string };
    if (e?.code === "CALL_EXCEPTION") {
      let name = "unknown reason";
      try {
        if (typeof e.data === "string") name = registryErrors.parseError(e.data)?.name ?? name;
      } catch {
        // undecodable revert data
      }
      throw new ApiError(409, "TX_REVERTED", `the registry rejected the transaction: ${name}`);
    }
    // A nonce clash means another sender used this account concurrently. The chain is
    // reachable; reporting RPC_UNAVAILABLE would send operators looking in the wrong place.
    if (e?.code === "NONCE_EXPIRED" || e?.code === "REPLACEMENT_UNDERPRICED" || /nonce/i.test(String((err as Error)?.message ?? ""))) {
      throw new ApiError(409, "ISSUER_TX_CONFLICT", "another transaction from the issuer key used the same nonce; retry");
    }
    throw new ApiError(503, "RPC_UNAVAILABLE", "the local chain is unreachable or was restarted: check `npm run chain` and `npm run deploy`");
  }
}

/**
 * Confirms the registry at the recorded address is the recorded deployment. After a chain
 * restart the address may be empty or hold a different deployment with a new deploymentId.
 */
export async function assertLiveDeployment(d: Deployment = loadDeployment()): Promise<void> {
  const id = await onChain(() => registryContract(d).getFunction("deploymentId")() as Promise<string>);
  if (id.toLowerCase() !== d.deploymentId.toLowerCase()) {
    throw new ApiError(503, "NOT_DEPLOYED", "the chain no longer holds the recorded deployment: run `npm run deploy`");
  }
}

export const REGISTRY_STATUS = ["None", "Active", "Revoked", "IssuerInactive", "NotYetValid", "Expired"] as const;
export type RegistryStatus = (typeof REGISTRY_STATUS)[number];

export interface OnChainRecord {
  exists: boolean;
  holder: string;
  issuer: string;
  schemaId: string;
  validFrom: number;
  expiresAt: number;
  issuerEpoch: number;
  registeredAt: number;
  revoked: boolean;
  status: RegistryStatus;
  blockTag: number;
  /** `isCredentialValid(commitment, holder, schemaId)` at the same block, when `validFor` was given. */
  validFor?: boolean;
}

/**
 * Reads the record and its status (and optionally `isCredentialValid` for a holder) in one
 * consistent block: one round trip for the block number, then one batched round trip.
 */
export async function readRecord(
  commitment: string,
  d: Deployment = loadDeployment(),
  validFor?: { holder: string; schemaId: string },
  p: Provider = provider(),
): Promise<OnChainRecord> {
  const registry = registryContract(d, p);
  const blockTag = await p.getBlockNumber();
  const [r, status, valid] = await Promise.all([
    registry.getFunction("getRecord")(commitment, { blockTag }),
    registry.getFunction("credentialStatus")(commitment, { blockTag }),
    validFor ? (registry.getFunction("isCredentialValid")(commitment, validFor.holder, validFor.schemaId, { blockTag }) as Promise<boolean>) : undefined,
  ]);
  return {
    exists: r.holder !== "0x0000000000000000000000000000000000000000",
    holder: r.holder,
    issuer: r.issuer,
    schemaId: r.schemaId,
    validFrom: Number(r.validFrom),
    expiresAt: Number(r.expiresAt),
    issuerEpoch: Number(r.issuerEpoch),
    registeredAt: Number(r.registeredAt),
    revoked: r.revoked,
    status: REGISTRY_STATUS[Number(status)] ?? "None",
    blockTag,
    validFor: valid,
  };
}
