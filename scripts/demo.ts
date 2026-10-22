/**
 * npm run demo: headless end-to-end lifecycle against REAL local infrastructure.
 *
 *   request → approve → issue → register → present → verify → gated action
 *   → revoke → rejected verification and rejected gated action
 *
 * It starts its own Hardhat node (port 8546) and Next.js server (port 3100),
 * generates throwaway issuer keys under .demo/, deploys fresh contracts, and
 * drives everything over HTTP and JSON-RPC with real signatures from Hardhat's
 * public dev accounts. It exits with status 1 if any expected condition fails.
 * Your normal dev chain (8545), app (3000) and .data/ are not touched.
 */
import path from "node:path";
import { Contract, hexlify, toUtf8Bytes, type HDNodeWallet } from "ethers";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "../src/generated/contracts";
import { PRESENTATION_TYPES, presentationDomain, presentationStatement } from "../src/lib/shared/eip712";
import { SCHEMA_ID } from "../src/lib/shared/constants";
import { encryptBundle, decryptBundle } from "../src/lib/shared/bundle-crypto";
import type { HolderBundle } from "../src/lib/shared/bundle";
import type { ChallengeResponse } from "../src/lib/shared/api";
import type { VerificationResult } from "../src/lib/shared/verification";
import { DEV_ROLES, devWallet } from "./lib/dev-accounts";
import { startLocalStack, type LocalStack } from "./lib/local-stack";

const ROOT = process.cwd();
const CHAIN_PORT = 8546;
const APP_PORT = 3100;
const ORIGIN = `http://localhost:${APP_PORT}`;
const SYNTHETIC = { fullName: "Demo Sentinel-Okapi", dateOfBirth: "1990-01-01", documentNumber: "SYN-DEMO0001", country: "ZZ", syntheticDataConfirmed: true };

let stack: LocalStack | undefined;
let failures = 0;

