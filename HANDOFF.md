# Handoff

State as of 2026-10-22. No secrets or credential payloads are in this file.

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
- **CSP:** `src/proxy.ts` sets a per-request nonce CSP without `'unsafe-inline'`; the root layout awaits `connection()` so pages render per request. API routes get a deny-all CSP from `next.config.ts`. The UI test asserts fresh nonces and that an injected inline handler is blocked.

## Verified commands and results (fresh clone, Node 22.22.0)

| Command | Result |
| --- | --- |
| `npm ci` | ok; `npm audit`: 0 vulnerabilities (after the `tmp` override) |
| `npm run compile` | 2 contracts compiled with solc 0.8.37 (upstream OpenZeppelin “`error` will become a keyword” warnings only) |
| `npm run typecheck` | clean (app, scripts, contract tests, ABI freshness) |
| `npm run test:contracts` | 37 passing |
| `npm run test:fuzz` | 8 fuzz properties × 1,000 runs and 4 stateful invariants (128 sequences × 40 calls) passing; a deliberately false probe invariant was confirmed to fail, so the handler exercises real state |
| `npm run test:coverage` | 100% line and statement coverage of CredentialRegistry, DemoGate and the test wallet |
| `npm run test:app` | 67 passed (7 files; includes API integration, key rotation, account recovery and a smart-account holder against a real Hardhat node) |
| `npm run build` | success; client chunks scanned: no issuer key material, no server modules, no source maps |
| `npm run demo` | `DEMO PASSED: every expected condition held.` |
| `npm run test:ui` (Playwright + Chromium, production build, injected EIP-1193 provider signing with Hardhat dev keys) | `UI TEST PASSED`: holder → issuer → non-operator refused → register → gate → verify → revoke → REVOKED → reload/import → gate refused |

## Blockers / unverified

- A real browser extension wallet (MetaMask) was not exercised. The browser test used an injected provider backed by Hardhat dev keys.
- The W3C spec site was not reachable from the build environment. VC-JOSE-COSE requirements were checked against the spec source on GitHub (w3c/vc-jose-cose).

## Next concrete step

The owner creates the empty GitHub repo `ZacharyTChung/decid` (the GitHub integration cannot create repositories: 403). Then push `main`, confirm the CI workflow (`.github/workflows/ci.yml`) is green, and try the UI with MetaMask on the local chain (README → “Using the UI with a browser wallet”).
