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
  demo: z.boolean(),
  governmentId: z.strictObject({
    issuers: z.array(z.strictObject({ name: z.string(), test: z.boolean() })).describe("Issuing authorities whose mobile licences are accepted"),
    acceptsTestIds: z.boolean(),
  }),
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

export const CreatedRequestResponse = z.strictObject({ id: z.uuid(), status: z.literal("approved").optional().describe("Present when the demo issuer approved at once (ISSUER_AUTO_APPROVE=1)") });
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
export const MdlRequestResponse = z.strictObject({
  id: z.string().uuid(),
  protocol: z.literal("org-iso-mdoc"),
  data: z.strictObject({ deviceRequest: z.string(), encryptionInfo: z.string() }).describe("Pass unchanged to navigator.credentials.get({ digital: { requests: [{ protocol, data }] } })"),
  expiresAt: Unix,
});

export const MdlIssuanceResponse = z.strictObject({
  requestId: z.string().uuid().describe("Pick the credential up with postBundlePickup"),
  commitment: Hex32,
  credentialId: z.string(),
  superseded: z.strictObject({ revoked: z.array(Hex32), cancelled: z.array(Hex32) }).optional().describe("Earlier Passes backed by the same licence, now shut down"),
  issuer: z.strictObject({ name: z.string(), test: z.boolean() }).describe("The issuing authority that signed the licence"),
  ageOver18: z.boolean(),
  ageOver21: z.boolean(),
  replacedPass: z.boolean(),
});

