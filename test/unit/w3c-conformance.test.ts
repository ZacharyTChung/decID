import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair } from "jose";
import jsonld from "jsonld";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { CREDENTIAL_TYPE, IDENTITY_CONTEXT_URI, SCHEMA_ID, VC_V2_CONTEXT } from "@/lib/shared/constants";
import { IDENTITY_CONTEXT_DOCUMENT, buildIdentityCredential } from "@/lib/shared/credential-profile";
import { createDisclosures } from "@/lib/shared/sd-jwt";
import { deriveHolderDid } from "@/lib/shared/did-pkh";
import { signCredentialJwt } from "@/lib/server/credential/sign";
import { verifyCredentialJwt } from "@/lib/server/credential/verify";
import { deriveDidKeyFromJwk } from "@/lib/server/did/did-key";

/**
 * Conformance with the W3C VC 2.0 data model, checked with independent tooling against the
 * OFFICIAL W3C context and JSON Schema (vendored in test/fixtures/w3c, never fetched):
 *  - JSON-LD: every property of the unsecured credential expands to an absolute IRI in
 *    jsonld.js safe mode (an undefined term is an error, as for JSON-LD-aware verifiers);
 *  - JSON Schema: the credential validates against the W3C VC 2.0 schema.
 * The unsecured credential is what SD-JWT processing yields: the verified payload without
 * `_sd`/`_sd_alg`, plus the disclosed claims.
 */

const W3C = path.join(process.cwd(), "test", "fixtures", "w3c");
const CHAIN_ID = 31337;
const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
let unsecured: Record<string, unknown>;

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
  const jwk = await exportJWK(privateKey);
  const { did, kid } = await deriveDidKeyFromJwk({ kty: "OKP", crv: "Ed25519", x: jwk.x! });
  const now = Math.floor(Date.now() / 1000);
  const { disclosures, sd } = createDisclosures({ ageOver18: true, ageOver21: false, countryOfResidence: "ZZ" });
  const vc = buildIdentityCredential({
    credentialId: "urn:uuid:3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    issuerDid: did,
    holderDid: deriveHolderDid(CHAIN_ID, "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"),
    validFrom: now - 60,
    validUntil: now + 3600,
    chainId: CHAIN_ID,
    registry: REGISTRY,
    sd,
  });
  const token = await signCredentialJwt(vc, { kty: "OKP", crv: "Ed25519", x: jwk.x!, d: jwk.d! }, kid);
  const issuers = [{
    id: "test", name: "Test", credentialTypes: [CREDENTIAL_TYPE], schemaIds: [SCHEMA_ID],
    credentialKeys: [{ did, kid, publicKeyJwk: { kty: "OKP" as const, crv: "Ed25519" as const, x: jwk.x! }, status: "active" as const, activatedAt: 0 }],
    evmAttestationSigners: [{ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", status: "active" as const, activatedAt: 0 }],
  }];
  const r = await verifyCredentialJwt(token, { issuers, now, expectedChainId: CHAIN_ID, expectedRegistry: REGISTRY, disclosures });
  expect(r.ok).toBe(true);
  const { _sd_alg: _alg, credentialSubject, ...rest } = r.credential!;
  const { _sd: _digests, ...subject } = credentialSubject;
  unsecured = { ...rest, credentialSubject: { ...subject, ...r.disclosedClaims } };
});

describe("W3C VC 2.0 conformance (official context and schema)", () => {
  it("expands in JSON-LD safe mode: no undefined terms, nothing dropped", async () => {
    const docs: Record<string, unknown> = {
      [VC_V2_CONTEXT]: JSON.parse(readFileSync(path.join(W3C, "credentials-v2.context.json"), "utf8")),
      [IDENTITY_CONTEXT_URI]: IDENTITY_CONTEXT_DOCUMENT,
    };
    const documentLoader = async (url: string) => {
      if (!(url in docs)) throw new Error(`test refuses to fetch ${url}`);
      return { contextUrl: null, documentUrl: url, document: docs[url] };
    };
    const expanded = JSON.stringify(await jsonld.expand(unsecured, { documentLoader, safe: true }));
    for (const term of ["identityVerified", "ageOver18", "ageOver21", "countryOfResidence"]) expect(expanded).toContain(`did-mvp.invalid/vocab#${term}`);
    // JWT claims: iss/sub/iat/exp are defined by the W3C context itself, jti by ours.
    for (const iri of ["jose#iss", "jose#sub", "jwt#iat", "jwt#exp", "jwt#jti"]) expect(expanded).toContain(`https://www.iana.org/assignments/${iri}`);
  });

  it("validates against the W3C VC 2.0 JSON Schema", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(path.join(W3C, "verifiable-credential-schema.json"), "utf8")));
    expect(validate(unsecured), JSON.stringify(validate.errors)).toBe(true);
  });
});
