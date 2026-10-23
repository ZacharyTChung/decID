import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SDJwtInstance } from "@sd-jwt/core";
import { digest } from "@sd-jwt/crypto-nodejs";
import { encodeAbiParameters, keccak256, recoverMessageAddress, stringToBytes, verifyTypedData, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import * as h from "@/lib/server/api/handlers";
import type { HolderBundle } from "@/lib/shared/bundle";
import type { ChallengeResponse } from "@/lib/shared/api";
import { PRESENTATION_TYPES, REGISTRATION_TYPES, presentationDomain, registryDomain } from "@/lib/shared/eip712";
import { preparePresentation } from "@/lib/shared/presentation";
import { Actor, signIn } from "./helpers/actors";

/**
 * Interoperability: what decID's REAL issuer and holder code produce is checked with
 * independent implementations only: the OpenWallet Foundation SD-JWT library, viem (EIP-712,
 * keccak/ABI encoding, ERC-4361 SIWE), Node's raw Ed25519 and, when available, Python's
 * `cryptography` with a hand-written base58btc decoder. None of them share code with decID.
 * (JSON-LD and W3C JSON Schema conformance: w3c-conformance.test.ts.)
 */

const holder = new Actor(8);
const issuer = new Actor(1);
let bundle: HolderBundle;
let trustedKey: { did: string; publicKeyJwk: { x: string } };
let trustedSigner: string;
let jwt: string;

beforeAll(async () => {
  const dir = path.join(process.cwd(), ".test-data", "interop");
  rmSync(dir, { recursive: true, force: true });
  process.env.DATA_DIR = dir;
  const trust = JSON.parse(readFileSync(process.env.TRUSTED_ISSUERS_FILE!, "utf8"));
  trustedKey = trust.issuers[0].credentialKeys[0];
  trustedSigner = trust.issuers[0].evmAttestationSigners[0].address;
  expect((await signIn(holder, "holder", h)).status).toBe(200);
  expect((await signIn(issuer, "issuer", h)).status).toBe(200);
  const req = await holder.call(h.postHolderRequest, "POST", { fullName: "Interop Sentinel", dateOfBirth: "1990-02-02", documentNumber: "SYN-INTEROP1", country: "ZZ", syntheticDataConfirmed: true });
  expect((await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" })).status).toBe(200);
  bundle = (await holder.call((r) => h.postBundlePickup(r, req.body.id), "POST", {})).body.bundle;
  jwt = bundle.credentialJwt;
});

const disclosureNamed = (name: string) => bundle.disclosures.find((d) => JSON.parse(Buffer.from(d, "base64url").toString())[1] === name)!;
/** The same EIP-712 domain, in viem's types (built by hand, not converted from ethers' object). */
const viemDomain = (name: string, version: string, chainId: number, verifyingContract: string) => ({ name, version, chainId, verifyingContract: verifyingContract as Hex });
const issuerPublicKey = () => createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: trustedKey.publicKeyJwk.x }, format: "jwk" });

describe("SD-JWT: OpenWallet Foundation @sd-jwt/core", () => {
  const sdjwt = () =>
    new SDJwtInstance({ hasher: digest, verifier: async (data: string, sig: string) => nodeVerify(null, Buffer.from(data), issuerPublicKey(), Buffer.from(sig, "base64url")) });

  it("verifies the issuer signature and reconstructs exactly the presented claim", async () => {
    const { payload } = await sdjwt().verify(`${jwt}~${disclosureNamed("ageOver18")}~`);
    const subject = (payload as { credentialSubject: Record<string, unknown> }).credentialSubject;
    expect(subject).toEqual({ id: expect.stringMatching(/^did:pkh:eip155:31337:/), identityVerified: true, ageOver18: true });
  });

  it("reconstructs all optional claims from the full set of disclosures", async () => {
    const { payload } = await sdjwt().verify(`${jwt}~${bundle.disclosures.join("~")}~`);
    expect((payload as { credentialSubject: Record<string, unknown> }).credentialSubject).toMatchObject({ ageOver18: true, ageOver21: true, countryOfResidence: "ZZ" });
  });

  it("computes the same digests as decID for every disclosure", async () => {
    const sd = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()).credentialSubject._sd as string[];
    for (const d of bundle.disclosures) expect(sd).toContain(Buffer.from(await digest(d, "sha-256")).toString("base64url"));
  });
});

