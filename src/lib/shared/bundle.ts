import { z } from "zod";
import { MAX_DISCLOSURE_LENGTH, SD_CLAIM_NAMES } from "./sd-jwt";
import { ENCRYPTED_BUNDLE_VERSION, HOLDER_BUNDLE_VERSION } from "./constants";

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Uint64 = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * The holder's private bundle. It contains everything needed to register and
 * present the credential, and must never be posted to a public place:
 * the exact signed token bytes, the commitment salt, and the issuer's
 * registration authorization.
 */
export const HolderBundleV2 = z.strictObject({
  version: z.literal(HOLDER_BUNDLE_VERSION),
  /** Issuer-signed JWT of the SD-JWT (the commitment covers exactly these bytes). */
  credentialJwt: z.string().min(1).max(8192),
  /** All SD-JWT disclosures issued with it; the holder presents only the ones a verifier requests. */
  disclosures: z.array(z.string().min(1).max(MAX_DISCLOSURE_LENGTH)).max(SD_CLAIM_NAMES.length),
  salt: Hex32,
  commitment: Hex32,
  authorization: z.strictObject({
    commitment: Hex32,
    holder: Address,
    issuer: Address,
    schemaId: Hex32,
    validFrom: Uint64,
    expiresAt: Uint64,
    issuerEpoch: Uint64,
    deadline: Uint64,
    deploymentId: Hex32,
  }),
  authorizationSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  deployment: z.strictObject({ chainId: z.number().int().positive(), registry: Address }),
  issuedAt: z.string(),
});
export type HolderBundle = z.infer<typeof HolderBundleV2>;

const B64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);

/**
 * Encrypted export envelope.
 *   KDF:    PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte random salt
 *   Cipher: AES-256-GCM, 12-byte random IV, 128-bit tag
 *   AAD:    UTF-8 of `${version}|${iterations}|${kdfSalt}|${iv}`, which binds the header
 * Only standard WebCrypto primitives are used. The password is never stored.
 */
export const EncryptedBundleV1 = z.strictObject({
  version: z.literal(ENCRYPTED_BUNDLE_VERSION),
  kdf: z.strictObject({
    name: z.literal("PBKDF2"),
    hash: z.literal("SHA-256"),
    iterations: z.number().int().min(100_000).max(10_000_000),
    salt: B64Url,
  }),
  cipher: z.strictObject({ name: z.literal("AES-GCM"), iv: B64Url }),
  ciphertext: B64Url,
});
export type EncryptedBundle = z.infer<typeof EncryptedBundleV1>;
