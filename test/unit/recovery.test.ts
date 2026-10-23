import { mkdirSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
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
import { canonicalJson, verifyAuditChain } from "@/lib/server/issuer/audit";
import { createHash } from "node:crypto";

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
  return (await holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle)))).body;
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

describe("issuer audit log", () => {
  it("records every issuer action in a hash chain that verifies", async () => {
    // Add a rejection and an operator revocation to the actions above.
    const holder = new Actor(5, provider);
    expect((await signIn(holder, "holder", h)).status).toBe(200);
    const rejected = await request(holder, {}, "SYN-AUDIT01");
    expect((await issuer.call((r) => h.postIssuerDecision(r, rejected.body.id), "POST", { decision: "reject", reason: "audit test" })).status).toBe(200);
    const { bundle } = await approveAndPickup(holder, (await request(holder, {}, "SYN-AUDIT02")).body.id);
    await register(holder, bundle);
    expect((await issuer.call(h.postRevoke, "POST", { commitment: bundle.commitment })).status).toBe(200);

    const res = await issuer.call(h.getIssuerAudit, "GET");
    expect(res.status).toBe(200);
    expect(res.body.verification.ok).toBe(true);
    const actions = (res.body.entries as { action: string }[]).map((e) => e.action).reverse();
    expect(actions).toEqual([
      "credential.issued", // A, registered
      "credential.issued", // A, unregistered
      "credential.superseded",
      "credential.superseded",
      "credential.issued", // B
      "credential.issued", // C (nothing to supersede)
      "request.rejected",
      "credential.issued",
      "credential.revoked",
    ]);
    expect(res.body.verification.entries).toBe(actions.length);
    expect(res.body.entries[0].subject).toBe(bundle.commitment);

    // Holders cannot read it.
    expect((await holder.call(h.getIssuerAudit, "GET")).status).toBe(403);
  });

  it("never stores application data, tokens or salts", () => {
    const audit = new Database(path.join(DIR, "data", "app.sqlite"), { readonly: true });
    const dump = JSON.stringify(audit.prepare("SELECT * FROM issuer_audit").all());
    audit.close();
    expect(dump.length).toBeGreaterThan(100);
    for (const secret of ["Recovery Sentinel", "SYN-RECOV", "SYN-AUDIT", "1990-01-01", "eyJ", "salt"]) expect(dump).not.toContain(secret);
  });

  describe("detects tampering", () => {
    // Tamper with a consistent copy (online backup, so WAL contents are included), never the live database.
    async function tampered(sql: string): Promise<ReturnType<typeof verifyAuditChain>> {
      const copy = path.join(DIR, `tamper-${Math.random().toString(36).slice(2)}.sqlite`);
      const live = new Database(path.join(DIR, "data", "app.sqlite"), { readonly: true });
      await live.backup(copy);
      live.close();
      const d = new Database(copy);
      try {
        d.exec(sql);
        return verifyAuditChain(d);
      } finally {
        d.close();
      }
    }

    it("an edited entry", async () => {
      const v = await tampered(`UPDATE issuer_audit SET details = '{"reason":"nothing to see"}' WHERE seq = 7`);
      expect(v).toMatchObject({ ok: false, firstBrokenSeq: 7, problem: "entry content does not match its hash" });
    });

    it("an edited entry whose hash was recomputed (breaks the next link)", async () => {
      const d = new Database(path.join(DIR, "data", "app.sqlite"), { readonly: true });
      const e = d.prepare("SELECT * FROM issuer_audit WHERE seq = 3").get() as { seq: number; at: number; action: string; subject: string; details: string; prev_hash: string };
      d.close();
      const forged = { ...e, actor: "0x0000000000000000000000000000000000000001" };
      // Recompute entry 3's own hash so it is self-consistent; entry 4 still points at the old hash.
      const hash = createHash("sha256")
        .update(forged.prev_hash)
        .update(canonicalJson({ seq: forged.seq, at: forged.at, actor: forged.actor, action: forged.action, subject: forged.subject, details: JSON.parse(forged.details) }))
        .digest("hex");
      const v = await tampered(`UPDATE issuer_audit SET actor = '${forged.actor}', hash = '${hash}' WHERE seq = 3`);
      expect(v).toMatchObject({ ok: false, firstBrokenSeq: 4, problem: "link to previous entry broken" });
    });

    it("a deleted entry", async () => {
      expect(await tampered("DELETE FROM issuer_audit WHERE seq = 5")).toMatchObject({ ok: false, firstBrokenSeq: 6 });
    });

    it("reordered entries", async () => {
      const v = await tampered("UPDATE issuer_audit SET seq = seq + 100 WHERE seq IN (2, 3); UPDATE issuer_audit SET seq = 3 WHERE seq = 102; UPDATE issuer_audit SET seq = 2 WHERE seq = 103;");
      expect(v).toMatchObject({ ok: false, firstBrokenSeq: 2 });
    });

    it("but not truncation of the newest entries, which is why the head hash must be kept elsewhere", async () => {
      const live = new Database(path.join(DIR, "data", "app.sqlite"), { readonly: true });
      const before = verifyAuditChain(live);
      live.close();
      const v = await tampered("DELETE FROM issuer_audit WHERE seq = (SELECT MAX(seq) FROM issuer_audit)");
      expect(v.ok).toBe(true);
      expect(v.head).not.toBe(before.head);
    });
  });
});
