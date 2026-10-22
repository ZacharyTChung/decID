/**
 * Shared shape of a verifier result. Each check is reported separately so the
 * UI can show exactly which property failed. Signature validity, issuer
 * trust, wallet control, validity window, commitment and chain status are
 * different questions and are never merged into one flag.
 */
export const CHECK_IDS = [
  "challenge",
  "walletControl",
  "tokenFormat",
  "issuerTrust",
  "tokenSignature",
  "credentialSemantics",
  "validityWindow",
  "holderBinding",
  "deploymentBinding",
  "commitment",
  "registry",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const CHECK_LABELS: Record<CheckId, string> = {
  challenge: "Challenge fresh, unused and for this verifier",
  walletControl: "Presenter controls the holder wallet (EIP-712 proof)",
  tokenFormat: "Token format, algorithm allowlist and JOSE headers",
  issuerTrust: "Issuer DID and key are in the trusted issuer policy",
  tokenSignature: "Issuer signature over the credential",
  credentialSemantics: "Credential profile, schema and JWT/VC claim agreement",
  validityWindow: "Credential currently inside validFrom / validUntil",
  holderBinding: "Credential subject DID matches the presenting wallet",
  deploymentBinding: "Credential bound to this chain and registry",
  commitment: "Commitment recomputed from exact token bytes and salt",
  registry: "Live registry record matches and is active",
};

export type CheckStatus = "pass" | "fail" | "skipped";

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  code?: string; // stable machine-readable failure code
  detail?: string; // human-readable, never contains private input
}

export interface DisclosedClaims {
  holderDid: string;
  issuerDid: string;
  issuerName: string;
  identityVerified: true;
  validFrom: string;
  validUntil: string;
  credentialType: string;
}

export interface VerificationResult {
  verified: boolean;
  checks: CheckResult[];
  disclosed?: DisclosedClaims;
  registryStatus?: string;
  verifiedAt: string;
}
