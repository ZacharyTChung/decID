# decID product plan

**Prove you're 21. Nothing else.**

- **Try it (hosted prototype):** https://claude.ai/artifact/SE7SVzFQFUQpWQJm4su763. It runs entirely in the browser, so there is nothing to install.
- **Source:** https://github.com/ZacharyTChung/decID
- **Built with:** Claude Code, Anthropic's AI coding agent. The exact prompts are in [PROMPTS.md](PROMPTS.md).

decID is reusable, privacy-preserving age verification:
- A person gets verified once by a trusted issuer, into **decID Pass** on their phone.
- After that, any shop or venue can ask "are you 21+?". The person sees exactly what will be shared and taps once.
- The business gets a yes/no answer and a signed compliance receipt. It never receives a name, birth date, address or ID photo, so it has nothing to leak.

## Core features

| Feature | For | What it does |
| --- | --- | --- |
| **Verify once** | Consumers | A trusted issuer checks the person once and signs a credential that lives on their phone. The credential stores yes/no answers (18+, 21+), not the birth date. Activation puts a random-looking code on a public registry. |
| **One-tap age check with consent** | Consumers | Shows who is asking, the question, what they will learn and what they will not see. Sharing reveals only the one requested answer, signed for that request only. |
| **Online checkout** (Hopline demo) | Online sellers | "Verify age with decID" at checkout. The seller's backend creates a check through the decID Verify API and reads `{ ageOver21: true }`. |
| **Venue door** (Neon Hall demo) | Bars, clubs, venues | A kiosk that turns green or red. A 4-letter match code shows on the kiosk and the guest's phone, which stops someone using a friend's phone. |
| **Business dashboard** | Compliance and ops | Checks by outcome, verification time, recent checks, a signed hash-chained receipt record, and the full list of stored fields, none of them personal. |
| **Fraud protection** | Everyone | Refuses a borrowed credential, a revoked or lost Pass, a replayed answer, an expired request, or an answer meant for another business. |
| **Revocation** | Consumers, issuers | "Report this phone lost": the issuer revokes the Pass on the public registry, and every business refuses it from the next check on. |

## User stories

Each story lists its acceptance criteria and the automated test that checks them.

**Consumer (Alex, 34)**
1. *As a customer buying alcohol online, I want to prove I am over 21 without uploading my ID, so that my ID photo can't end up in a breach.*
   - The shop receives only `ageOver21: true`, a match code and a receipt.
   - It receives no name, birth date, ID number or wallet address.
   - Checked by `test:product` and `test:product-site` ("…and nothing personal").
2. *As a customer, I want to see exactly what a business will learn before I share, so that I stay in control.*
   - The consent screen lists "They will learn" and "They will not see" before anything is sent.
   - Decline sends nothing.
3. *As a guest at a club, I want to get in by tapping my phone, so that I don't hand my driver's licence (with my home address) to a stranger.*
   - The door turns green and shows the same 4-letter code as my phone.
4. *As a customer who lost my phone, I want my Pass revoked, so that nobody else can use it.*
   - After revocation every check is refused with "Credential revoked".
   - The issuer is not told where the Pass was used.

**Under-21 customer (Sam, 16)**

5. *As a 16-year-old, I want to be told before I share that the answer will be "no", so that I'm not surprised at the door.*
   - The Pass warns before sharing.
   - The business learns "not old enough" and nothing else.

**Business (Hopline, Neon Hall)**

6. *As an online alcohol seller, I want a few lines of code that tell me "21+: yes/no", so that I comply without building ID checks.*
   - Uses the SDK (`DecidVerify.createVerification` / `getVerification`) and the OpenAPI description in `docs/openapi.json`.
7. *As a venue manager, I want door staff to confirm the guest's phone matches the check, so that borrowed phones don't get in.*
   - Match codes are checked in both tests.
   - A borrowed credential is refused ("Credential belongs to someone else").
8. *As a compliance officer, I want proof that we checked every customer, so that we can show a regulator without storing ID data.*
   - Every check produces an Ed25519-signed receipt in a hash chain.
   - The dashboard shows "Chain intact".
   - An edited receipt is detected.

**Issuer (DMV, bank or telecom, simulated)**

9. *As an issuer, I want to vouch for a person once without tracking where they go, so that I'm not a surveillance hub.*
   - Businesses check validity on the public registry, never by calling the issuer.

## Core mechanics (in the hosted prototype)

