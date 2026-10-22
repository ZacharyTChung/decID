import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonRpcProvider, toUtf8Bytes, hexlify } from "ethers";
import * as h from "@/lib/server/api/handlers";
import { db } from "@/lib/server/db";
import { SCHEMA_ID } from "@/lib/shared/constants";
import type { ChallengeResponse } from "@/lib/shared/api";
import type { HolderBundle } from "@/lib/shared/bundle";
import { Actor, contracts, signIn, signPresentation, submission } from "./helpers/actors";

/**
 * End-to-end API tests: real handlers, real SQLite, real signatures, real
 * contracts on a local Hardhat node. Nothing is mocked.
 */

const SENTINEL = {
  fullName: "Zyxwv Sentinel-Quokka",
  dateOfBirth: "1911-11-11",
  documentNumber: "SYN-SENTINEL4242",
  country: "ZZ",
};

let provider: JsonRpcProvider;
let deployment: { registry: string; gate: string; chainId: number };
let holder: Actor;
let other: Actor;
let issuer: Actor;
let bundle: HolderBundle;
let requestId: string;

beforeAll(async () => {
  provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  deployment = JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE!, "utf8"));
  holder = new Actor(2, provider);
  other = new Actor(3, provider);
  issuer = new Actor(1, provider);
});

afterAll(() => provider.destroy());

async function challenge(actor: Actor = holder): Promise<ChallengeResponse> {
  const res = await actor.call(h.postChallenge, "POST", { action: "access-verified-member-area" });
  expect(res.status).toBe(201);
  return res.body;
}