function step(title: string) {
  console.log(`\n▶ ${title}`);
}
function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.log(`  ✘ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
  return condition;
}
function must(condition: boolean, label: string, detail?: unknown) {
  if (!check(condition, label, detail)) throw new Error(`cannot continue: ${label}`);
}

function shutdown() {
  stack?.stop();
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

/** HTTP client with a cookie jar and the Origin header a browser would send. */
class HttpActor {
  cookie = "";
  constructor(
    readonly name: string,
    readonly wallet: HDNodeWallet,
  ) {}
  get address() {
    return this.wallet.address;
  }
  async call(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${ORIGIN}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { origin: ORIGIN } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    return { status: res.status, body: await res.json() };
  }
  async signIn(role: "holder" | "issuer") {
    const ch = await this.call("POST", "/api/auth/challenge", { address: this.address, chainId: 31337, role });
    if (ch.status !== 200) return ch;
    const signature = await this.wallet.signMessage(ch.body.message);
    return this.call("POST", "/api/auth/verify", { message: ch.body.message, signature });
  }
}

async function present(actor: HttpActor, bundle: HolderBundle): Promise<VerificationResult> {
  const ch = await actor.call("POST", "/api/verifier/challenges", { action: "access-verified-member-area" });
  const c = ch.body as ChallengeResponse;
  const signature = await actor.wallet.signTypedData(presentationDomain(c.chainId, c.registry), PRESENTATION_TYPES, {
    statement: presentationStatement(c.audience, c.action),
    audience: c.audience,
    action: c.action,
    challenge: c.nonce,
    holder: actor.address,
    commitment: bundle.commitment,
    expiresAt: c.expiresAt,
  });
  const res = await actor.call("POST", "/api/verifier/presentations", {
    challengeId: c.challengeId,
    credentialJwt: bundle.credentialJwt,
    salt: bundle.salt,
    proof: { holder: actor.address, commitment: bundle.commitment, expiresAt: c.expiresAt, signature },
  });
  return res.body as VerificationResult;
}

function summarize(r: VerificationResult) {
  return r.checks.map((c) => `${c.id}:${c.status}${c.code ? `(${c.code})` : ""}`).join(" ");
}

async function main() {
  console.log("Decentralized identity MVP: headless lifecycle demo (synthetic data, local chain only)");

  step("Prepare local infrastructure");
  stack = await startLocalStack({
    dir: path.join(ROOT, ".demo"),
    chainPort: CHAIN_PORT,
    appPort: APP_PORT,
    mode: "dev",
    distDir: ".next-demo",
    log: (m) => check(true, m),
  });
  const { provider, deployment } = stack;

  const holder = new HttpActor("holder", devWallet(DEV_ROLES.holder, provider));
  const intruder = new HttpActor("intruder", devWallet(DEV_ROLES.otherHolder, provider));
  const issuer = new HttpActor("issuer", devWallet(DEV_ROLES.issuerOperator, provider));
  const registry = new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, provider);
  const gate = new Contract(deployment.gate, DEMO_GATE_ABI, provider);

  step("1. Holder proves wallet control (SIWE) and submits a synthetic request");
  must((await holder.signIn("holder")).status === 200, `holder ${holder.address} signed in`);
  const req = await holder.call("POST", "/api/holder/requests", SYNTHETIC);
  must(req.status === 201, "synthetic verification request submitted", req.body);
  const requestId = req.body.id as string;

  step("2. Issuer authorization is enforced server-side");
  check((await holder.call("POST", `/api/issuer/requests/${requestId}/decision`, { decision: "approve" })).status === 403, "holder session cannot approve");
  check((await intruder.signIn("issuer")).status === 403, "non-operator wallet cannot obtain the issuer role");
  must((await issuer.signIn("issuer")).status === 200, `issuer operator ${issuer.address} signed in`);

  step("3. Issuer reviews and approves; backend signs VC, computes commitment, signs EIP-712 authorization");
  const pending = await issuer.call("GET", "/api/issuer/requests");
  check(pending.body.requests.some((r: { id: string }) => r.id === requestId), "request visible to the issuer");
  const approval = await issuer.call("POST", `/api/issuer/requests/${requestId}/decision`, { decision: "approve" });
  must(approval.status === 200, "request approved and credential issued", approval.body);

  step("4. Holder picks up the private bundle (one-time) and makes an encrypted backup");
  check((await intruder.signIn("holder")).status === 200, "another wallet signs in as holder");
  check((await intruder.call("POST", `/api/holder/requests/${requestId}/bundle`, {})).status === 404, "another holder cannot pick up this bundle");
  const pickup = await holder.call("POST", `/api/holder/requests/${requestId}/bundle`, {});
  must(pickup.status === 200, "holder received the bundle");
  const bundle = pickup.body.bundle as HolderBundle;
  check((await holder.call("POST", `/api/holder/requests/${requestId}/bundle`, {})).status === 404, "server no longer holds the bundle after pickup");
  const encrypted = await encryptBundle(bundle, "demo export password 123", 100_000);
  check((await decryptBundle(encrypted, "demo export password 123")).commitment === bundle.commitment, "encrypted export round-trips");
  check(await decryptBundle(encrypted, "wrong password 1234").then(() => false, () => true), "wrong export password is rejected");

  step("5. Registration: only the holder can submit the issuer-authorized commitment");
  const asIntruder = registry.connect(intruder.wallet) as Contract;
  check(
    await asIntruder.getFunction("register").staticCall(bundle.authorization, bundle.authorizationSignature).then(() => false, () => true),
    "intruder cannot register the holder's authorization",
  );
  const regTx = await (registry.connect(holder.wallet) as Contract).getFunction("register")(bundle.authorization, bundle.authorizationSignature);
  const regReceipt = await regTx.wait();
  must(regReceipt?.status === 1, `registered on-chain in block ${regReceipt?.blockNumber}`);
  check(await registry.getFunction("isCredentialValid")(bundle.commitment, holder.address, SCHEMA_ID), "registry reports the credential valid for this holder and schema");

  step("6. Presentation: fresh challenge, consented EIP-712 proof, full verification");
  const ok = await present(holder, bundle);
  check(ok.verified, "verifier accepted the presentation", summarize(ok));
  check(ok.disclosed?.identityVerified === true && !JSON.stringify(ok).includes(SYNTHETIC.documentNumber), "only the minimal claim is disclosed");
  const stolen = await present(intruder, bundle);
  check(!stolen.verified && stolen.checks.some((c) => c.code === "SUBJECT_NOT_PRESENTER"), "a different wallet presenting the same bundle is rejected");

  step("7. Gated on-chain action");
  check(
    await (gate.connect(intruder.wallet) as Contract).getFunction("checkIn").staticCall(bundle.commitment).then(() => false, () => true),
    "gate rejects a wallet that does not hold the credential",
  );
  const gateTx = await (gate.connect(holder.wallet) as Contract).getFunction("checkIn")(bundle.commitment);
  check((await gateTx.wait())?.status === 1, "holder performed the gated check-in");
  check((await gate.getFunction("checkIns")(holder.address)) === 1n, "gate recorded one check-in");

  step("8. Issuer revokes the credential");
  const revoke = await issuer.call("POST", "/api/issuer/credentials/revoke", { commitment: bundle.commitment });
  must(revoke.status === 200, `revocation transaction ${revoke.body.txHash ?? ""}`, revoke.body);

  step("9. After revocation, verification and the gated action fail");
  const after = await present(holder, bundle);
  check(!after.verified && after.registryStatus === "Revoked", "fresh verification is rejected with registry status Revoked", summarize(after));
  check(
    await (gate.connect(holder.wallet) as Contract).getFunction("checkIn").staticCall(bundle.commitment).then(() => false, () => true),
    "gated action is rejected",
  );
  check(
    await (registry.connect(holder.wallet) as Contract)
      .getFunction("register")
      .staticCall(bundle.authorization, bundle.authorizationSignature)
      .then(() => false, () => true),
    "the revoked commitment cannot be re-registered",
  );

  step("10. Privacy regression scan of every transaction and event on the demo chain");
  const latest = await provider.getBlockNumber();
  const parts: string[] = [];
  for (let n = 0; n <= latest; n++) {
    const block = await provider.getBlock(n, true);
    for (const tx of block?.prefetchedTransactions ?? []) {
      parts.push(tx.data);
      for (const log of (await provider.getTransactionReceipt(tx.hash))?.logs ?? []) parts.push(log.data, ...log.topics);
    }
  }
  const hay = parts.join("|").toLowerCase();
  const needles = [SYNTHETIC.fullName, SYNTHETIC.documentNumber, SYNTHETIC.dateOfBirth, bundle.credentialJwt];
  const leaked = needles.filter((n) => hay.includes(n.toLowerCase()) || hay.includes(hexlify(toUtf8Bytes(n)).slice(2).toLowerCase()));
  check(leaked.length === 0, "no synthetic identity field or credential token in calldata or events", leaked);
  check(!hay.includes(bundle.salt.slice(2).toLowerCase()), "commitment salt never appears on-chain");

  provider.destroy();
}

main()
  .catch((err) => {
    failures += 1;
    console.error(`\n✘ demo aborted: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    shutdown();
    console.log(failures === 0 ? "\n✔ DEMO PASSED: every expected condition held." : `\n✘ DEMO FAILED: ${failures} condition(s) did not hold.`);
    process.exit(failures === 0 ? 0 : 1);
  });
