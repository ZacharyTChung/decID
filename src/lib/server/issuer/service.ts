import "server-only";
import { randomUUID } from "node:crypto";
import { Contract, Wallet, getAddress } from "ethers";
import { CREDENTIAL_REGISTRY_ABI } from "../../../generated/contracts";
import { HOLDER_BUNDLE_VERSION, SCHEMA_ID } from "../../shared/constants";
import { commitmentFor, randomSalt } from "../../shared/commitment";
import { buildIdentityCredential } from "../../shared/credential-profile";
import { deriveHolderDid } from "../../shared/did-pkh";
import { registryDomain, REGISTRATION_TYPES, type RegistrationAuthorization } from "../../shared/eip712";
import { HolderBundleV1, type HolderBundle } from "../../shared/bundle";
import type { HolderRequestView, SyntheticApplicationT } from "../../shared/api";
import { credentialLifetimeSeconds, issuerSecrets } from "../config";
import { loadDeployment, provider, readRecord } from "../chain";
import { db, nowSeconds } from "../db";
import { ApiError } from "../http";
import { signCredentialJwt } from "../credential/sign";
import { deriveDidKeyFromJwk } from "../did/did-key";
import type { Session } from "../auth/session";

/**
 * Simulated identity office. This is the only module that loads issuer private
 * keys (issuerSecrets). It holds two separate keys:
 *   - an Ed25519 credential key (did:key) that signs the VC as vc+jwt;
 *   - a secp256k1 EVM attestation key, authorized in CredentialRegistry, that
 *     signs EIP-712 registration authorizations and sends revocations.
 * The binding between them is published in the trusted issuer policy.
 */

const REGISTRATION_WINDOW = 24 * 60 * 60; // authorization must be submitted within 24 h
const BUNDLE_PICKUP_TTL = 24 * 60 * 60;

async function issuerKeys() {
  const secrets = issuerSecrets();
  const { d: _d, ...publicJwk } = secrets.credentialPrivateJwk;
  const { did, kid } = await deriveDidKeyFromJwk(publicJwk);
  const evmWallet = new Wallet(secrets.evmPrivateKey, provider());
  return { secrets, did, kid, evmWallet };
}

// ---------------------------------------------------------------- holder side

