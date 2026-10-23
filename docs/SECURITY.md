# Security and privacy

This is a prototype for exploring the trust flow. It has **not** been audited and is **not** production-ready. It makes no claim of official identity approval, healthcare compliance, or interoperability with every wallet.

## Keys and trust boundaries

| Key | Type | Held by | Used for | Bound to the others by |
| --- | --- | --- | --- | --- |
| Issuer credential key | Ed25519 (`did:key`) | Server env (`ISSUER_CREDENTIAL_PRIVATE_JWK`) | Signing `vc+jwt` credentials | Trust policy entry (`did`, `kid`, `publicKeyJwk`) |
| Issuer EVM attestation key | secp256k1 | Server env (`ISSUER_EVM_PRIVATE_KEY`) | EIP-712 registration authorizations; revocation txs | Trust policy `evmAttestationSigner` + `addIssuer` on-chain |
| Holder wallet | secp256k1 | Holder's own injected wallet | SIWE sign-in, presentation proof, `register`, `checkIn` | Holder DID `did:pkh` = the address |
| Registry admin | secp256k1 | Hardhat dev account #0 (local only) | `addIssuer`, `removeIssuer`, `adminRevoke` | Constructor `DEFAULT_ADMIN_ROLE` |

Issuer operators are separate from issuer keys. Operators sign in with their own wallet, which must be in `ISSUER_OPERATOR_ADDRESSES`, and the server uses the issuer keys on their behalf. Keys are generated locally by `npm run setup` into a git-ignored `0600` file. They are never prefixed `NEXT_PUBLIC_`, never sent to the browser, and never logged. A build scan found neither key in `.next/static`, and no source maps are emitted. The headless scripts use Hardhat's public dev accounts. The UI never asks for a seed phrase or private key.

## Threat model

