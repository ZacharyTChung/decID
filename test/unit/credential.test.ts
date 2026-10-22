import { beforeAll, describe, expect, it } from "vitest";
import { CompactSign, SignJWT, exportJWK, generateKeyPair, decodeProtectedHeader, type JWK } from "jose";
import { CREDENTIAL_TYPE, SCHEMA_ID } from "@/lib/shared/constants";
import { buildIdentityCredential, type IdentityVerifiedCredential } from "@/lib/shared/credential-profile";
import { deriveHolderDid } from "@/lib/shared/did-pkh";
import { signCredentialJwt } from "@/lib/server/credential/sign";
import { verifyCredentialJwt } from "@/lib/server/credential/verify";
import { deriveDidKeyFromJwk } from "@/lib/server/did/did-key";
import { trustedEvmSigner, type TrustedIssuerT } from "@/lib/server/trust";

const CHAIN_ID = 31337;
const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const HOLDER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const NOW = 1_800_000_000;

interface Issuer {
  privateJwk: { kty: "OKP"; crv: "Ed25519"; x: string; d: string };
  did: string;
  kid: string;
  trust: TrustedIssuerT;
}

async function makeIssuer(name: string): Promise<Issuer> {
  const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
  const jwk = (await exportJWK(privateKey)) as Required<Pick<JWK, "kty" | "crv" | "x" | "d">>;
  const privateJwk = { kty: "OKP" as const, crv: "Ed25519" as const, x: jwk.x, d: jwk.d };
  const { did, kid } = await deriveDidKeyFromJwk({ kty: "OKP", crv: "Ed25519", x: jwk.x });
  return {
    privateJwk,
    did,
    kid,
    trust: {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
      name,
      credentialKeys: [{ did, kid, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x }, status: "active", activatedAt: 0 }],
      evmAttestationSigners: [{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", status: "active", activatedAt: 0 }],
      credentialTypes: [CREDENTIAL_TYPE],
      schemaIds: [SCHEMA_ID],
    },
  };
}

function vcFor(issuer: Issuer, overrides: Partial<{ holder: string; chainId: number; registry: string; from: number; until: number }> = {}) {
  return buildIdentityCredential({
    credentialId: "urn:uuid:3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    issuerDid: issuer.did,
    holderDid: deriveHolderDid(overrides.chainId ?? CHAIN_ID, overrides.holder ?? HOLDER),
    validFrom: overrides.from ?? NOW - 60,
    validUntil: overrides.until ?? NOW + 3600,
    chainId: overrides.chainId ?? CHAIN_ID,
    registry: overrides.registry ?? REGISTRY,
  });
}

/** Signs arbitrary payload JSON with the issuer key, bypassing profile validation (to simulate a misbehaving issuer). */
async function signRaw(issuer: Issuer, payload: unknown, header: Record<string, unknown> = {}): Promise<string> {
  const { importJWK } = await import("jose");
  const key = await importJWK(issuer.privateJwk, "Ed25519");
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "Ed25519", typ: "vc+jwt", cty: "vc", kid: issuer.kid, ...header })
    .sign(key);
}

let issuer: Issuer;
let stranger: Issuer;
const ctx = () => ({ issuers: [issuer.trust], now: NOW, expectedChainId: CHAIN_ID, expectedRegistry: REGISTRY });
const failureOf = (r: Awaited<ReturnType<typeof verifyCredentialJwt>>) => r.checks.find((c) => c.status === "fail");

beforeAll(async () => {
  issuer = await makeIssuer("Test Issuer");
  stranger = await makeIssuer("Self-issued stranger");
});

describe("vc+jwt issuance", () => {
  it("produces a minimal VC 2.0 payload with the VC-JOSE-COSE header", async () => {
    const vc = vcFor(issuer);
    const token = await signCredentialJwt(vc, issuer.privateJwk, issuer.kid);
    expect(decodeProtectedHeader(token)).toEqual({ alg: "Ed25519", typ: "vc+jwt", cty: "vc", kid: issuer.kid });
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
    expect(payload).toEqual(vc);
    expect(Object.keys(payload.credentialSubject).sort()).toEqual(["id", "identityVerified"]);
    expect(payload.vc).toBeUndefined();
    expect(payload.nbf).toBeUndefined();
  });
});

