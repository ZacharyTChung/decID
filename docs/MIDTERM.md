# decID: BUAD 301 Midterm

**Prove you're 21. Nothing else.**

> **[Your name]** · BUAD 301 · Dr. Anthony Borquez · [class time]
> Prototype: https://claude.ai/artifact/SE7SVzFQFUQpWQJm4su763 · Code: https://github.com/ZacharyTChung/decID · Trello: [paste public link] · Deck: [paste link]

Items in **[brackets]** are for you to fill in: your own survey results, links and search screenshots.

---

## 1. Executive Summary

### 1.1 Product overview: what it is, what it does, why it's unique, why now

**What it is.** decID is reusable, privacy-preserving age and eligibility verification. A person is verified once into **decID Pass**, a wallet on their phone. After that, any business can ask one question, "Are you 21 or older?", and get a cryptographically signed **yes or no**. The business never sees a name, birth date, address, ID number or photo.

**What it does.** It has three parts:
- **decID Pass (consumers).** You verify once, either from the driver's licence already in Apple or Google Wallet or through a trusted issuer such as a DMV or bank. After that, you answer each request with one tap. You see exactly what will and won't be shared, can require Face ID or a fingerprint, and keep a log of every share on your own phone.
- **decID Verify (businesses).** An API plus a QR code or link for checkouts, doors and deliveries. The business gets:
  - the yes/no answer;
  - a 4-letter match code for in-person checks;
  - a signed compliance receipt;
  - fraud signals (a Pass handed back, fake or borrowed Passes);
  - a dashboard and a compliance assistant that can prove "order #4821 was age-checked" from the receipts.
- **Blockchain trust layer.**
  - A public registry records whether each Pass is valid or revoked. A business checks it without contacting the issuer, so the DMV never learns where you shop.
  - Each business's receipt history is anchored on-chain, so nobody can quietly edit or delete it, not even decID.

**What makes it unique.** No existing product combines all five of these:
1. **One fact, not the whole ID.** Businesses get "21+: yes". A licence scan or ID upload hands over everything printed on the card.
2. **Proof a regulator can check.** Signed receipts, anchored on a blockchain, can be verified by an auditor without access to decID's database.
3. **No honeypot.** decID and the business store no personal data, so there is nothing to breach.
4. **One Pass everywhere.** The same Pass works online, for delivery and at the door, and is created from the ID people already carry.
5. **Built-in abuse resistance:**
   - one licence backs one active Pass, so a licence can't be lent out;
   - optional Face ID;
   - a matching code at the door;
   - instant revocation of lost phones.

**Why now.**
- **The law now requires it.**
  - The UK Online Safety Act's age-assurance duties took effect in July 2025.
  - The US Supreme Court upheld Texas's age-verification law in *Free Speech Coalition v. Paxton* (June 2025).
  - US states that allow alcohol delivery require an age check at sale and at delivery.
- **The current method leaks.**
  - About 70,000 government ID photos from Discord's age appeals were exposed through a vendor in October 2025.
  - About 13,000 IDs and selfies leaked from the Tea app in July 2025.
- **The technology just arrived.** Mobile driver's licences are in Apple and Google Wallet (Apple added passport-based Digital ID in November 2025). The browser standard that lets a website ask a phone's wallet for an ID shipped in Chrome 141 and Safari 26 in 2025. decID uses it.

### 1.2 Industry overview and research

**Market size (TAM, SAM, SOM)**

| Layer | Definition | Size | Source / basis |
| --- | --- | --- | --- |
| **TAM** | Global digital identity solutions | **$44.2B (2025) → $132.1B (2031), 20.0% CAGR** | MarketsandMarkets, Digital Identity Solutions Market (2025) |
| **SAM** | Age verification software and services | **≈ $1.8B (2025) → $7.2B (2034), 16.5% CAGR** (software only); broader e-commerce age-verification estimates run up to $15.8B | Marketintelo, Age Verification Software Market (2025); Marketintelo, Age Verification for E-commerce Market. Smaller publishers: estimates vary widely by definition |
| **SOM (3-year target)** | US online alcohol and cannabis delivery plus 21+ venues | **≈ $2–4M ARR** | Bottom-up (assumptions below) |

**SOM bottom-up (assumptions, to be validated):**
- **Online and delivery:** 40 retailers × 150,000 checks a year × $0.10 = **$0.6M**.
- **Venues:** 600 bars and clubs × 25,000 entries a year × $0.08 = **$1.2M**.
- **Compliance plan:** 300 businesses × $150 a month for receipts, export and assistant = **$0.54M**.
- **Issuer onboarding:** 100,000 Passes × $1 = **$0.1M**.
- **Total ≈ $2.4M ARR.**

