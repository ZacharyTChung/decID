/**
 * npm run admin -- <command> [arg]   Registry administration on the LOCAL chain.
 *
 *   status                      deployment, admin, issuers and their epochs
 *   remove-issuer [address]     removeIssuer (default: the configured issuer signer)
 *   add-issuer    [address]     addIssuer    (default: the configured issuer signer)
 *   revoke <commitment>         adminRevoke: explicit admin override revocation
 *   record <commitment>         show the public registry record and status
 *
 * Signs with Hardhat public dev account #0, the registry admin set by `npm run deploy`.
 * Removing an issuer bumps its epoch: every credential it issued before becomes
 * permanently invalid, even if it is added back later.
 */
import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { CREDENTIAL_REGISTRY_ABI } from "../src/generated/contracts";
import { DEV_ROLES, devWallet } from "./lib/dev-accounts";

const STATUS = ["None", "Active", "Revoked", "IssuerInactive", "NotYetValid", "Expired"];

const deploymentFile = process.env.DEPLOYMENT_FILE ?? "deployments/localhost.json";
const deployment = JSON.parse(readFileSync(deploymentFile, "utf8")) as { registry: string; issuerSigner: string; admin: string; chainId: number };
const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
const admin = devWallet(DEV_ROLES.deployer, provider);
const registry = new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, admin);

const [command, arg] = process.argv.slice(2);
const bytes32 = (v: string | undefined) => {
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error("expected a 0x-prefixed 32-byte commitment");
  return v;
};

async function send(name: string, ...args: unknown[]) {
  const tx = await registry.getFunction(name)(...args);
  const receipt = await tx.wait();
  console.log(`${name} confirmed in block ${receipt?.blockNumber} (${receipt?.hash})`);
}

async function main() {
  if ((await provider.getNetwork()).chainId !== 31337n) throw new Error("refusing to run: not the local Hardhat chain (31337)");
  switch (command) {
    case "status": {
      const [active, epoch] = await registry.getFunction("issuerState")(deployment.issuerSigner);
      console.log(`registry ${deployment.registry} on chain ${deployment.chainId}`);
      console.log(`admin    ${deployment.admin}`);
      console.log(`issuer   ${deployment.issuerSigner}  active=${active} epoch=${epoch}`);
      break;
    }
    case "remove-issuer":
      await send("removeIssuer", getAddress(arg ?? deployment.issuerSigner));
      break;
    case "add-issuer":
      await send("addIssuer", getAddress(arg ?? deployment.issuerSigner));
      break;
    case "revoke":
      await send("adminRevoke", bytes32(arg));
      break;
    case "record": {
      const r = await registry.getFunction("getRecord")(bytes32(arg));
      if (r.holder === "0x0000000000000000000000000000000000000000") {
        console.log("no record for this commitment (status None)");
        break;
      }
      const s = Number(await registry.getFunction("credentialStatus")(arg));
      console.log({
        holder: r.holder,
        issuer: r.issuer,
        schemaId: r.schemaId,
        validFrom: new Date(Number(r.validFrom) * 1000).toISOString(),
        expiresAt: new Date(Number(r.expiresAt) * 1000).toISOString(),
        issuerEpoch: Number(r.issuerEpoch),
        revoked: r.revoked,
        status: STATUS[s],
      });
      break;
    }
    default:
      console.log("usage: npm run admin -- status | remove-issuer [addr] | add-issuer [addr] | revoke <commitment> | record <commitment>");
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((e) => {
    let reason = e?.shortMessage ?? e?.message ?? String(e);
    const data = e?.data ?? e?.info?.error?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        const parsed = registry.interface.parseError(data);
        if (parsed) reason = `${parsed.name}(${parsed.args.map(String).join(", ")})`;
      } catch {
        // keep the generic message
      }
    }
    console.error(`error: ${reason}`);
    process.exitCode = 1;
  })
  .finally(() => provider.destroy());
