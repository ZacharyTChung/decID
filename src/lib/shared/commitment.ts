import { AbiCoder, getBytes, hexlify, keccak256 } from "ethers";
import { COMMITMENT_DOMAIN, MAX_CREDENTIAL_TOKEN_BYTES } from "./constants";

/**
 * Randomized credential commitment.
 *
 *   tokenBytes = the exact bytes of the JWS compact serialization as received
 *                (ASCII; never re-serialized from a parsed object)
 *   commitment = keccak256(abi.encode(bytes32 COMMITMENT_DOMAIN,
 *                                     bytes32 salt,
 *                                     bytes32 keccak256(tokenBytes)))
 *
 * `abi.encode` of three bytes32 values is their plain 96-byte concatenation.
 * The 32-byte salt is drawn from a CSPRNG per credential and stays in the
 * holder's private bundle, so the on-chain value cannot be linked to a token by
 * guessing: without the salt the commitment reveals nothing about the token.
 * It is a commitment, not encryption.
 */
export function credentialTokenBytes(token: string): Uint8Array {
  if (typeof token !== "string" || token.length === 0) throw new Error("empty credential token");
  // A JWS compact serialization is base64url segments joined by '.', so it is pure ASCII.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("credential token is not a JWS compact serialization");
  }
  if (token.length > MAX_CREDENTIAL_TOKEN_BYTES) throw new Error("credential token too large");
  return new TextEncoder().encode(token);
}

export function parseSalt(salt: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new Error("salt must be 32 bytes as 0x-prefixed hex");
  return getBytes(salt);
}

export function computeCommitment(tokenBytes: Uint8Array, salt: Uint8Array): string {
  if (salt.length !== 32) throw new Error("salt must be exactly 32 bytes");
  const tokenHash = keccak256(tokenBytes);
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "bytes32"],
    [COMMITMENT_DOMAIN, hexlify(salt), tokenHash],
  );
  return keccak256(encoded);
}

/** Convenience: commitment over a compact token string and a 0x-hex salt. */
export function commitmentFor(token: string, saltHex: string): string {
  return computeCommitment(credentialTokenBytes(token), parseSalt(saltHex));
}

export function randomSalt(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return hexlify(bytes);
}
