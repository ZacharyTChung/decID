import { createBlock, type Block } from "@ethereumjs/block";
import { Hardfork, Mainnet, createCustomCommon, type Common } from "@ethereumjs/common";
import { createTxFromRLP, type TypedTransaction } from "@ethereumjs/tx";
import { bytesToHex, createAddressFromString, createZeroAddress, hexToBytes, type PrefixedHexString } from "@ethereumjs/util";
import { createVM, runTx, type VM } from "@ethereumjs/vm";

/**
 * A minimal Ethereum node that runs in the page: the EIP-1193 `request()` interface over an
 * ethereumjs VM (Cancun, the EVM version the contracts are compiled for), with automine (one
 * block per transaction, like `hardhat node`) and zero gas fees so test accounts need no funds.
 *
 * It implements the JSON-RPC methods ethers v6 uses for deploying, sending, calling and
 * reading receipts, plus `evm_increaseTime` / `evm_mine` for the expiry demo. Read calls
 * honour a block tag by restoring that block's state root. Requests are processed one at a
 * time, as a node's state machine would.
 */

const CHAIN_ID = 31337n;
const GAS_LIMIT = 30_000_000n;
const ZERO32 = ("0x" + "00".repeat(32)) as PrefixedHexString;

type Json = Record<string, unknown>;
interface StoredTx {
  tx: TypedTransaction;
  blockNumber: number;
  receipt: Json;
}
export interface RpcError extends Error {
  code: number;
  data?: string;
}

const hex = (n: bigint | number) => "0x" + BigInt(n).toString(16);
function rpcError(code: number, message: string, data?: string): RpcError {
  return Object.assign(new Error(message), { code, data });
}

export class InPageChain {
  readonly common: Common;
  private blocks: Block[] = [];
  private roots: Uint8Array[] = [];
  private txs = new Map<string, StoredTx>();
  private queue: Promise<unknown> = Promise.resolve();
  private timeOffset = 0;
  /** Every JSON-RPC call, for the playground's "what the verifier asked the chain" view. */
  onRequest?: (method: string) => void;

  private constructor(
    private readonly vm: VM,
    common: Common,
  ) {
    this.common = common;
  }

  static async create(): Promise<InPageChain> {
    const common = createCustomCommon({ chainId: Number(CHAIN_ID) }, Mainnet, { hardfork: Hardfork.Cancun });
    const vm = await createVM({ common });
    const chain = new InPageChain(vm, common);
    const genesis = chain.makeBlock(0n, BigInt(chain.wallClock()), new Uint8Array(32));
    chain.blocks.push(genesis);
    chain.roots.push(await vm.stateManager.getStateRoot());
    return chain;
  }

  /** Seconds since the epoch, shifted by evm_increaseTime. */
  wallClock(): number {
    return Math.floor(Date.now() / 1000) + this.timeOffset;
  }

  latestTimestamp(): number {
    return Number(this.latest().header.timestamp);
  }

  private latest(): Block {
    return this.blocks[this.blocks.length - 1]!;
  }

  private makeBlock(number: bigint, timestamp: bigint, parentHash: Uint8Array, transactions: TypedTransaction[] = []): Block {
    return createBlock(
      {
        header: { number, timestamp, parentHash, gasLimit: GAS_LIMIT, baseFeePerGas: 0n, coinbase: createAddressFromString("0x" + "00".repeat(19) + "01") },
        transactions,
      },
      { common: this.common },
    );
  }

  private nextBlock(transactions: TypedTransaction[]): Block {
    const parent = this.latest();
    const ts = BigInt(Math.max(Number(parent.header.timestamp) + 1, this.wallClock()));
    return this.makeBlock(parent.header.number + 1n, ts, parent.hash(), transactions);
  }

