import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet, hexlify, parseEther, randomBytes, type InterfaceAbi } from "ethers";
import { SCHEMA_ID } from "../../src/lib/shared/constants";
import { DEV_ROLES, devWallet } from "./dev-accounts";

function artifact(root: string, name: string): { abi: InterfaceAbi; bytecode: string } {
  const file = path.join(root, "artifacts/contracts", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export interface DeployOptions {
  rpcUrl: string;
  issuerEvmPrivateKey: string;
  deploymentFile: string;
  projectRoot?: string;
}

/**
 * Deploys CredentialRegistry and DemoGate to a LOCAL chain with Hardhat dev
 * account #0 as admin, authorizes the issuer attestation signer, funds it for
 * revocation gas, and writes the deployment record that the app reads.
 */
export async function deployLocal(opts: DeployOptions) {
  const root = opts.projectRoot ?? process.cwd();
  const provider = new JsonRpcProvider(opts.rpcUrl, undefined, { cacheTimeout: -1 });
  const network = await provider.getNetwork();
  if (network.chainId !== 31337n) {
    throw new Error(`refusing to deploy: chain id ${network.chainId} is not the local Hardhat chain (31337)`);
  }
  const deployer = devWallet(DEV_ROLES.deployer, provider);
  const issuerSigner = new Wallet(opts.issuerEvmPrivateKey).address;

  const reg = artifact(root, "CredentialRegistry");
  const gate = artifact(root, "DemoGate");
  // The local chain restarts at the same deployer nonce, so the registry address repeats.
  // A fresh random deploymentId (signed into every authorization) keeps old authorizations from replaying.
  const deploymentId = hexlify(randomBytes(32));
  const registry = await new ContractFactory(reg.abi, reg.bytecode, deployer).deploy(deployer.address, deploymentId);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  const demoGate = await new ContractFactory(gate.abi, gate.bytecode, deployer).deploy(registryAddress, SCHEMA_ID);
  await demoGate.waitForDeployment();

  await (await (registry as unknown as { addIssuer(a: string): Promise<{ wait(): Promise<unknown> }> }).addIssuer(issuerSigner)).wait();
  await (await deployer.sendTransaction({ to: issuerSigner, value: parseEther("10") })).wait();

  const record = {
    chainId: Number(network.chainId),
    registry: registryAddress,
    gate: await demoGate.getAddress(),
    deploymentId,
    admin: deployer.address,
    issuerSigner,
    schemaId: SCHEMA_ID,
    deployedAtBlock: await provider.getBlockNumber(),
    deployedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(opts.deploymentFile), { recursive: true });
  writeFileSync(opts.deploymentFile, JSON.stringify(record, null, 2) + "\n");
  provider.destroy();
  return record;
}
