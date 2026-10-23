import { BrowserProvider, Contract, ContractFactory, Wallet, hexlify, randomBytes, type HDNodeWallet, type InterfaceAbi } from "ethers";
import { exportJWK, generateKeyPair } from "jose";
import registryArtifact from "../../artifacts/contracts/CredentialRegistry.sol/CredentialRegistry.json";
import gateArtifact from "../../artifacts/contracts/DemoGate.sol/DemoGate.json";
import { ACTION_POLICIES, CREDENTIAL_TYPE, SCHEMA_ID, type VerifierAction } from "../../src/lib/shared/constants";
import { presentationStatement, PRESENTATION_TYPES, presentationDomain } from "../../src/lib/shared/eip712";
import { preparePresentation } from "../../src/lib/shared/presentation";
import type { HolderBundle } from "../../src/lib/shared/bundle";
import type { VerificationResult } from "../../src/lib/shared/verification";
import type { ChallengeResponse, PresentationSubmissionT } from "../../src/lib/shared/api";
import { deriveDidKeyFromJwk } from "../../src/lib/server/did/did-key";
import { issueCredential } from "../../src/lib/server/issuer/issue";
import { finalize, verifyPresentationCore } from "../../src/lib/server/verifier/core";
import type { Deployment } from "../../src/lib/server/chain";
import type { TrustedIssuerT } from "../../src/lib/server/trust-schema";
import { InPageChain } from "./in-page-chain";

/**
 * The playground's world: one in-page chain with the real CredentialRegistry and DemoGate
 * bytecode, one simulated issuer with freshly generated keys, and the real issuance,
 * presentation and verification code from src/. What is NOT the production code: the chain
 * (an in-page EVM instead of a node), and the verifier's challenge store (a Map with the same
 * single-use and expiry rules as the SQLite table). Synthetic data only; keys live in memory.
 */

export const CHALLENGE_TTL = 120;
const AUDIENCE = "urn:did-mvp:playground-verifier";

export interface Holder {
  label: string;
  wallet: HDNodeWallet;
  bundle?: HolderBundle;
}

export interface TxInfo {
  hash: string;
  gasUsed: bigint;
  block: number;
  ok: boolean;
  revert?: string;
}

interface Challenge extends ChallengeResponse {
  consumed: boolean;
}

export class World {
  rpcLog: string[] = [];
  private challenges = new Map<string, Challenge>();

  private constructor(
    readonly chain: InPageChain,
    readonly provider: BrowserProvider,
    readonly deployer: Wallet | HDNodeWallet,
    readonly issuer: { did: string; kid: string; privateJwk: { kty: "OKP"; crv: "Ed25519"; x: string; d: string }; attestation: HDNodeWallet },
    readonly registry: Contract,
    readonly gate: Contract,
    readonly deployment: Deployment,
    readonly issuers: TrustedIssuerT[],
  ) {}

