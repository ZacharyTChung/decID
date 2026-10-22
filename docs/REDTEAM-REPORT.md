# Red-team report

Run: 2026-10-22T23:15:36.548Z against a fresh local stack (`npm run redteam`). Synthetic data, local chain only.

**43 of 43 defenses held.**

| ID | Category | Attack | Expected defense | Observed | Result |
| --- | --- | --- | --- | --- | --- |
| A1 | Credential forgery | Thief edits the subject DID inside a real credential (signature kept) | BAD_SIGNATURE | BAD_SIGNATURE | held |
| A2 | Credential forgery | Self-issued credential from the attacker's own did:key (perfect format) | ISSUER_NOT_TRUSTED | ISSUER_NOT_TRUSTED | held |
| A3 | Credential forgery | Unsigned token (alg "none") | UNSIGNED_TOKEN | UNSIGNED_TOKEN | held |
| A4 | Credential forgery | Algorithm confusion: HS256 keyed with the issuer's PUBLIC key | ALG_NOT_ALLOWED | ALG_NOT_ALLOWED | held |
| A5 | Credential forgery | Embedded attacker key in the header (jwk) with the trusted kid | FORBIDDEN_HEADER | FORBIDDEN_HEADER | held |
| A6 | Credential forgery | Trusted issuer kid, but signed with the attacker's key | BAD_SIGNATURE | BAD_SIGNATURE | held |
| A7 | Credential forgery | Re-serialized payload (same claims, different JSON bytes) with the original signature | BAD_SIGNATURE | BAD_SIGNATURE | held |
| A8 | Credential forgery | Deprecated alg identifier "EdDSA" (valid signature by attacker) | ALG_NOT_ALLOWED | ALG_NOT_ALLOWED | held |
| A9 | Credential forgery | Oversized token (12 KB) to stress the parser | HTTP 400 before any parsing | HTTP 400 VALIDATION_FAILED | held |
| B1 | Impersonation & replay | Thief presents the holder's stolen bundle, signing as themselves | SUBJECT_NOT_PRESENTER | SUBJECT_NOT_PRESENTER | held |
| B2 | Impersonation & replay | Thief claims to BE the holder's wallet but signs with their own key | PROOF_SIGNER_MISMATCH | PROOF_SIGNER_MISMATCH | held |
| B3 | Impersonation & replay | Replay of a captured, valid presentation | CHALLENGE_REUSED | CHALLENGE_REUSED | held |
| B4 | Impersonation & replay | Holder's proof made for a different verifier (audience) relayed here | PROOF_SIGNER_MISMATCH | PROOF_SIGNER_MISMATCH | held |
| B5 | Impersonation & replay | Proof that claims a validity far beyond the challenge expiry | PROOF_EXPIRY_INVALID | PROOF_EXPIRY_INVALID | held |
| B6 | Impersonation & replay | Race: the same valid submission fired 8 times concurrently | exactly 1 accepted | 1 accepted, 7 CHALLENGE_REUSED | held |
| B7 | Impersonation & replay | Guessed challenge id | CHALLENGE_UNKNOWN | CHALLENGE_UNKNOWN | held |
| B8 | Impersonation & replay | SIWE sign-in replay with a captured message + signature | NONCE_INVALID | HTTP 401 NONCE_INVALID | held |
| B9 | Impersonation & replay | SIWE role escalation: holder edits /roles/holder → /roles/issuer before signing | HTTP 401 | HTTP 401 SIWE_MESSAGE_ALTERED | held |
| C1 | Commitment, registry & chain | Real credential with a guessed salt | COMMITMENT_MISMATCH | COMMITMENT_MISMATCH | held |
| C2 | Commitment, registry & chain | Commitment substitution: A's token with another credential's (B's) commitment | COMMITMENT_MISMATCH | COMMITMENT_MISMATCH | held |
| C3 | Commitment, registry & chain | Valid, correctly signed credential that was never registered on-chain | NOT_REGISTERED | NOT_REGISTERED | held |
| C4 | Commitment, registry & chain | Front-running: thief submits holder B's registration transaction | revert SenderNotHolder | SenderNotHolder | held |
| C5 | Commitment, registry & chain | Thief rewrites B's authorization to name themselves as holder | revert SignerNotIssuer | SignerNotIssuer | held |
| C6 | Commitment, registry & chain | Holder re-registers an already registered commitment | revert AlreadyRegistered | AlreadyRegistered | held |
| C7 | Commitment, registry & chain | Thief calls the gated action with the holder's (public) commitment | revert AccessDenied | AccessDenied | held |
| C8 | Commitment, registry & chain | Attacker deploys their OWN registry, makes themselves issuer, registers a self-issued credential | ISSUER_NOT_TRUSTED (rogue registry never consulted) | ISSUER_NOT_TRUSTED | held |
| C9 | Commitment, registry & chain | Holder's proof bound to another deployment (rogue registry address in the EIP-712 domain) | PROOF_SIGNER_MISMATCH | PROOF_SIGNER_MISMATCH | held |
| D1 | API & auth abuse | Approve a request with no session | HTTP 401 | HTTP 401 | held |
| D2 | API & auth abuse | Holder session calls the issuer approval and revocation endpoints | HTTP 403 | approve HTTP 403, revoke HTTP 403 | held |
| D3 | API & auth abuse | Non-operator wallet asks for the issuer role | HTTP 403 NOT_ISSUER_OPERATOR | HTTP 403 NOT_ISSUER_OPERATOR | held |
| D4 | API & auth abuse | Cross-site request (CSRF) carrying the holder's cookie from evil.example | HTTP 403 BAD_ORIGIN | HTTP 403 BAD_ORIGIN | held |
| D5 | API & auth abuse | Mass assignment: request smuggles holderAddress=victim | HTTP 400 VALIDATION_FAILED | HTTP 400 VALIDATION_FAILED | held |
| D6 | API & auth abuse | Real-looking document number (not SYN-); is it echoed back? | HTTP 400, value not echoed | HTTP 400, not echoed | held |
| D7 | API & auth abuse | Another holder tries to pick up holder C's issued bundle | HTTP 404 (then the owner still gets it) | thief HTTP 404, owner HTTP 200 | held |
| D8 | API & auth abuse | Oversized request body (40 KB) | HTTP 413 | HTTP 413 BODY_TOO_LARGE | held |
| D9 | API & auth abuse | Flood: 40 sign-in challenges per minute from one client (others unaffected) | HTTP 429 for the flooder only | 10/40 throttled; bystander HTTP 200 | held |
| D10 | API & auth abuse | Recovery hijack: thief files a recovery request naming the victim's wallet | request only queued; victim stays valid until an issuer re-verifies (accepted risk) | queued with recovery warning=true; victim still verified=true; rejected by issuer | held |
| E1 | Privacy probes | Look for issuer secrets in the public config endpoint and page HTML | no secret material | none found | held |
| E2 | Privacy probes | Mine the verifier activity log for holder addresses or commitments | only reference, action, time, outcome | no identifiers | held |
| E3 | Privacy probes | Inspect a successful verification response for application data | only identityVerified + DIDs + dates | verified=true; 0 private value(s) in response | held |
| E4 | Privacy probes | Check the page CSP an XSS payload would face | per-request nonce, no 'unsafe-inline' | fresh nonce per response, no unsafe-inline | held |
| E5 | Privacy probes | Malformed JSON to provoke a stack trace | stable error code, no internals | HTTP 400 INVALID_JSON | held |
| E6 | Privacy probes | Scan every transaction and event on the chain for identity data, tokens and salts | nothing private on-chain | 9 blocks scanned; 0 private value(s) found | held |

## How trustworthy is this scorecard?

The harness was mutation-tested: with the verifier's holder-binding check and commitment comparison disabled, exactly the
scenarios that depend on them (B1, C1, C2) failed. Even then, the attacks were still rejected one layer deeper (the live
registry check caught the mismatched holder or commitment), which is the intended defense in depth. The scorecard
requires the *specific* defense to fire, so a missing layer shows up even when a later one would catch it.

## Findings fixed during the campaign

- **Rate-limit bypass via spoofed `X-Forwarded-For` (fixed).** The limiter keyed clients by a header any client can set,
  so rotating it bypassed every limit (confirmed: 10 of 10 spoofed requests passed a limit of 5). It is now trusted only
  when `TRUST_PROXY=1` (app behind a proxy that sets it); otherwise all requests share one bucket.
  Regression test: `test/unit/rate-limit.test.ts`. The campaign itself runs with `TRUST_PROXY=1` to give each simulated
  client its own bucket (scenario D9).

## Accepted risk

- **D10, recovery hijack:** anyone can *file* a recovery request naming another wallet. It only queues a request with a
  visible recovery warning; nothing is revoked until an issuer operator re-verifies the person and approves. In this
  prototype that review is a simulated operator decision.

Not covered here (needs clock control): expiry, not-yet-valid and registration-deadline boundaries; these are
covered by the contract tests and the Solidity fuzz/invariant suite (`npm run test:fuzz`).
