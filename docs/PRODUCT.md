# decID: product brief

> **Prove you're 21. Nothing else.**
> Reusable, privacy-preserving age verification. A person gets verified once, then answers "are you 21+?" with one tap, online or at a door. The business gets a yes/no and a signed compliance receipt. It never holds a name, birth date or ID photo.

This is a working prototype for a class startup pitch. Its limits:
- The issuer is simulated, the data is synthetic and the chain is local.
- It has not been audited.
- It is not a compliance product.

The "Market" and "Business model" sections contain assumptions. They are labelled as such and have not been validated with customers.

## The problem

Age checks are now mandated in many places:
- The UK Online Safety Act's age-assurance duties took effect in July 2025.
- In June 2025 the US Supreme Court upheld Texas's age-verification law for adult sites (*Free Speech Coalition v. Paxton*).
- US states that allow alcohol to be shipped directly to consumers require the seller to check the buyer's age at sale and at delivery.

The common way to comply is to upload a photo of an ID plus a selfie. That creates a stockpile of exactly the data attackers want:
- **Discord, October 2025.** About 70,000 government ID photos, submitted for age appeals, were exposed through a third-party support vendor ([The Record](https://therecord.media/discord-government-docs-exposed-breach)).
- **Tea, July 2025.** About 13,000 selfies and photo IDs collected for account verification leaked from an exposed storage bucket ([AP via 13abc](https://www.13abc.com/2025/07/26/tea-an-app-women-anonymously-talk-about-men-they-date-has-been-breached-user-ids-exposed/)).

Businesses don't want this data. They want a defensible "yes, we checked."

## The product

| Piece | Who uses it | What it does | Where in the demo |
| --- | --- | --- | --- |
| **decID Pass** | Consumers | A wallet on the phone. Verified once by a trusted issuer. Holds yes/no age attributes (18+, 21+), not a birth date. Shows who is asking and exactly what they will learn, then shares one answer. | `/pass` |
| **decID Verify** | Businesses | An API and SDK: create a check, send the customer to a link or QR code, read the answer and a signed receipt. | `/api/v1/*`, `src/sdk/decid-verify.ts` |
| **Business dashboard** | Compliance and ops | Volume, outcomes, median time to answer, an intact signed receipt chain, and the full list of stored fields (none personal). | `/business` |
| **Hopline** (demo customer) | — | An online drinks shop with a 21+ checkout. | `/demo/shop` |
| **Neon Hall** (demo customer) | — | A venue door kiosk: scan the QR code, the screen turns green or red, and staff compare a 4-letter match code. | `/demo/door` |

## Why it is different

1. **The business keeps nothing.**
   - It receives `{ ageOver21: true }`, a match code and a receipt.
   - Its stored record has 16 fields, and the dashboard lists every one: ids, times, policy, outcome, issuer name, receipt number.
   - None of them can hold personal data, so there is nothing to leak.
2. **Signed, tamper-evident compliance receipts.**
   - Every check is an Ed25519-signed receipt, hash-chained per business. The public key is published at `/api/v1/receipt-keys`.
   - A business can show a regulator that it checked, without holding the evidence that usually gets breached.
   - Each receipt chain is checkpointed on a public blockchain, so not even decID can rewrite or trim a business's history after the fact.
3. **The issuer can't track you.**
   - Validity and revocation come from a public registry on a blockchain, not from calling the issuer.
   - The DMV or bank that vouched for someone never learns where the Pass was used.
4. **One Pass, online and in person.**
   - The same credential works at a web checkout and at a door.
   - At a door, the 4-letter match code shown on both the phone and the kiosk stops someone from relaying a friend's phone.
5. **Open standards, no lock-in.**
   - The credential is a W3C Verifiable Credential with SD-JWT selective disclosure (RFC 9901).
   - Independent libraries accept it (tested in `test/unit/interop.test.ts`).
6. **Nothing to install for the business, nothing crypto for the person.**
   - The Pass creates its own key on the device.
   - The one on-chain registration is gas-sponsored, so nobody needs a wallet extension or tokens.

## Competitors and alternatives

| Alternative | How it works | Gap decID targets |
| --- | --- | --- |
| ID upload + selfie vendors (Yoti, Persona, Veriff, Onfido, Jumio) | Per-check document scan and face match | Each check moves ID images to a vendor, and the honeypot risk shown by the Discord leak. Strong at first-time verification, and could be *issuers* for decID. |
| Facial age estimation | A model estimates age from a selfie | No document, but probabilistic. Weak near the 21 threshold and needs a camera every time. |
| Mobile driver's licences in Apple Wallet / Google Wallet | ISO 18013-5/-7 mDL with selective disclosure | The closest alternative, and good for users. Availability is per state and per platform. decID is the issuer-agnostic layer and gives the business receipts and a dashboard. Supporting mDL as an input is on the roadmap. |
| Bouncer looks at an ID | Visual check | Fake IDs, no record, and staff see the address. |

**Positioning:** decID does not compete with identity-proofing vendors. It reuses their one-time verification so that the *checks* (the frequent, risky part) stop moving personal data.

## Business model (assumptions, not validated)

- **Businesses pay per verified check.**
  - Illustrative price: $0.05–$0.15. ID-upload checks are commonly priced around $1 or more, but verify against current public pricing before quoting.
  - Volume tiers for venues.
  - Compliance export (the receipt chain) on a paid plan.
- **Consumers pay nothing.** Issuers are paid per issuance, or issuance is bundled with an existing KYC relationship (bank or telecom).
- **First customers (beachhead): online alcohol and cannabis delivery, then venues.**
  - Both have a hard legal age gate, a check at every transaction, and a checkout where drop-off from ID upload costs revenue.

## Risks and open questions

- **Cold start:** a business only adopts if users already have Passes, and users only get one if businesses accept it.
  - Mitigation: let the business's own first check *create* the Pass through a partner issuer, so the user verifies once and every later check is one tap.
- **Regulatory acceptance:** will a regulator accept a credential-based check plus a receipt? This depends on the jurisdiction. For example, UK Ofcom guidance lists digital identity services as an accepted method.
- **Issuer trust:** decID's value depends on reputable issuers signing up.
- **Device loss and recovery:** the prototype supports reissue to a new wallet (revoking the old one), but the consumer UX for it is basic.
- **Chain choice:** a production deployment needs a cheap, credible public chain or a permissioned registry. Privacy-preserving revocation lists are on the roadmap.

## Roadmap

1. Accept mDL (ISO 18013-5) and EUDI wallet credentials as inputs.
2. Unlinkable presentations (BBS+ or SD-JWT batch issuance), so two businesses can't correlate the same Pass.
3. Native mobile Pass with secure-enclave keys.
4. A POS / door-scanner integration kit, and a Shopify checkout plugin.
5. Independent security audit, then a pilot with one online alcohol retailer.

## What is real in this prototype

- **Real cryptography:**
  - Ed25519 credentials and receipts;
  - SD-JWT disclosures;
  - EIP-712 / SIWE holder signatures;
  - a Solidity registry on a local chain.
- **Real HTTP flows:** the demo businesses' backends call decID Verify with API keys through the SDK.
- **Tested end to end** in Chromium by `npm run test:product`:
  - Pass onboarding;
  - Hopline checkout;
  - matching door codes;
  - an under-21 refusal;
  - the dashboard receipt chain;
  - axe accessibility audits.
- **Tested elsewhere:** 130 unit and integration tests, 37 contract tests, fuzzing, and a 53-attack red-team run.
