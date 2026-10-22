import "server-only";
import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { z } from "zod";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "../../generated/contracts";
import { appConfig, readJsonFile } from "./config";
import { ApiError } from "./http";

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
  return { ...d, registry: getAddress(d.registry), gate: getAddress(d.gate) };
}

let cached: { url: string; provider: JsonRpcProvider } | undefined;

export function provider(): JsonRpcProvider {
  const url = appConfig().rpcUrl;
  if (!cached || cached.url !== url) {
    cached = { url, provider: new JsonRpcProvider(url, undefined, { staticNetwork: false, cacheTimeout: -1 }) };
  }
  return cached.provider;
}

export function registryContract(d: Deployment = loadDeployment()): Contract {
  return new Contract(d.registry, CREDENTIAL_REGISTRY_ABI, provider());
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
}

/** Reads the record and its status in one consistent block. */
export async function readRecord(commitment: string, d: Deployment = loadDeployment()): Promise<OnChainRecord> {
  const registry = registryContract(d);
  const blockTag = await provider().getBlockNumber();
  const [r, status] = await Promise.all([
    registry.getFunction("getRecord")(commitment, { blockTag }),
    registry.getFunction("credentialStatus")(commitment, { blockTag }),
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
  };
}
