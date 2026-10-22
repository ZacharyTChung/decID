import { mkdirSync, rmSync } from "node:fs";
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
import { Actor, signIn, signPresentation, submission } from "./helpers/actors";

/**
 * Account recovery end to end on its own deployment: a holder loses wallet A (one
 * registered credential, one issued but not yet registered), re-applies from wallet B,
 * and the issuer shuts A's credentials down before issuing to B.
 */

const DIR = path.join(process.cwd(), ".test-data", "recovery");
let provider: JsonRpcProvider;
let registry: Contract;
const issuer = new Actor(1);
const APPLICATION = { fullName: "Recovery Sentinel", dateOfBirth: "1990-01-01", country: "ZZ", syntheticDataConfirmed: true };

async function request(holder: Actor, extra: Record<string, unknown> = {}, doc = "SYN-RECOV1") {
  return holder.call(h.postHolderRequest, "POST", { ...APPLICATION, documentNumber: doc, ...extra });
}

async function approveAndPickup(holder: Actor, requestId: string): Promise<{ bundle: HolderBundle; body: any }> {
  const approved = await issuer.call((r) => h.postIssuerDecision(r, requestId), "POST", { decision: "approve" });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const pickup = await holder.call((r) => h.postBundlePickup(r, requestId), "POST", {});
  return { bundle: pickup.body.bundle as HolderBundle, body: approved.body };
}

async function register(holder: Actor, bundle: HolderBundle) {
  await (await (registry.connect(holder.wallet) as Contract).getFunction("register")(bundle.authorization, bundle.authorizationSignature)).wait();
}

async function present(holder: Actor, bundle: HolderBundle): Promise<VerificationResult> {
  const ch = await holder.call(h.postChallenge, "POST", { action: "access-verified-member-area" });
  const c = ch.body as ChallengeResponse;
  return (await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment)))).body;
}

beforeAll(async () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  const envFile = path.join(DIR, "issuer.env");
  const trustFile = path.join(DIR, "trusted-issuers.json");
  const deploymentFile = path.join(DIR, "deployment.json");
  await setupKeys({ envFile, trustFile, appOrigin: process.env.APP_ORIGIN!, rpcUrl: process.env.RPC_URL!, force: true });
  const env = parseEnvFile(envFile);
  const d = await deployLocal({ rpcUrl: process.env.RPC_URL!, issuerEvmPrivateKey: env.ISSUER_EVM_PRIVATE_KEY!, deploymentFile, projectRoot: process.cwd() });
  registry = new Contract(d.registry, CREDENTIAL_REGISTRY_ABI, provider);
  Object.assign(process.env, {
    ISSUER_CREDENTIAL_PRIVATE_JWK: env.ISSUER_CREDENTIAL_PRIVATE_JWK,
    ISSUER_EVM_PRIVATE_KEY: env.ISSUER_EVM_PRIVATE_KEY,
    ISSUER_EVM_RETIRED_PRIVATE_KEYS: "",
    TRUSTED_ISSUERS_FILE: trustFile,
    DEPLOYMENT_FILE: deploymentFile,
    DATA_DIR: path.join(DIR, "data"),
  });
  expect((await signIn(issuer, "issuer", h)).status).toBe(200);
});

afterAll(() => provider.destroy());

describe("account recovery", () => {
  let lostSigner: Actor; // wallet A, later "lost"
  let registered: HolderBundle;
  let unregistered: HolderBundle;

  it("rejects a recovery that names the requester's own wallet", async () => {
    lostSigner = new Actor(2, provider);
    expect((await signIn(lostSigner, "holder", h)).status).toBe(200);
    const res = await request(lostSigner, { recoveryOf: lostSigner.address });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_RECOVERY");
  });

  it("revokes the lost wallet's registered credential and cancels its unregistered one before issuing anew", async () => {
    // Wallet A: one credential registered on-chain, one issued but never registered.
    registered = (await approveAndPickup(lostSigner, (await request(lostSigner, {}, "SYN-RECOVA1")).body.id)).bundle;
    await register(lostSigner, registered);
    unregistered = (await approveAndPickup(lostSigner, (await request(lostSigner, {}, "SYN-RECOVA2")).body.id)).bundle;
    expect((await present(lostSigner, registered)).verified).toBe(true);

    // Wallet B asks for recovery of A.
    const freshSigner = new Actor(3, provider);
    expect((await signIn(freshSigner, "holder", h)).status).toBe(200);
    const req = await request(freshSigner, { recoveryOf: lostSigner.address.toLowerCase() }, "SYN-RECOVB1");
    expect(req.status).toBe(201);
    const pending = (await issuer.call(h.getIssuerRequests, "GET")).body.requests.find((r: { id: string }) => r.id === req.body.id);
    expect(pending.recovery).toEqual({ previousHolder: lostSigner.address, liveCredentials: 2 });
    expect((await freshSigner.call(h.getHolderRequests, "GET")).body.requests[0].recoveryOf).toBe(lostSigner.address);

    const { bundle, body } = await approveAndPickup(freshSigner, req.body.id);
    expect(body.superseded).toEqual({ revoked: [registered.commitment], cancelled: [unregistered.commitment] });

    // A's registered credential is revoked; its unregistered bundle can never be registered.
    const old = await present(lostSigner, registered);
    expect(old.verified).toBe(false);
    expect(old.registryStatus).toBe("Revoked");
    await expect(
      (registry.connect(lostSigner.wallet) as Contract).getFunction("register").staticCall(unregistered.authorization, unregistered.authorizationSignature),
    ).rejects.toThrow();
    expect(await registry.getFunction("isAuthorizationCancelled")(unregistered.commitment, unregistered.authorization.issuer)).toBe(true);

    // B's new credential works.
    await register(freshSigner, bundle);
    expect((await present(freshSigner, bundle)).verified).toBe(true);
  });

  it("is idempotent: a second recovery of the same wallet finds nothing left to shut down", async () => {
    const other = new Actor(4, provider);
    expect((await signIn(other, "holder", h)).status).toBe(200);
    const req = await request(other, { recoveryOf: lostSigner.address }, "SYN-RECOVC1");
    const pending = (await issuer.call(h.getIssuerRequests, "GET")).body.requests.find((r: { id: string }) => r.id === req.body.id);
    expect(pending.recovery.liveCredentials).toBe(0);
    const { body } = await approveAndPickup(other, req.body.id);
    expect(body.superseded).toEqual({ revoked: [], cancelled: [] });
  });
});
