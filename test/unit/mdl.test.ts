import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider } from "ethers";
import { base64url } from "jose";
import * as h from "@/lib/server/api/handlers";
import { CREDENTIAL_REGISTRY_ABI } from "@/generated/contracts";
import type { HolderBundle } from "@/lib/shared/bundle";
import { decodeDisclosure } from "@/lib/shared/sd-jwt";
import { buildRequest, decryptResponse, newReaderKey, sessionTranscript, uncbor, type MdocRequest } from "@/lib/shared/mdl/annex-c";
import { MdlVerificationError, verifyMdlResponse } from "@/lib/shared/mdl/verify";
import { answerRequest, createTestAuthority, provisionTestLicence, type TestWallet } from "@/lib/shared/mdl/test-wallet";
import { listAudit } from "@/lib/server/issuer/audit";
import { readRecord } from "@/lib/server/chain";
import { setupKeys, parseEnvFile } from "../../scripts/lib/setup-keys";
import { deployLocal } from "../../scripts/lib/deploy";
import { Actor, signIn } from "./helpers/actors";

/**
 * Getting a Pass with the government ID in a phone's wallet (ISO 18013-7 Annex C over the
 * Digital Credentials API). Real cryptography end to end; only the licences are synthetic, signed
 * by a generated test authority, and the "phone" is the test wallet.
 */

const DIR = path.join(process.cwd(), ".test-data", "mdl");
const ORIGIN = () => process.env.APP_ORIGIN!;
const adult = "1990-04-12";
const nineteen = () => `${new Date().getUTCFullYear() - 19}-01-01`;

describe("the wallet protocol and licence verification (no server)", () => {
  let authority: Awaited<ReturnType<typeof createTestAuthority>>;
  let wallet: TestWallet;
  const anchors = () => [{ name: authority.name, pem: authority.rootPem, test: true }];

  async function exchange(w: TestWallet, origin = ORIGIN(), opts: Parameters<typeof answerRequest>[3] = {}) {
    const key = await newReaderKey();
    const request = await buildRequest(key.publicKey);
    const response = await answerRequest(w, request, origin, opts);
    return { key, request, response };
  }
  async function open(x: { key: Awaited<ReturnType<typeof newReaderKey>>; request: MdocRequest; response: string }, origin = ORIGIN()) {
    const t = await sessionTranscript(x.request.encryptionInfo, origin);
    return { deviceResponse: await decryptResponse(x.response, x.key.privateKey, t.plain), t };
  }

  beforeAll(async () => {
    authority = await createTestAuthority();
    wallet = await provisionTestLicence(authority, { birthDate: adult });
  });

  it("asks only for the age answers, and the wallet returns nothing else", async () => {
    const x = await exchange(wallet);
    const { deviceResponse, t } = await open(x);
    const v = await verifyMdlResponse(deviceResponse, t.tagged, anchors());
    expect(v).toMatchObject({ ageOver18: true, ageOver21: true, issuingCountry: "US", issuer: { test: true } });
    // The licence holds a name, birth date and licence number; none of it leaves the phone.
    const text = Buffer.from(deviceResponse).toString("latin1");
    for (const absent of ["birth_date", "family_name", "given_name", "document_number", adult]) expect(text).not.toContain(absent);
    expect(text).toContain("age_over_21");
  });

  it("an answer captured on another website does not open", async () => {
    const x = await exchange(wallet, "https://evil.example");
    await expect(open(x)).rejects.toThrow(/not made for this request on this site/);
  });

  it("rejects a licence from an issuer that is not trusted", async () => {
    const other = await createTestAuthority({ name: "Unknown authority" });
    const forged = await provisionTestLicence(other, { birthDate: adult });
    const { deviceResponse, t } = await open(await exchange(forged));
    await expect(verifyMdlResponse(deviceResponse, t.tagged, anchors())).rejects.toMatchObject({ code: "MDL_UNTRUSTED_ISSUER" });
  });

  it("rejects an answer edited after the state signed it", async () => {
    // Flip age_over_21 from true (0xf5) to false (0xf4) inside the issuer-signed item.
    const x = await exchange(wallet, ORIGIN(), {
      tamper: (b) => {
        const s = Buffer.from(b);
        const at = s.indexOf(Buffer.from("age_over_21"));
        const v = s.indexOf(0xf5, at);
        s[v] = 0xf4;
        return new Uint8Array(s);
      },
    });
    const { deviceResponse, t } = await open(x);
    await expect(verifyMdlResponse(deviceResponse, t.tagged, anchors())).rejects.toMatchObject({ code: "MDL_BAD_SIGNATURE" });
  });

  it("rejects a copied licence presented without the phone's device key", async () => {
    const thief = { ...wallet, devicePrivateJwk: (await provisionTestLicence(authority, { birthDate: adult })).devicePrivateJwk };
    const { deviceResponse, t } = await open(await exchange(thief));
    await expect(verifyMdlResponse(deviceResponse, t.tagged, anchors())).rejects.toMatchObject({ code: "MDL_NOT_DEVICE_SIGNED" });
  });

  it("rejects an answer that was signed for a different request", async () => {
    const a = await exchange(wallet);
    const b = await exchange(wallet);
    // Decrypt b honestly, then check it against a's transcript (a replay into another session).
    const { deviceResponse } = await open(b);
    const tA = await sessionTranscript(a.request.encryptionInfo, ORIGIN());
    await expect(verifyMdlResponse(deviceResponse, tA.tagged, anchors())).rejects.toMatchObject({ code: "MDL_NOT_DEVICE_SIGNED" });
  });

  it("rejects an expired mobile licence", async () => {
    const old = await provisionTestLicence(authority, { birthDate: adult, validDays: 30 }, new Date(Date.now() - 60 * 24 * 3600 * 1000));
    const { deviceResponse, t } = await open(await exchange(old));
    const err = await verifyMdlResponse(deviceResponse, t.tagged, anchors()).catch((e) => e);
    expect(err).toBeInstanceOf(MdlVerificationError);
    expect(["MDL_EXPIRED", "MDL_BAD_SIGNATURE"]).toContain(err.code);
  });

  it("the request is well-formed org-iso-mdoc", async () => {
    const r = await buildRequest((await newReaderKey()).publicKey);
    const ei = uncbor(base64url.decode(r.encryptionInfo)) as [string, Map<string, unknown>];
    expect(ei[0]).toBe("dcapi");
    expect((ei[1].get("nonce") as Uint8Array).length).toBe(16);
    const pk = ei[1].get("recipientPublicKey") as Map<number, unknown>;
    expect([pk.get(1), pk.get(-1)]).toEqual([2, 1]);
  });
});