describe("vc+jwt verification", () => {
  it("accepts a valid credential from a trusted issuer", async () => {
    const token = await signCredentialJwt(vcFor(issuer), issuer.privateJwk, issuer.kid);
    const r = await verifyCredentialJwt(token, ctx());
    expect(r.ok).toBe(true);
    expect(r.subject).toEqual({ chainId: CHAIN_ID, address: HOLDER });
    expect(r.checks.map((c) => c.status)).toEqual(Array(r.checks.length).fill("pass"));
  });

  it("rejects tampered claims (payload changed after signing)", async () => {
    const token = await signCredentialJwt(vcFor(issuer), issuer.privateJwk, issuer.kid);
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    payload.credentialSubject.id = deriveHolderDid(CHAIN_ID, "0x90F79bf6EB2c4f870365E785982E1f101E93b906");
    payload.sub = payload.credentialSubject.id;
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
    expect(failureOf(await verifyCredentialJwt(forged, ctx()))?.code).toBe("BAD_SIGNATURE");
  });

  it("rejects malformed tokens", async () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "!!!.###.$$$", "eyJhbGciOiJFZDI1NTE5In0.e30"]) {
      const r = await verifyCredentialJwt(bad, ctx());
      expect(r.ok).toBe(false);
      expect(failureOf(r)?.id).toBe("tokenFormat");
    }
  });

  it("rejects unsigned (alg none) and unsupported algorithms", async () => {
    const vc = vcFor(issuer);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "none", typ: "vc+jwt", kid: issuer.kid })}.${b64(vc)}.`;
    expect(failureOf(await verifyCredentialJwt(unsigned + "x", ctx()))?.code).toBe("UNSIGNED_TOKEN");

    const hs = await new SignJWT(vc as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256", typ: "vc+jwt", kid: issuer.kid })
      .sign(new TextEncoder().encode("a-shared-secret-that-is-long-enough-123"));
    expect(failureOf(await verifyCredentialJwt(hs, ctx()))?.code).toBe("ALG_NOT_ALLOWED");

    const eddsa = await signRaw(issuer, vc, { alg: "EdDSA" });
    expect(failureOf(await verifyCredentialJwt(eddsa, ctx()))?.code).toBe("ALG_NOT_ALLOWED");
  });

  it("rejects wrong typ/cty and presenter-supplied keys in the header", async () => {
    const vc = vcFor(issuer);
    expect(failureOf(await verifyCredentialJwt(await signRaw(issuer, vc, { typ: "JWT" }), ctx()))?.code).toBe("BAD_TYP");
    expect(failureOf(await verifyCredentialJwt(await signRaw(issuer, vc, { cty: "json" }), ctx()))?.code).toBe("BAD_CTY");
    const withJwk = await signRaw(stranger, vc, { kid: issuer.kid, jwk: stranger.trust.credentialKeys[0]!.publicKeyJwk });
    expect(failureOf(await verifyCredentialJwt(withJwk, ctx()))?.code).toBe("FORBIDDEN_HEADER");
  });

  it("rejects a self-issued DID that is not in the trust policy", async () => {
    const token = await signCredentialJwt(vcFor(stranger), stranger.privateJwk, stranger.kid);
    const r = await verifyCredentialJwt(token, ctx());
    expect(failureOf(r)).toMatchObject({ id: "issuerTrust", code: "ISSUER_NOT_TRUSTED" });
  });

  it("rejects a token signed by another key but claiming the trusted issuer's kid", async () => {
    const vc = vcFor(issuer);
    const token = await signRaw(stranger, vc, { kid: issuer.kid });
    expect(failureOf(await verifyCredentialJwt(token, ctx()))?.code).toBe("BAD_SIGNATURE");
  });

  it("rejects issuer DID / key binding mismatches in the trust policy", async () => {
    const token = await signCredentialJwt(vcFor(issuer), issuer.privateJwk, issuer.kid);
    const key = issuer.trust.credentialKeys[0]!;
    const wrongKey = { ...issuer.trust, credentialKeys: [{ ...key, publicKeyJwk: stranger.trust.credentialKeys[0]!.publicKeyJwk }] };
    expect(failureOf(await verifyCredentialJwt(token, { ...ctx(), issuers: [wrongKey] }))?.code).toBe("KEY_MISMATCH");
    const wrongKid = { ...issuer.trust, credentialKeys: [{ ...key, kid: `${issuer.did}#other` }] };
    expect(failureOf(await verifyCredentialJwt(token, { ...ctx(), issuers: [wrongKid] }))?.code).toBe("KID_MISMATCH");
    const notForType = { ...issuer.trust, credentialTypes: ["SomethingElse"] };
    expect(failureOf(await verifyCredentialJwt(token, { ...ctx(), issuers: [notForType] }))?.code).toBe("TYPE_NOT_AUTHORIZED");
  });

  it("rejects credentials whose issuer property differs from the signing key's DID", async () => {
    const vc: IdentityVerifiedCredential = { ...vcFor(issuer), issuer: stranger.did, iss: stranger.did };
    const token = await signRaw(issuer, vc);
    expect(failureOf(await verifyCredentialJwt(token, ctx()))?.code).toBe("ISSUER_KID_MISMATCH");
  });

  it("rejects disagreement between JWT registered claims and VC properties", async () => {
    const base = vcFor(issuer);
    for (const [patch, expected] of [
      [{ iss: "did:key:z6Mkother" }, "iss does not match issuer"],
      [{ sub: deriveHolderDid(CHAIN_ID, "0x90F79bf6EB2c4f870365E785982E1f101E93b906") }, "sub does not match"],
      [{ jti: "urn:uuid:00000000-0000-4000-8000-000000000000" }, "jti does not match"],
      [{ exp: base.exp + 1 }, "exp does not match"],
      [{ iat: base.iat - 1 }, "iat does not match"],
    ] as const) {
      const r = await verifyCredentialJwt(await signRaw(issuer, { ...base, ...patch }), ctx());
      expect(failureOf(r)?.code).toBe("JWT_CLAIM_MISMATCH");
      expect(failureOf(r)?.detail).toContain(expected);
    }
  });

  it("rejects schema violations, including extra subject claims (minimal disclosure policy)", async () => {
    const base = vcFor(issuer);
    const extra = { ...base, credentialSubject: { ...base.credentialSubject, fullName: "SYNTHETIC-NAME" } };
    expect(failureOf(await verifyCredentialJwt(await signRaw(issuer, extra), ctx()))?.code).toBe("SCHEMA_INVALID");
    const wrongSchema = { ...base, credentialSchema: { id: "https://example.com/other.json", type: "JsonSchema" } };
    expect(failureOf(await verifyCredentialJwt(await signRaw(issuer, wrongSchema), ctx()))?.code).toBe("SCHEMA_INVALID");
    const exampleContext = { ...base, "@context": ["https://www.w3.org/ns/credentials/v2", "https://www.w3.org/ns/credentials/examples/v2"] };
    expect(failureOf(await verifyCredentialJwt(await signRaw(issuer, exampleContext), ctx()))?.code).toBe("SCHEMA_INVALID");
    const notVerified = { ...base, credentialSubject: { ...base.credentialSubject, identityVerified: false } };
    expect(failureOf(await verifyCredentialJwt(await signRaw(issuer, notVerified), ctx()))?.code).toBe("SCHEMA_INVALID");
  });

  it("enforces the validity window (not yet valid, expired, boundary)", async () => {
    const token = await signCredentialJwt(vcFor(issuer, { from: NOW + 10, until: NOW + 100 }), issuer.privateJwk, issuer.kid);
    expect(failureOf(await verifyCredentialJwt(token, ctx()))?.code).toBe("NOT_YET_VALID");
    expect((await verifyCredentialJwt(token, { ...ctx(), now: NOW + 10 })).ok).toBe(true);
    expect((await verifyCredentialJwt(token, { ...ctx(), now: NOW + 99 })).ok).toBe(true);
    expect(failureOf(await verifyCredentialJwt(token, { ...ctx(), now: NOW + 100 }))?.code).toBe("EXPIRED");
  });

  it("rejects credentials bound to another chain or registry", async () => {
    const otherChain = await signCredentialJwt(vcFor(issuer, { chainId: 1 }), issuer.privateJwk, issuer.kid);
    expect(failureOf(await verifyCredentialJwt(otherChain, ctx()))?.code).toBe("WRONG_DEPLOYMENT");
    const otherRegistry = await signCredentialJwt(vcFor(issuer, { registry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" }), issuer.privateJwk, issuer.kid);
    expect(failureOf(await verifyCredentialJwt(otherRegistry, ctx()))?.code).toBe("WRONG_DEPLOYMENT");
    const base = vcFor(issuer);
    const subjectOtherChain = deriveHolderDid(5, HOLDER);
    const mixed = { ...base, credentialSubject: { ...base.credentialSubject, id: subjectOtherChain }, sub: subjectOtherChain };
    expect(failureOf(await verifyCredentialJwt(await signRaw(issuer, mixed), ctx()))?.code).toBe("SUBJECT_WRONG_CHAIN");
  });

  it("rejects oversized tokens before parsing", async () => {
    const big = "a".repeat(9000) + ".b.c";
    expect(failureOf(await verifyCredentialJwt(big, ctx()))?.code).toBe("MALFORMED_TOKEN");
  });

  describe("key rotation (trust policy lifecycle)", () => {
    const withKeyState = (state: { status: "active" | "retired" | "compromised"; activatedAt: number; retiredAt?: number }) => ({
      ...ctx(),
      issuers: [{ ...issuer.trust, credentialKeys: [{ ...issuer.trust.credentialKeys[0]!, ...state }] }],
    });

    it("keeps credentials issued before retirement valid, and rejects ones issued after", async () => {
      const issuedBefore = await signCredentialJwt(vcFor(issuer, { from: NOW - 600 }), issuer.privateJwk, issuer.kid);
      expect((await verifyCredentialJwt(issuedBefore, withKeyState({ status: "retired", activatedAt: 0, retiredAt: NOW - 300 }))).ok).toBe(true);

      const issuedAfter = await signCredentialJwt(vcFor(issuer, { from: NOW - 60 }), issuer.privateJwk, issuer.kid);
      const r = await verifyCredentialJwt(issuedAfter, withKeyState({ status: "retired", activatedAt: 0, retiredAt: NOW - 300 }));
      expect(failureOf(r)).toMatchObject({ id: "issuerTrust", code: "KEY_NOT_VALID_AT_ISSUANCE" });
    });

    it("rejects everything signed by a compromised key, whatever its claimed issuance date", async () => {
      const old = await signCredentialJwt(vcFor(issuer, { from: NOW - 600 }), issuer.privateJwk, issuer.kid);
      const r = await verifyCredentialJwt(old, withKeyState({ status: "compromised", activatedAt: 0, retiredAt: NOW - 300 }));
      expect(failureOf(r)).toMatchObject({ id: "issuerTrust", code: "KEY_COMPROMISED" });
    });

    it("rejects credentials dated before the key was activated", async () => {
      const backdated = await signCredentialJwt(vcFor(issuer, { from: NOW - 600 }), issuer.privateJwk, issuer.kid);
      const r = await verifyCredentialJwt(backdated, withKeyState({ status: "active", activatedAt: NOW - 300 }));
      expect(failureOf(r)?.code).toBe("KEY_NOT_VALID_AT_ISSUANCE");
    });

    it("trusts both the retired and the new key of one logical issuer", async () => {
      const next = await makeIssuer("Test Issuer");
      const policy = {
        ...issuer.trust,
        credentialKeys: [
          { ...issuer.trust.credentialKeys[0]!, status: "retired" as const, activatedAt: 0, retiredAt: NOW - 300 },
          { ...next.trust.credentialKeys[0]!, status: "active" as const, activatedAt: NOW - 300 },
        ],
      };
      const c = { ...ctx(), issuers: [policy] };
      const oldCred = await signCredentialJwt(vcFor(issuer, { from: NOW - 600 }), issuer.privateJwk, issuer.kid);
      const newCred = await signCredentialJwt(vcFor(next, { from: NOW - 60 }), next.privateJwk, next.kid);
      expect((await verifyCredentialJwt(oldCred, c)).ok).toBe(true);
      expect((await verifyCredentialJwt(newCred, c)).ok).toBe(true);
    });

    it("evaluates EVM attestation signers by the same lifecycle", () => {
      const signer = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const policy = { ...issuer.trust, evmAttestationSigners: [{ address: signer, status: "retired" as const, activatedAt: 0, retiredAt: 1000 }] };
      expect(trustedEvmSigner(policy, signer.toLowerCase(), 999)).toBeDefined();
      expect(trustedEvmSigner(policy, signer, 1000)).toBeUndefined();
      expect(trustedEvmSigner({ ...policy, evmAttestationSigners: [{ address: signer, status: "compromised" as const, activatedAt: 0, retiredAt: 1000 }] }, signer, 10)).toBeUndefined();
    });
  });
});
