import { describe, expect, it } from "vitest";
import {
  SD_DIGEST_COUNT,
  compactPresentation,
  createDisclosures,
  decodeDisclosure,
  disclosureDigest,
  sdHash,
  selectDisclosures,
} from "@/lib/shared/sd-jwt";
import { deriveDisclosableClaims } from "@/lib/server/issuer/service";
import { createHash } from "node:crypto";

describe("SD-JWT primitives", () => {
  it("matches the RFC 9901 example disclosure digest", () => {
    const disclosure = "WyJfMjZiYzRMVC1hYzZxMktJNmNCVzVlcyIsICJmYW1pbHlfbmFtZSIsICJNw7ZiaXVzIl0";
    expect(disclosureDigest(disclosure)).toBe("X9yH0Ajrdm1Oij4tWso9UzzKJvPoDxwmuEcO3XAdRC0");
    expect(decodeDisclosure(disclosure)).toMatchObject({ salt: "_26bc4LT-ac6q2KI6cBW5es", name: "family_name", value: "Möbius" });
  });

  it("issues one disclosure per claim, fixed-size sorted digests with decoys, fresh salts", () => {
    const a = createDisclosures({ ageOver18: true, ageOver21: true, countryOfResidence: "ZZ" });
    const b = createDisclosures({ ageOver18: true, ageOver21: true, countryOfResidence: "ZZ" });
    expect(a.disclosures).toHaveLength(3);
    expect(a.sd).toHaveLength(SD_DIGEST_COUNT);
    expect([...a.sd].sort()).toEqual(a.sd);
    expect(new Set(a.sd).size).toBe(SD_DIGEST_COUNT);
    for (const d of a.disclosures) expect(a.sd).toContain(disclosureDigest(d));
    // Same claims, different issuance: nothing in common (salts are random), so presentations are not correlatable by digest.
    expect(a.sd.filter((x) => b.sd.includes(x))).toEqual([]);
    expect(a.disclosures.map((d) => decodeDisclosure(d).salt.length)).toEqual([22, 22, 22]);
  });

  it("sdHash is SHA-256 of the exact compact presentation", () => {
    const { disclosures } = createDisclosures({ ageOver18: false, ageOver21: false, countryOfResidence: "QQ" });
    const jwt = "aaa.bbb.ccc";
    expect(compactPresentation(jwt, [])).toBe("aaa.bbb.ccc~");
    expect(compactPresentation(jwt, disclosures.slice(0, 2))).toBe(`aaa.bbb.ccc~${disclosures[0]}~${disclosures[1]}~`);
    const expected = "0x" + createHash("sha256").update(compactPresentation(jwt, disclosures)).digest("hex");
    expect(sdHash(jwt, disclosures)).toBe(expected);
    expect(sdHash(jwt, disclosures.slice(0, 1))).not.toBe(sdHash(jwt, disclosures.slice(1, 2)));
  });

  it("selects exactly the requested disclosures and refuses unknown names", () => {
    const { disclosures } = createDisclosures({ ageOver18: true, ageOver21: false, countryOfResidence: "ZZ" });
    expect(selectDisclosures(disclosures, [])).toEqual([]);
    expect(selectDisclosures(disclosures, ["countryOfResidence"]).map((d) => decodeDisclosure(d).name)).toEqual(["countryOfResidence"]);
    expect(() => selectDisclosures(disclosures, ["fullName"])).toThrow();
  });
});

describe("issuer-derived claims", () => {
  const at = Date.UTC(2026, 5, 15) / 1000; // 2026-06-15
  it("computes age predicates as of issuance, with birthdays handled exactly", () => {
    expect(deriveDisclosableClaims({ dateOfBirth: "2008-06-15", country: "ZZ" }, at)).toEqual({ ageOver18: true, ageOver21: false, countryOfResidence: "ZZ" });
    expect(deriveDisclosableClaims({ dateOfBirth: "2008-06-16", country: "ZZ" }, at)).toMatchObject({ ageOver18: false });
    expect(deriveDisclosableClaims({ dateOfBirth: "2005-06-15", country: "QQ" }, at)).toEqual({ ageOver18: true, ageOver21: true, countryOfResidence: "QQ" });
    expect(deriveDisclosableClaims({ dateOfBirth: "2005-07-01", country: "QQ" }, at)).toMatchObject({ ageOver21: false });
  });
});
