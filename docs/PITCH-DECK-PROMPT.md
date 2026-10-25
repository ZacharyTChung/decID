# Lovable prompt: decID pitch deck (uses real prototype screenshots)

## Before you paste

1. Download the screenshots in `docs/deck-images/`. On GitHub, open each file and click **Download raw file**.
2. In Lovable, start a new project and **attach all 14 images** to your first message, along with the prompt below. Lovable then uses your real screens instead of drawing its own.
3. Replace `[PROTOTYPE_LINK]`, `[NAME]` and `[EMAIL]` before sending.

## Rubric check

| Requirement | How this deck meets it |
| --- | --- |
| 10–12 slides | 11 slides |
| Under 5 minutes | ~25 s per slide; speaker notes are written to time |
| Polished, not a standard template, no generic bullets | Custom keynote layout, one idea per slide, big numbers, real product screens |
| Reflects the product | Every product visual is a real screenshot of the prototype |
| Uses course content | Problem, why now, solution, demo, market (TAM/SAM/SOM), competition, business model, traction/roadmap, ask |

---

## Prompt (paste everything below this line, with the 14 images attached)

Build a polished **investor pitch deck web app** for my startup **decID**: **11 full-screen slides**. Navigate with the arrow keys, clicks or swipes. Show a slide counter, a full-screen "Present" button, speaker notes toggled with the **N** key, and a print / PDF export view.

### Use my real screenshots (most important rule)

- I attached 14 PNG screenshots of my working prototype. **Use these exact images for every product visual.**
- Do **not** generate, redraw or invent mock-ups, phones, dashboards or UI.
- Do not use stock photos or clip art.
- You may crop to the important area, round the corners (16 px), add a soft shadow and scale them, but never alter what's inside them.
- File names and what each shows:
  - `01-prototype-overview.png`: the whole prototype (store checkout on the left, decID Pass phone on the right).
  - `02-phone-wallet-share-sheet.png`: the phone's wallet sheet: "decID wants to verify your age", Over 18 / Over 21 shared, name, birth date and photo not shared.
  - `03-phone-pass-card.png`: the decID Pass card ("21+", "Active. Businesses can check it.").
  - `04-phone-consent-sheet.png`: the consent sheet: "Requested: 21 or older", "Not shared: …".
  - `05-checkout-verified.png`: the Hopline checkout after age is verified, order confirmed.
  - `06-door-ok-to-enter.png`: the Neon Hall door kiosk, green "OK TO ENTER" with a 4-letter match code.
  - `07-phone-match-code.png`: the phone showing the same match code.
  - `08-door-refused-underage.png`: the door kiosk, red "DO NOT ADMIT · Not old enough".
  - `09-door-fraud-warning.png`: the door kiosk with the warning "Same Pass admitted again".
  - `10-dashboard-overview.png`: the decID Verify business dashboard.
  - `11-dashboard-risk.png`: the Risk page (fraud signals).
  - `12-dashboard-assistant.png`: the compliance assistant answering "Anything suspicious?" and "Is our record intact?".
  - `13-health-check.png`: Lakeside College health clearance, with the phone sharing one health fact.
  - `14-tamper-caught-by-blockchain.png`: the receipts page catching a rewritten history through the on-chain anchor.

### Visual style: match the product exactly

