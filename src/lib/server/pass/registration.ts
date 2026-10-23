import "server-only";
import { Interface, Transaction, Wallet, getAddress } from "ethers";
import { CREDENTIAL_REGISTRY_ABI } from "../../../generated/contracts";
import { sponsorPrivateKey } from "../config";
import { loadDeployment, onChain, provider } from "../chain";
import { db } from "../db";
import { ApiError } from "../errors";
import type { Session } from "../auth/session";

/**
 * Gas-sponsored registration for decID Pass. The holder's device wallet signs the
 * `register(authorization, signature)` transaction itself, so `msg.sender` is the holder, as
 * the registry requires. decID tops up exactly the gas it needs and relays it. Consumers never
 * hold cryptocurrency.
 *
 * The relay is not a general faucet: it accepts only a call to the registry's `register`,
 * signed by the signed-in holder, for a commitment this issuer issued to that holder, with
 * bounded gas and no value. Local chain only: production would use an ERC-4337 paymaster.
 */

const GAS_LIMIT = 300_000n;
const registryIface = new Interface(CREDENTIAL_REGISTRY_ABI);

function sponsor(): Wallet {
  const key = sponsorPrivateKey();
  if (!key) throw new ApiError(503, "SPONSOR_DISABLED", "gas sponsoring is not configured: run `npm run setup`");
  return new Wallet(key, provider());
}

/** What the wallet needs to build the transaction. */
export async function registrationParams(session: Session) {
  const d = loadDeployment();
  if (d.chainId !== 31337) throw new ApiError(409, "SPONSOR_LOCAL_ONLY", "gas sponsoring runs only on the local test chain");
  const p = provider();
  const [nonce, fee] = await onChain(() => Promise.all([p.getTransactionCount(session.address, "pending"), p.getFeeData()]));
  const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice ?? 1_000_000_000n;
  return {
    chainId: d.chainId,
    to: d.registry,
    nonce,
    gasLimit: GAS_LIMIT.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: (fee.maxPriorityFeePerGas ?? 0n).toString(),
  };
}

export async function relayRegistration(session: Session, rawTx: string) {
  const d = loadDeployment();
  if (d.chainId !== 31337) throw new ApiError(409, "SPONSOR_LOCAL_ONLY", "gas sponsoring runs only on the local test chain");
  let tx: Transaction;
  try {
    tx = Transaction.from(rawTx);
  } catch {
    throw new ApiError(400, "BAD_TRANSACTION", "not a signed transaction");
  }
  const bad = (why: string) => new ApiError(400, "TRANSACTION_NOT_ALLOWED", why);
  if (!tx.from || getAddress(tx.from) !== getAddress(session.address)) throw bad("the transaction must be signed by your own wallet");
  if (!tx.to || getAddress(tx.to) !== getAddress(d.registry)) throw bad("only registrations with the credential registry are sponsored");
  if (tx.chainId !== BigInt(d.chainId)) throw bad("wrong chain");
  if (tx.value !== 0n) throw bad("the transaction must not transfer value");
  if (tx.gasLimit > GAS_LIMIT) throw bad("gas limit too high");
  const call = (() => {
    try {
      return registryIface.parseTransaction({ data: tx.data });
    } catch {
      return null;
    }
  })();
  if (!call || call.name !== "register") throw bad("only register(...) is sponsored");
  const auth = call.args[0] as { commitment: string; holder: string };
  if (getAddress(auth.holder) !== getAddress(session.address)) throw bad("the credential must be issued to your wallet");
  const issued = db().prepare("SELECT 1 FROM issuer_credentials WHERE commitment = ? AND holder_address = ?").get(auth.commitment, getAddress(session.address));
  if (!issued) throw bad("this issuer did not issue that credential to you");

  const p = provider();
  const maxCost = tx.gasLimit * (tx.maxFeePerGas ?? tx.gasPrice ?? 0n);
  const balance = await onChain(() => p.getBalance(session.address));
  let sponsoredWei = 0n;
  if (balance < maxCost) {
    sponsoredWei = maxCost - balance;
    await onChain(async () => (await sponsor().sendTransaction({ to: session.address, value: sponsoredWei })).wait());
  }
  const sent = await onChain(() => p.broadcastTransaction(rawTx));
  const receipt = await onChain(() => sent.wait());
  return { txHash: sent.hash, status: receipt?.status === 1 ? "registered" : "reverted", gasUsed: (receipt?.gasUsed ?? 0n).toString(), sponsoredWei: sponsoredWei.toString() };
}
