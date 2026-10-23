/**
 * npm run test:multi-instance: two production app instances behind one public origin, sharing
 * the SQLite database and the issuer key, as a load-balanced single-host deployment would.
 *
 * Checks that sessions, single-use challenges, verification and the audit chain work across
 * instances, and that concurrent issuer transactions from BOTH instances all succeed. Before
 * the cross-process issuer lease (src/lib/server/issuer/tx-lock.ts), 2 of 4 concurrent
 * cross-instance revocations failed on a nonce clash and left those credentials active.
 *
 * Exit code 0 when every check holds, 1 otherwise.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { Contract } from "ethers";
import { CREDENTIAL_REGISTRY_ABI } from "../src/generated/contracts";
import type { HolderBundle } from "../src/lib/shared/bundle";
import type { ChallengeResponse } from "../src/lib/shared/api";
import { PRESENTATION_TYPES, presentationDomain } from "../src/lib/shared/eip712";
import { preparePresentation } from "../src/lib/shared/presentation";
import { devWallet } from "./lib/dev-accounts";
import { startLocalStack } from "./lib/local-stack";
import { parseEnvFile } from "./lib/setup-keys";
import type { HDNodeWallet } from "ethers";

const DIR = path.join(process.cwd(), ".multi-instance");
const PUBLIC = "http://localhost:3400";
const B = "http://localhost:3401";

class Client {
  cookie = "";
  constructor(readonly wallet: HDNodeWallet) {}
  async call(base: string, method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { origin: PUBLIC } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0]!;
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  }
  async signIn(base: string, role: string) {
    const ch = await this.call(base, "POST", "/api/auth/challenge", { address: this.wallet.address, chainId: 31337, role });
    return this.call(base, "POST", "/api/auth/verify", { message: ch.body.message, signature: await this.wallet.signMessage(ch.body.message) });
  }
}

const stack = await startLocalStack({ dir: DIR, chainPort: 8560, appPort: 3400, mode: "start", distDir: ".next-multi", appEnv: { DISABLE_RATE_LIMIT: "1" }, log: (m) => console.log("  " + m) });
const issuerEnv = parseEnvFile(path.join(DIR, "issuer.env"));
const second = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3401"], {
  env: { ...process.env, ...issuerEnv, APP_ORIGIN: PUBLIC, NEXT_DIST_DIR: ".next-multi", DATA_DIR: path.join(DIR, "data"), TRUSTED_ISSUERS_FILE: path.join(DIR, "trusted-issuers.json"), DEPLOYMENT_FILE: path.join(DIR, "deployment.json"), DISABLE_RATE_LIMIT: "1" },
  stdio: "ignore", detached: true,
});
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(B + "/api/config")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
console.log("  second instance on " + B + " (same DB, same issuer key, same public origin)");

const out: Record<string, unknown> = {};
try {
  const issuer = new Client(devWallet(1, stack.provider));
  out.issuerSignIn = (await issuer.signIn(PUBLIC, "issuer")).status;
  out.sessionSharedAcrossInstances = (await issuer.call(B, "GET", "/api/issuer/requests")).status;
  const registry = new Contract(stack.deployment.registry, CREDENTIAL_REGISTRY_ABI, stack.provider);

  // Issue + register 8 credentials (4 holders x 2), approvals alternating between instances.
  const bundles: HolderBundle[] = [];
  const holders = [2, 3, 4, 5, 6, 7].map((i) => new Client(devWallet(i, stack.provider)));
  for (const [hi, h] of holders.entries()) {
    await h.signIn(hi % 2 ? B : PUBLIC, "holder");
    for (let k = 0; k < 2; k++) {
      const req = await h.call(PUBLIC, "POST", "/api/holder/requests", { fullName: "Probe Sentinel", dateOfBirth: "1980-01-01", documentNumber: `SYN-PROBE${hi}${k}`, country: "ZZ", syntheticDataConfirmed: true });
      const ok = await issuer.call((hi + k) % 2 ? B : PUBLIC, "POST", `/api/issuer/requests/${req.body.id}/decision`, { decision: "approve" });
      if (ok.status !== 200) throw new Error("approve " + JSON.stringify(ok.body));
      const b = (await h.call(B, "POST", `/api/holder/requests/${req.body.id}/bundle`, {})).body.bundle as HolderBundle;
      await (await (registry.connect(h.wallet) as Contract).getFunction("register")(b.authorization, b.authorizationSignature)).wait();
      bundles.push(b);
    }
  }

  // Presentations spread over both instances, concurrently (shared challenge table).
  let verified = 0, otherwise = 0;
  await Promise.all(Array.from({ length: 60 }, async (_, n) => {
    const hi = n % 4, h = holders[hi]!, bundle = bundles[hi * 2]!;
    const c = (await h.call(n % 2 ? B : PUBLIC, "POST", "/api/verifier/challenges", { action: "access-verified-member-area" })).body as ChallengeResponse;
    const { disclosures, message } = preparePresentation(bundle, c, h.wallet.address);
    const signature = await h.wallet.signTypedData(presentationDomain(c.chainId, c.registry), PRESENTATION_TYPES, message);
    // Submit to the OTHER instance than the one that issued the challenge.
    const r = await h.call(n % 2 ? PUBLIC : B, "POST", "/api/verifier/presentations", { challengeId: c.challengeId, credentialJwt: bundle.credentialJwt, disclosures, salt: bundle.salt, proof: { holder: h.wallet.address, commitment: bundle.commitment, expiresAt: c.expiresAt, signature } });
    if (r.body.verified) verified++; else otherwise++;
  }));
  out.crossInstancePresentations = { verified, otherwise };

  // Control: 4 concurrent revocations on ONE instance (in-process lock serializes them).
  const one = await Promise.all(bundles.slice(0, 4).map((b) => issuer.call(PUBLIC, "POST", "/api/issuer/credentials/revoke", { commitment: b.commitment })));
  out.revokeSameInstance = one.map((r) => r.status === 200 ? "ok" : `${r.status} ${r.body?.error?.code}`);

  // Probe: 4 concurrent revocations split across BOTH instances (two processes, one issuer key).
  const split = await Promise.all(bundles.slice(4, 12).map((b, i) => issuer.call(i % 2 ? B : PUBLIC, "POST", "/api/issuer/credentials/revoke", { commitment: b.commitment })));
  out.revokeAcrossInstances = split.map((r) => r.status === 200 ? "ok" : `${r.status} ${r.body?.error?.code}: ${r.body?.error?.message}`);
  const statuses = await Promise.all(bundles.slice(4, 12).map(async (b) => Number(await registry.getFunction("credentialStatus")(b.commitment))));
  out.onChainStatusAfterSplit = statuses.map((s) => ["None", "Active", "Revoked", "IssuerInactive", "NotYetValid", "Expired"][s]);
  const audit = await issuer.call(B, "GET", "/api/issuer/audit");
  out.auditChain = audit.body.verification;
} finally {
  try { process.kill(-second.pid!, "SIGTERM"); } catch {}
  stack.stop();
}
console.log(JSON.stringify(out, null, 2));

const checks: [string, boolean][] = [
  ["a session created on one instance is valid on the other", out.issuerSignIn === 200 && out.sessionSharedAcrossInstances === 200],
  ["60/60 presentations verify when challenge and submission hit different instances", JSON.stringify(out.crossInstancePresentations) === '{"verified":60,"otherwise":0}'],
  ["4 concurrent revocations on one instance all succeed", (out.revokeSameInstance as string[]).every((x) => x === "ok")],
  ["8 concurrent revocations split across both instances all succeed", (out.revokeAcrossInstances as string[]).every((x) => x === "ok")],
  ["...and all 8 are Revoked on-chain", (out.onChainStatusAfterSplit as string[]).every((x) => x === "Revoked")],
  ["the shared audit chain is intact", (out.auditChain as { ok: boolean }).ok === true],
];
for (const [name, ok] of checks) console.log(`${ok ? "✔" : "✘"} ${name}`);
const failed = checks.filter(([, ok]) => !ok).length;
console.log(failed ? `\n✘ MULTI-INSTANCE TEST FAILED: ${failed} check(s)` : "\n✔ MULTI-INSTANCE TEST PASSED");
process.exit(failed ? 1 : 0);
