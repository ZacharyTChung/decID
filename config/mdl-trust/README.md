# Trusted ID issuers (mobile driving licences)

Put the IACA root certificate of each issuing authority you accept here, one PEM file per
authority (e.g. `us-ca-dmv.pem`). The file name, or a first line `# name: California DMV`, is the
name shown to people and written to the audit log.

Where real roots come from:

- **AAMVA Digital Trust Service (DTS):** the North American list (VICAL) of US state and Canadian
  provincial IACA roots. Access requires an agreement with AAMVA.
- **A state's own publication:** some DMVs publish their IACA certificate for verifiers.
- **Apple / Google wallets:** a licence or passport ID in Apple Wallet or Google Wallet is signed
  by the state (or, for a passport-based ID, by the wallet provider). Accepting those on the web
  also requires registering as a verifier with Apple or Google.

Never put private keys here. This directory only holds public root certificates.

The test root used by `npm run product` and the tests is generated into the data directory
(`.data/mdl-test-authority.json`), not here, and is accepted only when `MDL_ACCEPT_TEST_IDS=1` or
`DEMO_MODE=1`.