describe("EIP-712, commitment and SIWE: viem", () => {
  it("registration authorization recovers to the trusted attestation signer", async () => {
    const d = registryDomain(bundle.deployment.chainId, bundle.deployment.registry);
    expect(
      await verifyTypedData({
        address: trustedSigner as Hex,
        domain: viemDomain(d.name!, d.version!, bundle.deployment.chainId, d.verifyingContract!),
        types: REGISTRATION_TYPES,
        primaryType: "RegistrationAuthorization",
        message: bundle.authorization,
        signature: bundle.authorizationSignature as Hex,
      }),
    ).toBe(true);
  });

  it("presentation proof v2 recovers to the holder; sdHash is SHA-256 of the compact SD-JWT", async () => {
    const c = (await holder.call(h.postChallenge, "POST", { action: "access-age-restricted-area" })).body as ChallengeResponse;
    const { disclosures, message } = preparePresentation(bundle, c, holder.address);
    const domain = presentationDomain(c.chainId, c.registry);
    const signature = (await holder.wallet.signTypedData(domain, PRESENTATION_TYPES, message)) as Hex;
    expect(
      await verifyTypedData({
        address: holder.address as Hex,
        domain: viemDomain(domain.name!, domain.version!, c.chainId, domain.verifyingContract!),
        types: PRESENTATION_TYPES,
        primaryType: "PresentationProof",
        message: { ...message },
        signature,
      }),
    ).toBe(true);
    expect(message.sdHash).toBe("0x" + createHash("sha256").update(`${jwt}~${disclosures.join("~")}~`).digest("hex"));
  });

  it("commitment recomputes as keccak256(abi.encode(domain, salt, keccak256(token)))", () => {
    const domain = keccak256(stringToBytes("did-mvp:credential-commitment:v1"));
    const c = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [domain, bundle.salt as Hex, keccak256(stringToBytes(jwt))]));
    expect(c).toBe(bundle.commitment);
  });

  it("the server's sign-in message is valid ERC-4361 for its domain and expiry only", async () => {
    const message = (await holder.call(h.postSignInChallenge, "POST", { address: holder.address, chainId: 31337, role: "holder" })).body.message as string;
    const m = parseSiweMessage(message);
    const address = holder.address as Hex;
    expect(validateSiweMessage({ message: m, address, domain: "localhost:3999" })).toBe(true);
    expect(validateSiweMessage({ message: m, address, domain: "evil.example" })).toBe(false);
    expect(validateSiweMessage({ message: m, address, domain: "localhost:3999", time: new Date(m.expirationTime!.getTime() + 1000) })).toBe(false);
    const signature = (await holder.wallet.signMessage(message)) as Hex;
    expect(await recoverMessageAddress({ message, signature })).toBe(holder.address);
  });
});

describe("JWS and did:key: independent of jose", () => {
  it("Node's raw Ed25519 verifies the issuer-signed JWT with the pinned key", () => {
    const [hd, pl, sg] = jwt.split(".");
    expect(nodeVerify(null, Buffer.from(`${hd}.${pl}`), issuerPublicKey(), Buffer.from(sg!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(hd!, "base64url").toString())).toEqual({ alg: "Ed25519", typ: "vc+sd-jwt", cty: "vc", kid: expect.stringMatching(/^did:key:z6Mk.+#z6Mk/) });
  });

  const python = (() => {
    try {
      execFileSync("python3", ["-I", "-c", "import cryptography"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!python)("Python `cryptography` decodes did:key by hand and verifies the JWS (no JS crypto)", () => {
    const py = `
import sys, base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
did, jwt, x = sys.argv[1:4]
n = 0
for ch in did.split(":")[2][1:]: n = n * 58 + ALPH.index(ch)
raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
assert raw[:2] == bytes([0xed, 0x01]), "not an ed25519-pub multikey"
pad = lambda s: s + "=" * (-len(s) % 4)
assert raw[2:] == base64.urlsafe_b64decode(pad(x)), "did:key differs from the pinned JWK"
h, p, s = jwt.split(".")
Ed25519PublicKey.from_public_bytes(raw[2:]).verify(base64.urlsafe_b64decode(pad(s)), (h + "." + p).encode())
print("ok")`;
    expect(execFileSync("python3", ["-I", "-c", py, trustedKey.did, jwt, trustedKey.publicKeyJwk.x], { encoding: "utf8" }).trim()).toBe("ok");
  });
});
