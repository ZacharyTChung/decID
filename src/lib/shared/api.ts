import { z } from "zod";
import { VERIFIER_ACTIONS } from "./constants";
import { POLICY_IDS } from "./policies";
import { MAX_DISCLOSURE_LENGTH, SD_CLAIM_NAMES } from "./sd-jwt";

/**
 * Request schemas shared by the route handlers (validation) and the browser
 * (typing). Responses always use `{ error: { code, message } }` for failures.
 */

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/** 65-byte ECDSA signatures from EOAs, or longer opaque signatures from EIP-1271 contract wallets (max 2 KiB). */
const Signature = z.string().regex(/^0x(?:[0-9a-fA-F]{2}){65,2048}$/);

export const SignInChallengeRequest = z.strictObject({
  address: Address,
  chainId: z.number().int().positive(),
  role: z.enum(["holder", "issuer"]),
});

export const SignInVerifyRequest = z.strictObject({
  message: z.string().min(1).max(4096),
  signature: Signature,
});

/**
 * Synthetic application data. Only the issuer sees it, and the server erases it
 * once the request is decided. The `SYN-` document prefix and the explicit
 * confirmation exist to discourage anyone from typing real identity data.
 */
export const SyntheticApplication = z.strictObject({
  fullName: z.string().trim().min(2).max(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  documentNumber: z.string().regex(/^SYN-[A-Z0-9]{4,16}$/, "synthetic document numbers start with SYN-"),
  country: z.string().regex(/^[A-Z]{2}$/),
  syntheticDataConfirmed: z.literal(true),
});
export type SyntheticApplicationT = z.infer<typeof SyntheticApplication>;

/**
 * A holder request. With `recoveryOf`, it asks the issuer to re-verify the applicant and
 * replace the credentials of a wallet they lost: those are revoked (or their unregistered
 * authorizations cancelled) before a credential is issued to the new wallet.
 */
export const HolderRequestBody = z.strictObject({
  ...SyntheticApplication.shape,
  recoveryOf: Address.optional(),
});

export const ReviewDecisionRequest = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("approve") }),
  z.strictObject({ decision: z.literal("reject"), reason: z.string().trim().min(3).max(200) }),
]);

export const RevokeRequest = z.strictObject({ commitment: Hex32 });

/** The wallet's answer to a Digital Credentials API request: `data.response` (base64url, HPKE-encrypted DeviceResponse). */
export const MdlResponseBody = z.strictObject({ response: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200_000) });

/** Demo/development only: a synthetic licence for the test wallet. */
export const TestLicenceBody = z.strictObject({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jurisdiction: z.string().regex(/^US-[A-Z]{2}$/).optional(),
});

export const ChallengeRequest = z.strictObject({ action: z.enum(VERIFIER_ACTIONS) });

export const PresentationSubmission = z.strictObject({
  challengeId: z.string().uuid(),
  credentialJwt: z.string().min(1).max(8192),
  disclosures: z.array(z.string().min(1).max(MAX_DISCLOSURE_LENGTH)).max(SD_CLAIM_NAMES.length),
  salt: Hex32,
  proof: z.strictObject({
    holder: Address,
    commitment: Hex32,
    expiresAt: z.number().int().positive(),
    signature: Signature,
  }),
});
export type PresentationSubmissionT = z.infer<typeof PresentationSubmission>;

export interface ChallengeResponse {
  challengeId: string;
  nonce: string;
  action: string;
  audience: string;
  chainId: number;
  registry: string;
  expiresAt: number;
  /** Selectively disclosable claims this action requires the holder to disclose (exactly these). */
  requestedClaims: string[];
  statement: string;
}

export type PublicKeyStatus<T> = T & { status: "active" | "retired" | "compromised"; activatedAt: number; retiredAt?: number };

export interface PublicConfigResponse {
  chainId: number;
  registry: string;
  gate: string;
  deploymentId: string;
  schemaId: string;
  rpcUrl: string;
  origin: string;
  /** Demo conveniences are on (DEMO_MODE=1): demo businesses, one-click dashboard sign-in. */
  demo: boolean;
  /** Government IDs (mobile driving licences) this deployment accepts for getting a Pass. */
  governmentId: { issuers: { name: string; test: boolean }[]; acceptsTestIds: boolean };
  issuers: {
    id: string;
    name: string;
    credentialKeys: PublicKeyStatus<{ did: string }>[];
    evmAttestationSigners: PublicKeyStatus<{ address: string }>[];
  }[];
}

export type RequestStatus = "pending" | "approved" | "rejected";

export interface HolderRequestView {
  id: string;
  status: RequestStatus;
  createdAt: number;
  reviewedAt: number | null;
  rejectReason: string | null;
  bundleAvailable: boolean;
  recoveryOf: string | null;
}

// ---------------------------------------------------------------- decID Verify (business API) and decID Pass

export const CreateVerificationRequest = z.strictObject({
  policy: z.enum(POLICY_IDS),
  /** The business's own reference (an order number, a door name). Must not contain personal data. */
  reference: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional(),
});

/** A wallet's answer to a verification session (the session id is the challenge id). */
export const WalletPresentation = PresentationSubmission.omit({ challengeId: true });

export const BusinessLoginRequest = z.strictObject({ apiKey: z.string().min(1).max(200) });
export const DemoBusinessLoginRequest = z.strictObject({ merchant: z.enum(["hopline", "neonhall"]) });
export const DemoSessionRequest = z.strictObject({ reference: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional() });

/** decID Pass: a registration transaction signed by the holder's device wallet, relayed and gas-sponsored. */
export const PassRegistrationRequest = z.strictObject({ rawTx: z.string().regex(/^0x[0-9a-fA-F]{2,8192}$/) });