export function submitRequest(session: Session, application: SyntheticApplicationT): { id: string } {
  const d = db();
  const pending = d
    .prepare("SELECT 1 FROM issuer_requests WHERE holder_address = ? AND status = 'pending'")
    .get(session.address);
  if (pending) throw new ApiError(409, "REQUEST_PENDING", "you already have a pending request");
  const id = randomUUID();
  d.prepare(
    `INSERT INTO issuer_requests (id, holder_address, holder_did, chain_id, status, synthetic_json, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(id, session.address, deriveHolderDid(session.chainId, session.address), session.chainId, JSON.stringify(application), nowSeconds());
  return { id };
}

export function listHolderRequests(session: Session): HolderRequestView[] {
  const rows = db()
    .prepare(
      `SELECT r.id, r.status, r.created_at, r.reviewed_at, r.reject_reason,
              EXISTS(SELECT 1 FROM issuer_bundle_pickup b WHERE b.request_id = r.id AND b.expires_at > ?) AS bundle
       FROM issuer_requests r WHERE r.holder_address = ? ORDER BY r.created_at DESC`,
    )
    .all(nowSeconds(), session.address) as {
    id: string;
    status: HolderRequestView["status"];
    created_at: number;
    reviewed_at: number | null;
    reject_reason: string | null;
    bundle: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    rejectReason: r.reject_reason,
    bundleAvailable: r.bundle === 1,
  }));
}

/** One-time pickup: the bundle is deleted from the server in the same statement that returns it. */
export function pickupBundle(session: Session, requestId: string): HolderBundle {
  const row = db()
    .prepare(
      "DELETE FROM issuer_bundle_pickup WHERE request_id = ? AND holder_address = ? AND expires_at > ? RETURNING bundle_json",
    )
    .get(requestId, session.address, nowSeconds()) as { bundle_json: string } | undefined;
  // The same error for "not yours" and "does not exist" avoids leaking other holders' request ids.
  if (!row) throw new ApiError(404, "BUNDLE_NOT_AVAILABLE", "no bundle awaiting pickup for this request");
  return HolderBundleV1.parse(JSON.parse(row.bundle_json));
}

// ---------------------------------------------------------------- issuer side

export interface PendingRequestView {
  id: string;
  holderDid: string;
  createdAt: number;
  application: SyntheticApplicationT;
}

export function listPendingRequests(_issuer: Session): PendingRequestView[] {
  const rows = db()
    .prepare("SELECT id, holder_did, created_at, synthetic_json FROM issuer_requests WHERE status = 'pending' ORDER BY created_at")
    .all() as { id: string; holder_did: string; created_at: number; synthetic_json: string }[];
  return rows.map((r) => ({
    id: r.id,
    holderDid: r.holder_did,
    createdAt: r.created_at,
    application: JSON.parse(r.synthetic_json),
  }));
}

export function rejectRequest(issuer: Session, requestId: string, reason: string): void {
  const res = db()
    .prepare(
      `UPDATE issuer_requests SET status = 'rejected', reject_reason = ?, synthetic_json = NULL,
         reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status = 'pending'`,
    )
    .run(reason, nowSeconds(), issuer.address, requestId);
  if (res.changes !== 1) throw new ApiError(409, "NOT_PENDING", "request is not pending");
}

export interface IssuanceResult {
  requestId: string;
  commitment: string;
  credentialId: string;
}

export async function approveRequest(issuer: Session, requestId: string): Promise<IssuanceResult> {
  const d = db();
  const now = nowSeconds();
  // Claim the request atomically so two concurrent approvals cannot both issue.
  const claimed = d
    .prepare(
      `UPDATE issuer_requests SET status = 'approved', reviewed_at = ?, reviewed_by = ?
       WHERE id = ? AND status = 'pending' RETURNING holder_address, chain_id`,
    )
    .get(now, issuer.address, requestId) as { holder_address: string; chain_id: number } | undefined;
  if (!claimed) throw new ApiError(409, "NOT_PENDING", "request is not pending");

  try {
    const deployment = loadDeployment();
    if (claimed.chain_id !== deployment.chainId) throw new ApiError(409, "WRONG_CHAIN", "request was made on another chain");
    const keys = await issuerKeys();
    const issuerAddress = getAddress(keys.evmWallet.address);
    const registry = new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, provider());
    const [active, epoch] = (await registry.getFunction("issuerState")(issuerAddress)) as [boolean, bigint];
    if (!active) throw new ApiError(409, "ISSUER_NOT_ACTIVE_ON_CHAIN", "issuer attestation key is not authorized in the registry");

    const holderAddress = getAddress(claimed.holder_address);
    const holderDid = deriveHolderDid(deployment.chainId, holderAddress);
    const credentialId = `urn:uuid:${randomUUID()}`;
    const validFrom = now;
    const validUntil = now + credentialLifetimeSeconds();

    // 1. Minimal VC, signed with the credential key.
    const vc = buildIdentityCredential({
      credentialId,
      issuerDid: keys.did,
      holderDid,
      validFrom,
      validUntil,
      chainId: deployment.chainId,
      registry: deployment.registry,
    });
    const credentialJwt = await signCredentialJwt(vc, keys.secrets.credentialPrivateJwk, keys.kid);

    // 2. Commitment over the exact token bytes with a fresh 32-byte salt.
    const salt = randomSalt();
    const commitment = commitmentFor(credentialJwt, salt);

    // 3. EIP-712 registration authorization, signed with the separate EVM attestation key.
    const authorization: RegistrationAuthorization = {
      commitment,
      holder: holderAddress,
      issuer: issuerAddress,
      schemaId: SCHEMA_ID,
      validFrom,
      expiresAt: validUntil,
      issuerEpoch: Number(epoch),
      deadline: Math.min(now + REGISTRATION_WINDOW, validUntil - 1),
    };
    const authorizationSignature = await keys.evmWallet.signTypedData(
      registryDomain(deployment.chainId, deployment.registry),
      REGISTRATION_TYPES,
      authorization,
    );

    const bundle: HolderBundle = HolderBundleV1.parse({
      version: HOLDER_BUNDLE_VERSION,
      credentialJwt,
      salt,
      commitment,
      authorization,
      authorizationSignature,
      deployment: { chainId: deployment.chainId, registry: deployment.registry },
      issuedAt: new Date(now * 1000).toISOString(),
    });

    // 4. Persist the issuance log (public values only), erase the synthetic application,
    //    and stage the private bundle for one-time pickup by the holder.
    d.transaction(() => {
      d.prepare(
        `INSERT INTO issuer_credentials (commitment, request_id, credential_id, holder_address, holder_did, valid_from, expires_at, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(commitment, requestId, credentialId, holderAddress, holderDid, validFrom, validUntil, now);
      d.prepare("UPDATE issuer_requests SET synthetic_json = NULL WHERE id = ?").run(requestId);
      d.prepare(
        "INSERT INTO issuer_bundle_pickup (request_id, holder_address, bundle_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      ).run(requestId, holderAddress, JSON.stringify(bundle), now, now + BUNDLE_PICKUP_TTL);
    })();

    return { requestId, commitment, credentialId };
  } catch (err) {
    // Roll the claim back so the request can be retried.
    d.prepare("UPDATE issuer_requests SET status = 'pending', reviewed_at = NULL, reviewed_by = NULL WHERE id = ? AND status = 'approved'").run(requestId);
    throw err;
  }
}