  static async create(): Promise<World> {
    const chain = await InPageChain.create();
    const provider = new BrowserProvider(chain, { chainId: 31337, name: "in-page" }, { cacheTimeout: -1, pollingInterval: 50 });
    const deployer = Wallet.createRandom(provider);

    // Issuer keys: Ed25519 credential key (did:key) and a separate EVM attestation key.
    const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
    const jwk = await exportJWK(privateKey);
    const privateJwk = { kty: "OKP" as const, crv: "Ed25519" as const, x: jwk.x!, d: jwk.d! };
    const { did, kid } = await deriveDidKeyFromJwk({ kty: "OKP", crv: "Ed25519", x: jwk.x! });
    const attestation = Wallet.createRandom(provider);

    // Same deployment as `npm run deploy`: registry (admin + random deploymentId), gate, addIssuer.
    const deploymentId = hexlify(randomBytes(32));
    const registry = (await new ContractFactory(registryArtifact.abi as InterfaceAbi, registryArtifact.bytecode, deployer).deploy(deployer.address, deploymentId)) as Contract;
    await registry.waitForDeployment();
    const gate = (await new ContractFactory(gateArtifact.abi as InterfaceAbi, gateArtifact.bytecode, deployer).deploy(await registry.getAddress(), SCHEMA_ID)) as Contract;
    await gate.waitForDeployment();
    await (await registry.getFunction("addIssuer")(attestation.address)).wait();

    const now = chain.latestTimestamp();
    const deployment: Deployment = {
      chainId: 31337,
      registry: await registry.getAddress(),
      gate: await gate.getAddress(),
      deploymentId,
      admin: deployer.address,
      issuerSigner: attestation.address,
      schemaId: SCHEMA_ID,
      deployedAtBlock: await provider.getBlockNumber(),
      deployedAt: new Date(now * 1000).toISOString(),
    };
    const issuers: TrustedIssuerT[] = [
      {
        id: "playground-issuer",
        name: "Simulated Identity Office (in-page playground)",
        credentialKeys: [{ did, kid, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x! }, status: "active", activatedAt: now - 60 }],
        evmAttestationSigners: [{ address: attestation.address, status: "active", activatedAt: now - 60 }],
        credentialTypes: [CREDENTIAL_TYPE],
        schemaIds: [SCHEMA_ID],
      },
    ];
    const world = new World(chain, provider, deployer, { did, kid, privateJwk, attestation }, registry, gate, deployment, issuers);
    chain.onRequest = (m) => world.rpcLog.push(m);
    return world;
  }

  newHolder(label: string): Holder {
    return { label, wallet: Wallet.createRandom(this.provider) };
  }

  now(): number {
    return this.chain.wallClock();
  }

  /** Issuer approves a synthetic application: the exact function the server's approveRequest calls. */
  async issue(holder: Holder, application: { dateOfBirth: string; country: string }): Promise<HolderBundle> {
    const [, epoch] = (await this.registry.getFunction("issuerState")(this.issuer.attestation.address)) as [boolean, bigint];
    const { bundle } = await issueCredential({
      keys: { did: this.issuer.did, kid: this.issuer.kid, credentialPrivateJwk: this.issuer.privateJwk, attestationSigner: this.issuer.attestation },
      holderAddress: holder.wallet.address,
      application,
      deployment: this.deployment,
      issuerEpoch: Number(epoch),
      now: this.now(), // the issuer's clock, as on the server (not the chain's block time)
      lifetimeSeconds: 365 * 24 * 60 * 60,
      credentialId: `urn:uuid:${crypto.randomUUID()}`,
    });
    holder.bundle = bundle;
    return bundle;
  }

  private async send(fn: () => Promise<{ wait(): Promise<unknown> }>, staticCheck: () => Promise<unknown>): Promise<TxInfo> {
    try {
      await staticCheck();
    } catch (e) {
      return { hash: "", gasUsed: 0n, block: 0, ok: false, revert: this.revertName(e) };
    }
    const tx = await fn();
    const receipt = (await tx.wait()) as { hash: string; gasUsed: bigint; blockNumber: number; status: number };
    return { hash: receipt.hash, gasUsed: receipt.gasUsed, block: receipt.blockNumber, ok: receipt.status === 1 };
  }

  revertName(e: unknown): string {
    const data = (e as { data?: string; info?: { error?: { data?: string } } }).data ?? (e as { info?: { error?: { data?: string } } }).info?.error?.data;
    for (const c of [this.registry, this.gate]) {
      try {
        const parsed = data ? c.interface.parseError(data) : null;
        if (parsed) return `${parsed.name}(${parsed.args.map(String).join(", ")})`;
      } catch {
        // not this contract's error
      }
    }
    return "reverted";
  }

  async register(holder: Holder, as: Holder = holder, bundle: HolderBundle = holder.bundle!): Promise<TxInfo> {
    const r = this.registry.connect(as.wallet) as Contract;
    return this.send(
      () => r.getFunction("register")(bundle.authorization, bundle.authorizationSignature),
      () => r.getFunction("register").staticCall(bundle.authorization, bundle.authorizationSignature),
    );
  }

  async checkIn(as: Holder, commitment: string): Promise<TxInfo> {
    const g = this.gate.connect(as.wallet) as Contract;
    return this.send(
      () => g.getFunction("checkIn")(commitment),
      () => g.getFunction("checkIn").staticCall(commitment),
    );
  }

  async revoke(bundle: HolderBundle): Promise<TxInfo> {
    const r = this.registry.connect(this.issuer.attestation) as Contract;
    return this.send(
      () => r.getFunction("revoke")(bundle.commitment),
      () => r.getFunction("revoke").staticCall(bundle.commitment),
    );
  }

  async status(commitment: string): Promise<string> {
    const s = Number(await this.registry.getFunction("credentialStatus")(commitment));
    return ["None", "Active", "Revoked", "IssuerInactive", "NotYetValid", "Expired"][s] ?? "Unknown";
  }

  /** Verifier: a fresh single-use challenge, like POST /api/verifier/challenges. */
  createChallenge(action: VerifierAction): ChallengeResponse {
    const now = this.now();
    const c: Challenge = {
      challengeId: crypto.randomUUID(),
      nonce: hexlify(randomBytes(32)),
      action,
      audience: AUDIENCE,
      chainId: this.deployment.chainId,
      registry: this.deployment.registry,
      expiresAt: now + CHALLENGE_TTL,
      requestedClaims: [...ACTION_POLICIES[action].requested],
      statement: presentationStatement(AUDIENCE, action, ACTION_POLICIES[action].requested),
      consumed: false,
    };
    this.challenges.set(c.challengeId, c);
    const { consumed: _c, ...pub } = c;
    return pub;
  }

  /** Holder: the real holder-side code builds disclosures and the EIP-712 message; the wallet signs. */
  async present(holder: Holder, challenge: ChallengeResponse, bundle: HolderBundle = holder.bundle!): Promise<PresentationSubmissionT> {
    const { disclosures, message } = preparePresentation(bundle, challenge, holder.wallet.address);
    const signature = await holder.wallet.signTypedData(presentationDomain(challenge.chainId, challenge.registry), PRESENTATION_TYPES, message);
    return {
      challengeId: challenge.challengeId,
      credentialJwt: bundle.credentialJwt,
      disclosures,
      salt: bundle.salt,
      proof: { holder: holder.wallet.address, commitment: bundle.commitment, expiresAt: challenge.expiresAt, signature },
    };
  }

  /** Verifier: consume the challenge once, then the production verifier core (src/lib/server/verifier/core.ts). */
  async verify(sub: PresentationSubmissionT): Promise<VerificationResult & { rpcCalls: string[] }> {
    const start = this.rpcLog.length;
    const c = this.challenges.get(sub.challengeId);
    const now = this.now();
    const challengeFail = (code: string, detail: string) => ({ ...finalize([{ id: "challenge", status: "fail", code, detail }]), rpcCalls: [] });
    if (!c) return challengeFail("CHALLENGE_UNKNOWN", "unknown challenge");
    if (c.consumed) return challengeFail("CHALLENGE_REUSED", "challenge was already used");
    if (c.expiresAt <= now) return challengeFail("CHALLENGE_EXPIRED", "challenge expired");
    c.consumed = true;
    const core = await verifyPresentationCore(
      { nonce: c.nonce, action: c.action, audience: c.audience, chainId: c.chainId, registry: c.registry, expiresAt: c.expiresAt },
      sub,
      { deployment: this.deployment, issuers: this.issuers, now, provider: this.provider },
    );
    const result = finalize([{ id: "challenge", status: "pass" }, ...core.checks], { registryStatus: core.registryStatus, disclosed: core.disclosed });
    return { ...result, rpcCalls: this.rpcLog.slice(start) };
  }

  async travel(seconds: number): Promise<void> {
    await this.chain.request({ method: "evm_increaseTime", params: [seconds] });
    await this.chain.request({ method: "evm_mine", params: [] });
  }
}
