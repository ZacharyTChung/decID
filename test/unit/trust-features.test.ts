import path from "node:path";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider } from "ethers";
import * as h from "@/lib/server/api/handlers";
import { CREDENTIAL_REGISTRY_ABI } from "@/generated/contracts";
import { db } from "@/lib/server/db";
import { createMerchant } from "@/lib/server/verify-api/merchants";
import { receiptJwks } from "@/lib/server/verify-api/receipts";
import { verifyReceipt } from "@/lib/shared/receipt-chain";
import { PRESENTATION_TYPES, presentationDomain } from "@/lib/shared/eip712";
import { preparePresentation } from "@/lib/shared/presentation";
import type { HolderBundle } from "@/lib/shared/bundle";
import { detectRisk, poissonTail, riskForCheck, type CheckRecord } from "@/lib/shared/risk";
import { answerQuestion, classify, orderRef, timeWindow, type AssistantContext } from "@/lib/shared/assistant";
import { Actor, signIn } from "./helpers/actors";
import { SoftAuthenticator } from "./helpers/soft-authenticator";

/**
 * Device unlock (passkeys), fraud signals and the compliance assistant, end to end on the test
 * chain with real presentations, real WebAuthn verification (a software authenticator) and the
 * real receipt chain.
 */

let provider: JsonRpcProvider;
const issuer = new Actor(1);
const alex = new Actor(13);
const sam = new Actor(14);
const thief = new Actor(15);
const biz = new Actor(16);
let shopKey: string;
let venueKey: string;
let alexBundle: HolderBundle;
let samBundle: HolderBundle;
const origin = () => process.env.APP_ORIGIN!;
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const app = (doc: string, dateOfBirth: string) => ({ fullName: "Trust Sentinel-Otter", dateOfBirth, documentNumber: doc, country: "ZZ", syntheticDataConfirmed: true });

