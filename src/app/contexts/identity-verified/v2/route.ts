import { IDENTITY_CONTEXT_DOCUMENT } from "@/lib/shared/credential-profile";
// Read-only copy of the bundled JSON-LD context, for inspection. Verifiers never fetch it.
export const GET = () => Response.json(IDENTITY_CONTEXT_DOCUMENT, { headers: { "content-type": "application/ld+json" } });
