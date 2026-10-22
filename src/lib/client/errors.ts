"use client";
import { Interface } from "ethers";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "@/generated/contracts";
import { ClientApiError } from "./api";

const registryIface = new Interface(CREDENTIAL_REGISTRY_ABI);
const gateIface = new Interface(DEMO_GATE_ABI);
const STATUS = ["None (not registered)", "Active", "Revoked", "Issuer inactive", "Not yet valid", "Expired"];

const CONTRACT_MESSAGES: Record<string, string> = {
  SenderNotHolder: "Only the holder wallet named in the authorization can register it.",
  AuthorizationExpired: "The issuer's registration authorization has passed its submission deadline. Ask the issuer for a new credential.",
  AlreadyRegistered: "This credential commitment is already registered (or was revoked). It cannot be registered again.",
  IssuerNotActive: "The issuer is not currently authorized in the registry.",
  StaleIssuerEpoch: "The issuer was removed and re-added since this authorization was signed, so it is no longer accepted.",
  SignerNotIssuer: "The authorization signature does not match the issuer.",
  CredentialAlreadyExpired: "The credential has already expired.",
  InvalidValidityWindow: "The authorization has an invalid validity window.",
};

/** Turns wallet, RPC and contract errors into one honest sentence. */
export function describeError(err: unknown): string {
  if (err instanceof ClientApiError) return `${err.message} (${err.code})`;
  const e = err as { code?: string | number; shortMessage?: string; message?: string; data?: string; info?: { error?: { code?: number; message?: string } }; error?: { code?: number } };
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001 || e?.info?.error?.code === 4001 || e?.error?.code === 4001) {
    return "You rejected the request in your wallet. Nothing was signed or sent.";
  }
  if (e?.code === "INSUFFICIENT_FUNDS") return "This account has no local test ETH for gas. Use a funded Hardhat dev account (see README).";
  if (typeof e?.data === "string" && e.data.startsWith("0x")) {
    for (const iface of [registryIface, gateIface]) {
      try {
        const parsed = iface.parseError(e.data);
        if (parsed) {
          if (parsed.name === "AccessDenied") {
            const status = STATUS[Number(parsed.args[0])] ?? "unknown";
            return parsed.args[1]
              ? "Access denied: this credential belongs to another wallet or another schema."
              : `Access denied by the gate: registry status is ${status}.`;
          }
          return CONTRACT_MESSAGES[parsed.name] ?? `Contract rejected the transaction: ${parsed.name}.`;
        }
      } catch {
        // not this interface
      }
    }
  }
  if (e?.code === "NETWORK_ERROR" || e?.code === "SERVER_ERROR" || e?.code === "TIMEOUT") {
    return "The local chain RPC is unreachable. Is `npm run chain` running?";
  }
  if (e?.code === "CALL_EXCEPTION") return `Transaction would revert: ${e.shortMessage ?? "unknown reason"}.`;
  return e?.shortMessage ?? e?.message ?? "Unexpected error.";
}
