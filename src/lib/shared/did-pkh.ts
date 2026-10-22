import { getAddress } from "ethers";

/**
 * Holder identifiers use did:pkh with CAIP-10 account ids, restricted to the
 * eip155 (EVM) namespace:
 *
 *   did:pkh:eip155:<chainId>:<EIP-55 checksummed address>
 *
 * Derivation is deterministic string formatting. The DID says nothing about who
 * controls the account. Control is proven separately (SIWE / EIP-712 signatures).
 *
 * Parsing rules (deliberately strict):
 * - method must be `pkh`, namespace must be `eip155`;
 * - chain reference is a decimal integer without leading zeros (CAIP-2 eip155);
 * - address is 0x + 40 hex chars; mixed-case input must carry a valid EIP-55
 *   checksum (all-lower / all-upper are accepted and normalized);
 * - no DID URL components (path, query, fragment) are accepted.
 */
const DID_PKH_EIP155 = /^did:pkh:eip155:([1-9][0-9]{0,15}):(0x[0-9a-fA-F]{40})$/;

export interface PkhAccount {
  chainId: number;
  address: string; // EIP-55 checksummed
}

export function deriveHolderDid(chainId: number | bigint, address: string): string {
  const id = Number(chainId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("invalid chain id");
  return `did:pkh:eip155:${id}:${getAddress(address)}`;
}

export function parseHolderDid(did: string): PkhAccount {
  if (typeof did !== "string") throw new Error("DID must be a string");
  if (!did.startsWith("did:")) throw new Error("not a DID");
  if (!did.startsWith("did:pkh:")) throw new Error(`unsupported DID method for holder: ${did.split(":")[1] ?? ""}`);
  const m = DID_PKH_EIP155.exec(did);
  if (!m) throw new Error("malformed did:pkh (only eip155 accounts are supported)");
  const chainId = Number(m[1]);
  if (!Number.isSafeInteger(chainId)) throw new Error("chain id out of range");
  let address: string;
  try {
    address = getAddress(m[2]!);
  } catch {
    throw new Error("invalid EIP-55 checksum in did:pkh address");
  }
  return { chainId, address };
}

export function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}
