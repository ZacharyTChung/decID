import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider } from "ethers";
import * as h from "@/lib/server/api/handlers";
import { CREDENTIAL_REGISTRY_ABI } from "@/generated/contracts";
import type { HolderBundle } from "@/lib/shared/bundle";
import type { ChallengeResponse } from "@/lib/shared/api";
import type { VerificationResult } from "@/lib/shared/verification";
import { setupKeys, parseEnvFile } from "../../scripts/lib/setup-keys";
import { deployLocal } from "../../scripts/lib/deploy";
import { rotateIssuerKeys } from "../../scripts/lib/rotate-keys";
import { Actor, signIn, signPresentation, submission } from "./helpers/actors";

/**
 * Issuer key rotation end to end, on its own fresh registry deployment and data dir:
 * issue → rotate (retired) → old credential still verifies and is revocable with the
 * retired key → new credentials use the new keys → a compromised credential key rejects
 * what it signed → a compromised EVM signer is removed on-chain.
 */

const DIR = path.join(process.cwd(), ".test-data", "rotation");
const envFile = path.join(DIR, "issuer.env");
const trustFile = path.join(DIR, "trusted-issuers.json");
const deploymentFile = path.join(DIR, "deployment.json");
let provider: JsonRpcProvider;
let registry: Contract;
const issuer = new Actor(1);

/** Loads the (possibly rotated) issuer env into this test process, as an app restart would. */
function applyEnv() {
  const env = parseEnvFile(envFile);
  Object.assign(process.env, {
    ISSUER_CREDENTIAL_PRIVATE_JWK: env.ISSUER_CREDENTIAL_PRIVATE_JWK,
    ISSUER_EVM_PRIVATE_KEY: env.ISSUER_EVM_PRIVATE_KEY,
    ISSUER_EVM_RETIRED_PRIVATE_KEYS: env.ISSUER_EVM_RETIRED_PRIVATE_KEYS ?? "",
    TRUSTED_ISSUERS_FILE: trustFile,
    DEPLOYMENT_FILE: deploymentFile,
    DATA_DIR: path.join(DIR, "data"),
  });
}

async function issueAndRegister(holderIndex: number): Promise<{ holder: Actor; bundle: HolderBundle }> {
  const holder = new Actor(holderIndex, provider);
  expect((await signIn(holder, "holder", h)).status).toBe(200);
  const req = await holder.call(h.postHolderRequest, "POST", {
    fullName: "Rotation Sentinel",
    dateOfBirth: "1990-01-01",
    documentNumber: `SYN-ROT${holderIndex}`,
    country: "ZZ",
    syntheticDataConfirmed: true,
  });
  expect(req.status).toBe(201);
  const approved = await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const pickup = await holder.call((r) => h.postBundlePickup(r, req.body.id), "POST", {});
  const bundle = pickup.body.bundle as HolderBundle;
  const tx = await (registry.connect(holder.wallet) as Contract).getFunction("register")(bundle.authorization, bundle.authorizationSignature);
  await tx.wait();
  return { holder, bundle };
}

async function present(holder: Actor, bundle: HolderBundle): Promise<VerificationResult> {
  const ch = await holder.call(h.postChallenge, "POST", { action: "access-verified-member-area" });
  const c = ch.body as ChallengeResponse;
  const res = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment)));
  return res.body as VerificationResult;
}

const issuerDidOf = (b: HolderBundle) => JSON.parse(Buffer.from(b.credentialJwt.split(".")[1]!, "base64url").toString()).issuer as string;
const failCode = (r: VerificationResult) => r.checks.find((c) => c.status === "fail")?.code;

beforeAll(async () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  await setupKeys({ envFile, trustFile, appOrigin: process.env.APP_ORIGIN!, rpcUrl: process.env.RPC_URL!, force: true });
  const env = parseEnvFile(envFile);
  const d = await deployLocal({ rpcUrl: process.env.RPC_URL!, issuerEvmPrivateKey: env.ISSUER_EVM_PRIVATE_KEY!, deploymentFile, projectRoot: process.cwd() });
  registry = new Contract(d.registry, CREDENTIAL_REGISTRY_ABI, provider);
  applyEnv();
  expect((await signIn(issuer, "issuer", h)).status).toBe(200);
});

