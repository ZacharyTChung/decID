/**
 * npm run bench: latency and throughput of the main flows against a LIVE local stack
 * (production build of the app, Hardhat node with automine), plus on-chain gas per action.
 *
 * Rate limiting is disabled for the run (DISABLE_RATE_LIMIT=1): this measures the cost of the
 * work, not the limiter. Every verification result is also checked for correctness, so a
 * run that is fast because it fails counts as a failure (exit 1). Writes .bench/REPORT.md.
 *
 * Numbers depend on the machine; they are for comparing changes, not for capacity planning.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Contract } from "ethers";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "../src/generated/contracts";
import { PRESENTATION_TYPES, presentationDomain } from "../src/lib/shared/eip712";
import { preparePresentation } from "../src/lib/shared/presentation";
import type { HolderBundle } from "../src/lib/shared/bundle";
import type { ChallengeResponse } from "../src/lib/shared/api";
import type { VerificationResult } from "../src/lib/shared/verification";
import { DEV_ROLES, devWallet } from "./lib/dev-accounts";
import { HttpActor } from "./lib/http-actor";
import { startLocalStack, type LocalStack } from "./lib/local-stack";

const DIR = path.join(process.cwd(), ".bench");
const SYNTHETIC = { fullName: "Bench Sentinel-Okapi", dateOfBirth: "1950-05-05", country: "ZZ", syntheticDataConfirmed: true };
const HOLDERS = [2, 3, 4, 5];
const PRESENTATIONS = Number(process.env.BENCH_PRESENTATIONS ?? 240);
const CONCURRENCY = [1, 8, 32];

let stack: LocalStack;

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1]!, mean: s.reduce((a, b) => a + b, 0) / s.length };
}
const fmt = (x: number) => x.toFixed(1);

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await fn();
  return [r, performance.now() - t];
}

/** Holder side: the disclosures the challenge requests and the signed proof (not timed). */
async function presentation(a: HttpActor, c: ChallengeResponse, bundle: HolderBundle) {
  const { disclosures, message } = preparePresentation(bundle, c, a.address);
  const signature = await a.wallet.signTypedData(presentationDomain(c.chainId, c.registry), PRESENTATION_TYPES, message);
  return {
    challengeId: c.challengeId,
    credentialJwt: bundle.credentialJwt,
    disclosures,
    salt: bundle.salt,
    proof: { holder: a.address, commitment: bundle.commitment, expiresAt: c.expiresAt, signature },
  };
}

