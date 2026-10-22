import "server-only";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { z } from "zod";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "../../generated/contracts";
import { appConfig, readJsonFile } from "./config";

/**
 * Deployment record written by `npm run deploy` (scripts/deploy.ts).
 * Frontend and backend both read it, the frontend through GET /api/config, so
 * addresses are never copied by hand.
 */
export const DeploymentSchema = z.strictObject({
  chainId: z.number().int().positive(),
  registry: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  gate: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  admin: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  issuerSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  schemaId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  deployedAtBlock: z.number().int().nonnegative(),
  deployedAt: z.string(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export function loadDeployment(): Deployment {
  const d = DeploymentSchema.parse(readJsonFile(appConfig().deploymentFile, "deployment record (run `npm run deploy`)"));
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
}

/** Reads the record and its status in one consistent block. */
export async function readRecord(commitment: string, d: Deployment = loadDeployment()): Promise<OnChainRecord> {
  const registry = registryContract(d);
  const blockTag = await provider().getBlockNumber();
  const [r, status] = await Promise.all([
    registry.getRecord(commitment, { blockTag }),
    registry.credentialStatus(commitment, { blockTag }),
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
  };
}
