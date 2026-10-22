import { z } from "zod";

/**
 * Explicit trust policy for credential issuers (format version 2).
 *
 * Each issuer entry binds, out of band, things that are otherwise unrelated:
 *   - its credential signing keys: each a did:key DID + kid + public JWK. With did:key
 *     the DID *is* the key, so rotating the key yields a new DID; the logical issuer
 *     (`id`) owns all of them;
 *   - its EVM attestation signers: the addresses that authorize on-chain registrations.
 *
 * Every key and signer has a lifecycle:
 *   active       may sign new credentials / authorizations
 *   retired      no longer used; credentials issued while it was active stay valid
 *                (iat in [activatedAt, retiredAt))
 *   compromised  everything it ever signed is rejected (a key thief can backdate iat)
 *
 * A credential is only accepted if its signing DID is listed here. The verification key
 * comes from this file, cross-checked against did:key resolution, never from the token
 * or the presenter. Self-issued DIDs are therefore rejected.
 */
const KeyStatus = z.enum(["active", "retired", "compromised"]);
const Lifecycle = {
  status: KeyStatus,
  activatedAt: z.number().int().nonnegative(),
  retiredAt: z.number().int().nonnegative().optional(),
};
const CredentialKey = z.strictObject({
  did: z.string().startsWith("did:key:"),
  kid: z.string(),
  publicKeyJwk: z.strictObject({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string() }),
  ...Lifecycle,
});
const EvmSigner = z.strictObject({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ...Lifecycle,
});
const TrustedIssuer = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().min(1),
  credentialKeys: z.array(CredentialKey).min(1),
  evmAttestationSigners: z.array(EvmSigner).min(1),
  credentialTypes: z.array(z.string()).min(1),
  schemaIds: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).min(1),
});
export const TrustFileSchema = z.strictObject({ version: z.literal(2), issuers: z.array(TrustedIssuer) });

export type TrustedIssuerT = z.infer<typeof TrustedIssuer>;
export type CredentialKeyT = z.infer<typeof CredentialKey>;
export type EvmSignerT = z.infer<typeof EvmSigner>;
export type TrustFileT = z.infer<typeof TrustFileSchema>;

/** Was this key/signer allowed to sign something stamped at `at` (unix seconds)? Compromised: never. */
export function validAt(entry: { status: z.infer<typeof KeyStatus>; activatedAt: number; retiredAt?: number }, at: number): boolean {
  if (entry.status === "compromised") return false;
  if (at < entry.activatedAt) return false;
  if (entry.status === "retired") return entry.retiredAt !== undefined && at < entry.retiredAt;
  return true;
}

/** The trusted EVM signer entry for `address`, if it may have authorized something issued at `issuedAt`. */
export function trustedEvmSigner(issuer: TrustedIssuerT, address: string, issuedAt: number): EvmSignerT | undefined {
  return issuer.evmAttestationSigners.find((s) => s.address.toLowerCase() === address.toLowerCase() && validAt(s, issuedAt));
}