| Attacker capability | Implemented control | Remaining limitation |
| --- | --- | --- |
| Forge or tamper with a credential | Ed25519 JWS verified with the pinned trusted key; allowlist `Ed25519`; payload parsed only after verification | Issuer key compromise lets the attacker mint credentials until the policy and registry are updated |
| Self-issue a credential with their own `did:key` | Issuer must be in the trust policy; header keys refused; kid and key cross-checked against did:key resolution | The trust policy is a local file; distribution and governance of trust lists is out of scope |
| Algorithm confusion / `alg:none` / HMAC with public key | Explicit allowlist before and during `compactVerify`; key type fixed to OKP/Ed25519 | — |
| Present someone else's stolen bundle | Presentation proof must be signed by the subject's wallet; `holderBinding` check; gate uses `msg.sender` | A thief who also controls the holder's wallet is the holder |
| Replay a presentation | Server nonce, 120 s TTL, atomic single-use consumption, audience/action/chain/registry bound in the signature | Within one challenge window, a malicious verifier can relay the proof to itself only, because the audience is bound |
| Register someone else's authorization | `msg.sender == holder`; holder signed into the EIP-712 struct | — |
| Impersonate a smart-account holder | EIP-1271: the holder contract itself must accept the signature (SIWE and presentation proof); registry and gate use `msg.sender` = the contract | The verdict follows the wallet's current on-chain owners; wallets without replay-safe hashing (ERC-7739) could accept a signature made for another app |
| Alter authorization fields / cross-chain or cross-deployment replay | EIP-712 struct + domain with chainId and registry; OZ ECDSA (rejects malleable sig) | — |
| Re-register a revoked credential | Commitments are permanently consumed | — |
| Holder loses a wallet (thief holds the key and bundle) | Account recovery: the issuer revokes the lost wallet's registered credentials and cancels its unregistered authorizations before issuing to the new wallet | Relies on the issuer re-verifying the person; the lost wallet cannot co-sign. A recovery request by an impostor is only as strong as that re-verification |
| Replay an old authorization after a local chain restart/reset (same registry address, issuer key and epoch) | Random `deploymentId` fixed at construction is signed into every authorization (`WrongDeployment`) | — |
| Get a session with an edited SIWE message (e.g. no expiry) | The server stores the SHA-256 of the exact message it issued with the nonce and requires an identical message | — |
| Concurrent issuer transactions racing for one nonce | Issuer-key transactions are serialized in-process | Single server process assumed |
| Unauthorized issuer actions | Server-side role check on every issuer route; operator allowlist re-checked per request; on-chain `onlyRole` for admin | Operator wallet compromise grants approval/revocation until removed from the allowlist |
| Covering up issuer actions afterwards (editing the issuer database) | Tamper-evident audit log: every issue, rejection, revocation and recovery supersede is a SHA-256 hash-chain entry naming the operator; `npm run audit-log -- verify` and the issuer page report the first broken entry | Someone with database write access can still rewrite the *whole* chain or drop its newest entries; only a head hash recorded elsewhere (`npm run audit-log -- head`) detects that. The reject reason is free text typed by the operator, so do not type personal data into it |
| CSRF / cross-site requests | `Origin` must equal `APP_ORIGIN`; JSON-only bodies; `SameSite=Strict` HttpOnly cookie; per-request nonce CSP (`script-src 'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'`; `connect-src` limited to the app and the local RPC; `frame-ancestors 'none'`; deny-all CSP on JSON API routes) | `'strict-dynamic'` trusts scripts created by already-trusted scripts, by design; dev mode adds `'unsafe-eval'` |
| Session theft | Random 256-bit id, only its hash stored, 1 h expiry, dropped on wallet/chain change in the UI | Local HTTP (no `Secure` flag unless `APP_ORIGIN` is https) |
| Brute force / spam | Fixed-window rate limits on auth, requests, challenges, presentations; body size limit; `X-Forwarded-For` trusted only with `TRUST_PROXY=1` (a red-team finding: it was spoofable) | Without a trusted proxy all clients share one bucket. Adequate for a local prototype only |
| Browser profile copied (device vault) | Only the PBKDF2/AES-GCM envelope is stored; passphrase never stored | Script in this origin could capture the passphrase as it is typed (mitigated by the nonce CSP); weak passphrases can be guessed offline |
| Holder's backup file stolen | AES-256-GCM, PBKDF2-SHA-256 600k iterations, AAD-bound header, ≥12-char password | Offline guessing of weak passwords remains possible |
| Malicious credential content (huge, odd JSON, remote contexts) | 8 KiB token cap, 32 KiB body cap, strict schema, contexts never fetched | — |
| Issuer key compromise | `npm run rotate-keys -- --compromised`: the trust policy marks the key compromised (all its credentials rejected); a compromised EVM signer is removed on-chain (epoch); `adminRevoke` | Holders of affected credentials must be reissued; trust-policy distribution to other verifiers is out of scope |
| Routine key rotation breaking existing credentials | Trust policy v2: retired keys keep credentials issued while active valid; retired EVM keys are kept only for revocation | Rotation is a local file + registry operation, not a published key history (e.g. did:web) |
| Learning private data from the chain | Only a salted commitment and status are on-chain; a regression scan checks calldata/events/records for sentinel values, token and salt | See *Disclosure* below |

## Privacy: what is disclosed

This MVP is **data-minimized and pseudonymous, not anonymous and not zero-knowledge.**

- **The issuer** sees the synthetic application until it decides. It retains the holder's address, DID and commitment in its issuance log.
- **The chain (everyone)** sees the holder address, issuer attestation address, schema id (the credential *kind*), validity timestamps, registration time, revocation and every gate check-in. All of this is **linkable** to the wallet's other activity, permanently.
- **The verifier** sees the full minimal credential (holder DID, issuer DID, dates, `identityVerified`), the commitment and the salt. It can link the presentation to the on-chain record and to the wallet. Repeated presentations of the same credential, to one verifier or to colluding verifiers, are linkable through the holder DID, the commitment and the token itself.
- Deleting local data (`npm run reset`) does not erase anything already on a blockchain.

### Privacy regression check, and its limits