export const TestLicenceResponse = z.strictObject({
  authority: z.string(),
  mdoc: z.string().describe("Issuer-signed licence (CBOR, base64url) for the test wallet"),
  devicePrivateJwk: z.record(z.string(), z.unknown()).describe("The test phone's device key"),
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

/** The log compared with its on-chain checkpoints (contracts/ReceiptAnchor.sol); null when anchoring isn't deployed. */
export const AnchorStatus = z
  .union([
    z.strictObject({
      ok: z.boolean(),
      anchoredCount: z.number().int(),
      checkpoints: z.number().int(),
      unanchored: z.number().int().describe("Entries newer than the latest checkpoint, waiting to be anchored"),
      latestBlock: z.number().int().optional(),
      latestTx: z.string().optional(),
      brokenAt: z.number().int().optional(),
      problem: z.string().optional(),
    }),
    z.strictObject({ unavailable: z.literal(true) }),
  ])
  .nullable();

export const AuditResponse = z.strictObject({
  verification: z.strictObject({
    ok: z.boolean(),
    entries: z.number().int().nonnegative(),
    head: z.string().regex(/^[0-9a-f]{64}$/),
    firstBrokenSeq: z.number().int().optional(),
    problem: z.string().optional(),
    anchor: AnchorStatus,
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

// ---------------------------------------------------------------- decID Verify, decID Pass, business dashboard, demo

const PolicyId = z.enum(["age_over_21", "age_over_18", "identity_verified"]);
const SessionStatus = z.enum(["pending", "processing", "verified", "rejected", "expired"]);
const Answer = z
  .partialRecord(z.enum(["ageOver21", "ageOver18", "identityVerified"]), z.boolean())
  .nullable()
  .describe("The one answer the business receives: true when satisfied, false only when the holder genuinely does not meet the policy");
const MatchCode = z.string().regex(/^[A-Z0-9]{4}$/).nullable().describe("Shown on the holder's phone and to the business; compare them at a door");

const VerificationCore = {
  id: z.uuid(),
  policy: PolicyId,
  reference: z.string().nullable(),
  status: SessionStatus,
  createdAt: Unix,
  expiresAt: Unix,
  completedAt: Unix.nullable(),
  result: Answer,
  failureCode: z.string().nullable(),
  matchCode: MatchCode,
  issuer: z.strictObject({ name: z.string() }).nullable(),
};
export const VerificationResponseV1 = z
  .strictObject({ ...VerificationCore, walletUrl: z.string().url(), receipt: z.string().nullable().describe("Signed compliance receipt (compact JWS, typ decid-receipt+jwt)") })
  .describe("A verification as the business sees it. Holds no personal data.");

export const WalletRequestResponse = z.strictObject({
  id: z.uuid(),
  merchant: z.strictObject({ name: z.string(), kind: z.enum(["online", "venue"]) }),
  policy: z.strictObject({ id: PolicyId, question: z.string(), short: z.string() }),
  status: SessionStatus,
  expiresAt: Unix,
  challenge: ChallengeResponseSchema,
});

export const PresentationOutcome = z.strictObject({
  status: z.enum(["verified", "rejected"]),
  failureCode: z.string().nullable(),
  matchCode: MatchCode,
  merchant: z.strictObject({ name: z.string() }),
  policy: z.strictObject({ id: PolicyId, short: z.string() }),
});

export const ReceiptKeysResponse = z.strictObject({
  keys: z.array(z.strictObject({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string(), kid: z.string(), alg: z.literal("Ed25519"), use: z.literal("sig") })),
});

export const PassRegistrationParams = z.strictObject({
  chainId: z.number().int().positive(),
  to: Address,
  nonce: z.number().int().nonnegative(),
  gasLimit: z.string().regex(/^\d+$/),
  maxFeePerGas: z.string().regex(/^\d+$/),
  maxPriorityFeePerGas: z.string().regex(/^\d+$/),
});
export const PassRegistrationResult = z.strictObject({
  txHash: TxHash,
  status: z.enum(["registered", "reverted"]),
  gasUsed: z.string().regex(/^\d+$/),
  sponsoredWei: z.string().regex(/^\d+$/).describe("Gas money decID added to the holder's wallet; 0 if it had enough"),
});
export const PassCredentialStatus = z.strictObject({ status: z.union([RegistryStatus, z.literal("NotRegistered")]) });

export const BusinessSessionResponse = z.strictObject({ merchant: z.strictObject({ id: z.string(), name: z.string() }) });
export const ReceiptExportResponse = z
  .strictObject({
    format: z.literal("decid-receipts/v1"),
    exportedAt: z.string(),
    merchant: z.strictObject({ id: z.string(), name: z.string() }),
    receiptKeys: z.strictObject({ keys: z.array(z.strictObject({ kty: z.string(), crv: z.string(), x: z.string(), kid: z.string(), alg: z.string(), use: z.string() })) }),
    anchor: z.strictObject({ chainId: z.number().int(), contract: z.string(), stream: z.string(), streamId: z.string() }).nullable(),
    receipts: z.array(z.strictObject({ seq: z.number().int().positive(), jws: z.string() })),
  })
  .describe("Every compliance receipt of the business, for its auditor. Verify with `npm run verify-receipts`: decID's public keys and the chain are all it needs. No personal data.");

export const BusinessOverviewResponse = z.strictObject({
  merchant: z.strictObject({ id: z.string(), name: z.string(), kind: z.enum(["online", "venue"]), keyPrefix: z.string() }),
  stats: z.strictObject({
    total: z.number().int(),
    verified: z.number().int(),
    rejected: z.number().int(),
    pending: z.number().int(),
    expired: z.number().int(),
    medianSecondsToAnswer: z.number().nullable(),
    failures: z.record(z.string(), z.number().int()),
  }),
  receipts: z.strictObject({ ok: z.boolean(), count: z.number().int(), head: z.string(), firstBrokenSeq: z.number().int().optional(), problem: z.string().optional(), anchor: AnchorStatus }),
  storedFields: z.array(z.string()).describe("Every column of a verification record: proof that none can hold personal data"),
  recent: z.array(z.strictObject(VerificationCore)),
});

export const DemoSessionCreated = z.strictObject({ id: z.uuid(), walletUrl: z.string().url(), qrSvg: z.string().startsWith("<svg"), expiresAt: Unix });
export const DemoSessionStatus = z.strictObject({
  status: SessionStatus,
  result: Answer,
  failureCode: z.string().nullable(),
  reason: z.string(),
  matchCode: MatchCode,
  issuer: z.strictObject({ name: z.string() }).nullable(),
  receipt: z.strictObject({ valid: z.boolean(), payload: z.unknown().optional() }).nullable(),
  reference: z.string().nullable(),
});
