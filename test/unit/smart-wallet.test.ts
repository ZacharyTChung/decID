import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, ContractFactory, JsonRpcProvider, type InterfaceAbi } from "ethers";
import * as h from "@/lib/server/api/handlers";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "@/generated/contracts";
import { PRESENTATION_TYPES, presentationDomain } from "@/lib/shared/eip712";
import { preparePresentation } from "@/lib/shared/presentation";
import type { HolderBundle } from "@/lib/shared/bundle";
import type { ChallengeResponse } from "@/lib/shared/api";
import type { VerificationResult } from "@/lib/shared/verification";
import { Actor, signIn } from "./helpers/actors";

/**
 * Smart-account holders: a contract wallet (EIP-1271) holds the credential. Its owner key
 * signs on its behalf; the app verifies through isValidSignature, and the wallet itself is
 * msg.sender at the registry and the gate.
 */

let provider: JsonRpcProvider;
let deployment: { registry: string; gate: string };
let wallet: Contract; // the holder: a contract account
let walletAddress: string;
const owner = new Actor(6); // the EOA key that controls the contract wallet
const stranger = new Actor(7);
const issuer = new Actor(1);
const session = new Actor(6); // cookie jar for the contract wallet's session

beforeAll(async () => {
  provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  deployment = JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE!, "utf8"));
  const artifact = JSON.parse(
    readFileSync(path.join(process.cwd(), "artifacts/contracts/testing/SimpleSmartWallet.sol/SimpleSmartWallet.json"), "utf8"),
  ) as { abi: InterfaceAbi; bytecode: string };
  const ownerSigner = owner.wallet.connect(provider);
  wallet = (await new ContractFactory(artifact.abi, artifact.bytecode, ownerSigner).deploy(owner.address)) as unknown as Contract;
  await wallet.waitForDeployment();
  walletAddress = await wallet.getAddress();
});

afterAll(() => provider.destroy());

/** SIWE for the contract wallet: the message names the wallet; its owner signs (verified via EIP-1271). */
async function signInAsWallet(signer: Actor) {
  const ch = await session.call(h.postSignInChallenge, "POST", { address: walletAddress, chainId: 31337, role: "holder" });
  expect(ch.status).toBe(200);
  return session.call(h.postSignInVerify, "POST", { message: ch.body.message, signature: await signer.wallet.signMessage(ch.body.message) });
}

/** Calls `target` through the wallet, so msg.sender is the wallet. */
async function viaWallet(target: string, data: string) {
  const asOwner = wallet.connect(owner.wallet.connect(provider)) as Contract;
  return (await asOwner.getFunction("execute")(target, data)).wait();
}

async function present(signer: Actor, bundle: HolderBundle): Promise<VerificationResult> {
  const c = (await session.call(h.postChallenge, "POST", { action: "access-verified-member-area" })).body as ChallengeResponse;
  const { disclosures, message } = preparePresentation(bundle, c, walletAddress);
  const signature = await signer.wallet.signTypedData(presentationDomain(c.chainId, c.registry), PRESENTATION_TYPES, message);
  const res = await session.call(h.postPresentation, "POST", {
    challengeId: c.challengeId,
    credentialJwt: bundle.credentialJwt,
    disclosures,
    salt: bundle.salt,
    proof: { holder: walletAddress, commitment: bundle.commitment, expiresAt: c.expiresAt, signature },
  });
  return res.body as VerificationResult;
}

describe("EIP-1271 smart-account holder", () => {
  let bundle: HolderBundle;

  it("signs in only with a signature the wallet contract accepts", async () => {
    const forged = await signInAsWallet(stranger);
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe("SIWE_INVALID");
    const ok = await signInAsWallet(owner);
    expect(ok.status).toBe(200);
    expect(ok.body.session.address).toBe(walletAddress);
  });

  it("receives a credential for the contract's did:pkh, registers and checks in through the wallet", async () => {
    const req = await session.call(h.postHolderRequest, "POST", {
      fullName: "Smart Account Sentinel",
      dateOfBirth: "1990-01-01",
      documentNumber: "SYN-SMART1",
      country: "ZZ",
      syntheticDataConfirmed: true,
    });
    expect(req.status).toBe(201);
    expect((await signIn(issuer, "issuer", h)).status).toBe(200);
    expect((await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" })).status).toBe(200);
    bundle = (await session.call((r) => h.postBundlePickup(r, req.body.id), "POST", {})).body.bundle;
    expect(bundle.authorization.holder).toBe(walletAddress);

    const registry = new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, provider);
    await viaWallet(deployment.registry, registry.interface.encodeFunctionData("register", [bundle.authorization, bundle.authorizationSignature]));
    const gate = new Contract(deployment.gate, DEMO_GATE_ABI, provider);
    await viaWallet(deployment.gate, gate.interface.encodeFunctionData("checkIn", [bundle.commitment]));
    expect(await gate.getFunction("checkIns")(walletAddress)).toBe(1n);
  });

  it("verifies a presentation via EIP-1271 and rejects one signed by another key", async () => {
    const ok = await present(owner, bundle);
    expect(ok.verified).toBe(true);
    expect(ok.checks.find((c) => c.id === "walletControl")).toMatchObject({ status: "pass", detail: "EIP-1271 contract wallet" });
    expect(ok.disclosed?.holderDid).toBe(`did:pkh:eip155:31337:${walletAddress}`);

    const bad = await present(stranger, bundle);
    expect(bad.verified).toBe(false);
    expect(bad.checks.find((c) => c.id === "walletControl")).toMatchObject({ status: "fail", code: "PROOF_SIGNER_MISMATCH" });
  });
});