describe("authentication and authorization", () => {
  it("rejects unauthenticated access to holder and issuer routes", async () => {
    const anon = new Actor(5);
    expect((await anon.call(h.getHolderRequests, "GET")).body.error.code).toBe("UNAUTHENTICATED");
    expect((await anon.call(h.getIssuerRequests, "GET")).status).toBe(401);
    expect((await anon.call(h.postRevoke, "POST", { commitment: "0x" + "00".repeat(32) })).status).toBe(401);
  });

  it("rejects cross-origin state-changing requests and non-JSON bodies", async () => {
    const res = await holder.call(h.postSignInChallenge, "POST", { address: holder.address, chainId: 31337, role: "holder" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BAD_ORIGIN");
    const res2 = await holder.call(h.postSignInChallenge, "POST", undefined, { "content-type": "text/plain" });
    expect(res2.status).toBe(415);
  });

  it("signs in with SIWE, and a nonce cannot be reused", async () => {
    const ch = await holder.call(h.postSignInChallenge, "POST", { address: holder.address, chainId: 31337, role: "holder" });
    expect(ch.body.message).toContain("wants you to sign in with your Ethereum account");
    const signature = await holder.wallet.signMessage(ch.body.message);
    const ok = await holder.call(h.postSignInVerify, "POST", { message: ch.body.message, signature });
    expect(ok.status).toBe(200);
    expect(ok.body.session).toMatchObject({ address: holder.address, role: "holder" });
    const replay = await new Actor(2).call(h.postSignInVerify, "POST", { message: ch.body.message, signature });
    expect(replay.body.error.code).toBe("NONCE_INVALID");
  });

  it("rejects a signed SIWE message that differs from the one the server issued", async () => {
    const actor = new Actor(4);
    const ch = await actor.call(h.postSignInChallenge, "POST", { address: actor.address, chainId: 31337, role: "holder" });
    const edited = (ch.body.message as string).replace(/\nExpiration Time: .*/, "");
    const res = await actor.call(h.postSignInVerify, "POST", { message: edited, signature: await actor.wallet.signMessage(edited) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SIWE_MESSAGE_ALTERED");
  });

  it("returns stable 4xx codes for a bad address checksum and ignores malformed cookies", async () => {
    const bad = holder.address.replace(/[a-f]/, (c) => c.toUpperCase());
    const res = await holder.call(h.postSignInChallenge, "POST", { address: bad, chainId: 31337, role: "holder" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_ADDRESS");
    const anon = new Actor(5);
    anon.cookie = "did_mvp_sid=%E0%A4%A";
    const session = await anon.call(h.getSession, "GET");
    expect(session.status).toBe(200);
    expect(session.body.session).toBeNull();
  });

  it("rejects a SIWE signature from a different wallet and the wrong chain", async () => {
    const ch = await other.call(h.postSignInChallenge, "POST", { address: other.address, chainId: 31337, role: "holder" });
    const forged = await holder.wallet.signMessage(ch.body.message);
    expect((await other.call(h.postSignInVerify, "POST", { message: ch.body.message, signature: forged })).body.error.code).toBe("SIWE_INVALID");
    expect((await other.call(h.postSignInChallenge, "POST", { address: other.address, chainId: 1, role: "holder" })).body.error.code).toBe("WRONG_CHAIN");
  });

  it("refuses the issuer role to wallets not on the operator allowlist (privilege escalation)", async () => {
    const res = await holder.call(h.postSignInChallenge, "POST", { address: holder.address, chainId: 31337, role: "issuer" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_ISSUER_OPERATOR");
    // A holder session cannot call issuer endpoints.
    expect((await holder.call(h.getIssuerRequests, "GET")).body.error.code).toBe("FORBIDDEN");
    // Tampering with the role resource in a holder-signed message fails signature verification.
    const ch = await holder.call(h.postSignInChallenge, "POST", { address: holder.address, chainId: 31337, role: "holder" });
    const sig = await holder.wallet.signMessage(ch.body.message);
    const tampered = ch.body.message.replace("/roles/holder", "/roles/issuer");
    expect((await new Actor(2).call(h.postSignInVerify, "POST", { message: tampered, signature: sig })).status).toBe(401);
  });
});

describe("issuance lifecycle", () => {
  it("lets the holder submit a synthetic request bound to the session wallet", async () => {
    // Fields not in the schema (like a forged holder address) are rejected outright.
    const forged = await holder.call(h.postHolderRequest, "POST", { ...SENTINEL, syntheticDataConfirmed: true, holderAddress: other.address });
    expect(forged.body.error.code).toBe("VALIDATION_FAILED");
    const notSynthetic = await holder.call(h.postHolderRequest, "POST", { ...SENTINEL, documentNumber: "X1234567", syntheticDataConfirmed: true });
    expect(notSynthetic.body.error.code).toBe("VALIDATION_FAILED");
    expect(notSynthetic.body.error.message).not.toContain("X1234567");

    const res = await holder.call(h.postHolderRequest, "POST", { ...SENTINEL, syntheticDataConfirmed: true });
    expect(res.status).toBe(201);
    requestId = res.body.id;
    const list = await holder.call(h.getHolderRequests, "GET");
    expect(list.body.requests[0]).toMatchObject({ id: requestId, status: "pending", bundleAvailable: false });
  });

  it("lets only an issuer operator see and approve requests", async () => {
    expect((await holder.call((r) => h.postIssuerDecision(r, requestId), "POST", { decision: "approve" })).status).toBe(403);
    expect((await signIn(issuer, "issuer", h)).status).toBe(200);
    const pending = await issuer.call(h.getIssuerRequests, "GET");
    const mine = pending.body.requests.find((r: { id: string }) => r.id === requestId);
    expect(mine.application.documentNumber).toBe(SENTINEL.documentNumber);
    expect(mine.holderDid).toBe(`did:pkh:eip155:31337:${holder.address}`);

    const approved = await issuer.call((r) => h.postIssuerDecision(r, requestId), "POST", { decision: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    const again = await issuer.call((r) => h.postIssuerDecision(r, requestId), "POST", { decision: "approve" });
    expect(again.body.error.code).toBe("NOT_PENDING");
  });

  it("erases the synthetic application once decided", () => {
    const row = db().prepare("SELECT synthetic_json FROM issuer_requests WHERE id = ?").get(requestId) as { synthetic_json: string | null };
    expect(row.synthetic_json).toBeNull();
  });

  it("does not let another holder pick up the bundle, and pickup is one-time", async () => {
    expect((await signIn(other, "holder", h)).status).toBe(200);
    const stolen = await other.call((r) => h.postBundlePickup(r, requestId), "POST", {});
    expect(stolen.status).toBe(404);
    expect((await other.call(h.getHolderRequests, "GET")).body.requests).toEqual([]);

    const res = await holder.call((r) => h.postBundlePickup(r, requestId), "POST", {});
    expect(res.status).toBe(200);
    bundle = res.body.bundle;
    expect(bundle.authorization.holder).toBe(holder.address);
    expect((await holder.call((r) => h.postBundlePickup(r, requestId), "POST", {})).status).toBe(404);
    const leftovers = db().prepare("SELECT COUNT(*) AS n FROM issuer_bundle_pickup").get() as { n: number };
    expect(leftovers.n).toBe(0);
  });

  it("rejects presentation before on-chain registration", async () => {
    const c = await challenge();
    const res = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment)));
    expect(res.status).toBe(422);
    expect(res.body.checks.find((x: { id: string }) => x.id === "registry")).toMatchObject({ status: "fail", code: "NOT_REGISTERED" });
  });

  it("registers on-chain only from the holder wallet", async () => {
    const { registry } = contracts(provider, deployment);
    await expect(
      (registry.connect(other.wallet) as typeof registry).getFunction("register").staticCall(bundle.authorization, bundle.authorizationSignature),
    ).rejects.toThrow();
    const tx = await (registry.connect(holder.wallet) as typeof registry).getFunction("register")(bundle.authorization, bundle.authorizationSignature);
    expect((await tx.wait())?.status).toBe(1);
    expect(await registry.getFunction("isCredentialValid")(bundle.commitment, holder.address, SCHEMA_ID)).toBe(true);
  });
});

describe("presentation and verification", () => {
  it("verifies a valid presentation and discloses only the minimal claim", async () => {
    const c = await challenge();
    const res = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment)));
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.checks.every((x: { status: string }) => x.status === "pass")).toBe(true);
    expect(res.body.disclosed).toMatchObject({ identityVerified: true, holderDid: `did:pkh:eip155:31337:${holder.address}` });
    const text = JSON.stringify(res.body);
    for (const v of Object.values(SENTINEL)) expect(text).not.toContain(v);
    expect(text).not.toContain(bundle.salt.slice(2));
    expect(text).not.toContain(bundle.credentialJwt);
  });

  it("works without any issuer private key in the verifier's environment", async () => {
    const saved = { jwk: process.env.ISSUER_CREDENTIAL_PRIVATE_JWK, evm: process.env.ISSUER_EVM_PRIVATE_KEY };
    delete process.env.ISSUER_CREDENTIAL_PRIVATE_JWK;
    delete process.env.ISSUER_EVM_PRIVATE_KEY;
    try {
      const c = await challenge();
      const res = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment)));
      expect(res.body.verified).toBe(true);
    } finally {
      process.env.ISSUER_CREDENTIAL_PRIVATE_JWK = saved.jwk;
      process.env.ISSUER_EVM_PRIVATE_KEY = saved.evm;
    }
    // Static guard: the verifier and credential-verification modules never import issuer code or secrets.
    for (const f of ["src/lib/server/verifier/service.ts", "src/lib/server/credential/verify.ts", "src/lib/server/trust.ts"]) {
      const src = readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/issuerSecrets|issuer\/service|credential\/sign/);
    }
  });

  it("rejects a replayed challenge", async () => {
    const c = await challenge();
    const body = submission(c, bundle, await signPresentation(holder, c, bundle.commitment));
    expect((await holder.call(h.postPresentation, "POST", body)).body.verified).toBe(true);
    const replay = await holder.call(h.postPresentation, "POST", body);
    expect(replay.body.verified).toBe(false);
    expect(replay.body.checks[0]).toMatchObject({ id: "challenge", code: "CHALLENGE_REUSED" });
  });

  it("lets only one of many concurrent submissions consume a challenge", async () => {
    const c = await challenge();
    const body = submission(c, bundle, await signPresentation(holder, c, bundle.commitment));
    const results = await Promise.all(Array.from({ length: 8 }, () => holder.call(h.postPresentation, "POST", body)));
    expect(results.filter((r) => r.body.verified).length).toBe(1);
    expect(results.filter((r) => r.body.checks[0].code === "CHALLENGE_REUSED").length).toBe(7);
  });

  it("does not burn a challenge when the verifier is misconfigured", async () => {
    const c = await challenge();
    const body = submission(c, bundle, await signPresentation(holder, c, bundle.commitment));
    const saved = process.env.TRUSTED_ISSUERS_FILE;
    process.env.TRUSTED_ISSUERS_FILE = path.join(process.cwd(), ".test-data", "missing-trust.json");
    try {
      const res = await holder.call(h.postPresentation, "POST", body);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("TRUST_POLICY_MISSING");
    } finally {
      process.env.TRUSTED_ISSUERS_FILE = saved;
    }
    expect((await holder.call(h.postPresentation, "POST", body)).body.verified).toBe(true);
  });

  it("rejects an expired challenge", async () => {
    const c = await challenge();
    const body = submission(c, bundle, await signPresentation(holder, c, bundle.commitment));
    db().prepare("UPDATE verifier_challenges SET expires_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000) - 1, c.challengeId);
    const res = await holder.call(h.postPresentation, "POST", body);
    expect(res.body.checks[0]).toMatchObject({ id: "challenge", code: "CHALLENGE_EXPIRED" });
  });

  it("rejects proofs bound to the wrong audience, action, nonce or wallet", async () => {
    for (const override of [{ audience: "https://other-verifier.example" }, { action: "something-else" }, { nonce: "0x" + "77".repeat(32) }]) {
      const c = await challenge();
      const res = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment, override)));
      expect(res.body.checks.find((x: { id: string }) => x.id === "walletControl")).toMatchObject({ status: "fail", code: "PROOF_SIGNER_MISMATCH" });
    }
    // Another wallet presenting the holder's bundle: it can sign the proof for itself, but the credential subject is the holder.
    const c = await challenge();
    const res = await other.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(other, c, bundle.commitment)));
    expect(res.body.checks.find((x: { id: string }) => x.id === "holderBinding")).toMatchObject({ status: "fail", code: "SUBJECT_NOT_PRESENTER" });
  });

  it("rejects a wrong salt or altered token bytes", async () => {
    let c = await challenge();
    let res = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment), { salt: "0x" + "00".repeat(32) }));
    expect(res.body.checks.find((x: { id: string }) => x.id === "commitment")).toMatchObject({ status: "fail", code: "COMMITMENT_MISMATCH" });

    c = await challenge();
    const [hd, pl, sg] = bundle.credentialJwt.split(".");
    const altered = `${hd}.${pl}.${sg!.slice(0, -2)}${sg!.endsWith("AA") ? "BB" : "AA"}`;
    res = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment), { credentialJwt: altered }));
    expect(res.body.verified).toBe(false);
    expect(res.body.checks.find((x: { id: string }) => x.id === "tokenSignature")?.status).toBe("fail");
  });

  it("allows the gated action for the holder only", async () => {
    const { gate } = contracts(provider, deployment);
    await expect((gate.connect(other.wallet) as typeof gate).getFunction("checkIn").staticCall(bundle.commitment)).rejects.toThrow();
    const tx = await (gate.connect(holder.wallet) as typeof gate).getFunction("checkIn")(bundle.commitment);
    expect((await tx.wait())?.status).toBe(1);
  });
});

