import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { JsonRpcProvider } from "ethers";
import { setupKeys, parseEnvFile } from "./setup-keys";
import { deployLocal } from "./deploy";

/**
 * Starts an isolated local stack for scripted runs: a Hardhat node, freshly
 * generated issuer keys, freshly deployed contracts, and a Next.js server.
 * All state goes into `dir`; the developer's own chain, app and .data/ are untouched.
 */
export interface LocalStack {
  rpc: string;
  origin: string;
  provider: JsonRpcProvider;
  deployment: Awaited<ReturnType<typeof deployLocal>>;
  issuerDid: string;
  stop(): void;
}

export interface StackOptions {
  dir: string;
  chainPort: number;
  appPort: number;
  /** "dev" uses `next dev`; "start" serves an existing production build from `distDir`. */
  mode: "dev" | "start";
  distDir: string;
  log?: (msg: string) => void;
  /** Extra environment for the app server (e.g. TRUST_PROXY). */
  appEnv?: Record<string, string>;
}

async function waitFor(what: string, probe: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function startLocalStack(opts: StackOptions): Promise<LocalStack> {
  const root = process.cwd();
  const log = opts.log ?? (() => undefined);
  if (!existsSync(path.join(root, "artifacts/contracts/CredentialRegistry.sol/CredentialRegistry.json"))) {
    throw new Error("contracts are not compiled: run `npm run compile` first");
  }
  if (opts.mode === "start" && !existsSync(path.join(root, opts.distDir, "BUILD_ID"))) {
    throw new Error(`no production build in ${opts.distDir}: run \`NEXT_DIST_DIR=${opts.distDir} npm run build\` first`);
  }
  rmSync(opts.dir, { recursive: true, force: true });
  mkdirSync(opts.dir, { recursive: true });

  const children: ChildProcess[] = [];
  let stopping = false;
  const start = (args: string[], env: NodeJS.ProcessEnv, name: string) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    child.stdout?.on("data", (d) => (out = (out + String(d)).slice(-4000)));
    child.stderr?.on("data", (d) => (out = (out + String(d)).slice(-4000)));
    child.on("exit", (code) => {
      if (code && !stopping) console.error(`[${name}] exited with ${code}\n${out}`);
    });
    children.push(child);
  };
  const stop = () => {
    stopping = true;
    for (const c of children) {
      try {
        if (c.pid) process.kill(-c.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  };

  try {
    const rpc = `http://127.0.0.1:${opts.chainPort}`;
    const origin = `http://localhost:${opts.appPort}`;
    start(["node_modules/hardhat/dist/src/cli.js", "node", "--port", String(opts.chainPort)], process.env, "hardhat");
    const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
    await waitFor("Hardhat node", async () => (await provider.getNetwork()).chainId === 31337n, 90_000);
    log(`Hardhat node on ${rpc} (chain 31337)`);

    const envFile = path.join(opts.dir, "issuer.env");
    const trustFile = path.join(opts.dir, "trusted-issuers.json");
    const deploymentFile = path.join(opts.dir, "deployment.json");
    const keys = await setupKeys({ envFile, trustFile, appOrigin: origin, rpcUrl: rpc, force: true });
    log(`Issuer keys generated: ${keys.issuerDid.slice(0, 28)}… / EVM ${keys.issuerEvmAddress}`);
    const issuerEnv = parseEnvFile(envFile);
    const deployment = await deployLocal({ rpcUrl: rpc, issuerEvmPrivateKey: issuerEnv.ISSUER_EVM_PRIVATE_KEY!, deploymentFile, projectRoot: root });
    log(`Contracts deployed: registry ${deployment.registry}, gate ${deployment.gate}`);

    start(
      ["node_modules/next/dist/bin/next", opts.mode, "--port", String(opts.appPort)],
      {
        ...process.env,
        ...issuerEnv,
        NEXT_DIST_DIR: opts.distDir,
        DATA_DIR: path.join(opts.dir, "data"),
        TRUSTED_ISSUERS_FILE: trustFile,
        DEPLOYMENT_FILE: deploymentFile,
        NEXT_TELEMETRY_DISABLED: "1",
        ...opts.appEnv,
      },
      "next",
    );
    await waitFor("Next.js app", async () => (await fetch(`${origin}/api/config`)).status === 200, 180_000);
    log(`App server on ${origin}`);
    return { rpc, origin, provider, deployment, issuerDid: keys.issuerDid, stop };
  } catch (err) {
    stop();
    throw err;
  }
}
