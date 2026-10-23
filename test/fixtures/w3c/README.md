# Vendored W3C files (test fixtures only)

Copied unmodified from https://github.com/w3c/vc-data-model (branch `main`) on 2026-10-23:

| File | Source path | Used by |
| --- | --- | --- |
| `credentials-v2.context.json` | `contexts/credentials/v2` (the `https://www.w3.org/ns/credentials/v2` context) | `test/unit/w3c-conformance.test.ts`: JSON-LD safe-mode expansion |
| `verifiable-credential-schema.json` | `schema/verifiable-credential/verifiable-credential-schema.json` | same test: JSON Schema validation |

Vendored so the tests never fetch anything at run time. The app itself never loads JSON-LD contexts.
W3C documents are © W3C, distributed under the W3C Software and Document License.
