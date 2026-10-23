import { z } from "zod";
import * as req from "../../src/lib/shared/api";
import * as res from "../../src/lib/shared/api-responses";

/**
 * The OpenAPI 3.1 description of the app's HTTP API, built from the same zod schemas the
 * handlers validate requests with (src/lib/shared/api.ts) and the conformance test checks
 * responses with (src/lib/shared/api-responses.ts). `npm run openapi` writes docs/openapi.json;
 * `npm run typecheck` fails if that file is stale, and test/unit/openapi.test.ts fails if a
 * route exists on disk without being described here (or the other way round).
 */

type Auth = "public" | "holder" | "issuer";
export interface Operation {
  method: "get" | "post";
  path: string;
  operationId: string;
  summary: string;
  auth: Auth;
  rateLimitPerMinute?: number;
  body?: z.ZodType;
  responses: Record<number, { description: string; schema: z.ZodType }>;
}

export const OPERATIONS: Operation[] = [
  { method: "get", path: "/api/config", operationId: "getConfig", summary: "Deployment addresses, chain and trusted issuers' public keys", auth: "public", responses: { 200: { description: "Public configuration", schema: res.ConfigResponse } } },
  { method: "post", path: "/api/auth/challenge", operationId: "postSignInChallenge", summary: "Server-built SIWE message with a single-use nonce", auth: "public", rateLimitPerMinute: 30, body: req.SignInChallengeRequest, responses: { 200: { description: "Message to sign", schema: res.SignInMessageResponse } } },
  { method: "post", path: "/api/auth/verify", operationId: "postSignInVerify", summary: "Verify the signed SIWE message and start a session (sets an HttpOnly cookie)", auth: "public", rateLimitPerMinute: 30, body: req.SignInVerifyRequest, responses: { 200: { description: "Session created", schema: res.SignInResponse } } },
  { method: "get", path: "/api/auth/session", operationId: "getSession", summary: "Current session, if any", auth: "public", responses: { 200: { description: "Session or null", schema: res.SessionResponse } } },
  { method: "post", path: "/api/auth/logout", operationId: "postLogout", summary: "End the session", auth: "public", responses: { 200: { description: "Logged out", schema: res.OkResponse } } },
  { method: "get", path: "/api/holder/requests", operationId: "getHolderRequests", summary: "The signed-in holder's own requests", auth: "holder", responses: { 200: { description: "Requests", schema: res.HolderRequestsResponse } } },
  { method: "post", path: "/api/holder/requests", operationId: "postHolderRequest", summary: "Submit a synthetic application (optionally a recovery of a lost wallet)", auth: "holder", rateLimitPerMinute: 10, body: req.HolderRequestBody, responses: { 201: { description: "Request created", schema: res.CreatedRequestResponse } } },
  { method: "post", path: "/api/holder/requests/{id}/bundle", operationId: "postBundlePickup", summary: "One-time pickup of the private credential bundle", auth: "holder", responses: { 200: { description: "Bundle (deleted on the server afterwards)", schema: res.BundleResponse } } },
  { method: "get", path: "/api/issuer/requests", operationId: "getIssuerRequests", summary: "Pending applications", auth: "issuer", responses: { 200: { description: "Pending requests", schema: res.PendingRequestsResponse } } },
  { method: "post", path: "/api/issuer/requests/{id}/decision", operationId: "postIssuerDecision", summary: "Approve (issue credential + EIP-712 authorization) or reject", auth: "issuer", body: req.ReviewDecisionRequest, responses: { 200: { description: "Decision recorded", schema: res.DecisionResponse } } },
  { method: "get", path: "/api/issuer/credentials", operationId: "getIssuedCredentials", summary: "Issuance log with live on-chain status", auth: "issuer", responses: { 200: { description: "Issued credentials", schema: res.IssuedCredentialsResponse } } },
  { method: "post", path: "/api/issuer/credentials/revoke", operationId: "postRevoke", summary: "Revoke a registered credential on-chain", auth: "issuer", body: req.RevokeRequest, responses: { 200: { description: "Revocation transaction mined", schema: res.RevokeResponse } } },
  { method: "get", path: "/api/issuer/audit", operationId: "getIssuerAudit", summary: "Newest audit entries and verification of the whole hash chain", auth: "issuer", responses: { 200: { description: "Audit log", schema: res.AuditResponse } } },
  { method: "post", path: "/api/verifier/challenges", operationId: "postChallenge", summary: "Create a single-use, audience-bound presentation challenge", auth: "public", rateLimitPerMinute: 30, body: req.ChallengeRequest, responses: { 201: { description: "Challenge", schema: res.ChallengeResponseSchema } } },
  { method: "post", path: "/api/verifier/presentations", operationId: "postPresentation", summary: "Verify a presentation against a challenge", auth: "public", rateLimitPerMinute: 30, body: req.PresentationSubmission, responses: { 200: { description: "Verified", schema: res.VerificationResponse }, 422: { description: "Not verified; `checks` names the failing property", schema: res.VerificationResponse } } },
  { method: "get", path: "/api/verifier/history", operationId: "getVerifierHistory", summary: "Recent verifications (reference, action, time, outcome code only)", auth: "public", rateLimitPerMinute: 60, responses: { 200: { description: "Activity", schema: res.VerifierHistoryResponse } } },
];

const schema = (s: z.ZodType, io: "input" | "output") => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io, unrepresentable: "throw" }) as Record<string, unknown>;
  return rest;
};

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const responses: Record<string, unknown> = {};
    for (const [status, r] of Object.entries(op.responses)) {
      responses[status] = { description: r.description, content: { "application/json": { schema: schema(r.schema, "output") } } };
    }
    const errors: [number, string][] = [[500, "Internal error (no stack traces)"]];
    if (op.body) errors.push([400, "Invalid JSON or schema violation (names fields, never values)"], [413, "Body over 32 KiB"]);
    if (op.method === "post") errors.push([403, "Origin is not APP_ORIGIN, or the session lacks the role"]);
    if (op.auth !== "public") errors.push([401, "No valid session"], [403, "Session has the wrong role or is not an allowlisted operator"]);
    if (op.path.includes("{id}")) errors.push([404, "Unknown request"], [409, "Request not in a state that allows this"]);
    if (op.rateLimitPerMinute) errors.push([429, `Rate limit (${op.rateLimitPerMinute} per minute)`]);
    for (const [status, description] of errors) {
      const key = String(status);
      responses[key] ??= { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    }
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: [op.path.split("/")[2]],
      security: op.auth === "public" ? [] : [{ session: [] }],
      ...(op.auth !== "public" ? { "x-required-role": op.auth } : {}),
      ...(op.path.includes("{id}") ? { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }] } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schema(op.body, "input") } } } } : {}),
      responses: Object.fromEntries(Object.entries(responses).sort(([a], [b]) => Number(a) - Number(b))),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Decentralized Identity MVP API",
      version: "0.1.0",
      description:
        "Local prototype API (simulated issuer, synthetic data only, not production-ready). Every non-GET request must send `Origin` equal to APP_ORIGIN and a JSON body of at most 32 KiB. Generated by `npm run openapi` from the zod schemas in src/lib/shared; do not edit by hand.",
    },
    servers: [{ url: "http://localhost:3000" }],
    components: {
      securitySchemes: { session: { type: "apiKey", in: "cookie", name: "did_mvp_sid", description: "HttpOnly, SameSite=Strict session cookie from POST /api/auth/verify" } },
      schemas: { Error: schema(res.ErrorBody, "output") },
    },
    paths,
  };
}
