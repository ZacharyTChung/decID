import { getAddress, type TypedDataDomain, type TypedDataField } from "ethers";

/**
 * EIP-712 structures.
 *
 * 1. RegistrationAuthorization: signed by the issuer's EVM attestation key,
 *    verified on-chain by CredentialRegistry.register. The domain binds the
 *    chain id and the registry address, so an authorization cannot be replayed
 *    on another chain or deployment. Replay on the same deployment is prevented
 *    by the registry's permanent one-registration-per-commitment rule.
 *
 * 2. PresentationProof: an APPLICATION-SPECIFIC holder proof of wallet control
 *    for one verifier challenge. It is not a W3C Verifiable Presentation and
 *    not a standardized presentation format. It is verified off-chain by the
 *    verifier service. Its domain also binds the chain id and registry address
 *    so a proof for one deployment is useless against another.
 */

export const REGISTRY_EIP712_NAME = "CredentialRegistry";
export const REGISTRY_EIP712_VERSION = "1";

export const REGISTRATION_TYPES: Record<string, TypedDataField[]> = {
  RegistrationAuthorization: [
    { name: "commitment", type: "bytes32" },
    { name: "holder", type: "address" },
    { name: "issuer", type: "address" },
    { name: "schemaId", type: "bytes32" },
    { name: "validFrom", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "issuerEpoch", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "deploymentId", type: "bytes32" },
  ],
};

export interface RegistrationAuthorization {
  commitment: string;
  holder: string;
  issuer: string;
  schemaId: string;
  validFrom: number;
  expiresAt: number;
  issuerEpoch: number;
  deadline: number;
  deploymentId: string;
}

export function registryDomain(chainId: number | bigint, registry: string): TypedDataDomain {
  return {
    name: REGISTRY_EIP712_NAME,
    version: REGISTRY_EIP712_VERSION,
    chainId: BigInt(chainId),
    verifyingContract: getAddress(registry),
  };
}

export const PRESENTATION_EIP712_NAME = "CredentialPresentation";
/** v2: the proof also signs which claims are disclosed and the hash of the exact SD-JWT presentation. */
export const PRESENTATION_EIP712_VERSION = "2";

export const PRESENTATION_TYPES: Record<string, TypedDataField[]> = {
  PresentationProof: [
    { name: "statement", type: "string" },
    { name: "audience", type: "string" },
    { name: "action", type: "string" },
    { name: "challenge", type: "bytes32" },
    { name: "holder", type: "address" },
    { name: "commitment", type: "bytes32" },
    { name: "disclosed", type: "string" },
    { name: "sdHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
};

export interface PresentationProof {
  statement: string;
  audience: string;
  action: string;
  challenge: string;
  holder: string;
  commitment: string;
  /** Comma-separated names of the selectively disclosed claims, in presentation order ("" for none). */
  disclosed: string;
  /** sdHash(credentialJwt, disclosures): SHA-256 of the exact SD-JWT compact presentation. */
  sdHash: string;
  expiresAt: number;
}

export function presentationDomain(chainId: number | bigint, registry: string): TypedDataDomain {
  return {
    name: PRESENTATION_EIP712_NAME,
    version: PRESENTATION_EIP712_VERSION,
    chainId: BigInt(chainId),
    verifyingContract: getAddress(registry),
  };
}

/** The exact consent text the holder signs. The verifier recomputes and compares it. */
export function presentationStatement(audience: string, action: string, disclosed: readonly string[] = []): string {
  const extra = disclosed.length ? `, and only these optional claims: ${disclosed.join(", ")}` : ", and no optional claims";
  return `I consent to share my Identity Verified credential (holder DID, issuer, validity, identityVerified=true${extra}) with ${audience} for the action "${action}".`;
}

/** Builds the PresentationProof message; holder, verifier, CLI and tests all use this. */
export function presentationMessage(p: {
  audience: string;
  action: string;
  challenge: string;
  holder: string;
  commitment: string;
  disclosed: readonly string[];
  sdHash: string;
  expiresAt: number;
}): PresentationProof {
  return {
    statement: presentationStatement(p.audience, p.action, p.disclosed),
    audience: p.audience,
    action: p.action,
    challenge: p.challenge,
    holder: p.holder,
    commitment: p.commitment,
    disclosed: p.disclosed.join(","),
    sdHash: p.sdHash,
    expiresAt: p.expiresAt,
  };
}