describe("getting a Pass with a government ID (server)", () => {
  let provider: JsonRpcProvider;
  let registry: Contract;
  const alice = new Actor(2);
  const kid = new Actor(3);
  const teen = new Actor(4);
  let aliceWallet: TestWallet;

  async function licence(birthDate: string): Promise<TestWallet> {
    const r = await alice.call(h.postTestLicence, "POST", { birthDate });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { mdoc: new Uint8Array(Buffer.from(r.body.mdoc, "base64url")), devicePrivateJwk: r.body.devicePrivateJwk };
  }

  async function getPass(holder: Actor, w: TestWallet) {
    const start = await holder.call(h.postMdlRequest, "POST", {});
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect(start.body.protocol).toBe("org-iso-mdoc");
    const response = await answerRequest(w, start.body.data, ORIGIN());
    const done = await holder.call((r) => h.postMdlResponse(r, start.body.id), "POST", { response });
    return { start, done, response };
  }

  async function pickup(holder: Actor, requestId: string): Promise<HolderBundle> {
    const p = await holder.call((r) => h.postBundlePickup(r, requestId), "POST", {});
    expect(p.status).toBe(200);
    return p.body.bundle;
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
      MDL_TRUST_DIR: path.join(DIR, "no-real-roots"),
      MDL_ACCEPT_TEST_IDS: "1",
    });
    for (const a of [alice, kid, teen]) expect((await signIn(a, "holder", h)).status).toBe(200);
    aliceWallet = await licence(adult);
  });

  afterAll(() => {
    delete process.env.MDL_ACCEPT_TEST_IDS;
    delete process.env.MDL_TRUST_DIR;
    provider.destroy();
  });

  it("the public config says which ID issuers are accepted", async () => {
    const c = await alice.call(h.getConfig, "GET");
    expect(c.body.governmentId).toEqual({ issuers: [{ name: "decID Test DMV", test: true }], acceptsTestIds: true });
  });

  let aliceCommitment: string;
  it("issues a Pass from the licence: 21+, with no birth date anywhere", async () => {
    const { done } = await getPass(alice, aliceWallet);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ ageOver18: true, ageOver21: true, replacedPass: false, issuer: { name: "decID Test DMV", test: true } });
    const bundle = await pickup(alice, done.body.requestId);
    const claims = Object.fromEntries(bundle.disclosures.map((d) => [decodeDisclosure(d).name, decodeDisclosure(d).value]));
    expect(claims).toEqual({ ageOver18: true, ageOver21: true, countryOfResidence: "US" });
    // The credential never outlives the mobile licence it came from (valid one year here).
    expect(bundle.authorization.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 366 * 86400);
    aliceCommitment = bundle.commitment;
    await (await (registry.connect(alice.wallet.connect(provider)) as Contract).getFunction("register")(bundle.authorization, bundle.authorizationSignature)).wait();
    const entry = listAudit().find((e) => e.subject === bundle.commitment && e.action === "credential.issued");
    expect(entry).toMatchObject({ actor: "government-id", details: { evidence: "mdl:decID Test DMV (test)" } });
    expect(JSON.stringify(listAudit())).not.toContain(adult);
  });

  let aliceLatest: string;
  it("an answer can be used only once, and re-verifying replaces the holder's own Pass", async () => {
    const start = await alice.call(h.postMdlRequest, "POST", {});
    const response = await answerRequest(aliceWallet, start.body.data, ORIGIN());
    // Someone else submitting it gets nothing and does not consume it…
    const wrongUser = await kid.call((r) => h.postMdlResponse(r, start.body.id), "POST", { response });
    expect(wrongUser.body.error.code).toBe("MDL_REQUEST_NOT_FOUND");
    // …the first real submission does, and a replay is refused.
    const ok = await alice.call((r) => h.postMdlResponse(r, start.body.id), "POST", { response });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await alice.call((r) => h.postMdlResponse(r, start.body.id), "POST", { response })).body.error.code).toBe("MDL_REQUEST_NOT_FOUND");
    // The earlier, registered Pass was revoked on-chain before the new one was issued.
    expect(ok.body.superseded.revoked).toEqual([aliceCommitment]);
    expect((await readRecord(aliceCommitment)).revoked).toBe(true);
    aliceLatest = (await pickup(alice, ok.body.requestId)).commitment;
  });

  it("one licence backs one Pass: a Pass made for someone else shuts down the owner's", async () => {
    // The adult lends their licence to make a Pass on a child's phone.
    const { done } = await getPass(kid, aliceWallet);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.replacedPass).toBe(true);
    // Alice's unregistered Pass can now never be registered.
    expect(done.body.superseded.cancelled).toEqual([aliceLatest]);
    const kidBundle = await pickup(kid, done.body.requestId);
    expect(kidBundle.commitment).not.toBe(aliceLatest);
  });

  it("a 19-year-old's licence gives an 18+ Pass that answers no to 21+", async () => {
    const { done } = await getPass(teen, await licence(nineteen()));
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ageOver18: true, ageOver21: false });
  });

  it("refuses an answer from a different website or a malformed one", async () => {
    const start = await teen.call(h.postMdlRequest, "POST", {});
    const response = await answerRequest(await licence(adult), start.body.data, "https://evil.example");
    const r = await teen.call((x) => h.postMdlResponse(x, start.body.id), "POST", { response });
    expect([r.status, r.body.error.code]).toEqual([400, "MDL_BAD_RESPONSE"]);
    const s2 = await teen.call(h.postMdlRequest, "POST", {});
    expect((await teen.call((x) => h.postMdlResponse(x, s2.body.id), "POST", { response: "AAAA" })).body.error.code).toBe("MDL_BAD_RESPONSE");
  });

  it("test IDs can be switched off, and then nothing is trusted", async () => {
    process.env.MDL_ACCEPT_TEST_IDS = "0";
    try {
      expect((await alice.call(h.postTestLicence, "POST", { birthDate: adult })).status).toBe(404);
      expect((await alice.call(h.postMdlRequest, "POST", {})).body.error.code).toBe("MDL_NOT_CONFIGURED");
    } finally {
      process.env.MDL_ACCEPT_TEST_IDS = "1";
    }
  });
});
