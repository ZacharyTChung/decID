import path from "node:path";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, Interface, JsonRpcProvider, Wallet } from "ethers";
import * as h from "@/lib/server/api/handlers";
import { CREDENTIAL_REGISTRY_ABI } from "@/generated/contracts";
import { db } from "@/lib/server/db";
import { createMerchant } from "@/lib/server/verify-api/merchants";
import { verifyReceipt, verifyReceiptChain } from "@/lib/server/verify-api/receipts";
import { PRESENTATION_TYPES, presentationDomain } from "@/lib/shared/eip712";
import { preparePresentation } from "@/lib/shared/presentation";
import type { HolderBundle } from "@/lib/shared/bundle";
import { Actor, signIn } from "./helpers/actors";

/**
 * decID Verify (business API) and decID Pass server support, end to end on the test chain:
 * a business asks one question, a holder answers from their wallet, the business learns the
 * answer and nothing else, and gets a signed receipt.
 */

let provider: JsonRpcProvider;
let registryAddress: string;
const issuer = new Actor(1);
const adult = new Actor(10);
const minor = new Actor(11);
const other = new Actor(12);
let keyA: string;
let keyB: string;
let adultBundle: HolderBundle;
let minorBundle: HolderBundle;
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const app = (doc: string, dateOfBirth: string) => ({ fullName: "Verify Sentinel-Lynx", dateOfBirth, documentNumber: doc, country: "ZZ", syntheticDataConfirmed: true });