Cross-checks: industry estimates put the e-commerce share of alcohol sales at ~3.5% (IWSR 2025), and the online channel grows ~3% a year to 2029. The age-check volume is driven by regulation more than by sales growth.

**Revenue opportunities**
1. **Per-check fees** paid by businesses ($0.05–$0.15; ID-upload vendors commonly charge $1 or more per check).
2. **Compliance subscription:** receipts, auditor export, fraud signals and assistant.
3. **Issuer fees:** banks, DMVs and clinics paid per Pass issued, or bundled with existing KYC.
4. **Adjacent verticals:** cannabis, vapes, gambling, adult sites, car rental (licence plus 25+), event tickets bound to one Pass, and **health facts** such as vaccination clearance for schools (prototype built).

**Trends**
- Age-assurance laws are spreading (UK OSA; Texas *Paxton*; US state social-media and adult-site laws).
- Breach fatigue, as the ID-upload honeypots above show.
- Mobile driver's licences and digital IDs in Apple and Google Wallet, plus the 2025 browser standard that lets websites ask a phone's wallet for an ID.
- Privacy-preserving technology going mainstream: selective disclosure (SD-JWT), passkeys and zero-knowledge proofs.

**Competition**

| Competitor | Approach | Gap decID fills |
| --- | --- | --- |
| Yoti, Persona, Veriff, Jumio, Onfido | ID photo plus selfie at each check | Stockpiles ID images (breach risk); ~$1+ per check; no reusable credential |
| Facial age estimation (Yoti and others) | AI guesses age from a selfie | Probabilistic and weakest near the 21 cutoff; camera needed every time |
| TruAge (NACS / Conexxus) | Cashier scans licence; 4 fields read (licence #, state, expiry, birth date) into a token | Built for in-store tobacco and alcohol; the licence scan still reads birth date and licence number; no consumer-held, reusable credential online |
| Apple / Google Wallet ID | Phone-wallet ID with selective disclosure | Great for users, but the business gets no compliance record. decID builds on it, using the wallet ID as an input |
| Bouncers, ID scanners (IDScan.net, Intellicheck) | Staff look at or scan the card | Fake IDs, the full ID exposed, no tamper-proof record |

**Positioning:** decID doesn't replace identity-proofing vendors or wallets. It reuses their one-time verification, so that the frequent part, the *checks*, stops moving personal data, and the business gets proof.

### 1.3 SWOT Analysis

**Strengths**
- Shares one fact instead of a whole ID: privacy by design, nothing to breach.
- Signed receipts anchored on-chain: proof for regulators that even decID can't rewrite (demonstrated live).
- One Pass for online, delivery and in person, with door match codes and Face ID.
- Built on open standards (W3C Verifiable Credentials, SD-JWT, ISO mobile licences, WebAuthn passkeys), so no lock-in.
- Working prototype with 170+ automated tests and a 68-attack security test campaign, all passing.

**Weaknesses**
- Two-sided cold start: businesses want users with Passes; users want places that accept them.
- Depends on trusted issuers (DMVs, banks) and on wallet providers registering verifiers.
- No real issuer partnerships yet; the prototype uses simulated issuers and synthetic data.
- Not audited; regulators haven't yet ruled on credential-based checks in most US states.
- Single founder; limited legal and compliance expertise.

**Opportunities**
- New laws are creating forced demand (age checks for alcohol delivery, adult sites, social media, gambling).
- Mobile-licence and passport digital IDs are growing fast; decID turns them into a business-ready check.
- Adjacent verticals: cannabis, vapes, tickets, car rental, and health clearances (vaccinations, sports physicals).
- Partnering with delivery platforms or point-of-sale providers to get many merchants at once.
- Its fraud-detection and compliance tools can be sold to existing ID vendors' customers.

**Threats**
- Apple and Google could add receipts and dashboards themselves.
- Incumbents (Yoti, Persona, TruAge) have distribution and regulator relationships.
- Regulatory fragmentation: each state and country defines acceptable methods differently.
- Public scepticism of "blockchain" and of any age-verification mandate.
- Security incidents affecting the whole category (even unrelated breaches lower trust).

### 1.4 Customer feedback (quantitative and qualitative)

**Secondary research (published surveys):**
- **US, 2026 (reported by Fortune):** 79% worry about privacy and data security when verifying age; 66% cite identity-theft risk; 90% still say gambling sites should face strict age checks. People want checks, but not to hand over their ID.
- **US, 2023 (cited in an arXiv 2026 review):** two-thirds are not comfortable uploading a government ID to social-media companies.
- **UK, July 2025 (LexisNexis):** 52% would abandon an online purchase if asked for a selfie or liveness test.
- **UK, 2022 (YouGov):** 78% would not upload an ID for age verification, citing distrust of companies (64%) and fear of data ending up in the wrong hands (63%).
- **Experiment (n = 99, mock gambling site):** government-ID upload made up to 60.5% of users quit, versus 95.2% completion for a checkbox. That's lost revenue for businesses.

**Primary research.** Run these yourself and fill in the brackets.

*Quantitative survey (Google Forms, target n ≥ 30 students and adults 21+).* Questions:
1. In the last 12 months, how often were you asked for ID to buy alcohol, enter a venue or use an age-restricted site? (Never / 1–5 / 6–20 / 20+)
2. How comfortable are you uploading a photo of your driver's licence to a website? (1–5)
3. Have you ever abandoned an online purchase because of an ID or selfie check? (Yes / No)
4. Would you use an app that proves "21+" without sharing your name, birth date or photo? (1–5)
5. Which matters most: privacy, speed, or not carrying a physical ID?
6. Would you be more comfortable if every check left a record you could see on your phone? (1–5)

Results: **[n = __ ; % comfortable uploading ID (4–5) = __ ; % abandoned a purchase = __ ; % likely to use decID (4–5) = __ ; top priority = __ ]**

*Qualitative interviews (5–8 conversations).*
- **Who:** 2–3 bartenders, door staff or bar managers; 1–2 owners of liquor stores or alcohol-delivery businesses; 2–3 students over 21.
- **Prompts:**
  - "Walk me through the last time you checked or showed an ID."
  - "What goes wrong: fake IDs, lines, disputes?"
  - "If a regulator asked you to prove you checked a customer last Friday, what would you show?"
  - "What would make you trust a phone-based check?"
- **Record:** quotes and patterns. **[Insert 3–5 quotes, e.g. "We have no record of who we checked; it's our word."]**

**Insight this supports (update with your data):** consumers support age checks but resist handing over ID data, and businesses lack proof that they checked. decID targets exactly that gap: one fact for the customer, signed proof for the business.

---

## 2. Legal

**Trademark search (USPTO).** Search the trademark search system at https://tmsearch.uspto.gov for:
- "DECID";
- "DEC ID";
- "DECIDE" in classes **9** (software), **42** (SaaS, identity verification) and **45** (identity verification services).

**[Insert results and a screenshot.]**

Risk note: "decID" is close to the common word "decide". Expect possible likelihood-of-confusion issues with existing "DECIDE…" marks in class 9 or 42. Backup names: **PassProof**, **OneFact ID**, **ProvaPass**.

**Domains.** Check at a registrar (Namecheap, Squarespace Domains, GoDaddy):
- decid.com
- decid.io
- decid.app
- getdecid.com
- usedecid.com
- decidpass.com
- decid.id

**[Insert availability and price for each.]** An automated DNS lookup from the build environment was inconclusive, so treat this list as unverified.

**Social handles.** Check @decid, @decidpass and @getdecid on Instagram, Facebook, TikTok and X by visiting each profile URL (e.g. instagram.com/decid). **[Insert results.]**

**Other legal considerations**
- **Privacy law:** CCPA/CPRA (California); state biometric laws such as Illinois BIPA if face matching is added; GDPR or the UK GDPR if offered abroad.
  - decID's design minimises data, but businesses still need privacy notices.
  - The per-check fraud pseudonym (deleted after 48 h) must be disclosed.
- **Age-verification rules:**
  - state alcohol-delivery laws, which require a check at sale and at delivery;
  - the UK Online Safety Act (Ofcom accepts digital identity services);
  - state laws for adult sites and social media.
- **Health data:** the health-records feature would trigger HIPAA if run with real covered entities. The prototype uses synthetic data only.
- **Liability and terms of service:** a business relies on decID's answer, so the terms need clear limits of liability and issuer agreements.
- **Blockchain:** no tokens and no money handled, so no securities or money-transmission issues. Gas fees are paid by decID.

**What could be protected**
- **Trademark:** the name "decID", the "Prove you're 21. Nothing else." tagline, and the logo.
- **Copyright:** the source code, the UI designs and the receipt and receipt-export formats (copyright covers the code and documents, not the ideas).
- **Patent (consult an attorney; software patents are hard to get after *Alice*):** possible claims include:
  - Anchoring per-business, signed age-check receipt chains on a blockchain so the operator itself can't rewrite them.
  - "One licence, one active Pass", using a keyed hash of the mobile licence's device key to stop a licence being lent out.
  - Detecting a Pass handed back through a queue with a per-business, per-day pseudonym that can't be linked across businesses.
  - A door match code derived from the holder's signature, which both the kiosk and the phone display.

---

## 3. Product Plan

### 3.1 Core features and user stories

**Core features**
1. **Get a Pass once:** from the licence in the phone's wallet, or through a trusted issuer.
2. **One-tap answer:** the phone shows what is and isn't shared; the business gets yes/no plus a signed receipt.
3. **In-person checks:** a door QR code, a 4-letter match code on both screens, and optional Face ID / fingerprint.
4. **Business dashboard:** checks, outcomes, receipts, an auditor export, and Data & privacy.
5. **Fraud signals:** a Pass handed back, fake, borrowed or revoked Passes, and unusual rates.
6. **Compliance assistant:** "Was order X age-checked?", "Is our record intact?", weekly report.
7. **Blockchain trust layer:** a revocation registry, plus anchoring of each business's receipt chain.
8. **Health facts (demo):** share one clinic-signed fact, such as measles immunity, never the record.

**User stories**
- As a **21-year-old buying beer online**, I want to prove I'm 21 without uploading my licence, so my ID can't leak.
- As a **student entering a bar**, I want to scan once and walk in, so I don't hand my ID (with my address) to a stranger.
- As a **16-year-old**, I'm told "No" before I share, and the bar only learns "not old enough", nothing else about me.
- As a **liquor delivery business**, I want a signed receipt for every order, so I can prove compliance to a regulator.
- As a **bar manager**, I want an alert when the same Pass comes back through the line, so I can stop pass-backs.
- As a **compliance officer**, I want to ask "was order HL-4821 age-checked?" and get the proof instantly.
- As someone who **lost their phone**, I want my Pass revoked, so nobody else can use it.
- As a **college health office**, I want to confirm measles immunity without receiving anyone's medical records.

### 3.2 Agile process (Trello)

**Trello link: [paste public board link: Board menu → Share → "Link to this board", visibility Public].**

Suggested structure, matching how the work actually went:
- **Lists:** Backlog / Sprint 1 / Sprint 2 / Sprint 3 / Sprint 4 / Testing / Done.
- **Sprint 1, core protocol:** credential and registry contracts; issuer, holder and verifier flows; security tests.
- **Sprint 2, product:** decID Pass wallet; decID Verify API; Hopline checkout and Neon Hall door demos; business dashboard; hosted prototype.
- **Sprint 3, feedback-driven:**
  - UI redesign after feedback that it "looked AI-generated";
  - Apple-style polish;
  - on-chain receipt anchoring;
  - auditor export.
- **Sprint 4, depth:**
  - government ID from the phone wallet;
  - fraud signals, Face ID unlock and the compliance assistant;
  - health records;
  - a clearer demo licence after user confusion.
- **Each card:** a user story, acceptance criteria ("door shows the match code on both screens") and the test that proves it.

### 3.3 Prototype and core mechanics

**Prototype link:** https://claude.ai/artifact/SE7SVzFQFUQpWQJm4su763. It was built with Claude Code, an AI development platform similar to Lovable, as the assignment allows. Full source: https://github.com/ZacharyTChung/decID.

**Core mechanics.** All of these are functional; the course requires two.
1. **Credential authentication (user authentication).** The Pass holds a credential signed by an issuer and bound to the phone's own key. Each answer is a signature for that one request. The verifier checks:
   - the issuer's signature;
   - that the Pass belongs to this phone;
   - its live status on the blockchain registry.

   Copied, edited or revoked Passes are refused.
2. **Verification flow with signed receipts.** A business creates a request → the person approves on the phone → the business gets the answer and a signed receipt chained to the previous one and anchored on-chain. The prototype lets you attack it live ("Rewrite history as the operator"), and the blockchain anchor catches it.
3. **Data visualisation:** a dashboard with outcome charts, verification times, receipt-chain status and a Risk page.
4. **Chat interface (compliance assistant):** answers questions from the business's own signed records and cites the receipts. Its answers are computed, not generated, so it can't make up a number.
5. **Fraud signals (smart recommendations):** rules plus statistical anomaly tests flag pass-backs, fake, borrowed and revoked Passes, and unusual rates.
6. **Biometric unlock:** Face ID or fingerprint through passkeys (real in the full app, simulated in the hosted prototype).

**How it reflects course principles:**
- **Customer-problem first:** businesses need proof; people don't want to hand over ID.
- **MVP and iteration:** each round of feedback (the UI "looks AI-generated"; the "test wallet doesn't work") produced a redesign.
- **Defensibility:** the receipts and the blockchain anchoring are the moat.
- **Wedge market:** alcohol delivery and venues have a legal mandate at every transaction.

**Exact prompts used:** see Appendix A.

---

## 4. Investor Presentation

10–12 slides, 5 minutes. A Lovable prompt to generate the deck is in `docs/PITCH-DECK-PROMPT.md`. **Deck link: [paste].**

---

## Appendix A: Exact prompts used to build the prototype (Claude Code)

Key prompts, in order (short status messages such as "continue" or "its done" are omitted; the full early list is in `docs/PROMPTS.md`):
1. *[Initial specification: decentralized identity prototype: Holder / Issuer / Verifier, Next.js, local blockchain, verifiable credentials, with security constraints (synthetic data only, no real keys or funds).]* See `docs/PROMPTS.md` for the full text.
2. "dont build it in the wandr repo create a new repo and work there"
3. "continue"
4. "you can push it and keep building using the cloud credits. you can name it decid"
5. "keep going on roadmap items and just building and improving"
6. "run your own version of a mock test and find different ways to test the identity verification"
7. "run tests yourself determine the actual functionality and if it could actual be used in the real world and actually work. maybe build out some sort of interface or site in which all of this can be seen"
8. "if this had to be presented and shown as a startup idea, how would you make it unique and an actual product. … I dont want you to build the presentation itself but the product and make sure its demonstrable"
9. "okay my only issue with this right now is that you can just instantly tell from the ui and ux that this is ai generated. work way harder and search for good ui/ux examples for products like this as well as ui/ux for products in general"
10. "get the ui to look a bit better such as matching a bit of apple's simplicity a bit more … also just keep building and improving the overall workings of this and its ability on the blockchain and such."
11. "okay if you were to buy alcohol online and you had to be present with id for the pickup, how could this solve that … does decid solve issues like this parallel to other fields/areas."
12. "so how does decid differ from lets say truage or other existing apps … also I would like it to actually work with your government id or things of sort"
13. "for door checks how does decid defend against fakes and how can it use things like biometrics to determine that it is in fact you"
14. "what are the clear benefits of this over just using traditional ids and verifications. how is decid revolutionary and how does it take advantage of the blockchain and ai"
15. "continue building and improving decid. how can decid already prevent fraud detection and utilize biometrics and compliance assistance. build those things"
16. "… the test wallet thing doesn't work so I dont get what im supposed to do. maybe find a way to get this to work for health records as well? maybe touch up on the ui a little bit more as well?"
17. "okay do ui first and then health records"
18. "okay can you get a fully complete version that would work well and good for a demo"
19. "get decid absolutely finished and ready for a demonstration …"

## Appendix B: Sources

- MarketsandMarkets, *Digital Identity Solutions Market* (2025): https://www.marketsandmarkets.com/Market-Reports/digital-identity-solution-market-247527694.html
- Marketintelo, *Age Verification Software Market* (2025): https://marketintelo.com/report/age-verification-software-market/amp
- Marketintelo, *Age Verification for E-commerce Market*: https://marketintelo.com/report/age-verification-for-e-commerce-market
- IWSR e-commerce outlook (via The Rum Lab): https://therumlab.com/iwsr-online-alcohol-sales-forecast-adjusted-as-growth-slows/
- Fortune (2026), Americans and age-verification laws: https://fortune.com/2026/03/27/age-verification-laws-americans-survey-easily-circumventable/
- arXiv (2026), *Assessing Age Assurance Technologies*: https://arxiv.org/pdf/2603.25695
- LexisNexis Risk Solutions UK (July 2025): https://risk.lexisnexis.co.uk/about-us/press-room/press-release/20250725-idv-checks-concerns
- YouGov via Global Dating Insights (2022): https://www.globaldatinginsights.com/news/yougov-survey-reveals-flaws-in-governments-plans-for-age-verification-on-adult-content/
- IETF workshop paper, user responses to age-verification architectures: https://datatracker.ietf.org/doc/slides-agews-paper-measuring-user-responses-to-age-verification-architectures-evidence-from-a-deceptive-online-experiment/
- The Record, Discord ID exposure (Oct 2025): https://therecord.media/discord-government-docs-exposed-breach
- TruAge, how it works: https://truage-static.thinksys.com/how-truage-works
- Chrome, Digital Credentials API: https://developer.chrome.com/blog/digital-credentials-api-shipped