async function issueTo(holder: Actor, doc: string, dob: string): Promise<HolderBundle> {
  const req = await holder.call(h.postHolderRequest, "POST", app(doc, dob));
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  if (req.body.status !== "approved") expect((await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" })).status).toBe(200);
  const bundle = (await holder.call((r) => h.postBundlePickup(r, req.body.id), "POST", {})).body.bundle as HolderBundle;
  const reg = new Contract(bundle.deployment.registry, CREDENTIAL_REGISTRY_ABI, holder.wallet.connect(provider));
  await (await reg.getFunction("register")(bundle.authorization, bundle.authorizationSignature)).wait();
  return bundle;
}

async function newSession(key: string, opts: { reference?: string; requireUserVerification?: boolean } = {}) {
  const res = await issuer.call(h.postVerification, "POST", { policy: "age_over_21", ...opts }, bearer(key));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}

/** The holder's wallet answers, optionally with a device-unlock assertion from `auth`. */
async function answer(holder: Actor, id: string, bundle: HolderBundle, unlock?: (challenge: string) => unknown) {
  const reqView = (await holder.call((r) => h.getWalletRequest(r, id), "GET")).body;
  const { disclosures, message } = preparePresentation(bundle, reqView.challenge, holder.address);
  const signature = await holder.wallet.signTypedData(presentationDomain(reqView.challenge.chainId, reqView.challenge.registry), PRESENTATION_TYPES, message);
  return holder.call((r) => h.postWalletPresentation(r, id), "POST", {
    credentialJwt: bundle.credentialJwt,
    disclosures,
    salt: bundle.salt,
    proof: { holder: holder.address, commitment: bundle.commitment, expiresAt: reqView.challenge.expiresAt, signature },
    ...(unlock ? { unlock: unlock(reqView.unlock.challenge) } : {}),
  });
}

const view = async (key: string, id: string) => (await issuer.call((r) => h.getVerification(r, id), "GET", undefined, bearer(key))).body;

beforeAll(async () => {
  const dir = path.join(process.cwd(), ".test-data", "trust-features");
  rmSync(dir, { recursive: true, force: true });
  process.env.DATA_DIR = dir;
  provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  for (const a of [alex, sam, thief]) expect((await signIn(a, "holder", h)).status).toBe(200);
  expect((await signIn(issuer, "issuer", h)).status).toBe(200);
  shopKey = createMerchant({ id: "trust-shop", name: "Trust Shop", kind: "online" }).apiKey;
  venueKey = createMerchant({ id: "trust-venue", name: "Trust Venue", kind: "venue" }).apiKey;
  alexBundle = await issueTo(alex, "SYN-TRUST01", "1990-01-01");
  samBundle = await issueTo(sam, "SYN-TRUST02", "1991-02-02");
  expect((await biz.call(h.postBusinessSession, "POST", { apiKey: venueKey })).status).toBe(200);
});

afterAll(() => provider.destroy());

describe("device unlock (passkeys: Face ID / fingerprint / PIN)", () => {
  const alexPhone = new SoftAuthenticator("http://placeholder"); // replaced in the first test
  let phone: SoftAuthenticator;

  it("a Pass registers a platform passkey; only its public key is stored", async () => {
    phone = new SoftAuthenticator(origin());
    const opts = await alex.call(h.postPasskeyOptions, "POST", {});
    expect(opts.status, JSON.stringify(opts.body)).toBe(200);
    expect(opts.body.authenticatorSelection).toMatchObject({ userVerification: "required", authenticatorAttachment: "platform" });
    const reg = await alex.call(h.postPasskey, "POST", { response: phone.register(opts.body.challenge) });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const row = db().prepare("SELECT * FROM pass_passkeys WHERE holder_address = ?").get(alex.address) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["counter", "created_at", "credential_id", "holder_address", "public_key", "transports"]);
    expect(alexPhone).toBeDefined();
  });

  it("refuses a passkey made on another website", async () => {
    const opts = await sam.call(h.postPasskeyOptions, "POST", {});
    const evil = new SoftAuthenticator("https://evil.example", new URL(origin()).hostname);
    const reg = await sam.call(h.postPasskey, "POST", { response: evil.register(opts.body.challenge) });
    expect([reg.status, reg.body.error.code]).toEqual([400, "PASSKEY_INVALID"]);
  });

  it("a business that requires it refuses an answer without device unlock", async () => {
    const s = await newSession(venueKey, { requireUserVerification: true });
    const r = await answer(alex, s.id, alexBundle);
    expect(r.body).toMatchObject({ status: "rejected", failureCode: "USER_NOT_VERIFIED", userVerified: false });
  });

  let unlockedId: string;
  it("with Face ID the answer passes, and the signed receipt says so", async () => {
    const s = await newSession(venueKey, { requireUserVerification: true });
    const r = await answer(alex, s.id, alexBundle, (c) => phone.assert(c));
    expect(r.body, JSON.stringify(r.body)).toMatchObject({ status: "verified", userVerified: true });
    const v = await view(venueKey, s.id);
    expect(v).toMatchObject({ requireUserVerification: true, userVerified: true });
    const payload = await verifyReceipt(v.receipt, await receiptJwks());
    expect(payload.userVerified).toBe(true);
    unlockedId = s.id;
  });

  it("an unlock made for another check, without user verification, or replayed, does not count", async () => {
    const other = await newSession(venueKey);
    const otherChallenge = (await alex.call((r) => h.getWalletRequest(r, other.id), "GET")).body.unlock.challenge;
    const cases: [string, (c: string) => unknown][] = [
      ["another check's challenge", () => phone.assert(otherChallenge)],
      ["no user verification (presence only)", (c) => phone.assert(c, { uv: false })],
      ["an old signature counter (a cloned key)", (c) => phone.assert(c, { counter: 1 })],
      ["another website", (c) => phone.assert(c, { origin: "https://evil.example" })],
    ];
    for (const [why, unlock] of cases) {
      const s = await newSession(venueKey, { requireUserVerification: true });
      const r = await answer(alex, s.id, alexBundle, unlock);
      expect(r.body.failureCode, why).toBe("USER_NOT_VERIFIED");
    }
    expect(unlockedId).toBeTruthy();
  });

  it("someone else's passkey can't unlock this Pass", async () => {
    const samPhone = new SoftAuthenticator(origin());
    const opts = await sam.call(h.postPasskeyOptions, "POST", {});
    expect((await sam.call(h.postPasskey, "POST", { response: samPhone.register(opts.body.challenge) })).status).toBe(201);
    const s = await newSession(venueKey, { requireUserVerification: true });
    // Alex's Pass, Sam's face: the assertion verifies cryptographically but belongs to another holder.
    const r = await answer(alex, s.id, alexBundle, (c) => samPhone.assert(c));
    expect(r.body.failureCode).toBe("USER_NOT_VERIFIED");
  });

  it("when not required, an answer without unlock still passes and is recorded as such", async () => {
    const s = await newSession(shopKey, { reference: "T-1001" });
    const r = await answer(sam, s.id, samBundle);
    expect(r.body).toMatchObject({ status: "verified", userVerified: false });
  });
});

describe("fraud signals", () => {
  it("a Pass admitted twice at a door is flagged on the second entry, citing both receipts", async () => {
    const first = await newSession(venueKey);
    expect((await answer(sam, first.id, samBundle)).body.status).toBe("verified");
    expect((await view(venueKey, first.id)).risk).toEqual([]);
    const second = await newSession(venueKey);
    expect((await answer(sam, second.id, samBundle)).body.status).toBe("verified");
    const v = await view(venueKey, second.id);
    expect(v.risk.map((a: { kind: string }) => a.kind)).toContain("pass_reuse");
    const reuse = v.risk.find((a: { kind: string }) => a.kind === "pass_reuse");
    expect(reuse.sessions).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(reuse.receipts).toHaveLength(reuse.sessions.length);
  });

  it("someone else's Pass is refused and flagged", async () => {
    const s = await newSession(venueKey);
    // The thief replays Sam's credential but signs with their own wallet.
    const r = await answer(thief, s.id, samBundle);
    expect(r.body.status).toBe("rejected");
    const risk = await biz.call(h.getBusinessRisk, "GET");
    expect(risk.status).toBe(200);
    expect(risk.body.alerts.map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(["pass_reuse", "borrowed_pass"]));
    expect(risk.body.passTagRetentionHours).toBe(48);
  });

  it("many orders from one Pass online are flagged", async () => {
    for (let i = 0; i < 4; i++) {
      const s = await newSession(shopKey, { reference: `T-20${i}` });
      expect((await answer(alex, s.id, alexBundle)).body.status).toBe("verified");
    }
    const recent = db().prepare("SELECT id FROM verify_sessions WHERE merchant_id = 'trust-shop' ORDER BY created_at DESC LIMIT 1").get() as { id: string };
    expect((await view(shopKey, recent.id)).risk.map((a: { kind: string }) => a.kind)).toContain("repeat_orders");
  });

  it("the Pass pseudonym differs between businesses, so it can't link a person across them", () => {
    const tags = db().prepare("SELECT merchant_id, pass_tag FROM verify_sessions WHERE pass_tag IS NOT NULL").all() as { merchant_id: string; pass_tag: string }[];
    const shop = new Set(tags.filter((t) => t.merchant_id === "trust-shop").map((t) => t.pass_tag));
    const venue = new Set(tags.filter((t) => t.merchant_id === "trust-venue").map((t) => t.pass_tag));
    expect(shop.size).toBeGreaterThan(0);
    expect(venue.size).toBeGreaterThan(0);
    for (const t of shop) expect(venue.has(t)).toBe(false);
    // Nothing in the tag is the commitment or the address.
    for (const t of [...shop, ...venue]) {
      expect(alexBundle.commitment.toLowerCase()).not.toContain(t);
      expect(samBundle.commitment.toLowerCase()).not.toContain(t);
    }
  });

  it("pure rules: forgery probing, under-age spike, and the Poisson test", () => {
    const now = 1_800_000_000;
    const rec = (i: number, o: Partial<CheckRecord>): CheckRecord => ({ id: `s${i}`, createdAt: now - 1000 + i * 10, completedAt: now - 1000 + i * 10 + 2, status: "rejected", policy: "age_over_21", reference: null, failureCode: null, receiptSeq: i + 1, passTag: null, userVerified: null, ...o });
    const forged = [0, 1, 2, 3].map((i) => rec(i, { failureCode: i % 2 ? "BAD_SIGNATURE" : "ISSUER_NOT_TRUSTED" }));
    const probing = detectRisk(forged, "venue", now).filter((a) => a.kind === "forgery_probing");
    expect(probing).toHaveLength(1); // overlapping windows collapse into one alert
    expect(probing[0]!.sessions).toHaveLength(4);
    const history = Array.from({ length: 40 }, (_, i) => rec(i, { createdAt: now - 20 * 3600 + i * 1800, completedAt: now - 20 * 3600 + i * 1800 + 2, status: i % 10 === 0 ? "rejected" : "verified", failureCode: i % 10 === 0 ? "POLICY_NOT_SATISFIED" : null }));
    const burst = Array.from({ length: 8 }, (_, i) => rec(100 + i, { createdAt: now - 600 + i * 30, completedAt: now - 600 + i * 30 + 2, failureCode: i < 6 ? "POLICY_NOT_SATISFIED" : null, status: i < 6 ? "rejected" : "verified" }));
    expect(detectRisk([...history, ...burst], "venue", now).map((a) => a.kind)).toContain("underage_spike");
    expect(detectRisk(history, "venue", now).map((a) => a.kind)).not.toContain("underage_spike");
    expect(poissonTail(0, 3)).toBe(1);
    expect(poissonTail(10, 1)).toBeLessThan(1e-6);
    expect(riskForCheck(forged, "nope", "venue")).toEqual([]);
  });
});

describe("compliance assistant", () => {
  it("understands the questions a business asks", () => {
    const cases: [string, string][] = [
      ["Was order HL-1042 age-checked?", "prove_order"],
      ["prove #T-1001", "prove_order"],
      ["How many checks did we run today?", "summary"],
      ["how many orders this week", "summary"],
      ["Why were people refused?", "refusals"],
      ["Is our record intact?", "integrity"],
      ["Anything suspicious?", "risk"],
      ["What personal data do you store?", "data"],
      ["An inspector wants evidence", "export"],
      ["Write this week’s compliance report", "report"],
      ["How many used Face ID?", "biometrics"],
      ["hello", "help"],
    ];
    for (const [q, intent] of cases) expect(classify(q), q).toBe(intent);
    expect(orderRef("was order HL-1042 checked?")).toBe("HL-1042");
    expect(orderRef("orders today")).toBeNull();
    expect(timeWindow("last 3 hours", 10_000).from).toBe(10_000 - 3 * 3600);
  });

  it("proves an order from its signed receipt, over the API", async () => {
    const shopBiz = new Actor(17);
    expect((await shopBiz.call(h.postBusinessSession, "POST", { apiKey: shopKey })).status).toBe(200);
    const r = await shopBiz.call(h.postBusinessAssistant, "POST", { question: "Was order T-1001 age-checked?" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.intent).toBe("prove_order");
    expect(r.body.text[0]).toMatch(/^Yes\. Order T-1001 was age-checked/);
    expect(r.body.citations.receipts).toHaveLength(1);
    const unknown = await shopBiz.call(h.postBusinessAssistant, "POST", { question: "Was order T-9999 checked?" });
    expect(unknown.body.text[0]).toMatch(/no age check with the reference “T-9999”/);
  });

  it("answers from the records: refusals, risk, integrity, data and a report", async () => {
    const ask = async (question: string) => (await biz.call(h.postBusinessAssistant, "POST", { question })).body;
    const refusals = await ask("Why were people refused?");
    expect(refusals.text.join(" ")).toMatch(/Credential belongs to someone else/);
    const risk = await ask("Anything suspicious?");
    expect(risk.intent).toBe("risk");
    expect(risk.text.join(" ")).toMatch(/Same Pass admitted again/);
    expect(risk.citations.receipts.length).toBeGreaterThan(0);
    const integrity = await ask("Is our record intact?");
    expect(integrity.text[0]).toMatch(/^Yes\. All \d+ receipts verify/);
    const data = await ask("What personal data do you keep?");
    expect(data.text.join(" ")).toMatch(/pass_tag/);
    const report = await ask("Write this week’s compliance report");
    expect(report.text.join("\n")).toMatch(/1\. Checks:[\s\S]*2\. Evidence:[\s\S]*3\. Fraud signals:[\s\S]*4\. Device unlock:[\s\S]*5\. Personal data held: none/);
    expect(report.actions[0].href).toBe("/api/business/receipts/export");
  });

  it("says plainly when the record is broken", () => {
    const ctx: AssistantContext = { merchant: { id: "m", name: "M", kind: "online" }, records: [], chain: { ok: false, count: 3, firstBrokenSeq: 2, problem: "signature does not verify", anchor: null }, alerts: [], storedFields: ["id"], now: 1 };
    expect(answerQuestion("is our record intact?", ctx).text[0]).toMatch(/^No\. The chain breaks at receipt #2/);
  });
});
