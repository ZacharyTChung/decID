/** npm run setup [-- --force]: generate local issuer keys (.env.local) and the trust policy. */
import { setupKeys } from "./lib/setup-keys";

const result = await setupKeys({
  envFile: ".env.local",
  trustFile: "config/trusted-issuers.local.json",
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:3000",
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  force: process.argv.includes("--force"),
});
console.log(result.created ? "Generated new local issuer keys in .env.local (mode 0600)." : "Kept existing keys in .env.local (use --force to rotate).");
console.log(`Issuer DID:                 ${result.issuerDid}`);
console.log(`Issuer EVM attestation key: ${result.issuerEvmAddress}`);
console.log("Trust policy written to config/trusted-issuers.local.json");
