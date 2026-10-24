# decID design system

The first product UI read as AI-generated:
- emoji icons;
- the same rounded white card with a soft shadow around everything;
- a teal gradient card with decorative circles;
- ✓/✕ pills;
- tracked uppercase eyebrows;
- untinted Tailwind greys.

This redesign replaces those defaults with decisions taken from shipped identity products and from published design systems.

## Where each decision comes from

| Decision | Source |
| --- | --- |
| Consent sheet layout and order: requester, purpose sentence, the one requested item, what is not shared, retention line, sticky "Share with …" / "Cancel" | Apple Verify with Wallet and ID Verifier HIG (fixed labels, a one-sentence purpose in sentence case, age thresholds instead of birth dates, retention intents rendered as system copy); EU Digital Identity Wallet reference app ("Data sharing request", "Intended use", "Requested data", sticky Share) |
| A merchant's "Verify Age" button: black, fixed label, no QR or NFC glyph, never hidden or disabled | Apple Pay and Verify with Wallet button guidelines |
| Result panel with the match code: a full-width colour block, white heading, large monospace reference | GOV.UK Design System confirmation panel |
| A receipt for every share, listed under Activity | Yoti / Post Office EasyID activity receipts |
| Door kiosk: full-bleed verdict readable from 2 m, a reason line, staff "Codes match / Don't match", a live clock so a screenshot can't pass as live | Apple ID Verifier ("Matches Person"), Scantek and NightKey venue apps, Ticketmaster SafeTix's moving barcode |
| Dashboard: sidebar, dense full-bleed tables, dot-plus-text status, monospace IDs, a detail drawer | Stripe Dashboard and Radar, Linear, GitHub Primer, Shopify Polaris badge guidance |
| Credential card: light security-print paper, guilloché linework in two inks, microtext, one primary field, a small optically variable patch | Wallet pass field layout (Apple PassKit), EU driving-licence security features (guilloché, rainbow printing, microtext, OVD) |

## Tokens

- **Neutrals: "ink", 12 steps tinted toward blue** (OKLCH hue 255, low chroma), from `ink-1` #FCFDFF to `ink-12` #171B20.
  - Borders are `ink-6` at rest and `ink-5` for dividers.
  - Secondary text is `ink-10`; primary text is `ink-12`.
- **Accent: ultramarine #3552BC.** It is used only for links, focus, selection and charts. Primary buttons are near-black (`ink-12`), as in Apple's and Polaris's primary actions.
- **Verdict colours: green #1E7A3C and red #B42318**, used for the verdict alone. Elsewhere, status is a 6–8 px dot plus a text label.
- **Type: the system face (SF Pro / SF Mono on Apple devices)**, with self-hosted Inter and IBM Plex Mono as fallbacks elsewhere. Apple-style large titles (34 px bold on the phone, 48–72 px on the product page).
  - Sizes: 12/16, 13/18 (dashboard UI), 14/20 (body), 16/24, 20/28, 24/32, 32/40, 40/48.
  - Tracking is −0.01em from 20 px and −0.02em from 32 px. Sentence case everywhere except printed credential labels.
- **Radii:** 4 (badges), 6 (buttons, inputs), 8 (panels), 12 (sheets), 16 (credential), plus full circles for dots.
- **Elevation:** 1 px borders at rest. Shadows only for floating layers (sheet, drawer, phone).
- **Spacing:** a 4 px grid. Controls are 32 px tall in the dashboard and 44–50 px on the phone.
- **Motion:**
  - 100 ms hover, 160 ms press (`scale(.98)`), 200 ms state change, 240 ms sheet enter, all eased out (`cubic-bezier(.2,.8,.2,1)`).
  - One choreographed moment: the check ring on a successful share.
  - `prefers-reduced-motion` turns motion off.
- **Icons:** Lucide at stroke 1.75, sized to the text beside them. No emoji, and no ✓/✕/→ glyphs used as icons.

## Merchant brands

The demo businesses look like real, separate companies, so it is obvious which parts are decID:
- **Hopline** (online drinks shop): Archivo at condensed widths, black on white, with illustrated cans.
- **Neon Hall** (venue): Big Shoulders Display, near-black with one magenta.

The decID-owned pieces inside their pages (the Verify Age button and the waiting state) use decID's own type and colours, which matches how Apple Pay and Stripe Identity appear inside merchant sites.
