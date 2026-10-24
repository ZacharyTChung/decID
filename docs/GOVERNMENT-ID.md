# Getting a Pass with a government ID

A person can get their decID Pass from the driver's licence already in their phone's wallet
(Apple Wallet, Google Wallet or a state's wallet app) instead of filling in a form. decID asks the
wallet two questions only, **over 18?** and **over 21?**, and checks the state's signature on the
answer. It never receives the person's name, birth date, photo, address or licence number.

This is built and tested end to end with **test licences** (synthetic people, signed by a
generated test DMV). Real licences need the trust and registration steps under
[Going live](#going-live); nothing in this repository has been tested against a real Apple or
Google wallet.

## How it works

```
Pass (browser)                  decID server                         Phone wallet
──────────────                  ────────────                         ────────────
POST /api/holder/mdl/requests ─▶ one-time P-256 reader key
                                 DeviceRequest: age_over_18, age_over_21
                                 (intentToRetain = false)
◀── { protocol: "org-iso-mdoc", data: { deviceRequest, encryptionInfo } }
navigator.credentials.get({ digital: { requests: [ … ] } }) ─────────▶ shows who asks and what
                                                                       person approves
◀────────────────────────────── data.response: DeviceResponse,
                                 HPKE-encrypted to the reader key,
                                 device-signed over the SessionTranscript
POST …/requests/{id}/response ─▶ decrypt (needs this request's key and this site's origin)
                                 verify: state root → document signer → MSO → each value digest
                                 verify: the device key in the MSO signed this session
                                 issue the Pass credential (18+ / 21+ / country only)
                                 one licence → one active Pass
◀── { requestId, ageOver18, ageOver21, issuer } → pick up the Pass and activate it as usual
```

- **Protocol:** ISO/IEC 18013-7 Annex C over the W3C Digital Credentials API (`org-iso-mdoc`).
  Safari 26+ and Chrome 141+ support it. The session transcript is
  `[null, null, ["dcapi", SHA-256(CBOR([encryptionInfo, origin]))]]`. It is the HPKE `info`
  (DHKEM P-256, HKDF-SHA256, AES-128-GCM) and is covered by the device signature. An answer made
  for another site, or for another request, does not decrypt or does not verify. The layout follows
  the EU Digital Identity Wallet's reference implementation (`av-lib-ios-w3c-dc-api`).
- **Code:** `src/lib/shared/mdl/annex-c.ts` (request, transcript, HPKE),
  `src/lib/shared/mdl/verify.ts` (licence verification, built on `@auth0/mdl`),
  `src/lib/server/issuer/mdl.ts` (issuance), and `src/lib/shared/mdl/test-wallet.ts` (test DMV and
  test wallet).
- **What is kept:** the issuance outcome and the issuing authority's name (in the audit log), plus
  a keyed hash of the licence's device key (a public key, not personal data). The one-time reader
  key is deleted with the request.

## One licence, one Pass

Without a limit, an adult could approve a Pass for a teenager's phone using their own licence.
decID keeps one active Pass per licence. Verifying the same licence again revokes the earlier Pass
on-chain, or cancels its authorization if it was never activated, using the same path as account
recovery. Lending a licence therefore costs the lender their own Pass. The licence is recognised
by its device key, which the state signed into the licence when it was put on the phone.

## Try it

- `npm run product`, open `/pass`, choose **Test wallet**, pick a synthetic licence and press
  **Share**. Jo (19) gets an 18+ Pass that says no to 21+.
- On a browser with the Digital Credentials API and a real trust root configured, the row
  **Driver's licence in your wallet** appears and calls the real wallet.
- The hosted prototype runs the same protocol in the page.

Tests: `test/unit/mdl.test.ts` (protocol, verification, server flow) and red-team category G
(forged licence, edited age, copied licence, phishing relay, replay, lending). The product and
hosted-prototype browser tests also cover it.

## Going live

1. **Trust roots.** Put each accepted issuing authority's IACA root certificate (PEM) in
   `config/mdl-trust/`. US and Canadian roots come from AAMVA's Digital Trust Service (an
   agreement with AAMVA). Turn test IDs off (`MDL_ACCEPT_TEST_IDS=0`, or no demo mode).
2. **Wallet registration.** Apple's and Google's wallets may require a registered verifier and a
   signed request (ISO 18013-5 reader authentication) before they answer a website. This
   prototype sends unsigned requests. Check each wallet's current requirements.
3. **HTTPS and a fixed origin.** The answer is bound to `APP_ORIGIN`; serve the app on that exact
   HTTPS origin.
4. **Revocation and freshness.** The licence's own validity period caps the Pass's lifetime.
   Checking a licence's status list (if the state publishes one) is not implemented.
5. **Licences without age answers.** Most mobile licences carry `age_over_18` and `age_over_21`.
   For one that does not, decID refuses rather than asking for the birth date. A deployment could
   choose to request `birth_date` and discard it after computing the answers.

## Limits

- Not tested against a production wallet; only against the test wallet and the protocol as
  implemented by the EU reference wallet.
- The device key proves the answer came from the phone the licence was put on, not who is holding
  it. The wallet's own unlock (Face ID, fingerprint or passcode) is what ties it to the person.
- Not a compliance product, not audited.
