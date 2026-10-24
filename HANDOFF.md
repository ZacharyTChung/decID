# Handoff

State as of 2026-10-23. No secrets or credential payloads are in this file.

## Completed

- Contracts: `CredentialRegistry` (AccessControl, EIP-712 registration with holder binding, deadline, issuer epoch, permanent one-time commitments, issuer and admin revocation) and `DemoGate` (`checkIn`).
- Credential layer: VC 2.0 `IdentityVerifiedCredential` v1 as `application/vc+jwt` (Ed25519, `did:key` issuer via Digital Bazaar), `did:pkh:eip155` holders, trust policy pinning, salted commitment with a pinned test vector.
- Backend (Next.js route handlers): SIWE sessions (`siwe`), holder requests, issuer review/issuance/revocation, one-time bundle pickup, verifier challenges and presentation verification, SQLite storage, origin/CSRF checks, rate limits, body limits, stable error codes.
- UI: Holder / Issuer / Verifier views with an injected EIP-1193 wallet, wrong-network handling, wallet/chain change handling, encrypted export/import.
- Scripts: `setup`, `deploy`, `demo` (headless, real HTTP + chain), `reset`, ABI generation.
- Docs: README, docs/ARCHITECTURE.md, docs/CREDENTIAL-PROFILE.md, docs/SECURITY.md.

## Important decisions