async function main() {
  console.log("Benchmark against a live local stack (synthetic data, local chain only)\n");
  mkdirSync(DIR, { recursive: true });
  stack = await startLocalStack({
    dir: DIR,
    chainPort: 8551,
    appPort: 3301,
    mode: "start",
    distDir: ".next-bench",
    appEnv: { DISABLE_RATE_LIMIT: "1" },
    log: (m) => console.log(`  setup: ${m}`),
  });
  const failures: string[] = [];
  const rows: string[] = [];
  const gas: Record<string, bigint> = {};

  const issuer = new HttpActor(stack.origin, "issuer", devWallet(DEV_ROLES.issuerOperator, stack.provider));
  if ((await issuer.signIn("issuer")).status !== 200) throw new Error("issuer sign-in failed");
  const registry = new Contract(stack.deployment.registry, CREDENTIAL_REGISTRY_ABI, stack.provider);
  const gate = new Contract(stack.deployment.gate, DEMO_GATE_ABI, stack.provider);

  // ---- warm-up (first requests compile route modules and open the database)
  for (let i = 0; i < 5; i++) await issuer.call("GET", "/api/config");

  // ---- issuance: request + approve (VC signing, commitment, EIP-712 authorization; no transaction)
  const holders: { actor: HttpActor; bundle: HolderBundle }[] = [];
  const submitMs: number[] = [];
  const approveMs: number[] = [];
  const pickupMs: number[] = [];
  for (const [i, index] of HOLDERS.entries()) {
    const actor = new HttpActor(stack.origin, `holder-${index}`, devWallet(index, stack.provider));
    if ((await actor.signIn("holder")).status !== 200) throw new Error("holder sign-in failed");
    let bundle: HolderBundle | undefined;
    for (let k = 0; k < 3; k++) {
      const [req, t1] = await timed(() => actor.call("POST", "/api/holder/requests", { ...SYNTHETIC, documentNumber: `SYN-BENCH${i}${k}` }));
      submitMs.push(t1);
      const [ok, t2] = await timed(() => issuer.call("POST", `/api/issuer/requests/${req.body.id}/decision`, { decision: "approve" }));
      approveMs.push(t2);
      if (ok.status !== 200) failures.push(`approve: HTTP ${ok.status}`);
      const [pickup, t3] = await timed(() => actor.call("POST", `/api/holder/requests/${req.body.id}/bundle`, {}));
      pickupMs.push(t3);
      bundle = pickup.body.bundle as HolderBundle; // keep the last one
    }
    // ---- registration gas (holder pays)
    const receipt = await (await (registry.connect(actor.wallet) as Contract).getFunction("register")(bundle!.authorization, bundle!.authorizationSignature)).wait();
    gas.register = receipt!.gasUsed;
    holders.push({ actor, bundle: bundle! });
  }
  rows.push(`| Submit synthetic request | ${statRow(submitMs)} |`, `| Approve (sign VC + EIP-712 authorization) | ${statRow(approveMs)} |`, `| One-time bundle pickup | ${statRow(pickupMs)} |`);

  // ---- verification under concurrency
  const verifyRows: string[] = [];
  for (const c of CONCURRENCY) {
    const challengeMs: number[] = [];
    const presentMs: number[] = [];
    let next = 0;
    let bad = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: c }, async () => {
        while (next < PRESENTATIONS) {
          const n = next++;
          const h = holders[n % holders.length]!;
          const [ch, t1] = await timed(() => h.actor.call("POST", "/api/verifier/challenges", { action: "access-verified-member-area" }));
          challengeMs.push(t1);
          const challenge = ch.body as ChallengeResponse;
          const body = await presentation(h.actor, challenge, h.bundle); // client-side; not timed
          const [res, t2] = await timed(() => h.actor.call("POST", "/api/verifier/presentations", body));
          presentMs.push(t2);
          if (res.status !== 200 || !(res.body as VerificationResult).verified) bad++;
        }
      }),
    );
    const wall = (performance.now() - started) / 1000;
    if (bad) failures.push(`concurrency ${c}: ${bad} presentations did not verify`);
    const s = stats(presentMs);
    verifyRows.push(`| ${c} | ${s.n} | ${fmt(stats(challengeMs).p50)} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${(s.n / wall).toFixed(1)} |`);
    console.log(`  verify c=${c}: p50 ${fmt(s.p50)} ms, p95 ${fmt(s.p95)} ms, ${(s.n / wall).toFixed(1)} verifications/s${bad ? `, ${bad} FAILED` : ""}`);
  }

  // ---- gated action + revocation (transactions, automine)
  const h0 = holders[0]!;
  const checkIn = await (await (gate.connect(h0.actor.wallet) as Contract).getFunction("checkIn")(h0.bundle.commitment)).wait();
  gas.checkIn = checkIn!.gasUsed;
  const [rev, revMs] = await timed(() => issuer.call("POST", "/api/issuer/credentials/revoke", { commitment: h0.bundle.commitment }));
  if (rev.status !== 200) failures.push(`revoke: HTTP ${rev.status}`);
  else gas.revoke = (await stack.provider.getTransactionReceipt(rev.body.txHash))!.gasUsed;
  rows.push(`| Revoke (send + mine transaction, automine) | ${fmt(revMs)} | – | – | 1 |`);
  // After revocation the same holder must be rejected: correctness check at the end of the load.
  const ch = (await h0.actor.call("POST", "/api/verifier/challenges", { action: "access-verified-member-area" })).body as ChallengeResponse;
  const after = await h0.actor.call("POST", "/api/verifier/presentations", await presentation(h0.actor, ch, h0.bundle));
  if (after.status !== 422) failures.push("revoked credential still verified");

  const [audit, auditMs] = await timed(() => issuer.call("GET", "/api/issuer/audit"));
  if (!audit.body.verification?.ok) failures.push("audit chain not intact after the run");
  rows.push(`| Audit chain verification (${audit.body.verification?.entries} entries) | ${fmt(auditMs)} | – | – | 1 |`);

  stack.stop();

  const env = `${os.cpus()[0]?.model ?? "unknown CPU"} × ${os.cpus().length}, Node ${process.version}, ${os.platform()}`;
  const report = [
    "# Benchmark report",
    "",
    `Generated by \`npm run bench\` on ${new Date().toISOString().slice(0, 10)}. Environment: ${env}. Production build (\`next start\`), Hardhat node with automine, SQLite on local disk, rate limiting disabled. Client and server share the machine.`,
    "",
    "## Request latency (ms)",
    "",
    "| Operation | p50 | p95 | max | n |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Verification under load",
    "",
    `Each verification is a challenge request, a client-side EIP-712 signature (not timed) and a presentation request. The presentation runs every check: proof (ECDSA recovery), JWS signature (Ed25519), profile, commitment, and a live \`getRecord\` + \`credentialStatus\` read from the chain. ${PRESENTATIONS} presentations per row, over ${HOLDERS.length} registered credentials.`,
    "",
    "| Concurrency | n | challenge p50 | present p50 | present p95 | present p99 | verifications/s |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...verifyRows,
    "",
    "## Gas (from receipts)",
    "",
    "| Transaction | Paid by | Gas |",
    "| --- | --- | --- |",
    `| \`register\` | holder | ${gas.register ?? "–"} |`,
    `| \`DemoGate.checkIn\` (first) | holder | ${gas.checkIn ?? "–"} |`,
    `| \`revoke\` | issuer | ${gas.revoke ?? "–"} |`,
    "",
    "Full per-function statistics: `npm run test:gas` (Hardhat gas stats over the contract test suite).",
    "",
    failures.length ? `## FAILURES\n\n${failures.map((f) => `- ${f}`).join("\n")}` : "All verifications returned the expected result.",
    "",
  ].join("\n");
  writeFileSync(path.join(DIR, "REPORT.md"), report);
  console.log(`\n${report}`);
  console.log(failures.length ? `✘ BENCH FAILED: ${failures.length} correctness problem(s)` : "✔ bench complete. Report: .bench/REPORT.md");
  process.exit(failures.length ? 1 : 0);
}

function statRow(ms: number[]) {
  const s = stats(ms);
  return `${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${s.n}`;
}

main().catch((e) => {
  console.error(e);
  stack?.stop();
  process.exit(1);
});
