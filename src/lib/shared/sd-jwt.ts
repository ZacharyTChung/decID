import { z } from "zod";
import { decodeBase64, encodeBase64, sha256 } from "ethers";

/**
 * Selective Disclosure for JWTs (SD-JWT, RFC 9901), the subset this profile uses:
 * object-property disclosures inside `credentialSubject`, SHA-256 digests, decoy digests,
 * and no Key Binding JWT (holder binding is the wallet's EIP-712 presentation proof, which
 * signs `sdHash` of the exact presentation instead).
 *
 *   disclosure = base64url( UTF-8( JSON [ salt, claimName, claimValue ] ) )
 *   digest     = base64url( SHA-256( ASCII(disclosure) ) )
 *   presentation (compact) = <issuer-signed JWT> "~" <disclosure> "~" ... <disclosure> "~"
 *
 * Runs in the browser (holder) and on the server (issuer, verifier); no Node-only APIs.
 */

export const SD_ALG = "sha-256";

/**
 * The issuer-asserted claims a holder may disclose one by one. Everything a verifier needs
 * to validate the credential (context, type, issuer, validity, status, schema, holder DID,
 * identityVerified) stays always-disclosed, as VC-JOSE-COSE recommends.
 */
export const SD_CLAIM_SCHEMAS = {
  ageOver18: z.boolean(),
  ageOver21: z.boolean(),
  countryOfResidence: z.string().regex(/^[A-Z]{2}$/),
} as const;
export type SdClaimName = keyof typeof SD_CLAIM_SCHEMAS;
export const SD_CLAIM_NAMES = Object.keys(SD_CLAIM_SCHEMAS) as SdClaimName[];
export type SdClaims = { [K in SdClaimName]: z.infer<(typeof SD_CLAIM_SCHEMAS)[K]> };

/** Every credential carries exactly this many digests (real + decoys), so the count reveals nothing. */
export const SD_DIGEST_COUNT = 8;
export const MAX_DISCLOSURE_LENGTH = 512;

export const SdDigest = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function base64urlEncode(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return decodeBase64(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

/** SD-JWT digest of a disclosure: SHA-256 over the ASCII disclosure string, base64url. */
export function disclosureDigest(disclosure: string): string {
  return base64urlEncode(hexToBytes(sha256(new TextEncoder().encode(disclosure))));
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomB64url(bytes: number): string {
  return base64urlEncode(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

export function encodeDisclosure(salt: string, name: string, value: unknown): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify([salt, name, value])));
}

export interface DecodedDisclosure {
  disclosure: string;
  digest: string;
  salt: string;
  name: string;
  value: unknown;
}

/** Structural decode only. It says nothing about whether the issuer signed the disclosure. */
export function decodeDisclosure(disclosure: string): DecodedDisclosure {
  if (disclosure.length === 0 || disclosure.length > MAX_DISCLOSURE_LENGTH) throw new Error("disclosure length out of range");
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64urlDecode(disclosure)));
  if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error("an object-property disclosure is a 3-element array");
  const [salt, name, value] = parsed as [unknown, unknown, unknown];
  if (typeof salt !== "string" || salt.length < 22) throw new Error("salt must be a string of at least 128 bits");
  if (typeof name !== "string") throw new Error("claim name must be a string");
  return { disclosure, digest: disclosureDigest(disclosure), salt, name, value };
}

/** Issuer: one disclosure per claim, plus decoys, digests sorted so their order reveals nothing. */
export function createDisclosures(claims: SdClaims): { disclosures: string[]; sd: string[] } {
  const disclosures = SD_CLAIM_NAMES.map((name) => encodeDisclosure(randomB64url(16), name, claims[name]));
  const sd = disclosures.map(disclosureDigest);
  while (sd.length < SD_DIGEST_COUNT) sd.push(base64urlEncode(hexToBytes(sha256(globalThis.crypto.getRandomValues(new Uint8Array(32))))));
  return { disclosures, sd: sd.sort() };
}

/** The SD-JWT compact presentation: the JWT, then each disclosure, each followed by "~". */
export function compactPresentation(jwt: string, disclosures: string[]): string {
  return `${jwt}~${disclosures.map((d) => `${d}~`).join("")}`;
}

/**
 * Hash of the exact presentation, signed by the holder in the EIP-712 proof (the analog of a
 * KB-JWT's `sd_hash`), so disclosures cannot be added, removed or swapped after signing.
 */
export function sdHash(jwt: string, disclosures: string[]): string {
  return sha256(new TextEncoder().encode(compactPresentation(jwt, disclosures)));
}

/** Holder: the disclosures for exactly the requested claims, in request order. */
export function selectDisclosures(all: string[], requested: readonly string[]): string[] {
  const byName = new Map(all.map((d) => [decodeDisclosure(d).name, d]));
  return requested.map((name) => {
    const d = byName.get(name);
    if (!d) throw new Error(`credential has no disclosable claim ${name}`);
    return d;
  });
}

export type DisclosureCheck =
  | { ok: true; claims: Partial<SdClaims>; names: SdClaimName[] }
  | { ok: false; code: string; detail: string };

/**
 * Verifier: processes presented disclosures against the digests in the VERIFIED payload
 * (RFC 9901 §7.1): each must be well-formed, reference a digest exactly once, name an allowed
 * claim not already present, and carry a valid value.
 */
export function processDisclosures(sd: readonly string[], disclosures: readonly string[]): DisclosureCheck {
  const fail = (code: string, detail: string): DisclosureCheck => ({ ok: false, code, detail });
  const digests = new Set(sd);
  if (digests.size !== sd.length) return fail("DIGEST_DUPLICATE", "the credential repeats a digest");
  const seenDigests = new Set<string>();
  const claims: Record<string, unknown> = {};
  for (const d of disclosures) {
    let dec: DecodedDisclosure;
    try {
      dec = decodeDisclosure(d);
    } catch (e) {
      return fail("DISCLOSURE_MALFORMED", (e as Error).message);
    }
    if (seenDigests.has(dec.digest)) return fail("DISCLOSURE_DUPLICATE", "the same disclosure was presented twice");
    seenDigests.add(dec.digest);
    if (!digests.has(dec.digest)) return fail("DISCLOSURE_NOT_REFERENCED", "a disclosure is not referenced by the issuer-signed credential");
    if (!(dec.name in SD_CLAIM_SCHEMAS)) return fail("DISCLOSURE_CLAIM_NOT_ALLOWED", `claim ${JSON.stringify(dec.name).slice(0, 40)} is not selectively disclosable in this profile`);
    if (dec.name in claims) return fail("DISCLOSURE_DUPLICATE", `claim ${dec.name} disclosed twice`);
    const v = SD_CLAIM_SCHEMAS[dec.name as SdClaimName].safeParse(dec.value);
    if (!v.success) return fail("DISCLOSURE_VALUE_INVALID", `claim ${dec.name} has an invalid value`);
    claims[dec.name] = v.data;
  }
  return { ok: true, claims: claims as Partial<SdClaims>, names: Object.keys(claims) as SdClaimName[] };
}
