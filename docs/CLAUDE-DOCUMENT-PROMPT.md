# Prompt for Claude: write my BUAD 301 midterm document for decID

Copy everything below the line into a new Claude chat. Fill in the [BRACKETS] first, or leave them for Claude to mark as "to fill in".

---

You are helping me write my **BUAD 301 Midterm document** (USC, Dr. Anthony Borquez) for my startup, **decID**.

- Write a complete, polished, submission-ready document that follows the assignment structure below exactly, with clear headings matching each rubric item and its point value.
- Use the product facts, research and sources I give you. Do not invent statistics, survey results, quotes, trademark results or domain availability.
- Where I haven't supplied data that only I can collect (my own survey results, interview quotes, USPTO/domain/social-handle results, Trello link), write the section fully but insert clearly marked placeholders like **[INSERT: …]**, so I can fill them in.
- Cite sources inline (author/publisher, year) and include a Sources section with the URLs I provide.
- Tone: professional and confident, written in the first person as the founder, concise but specific.
- Aim for about 8–12 pages, plus a separate one-page Individual Reflection at the end, under its own heading so I can split it into its own file.

## About me and the links
- Name: [YOUR NAME] · Class time: [CLASS TIME, e.g. 6pm]
- Prototype (deployed, public): https://zacharytchung.github.io/decID/ (also at https://claude.ai/artifact/SE7SVzFQFUQpWQJm4su763)
- Source code: https://github.com/ZacharyTChung/decID
- Pitch deck link: [DECK LINK] · Trello board (public): [TRELLO LINK]
- Built with: **Claude Code** (an AI development platform; the assignment allows "Lovable or any other similar AI platform such as Claude Code or Codex"). I built it by prompting the AI; I did not hand-write the code.

## The assignment (follow this structure and rubric)

**Executive Summary (125 pts)**
- High-level overview: what the product is, what it does, how it's unique, why now (15)
- Overview and research of the industry: market size and TAM, revenue opportunities, trends, competition, using reliable sources (50)
- SWOT analysis, detailed (10)
- Customer feedback: quantitative and qualitative research showing the need (50)

**Legal (25 pts)**
- Preliminary trademark search (USPTO), website domain search, availability of IG/FB/TikTok/X names, and any other legal considerations
- What in the app could be trademarked, copyrighted or patented

**Product Plan (125 pts)**
- Core features and user stories (10)
- Trello link showing agile methodology (15)
- Prototype built with an AI platform:
  - reflects entrepreneurial principles, user research and product design strategy;
  - the exact prompts used;
  - at least two functional core mechanics;
  - a link to the prototype and a description of the core mechanics (100)

**Investor Presentation & Pitch Deck (125 pts):** a 10–12 slide deck, at most 5 minutes. In the document, include a short section summarising the deck's storyline slide by slide, plus the deck link.

**Individual Reflection (25 pts, at most one page):** what went right, what went wrong, what I'd do better, anything else relevant.

## The product: decID

**Tagline:** "Prove you're 21. Nothing else."

**One-liner:** decID is reusable, privacy-preserving age and eligibility verification. You verify once into decID Pass (a wallet on your phone). After that, any business can ask one question, "Are you 21 or older?", and get a cryptographically signed yes or no. It never sees your name, birth date, address, ID number or photo.

