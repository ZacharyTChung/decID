/**
 * npm run reset: intentionally clears LOCAL demo state.
 *
 * Removes .data/ (sessions, synthetic requests, issuance log, challenges) and
 * deployments/localhost.json. Keeps .env.local and the trust policy unless
 * --keys is passed (then issuer keys are deleted and must be regenerated).
 *
 * What becomes invalid: every previously issued credential bundle refers to
 * the old registry address and chain state, so it will fail verification
 * against a fresh deployment (WRONG_DEPLOYMENT / NOT_REGISTERED). Restarting
 * `npm run chain` already wipes the in-memory Hardhat chain. Deleting local
 * files never erases history from a persistent or public blockchain.
 */
import { rmSync } from "node:fs";

const targets = [".data", "deployments/localhost.json", ".demo", ".next-demo", ".test-data"];
if (process.argv.includes("--keys")) targets.push(".env.local", "config/trusted-issuers.local.json");
for (const t of targets) {
  rmSync(t, { recursive: true, force: true });
  console.log(`removed ${t}`);
}
console.log("\nNext: restart `npm run chain`, then `npm run setup` (if keys were removed) and `npm run deploy`.");
console.log("Previously exported holder bundles are now unusable against the new deployment.");