async function issueTo(holder: Actor, doc: string, dob: string, register = true): Promise<HolderBundle> {
  const req = await holder.call(h.postHolderRequest, "POST", app(doc, dob));
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  if (req.body.status !== "approved") expect((await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" })).status).toBe(200);
  const bundle = (await holder.call((r) => h.postBundlePickup(r, req.body.id), "POST", {})).body.bundle as HolderBundle;
  if (register) {
    const reg = new Contract(bundle.deployment.registry, CREDENTIAL_REGISTRY_ABI, holder.wallet.connect(provider));
    await (await reg.getFunction("register")(bundle.authorization, bundle.authorizationSignature)).wait();
  }
  return bundle;
}

async function newSession(key: string, policy = "age_over_21", reference?: string) {
  const res = await issuer.call(h.postVerification, "POST", { policy, ...(reference ? { reference } : {}) }, bearer(key));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; walletUrl: string; status: string };
}

/** The holder's wallet: fetch the request, build the presentation with the real holder code, sign, send. */
async function answer(holder: Actor, id: string, bundle: HolderBundle) {
  const reqView = (await holder.call((r) => h.getWalletRequest(r, id), "GET")).body;
  const { disclosures, message } = preparePresentation(bundle, reqView.challenge, holder.address);
  const signature = await holder.wallet.signTypedData(presentationDomain(reqView.challenge.chainId, reqView.challenge.registry), PRESENTATION_TYPES, message);
  return holder.call((r) => h.postWalletPresentation(r, id), "POST", {
    credentialJwt: bundle.credentialJwt,
    disclosures,
    salt: bundle.salt,
    proof: { holder: holder.address, commitment: bundle.commitment, expiresAt: reqView.challenge.expiresAt, signature },
  });
}

beforeAll(async () => {
  const dir = path.join(process.cwd(), ".test-data", "verify-api");
  rmSync(dir, { recursive: true, force: true });
  process.env.DATA_DIR = dir;
  provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  for (const a of [adult, minor, other]) expect((await signIn(a, "holder", h)).status).toBe(200);
  expect((await signIn(issuer, "issuer", h)).status).toBe(200);
  keyA = createMerchant({ id: "shop-a", name: "Shop A", kind: "online" }).apiKey;
  keyB = createMerchant({ id: "venue-b", name: "Venue B", kind: "venue" }).apiKey;
  adultBundle = await issueTo(adult, "SYN-VERIFY01", "1990-01-01");
  minorBundle = await issueTo(minor, "SYN-VERIFY02", "2010-06-06");
  registryAddress = adultBundle.deployment.registry;
});

afterAll(() => {
  delete process.env.ISSUER_AUTO_APPROVE;
  provider.destroy();
});

describe("business API authentication", () => {
  it("requires a valid API key, with no Origin header needed (server-to-server)", async () => {
    const anon = new Actor(13);
    expect((await anon.call(h.postVerification, "POST", { policy: "age_over_21" })).status).toBe(401);
    expect((await anon.call(h.postVerification, "POST", { policy: "age_over_21" }, bearer("dk_test_" + "x".repeat(43)))).status).toBe(401);
    // A bare server request: no Origin, no cookie.
    const res = await h.postVerification(new Request("http://localhost/api/v1/verifications", { method: "POST", headers: { "content-type": "application/json", ...bearer(keyA) }, body: JSON.stringify({ policy: "age_over_18" }) }));
    expect(res.status).toBe(201);
    expect((await anon.call(h.postVerification, "POST", { policy: "date_of_birth" }, bearer(keyA))).status).toBe(400);
    expect((await anon.call(h.postVerification, "POST", { policy: "age_over_21", reference: "Jane Doe 1990-01-01" }, bearer(keyA))).status).toBe(400);
  });

  it("one business cannot read another's verifications", async () => {
    const s = await newSession(keyA);
    expect((await issuer.call((r) => h.getVerification(r, s.id), "GET", undefined, bearer(keyB))).status).toBe(404);
    expect((await issuer.call((r) => h.getVerification(r, s.id), "GET", undefined, bearer(keyA))).status).toBe(200);
  });
});

describe("verification: the business learns one answer and nothing else", () => {
  let verifiedId: string;

  it("adult answers age_over_21: verified, with a match code", async () => {
    const s = await newSession(keyA, "age_over_21", "order-1042");
    const wallet = (await adult.call((r) => h.getWalletRequest(r, s.id), "GET")).body;
    expect(wallet).toMatchObject({ merchant: { name: "Shop A", kind: "online" }, policy: { id: "age_over_21", short: "21+" }, status: "pending" });
    expect(wallet.challenge.requestedClaims).toEqual(["ageOver21"]);
    expect(wallet.challenge.audience).toBe("urn:decid:merchant:shop-a");
    const res = await answer(adult, s.id, adultBundle);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "verified", failureCode: null, matchCode: expect.stringMatching(/^[A-Z0-9]{4}$/) });
    verifiedId = s.id;
  });

  it("the business's view holds the answer and no personal data", async () => {
    const v = (await issuer.call((r) => h.getVerification(r, verifiedId), "GET", undefined, bearer(keyA))).body;
    expect(v).toMatchObject({ status: "verified", result: { ageOver21: true }, reference: "order-1042", issuer: { name: expect.any(String) } });
    expect(Object.keys(v.result)).toEqual(["ageOver21"]);
    const text = JSON.stringify(v);
    for (const secret of [adult.address, adult.address.toLowerCase(), adultBundle.commitment, adultBundle.salt, adultBundle.credentialJwt.slice(0, 40), "did:pkh", "1990-01-01", "Sentinel-Lynx", "SYN-VERIFY01", "countryOfResidence"]) {
      expect(text).not.toContain(secret);
    }
    // And the stored row has no column that could hold it.
    const row = db().prepare("SELECT * FROM verify_sessions WHERE id = ?").get(verifiedId) as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(adult.address.slice(2).toLowerCase());
    expect(JSON.stringify(row)).not.toContain(adult.address.slice(2));
  });

  it("the receipt is signed, verifies against the published keys, and holds no personal data", async () => {
    const v = (await issuer.call((r) => h.getVerification(r, verifiedId), "GET", undefined, bearer(keyA))).body;
    const jwks = (await issuer.call(h.getReceiptKeys, "GET")).body;
    const receipt = await verifyReceipt(v.receipt, jwks);
    expect(receipt).toMatchObject({ sid: verifiedId, merchant: "shop-a", ref: "order-1042", policy: "age_over_21", outcome: "satisfied", registry: { status: "Active" } });
    expect(receipt.evidence).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain(adult.address.slice(2));
    // A receipt edited after signing fails verification.
    const [hd, pl, sg] = v.receipt.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(pl!, "base64url").toString()), outcome: "not_satisfied" })).toString("base64url");
    await expect(verifyReceipt(`${hd}.${forged}.${sg}`, jwks)).rejects.toThrow();
  });

  it("each session answers once", async () => {
    const replay = await answer(adult, verifiedId, adultBundle);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("SESSION_USED");
  });

  it("a minor's honest answer is a recorded 'no', not an error", async () => {
    const s = await newSession(keyA);
    expect((await answer(minor, s.id, minorBundle)).body).toMatchObject({ status: "rejected", failureCode: "POLICY_NOT_SATISFIED" });
    const v = (await issuer.call((r) => h.getVerification(r, s.id), "GET", undefined, bearer(keyA))).body;
    expect(v).toMatchObject({ status: "rejected", result: { ageOver21: false }, failureCode: "POLICY_NOT_SATISFIED", matchCode: null });
    // The same minor passes an 18+ check? No: they are 16. And 'identity_verified' passes.
    const s2 = await newSession(keyB, "identity_verified");
    expect((await answer(minor, s2.id, minorBundle)).body.status).toBe("verified");
  });

  it("a stolen credential is rejected, and is not reported as a 'no'", async () => {
    const s = await newSession(keyB);
    expect((await answer(other, s.id, adultBundle)).body).toMatchObject({ status: "rejected", failureCode: "SUBJECT_NOT_PRESENTER" });
    const v = (await issuer.call((r) => h.getVerification(r, s.id), "GET", undefined, bearer(keyB))).body;
    expect(v.result).toBeNull();
  });

  it("a consent given to one business is useless at another (audience binding)", async () => {
    const forA = await newSession(keyA);
    const forB = await newSession(keyB);
    const aView = (await adult.call((r) => h.getWalletRequest(r, forA.id), "GET")).body;
    const { disclosures, message } = preparePresentation(adultBundle, aView.challenge, adult.address);
    const signature = await adult.wallet.signTypedData(presentationDomain(aView.challenge.chainId, aView.challenge.registry), PRESENTATION_TYPES, message);
    const res = await other.call((r) => h.postWalletPresentation(r, forB.id), "POST", {
      credentialJwt: adultBundle.credentialJwt,
      disclosures,
      salt: adultBundle.salt,
      proof: { holder: adult.address, commitment: adultBundle.commitment, expiresAt: aView.challenge.expiresAt, signature },
    });
    expect(res.body).toMatchObject({ status: "rejected" });
    expect(["PROOF_SIGNER_MISMATCH", "PROOF_EXPIRY_INVALID"]).toContain(res.body.failureCode);
  });

  it("an expired request cannot be answered", async () => {
    const s = await newSession(keyA);
    db().prepare("UPDATE verify_sessions SET expires_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000) - 1, s.id);
    expect((await adult.call((r) => h.getWalletRequest(r, s.id), "GET")).body.status).toBe("expired");
    const res = await answer(adult, s.id, adultBundle);
    expect(res.status).toBe(410);
    expect((await issuer.call((r) => h.getVerification(r, s.id), "GET", undefined, bearer(keyA))).body.status).toBe("expired");
  });

  it("every business's receipts form an intact chain; tampering is detected", async () => {
    const a = await verifyReceiptChain("shop-a");
    expect(a).toMatchObject({ ok: true });
    expect(a.count).toBe(2); // the adult's yes and the minor's no; expired requests produce no receipt
    expect((await verifyReceiptChain("venue-b")).ok).toBe(true);
    const row = db().prepare("SELECT jws FROM verify_receipts WHERE merchant_id = 'shop-a' AND seq = 1").get() as { jws: string };
    db().prepare("DELETE FROM verify_receipts WHERE merchant_id = 'shop-a' AND seq = 1").run();
    expect(await verifyReceiptChain("shop-a")).toMatchObject({ ok: false, firstBrokenSeq: 2 });
    db().prepare("INSERT INTO verify_receipts (merchant_id, seq, session_id, jws, hash, prev_hash, created_at) SELECT 'shop-a', 1, 'x', ?, ?, ?, 0").run(row.jws, (await import("node:crypto")).createHash("sha256").update(row.jws).digest("hex"), "0".repeat(64));
    expect((await verifyReceiptChain("shop-a")).ok).toBe(true);
  });
});