**The problem**
- To prove one fact (that you're 21+), people hand over their entire ID: name, address, birth date, ID number and photo.
- Online, businesses make people upload ID photos and selfies, which creates "honeypots" of ID images that get breached:
  - Discord, Oct 2025: about 70,000 government ID photos from age-verification appeals exposed through a third-party vendor (The Record);
  - Tea app, Jul 2025: about 13,000 selfies and IDs leaked.
- In person, a bouncer sees your home address, fake IDs get through, and there's no record of the check.
- Businesses that must legally check age (alcohol delivery, venues, cannabis, adult sites, gambling) have no tamper-proof proof that they checked.

**How it works: three parts**
1. **decID Pass (consumer, phone)**
   - **Getting a Pass, once:**
     - Either from the driver's licence already in Apple Wallet, Google Wallet or a state wallet app. decID asks the wallet for only "over 18" and "over 21", using the ISO 18013-7 / W3C Digital Credentials browser standard shipped in Chrome 141 and Safari 26 (2025).
     - Or through a trusted issuer (DMV, bank).
   - **Each request:** the phone shows who is asking, exactly what is requested ("21 or older") and what is NOT shared (name, birth date, address, ID number, photo). The person taps **Share** or **Don't share**.
   - The Pass holds yes/no answers (18+, 21+), not the birth date. Its key lives on the phone.
   - Optional **Face ID / fingerprint / PIN unlock**: a passkey is required for each share, and the biometric never leaves the phone.
   - An activity log kept only on the phone.
   - If the phone is reported lost, the Pass is revoked instantly.
2. **decID Verify (business)**
   - An API, SDK, link and QR code for online checkouts, delivery and door kiosks.
   - The business gets:
     - the yes/no answer;
     - a signed compliance receipt for every check, hash-chained into a log;
     - at a door, a 4-letter match code shown on both the kiosk and the phone, which stops someone relaying a friend's phone.
   - **Business dashboard:**
     - checks, outcomes and timing charts;
     - receipt-chain integrity;
     - an auditor export that a regulator can verify with decID's published keys, without access to decID's database;
     - a "Data & privacy" page listing every stored field (none can hold personal data).
3. **Blockchain trust layer**
   - **Public credential registry:** validity and revocation are checked on-chain, so the ID issuer (DMV or bank) never learns where you used your Pass.
   - **ReceiptAnchor:** each business's receipt chain is checkpointed on-chain. If anyone, even decID's operator, rewrites or deletes history, the stored log stops matching the chain. This is demonstrated live in the prototype.
   - People never see crypto: decID pays the transaction fees, with no wallet extension or tokens.

**Additional features (all built and working):**
- **Fraud detection (Risk page):** explainable rules plus statistics, not a black-box model. Each alert cites the signed receipts it's based on.
  - **Pass-back:** the same Pass admitted twice at a door within 30 minutes. The door screen warns "Same Pass admitted again".
  - **Repeat orders:** four or more orders from one Pass within an hour online (bulk buying for minors).
  - **Forgery probing:** three or more fake or edited Passes within 15 minutes.
  - **Borrowed and revoked Passes:** someone else's Pass, or one reported lost.
  - **Unusual rates:** Poisson tests for unusual under-age or traffic spikes.
  - **Privacy:** recognising a reused Pass uses a pseudonym that's stable at only one business for one day and is deleted after 48 hours.
- **Compliance assistant (chat interface):** answers questions like "How many checks today?", "Why were people refused?", "Was order HL-4821 age-checked?", "Is our record intact?", "Anything suspicious?" and "Write this week's compliance report". Every number is computed from the business's own signed receipts and cites them, so it can't hallucinate. It uses no language model, by design.
- **One licence = one Pass:** using the same licence to make a second Pass revokes the first, so an adult can't lend their licence to make Passes for minors.
- **Health records (demo):** the same model for health facts.
  - A demo clinic signs a record whose facts are each hidden behind a digest.
  - A college health office asks one question, "Measles (MMR) immunity on record?", and gets one verified yes or no. Never the record, diagnoses or dates.
  - Uses synthetic data only, since real health data carries HIPAA duties.

**Prototype demo flow** (the six guided steps in the prototype):
1. Add Alex's ID on the phone: Demo driver's licence → Alex Sample → Share.
2. Buy beer at Hopline (a fictional online liquor store). The checkout receives `{ageOver21: true}` plus a verified receipt and no personal data, then the order is placed.
3. Get into Neon Hall (a fictional venue door). The phone scans, the screen turns green ("OK TO ENTER"), and the same 4-letter code appears on the door and the phone.
4. Try Sam, who is 16. The phone warns "No" before sharing, and the door says "DO NOT ADMIT · Not old enough".
5. Share one health fact with Lakeside College (measles immunity).
6. Business dashboard:
   - "Simulate a busy night": 12 guests plus a pass-back, 3 fake Passes, a borrowed Pass and a revoked one, all caught.
   - The Risk page and the Assistant.
   - The tamper demo: "Rewrite history as the operator" is caught by the on-chain anchor.

**Technology (brief):**
- Next.js / React / TypeScript; Solidity smart contracts (CredentialRegistry, ReceiptAnchor) on a test chain.
- W3C Verifiable Credentials with SD-JWT selective disclosure (RFC 9901); Ed25519 signatures.
- ISO 18013-5/-7 mobile driver's licence verification; WebAuthn passkeys.
- The hosted prototype runs the real verification code and contracts in the browser on an in-page test chain.

**Quality and security:**
- 170+ automated unit and integration tests; contract tests plus fuzz and invariant tests with 100% contract coverage.
- Browser end-to-end tests with accessibility audits (WCAG 2.1 AA, zero serious violations).
- A red-team campaign: 68 of 68 simulated attacks blocked, including forged credentials, stolen Passes, replays, fake licences, phishing relays, Face ID spoofing and cross-business data access.

**Honest limits (say these plainly):**
- Issuers, people and the network are simulated, and the data is synthetic.
- Not audited, not a certified compliance product.
- Real government IDs need state trust roots (AAMVA's Digital Trust Service) and Apple/Google verifier registration.
- Face ID is simulated in the hosted version (real in the full app).

## Industry research to use (with sources)

**Market size:**
- **TAM:** digital identity solutions, **$44.2B (2025) → $132.1B (2031), 20.0% CAGR** (MarketsandMarkets, 2025). Fortune Business Insights and IMARC put 2025 at roughly $43–44B too.
- **SAM:** age-verification software, about **$1.8B (2025) → $7.2B (2034), 16.5% CAGR** (Marketintelo).
  - Broader "age verification for e-commerce" estimates reach $15.8B (2025). Smaller publishers' figures vary widely by definition, so say so.
  - Biometric identity verification: $8.88B (2025) → $17.81B (2030) (MarketsandMarkets).
- **SOM (bottom-up, my assumptions):** about **$2.4M ARR in 3 years**:
  - 40 online and delivery retailers × 150,000 checks a year × $0.10 = $0.6M;
  - 600 venues × 25,000 entries × $0.08 = $1.2M;
  - 300 businesses × $150/month compliance plan = $0.54M;
  - 100,000 Passes × $1 issuer fee = $0.1M.
- **Context:** e-commerce is about 3.5% of alcohol sales value, and online alcohol grows about 3% a year to 2029 (IWSR 2025). Regulation, not sales growth, drives check volume.

**Revenue model:**
- Businesses pay per check: **$0.05–$0.15**, against about $1+ for ID-upload checks.
- Compliance subscription: about **$150/month** for receipts, auditor export, fraud alerts and assistant.
- Issuers are paid per Pass, or it's bundled with existing bank or telecom KYC.
- Consumers pay nothing.
- **Beachhead:** online alcohol and cannabis delivery, then 21+ venues, where a legal check is required at every transaction.
- **Later:** vapes, gambling, adult sites, event tickets bound to one Pass, car rental (licence plus 25+), health clearances for schools and employers.

**Trends ("why now"):**
- UK Online Safety Act age-assurance duties took effect in July 2025.
- The US Supreme Court upheld Texas's age-verification law (*Free Speech Coalition v. Paxton*, June 2025).
- US alcohol-delivery laws require an age check at sale and at delivery.
- Breach fatigue (Discord, Tea).
- Mobile driver's licences and Apple's passport-based Digital ID (Nov 2025) are in phone wallets.
- Browsers shipped the Digital Credentials API in 2025.
- Privacy technology is going mainstream: selective disclosure, passkeys, zero-knowledge proofs.

**Competition:**

| Competitor | Approach | Gap decID fills |
| --- | --- | --- |
| Yoti, Persona, Veriff, Jumio, Onfido | ID photo plus selfie at each check | Stores ID images (breach risk), ~$1+ per check, not reusable |
| Facial age estimation | AI guesses age from a selfie | Probabilistic and weakest near the 21 cutoff |
| TruAge (NACS / Conexxus) | The cashier scans a licence and reads 4 fields (licence #, state, expiry, birth date) into a single-use token | In-store only; the scan still reads birth date and licence number |
| Apple / Google Wallet ID | Phone ID that shares one fact | The business gets no compliance record. decID builds on them, using a wallet ID as an input |
| Bouncers, ID scanners (IDScan.net, Intellicheck) | Staff look at or scan the card | Fake IDs, the whole ID exposed, no tamper-proof record |

**Positioning:** decID is the only option that shares one fact *and* gives the business tamper-proof proof. It complements identity-proofing vendors and wallets rather than replacing them.

**SWOT inputs:**
- **Strengths:**
  - privacy by design (one fact);
  - blockchain-anchored receipts even decID can't rewrite;
  - one Pass online, at delivery and in person;
  - fraud detection and assistant;
  - open standards;
  - a working, heavily tested prototype.
- **Weaknesses:**
  - two-sided cold start;
  - depends on issuers and on Apple/Google verifier registration;
  - no partnerships yet, simulated issuers;
  - unaudited;
  - a single founder with no legal or compliance expertise.
- **Opportunities:**
  - new age-check laws forcing demand;
  - wallet-ID growth;
  - adjacent verticals (cannabis, vapes, tickets, car rental, health);
  - partnering with delivery platforms or POS providers;
  - selling the compliance tools to incumbents' customers.
- **Threats:**
  - Apple/Google adding business proof themselves;
  - incumbents' distribution;
  - fragmented state and country rules;
  - scepticism of "blockchain" and of age mandates;
  - category-wide breaches lowering trust.

**Customer research.** Secondary data to cite:
- **US 2026 (Fortune):**
  - 79% worry about privacy and data security when verifying age;
  - 66% cite identity-theft risk;
  - 90% still say gambling sites should have strict age checks. People want checks, just not ID handover.
- **US 2023 (cited in a 2026 arXiv review):** two-thirds are uncomfortable uploading a government ID to social-media companies.
- **UK July 2025 (LexisNexis):** 52% would abandon an online purchase if asked for a selfie or liveness test.
- **UK 2022 (YouGov):** 78% wouldn't upload an ID for age verification (distrust of companies 64%, fear of data misuse 63%).
- **An experiment (n = 99, mock gambling site):** ID upload made up to 60.5% quit, versus 95.2% completion for a checkbox.

**Primary research.** Include my survey instrument and interview guide, with **[INSERT]** placeholders for results.
- **Survey (target n ≥ 30, adults 21+):**
  1. How often were you asked for ID in the last 12 months?
  2. How comfortable are you uploading a licence photo to a website (1–5)?
  3. Have you ever abandoned an online purchase due to an ID or selfie check?
  4. Would you use an app that proves 21+ without sharing name, birth date or photo (1–5)?
  5. What matters most: privacy, speed, or not carrying an ID?
  6. Would a record of each check on your phone increase your trust (1–5)?
- **Interviews (5–8):**
  - **Who:** bartenders, door staff, liquor and delivery store owners, students 21+.
  - **Prompts:**
    - "Walk me through your last ID check."
    - "What goes wrong?"
    - "If a regulator asked you to prove you checked a customer last Friday, what would you show?"
    - "What would make you trust a phone-based check?"
- Then state the insight: people support checks but resist handing over ID data, and businesses lack proof. decID fits that gap.

## Legal inputs
- **Trademark:**
  - Search "DECID", "DEC ID" and "DECIDE" in classes 9, 42 and 45 on USPTO's trademark search (tmsearch.uspto.gov). **[INSERT results]**
  - Risk: similarity to the common word "decide". Backup names: PassProof, OneFact ID, ProvaPass.
- **Domains to check:** decid.com, decid.io, decid.app, getdecid.com, usedecid.com, decidpass.com, decid.id. **[INSERT availability]**
- **Social handles:** @decid, @decidpass and @getdecid on IG, FB, TikTok and X. **[INSERT]**
- **Other considerations:**
  - **Privacy law:** CCPA/CPRA; Illinois BIPA if face matching is ever added; GDPR / UK GDPR abroad. Disclose the 48-hour fraud pseudonym.
  - **Age-verification rules:** state alcohol-delivery laws; the UK Online Safety Act (Ofcom lists digital identity as accepted); adult-site and social-media laws.
  - **Health data:** HIPAA if used with real covered entities.
  - **Liability:** terms of service and issuer agreements.
  - **Blockchain:** no tokens or customer funds, so no securities or money-transmission issues.
- **IP:**
  - **Trademark:** the name "decID", the tagline and the logo.
  - **Copyright:** source code, UI and the receipt and export formats.
  - **Possible patents (attorney needed; software patents are hard post-*Alice*):**
    - on-chain anchoring of per-business signed age-check receipt chains, so the operator can't rewrite them;
    - one licence → one active Pass, via a keyed hash of the mobile licence's device key;
    - per-business, per-day pseudonyms for detecting a Pass handed back through a queue;
    - a door match code derived from the holder's signature and shown on both screens.

## Product plan inputs
**Core features:**
1. One-time Pass from a wallet ID or issuer.
2. One-tap answer with a consent sheet.
3. In-person door check with match code and optional Face ID.
4. Business dashboard and auditor export.
5. Fraud detection.
6. Compliance assistant.
7. Blockchain registry and receipt anchoring.
8. Health-facts demo.

**User stories:**
- 21-year-old buying beer online: prove 21+ without uploading a licence.
- Student at a bar: scan once, never hand a stranger an ID showing their address.
- 16-year-old: learns "No" before sharing, and the bar learns only "not old enough".
- Delivery business: a signed receipt per order for regulators.
- Bar manager: an alert when the same Pass comes back through the line.
- Compliance officer: ask "was order HL-4821 age-checked?" and get proof instantly.
- Someone who lost their phone: the Pass is revoked.
- College health office: confirm measles immunity without receiving medical records.

**Core mechanics.** Describe at least these; the course requires 2.
1. **Authentication:** the credential is signed by an issuer and bound to the phone's key. Each answer is a signature for one request, checked against the issuer's signature, the holder binding and live on-chain status.
2. **Verification flow with signed, chained, blockchain-anchored receipts,** including the live tamper demo.
3. **Data visualisation:** dashboard charts and the Risk page.
4. **Chat interface:** the compliance assistant, grounded in receipts.
5. **AI-style recommendations:** fraud signals with suggested actions.
6. **Biometric unlock:** passkeys.

**Agile / Trello.** Four sprints, matching how the work actually went:
1. **Sprint 1:** core protocol (contracts, issuer, holder and verifier flows, security tests).
2. **Sprint 2:** product (Pass wallet, Verify API, Hopline and Neon Hall demos, dashboard, hosted prototype).
3. **Sprint 3:** feedback-driven work.
   - A UI redesign after I said it "looked AI-generated".
   - Apple-style polish.
   - On-chain receipt anchoring.
   - Auditor export.
4. **Sprint 4:** depth.
   - Government ID from the phone wallet.
   - Fraud detection, Face ID and the assistant.
   - Health records.
   - A clearer demo licence after I found the "test wallet" confusing.
   - Health added to the guided walkthrough.
   - Deployment to GitHub Pages.

**Entrepreneurial principles to connect:**
- Customer-problem first: businesses need proof; people won't hand over ID.
- MVP and iteration, driven by feedback.
- A wedge or beachhead market with a legal mandate.
- Defensibility through receipts, anchoring and network effects.
- Partner strategy: build on wallets and issuers instead of competing.

**Exact prompts I used.** Include this list, in order, as an appendix. It's the key prompts; short ones like "continue" or "its done" are omitted.
1. My initial specification: a decentralized identity prototype with Holder / Issuer / Verifier, Next.js, a local blockchain and verifiable credentials, under security constraints (synthetic data only, no real keys or funds). [PASTE FULL TEXT IF YOU HAVE IT]
2. "dont build it in the wandr repo create a new repo and work there"
3. "you can push it and keep building using the cloud credits. you can name it decid"
4. "keep going on roadmap items and just building and improving"
5. "run your own version of a mock test and find different ways to test the identity verification"
6. "honestly just go crazy until you expel all the credits"
7. "run tests yourself determine the actual functionality and if it could actual be used in the real world and actually work. maybe build out some sort of interface or site in which all of this can be seen"
8. "if this had to be presented and shown as a startup idea, how would you make it unique and an actual product. I have to do a startup presentation for my class and I dont want you to build the presentation itself but the product and make sure its demonstrable"
9. "okay my only issue with this right now is that you can just instantly tell from the ui and ux that this is ai generated. work way harder and search for good ui/ux examples for products like this as well as ui/ux for products in general"
10. "wait honestly this is pretty good. get the ui to look a bit better such as matching a bit of apple's simplicity a bit more or stuff like that. also just keep building and improving the overall workings of this and its ability on the blockchain and such."
11. "okay if you were to buy alcohol online and you had to be present with id for the pickup, how could this solve that. … does decid do this? and on top of that does decid solve issues like this parallel to other fields/areas."
12. "so how does decid differ from lets say truage or other existing apps. what can decid do that other existing things out there can't. how can we build decid to be something unique. also I would like it to actually work with your government id or things of sort"
13. "also for door checks how does decid defend against fakes and how can it use things like biometrics to determine that it is in fact you"
14. "what are the clear benefits of this over just using traditional ids and verifications. how is decid revolutionary and how does it take advantage of the blockchain and ai"
15. "continue building and improving decid. how can decid already prevent fraud detection and utilize biometrics and compliance assistance. build those things I need decided to really be something noteworthy"
16. "I dont understand why you can add more than one person unless thats just for the demo. also the test wallet thing doesn't work so I dont get what im supposed to do. maybe find a way to get this to work for health records as well? maybe touch up on the ui a little bit more as well?"
17. "okay do ui first and then health records"
18. "okay can you get a fully complete version that would work well and good for a demo"
19. "get decid absolutely finished and ready for a demonstration …"
20. "can you create me a deployed functioning prototype for this"

## Pitch deck summary to include
11 slides:
1. Title: "decID: Prove you're 21. Nothing else."
2. The problem: you hand over everything to prove one fact (breach stats).
3. Why now: laws plus wallet IDs.
4. The solution: verify once, answer with one tap.
5. Works in person: door, match code, under-21 refusal.
6. Why it's different: fraud alerts, blockchain-anchored receipts, compliance assistant.
7. Market: TAM, SAM and SOM, plus the health expansion.
8. Competition: a 2×2 of "one fact vs. whole ID" against "proof vs. no proof", with decID alone in the top-left.
9. Business model.
10. Traction and roadmap.
11. The ask.

Presented in about 5 minutes. Built in Lovable using real prototype screenshots. Deck link: [DECK LINK].

## Reflection inputs (first person, at most one page)
- **Went right:**
  - Narrowed a broad decentralized-identity idea into a clear customer problem.
  - AI tools let me build a real, tested product fast.
  - Pushback ("looks AI-generated", "test wallet is confusing") led to better versions.
  - Competitor research (TruAge, Apple Wallet ID, Yoti) sharpened the positioning.
- **Went wrong:**
  - Scope grew too wide (blockchain, government IDs, fraud, biometrics, health), which made it harder to explain simply.
  - Customer research came after much of the building.
  - Some demo features confused me as a user.
  - I ran low on AI credits and had to prioritise.
- **Do better:**
  - Interview bartenders, store owners and students in week 1.
  - Set a scope and budget per sprint.
  - Write the pitch story early.
  - Test the demo on a newcomer.
- **Other:** when building gets cheap, judgment becomes the scarce skill. Get early legal input on the trademark, privacy and health data.

## Sources (list these)
- MarketsandMarkets, Digital Identity Solutions Market (2025): https://www.marketsandmarkets.com/Market-Reports/digital-identity-solution-market-247527694.html
- Marketintelo, Age Verification Software Market: https://marketintelo.com/report/age-verification-software-market/amp
- Marketintelo, Age Verification for E-commerce Market: https://marketintelo.com/report/age-verification-for-e-commerce-market
- IWSR e-commerce outlook (via The Rum Lab): https://therumlab.com/iwsr-online-alcohol-sales-forecast-adjusted-as-growth-slows/
- Fortune (2026), age-verification survey: https://fortune.com/2026/03/27/age-verification-laws-americans-survey-easily-circumventable/
- arXiv (2026), Assessing Age Assurance Technologies: https://arxiv.org/pdf/2603.25695
- LexisNexis Risk Solutions UK (2025): https://risk.lexisnexis.co.uk/about-us/press-room/press-release/20250725-idv-checks-concerns
- YouGov via Global Dating Insights (2022): https://www.globaldatinginsights.com/news/yougov-survey-reveals-flaws-in-governments-plans-for-age-verification-on-adult-content/
- IETF workshop paper on user responses to age verification: https://datatracker.ietf.org/doc/slides-agews-paper-measuring-user-responses-to-age-verification-architectures-evidence-from-a-deceptive-online-experiment/
- The Record, Discord ID exposure (2025): https://therecord.media/discord-government-docs-exposed-breach
- TruAge, how it works: https://truage-static.thinksys.com/how-truage-works
- Chrome, Digital Credentials API: https://developer.chrome.com/blog/digital-credentials-api-shipped

Output the full document now, formatted with headings, tables where helpful (market, competition, SWOT), and bold key numbers. End with the Individual Reflection as a separate section.