`test/unit/api-flow.test.ts` (and step 10 of `npm run demo`) scans every transaction's calldata, every event's data and topics, and the public registry record. It confirms that distinctive synthetic sentinel values (name, birth date, document number), the credential token and its payload, and the salt are absent, as raw text and as hex-encoded UTF-8. It also checks that issuer and verifier tables keep no token, salt or erased synthetic data. This is a regression test for known encodings. It is **not** a formal privacy proof: it cannot detect leakage through other encodings, timing, metadata, or linkage across transactions.

## Public per-credential status vs privacy-preserving status

The registry publishes one record per credential, keyed by commitment and holder address. That makes status checks trivial for any verifier and for contracts like `DemoGate`, but it publicly reveals *that* a given wallet holds a credential of this kind from this issuer, and when it was revoked.

Alternatives, all roadmap: W3C **Bitstring Status List** (verifiers fetch a compressed list and the holder's index hides among many), cryptographic accumulators, or ZK non-revocation proofs. Each improves holder privacy but loses something: simple on-chain composability, instant status for contracts, or implementation simplicity.

## “Over 18” and other predicates

An issuer could sign a predicate claim such as `ageOver18: true` in exactly this profile. The verifier would learn only the predicate, but it would trust the issuer's assertion. That is an **issuer-signed predicate**, not a zero-knowledge proof. A ZK approach (proving a predicate over a signed birth date without revealing it) or a selective-disclosure cryptosuite (SD-JWT VC, BBS) is not implemented here.

## Reusing the architecture for a health or vaccination credential (not built)

The same pieces would apply with a different type and schema: a new `credentialType` and `schemaId`, a new versioned zod/JSON schema, an issuer entry authorized for that type, and a gate requiring that schema. Because health data is far more sensitive, the subject should carry only a minimal issuer-asserted predicate (e.g. “meets requirement X until date Y”), never diagnoses or records, and public per-credential on-chain status would likely be unacceptable (see the status tradeoff above). This prototype contains no healthcare integrations and no medical decision logic.

## Roadmap (not implemented)

1. **Stronger disclosure privacy:** SD-JWT VC or BBS selective disclosure, and ZK predicates.
2. **Unlinkability:** pairwise or rotating holder identifiers, privacy-preserving status (Bitstring Status List or ZK non-revocation), no per-credential public record.
3. **Issuer key rotation (partly implemented):** done: multiple keys per issuer with lifecycles, `npm run rotate-keys`. Still to do: publishing key history through an updatable DID method (e.g. did:web) so verifiers learn rotations without a local policy file. This was deliberately not built here: did:web requires HTTPS on a real domain, and resolving it over plain `http://localhost` would contradict the trust model (verifiers never fetch keys over unauthenticated channels).
4. **Account recovery (implemented for the simulated issuer):** reissue to a new wallet after re-verification, revoking or cancelling the old wallet's credentials first. Smart-account holders (EIP-1271) are supported for sign-in, presentation, registration and the gate. Social-recovery wallets therefore work if their contract implements EIP-1271.
5. **Real issuer onboarding:** governed trust lists, issuer accreditation, externally anchored audit logs (a local hash-chained log is implemented), HSM-held keys, real identity proofing. All of this is out of scope for this prototype.
6. **Hardening:** HTTPS-only cookies, distributed rate limiting, a formal contract audit, external key management. Property-based fuzz tests, stateful invariant tests and 100% contract line coverage are already in place.

## Implemented vs future (summary)

| Implemented | Future work |
| --- | --- |
| VC 2.0 + vc+jwt, Ed25519 allowlist, trust policy pinning, did:key resolution cross-check | Selective disclosure, ZK predicates |
| Salted commitment over exact token bytes | Privacy-preserving status |
| EIP-712 registration with holder binding, deadline, epoch, one-time commitments | Relayers / gasless registration |
| SIWE sessions, origin checks, rate limits, server-side roles, nonce CSP + security headers | Production session infrastructure |
| Single-use, audience-bound challenges with atomic consumption | Standard presentation protocol (e.g. OpenID4VP) |
| Encrypted holder export (PBKDF2 + AES-GCM) | Secure wallet storage, recovery |
| Issuer removal epochs, admin override revocation, key rotation with retired/compromised lifecycles | Published key history (did:web), governance |
