import { z } from "zod";
import { HolderBundleV2 } from "./bundle";
import { CHECK_IDS } from "./verification";
import { VERIFIER_ACTIONS } from "./constants";
import { SD_CLAIM_NAMES, type SdClaimName } from "./sd-jwt";

/**
 * Response body schemas. They are the source of the response half of docs/openapi.json
 * (`npm run openapi`) and the API conformance test parses every real response with them.
 * They are strict on purpose: a response that grows an undocumented field fails the test,
 * which also guards against accidentally returning private data.
 */

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const TxHash = Hex32;
const Unix = z.number().int().nonnegative().describe("Unix time, seconds");
const KeyStatus = z.enum(["active", "retired", "compromised"]);
const RegistryStatus = z.enum(["None", "Active", "Revoked", "IssuerInactive", "NotYetValid", "Expired"]);

export const ErrorBody = z
  .strictObject({ error: z.strictObject({ code: z.string().describe("Stable machine-readable code"), message: z.string() }) })
  .describe("Every failure. Messages never echo submitted values.");

export const ConfigResponse = z.strictObject({
  chainId: z.number().int().positive(),
  registry: Address,
  gate: Address,
  deploymentId: Hex32,
  schemaId: Hex32,
  rpcUrl: z.string(),
  origin: z.string(),
  issuers: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      credentialKeys: z.array(z.strictObject({ did: z.string(), status: KeyStatus, activatedAt: Unix, retiredAt: Unix.optional() })),
      evmAttestationSigners: z.array(z.strictObject({ address: Address, status: KeyStatus, activatedAt: Unix, retiredAt: Unix.optional() })),
    }),
  ),
});

export const SignInMessageResponse = z.strictObject({ message: z.string().describe("EIP-4361 (SIWE) message to sign unmodified") });

const SessionView = z.strictObject({ address: Address, chainId: z.number().int().positive(), role: z.enum(["holder", "issuer"]), expiresAt: Unix });
export const SignInResponse = z.strictObject({ session: SessionView });
export const SessionResponse = z.strictObject({ session: SessionView.nullable() });
export const OkResponse = z.strictObject({ ok: z.literal(true) });

export const CreatedRequestResponse = z.strictObject({ id: z.uuid() });
export const HolderRequestsResponse = z.strictObject({
  requests: z.array(
    z.strictObject({
      id: z.uuid(),
      status: z.enum(["pending", "approved", "rejected"]),
      createdAt: Unix,
      reviewedAt: Unix.nullable(),
      rejectReason: z.string().nullable(),
      bundleAvailable: z.boolean(),
      recoveryOf: Address.nullable(),
    }),
  ),
});
export const BundleResponse = z.strictObject({ bundle: HolderBundleV2.describe("Private holder bundle; returned once, then deleted on the server") });

export const PendingRequestsResponse = z.strictObject({
  requests: z.array(
    z.strictObject({
      id: z.uuid(),
      holderDid: z.string(),
      createdAt: Unix,
      application: z
        .strictObject({ fullName: z.string(), dateOfBirth: z.string(), documentNumber: z.string(), country: z.string(), syntheticDataConfirmed: z.literal(true) })
        .describe("Synthetic application data; erased when the request is decided"),
      recovery: z.strictObject({ previousHolder: Address, liveCredentials: z.number().int().nonnegative() }).nullable(),
    }),
  ),
});
export const DecisionResponse = z.union([
  z.strictObject({ status: z.literal("rejected") }),
  z.strictObject({
    status: z.literal("approved"),
    requestId: z.uuid(),
    commitment: Hex32,
    credentialId: z.string(),
    superseded: z.strictObject({ revoked: z.array(Hex32), cancelled: z.array(Hex32) }).optional(),
  }),
]);
export const IssuedCredentialsResponse = z.strictObject({
  credentials: z.array(
    z.strictObject({
      commitment: Hex32,
      credentialId: z.string(),
      holderDid: z.string(),
      validFrom: Unix,
      expiresAt: Unix,
      issuedAt: Unix,
      revokedAt: Unix.nullable(),
      revokeTx: TxHash.nullable(),
      onChainStatus: z.union([RegistryStatus, z.enum(["NotRegistered", "RpcUnavailable", "Unknown"])]),
    }),
  ),
});
export const RevokeResponse = z.strictObject({ txHash: TxHash });

export const AuditResponse = z.strictObject({
  verification: z.strictObject({
    ok: z.boolean(),
    entries: z.number().int().nonnegative(),
    head: z.string().regex(/^[0-9a-f]{64}$/),
    firstBrokenSeq: z.number().int().optional(),
    problem: z.string().optional(),
  }),
  entries: z.array(
    z.strictObject({
      seq: z.number().int().positive(),
      at: Unix,
      actor: Address,
      action: z.enum(["request.rejected", "credential.issued", "credential.revoked", "credential.superseded"]),
      subject: z.string(),
      details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      prevHash: z.string().regex(/^[0-9a-f]{64}$/),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

export const ChallengeResponseSchema = z.strictObject({
  challengeId: z.uuid(),
  nonce: Hex32,
  action: z.enum(VERIFIER_ACTIONS),
  audience: z.string(),
  chainId: z.number().int().positive(),
  registry: Address,
  expiresAt: Unix,
  requestedClaims: z.array(z.enum(SD_CLAIM_NAMES as [SdClaimName, ...SdClaimName[]])).describe("Disclose exactly these SD-JWT claims"),
  statement: z.string(),
});

export const VerificationResponse = z.strictObject({
  verified: z.boolean(),
  checks: z.array(
    z.strictObject({
      id: z.enum(CHECK_IDS),
      status: z.enum(["pass", "fail", "skipped"]),
      code: z.string().optional(),
      detail: z.string().optional(),
    }),
  ),
  disclosed: z
    .strictObject({
      holderDid: z.string(),
      issuerDid: z.string(),
      issuerName: z.string(),
      identityVerified: z.literal(true),
      validFrom: z.string(),
      validUntil: z.string(),
      credentialType: z.string(),
      claims: z.record(z.string(), z.union([z.boolean(), z.string()])).describe("Selectively disclosed claims (exactly those requested)"),
    })
    .optional(),
  registryStatus: z.string().optional(),
  verifiedAt: z.string(),
});

export const VerifierHistoryResponse = z.strictObject({
  entries: z.array(
    z.strictObject({
      ref: z.string(),
      action: z.string(),
      createdAt: Unix,
      status: z.enum(["verified", "rejected", "unused", "expired"]),
      code: z.string().nullable(),
    }),
  ),
});
