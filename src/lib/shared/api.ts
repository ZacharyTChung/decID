import { z } from "zod";
import { VERIFIER_ACTIONS } from "./constants";

/**
 * Request schemas shared by the route handlers (validation) and the browser
 * (typing). Responses always use `{ error: { code, message } }` for failures.
 */

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const SignInChallengeRequest = z.strictObject({
  address: Address,
  chainId: z.number().int().positive(),
  role: z.enum(["holder", "issuer"]),
});

export const SignInVerifyRequest = z.strictObject({
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
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

export const ChallengeRequest = z.strictObject({ action: z.enum(VERIFIER_ACTIONS) });

export const PresentationSubmission = z.strictObject({
  challengeId: z.string().uuid(),
  credentialJwt: z.string().min(1).max(8192),
  salt: Hex32,
  proof: z.strictObject({
    holder: Address,
    commitment: Hex32,
    expiresAt: z.number().int().positive(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
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