describe("revocation", () => {
  it("rejects revocation by a holder session", async () => {
    expect((await holder.call(h.postRevoke, "POST", { commitment: bundle.commitment })).body.error.code).toBe("FORBIDDEN");
  });

  it("revokes via the issuer, after which verification and the gate fail", async () => {
    // Two concurrent revocations: exactly one succeeds, the other gets a stable conflict code (never a 500).
    const [r1, r2] = await Promise.all([
      issuer.call(h.postRevoke, "POST", { commitment: bundle.commitment }),
      issuer.call(h.postRevoke, "POST", { commitment: bundle.commitment }),
    ]);
    const res = r1.status === 200 ? r1 : r2;
    const loser = r1.status === 200 ? r2 : r1;
    expect(res.status).toBe(200);
    expect(loser.status).toBe(409);
    expect(["ALREADY_REVOKED", "TX_REVERTED"]).toContain(loser.body.error.code);
    expect(res.body.txHash).toMatch(/^0x/);
    const issued = await issuer.call(h.getIssuedCredentials, "GET");
    expect(issued.body.credentials.find((x: { commitment: string }) => x.commitment === bundle.commitment).onChainStatus).toBe("Revoked");

    const c = await challenge();
    const v = await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle.commitment)));
    expect(v.body.verified).toBe(false);
    expect(v.body.registryStatus).toBe("Revoked");
    expect(v.body.checks.find((x: { id: string }) => x.id === "registry")).toMatchObject({ status: "fail", code: "REVOKED" });
    // The off-chain signature is still mathematically valid: revocation is a registry fact, reported separately.
    expect(v.body.checks.find((x: { id: string }) => x.id === "tokenSignature")?.status).toBe("pass");

    const { gate, registry } = contracts(provider, deployment);
    await expect((gate.connect(holder.wallet) as typeof gate).getFunction("checkIn").staticCall(bundle.commitment)).rejects.toThrow();
    await expect(
      (registry.connect(holder.wallet) as typeof registry).getFunction("register").staticCall(bundle.authorization, bundle.authorizationSignature),
    ).rejects.toThrow();
  });
});

