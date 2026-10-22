import { credentialJsonSchema } from "@/lib/shared/credential-profile";
// JSON Schema generated from the same zod definition the verifier enforces.
export const GET = () => Response.json(credentialJsonSchema(), { headers: { "content-type": "application/schema+json" } });
