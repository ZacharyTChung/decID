/**
 * npm run rotate-keys -- [--credential | --evm] [--compromised]
 *
 * Rotates the issuer's keys (both by default). Without --compromised the old keys are
 * RETIRED: credentials and registrations they made before now stay valid. With
 * --compromised everything the old key signed is rejected, and a compromised EVM signer
 * is removed from the local registry. Restart `npm run dev` / `npm start` afterwards.
 */
import { rotateIssuerKeys } from "./lib/rotate-keys";
import { parseEnvFile } from "./lib/setup-keys";

const args = process.argv.slice(2);
const which = args.includes("--credential") && !args.includes("--evm") ? "credential" : args.includes("--evm") && !args.includes("--credential") ? "evm" : "both";
const reason = args.includes("--compromised") ? "compromised" : "retired";

const env = parseEnvFile(".env.local");
rotateIssuerKeys({
  envFile: ".env.local",
  trustFile: "config/trusted-issuers.local.json",
  which,
  reason,
  rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8545",
  deploymentFile: "deployments/localhost.json",
})
  .then((r) => {
    console.log(`Rotated ${which} key(s); old key(s) marked ${reason}.`);
    if (r.newCredentialDid) console.log(`New credential key DID: ${r.newCredentialDid}`);
    if (r.newEvmSigner) console.log(`New EVM attestation signer: ${r.newEvmSigner}`);
    for (const line of r.onChain) console.log(`On-chain: ${line}`);
    console.log("Restart the app so the issuer uses the new keys.");
  })
  .catch((e) => {
    console.error(`rotation failed (key files were not updated; check 'npm run admin -- status' for any on-chain step that already ran): ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