- **Background** #fbfbfd. **Text** #1d1d1f; secondary text #6e6e73. **Accent** #0066cc (the product's link/button blue). **Success** #1f7a3d; **danger** #c4321f (use sparingly).
- **Font:** Inter or the system SF Pro font; headlines bold, 64–96 px, tight letter-spacing; body 20–24 px.
- **Layout:** Apple-keynote simplicity. One idea per slide, lots of white space, screenshots large. Phone screenshots are tall portraits and desktop screenshots are wide; never stretch them.
- **Brands used in the screenshots** (use them only when referring to them): Hopline (black and yellow online liquor store), Neon Hall (dark venue with pink #ff3ea5), Lakeside College (dark green #0f4c3a).
- **Icons:** thin line icons (Lucide). Subtle fade/slide transitions. Readable on a projector.
- **No** bullet-point walls: at most 3 short lines of text on any slide.

### Slides (copy can be tightened, but keep the facts)

1. **Title.** "decID". Tagline: **"Prove you're 21. Nothing else."** Subtitle: "Reusable, private age verification." Visual: `03-phone-pass-card.png`, large, on the right. Footer: [NAME] · BUAD 301.

2. **The problem.** Headline: "To prove one fact, you hand over everything."
   - Left: a simple typographic list of what an ID reveals (Name · Address · Birth date · ID number · Photo), all highlighted.
   - Right: three big stats:
     - "~70,000 government IDs exposed in Discord's Oct 2025 age-check breach";
     - "79% of Americans worry about privacy when verifying age";
     - "52% abandon a purchase when asked for a selfie check".
   - Tiny source line.

3. **Why now.** A horizontal timeline:
   - "Jun 2025: US Supreme Court upholds Texas age-verification law";
   - "Jul 2025: UK Online Safety Act age checks begin";
   - "2025: driver's licences in Apple and Google Wallet, and browsers can ask the wallet for an ID";
   - "Alcohol delivery laws require checks at sale and delivery".

   Headline: "Checks are mandatory. Private checks just became possible."

4. **The solution.** Headline: "Verify once. Answer with one tap."
   - Three steps with screenshots: (1) `02-phone-wallet-share-sheet.png` "Get your Pass from the ID already in your phone" → (2) `04-phone-consent-sheet.png` "A business asks one question" → (3) `05-checkout-verified.png` "It gets 'yes' plus a signed receipt, never your ID".

5. **Works in person.** Headline: "Same Pass at the door."
   - `06-door-ok-to-enter.png` large, with `07-phone-match-code.png` beside it.
   - Caption: "The same 4-letter code appears on the door and the phone, so nobody can use a friend's phone from outside."
   - Small inset: `08-door-refused-underage.png` captioned "Under 21? The door learns only 'Not old enough'."

6. **Why it's different.** Headline: "Built for proof, not paperwork." Three screenshot tiles:
   - `09-door-fraud-warning.png`: "Fraud alerts: a passed-back, fake or borrowed Pass is flagged";
   - `14-tamper-caught-by-blockchain.png`: "Receipts anchored on a blockchain: even decID can't rewrite them";
   - `12-dashboard-assistant.png`: "Compliance assistant: 'Was order HL-4821 age-checked?', proven from signed receipts".

   Footer line: "Nothing personal stored, so nothing to breach · Face ID unlock · One licence = one Pass".

7. **Market.** Three nested circles with big numbers:
   - **TAM $44.2B**: digital identity solutions (2025), growing 20% a year to $132B by 2031 (MarketsandMarkets);
   - **SAM ≈ $1.8B**: age-verification software (2025), 16.5% a year (Marketintelo);
   - **SOM ≈ $2.4M ARR in 3 years**: US alcohol and cannabis delivery plus 21+ venues.

   Small text: "Beyond age: health facts for schools and employers". Inset `13-health-check.png`, small.

8. **Competition.** A 2×2 chart. X axis: "Shares one fact ← → Shares the whole ID". Y axis: "Gives the business proof ↑ / No proof ↓".
   - **decID** alone in the top-left (blue dot, larger).
   - Bottom-right: "ID upload + selfie (Yoti, Persona, Veriff)" and "Bouncer checks a plastic ID".
   - Bottom-middle: "TruAge (licence scan at the register)".
   - Bottom-left: "Apple / Google Wallet ID".

   Caption: "We build on wallet IDs and add the proof businesses need."

9. **Business model.** Big numbers in three columns:
   - "$0.05–$0.15 per check (ID-upload checks: ~$1+)";
   - "~$150/month compliance plan: receipts, auditor export, fraud alerts, assistant";
   - "Issuers paid per Pass".

   Beachhead line: "Start where a check is legally required at every sale: alcohol and cannabis delivery and 21+ venues."

10. **Traction and roadmap.** Left:
    - "Working prototype: [PROTOTYPE_LINK]" with `10-dashboard-overview.png`;
    - "170+ automated tests · 68 security attacks blocked";
    - "Built: wallet-ID onboarding, blockchain receipts, fraud alerts, Face ID, assistant, health demo".

    Right, a vertical timeline: "Pilot with one delivery retailer and one bar" → "Issuer and wallet partnerships" → "Security audit" → "Expand: vapes, tickets, car rental, health clearances".

11. **The ask.** Headline: **"Prove you're 21. Nothing else."**
    - Three asks: "Pilot partners (bars, delivery apps)" · "Issuer partners (banks, DMVs)" · "Mentorship and feedback".
    - A QR code linking to [PROTOTYPE_LINK]. Contact: [EMAIL]. Background image: `01-prototype-overview.png` faded to 8% opacity.

### Speaker notes (one per slide, about 25 seconds each)

1. "I'm [NAME]. This is decID: prove you're 21, and nothing else."
2. "Today, to prove one fact you hand over your whole ID, and those IDs get stored and breached. Discord just leaked 70,000. People hate it, and they drop off."
3. "The law now requires these checks, and phones now carry IDs that can share a single fact. That's the opening."
4. "You verify once, from the ID in your phone. Then a store asks one question and gets a yes, plus a signed receipt. Never your ID."
5. "Same Pass at the door. Both screens show the same code, so you can't use a friend's phone. If you're under 21, the bar learns only that."
6. "For businesses it's proof: fraud alerts, receipts anchored on a blockchain that even we can't edit, and an assistant that proves any order was checked."
7. "Digital identity is a $44 billion market. Age verification is about $1.8 billion and growing 16% a year. We start with US delivery and venues, and health facts are next."
8. "ID upload vendors take everything and give no proof. Wallet IDs share one fact but give businesses no record. decID is the only one that does both."
9. "Businesses pay per check, about a tenth of today's price, plus a compliance plan. Issuers are paid per Pass."
10. "It works today: here's the live prototype, tested against 68 attacks. Next: a pilot with a delivery retailer and a bar, then an audit."
11. "We're looking for pilot partners, issuers and mentors. Prove you're 21. Nothing else. Thank you."

Make the prototype link a single editable constant. Ensure every screenshot loads from the attached files and stays sharp. Finally, check that the deck has exactly 11 slides and no slide has more than 3 lines of body text.
