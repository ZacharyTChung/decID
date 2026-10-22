/**
 * npm run verify -- <bundle.json> [options]
 *
 * A standalone relying-party verifier. It runs exactly the checks of the verifier API
 * (src/lib/server/verifier/core.ts) against a holder bundle, using only PUBLIC inputs:
 * the trusted issuer policy, the deployment record and chain RPC. Issuer secrets are removed
 * from the environment before anything is loaded, to demonstrate that none are needed.
 *
 * The holder side is simulated with a Hardhat PUBLIC dev key: it signs this verifier's
 * fresh challenge (EIP-712 presentation proof). If that key does not control the bundle's
 * holder wallet, wallet control fails, as it should.
 *
 * Options:
 *   --password <pw>        decrypt an encrypted backup (or set BUNDLE_PASSWORD)
 *   --holder-index <n>     Hardhat dev account that signs the proof (default 2)
 *   --rpc <url>            default: RPC_URL from .env.local, else http://127.0.0.1:8545
 *   --deployment <file>    default: deployments/localhost.json
 *   --trust <file>         default: config/trusted-issuers.local.json
 *   --json                 print the full result as JSON
 *
 * Exit codes: 0 verified, 2 not verified, 1 usage or environment error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hexlify, randomBytes } from "ethers";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const bundleFile = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

function defaultRpc(): string {
  if (existsSync(".env.local")) {
    const m = /^RPC_URL=(.*)$/m.exec(readFileSync(".env.local", "utf8"));
    if (m?.[1]) return m[1].trim();
  }
  return "http://127.0.0.1:8545";
}

async function main(): Promise<number> {
  if (!bundleFile) {
    console.error("usage: npm run verify -- <bundle.json> [--password pw] [--holder-index n] [--rpc url] [--deployment file] [--trust file] [--json]");
    return 1;
  }

  // Public inputs only. Issuer secrets are dropped before any module reads configuration.
  for (const k of Object.keys(process.env)) if (k.startsWith("ISSUER_")) delete process.env[k];
  process.env.RPC_URL = flag("--rpc") ?? defaultRpc();
  process.env.DEPLOYMENT_FILE = path.resolve(flag("--deployment") ?? "deployments/localhost.json");
  process.env.TRUSTED_ISSUERS_FILE = path.resolve(flag("--trust") ?? "config/trusted-issuers.local.json");

  const { HolderBundleV1 } = await import("../src/lib/shared/bundle");
  const { decryptBundle } = await import("../src/lib/shared/bundle-crypto");
  const { ENCRYPTED_BUNDLE_VERSION } = await import("../src/lib/shared/constants");
  const { PRESENTATION_TYPES, presentationDomain, presentationStatement } = await import("../src/lib/shared/eip712");
  const { CHECK_LABELS } = await import("../src/lib/shared/verification");
  const { loadDeployment } = await import("../src/lib/server/chain");
  const { loadTrustedIssuers } = await import("../src/lib/server/trust");
  const { finalize, verifyPresentationCore } = await import("../src/lib/server/verifier/core");
  const { devWallet } = await import("./lib/dev-accounts");

  const raw = JSON.parse(readFileSync(bundleFile, "utf8")) as { version?: string };
  let bundle;
  if (raw.version === ENCRYPTED_BUNDLE_VERSION) {
    const password = flag("--password") ?? process.env.BUNDLE_PASSWORD;
    if (!password) {
      console.error("this is an encrypted backup: pass --password or set BUNDLE_PASSWORD");
      return 1;
    }
    bundle = await decryptBundle(raw, password);
  } else {
    const parsed = HolderBundleV1.safeParse(raw);
    if (!parsed.success) {
      console.error("not a holder bundle or encrypted backup (expected did-mvp.holder-bundle/v1 or an encrypted export)");
      return 1;
    }
    bundle = parsed.data;
  }

  const deployment = loadDeployment();
  const issuers = loadTrustedIssuers();
  const now = Math.floor(Date.now() / 1000);

  // This verifier's own fresh challenge (the CLI is its own audience).
  const ctx = {
    nonce: hexlify(randomBytes(32)),
    action: "access-verified-member-area",
    audience: "urn:did-mvp:cli-verifier",
    chainId: deployment.chainId,
    registry: deployment.registry,
    expiresAt: now + 120,
  };

  // Simulated holder wallet signs the presentation proof.
  const holderKey = devWallet(Number(flag("--holder-index") ?? "2"));
  const holder = bundle.authorization.holder;
  if (holderKey.address.toLowerCase() !== holder.toLowerCase()) {
    console.error(`note: dev account ${holderKey.address} does not control the holder wallet ${holder}; wallet control will fail`);
  }
  const signature = await holderKey.signTypedData(presentationDomain(ctx.chainId, ctx.registry), PRESENTATION_TYPES, {
    statement: presentationStatement(ctx.audience, ctx.action),
    audience: ctx.audience,
    action: ctx.action,
    challenge: ctx.nonce,
    holder,
    commitment: bundle.commitment,
    expiresAt: ctx.expiresAt,
  });

  const core = await verifyPresentationCore(
    ctx,
    { credentialJwt: bundle.credentialJwt, salt: bundle.salt, proof: { holder, commitment: bundle.commitment, expiresAt: ctx.expiresAt, signature } },
    { deployment, issuers, now },
  );
  const result = finalize([{ id: "challenge", status: "pass", detail: "fresh CLI challenge" }, ...core.checks], {
    registryStatus: core.registryStatus,
    disclosed: core.disclosed,
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const c of result.checks) {
      const mark = c.status === "pass" ? "✔" : c.status === "fail" ? "✘" : "·";
      console.log(`${mark} ${CHECK_LABELS[c.id]}${c.status === "fail" ? `  [${c.code}] ${c.detail ?? ""}` : ""}`);
    }
    if (result.registryStatus) console.log(`registry status: ${result.registryStatus}`);
    console.log(result.verified ? `\nVERIFIED: ${result.disclosed?.holderDid} identityVerified=true (issuer ${result.disclosed?.issuerName})` : "\nNOT VERIFIED");
  }
  return result.verified ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