  private blockNumberOf(tag: unknown): number {
    if (tag === undefined || tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized") return this.blocks.length - 1;
    if (tag === "earliest") return 0;
    const n = Number(BigInt(tag as string));
    if (n < 0 || n >= this.blocks.length) throw rpcError(-32000, `header not found for block ${String(tag)}`);
    return n;
  }

  /** Runs a read against a block's state without changing anything. */
  private async withStateAt<T>(blockNumber: number, fn: (vm: VM) => Promise<T>): Promise<T> {
    if (blockNumber === this.blocks.length - 1) {
      await this.vm.stateManager.checkpoint();
      try {
        return await fn(this.vm);
      } finally {
        await this.vm.stateManager.revert();
      }
    }
    const copy = await this.vm.shallowCopy();
    await copy.stateManager.setStateRoot(this.roots[blockNumber]!);
    return fn(copy);
  }

  private async call(params: Json, blockNumber: number) {
    return this.withStateAt(blockNumber, async (vm) => {
      const res = await vm.evm.runCall({
        caller: params.from ? createAddressFromString(params.from as string) : createZeroAddress(),
        to: params.to ? createAddressFromString(params.to as string) : undefined,
        data: params.data || params.input ? hexToBytes((params.data ?? params.input) as PrefixedHexString) : new Uint8Array(),
        value: params.value ? BigInt(params.value as string) : 0n,
        gasLimit: GAS_LIMIT,
        skipBalance: true,
        block: this.blocks[blockNumber],
      });
      return res.execResult;
    });
  }

  private async mine(tx?: TypedTransaction): Promise<void> {
    const block = this.nextBlock(tx ? [tx] : []);
    let receipt: Json | undefined;
    if (tx) {
      const result = await runTx(this.vm, { tx, block, skipBalance: true, skipBlockGasLimitValidation: true });
      const txHash = bytesToHex(tx.hash());
      const blockHash = bytesToHex(block.hash());
      const blockNumber = hex(block.header.number);
      receipt = {
        transactionHash: txHash,
        transactionIndex: "0x0",
        blockHash,
        blockNumber,
        from: tx.getSenderAddress().toString(),
        to: tx.to?.toString() ?? null,
        contractAddress: result.createdAddress?.toString() ?? null,
        cumulativeGasUsed: hex(result.totalGasSpent),
        gasUsed: hex(result.totalGasSpent),
        effectiveGasPrice: "0x0",
        logsBloom: bytesToHex(result.bloom.bitvector),
        status: result.execResult.exceptionError ? "0x0" : "0x1",
        type: hex(tx.type),
        logs: result.receipt.logs.map(([address, topics, data], i) => ({
          address: bytesToHex(address),
          topics: topics.map((t) => bytesToHex(t)),
          data: bytesToHex(data),
          blockHash,
          blockNumber,
          transactionHash: txHash,
          transactionIndex: "0x0",
          logIndex: hex(i),
          removed: false,
        })),
      };
      this.txs.set(txHash, { tx, blockNumber: Number(block.header.number), receipt });
    }
    this.blocks.push(block);
    this.roots.push(await this.vm.stateManager.getStateRoot());
  }

  private blockJson(b: Block): Json {
    const h = b.header;
    return {
      number: hex(h.number),
      hash: bytesToHex(b.hash()),
      parentHash: bytesToHex(h.parentHash),
      timestamp: hex(h.timestamp),
      nonce: "0x0000000000000000",
      difficulty: "0x0",
      gasLimit: hex(h.gasLimit),
      gasUsed: hex(h.gasUsed),
      baseFeePerGas: hex(h.baseFeePerGas ?? 0n),
      miner: h.coinbase.toString(),
      extraData: "0x",
      stateRoot: bytesToHex(h.stateRoot),
      receiptsRoot: bytesToHex(h.receiptTrie),
      transactions: b.transactions.map((t) => bytesToHex(t.hash())),
    };
  }

  private txJson(hash: string): Json | null {
    const s = this.txs.get(hash);
    if (!s) return null;
    const j = s.tx.toJSON() as Json;
    return {
      ...j,
      hash,
      from: s.tx.getSenderAddress().toString(),
      gas: j.gasLimit,
      input: j.data,
      blockNumber: hex(s.blockNumber),
      blockHash: s.receipt.blockHash,
      transactionIndex: "0x0",
    };
  }

  /** Logs from stored receipts, filtered like a node does: address, block range and topics (null = any). */
  private getLogs(f: { address?: string | string[]; topics?: (string | string[] | null)[]; fromBlock?: string; toBlock?: string }): Json[] {
    const n = (b: string | undefined, d: number) => (b === undefined || b === "latest" || b === "pending" ? d : b === "earliest" ? 0 : Number(b));
    const from = n(f.fromBlock, 0);
    const to = n(f.toBlock, Number.MAX_SAFE_INTEGER);
    const addrs = f.address === undefined ? null : (Array.isArray(f.address) ? f.address : [f.address]).map((a) => a.toLowerCase());
    const out: Json[] = [];
    for (const { blockNumber, receipt } of this.txs.values()) {
      if (!receipt || blockNumber < from || blockNumber > to) continue;
      for (const log of (receipt as unknown as { logs: { address: string; topics: string[] }[] }).logs) {
        if (addrs && !addrs.includes(log.address.toLowerCase())) continue;
        const topicsMatch = (f.topics ?? []).every((want, i) => want === null || want === undefined || (Array.isArray(want) ? want.map((w) => w.toLowerCase()) : [want.toLowerCase()]).includes((log.topics[i] ?? "").toLowerCase()));
        if (topicsMatch) out.push(log as unknown as Json);
      }
    }
    return out;
  }

  request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    const run = this.queue.then(async () => {
      try {
        return await this.handle(args.method, args.params ?? []);
      } catch (e) {
        // A bug here must not look like a contract revert to the caller.
        if (typeof (e as RpcError).code === "number") throw e;
        throw rpcError(-32603, `in-page chain internal error: ${(e as Error).message}`);
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async handle(method: string, params: unknown[]): Promise<unknown> {
    this.onRequest?.(method);
    switch (method) {
      case "eth_chainId":
        return hex(CHAIN_ID);
      case "net_version":
        return CHAIN_ID.toString();
      case "eth_accounts":
      case "eth_requestAccounts":
        return [];
      case "eth_blockNumber":
        return hex(this.blocks.length - 1);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return "0x0";
      case "eth_getBlockByNumber": {
        const n = this.blockNumberOf(params[0]);
        return this.blockJson(this.blocks[n]!);
      }
      case "eth_getBalance":
        return hex((await this.vm.stateManager.getAccount(createAddressFromString(params[0] as string)))?.balance ?? 0n);
      case "eth_getTransactionCount":
        return this.withStateAt(this.blockNumberOf(params[1]), async (vm) => hex((await vm.stateManager.getAccount(createAddressFromString(params[0] as string)))?.nonce ?? 0n));
      case "eth_getCode":
        return this.withStateAt(this.blockNumberOf(params[1]), async (vm) => bytesToHex(await vm.stateManager.getCode(createAddressFromString(params[0] as string))));
      case "eth_call":
      case "eth_estimateGas": {
        const exec = await this.call(params[0] as Json, this.blockNumberOf(params[1]));
        if (exec.exceptionError) {
          const data = bytesToHex(exec.returnValue);
          throw rpcError(3, `execution reverted${exec.exceptionError.error !== "revert" ? ` (${exec.exceptionError.error})` : ""}`, data);
        }
        if (method === "eth_call") return bytesToHex(exec.returnValue);
        // Gas is free here, so over-estimating is harmless (receipts report actual gas used). The
        // execution figure excludes intrinsic and calldata gas, so add a generous allowance.
        const dataLen = BigInt(((((params[0] as Json).data ?? (params[0] as Json).input) as string | undefined)?.length ?? 2) / 2);
        const estimate = exec.executionGasUsed * 2n + 200_000n + 16n * dataLen;
        return hex(estimate > GAS_LIMIT ? GAS_LIMIT : estimate);
      }
      case "eth_sendRawTransaction": {
        const tx = createTxFromRLP(hexToBytes(params[0] as PrefixedHexString), { common: this.common });
        if (!tx.isSigned() || !tx.verifySignature()) throw rpcError(-32000, "invalid signature");
        await this.mine(tx);
        return bytesToHex(tx.hash());
      }
      case "eth_getTransactionReceipt":
        return this.txs.get(params[0] as string)?.receipt ?? null;
      case "eth_getTransactionByHash":
        return this.txJson(params[0] as string);
      case "eth_getLogs":
        return this.getLogs(params[0] as { address?: string | string[]; topics?: (string | string[] | null)[]; fromBlock?: string; toBlock?: string });
      case "evm_increaseTime":
        this.timeOffset += Number(params[0]);
        return hex(this.timeOffset);
      case "evm_mine":
        await this.mine();
        return "0x0";
      default:
        throw rpcError(-32601, `method ${method} is not supported by the in-page chain`);
    }
  }
}

export { ZERO32 };
