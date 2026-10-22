# Decentralized Identity MVP

A working prototype of a privacy-conscious credential flow with three roles:

- **Holder**: controls an Ethereum wallet, receives an “Identity Verified” credential, keeps it off-chain, registers a randomized commitment on a local EVM chain, presents it, and uses a contract-gated action.
- **Issuer**: a *simulated* identity office. An authorized operator approves requests. The backend signs a minimal W3C Verifiable Credential and an EIP-712 registration authorization, and can revoke on-chain.
- **Verifier**: issues single-use challenges and checks the credential signature, issuer trust, wallet control, holder binding, commitment and live registry status, each reported separately.

> **Prototype only.** Synthetic data, local Hardhat chain, no real identity verification, not audited, not production-ready. No public-chain deployment, no paid services, no external identity provider.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS 4 |
| Backend | Next.js route handlers → separate `auth`, `issuer`, `verifier`, `credential` modules (`src/lib/server`) |
| Chain | Solidity 0.8.37 (solc-js from npm), Hardhat 3 local node, OpenZeppelin Contracts 5.6 (AccessControl, EIP712, ECDSA) |
| EVM client | ethers v6 |
| Credentials | W3C VC Data Model 2.0 secured as `application/vc+jwt` (VC-JOSE-COSE) with `jose`; issuer `did:key` (Ed25519) via `@digitalbazaar/did-method-key`; holder `did:pkh:eip155` |
| Sign-in | ERC-4361 SIWE via `siwe`, server-side sessions |
| Storage | SQLite via `better-sqlite3` |
| Tests | Hardhat + Mocha/Chai and Solidity fuzz tests (contracts), Vitest (credentials, API, integration), scripted headless demo, Playwright UI test |

**Node.js 22.13 or newer** (tested on 22.22). Package manager: npm (lockfile committed, exact versions pinned).

## Quick start (fresh clone)

```bash
npm ci
npm run compile          # compile contracts + regenerate shared ABI module
npm run setup            # generate local issuer keys → .env.local (0600) + config/trusted-issuers.local.json
npm run chain            # terminal 1: local Hardhat node on 127.0.0.1:8545 (chain 31337)
npm run deploy           # terminal 2: deploy registry + gate, authorize issuer, write deployments/localhost.json
npm run dev              # terminal 2: app on http://localhost:3000
```

### Headless end-to-end demo (one command)

```bash
npm run compile && npm run demo
```

The demo starts its own Hardhat node (port 8546) and Next.js dev server (port 3100). It generates throwaway keys under `.demo/` and deploys fresh contracts. It then runs **request → approve → issue → register → present → verify → gated action → revoke → rejected verification and rejected gated action**, plus negative checks and an on-chain privacy scan. Everything uses real HTTP calls and real signatures. It exits non-zero if any expected condition fails, and it does not touch your dev chain, app or `.data/`.

### All checks

```bash
npm run test:contracts   # 37 Hardhat example-based tests (registry + gate security properties)
npm run test:fuzz        # Solidity property tests: 8 fuzz tests x 1,000 inputs, 4 stateful invariants
                         # over random register/revoke/remove/re-add/time/replay sequences
npm run test:coverage    # contract line/statement coverage (currently 100%)
npm run test:app         # 67 Vitest tests (starts its own Hardhat node on 8547)
npm test                 # both
npm run typecheck        # app + scripts + contract tests + ABI freshness
npm run build            # production build
npm run test:ui          # browser test of all three views (Playwright + Chromium; production build, isolated stack)
```

`test:ui` needs a Chromium for Playwright (`npx playwright install chromium` once). The page's wallet in that test is an injected EIP-1193 provider that signs with Hardhat's public dev keys, so its signatures and transactions are real. It is test tooling, not part of the app. CI (`.github/workflows/ci.yml`) runs every command above.

## Using the UI with a browser wallet

