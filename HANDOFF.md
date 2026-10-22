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
- **CSP** is set in `next.config.ts`. It allows `'unsafe-inline'` scripts because Next.js injects inline bootstrap scripts; nonce-based CSP is roadmap.

## Verified commands and results (fresh clone, Node 22.22.0)

| Command | Result |
| --- | --- |
| `npm ci` | ok; `npm audit`: 0 vulnerabilities (after the `tmp` override) |
| `npm run compile` | 2 contracts compiled with solc 0.8.37 (upstream OpenZeppelin “`error` will become a keyword” warnings only) |
| `npm run typecheck` | clean (app, scripts, contract tests, ABI freshness) |
| `npm run test:contracts` | 30 passing |
| `npm run test:app` | 50 passed (4 files; includes API integration against a real Hardhat node) |
| `npm run build` | success; client chunks scanned: no issuer key material, no server modules, no source maps |
| `npm run demo` | `DEMO PASSED: every expected condition held.` |
| `npm run test:ui` (Playwright + Chromium, production build, injected EIP-1193 provider signing with Hardhat dev keys) | `UI TEST PASSED`: holder → issuer → non-operator refused → register → gate → verify → revoke → REVOKED → reload/import → gate refused |

## Blockers / unverified

- A real browser extension wallet (MetaMask) was not exercised. The browser test used an injected provider backed by Hardhat dev keys.
- The W3C spec site was not reachable from the build environment. VC-JOSE-COSE requirements were checked against the spec source on GitHub (w3c/vc-jose-cose).

## Next concrete step

The owner creates the empty GitHub repo `ZacharyTChung/decid` (the GitHub integration cannot create repositories: 403). Then push `main`, confirm the CI workflow (`.github/workflows/ci.yml`) is green, and try the UI with MetaMask on the local chain (README → “Using the UI with a browser wallet”).
