import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { startHardhatNode } from "./chain-process";
import { setupKeys, parseEnvFile } from "../../../scripts/lib/setup-keys";
import { deployLocal } from "../../../scripts/lib/deploy";

/**
 * Integration environment for the app tests: a real Hardhat JSON-RPC node,
 * freshly generated issuer keys, and freshly deployed contracts. Nothing is
 * mocked. Settings are written to .test-data/env.json and loaded by
 * env-setup.ts in each test worker.
 */
const PORT = 8547;
let node: ChildProcess | undefined;

export default async function setup() {
  const root = process.cwd();
  const dir = path.join(root, ".test-data");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  node = await startHardhatNode(PORT, root);
  const rpcUrl = `http://127.0.0.1:${PORT}`;
  const envFile = path.join(dir, "issuer.env");
  const trustFile = path.join(dir, "trusted-issuers.json");
  const deploymentFile = path.join(dir, "deployment.json");
  await setupKeys({ envFile, trustFile, appOrigin: "http://localhost:3999", rpcUrl, force: true });
  const env = parseEnvFile(envFile);
  await deployLocal({ rpcUrl, issuerEvmPrivateKey: env.ISSUER_EVM_PRIVATE_KEY!, deploymentFile, projectRoot: root });

  writeFileSync(
    path.join(dir, "env.json"),
    JSON.stringify({
      ...env,
      PROJECT_ROOT: root,
      DATA_DIR: path.join(dir, "data"),
      TRUSTED_ISSUERS_FILE: trustFile,
      DEPLOYMENT_FILE: deploymentFile,
      DISABLE_RATE_LIMIT: "1",
    }),
  );

  return async () => {
    node?.kill("SIGTERM");
  };
}