export interface IssuedCredentialView {
  commitment: string;
  credentialId: string;
  holderDid: string;
  validFrom: number;
  expiresAt: number;
  issuedAt: number;
  revokedAt: number | null;
  revokeTx: string | null;
  onChainStatus: string;
}

export async function listIssuedCredentials(_issuer: Session): Promise<IssuedCredentialView[]> {
  const rows = db()
    .prepare("SELECT * FROM issuer_credentials ORDER BY issued_at DESC LIMIT 100")
    .all() as {
    commitment: string;
    credential_id: string;
    holder_did: string;
    valid_from: number;
    expires_at: number;
    issued_at: number;
    revoked_at: number | null;
    revoke_tx: string | null;
  }[];
  const deployment = loadDeployment();
  return Promise.all(
    rows.map(async (r) => {
      let onChainStatus = "Unknown";
      try {
        const rec = await readRecord(r.commitment, deployment);
        onChainStatus = rec.exists ? rec.status : "NotRegistered";
      } catch {
        onChainStatus = "RpcUnavailable";
      }
      return {
        commitment: r.commitment,
        credentialId: r.credential_id,
        holderDid: r.holder_did,
        validFrom: r.valid_from,
        expiresAt: r.expires_at,
        issuedAt: r.issued_at,
        revokedAt: r.revoked_at,
        revokeTx: r.revoke_tx,
        onChainStatus,
      };
    }),
  );
}

/** Revokes on-chain with the issuer's attestation key. Only for credentials this issuer issued. */
export async function revokeCredential(issuer: Session, commitment: string): Promise<{ txHash: string }> {
  const row = db().prepare("SELECT revoked_at FROM issuer_credentials WHERE commitment = ?").get(commitment) as
    | { revoked_at: number | null }
    | undefined;
  if (!row) throw new ApiError(404, "UNKNOWN_CREDENTIAL", "this issuer has no credential with that commitment");
  const deployment = loadDeployment();
  const rec = await readRecord(commitment, deployment);
  if (!rec.exists) throw new ApiError(409, "NOT_REGISTERED", "the holder has not registered this credential on-chain yet");
  if (rec.revoked) throw new ApiError(409, "ALREADY_REVOKED", "credential is already revoked");
  const keys = await issuerKeys();
  const registry = new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, keys.evmWallet);
  const tx = await registry.getFunction("revoke")(commitment);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new ApiError(502, "REVOKE_TX_FAILED", "revocation transaction failed");
  db()
    .prepare("UPDATE issuer_credentials SET revoked_at = ?, revoke_tx = ? WHERE commitment = ?")
    .run(nowSeconds(), receipt.hash, commitment);
  console.info(`[issuer] revoked credential ${commitment.slice(0, 10)}… by operator ${issuer.address}`);
  return { txHash: receipt.hash };
}
