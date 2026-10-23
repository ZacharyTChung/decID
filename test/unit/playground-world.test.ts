import { beforeAll, describe, expect, it } from "vitest";
import { encodeDisclosure, decodeDisclosure } from "@/lib/shared/sd-jwt";
import { World, type Holder } from "../../site/src/world";

/**
 * The browser playground's engine (site/src), run in Node: the real contract bytecode on the
 * in-page EVM, real issuance, presentation and the production verifier core. If this passes,
 * what the site shows is what the system does.
 */

let world: World;
let adult: Holder;
let minor: Holder;
let thief: Holder;
const firstFail = (r: { checks: { status: string; code?: string }[] }) => r.checks.find((c) => c.status === "fail")?.code;

beforeAll(async () => {
  world = await World.create();
  adult = world.newHolder("Adult");
  minor = world.newHolder("Minor");
  thief = world.newHolder("Thief");
  await world.issue(adult, { dateOfBirth: "1990-04-04", country: "ZZ" });
  await world.issue(minor, { dateOfBirth: "2015-04-04", country: "QQ" });
}, 120_000);

describe("in-page chain runs the real contracts", () => {
  it("registers only from the holder wallet, with real gas", async () => {
    const frontRun = await world.register(adult, thief);
    expect(frontRun).toMatchObject({ ok: false, revert: expect.stringMatching(/^SenderNotHolder/) });
    const tx = await world.register(adult);
    expect(tx.ok).toBe(true);
    expect(Number(tx.gasUsed)).toBeGreaterThan(100_000);
    expect(Number(tx.gasUsed)).toBeLessThan(200_000);
    expect(await world.status(adult.bundle!.commitment)).toBe("Active");
    expect((await world.register(adult)).revert).toMatch(/^AlreadyRegistered/);
    expect((await world.register(minor)).ok).toBe(true);
  });

  it("verifies with the production verifier core, reading the registry through the in-page RPC", async () => {
    const c = world.createChallenge("access-verified-member-area");
    const r = await world.verify(await world.present(adult, c));
    expect(r.verified).toBe(true);
    expect(r.registryStatus).toBe("Active");
    expect(r.rpcCalls).toEqual(expect.arrayContaining(["eth_blockNumber", "eth_call"]));
  });

  it("selective disclosure: 18+ passes for the adult with only ageOver18, fails for the minor", async () => {
    const ok = await world.verify(await world.present(adult, world.createChallenge("access-age-restricted-area")));
    expect(ok.verified).toBe(true);
    expect(ok.disclosed?.claims).toEqual({ ageOver18: true });
    const no = await world.verify(await world.present(minor, world.createChallenge("access-age-restricted-area")));
    expect(firstFail(no)).toBe("POLICY_NOT_SATISFIED");
  });

  it("rejects the attacks the site lets you try", async () => {
    // Replay.
    const c = world.createChallenge("access-verified-member-area");
    const sub = await world.present(adult, c);
    expect((await world.verify(sub)).verified).toBe(true);
    expect(firstFail(await world.verify(sub))).toBe("CHALLENGE_REUSED");
    // Stolen bundle presented by another wallet.
    expect(firstFail(await world.verify(await world.present(thief, world.createChallenge("access-verified-member-area"), adult.bundle!)))).toBe("SUBJECT_NOT_PRESENTER");
    // Minor flips their disclosure and signs over the forgery.
    const c2 = world.createChallenge("access-age-restricted-area");
    const own = decodeDisclosure(minor.bundle!.disclosures.find((d) => decodeDisclosure(d).name === "ageOver18")!);
    const forged = { ...minor.bundle!, disclosures: [encodeDisclosure(own.salt, "ageOver18", true), ...minor.bundle!.disclosures.filter((d) => decodeDisclosure(d).name !== "ageOver18")] };
    expect(firstFail(await world.verify(await world.present(minor, c2, forged)))).toBe("DISCLOSURE_NOT_REFERENCED");
    // Edited token bytes.
    const [h, p, s] = adult.bundle!.credentialJwt.split(".");
    const edited = { ...adult.bundle!, credentialJwt: `${h}.${p}.${s!.slice(0, -2)}${s!.endsWith("AA") ? "BB" : "AA"}` };
    expect(firstFail(await world.verify(await world.present(adult, world.createChallenge("access-verified-member-area"), edited)))).toBe("BAD_SIGNATURE");
  });

  it("gate, revocation and expiry behave as on the real chain", async () => {
    expect((await world.checkIn(adult, adult.bundle!.commitment)).ok).toBe(true);
    expect((await world.checkIn(thief, adult.bundle!.commitment)).revert).toMatch(/^AccessDenied/);
    expect((await world.revoke(adult.bundle!)).ok).toBe(true);
    expect(firstFail(await world.verify(await world.present(adult, world.createChallenge("access-verified-member-area"))))).toBe("REVOKED");
    expect((await world.checkIn(adult, adult.bundle!.commitment)).revert).toMatch(/^AccessDenied/);
    // A year later, the minor's (unrevoked) credential has expired, off-chain and on-chain.
    await world.travel(366 * 24 * 60 * 60);
    expect(await world.status(minor.bundle!.commitment)).toBe("Expired");
    expect(firstFail(await world.verify(await world.present(minor, world.createChallenge("access-verified-member-area"))))).toBe("EXPIRED");
  });
});
