import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { exportJWK, generateKeyPair } from "jose";
import { decodeDisclosure } from "@/lib/shared/sd-jwt";
import { issueHealthRecord, presentHealthFact, verifyHealthFact } from "@/lib/shared/health";

/** decID Health: one health fact, from a clinic-signed record, bound to the holder's phone and the request. */
describe("health records (synthetic)", async () => {
  const now = 1_800_000_000;
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const clinicJwk = await exportJWK(publicKey);
  const phone = Wallet.createRandom();
  const facts = { measlesImmune: true, tbScreenClear: false, fluVaccine: true, sportsClearance: true };
  const record = await issueHealthRecord({ clinicKey: privateKey, clinicKid: "clinic-1", clinic: "Riverside Clinic", holder: phone.address, facts, now });
  const req = { audience: "urn:decid:merchant:lakeside", nonce: "n-1" };
  const check = (p: Awaited<ReturnType<typeof presentHealthFact>>, o: Partial<Parameters<typeof verifyHealthFact>[1]> = {}) => verifyHealthFact(p, { clinicJwk, fact: "measlesImmune", ...req, now, ...o });

  it("shares exactly one fact, and the asker learns only that", async () => {
    const p = await presentHealthFact(record, "measlesImmune", phone, req);
    expect(await check(p)).toEqual({ ok: true, answer: true, reason: null });
    expect(decodeDisclosure(p.disclosure).name).toBe("measlesImmune");
    // The record itself carries only digests: no fact is readable without its disclosure.
    expect(Buffer.from(p.jwt.split(".")[1]!, "base64url").toString()).not.toMatch(/measles|tbScreen|flu|sports/);
    expect(await check(await presentHealthFact(record, "tbScreenClear", phone, req), { fact: "tbScreenClear" })).toMatchObject({ ok: true, answer: false });
  });

  it("refuses a copied record, a replay, an edited answer, the wrong fact, a revoked or expired record, and another clinic", async () => {
    const p = await presentHealthFact(record, "measlesImmune", phone, req);
    expect((await check(await presentHealthFact(record, "measlesImmune", Wallet.createRandom(), req))).reason).toBe("HOLDER_MISMATCH");
    expect((await check(p, { nonce: "n-2" })).reason).toBe("HOLDER_MISMATCH");
    const tb = await presentHealthFact(record, "tbScreenClear", phone, req);
    const flipped = Buffer.from(JSON.stringify([JSON.parse(Buffer.from(tb.disclosure, "base64url").toString())[0], "tbScreenClear", true])).toString("base64url");
    expect((await check({ ...tb, disclosure: flipped }, { fact: "tbScreenClear" })).reason).toBe("NOT_IN_RECORD");
    expect((await check(p, { fact: "fluVaccine" })).reason).toBe("WRONG_FACT");
    const jti = JSON.parse(Buffer.from(p.jwt.split(".")[1]!, "base64url").toString()).jti;
    expect((await check(p, { revoked: new Set([jti]) })).reason).toBe("REVOKED");
    expect((await check(p, { now: now + 400 * 86400 })).reason).toBe("EXPIRED");
    const other = await exportJWK((await generateKeyPair("EdDSA", { crv: "Ed25519" })).publicKey);
    expect((await check(p, { clinicJwk: other })).reason).toBe("BAD_SIGNATURE");
  });
});
