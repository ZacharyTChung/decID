// Browser build only: Digital Bazaar's did:key driver pulls in `base64url`, which expects
// Node's global Buffer. Provide it from the `buffer` package.
import { Buffer } from "buffer";
globalThis.Buffer = globalThis.Buffer ?? Buffer;
