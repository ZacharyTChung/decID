# Integrating as a verifier (relying party)

A verifier decides whether a presenter controls a wallet that holds a valid "Identity Verified" credential from an issuer it trusts. It needs **no issuer secrets** and stores **no credential data**.

## What you need

| Input | Where it comes from | Secret? |
| --- | --- | --- |
| Trusted issuer policy (issuer DIDs, keys, EVM signers, lifecycles) | `config/trusted-issuers.local.json` (format: `config/trusted-issuers.example.json`) | No, but it must be obtained over a trusted channel: it *is* your trust decision |
| Deployment record (chain id, registry address, deployment id) | `deployments/localhost.json` | No |
| Chain access | Any JSON-RPC endpoint for that chain (`RPC_URL`) | No |

## Three ways to verify

1. **HTTP API** (this app): `POST /api/verifier/challenges` then `POST /api/verifier/presentations`. Challenges are single-use and stored server-side. See *Challenge format* in [CREDENTIAL-PROFILE.md](CREDENTIAL-PROFILE.md).
2. **Library**: `verifyPresentationCore(context, presented, { deployment, issuers, now })` in `src/lib/server/verifier/core.ts`. It is stateless: you generate and track your own challenge (32 random bytes, short expiry, single use).
3. **CLI**: `npm run verify -- <bundle.json> [--password …]` runs the same core against a holder bundle or encrypted backup. It uses a fresh challenge whose audience is `urn:did-mvp:cli-verifier`, and simulates the holder's signature with a Hardhat dev key (`--holder-index`, default 2). Exit code 0 means verified and 2 means not verified. `npm run demo` exercises it.

## The exchange

1. **You → holder:** a challenge `{ nonce, action, audience, chainId, registry, expiresAt }`. `audience` identifies *you* (an origin or URN); the holder's wallet shows it.
2. **Holder → you:** `{ credentialJwt, salt, proof: { holder, commitment, expiresAt, signature } }`. The signature is an EIP-712 `PresentationProof` over your challenge (see CREDENTIAL-PROFILE.md). It is an application-specific proof, not a W3C Verifiable Presentation.
3. **You:** run every check below, then discard `credentialJwt` and `salt`. Keep at most an outcome code.

## Checks you must not skip

All of them are in `core.ts`, in this order. Each one fails with a stable code:

1. **Wallet control.** The EIP-712 proof recovers to `proof.holder`, or the holder contract accepts it via EIP-1271. It must bind *your* nonce, audience and action, with `expiresAt` no later than your challenge.
2. **Token format.** A compact JWS, `typ: vc+jwt`, alg `Ed25519` only. Reject any header that carries keys (`jwk`, `jku`, `x5u`, …).
3. **Issuer trust.** The signing DID is a trusted issuer's key that was active (not compromised) at issuance, and did:key resolution matches the pinned JWK. **Never** verify with a key the presenter supplies.
4. **Signature,** then **semantics.** The exact profile with minimal subject claims, and JWT claims that agree with VC fields.
5. **Validity window,** **deployment binding** (chain + registry) and **holder binding** (subject DID = presenter).
6. **Commitment.** Recompute it from the exact token bytes and salt. Never re-serialize the token.
7. **Live registry.** The record exists, is active, and matches holder, trusted signer, schema and validity window. This is the only place revocation shows up. A perfectly signed token can still be revoked.

## Privacy obligations

- Do not store tokens, salts or proofs. The reference verifier keeps only `{ challenge reference, action, time, outcome code }`.
- A presentation reveals the holder's wallet address and on-chain record to you. Repeated presentations are linkable, so don't build cross-service profiles from them.
- You learn `identityVerified: true` and the issuer, nothing more. The issuer is **simulated** in this prototype: a pass does not mean a real-world identity was checked.