describe("privacy regression check", () => {
  it("keeps raw identity fields, tokens and salts out of the chain and verifier storage", async () => {
    const latest = await provider.getBlockNumber();
    const chunks: string[] = [];
    for (let n = 0; n <= latest; n++) {
      const block = await provider.getBlock(n, true);
      for (const tx of block?.prefetchedTransactions ?? []) {
        chunks.push(tx.data);
        const receipt = await provider.getTransactionReceipt(tx.hash);
        for (const log of receipt?.logs ?? []) chunks.push(log.data, ...log.topics);
      }
    }
    const { registry } = contracts(provider, deployment);
    chunks.push(JSON.stringify((await registry.getFunction("getRecord")(bundle.commitment)).toArray(), (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    const haystack = chunks.join("|").toLowerCase();
    const needles = [...Object.values(SENTINEL), bundle.credentialJwt, bundle.credentialJwt.split(".")[1]!];
    for (const n of needles) {
      expect(haystack).not.toContain(n.toLowerCase());
      // Hex-encoded form too (skipping very short values, which could match random hex by chance).
      if (n.length >= 8) expect(haystack).not.toContain(hexlify(toUtf8Bytes(n)).slice(2).toLowerCase());
    }
    expect(haystack).not.toContain(bundle.salt.slice(2).toLowerCase());
    // The commitment is the only credential-derived value on-chain.
    expect(haystack).toContain(bundle.commitment.slice(2).toLowerCase());

    // Server-side storage: synthetic data erased, no tokens/salts kept by issuer or verifier tables.
    const dump = JSON.stringify([
      db().prepare("SELECT * FROM issuer_requests").all(),
      db().prepare("SELECT * FROM issuer_credentials").all(),
      db().prepare("SELECT * FROM issuer_bundle_pickup").all(),
      db().prepare("SELECT * FROM verifier_challenges").all(),
    ]);
    for (const v of Object.values(SENTINEL)) expect(dump).not.toContain(v);
    expect(dump).not.toContain(bundle.salt.slice(2));
    expect(dump).not.toContain(bundle.credentialJwt.split(".")[2]);
  });
});