describe("business dashboard", () => {
  it("signs in with the API key and shows stats, receipts and the stored fields", async () => {
    const biz = new Actor(14);
    expect((await biz.call(h.getBusinessOverview, "GET")).status).toBe(401);
    expect((await biz.call(h.postBusinessSession, "POST", { apiKey: "dk_test_" + "y".repeat(43) })).status).toBe(401);
    expect((await biz.call(h.postBusinessSession, "POST", { apiKey: keyA })).status).toBe(200);
    const o = (await biz.call(h.getBusinessOverview, "GET")).body;
    expect(o.merchant).toMatchObject({ id: "shop-a", name: "Shop A" });
    expect(o.stats.verified).toBeGreaterThanOrEqual(1);
    expect(o.stats.failures.POLICY_NOT_SATISFIED).toBeGreaterThanOrEqual(1);
    expect(o.receipts.ok).toBe(true);
    expect(o.storedFields).not.toEqual(expect.arrayContaining(["holder", "holder_address", "holder_did", "credential", "salt", "name", "date_of_birth"]));
    expect(JSON.stringify(o)).not.toContain(adult.address.slice(2));
    expect((await biz.call(h.postBusinessLogout, "POST", {})).status).toBe(200);
    expect((await biz.call(h.getBusinessOverview, "GET")).status).toBe(401);
  });
});

