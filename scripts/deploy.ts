/** npm run deploy: deploy contracts to the local Hardhat node and write deployments/localhost.json. */
import { deployLocal } from "./lib/deploy";
import { parseEnvFile } from "./lib/setup-keys";

const env = parseEnvFile(".env.local");
const record = await deployLocal({
  rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8545",
  issuerEvmPrivateKey: env.ISSUER_EVM_PRIVATE_KEY!,
  deploymentFile: "deployments/localhost.json",
});
console.log("Deployed to local chain:", JSON.stringify(record, null, 2));