afterAll(() => provider.destroy());

describe("issuer key rotation", () => {
  let a: Awaited<ReturnType<typeof issueAndRegister>>;
  let b: Awaited<ReturnType<typeof issueAndRegister>>;

  it("retiring both keys keeps earlier credentials valid and revocable", async () => {
    a = await issueAndRegister(2);
    expect((await present(a.holder, a.bundle)).verified).toBe(true);
    const oldSigner = a.bundle.authorization.issuer;

    const rotated = await rotateIssuerKeys({ envFile, trustFile, which: "both", reason: "retired", rpcUrl: process.env.RPC_URL!, deploymentFile });
    expect(rotated.onChain).toEqual([`addIssuer(${rotated.newEvmSigner})`]);
    applyEnv();

    // The credential signed by the retired key, registered by the retired signer, still verifies.
    expect((await present(a.holder, a.bundle)).verified).toBe(true);
    const policy = JSON.parse(readFileSync(trustFile, "utf8"));
    expect(policy.issuers[0].credentialKeys.map((k: { status: string }) => k.status)).toEqual(["retired", "active"]);

    // New issuance uses the new keys.
    b = await issueAndRegister(3);
    expect(issuerDidOf(b.bundle)).toBe(rotated.newCredentialDid);
    expect(issuerDidOf(b.bundle)).not.toBe(issuerDidOf(a.bundle));
    expect(b.bundle.authorization.issuer).toBe(rotated.newEvmSigner);
    expect((await present(b.holder, b.bundle)).verified).toBe(true);

    // Revoking the old record needs the retired EVM key, which the server keeps for exactly this.
    const revoke = await issuer.call(h.postRevoke, "POST", { commitment: a.bundle.commitment });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    expect((await registry.getFunction("getRecord")(a.bundle.commitment)).issuer).toBe(oldSigner);
    expect(failCode(await present(a.holder, a.bundle))).toBe("REVOKED");
  });

  it("a compromised credential key invalidates what it signed; issuance continues with the replacement", async () => {
    const rotated = await rotateIssuerKeys({ envFile, trustFile, which: "credential", reason: "compromised", rpcUrl: process.env.RPC_URL!, deploymentFile });
    applyEnv();
    const r = await present(b.holder, b.bundle);
    expect(r.verified).toBe(false);
    expect(r.checks.find((c) => c.id === "issuerTrust")).toMatchObject({ status: "fail", code: "KEY_COMPROMISED" });

    const c = await issueAndRegister(4);
    expect(issuerDidOf(c.bundle)).toBe(rotated.newCredentialDid);
    expect((await present(c.holder, c.bundle)).verified).toBe(true);

    // A compromised EVM signer is removed on-chain: its records become IssuerInactive at once.
    const evm = await rotateIssuerKeys({ envFile, trustFile, which: "evm", reason: "compromised", rpcUrl: process.env.RPC_URL!, deploymentFile });
    expect(evm.onChain).toContain(`removeIssuer(${c.bundle.authorization.issuer})`);
    applyEnv();
    const after = await present(c.holder, c.bundle);
    expect(after.verified).toBe(false);
    expect(after.registryStatus).toBe("IssuerInactive");
    expect(parseEnvFile(envFile).ISSUER_EVM_RETIRED_PRIVATE_KEYS!.split(",")).toHaveLength(1); // compromised key discarded
  });

  it("refuses to issue with keys that are no longer active in the policy", async () => {
    const stale = parseEnvFile(envFile);
    await rotateIssuerKeys({ envFile, trustFile, which: "credential", reason: "retired", rpcUrl: process.env.RPC_URL!, deploymentFile });
    // Simulate a server that was not restarted after rotation: it still has the old key.
    process.env.ISSUER_CREDENTIAL_PRIVATE_JWK = stale.ISSUER_CREDENTIAL_PRIVATE_JWK;
    const holder = new Actor(5, provider);
    await signIn(holder, "holder", h);
    const req = await holder.call(h.postHolderRequest, "POST", {
      fullName: "Stale Key",
      dateOfBirth: "1990-01-01",
      documentNumber: "SYN-STALE1",
      country: "ZZ",
      syntheticDataConfirmed: true,
    });
    const res = await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ISSUER_KEY_NOT_ACTIVE");
  });
});