1. Run the quick start above.
2. In a browser wallet such as MetaMask, add the network **Hardhat Local**: RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH`. The app's “Switch to local chain” button can also add it.
3. **Get local test funds:** import Hardhat's *public* development accounts. `npm run chain` prints their private keys, and each holds 10,000 local ETH. Use them **only** on this local chain. Their keys are public, and funds sent to them on real networks are lost. The app never asks for a seed phrase or private key.
   - Account #1 `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` is the **issuer operator** (allowlisted in `ISSUER_OPERATOR_ADDRESSES`).
   - Account #2 `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` is the **holder** (any other account works as well).
4. **Holder** page: connect, sign in, submit synthetic data. **Issuer** page: switch the wallet to account #1, sign in, approve. **Holder** page: switch back, select *Receive credential*, then *Register*, then *Check in*, then *Export backup*. **Verifier** page: *New verification request*, then consent and present. **Issuer**: *Revoke*. Presenting and checking in now fail.
5. **Changing roles or accounts:** switching wallet account or chain drops the server session, so you sign in again. Add more issuer operators by editing `ISSUER_OPERATOR_ADDRESSES` in `.env.local` (comma-separated) and restarting `npm run dev`.

**Reload behaviour:** the holder's credential bundle lives only in the tab's memory, and the server deletes its copy at pickup. A reload forgets it, so export the encrypted backup first and import it after reloading. MetaMask caches nonces per chain. If you restart `npm run chain`, use MetaMask's *Clear activity tab data* for the account.

Without an injected wallet, the UI says so and does not pretend to sign. Use `npm run demo` instead.

## Registry administration (local)

```bash
npm run admin -- status                    # issuer signer, active flag, epoch
npm run admin -- remove-issuer             # removeIssuer: all its credentials become IssuerInactive, permanently
npm run admin -- add-issuer                # re-add: new epoch; old credentials stay invalid, new issuance works
npm run admin -- revoke 0x<commitment>     # adminRevoke: explicit, evented admin override
npm run admin -- record 0x<commitment>     # public on-chain record and status
```

The CLI signs as Hardhat dev account #0, the registry admin set by `npm run deploy`, and refuses to run on any chain other than 31337.

## Smart-account holders (EIP-1271)

The holder can be a contract wallet (Safe, ERC-4337 account, passkey wallet). The SIWE sign-in and the presentation proof are accepted when the holder contract's `isValidSignature` approves them. Registration and the gated action are calls made *through* the wallet, so `msg.sender` is the contract. `contracts/testing/SimpleSmartWallet.sol` is a minimal test fixture, and `test/unit/smart-wallet.test.ts` runs the full flow with it.

## Account recovery (lost wallet)

On the **Holder** page, from the new wallet, tick *This replaces a credential held by a wallet I lost* and enter the lost wallet's address. The issuer sees a recovery warning, re-verifies the applicant, and approves. Approval first shuts down every live credential of the lost wallet: registered ones are revoked on-chain; issued-but-unregistered ones have their authorization cancelled (`cancelAuthorization`), so a thief holding the old bundle can never register it. Only then is a credential issued to the new wallet. If any step fails, nothing new is issued and the request stays pending.

The lost wallet cannot sign anything, so recovery rests entirely on the issuer re-verifying the person. In this prototype that means the simulated operator's judgement.

## Issuer key rotation

```bash
npm run rotate-keys                      # retire both keys: past credentials stay valid, new ones use new keys
npm run rotate-keys -- --credential      # only the Ed25519 credential key (new did:key)
npm run rotate-keys -- --evm             # only the EVM attestation key (new signer authorized on-chain)
npm run rotate-keys -- --compromised     # old key(s) compromised: everything they signed is rejected;
                                         # a compromised EVM signer is removed from the registry
```

The trust policy (format v2) lists every key of the issuer with its lifecycle (`active`, `retired`, `compromised`). Retired EVM keys stay in `.env.local` only to revoke the records they authorized. Restart the app after rotating. The issuer refuses to issue with keys that are no longer active in the policy (`ISSUER_KEY_NOT_ACTIVE`). The issuer page shows every key and its status.

## Reset

```bash
npm run reset            # removes .data/, deployments/localhost.json, demo/test state
npm run reset -- --keys  # also deletes .env.local and the trust policy (new issuer identity)
```

Restarting `npm run chain` wipes the in-memory chain. After a reset, every previously issued credential or exported bundle is unusable. Its registry address and on-chain record no longer exist, so verification reports `WRONG_DEPLOYMENT` or `NOT_REGISTERED`. Deleting local files never erases history on a persistent or public blockchain.

## Repository layout

```
contracts/                 CredentialRegistry.sol, DemoGate.sol
src/app/                   UI pages (/, /holder, /issuer, /verifier) and API route files
src/lib/shared/            browser-safe protocol code: constants, commitment, did:pkh, EIP-712, VC profile, bundle crypto
src/lib/server/            server-only: config, db, http guards, auth (SIWE), issuer, verifier, credential, did:key, trust
src/generated/contracts.ts ABI module generated from artifacts (npm run compile)
scripts/                   setup, deploy, demo, reset, ABI generation
test/contracts/            Hardhat tests        test/unit/   Vitest tests (unit + API integration)
docs/                      architecture, credential profile, security & privacy
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, diagrams, data placement, contract/API responsibilities, on-chain vs off-chain verification
- [docs/CREDENTIAL-PROFILE.md](docs/CREDENTIAL-PROFILE.md): credential profile, DIDs, trust configuration, commitment encoding and test vector, EIP-712 structures, challenge format, revocation rules
- [docs/SECURITY.md](docs/SECURITY.md): trust assumptions, threat model, privacy limits, status-privacy tradeoff, roadmap, extension to other credential types
- [HANDOFF.md](HANDOFF.md): current state, decisions, verified commands