describe("decID Pass server support", () => {
  it("the demo issuer can approve automatically (server-side policy, audited)", async () => {
    process.env.ISSUER_AUTO_APPROVE = "1";
    const holder = new Actor(15);
    expect((await signIn(holder, "holder", h)).status).toBe(200);
    const req = await holder.call(h.postHolderRequest, "POST", app("SYN-AUTO01", "1995-05-05"));
    expect(req.body).toMatchObject({ status: "approved" });
    expect((await holder.call((r) => h.postBundlePickup(r, req.body.id), "POST", {})).status).toBe(200);
    const audit = (await issuer.call(h.getIssuerAudit, "GET")).body.entries as { actor: string; action: string }[];
    expect(audit.some((e) => e.actor === "auto-approval" && e.action === "credential.issued")).toBe(true);
    delete process.env.ISSUER_AUTO_APPROVE;
  });

  it("relays a holder-signed registration with sponsored gas: the holder never holds crypto", async () => {
    const holder = new Actor(16);
    const fresh = Wallet.createRandom(); // a brand-new device wallet with no funds
    Object.defineProperty(holder, "wallet", { value: fresh });
    expect((await signIn(holder, "holder", h)).status).toBe(200);
    const bundle = await issueTo(holder, "SYN-PASS0001", "1992-02-02", false);
    expect(await provider.getBalance(fresh.address)).toBe(0n);

    const params = (await holder.call(h.getPassRegistration, "GET")).body;
    const data = new Interface(CREDENTIAL_REGISTRY_ABI).encodeFunctionData("register", [bundle.authorization, bundle.authorizationSignature]);
    const sign = (over: Record<string, unknown> = {}, w: Wallet | ReturnType<typeof Wallet.createRandom> = fresh) =>
      w.signTransaction({ type: 2, chainId: params.chainId, nonce: params.nonce, to: params.to, data, value: 0, gasLimit: BigInt(params.gasLimit), maxFeePerGas: BigInt(params.maxFeePerGas), maxPriorityFeePerGas: BigInt(params.maxPriorityFeePerGas), ...over });

    // Abuse attempts: another contract, a value transfer, someone else's signature, a different call.
    const deny = async (rawTx: string) => (await holder.call(h.postPassRegistration, "POST", { rawTx })).body.error?.code;
    expect(await deny(await sign({ to: other.address }))).toBe("TRANSACTION_NOT_ALLOWED");
    expect(await deny(await sign({ value: 1n }))).toBe("TRANSACTION_NOT_ALLOWED");
    expect(await deny(await sign({}, Wallet.createRandom()))).toBe("TRANSACTION_NOT_ALLOWED");
    expect(await deny(await sign({ data: new Interface(CREDENTIAL_REGISTRY_ABI).encodeFunctionData("revoke", [bundle.commitment]) }))).toBe("TRANSACTION_NOT_ALLOWED");
    expect(await deny(await sign({ data: new Interface(CREDENTIAL_REGISTRY_ABI).encodeFunctionData("register", [adultBundle.authorization, adultBundle.authorizationSignature]) }))).toBe("TRANSACTION_NOT_ALLOWED");

    const ok = await holder.call(h.postPassRegistration, "POST", { rawTx: await sign() });
    expect(ok.body).toMatchObject({ status: "registered" });
    expect(BigInt(ok.body.sponsoredWei)).toBeGreaterThan(0n);
    const status = await holder.call((r) => h.getPassCredentialStatus(r, bundle.commitment), "GET");
    expect(status.body).toEqual({ status: "Active" });
    const reg = new Contract(registryAddress, CREDENTIAL_REGISTRY_ABI, provider);
    expect(await reg.getFunction("isCredentialValid")(bundle.commitment, fresh.address, bundle.authorization.schemaId)).toBe(true);
  });
});
