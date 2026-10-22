import "server-only";
import { Contract } from "ethers";
import { provider } from "../chain";

/**
 * EIP-1271: asks a contract account whether `signature` is valid for `hash`.
 * Returns false for addresses without code (EOAs), reverts, wrong return values or RPC
 * errors, so a smart-account check can only ever add acceptance, never error out.
 *
 * The answer depends on the wallet's current on-chain state (owners, modules), and is
 * read at the latest block.
 */
const EIP1271_ABI = ["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"];
const EIP1271_MAGIC = "0x1626ba7e";

export async function isValidContractSignature(address: string, hash: string, signature: string): Promise<boolean> {
  try {
    const code = await provider().getCode(address);
    if (code === "0x") return false;
    const result = (await new Contract(address, EIP1271_ABI, provider()).getFunction("isValidSignature")(hash, signature)) as string;
    return result.toLowerCase() === EIP1271_MAGIC;
  } catch {
    return false;
  }
}
