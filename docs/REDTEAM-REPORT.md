# Red-team report

Run: 2026-10-24T04:00:30.832Z against a fresh local stack (`npm run redteam`). Synthetic data, local chain only.

**68 of 68 defenses held.**

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
| S0 | Selective disclosure | Control: adult holder discloses ageOver18 to the 18+ area | VERIFIED with exactly { ageOver18: true } | VERIFIED {"ageOver18":true} | held |
| S1 | Selective disclosure | Adult holder withholds the requested ageOver18 claim | CLAIM_NOT_DISCLOSED | CLAIM_NOT_DISCLOSED | held |
| S2 | Selective disclosure | Under-18 holder honestly discloses ageOver18=false | POLICY_NOT_SATISFIED | POLICY_NOT_SATISFIED | held |
| S3 | Selective disclosure | Under-18 holder flips their disclosure to true (same salt, signs it) | DISCLOSURE_NOT_REFERENCED | DISCLOSURE_NOT_REFERENCED | held |
| S4 | Selective disclosure | Under-18 holder borrows the adult's genuine ageOver18=true disclosure | DISCLOSURE_NOT_REFERENCED | DISCLOSURE_NOT_REFERENCED | held |
| S5 | Selective disclosure | Over-disclosure: country disclosed to an action that requests nothing | UNREQUESTED_DISCLOSURE | UNREQUESTED_DISCLOSURE | held |
| S6 | Selective disclosure | Relay strips the disclosure the holder signed for (to make the holder fail) | PROOF_SIGNER_MISMATCH | PROOF_SIGNER_MISMATCH | held |
| S7 | Selective disclosure | Relay appends a disclosure the holder did not consent to (country) | PROOF_SIGNER_MISMATCH | PROOF_SIGNER_MISMATCH | held |
| S8 | Selective disclosure | The same disclosure presented twice | DISCLOSURE_DUPLICATE | DISCLOSURE_DUPLICATE | held |
| S9 | Selective disclosure | Inspect the signed credential for the hidden claims (plaintext or guessable digests) | only salted digests; same count for every holder | no plaintext, 8 vs 8 digests | held |
| E1 | Privacy probes | Look for issuer secrets in the public config endpoint and page HTML | no secret material | none found | held |
| E2 | Privacy probes | Mine the verifier activity log for holder addresses or commitments | only reference, action, time, outcome | no identifiers | held |
| E3 | Privacy probes | Inspect a successful verification response for application data | only identityVerified + DIDs + dates | verified=true; 0 private value(s) in response | held |
| E4 | Privacy probes | Check the page CSP an XSS payload would face | per-request nonce, no 'unsafe-inline' | fresh nonce per response, no unsafe-inline | held |
| E5 | Privacy probes | Malformed JSON to provoke a stack trace | stable error code, no internals | HTTP 400 INVALID_JSON | held |
| E6 | Privacy probes | Scan every transaction and event on the chain for identity data, tokens and salts | nothing private on-chain | 17 blocks scanned; 0 private value(s) found | held |
| F1 | Audit trail & anchoring | Outsider writes a forged checkpoint for the issuer audit log | revert AccessControlUnauthorizedAccount | AccessControlUnauthorizedAccount | held |
| F2 | Audit trail & anchoring | Stolen anchorer key rolls the audit-log checkpoint back to fewer entries | revert CountNotIncreasing | CountNotIncreasing | held |
| F3 | Audit trail & anchoring | Operator rewrites the issuer audit log in the database and re-hashes the whole chain | hash chain passes, on-chain anchor mismatch | chain passes; anchor: entry 1 differs from the hash anchored on-chain in block 7 | held |
| H1 | Device unlock & fraud signals | Someone else's face: the holder's Pass unlocked with a passkey registered to another wallet | USER_NOT_VERIFIED | rejected USER_NOT_VERIFIED | held |
| H2 | Device unlock & fraud signals | Replay of a captured Face ID assertion into a new check | USER_NOT_VERIFIED | rejected USER_NOT_VERIFIED | held |
| H3 | Device unlock & fraud signals | Phone tapped without Face ID / PIN (user presence only, no user verification) | USER_NOT_VERIFIED | rejected USER_NOT_VERIFIED | held |
| H4 | Device unlock & fraud signals | Pass-back: the same Pass admitted twice in a row at the door | second answer carries a pass_reuse signal | verified; signals: pass_reuse | held |
| H5 | Device unlock & fraud signals | Read another business's fraud signals or ask its assistant without signing in | HTTP 401 / 401 | HTTP 401 / 401 | held |
| H6 | Device unlock & fraud signals | Hopline asks its assistant about one of Neon Hall's checks (cross-tenant read) | not found | HTTP 200: I found no age check with the reference “door-7”. Checks are | held |
| G1 | Government ID | Forged licence: perfect format, signed by the attacker's own "DMV" root | HTTP 422 MDL_UNTRUSTED_ISSUER | HTTP 422 MDL_UNTRUSTED_ISSUER | held |
| G2 | Government ID | Minor edits age_over_21 from false to true inside the state-signed licence | HTTP 422 MDL_BAD_SIGNATURE | HTTP 422 MDL_BAD_SIGNATURE | held |
| G3 | Government ID | Copied licence data presented from another phone (without the licence's device key) | HTTP 422 MDL_NOT_DEVICE_SIGNED | HTTP 422 MDL_NOT_DEVICE_SIGNED | held |
| G4 | Government ID | Phishing relay: an answer the adult's wallet made for evil.example, forwarded to decID | HTTP 400 MDL_BAD_RESPONSE | HTTP 400 MDL_BAD_RESPONSE | held |
| G5 | Government ID | Replay of a captured, valid wallet answer | HTTP 404 MDL_REQUEST_NOT_FOUND | HTTP 404 MDL_REQUEST_NOT_FOUND | held |
| G6 | Government ID | Lending a licence: the adult approves a Pass for someone else's phone | allowed once, and the adult's own Pass is shut down (one licence, one Pass) | borrower got a Pass; adult's Pass shut down | held |

Not covered here (needs clock control): expiry, not-yet-valid and registration-deadline boundaries; these are
covered by the contract tests and the Solidity fuzz/invariant suite (`npm run test:fuzz`).
