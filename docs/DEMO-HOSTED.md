# Demo script: hosted prototype (about 6 minutes)

Open the link: https://claude.ai/artifact/SE7SVzFQFUQpWQJm4su763 (share it first: it's private).
Nothing to install. Everything runs in the browser tab. **Reload to start over.**

The numbered steps across the top track your progress. They turn green as you go.

## 1. Get a Pass (30 s)

- On the phone: **Add your ID** → **Demo driver’s licence** → **Alex Sample** → **Continue** → **Share**.
- Say: *"In real life this sheet is Apple or Google Wallet. decID asks it for two facts only, over 18 and over 21. Never my name, birth date or photo."*
- Optional: under **Security**, turn on **Face ID / fingerprint** (simulated here).

## 2. Buy alcohol online (45 s)

- **Online checkout** → **Verify age with decID** → **Open on the demo phone** → **Share**.
- Open **What Hopline received**. It shows `ageOver21: true` and a signed receipt, with no personal data. Then **Place order**.

## 3. Get into a venue (45 s)

- **Venue entry** → **Scan with the demo phone** → **Share**. The door turns green.
- Point at the 4-letter code: it's on both the phone and the door. *"This stops someone using a friend's phone from outside."*

## 4. Someone under age (30 s)

- On the phone, choose **Add a demo person…** → **Simulated Identity Office** → **Sam** → verify.
- Scan the door again. The phone warns "No" before sharing, and the door says **Do not admit · Not old enough**.

## 5. Health records (45 s)

- **Health check** → **Confirm with decID** → on the phone **Add a health record (demo clinic)** → **Share**.
- *"The college learns one answer, measles immunity yes or no. Not the record, not diagnoses, not dates."*

## 6. The business side (2 min)

- **Business dashboard** → **Simulate a busy night**. Twelve guests go through, plus trouble: a Pass handed back, three fake Passes, a borrowed Pass and a revoked one.
- **Risk**: every attack is flagged, with the receipts as evidence.
- **Assistant**: ask *"Anything suspicious?"*, then *"Write this week’s compliance report"*. *"Every number is computed from signed receipts, so it can't make one up."*
- **Receipts**: try **Rewrite history as the operator**.
  - The signatures still pass.
  - The **on-chain anchor** catches it.
  - *"Not even decID can quietly change a business's records."*
  - Then **Undo**.
- **Data & privacy**: every stored field is listed. None can hold personal data.

## Q&A crib

- **Why blockchain?** Two reasons:
  - A neutral registry that nobody controls: validity and revocation can be checked without telling the ID issuer where you went.
  - Tamper-proof anchoring of each business's records.
- **Why not just show an ID?** A plastic ID shows everything printed on it, ID uploads create a breach risk, and neither leaves proof for a regulator. decID shares one fact and leaves a signed record.
- **AI?** Fraud signals are explainable rules plus statistics. The assistant computes its answers instead of generating them. There is no language model, by design.
- **Is it real?** The cryptography, contracts and checks are real. Issuers, people and the network are simulated. It isn't audited or a compliance product.
