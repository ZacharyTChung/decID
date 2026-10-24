# Fraud signals, device unlock and the compliance assistant

Three features that sit on top of the age check. None of them needs personal data.

## Fraud signals

decID Verify watches each business's own checks for known abuse and for unusual rates. Code:
`src/lib/shared/risk.ts`, which the server and the hosted prototype share.

| Signal | Rule | Severity |
| --- | --- | --- |
| Pass-back (venue) | The same Pass admitted twice within 30 minutes | High |
| Repeat orders (online) | Four or more checks by one Pass within an hour | Medium |
| Forgery probing | Three or more forged or edited presentations (bad signature, untrusted issuer, commitment mismatch, …) within 15 minutes | High |
| Someone else's Pass | The credential belongs to a different phone than the one that answered | High |
| Revoked Pass | A Pass its owner reported lost or stolen | Medium |
| Under-age spike | Under-age attempts in the last hour well above this business's normal rate (Poisson tail p < 1%) | Medium |
| Traffic spike | Checks in the last hour far above normal (p < 0.1%, at least 3× normal) | Low |

- **Where it shows:**
  - on the answer itself (`risk` on `GET /api/v1/verifications/{id}`, so the door kiosk warns "Same Pass admitted again");
  - on the dashboard's Risk page (`GET /api/business/risk`);
  - in the assistant.
- **Evidence:** every alert names the checks and signed receipts it is based on.
- **Signals never refuse anyone on their own.** Forged, borrowed and revoked Passes are already refused by the cryptographic checks. Signals tell staff what to look at.
- **Privacy:** to recognise the same Pass, each check stores `pass_tag`, a pseudonym of the Pass:
  - computed as HMAC(decID secret, business | credential commitment | UTC day);
  - stable only at one business for one day;
  - cleared after 48 hours;
  - not linkable to other businesses or to the person.

  It is listed among the stored fields on the Data & privacy page.
- **What this is, technically:** rules plus classical statistics, not machine learning. That keeps every signal explainable and reproducible from the receipts. A trained model could be added later behind the same interface.

## Device unlock (Face ID, fingerprint or PIN)

The Pass can require the phone's owner to unlock it for every share. Code: `src/lib/server/pass/passkey.ts` and `src/lib/shared/unlock.ts`. The client uses `@simplewebauthn/browser`.

- **Enrolment:** the Pass registers a platform passkey (WebAuthn, user verification required).
  - decID stores only the passkey's public key, tied to the Pass's wallet address.
  - The biometric never leaves the phone.
- **At a share:** the Pass asks the authenticator for an assertion over
  `SHA-256("decid-unlock|" + session id + "|" + nonce)`. The assertion is therefore bound to that one check.
  - decID verifies it against the passkeys of the holder whose presentation just verified, checking:
    - the user-verified flag;
    - origin and RP ID;
    - the signature counter.
  - The result is `userVerified`, which appears on the check, in the signed receipt and on the door kiosk.
- **Requiring it:** a business can require it per check (`requireUserVerification: true`). The demo door has a switch for it. Without a valid unlock the answer is refused with `USER_NOT_VERIFIED`.
- **What it proves:** that someone enrolled on that phone unlocked it, by face, fingerprint or PIN; WebAuthn does not say which. It does not prove who that person is. A family member enrolled on the phone could unlock it.
- **Where it works:** it needs HTTPS or localhost. The hosted prototype simulates it, and says so, because passkeys don't work inside the hosting frame.

## Compliance assistant

The dashboard's Assistant page answers a business's questions from its own records. Code: `src/lib/shared/assistant.ts`; API: `POST /api/business/assistant`.

- **Questions it understands:**
  - "How many checks today?";
  - "Why were people refused?";
  - "Was order HL-4821 age-checked?";
  - "Is our record intact?";
  - "Anything suspicious?";
  - "What data do you keep?";
  - "An inspector wants evidence";
  - "Write this week's compliance report".
- **How answers are built:**
  - Every number is computed from the checks, the receipt chain (signatures and links) and the on-chain anchor.
  - Every answer cites the receipts it used.
  - Intent recognition is pattern-based, and there is no language model, so it cannot invent a figure.
  - A language model could later rephrase answers. It would be given only these computed, receipt-cited facts.
- **Isolation:** a business only ever sees its own records. Red-team H6 checks this.
- **Not legal advice.** The report says so.

## Tests

- `test/unit/trust-features.test.ts`: real presentations, real WebAuthn verification (a software authenticator), the receipt chain, and the pure rules.
- Red-team H1–H6: someone else's passkey, a replayed unlock, presence without user verification, pass-back, unauthenticated access, and a cross-tenant assistant question.
- The product browser test, using Chromium's virtual authenticator as the phone's Face ID:
  - the door requires unlock;
  - Share stays disabled until the Pass turns it on;
  - the pass-back warning appears at the door and on the Risk page;
  - the assistant proves an order.
- The hosted-prototype test covers the busy night: a pass-back, three fake Passes, a borrowed Pass and a revoked one, all flagged.
