import type { VerifierAction } from "./constants";

/**
 * decID Verify policies: what a business may ask. Each maps to a verifier action (and thus to
 * the exact SD-JWT claims the holder discloses) and to the single yes/no answer the business
 * receives. A business never receives the holder's identifiers or any other claim.
 */
export const POLICY_IDS = ["age_over_21", "age_over_18", "identity_verified"] as const;
export type PolicyId = (typeof POLICY_IDS)[number];

export interface Policy {
  id: PolicyId;
  action: VerifierAction;
  /** The question shown to the holder. */
  question: string;
  /** Short label for what is shared ("21+"). */
  short: string;
  /** Key of the boolean the business receives when the policy is satisfied. */
  resultKey: "ageOver21" | "ageOver18" | "identityVerified";
}

export const POLICIES: Record<PolicyId, Policy> = {
  age_over_21: { id: "age_over_21", action: "verify-age-over-21", question: "Are you 21 or older?", short: "21+", resultKey: "ageOver21" },
  age_over_18: { id: "age_over_18", action: "access-age-restricted-area", question: "Are you 18 or older?", short: "18+", resultKey: "ageOver18" },
  identity_verified: { id: "identity_verified", action: "access-verified-member-area", question: "Has a trusted office verified your identity?", short: "Verified person", resultKey: "identityVerified" },
};

/** What a business never sees, whatever it asks (shown to the holder before they share). */
export const NEVER_SHARED = ["Name", "Birth date", "Address", "ID number", "ID photo or selfie", "Your other claims"] as const;

/** Human-readable reasons for verifier failure codes, for wallets and door screens. */
export function friendlyReason(code: string | null | undefined): string {
  switch (code) {
    case "POLICY_NOT_SATISFIED":
      return "Not old enough";
    case "REVOKED":
      return "Credential revoked";
    case "EXPIRED":
    case "REGISTRY_EXPIRED":
      return "Credential expired";
    case "NOT_REGISTERED":
      return "Credential not activated";
    case "SUBJECT_NOT_PRESENTER":
    case "PROOF_SIGNER_MISMATCH":
      return "Credential belongs to someone else";
    case "CHALLENGE_REUSED":
    case "SESSION_USED":
      return "This request was already used";
    case "SESSION_EXPIRED":
    case "CHALLENGE_EXPIRED":
      return "Request expired";
    case "CLAIM_NOT_DISCLOSED":
      return "Required answer not shared";
    default:
      return code ? "Could not be verified" : "";
  }
}