- **Separate repository.** The work was requested outside the original app repo. GitHub repo creation was not permitted for the integration, so the project was built locally first.
- **Compiler from npm.** `binaries.soliditylang.org` was blocked in the build environment, so Hardhat uses the pinned `solc` npm package (`soljson.js`, WASM) via `solidity.path`. The config asserts the package version.
- **`tmp` override.** `solc@0.8.37` pins `tmp@0.2.6`, which has a high-severity advisory (only reached through solc-js's SMT helper, which is unused). `overrides.tmp = 0.2.7` is pinned and `npm audit` is clean.
- **Ed25519 with `alg: "Ed25519"`** (RFC 9864 fully-specified) is the only accepted JWS algorithm.
- **did:key → JsonWebKey adaptation.** The driver returns `Multikey`, so we convert to a JWK with the same library. Full VC-JOSE-COSE key-discovery conformance is not claimed.
- **Issuer removal = epoch bump.** Re-adding an issuer never revives old records or authorizations.
- **Presentation proof is a custom EIP-712 message**, not a W3C VP. It is bound to nonce, audience, action, chain, registry, holder, commitment and expiry.
- **Holder bundle storage:** memory only plus encrypted export. The server deletes its copy at pickup.
- **Deployment binding:** a random `deploymentId` is signed into every registration authorization, because a restarted local chain redeploys at the same address (finding from an independent review).
- **SIWE message binding:** the server stores a hash of the exact message it issued and rejects edited variants.
- **Key rotation:** trust policy v2 (keys and EVM signers with active/retired/compromised lifecycles), `npm run rotate-keys`, retired EVM keys kept only for revocation. `npm run setup` migrates a v1 policy.
- **Account recovery:** a holder request can name a lost wallet. Approval revokes its registered credentials and cancels its unregistered authorizations (new `cancelAuthorization`, scoped per issuer) before issuing to the new wallet.
- **Smart-account holders:** SIWE and presentation proofs fall back to EIP-1271 `isValidSignature`; signatures may exceed 65 bytes. `SimpleSmartWallet` is a test-only fixture.
- **Verifier activity log** (`GET /api/verifier/history`): reference, action, time and outcome code only. **Holder expiry notice** within 30 days of expiry.
- **Verifier core + CLI:** presentation checks live in stateless `verifier/core.ts`, shared by the API and `npm run verify` (public inputs only; exercised by `npm run demo`).
- **Device vault:** the holder can save the bundle in IndexedDB encrypted with a passphrase (same envelope as the export) and unlock it after a reload; the UI test checks that only ciphertext is at rest.
- **Issuer audit log:** issuer actions go into an append-only SHA-256 hash chain (`issuer_audit`), checked by `npm run audit-log -- verify` and shown on the issuer page. Tests tamper with a copy of the database (edit, forged re-hash, delete, reorder) and confirm detection. Tail truncation and whole-chain re-hashing are now caught by on-chain anchoring (below).
- **On-chain anchoring (`ReceiptAnchor`):** the heads of every business's receipt chain and of the issuer audit log are checkpointed on-chain (append-only: counts must strictly increase). Verification compares each stored log with every checkpoint, catching an operator who re-signs history or drops the newest entries (which a hash chain alone accepts). Server: `src/lib/server/anchor.ts` (background, coalescing, its own tx lease `anchor_tx_lease`); shared check `src/lib/shared/anchor-check.ts`; anchorer key `ANCHORER_PRIVATE_KEY` (dev account #18, `npm run setup` adds it); namespace `ANCHOR_NAMESPACE`. Shown on the business dashboard (Receipts), the issuer page, `npm run audit-log -- verify`, and in the hosted prototype with three live attacks. Tests: `test/contracts/anchor.test.ts`, the `ReceiptAnchor` invariant suite (mutation-checked), `test/unit/anchor.test.ts`, red-team F1–F3 (56/56). The in-page chain now answers `eth_getLogs`. Upgrading an existing checkout needs `npm run setup` and `npm run deploy`.
- **OpenAPI 3.1:** `docs/openapi.json` is generated from zod schemas (`src/lib/shared/api.ts` for requests, `api-responses.ts` for responses); typecheck fails if stale. A conformance test exercises every operation against real handlers and parses each response with its strict schema (a mutation adding a `salt` field to a response was confirmed to fail it).
- **Performance:** `npm run bench` (live stack, correctness-checked) and `npm run test:gas`. Finding fixed: ethers' default 10 ms `batchStallTime` and a third sequential RPC round trip made a verification take 51 ms; now 20 ms p50 (docs/PERFORMANCE.md).
- **Selective disclosure (credential profile v2):** the credential is `vc+sd-jwt`. `ageOver18`, `ageOver21` and `countryOfResidence` are issuer-derived SD-JWT disclosures behind 8 sorted digests (decoys included). Verifier actions carry a disclosure policy (the 18+ area requests `ageOver18 = true`), and unrequested disclosures are refused. The EIP-712 presentation proof (v2) signs the disclosed names and the `sdHash` of the exact presentation instead of using a KB-JWT. Upgrading an existing checkout needs `npm run setup` (authorizes the new schema id) and `npm run deploy` (the gate is bound to the schema). Old v1 bundles are not accepted.
- **Independent evaluation (2026-10-23):** a fresh clone passed every documented command. Third-party libraries (OWF SD-JWT, viem, Python `cryptography`, W3C schema and context) accept the real issuer's output (`interop.test.ts`, `w3c-conformance.test.ts`). Two findings were fixed:
  1. `jti` was an undefined JSON-LD term, so JSON-LD safe mode rejected the credential.
  2. Concurrent issuer transactions from two app instances raced for the nonce (2 of 4 revocations failed, reported as an RPC outage). They now use a cross-process lease in the database (`issuer/tx-lock.ts`, `npm run test:multi-instance`).
  A chain outage makes the verifier fail closed (`resilience.test.ts`).
- **Showcase site (`site/`):** verdict, evidence and an in-browser playground running the real issuance function (`issuer/issue.ts`, extracted from `approveRequest`), the holder code and the production verifier core. The verifier core now accepts an injected `provider`. `ApiError` moved to `errors.ts`, so the core no longer pulls in the database. The chain is an in-page ethereumjs EVM running the compiled contracts. `npm run test:site` drives it in Chromium (in CI). Evidence comes from `npm run site:evidence`.
- **CSP:** `src/proxy.ts` sets a per-request nonce CSP without `'unsafe-inline'`; the root layout awaits `connection()` so pages render per request. API routes get a deny-all CSP from `next.config.ts`. The UI test asserts fresh nonces and that an injected inline handler is blocked.

- **Product layer (decID):** reusable age verification, built on the protocol above.
  - **decID Verify** (`src/lib/server/verify-api`, `/api/v1/*`, SDK `src/sdk/decid-verify.ts`):
    - Merchants authenticate with bearer API keys (stored as SHA-256).
    - Policies: `age_over_21`, `age_over_18`, `identity_verified`.
    - Single-use sessions, audience `urn:decid:merchant:<id>`, 5-minute TTL.
    - A 4-letter match code for doors.
    - Ed25519 receipts (`decid-receipt+jwt`), hash-chained per merchant, with the JWKS at `/api/v1/receipt-keys`.
    - A `false` result only for `POLICY_NOT_SATISFIED`; every other failure is a rejection with a reason.
  - **decID Pass** (`/pass`, `src/lib/client/pass.ts`):
    - Embedded wallet in IndexedDB with multiple demo people and SIWE sign-in.
    - Its on-chain registration is relayed by a sponsor account (`/api/pass/registration`). The relay only accepts `register` to the registry, signed by the session holder, for a commitment issued to them, on chain 31337.
    - Optional `ISSUER_AUTO_APPROVE=1` (server-side, actor "auto-approval"; recovery requests excluded).
  - **Demo businesses** Hopline (`/demo/shop`) and Neon Hall (`/demo/door`): their backends (`/api/demo/*`) call decID Verify over HTTP through the SDK, only when `DEMO_MODE=1`.
  - **Business dashboard** (`/business`): cookie session from an API key.
  - **Demo stage** (`/demo`): same-origin iframes, so the CSP now has `frame-ancestors 'self'` and `X-Frame-Options SAMEORIGIN`.
  - **Landing page** at `/`; the old home moved to `/lab`.
  - `npm run product` (one-command demo, `--lan` for a phone) and `npm run test:product` (end to end in Chromium, in CI).
  - Docs: docs/PRODUCT.md, docs/DEMO-SCRIPT.md.
- **Hosted prototype** (`site/product/`, published at https://claude.ai/artifact/SE7SVzFQFUQpWQJm4su763):
  - The whole product in one browser tab: `DecidCloud` (`site/product/cloud.ts`) runs the real issuance, contracts on the in-page EVM, verifier core and receipt chain. Sessions and receipts live in memory.
  - Receipt signing, chain checking and match codes moved to `src/lib/shared/receipt-chain.ts`, shared with the server (`receipt-chain.test.ts` pins byte-for-byte equality with the old node:crypto code).
  - The dashboard adds an outcome chart, a verification-time chart, an insider-tamper demo and a "busy night" simulation that includes a borrowed credential and a revoked Pass.
  - `npm run site:product` builds it; `npm run test:product-site` tests it (in CI).
  - Product plan: docs/PRODUCT-PLAN.md. Prompts: docs/PROMPTS.md.

## Verified commands and results (fresh clone, Node 22.22.0)

| Command | Result |
| --- | --- |
| `npm ci` | ok; `npm audit`: 0 vulnerabilities (after the `tmp` override) |
| `npm run compile` | 2 contracts compiled with solc 0.8.37 (upstream OpenZeppelin “`error` will become a keyword” warnings only) |
| `npm run typecheck` | clean (app, scripts, contract tests, ABI freshness) |
| `npm run test:contracts` | 37 passing |
| `npm run test:fuzz` | 8 fuzz properties × 1,000 runs and 4 stateful invariants (128 sequences × 40 calls) passing; a deliberately false probe invariant was confirmed to fail, so the handler exercises real state |
| `npm run test:coverage` | 100% line and statement coverage of CredentialRegistry, DemoGate and the test wallet |
| `npm run test:app` | 132 passed (now including the decID Verify API and receipt-chain tests); previously 111 passed (14 files: independent-library interop, W3C context/schema conformance, chain-outage resilience, issuer lease, SD-JWT primitives with the RFC 9901 vector, disclosure tamper tests, OpenAPI sync and response conformance, API integration, key rotation, account recovery with the audit-log tamper tests, and a smart-account holder against a real Hardhat node) |
| `npm run build` | success; client chunks scanned: no issuer key material, no server modules, no source maps |
| `npm run demo` | `DEMO PASSED: every expected condition held.` |
| `npm run test:multi-instance` | `MULTI-INSTANCE TEST PASSED`: shared sessions, 60/60 cross-instance presentations, 8/8 concurrent cross-instance revocations, intact audit chain |
| `npm run redteam` | 53/53 defenses held (10 selective-disclosure attacks added with SD-JWT) (report: docs/REDTEAM-REPORT.md); harness mutation-tested; fixed finding: spoofable `X-Forwarded-For` rate-limit key |
| `npm run test:product-site` | `HOSTED PROTOTYPE TEST PASSED`: tour, charts, tamper detection, busy night (borrowed and revoked passes refused), phone width, axe, no console errors |
| `npm run test:product` | `PRODUCT TEST PASSED` (twice in a row): Pass onboarding, Hopline checkout with a verified receipt and no personal data, matching door codes, under-21 refusal, intact receipt chain, demo stage; axe: no serious violations; no console errors |
| `npm run test:ui` (Playwright + Chromium, production build, injected EIP-1193 provider signing with Hardhat dev keys) | `UI TEST PASSED`: holder → issuer → non-operator refused → register → gate → verify → revoke → REVOKED → 18+ selective disclosure → reload/import → gate refused; axe (WCAG 2.1 A/AA) audit of 8 UI states: 0 violations |

## Blockers / unverified

- A real browser extension wallet (MetaMask) was not exercised. The browser test used an injected provider backed by Hardhat dev keys.
- The W3C spec site was not reachable from the build environment. VC-JOSE-COSE requirements were checked against the spec source on GitHub (w3c/vc-jose-cose).

## Next concrete step

For the class demo, follow docs/DEMO-SCRIPT.md. Product next steps are in docs/PRODUCT.md → Roadmap.


Try the UI with MetaMask on the local chain (README → “Using the UI with a browser wallet”). Planned next: see the roadmap in docs/SECURITY.md (unlinkable disclosure, privacy-preserving status).