The prototype runs decID's real code in the page:
- the issuer's credential signing;
- the Solidity registry and gate contracts, on a private in-page test network;
- the wallet's signed answer;
- the production verifier;
- the receipt chain.

Nothing is mocked. The only stand-ins are the simulated issuer and synthetic people.

1. **Identity verification and credential issuance (sign-up / authentication).**
   - The Pass creates its own device key.
   - The issuer signs a W3C Verifiable Credential bound to that key, and the Pass activates it on the registry.
   - Every later answer is signed with the device key, which is how decID authenticates the holder without a password or account.
   - *Try it:* on the phone, choose Alex, then **Verify me**. "Technical details" shows the device key and the registry entry.
2. **Privacy-preserving age check (selective disclosure with consent).**
   - A business asks one question. The Pass reveals only that one hidden claim and signs it for that request and that business.
   - The verifier checks:
     - the issuer's signature and that the issuer is trusted;
     - that the answer came from the credential's owner;
     - that the request is fresh and single use;
     - the live registry status.
   - *Try it:* **Hopline → Verify age with decID → Continue in decID Pass → Share**. Then try **Neon Hall** and compare the codes.
3. **Compliance dashboard (data visualization and tamper-evident records).**
   - Charts of checks by outcome and of verification time per check.
   - A recent-checks table and the signed receipt chain.
   - **Try it: edit a receipt as an insider** flips a stored receipt's outcome and recomputes its hash. The chain check still catches it, because only decID can sign.
4. **Fraud handling at scale.**
   - **Simulate a busy night** sends 12 synthetic guests through the door with the full real flow (issuance, activation, signed answer, verification, receipt).
   - It adds one guest showing a friend's credential and one Pass reported lost. Both are refused, and the dashboard and charts update live.

## How it was built (agile, with an AI agent)

The work ran as short build–test–review cycles. Each cycle ended with automated tests and a pushed commit (`git log` is the record):

| Sprint | Goal | Shipped |
| --- | --- | --- |
| 1 (Oct 22, early) | Working core | Smart contracts, credential and commitment libraries, issuer and verifier APIs, holder, issuer and verifier screens, headless end-to-end demo, docs |
| 2 (Oct 22) | Hardening | Browser UI test and CI, independent review fixes, issuer key rotation, account recovery, smart-account wallets, strict content security policy |
| 3 (Oct 22–23) | Prove it works | Fuzz and invariant tests (100% contract coverage), a 53-attack red-team run, accessibility audits, encrypted device storage, audit log, API spec, performance (51 ms → 20 ms) |
| 4 (Oct 23) | Privacy and evaluation | Selective disclosure, interoperability with independent libraries and W3C conformance, showcase site with an in-browser playground |
| 5 (Oct 23) | Turn it into a product | decID Verify API with signed receipts, decID Pass, Hopline and Neon Hall, business dashboard, one-command demo, end-to-end product test |
| 6 (Oct 23) | Shareable prototype | Rehearsal fixes, hosted in-browser prototype with charts, insider-tamper demo and busy-night simulation, product plan |

Ready to copy into a Trello board (lists → cards):
- **Done:** one card per row above, plus "Rehearsal fixes: Sam's name, refusal text".
- **Backlog** (from [PRODUCT.md](PRODUCT.md), Roadmap):
  - Accept Apple/Google Wallet and EU Digital Identity Wallet credentials.
  - Unlinkable presentations.
  - Native mobile Pass with secure-enclave keys.
  - Shopify checkout plugin and door-scanner kit.
  - Independent security audit.
  - Pilot with one online alcohol retailer.

## Quality evidence

| Check | Command | Result |
| --- | --- | --- |
| Hosted prototype, end to end in Chromium | `npm run test:product-site` | all checks pass: the full tour, charts, tamper detection, busy night, phone width, accessibility |
| Local product, end to end | `npm run test:product` | passes in CI |
| Unit and integration tests | `npm run test:app` | 132 passing |
| Contracts | `npm run test:contracts`, `test:fuzz` | 37 tests; fuzz and invariant properties; 100% coverage |
| Attacks | `npm run redteam` | 53 of 53 defenses held |

## Limits (said plainly)

- This is a prototype: the issuer is simulated and the people are synthetic.
- The hosted version runs on a private test network inside the page and resets on reload.
- The full version (`npm run product`) runs a local chain and server.
- It has not been audited. It does not verify real identities and makes no legal compliance claim.
