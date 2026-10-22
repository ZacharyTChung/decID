import { describe, expect, it } from "vitest";
import { concat, keccak256, toUtf8Bytes } from "ethers";
import { commitmentFor, computeCommitment, credentialTokenBytes, parseSalt, randomSalt } from "@/lib/shared/commitment";
import { COMMITMENT_DOMAIN, COMMITMENT_DOMAIN_LABEL } from "@/lib/shared/constants";
import { deriveHolderDid, parseHolderDid } from "@/lib/shared/did-pkh";
import { deriveDidKeyFromJwk, resolveDidKeyAssertionKey } from "@/lib/server/did/did-key";

// Deterministic test vector (also documented in docs/CREDENTIAL-PROFILE.md).
const VECTOR = {
  token: "eyJhbGciOiJFZDI1NTE5IiwidHlwIjoidmMrand0In0.eyJ0ZXN0IjoidmVjdG9yIn0.c2lnbmF0dXJl",
  salt: "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  domain: "0xd56ab0b39608399acbb848ac88eb83405436002381faae47f6678f9e4abf71dd",
  tokenHash: "0x1a1a8546e5bcc2c6c86cb305a8fb4fb6acbfa2f27746ce89c69d7fa61d16921e",
  commitment: "0x4b428ae5a3b00afd1da99c45c3f6b4ee29a73d020c484c33633e849d87caf38e",
};

describe("credential commitment", () => {
  it("matches the pinned deterministic test vector", () => {
    expect(COMMITMENT_DOMAIN).toBe(keccak256(toUtf8Bytes(COMMITMENT_DOMAIN_LABEL)));
    expect(COMMITMENT_DOMAIN).toBe(VECTOR.domain);
    expect(keccak256(credentialTokenBytes(VECTOR.token))).toBe(VECTOR.tokenHash);
    expect(commitmentFor(VECTOR.token, VECTOR.salt)).toBe(VECTOR.commitment);
    // abi.encode(bytes32, bytes32, bytes32) is the plain 96-byte concatenation.
    expect(keccak256(concat([VECTOR.domain, VECTOR.salt, VECTOR.tokenHash]))).toBe(VECTOR.commitment);
  });

  it("changes with a different salt or any altered token byte", () => {
    const otherSalt = "0x" + "11".repeat(32);
    expect(commitmentFor(VECTOR.token, otherSalt)).not.toBe(VECTOR.commitment);
    const altered = VECTOR.token.slice(0, -1) + (VECTOR.token.endsWith("l") ? "m" : "l");
    expect(commitmentFor(altered, VECTOR.salt)).not.toBe(VECTOR.commitment);
  });

  it("hashes exact token bytes and rejects anything that is not a compact JWS", () => {
    expect(() => credentialTokenBytes('{"a":1}')).toThrow();
    expect(() => credentialTokenBytes(VECTOR.token + " ")).toThrow();
    expect(() => credentialTokenBytes(VECTOR.token + ".extra")).toThrow();
    expect(() => credentialTokenBytes("")).toThrow();
  });

  it("requires exactly 32-byte salts and generates random ones", () => {
    expect(() => parseSalt("0x1234")).toThrow();
    expect(() => computeCommitment(new Uint8Array(4), new Uint8Array(31))).toThrow();
    const a = randomSalt();
    const b = randomSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("did:pkh holder identifiers", () => {
  const addr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

  it("derives a checksummed eip155 did:pkh and maps it back to account and chain", () => {
    const did = deriveHolderDid(31337, addr.toLowerCase());
    expect(did).toBe(`did:pkh:eip155:31337:${addr}`);
    expect(parseHolderDid(did)).toEqual({ chainId: 31337, address: addr });
    expect(parseHolderDid(`did:pkh:eip155:31337:${addr.toLowerCase()}`).address).toBe(addr);
  });

  it("rejects other methods, namespaces, bad checksums, DID URLs and malformed chains", () => {
    expect(() => parseHolderDid(`did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH`)).toThrow(/unsupported DID method/);
    expect(() => parseHolderDid(`did:pkh:solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ:${addr}`)).toThrow();
    expect(() => parseHolderDid(`did:pkh:eip155:31337:${addr.replace("C44", "c44")}`)).toThrow(/checksum/);
    expect(() => parseHolderDid(`did:pkh:eip155:31337:${addr}#key-1`)).toThrow();
    expect(() => parseHolderDid(`did:pkh:eip155:031337:${addr}`)).toThrow();
    expect(() => parseHolderDid(`did:pkh:eip155:31337:0x1234`)).toThrow();
    expect(() => parseHolderDid(`not-a-did`)).toThrow();
  });
});

describe("did:key issuer identifiers (Digital Bazaar resolver)", () => {
  it("round-trips a public JWK through did:key derivation and resolution", async () => {
    const jwk = { kty: "OKP" as const, crv: "Ed25519" as const, x: "PKQFvBiVxp2B_YzWZKN5bfQ_7Lhg1r5C0BrjhqRSsUY" };
    const { did, kid } = await deriveDidKeyFromJwk(jwk);
    expect(did).toMatch(/^did:key:z6Mk/);
    expect(kid).toBe(`${did}#${did.slice("did:key:".length)}`);
    const resolved = await resolveDidKeyAssertionKey(did);
    expect(resolved.kid).toBe(kid);
    expect(resolved.type).toBe("JsonWebKey");
    expect(resolved.publicKeyJwk).toEqual(jwk);
  });

  it("rejects malformed and unsupported did:key values", async () => {
    await expect(resolveDidKeyAssertionKey("did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme")).rejects.toThrow();
    await expect(resolveDidKeyAssertionKey("did:key:z6Mk0000")).rejects.toThrow();
    await expect(resolveDidKeyAssertionKey("did:web:example.com")).rejects.toThrow();
  });
});
