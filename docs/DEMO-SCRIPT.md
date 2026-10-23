# Demo script (about 4 minutes)

How to show decID live in a class pitch. Everything runs on one laptop with synthetic people, with no internet or accounts needed.

## Before class (once)

```bash
npm ci
npm run compile
npm run product          # builds, then starts chain + app + demo businesses
```

- The first run builds the app, which takes about a minute.
- When it prints **decID is running**, open http://localhost:3000/demo.
- Check that the full flow below works once on the presentation laptop.
- Then stop with Ctrl+C. Each run starts from a clean slate, so restart right before you present.

Optional rehearsal check: `npm run test:product` drives the whole script in a headless browser and writes screenshots to `.product-test/`, which you can also use as slide images.

## Option A: one screen (recommended)

Open **http://localhost:3000/demo**. On the left is the business, on the right a phone running decID Pass, and the script sits in a sidebar (hide it with *Hide script*).

| # | Say | Do |
| --- | --- | --- |
| 1 | "Age checks are now law. The usual fix, uploading your ID, is what leaked at Discord and Tea." | (Slide, or the decID home page at `/`) |
| 2 | "Alex gets verified once, by a trusted issuer such as a DMV or bank." | Phone: tap **Alex**, then **Verify me**. The card shows 18+ ✓ 21+ ✓, *Active*. |
| 3 | "Alex is buying beer online. Hopline must check 21+." | Left: Hopline tab, then **Verify age with decID**, then **Open decID Pass on this device**. The phone opens the request by itself. |
| 4 | "The phone shows who is asking and exactly what they learn, and what they won't see." | Point at *They will learn* / *They will not see*. Tap **Share "21+" with Hopline**. |
| 5 | "Hopline got a yes and a signed receipt. Nothing else." | Left: *Order confirmed ✓*, then the dark panel *What Hopline received*. Optionally click *Compare with a typical ID-upload checkout*. |
| 6 | "Same Pass, at a door." | **Neon Hall** tab. Click the link under the QR code to open it in the phone frame (or scan with a real phone, Option B). Share. The kiosk turns green, and both screens show the **same 4-letter code**, which staff compare. |
| 7 | "Sam is 16." | **Phone home**, then the person menu, then **+ Another person (demo)**, **Fill as Sam**, **Verify me**. Go back to Neon Hall (it resets after a few seconds) and share. The phone warns first. The door shows **ENTRY REFUSED · Not old enough**. |
| 8 | "The business view: volume, outcomes, and a signed receipt chain for regulators. And here is every field it stores, none of them personal." | **Business dashboard** tab, then **Neon Hall (venue)**. Point at *Chain intact* and *Personal data held: none*. |

## Option B: a real phone (more impressive)

```bash
npm run product -- --lan
```

- The laptop and the phone must be on the **same Wi-Fi**. Campus networks often block device-to-device traffic, so a phone hotspot is the reliable fallback.
- Scan the QR code printed in the terminal to open decID Pass on the phone, then get verified as Alex.
- Put **http://\<laptop-ip\>:3000/demo/door** on the projector and scan the door QR code with the phone's camera. Share, and the projector turns green with the same code as the phone.
- It runs over plain HTTP on the local network. The Pass does not need HTTPS-only browser features.

## If something goes wrong

- **A check says expired:** checks last 5 minutes. Click *Start again* (shop) or wait for the door to refresh.
- **Port 3000 or 8545 busy:** stop the other process, or use `npm run product -- --port 3001`. The chain always uses 8545.
- **The phone frame is stuck:** click **Phone home** in the stage header.
- **Network fails during class:** use Option A, which needs no network at all.
- **Last resort:** show the screenshots in `.product-test/` from your rehearsal run.

## Q&A crib

- **"Is this blockchain-based?"**
  - Only for one thing: a public registry of valid and revoked credentials, so the issuer can't see where you use your Pass.
  - No personal data goes on-chain. The demo scans every transaction to prove that (`npm run demo`, step 10).
- **"What stops me borrowing a friend's phone?"**
  - Online: the same as any account.
  - At a door: staff compare the match code and can ask for a face check against the Pass holder in a future version.
  - Each answer is signed for one request, so a recorded answer can't be replayed.
- **"Why would a business pay?"**
  - It's cheaper than an ID-scan vendor (assumption, see docs/PRODUCT.md).
  - Fewer customers drop off at checkout.
  - It can't be breached for ID photos it never had.
- **"Is it real?"**
  - The cryptography, the APIs and the tests are real.
  - The issuer and the people are simulated, and it isn't audited.
