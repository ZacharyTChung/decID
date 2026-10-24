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

type Auth = "public" | "holder" | "issuer" | "apiKey" | "business";
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
  { method: "post", path: "/api/holder/mdl/requests", operationId: "postMdlRequest", summary: "Ask the government ID in the phone's wallet for over-18 / over-21 only (ISO 18013-7 Annex C request for the Digital Credentials API)", auth: "holder", rateLimitPerMinute: 20, responses: { 201: { description: "Request for the wallet", schema: res.MdlRequestResponse } } },
  { method: "post", path: "/api/holder/mdl/requests/{id}/response", operationId: "postMdlResponse", summary: "The wallet's encrypted answer: verify the issuing authority's and the phone's signatures, then issue the Pass (one licence, one active Pass)", auth: "holder", rateLimitPerMinute: 20, body: req.MdlResponseBody, responses: { 200: { description: "Issued", schema: res.MdlIssuanceResponse } } },
  { method: "get", path: "/api/issuer/requests", operationId: "getIssuerRequests", summary: "Pending applications", auth: "issuer", responses: { 200: { description: "Pending requests", schema: res.PendingRequestsResponse } } },
  { method: "post", path: "/api/issuer/requests/{id}/decision", operationId: "postIssuerDecision", summary: "Approve (issue credential + EIP-712 authorization) or reject", auth: "issuer", body: req.ReviewDecisionRequest, responses: { 200: { description: "Decision recorded", schema: res.DecisionResponse } } },
  { method: "get", path: "/api/issuer/credentials", operationId: "getIssuedCredentials", summary: "Issuance log with live on-chain status", auth: "issuer", responses: { 200: { description: "Issued credentials", schema: res.IssuedCredentialsResponse } } },
  { method: "post", path: "/api/issuer/credentials/revoke", operationId: "postRevoke", summary: "Revoke a registered credential on-chain", auth: "issuer", body: req.RevokeRequest, responses: { 200: { description: "Revocation transaction mined", schema: res.RevokeResponse } } },
  { method: "get", path: "/api/issuer/audit", operationId: "getIssuerAudit", summary: "Newest audit entries and verification of the whole hash chain", auth: "issuer", responses: { 200: { description: "Audit log", schema: res.AuditResponse } } },
  { method: "post", path: "/api/verifier/challenges", operationId: "postChallenge", summary: "Create a single-use, audience-bound presentation challenge", auth: "public", rateLimitPerMinute: 30, body: req.ChallengeRequest, responses: { 201: { description: "Challenge", schema: res.ChallengeResponseSchema } } },
  { method: "post", path: "/api/verifier/presentations", operationId: "postPresentation", summary: "Verify a presentation against a challenge", auth: "public", rateLimitPerMinute: 30, body: req.PresentationSubmission, responses: { 200: { description: "Verified", schema: res.VerificationResponse }, 422: { description: "Not verified; `checks` names the failing property", schema: res.VerificationResponse } } },
  { method: "get", path: "/api/verifier/history", operationId: "getVerifierHistory", summary: "Recent verifications (reference, action, time, outcome code only)", auth: "public", rateLimitPerMinute: 60, responses: { 200: { description: "Activity", schema: res.VerifierHistoryResponse } } },

  // decID Verify: the business API (server to server, API key).
  { method: "post", path: "/api/v1/verifications", operationId: "postVerification", summary: "Ask one question (a policy) of a person; returns a wallet link to show as a button or QR code", auth: "apiKey", rateLimitPerMinute: 600, body: req.CreateVerificationRequest, responses: { 201: { description: "Verification created (pending)", schema: res.VerificationResponseV1 } } },
  { method: "get", path: "/api/v1/verifications/{id}", operationId: "getVerification", summary: "The answer: status, the one boolean, match code and signed receipt. No personal data.", auth: "apiKey", rateLimitPerMinute: 3000, responses: { 200: { description: "Verification", schema: res.VerificationResponseV1 } } },
  { method: "get", path: "/api/v1/receipt-keys", operationId: "getReceiptKeys", summary: "Public keys that sign compliance receipts (JWKS)", auth: "public", responses: { 200: { description: "JWKS", schema: res.ReceiptKeysResponse } } },
  // decID Verify: the holder's wallet side.
  { method: "get", path: "/api/v1/verifications/{id}/request", operationId: "getWalletRequest", summary: "For the holder's wallet: who is asking, what, and the challenge to sign", auth: "public", rateLimitPerMinute: 600, responses: { 200: { description: "Request", schema: res.WalletRequestResponse } } },
  { method: "post", path: "/api/v1/verifications/{id}/presentation", operationId: "postWalletPresentation", summary: "The holder's answer: SD-JWT credential, the requested disclosure, and a wallet signature. Single use.", auth: "public", rateLimitPerMinute: 300, body: req.WalletPresentation, responses: { 200: { description: "Outcome", schema: res.PresentationOutcome }, 410: { description: "The request expired", schema: res.ErrorBody } } },
  // decID Pass.
  { method: "get", path: "/api/pass/registration", operationId: "getPassRegistration", summary: "Nonce and fees for the holder's registration transaction (gas is sponsored)", auth: "holder", responses: { 200: { description: "Parameters", schema: res.PassRegistrationParams } } },
  { method: "post", path: "/api/pass/registration", operationId: "postPassRegistration", summary: "Relay a holder-signed register(...) transaction, topping up its gas (local chain only)", auth: "holder", rateLimitPerMinute: 20, body: req.PassRegistrationRequest, responses: { 200: { description: "Relayed", schema: res.PassRegistrationResult } } },
  { method: "post", path: "/api/pass/passkey/options", operationId: "postPasskeyOptions", summary: "WebAuthn registration options for device unlock (platform passkey, user verification required)", auth: "holder", rateLimitPerMinute: 20, responses: { 200: { description: "Creation options", schema: res.PasskeyOptionsResponse } } },
  { method: "post", path: "/api/pass/passkey", operationId: "postPasskey", summary: "Register the Pass's platform passkey (only its public key is stored)", auth: "holder", rateLimitPerMinute: 20, body: req.PasskeyRegistrationRequest, responses: { 201: { description: "Registered", schema: res.PasskeyRegisteredResponse } } },
  { method: "get", path: "/api/pass/credential-status/{commitment}", operationId: "getPassCredentialStatus", summary: "Live registry status of a commitment", auth: "public", rateLimitPerMinute: 600, responses: { 200: { description: "Status", schema: res.PassCredentialStatus } } },
  // Business dashboard.
  { method: "post", path: "/api/business/session", operationId: "postBusinessSession", summary: "Sign in to the dashboard with an API key (sets an HttpOnly cookie)", auth: "public", rateLimitPerMinute: 20, body: req.BusinessLoginRequest, responses: { 200: { description: "Signed in", schema: res.BusinessSessionResponse } } },
  { method: "post", path: "/api/business/logout", operationId: "postBusinessLogout", summary: "Sign out of the dashboard", auth: "business", responses: { 200: { description: "Signed out", schema: res.OkResponse } } },
  { method: "get", path: "/api/business/receipts/export", operationId: "getBusinessReceiptExport", summary: "Export every signed receipt for an auditor (verifiable without decID's database)", auth: "business", responses: { 200: { description: "Receipt export", schema: res.ReceiptExportResponse } } },
  { method: "get", path: "/api/business/risk", operationId: "getBusinessRisk", summary: "Fraud signals across recent checks: pass-back, repeat orders, forged, borrowed or revoked Passes, unusual rates", auth: "business", responses: { 200: { description: "Signals", schema: res.RiskResponse } } },
  { method: "post", path: "/api/business/assistant", operationId: "postBusinessAssistant", summary: "Compliance assistant: answers from the business's own checks, receipts and anchor, citing receipts", auth: "business", rateLimitPerMinute: 60, body: req.AssistantRequest, responses: { 200: { description: "Answer", schema: res.AssistantAnswerResponse } } },
  { method: "get", path: "/api/business/overview", operationId: "getBusinessOverview", summary: "Volume, outcomes, receipt-chain check and the fields a verification record holds", auth: "business", responses: { 200: { description: "Overview", schema: res.BusinessOverviewResponse } } },
  // Demo businesses (DEMO_MODE=1), built on the public SDK.
  { method: "post", path: "/api/demo/business-session", operationId: "postDemoBusinessSession", summary: "Demo only: open a demo business's dashboard without its key", auth: "public", rateLimitPerMinute: 20, body: req.DemoBusinessLoginRequest, responses: { 200: { description: "Signed in", schema: res.BusinessSessionResponse } } },
  { method: "post", path: "/api/demo/test-licence", operationId: "postTestLicence", summary: "Demo and development only: a synthetic licence from the test DMV, for the test wallet", auth: "public", rateLimitPerMinute: 20, body: req.TestLicenceBody, responses: { 201: { description: "Test licence", schema: res.TestLicenceResponse } } },
  { method: "post", path: "/api/demo/{merchant}/sessions", operationId: "postDemoSession", summary: "Demo business backend: start an age check (calls decID Verify with its own key)", auth: "public", rateLimitPerMinute: 300, body: req.DemoSessionRequest, responses: { 201: { description: "Age check started", schema: res.DemoSessionCreated } } },
  { method: "get", path: "/api/demo/{merchant}/sessions/{id}", operationId: "getDemoSession", summary: "Demo business backend: the outcome, with the receipt verified", auth: "public", rateLimitPerMinute: 3000, responses: { 200: { description: "Outcome", schema: res.DemoSessionStatus } } },
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
    if (op.method === "post" && op.auth !== "apiKey") errors.push([403, "Origin is not APP_ORIGIN, or the session lacks the role"]);
    if (op.auth === "holder" || op.auth === "issuer") errors.push([401, "No valid session"], [403, "Session has the wrong role or is not an allowlisted operator"]);
    if (op.auth === "apiKey") errors.push([401, "Missing or invalid API key"]);
    if (op.auth === "business") errors.push([401, "Not signed in to the business dashboard"]);
    if (op.path.includes("{")) errors.push([404, "Unknown resource"], [409, "Not in a state that allows this"]);
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
      security: op.auth === "public" ? [] : op.auth === "apiKey" ? [{ apiKey: [] }] : op.auth === "business" ? [{ business: [] }] : [{ session: [] }],
      ...(op.auth === "holder" || op.auth === "issuer" ? { "x-required-role": op.auth } : {}),
      ...(op.path.includes("{")
        ? {
            parameters: [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
              name: m[1],
              in: "path",
              required: true,
              schema: m[1] === "id" ? { type: "string", format: "uuid" } : m[1] === "commitment" ? { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } : { type: "string", enum: ["hopline", "neonhall"] },
            })),
          }
        : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: schema(op.body, "input") } } } } : {}),
      responses: Object.fromEntries(Object.entries(responses).sort(([a], [b]) => Number(a) - Number(b))),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "decID API (protocol, decID Verify, decID Pass)",
      version: "0.1.0",
      description:
        "Local prototype API (simulated issuer, synthetic data only, not production-ready). Every non-GET request must send `Origin` equal to APP_ORIGIN and a JSON body of at most 32 KiB. Generated by `npm run openapi` from the zod schemas in src/lib/shared; do not edit by hand.",
    },
    servers: [{ url: "http://localhost:3000" }],
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "did_mvp_sid", description: "HttpOnly, SameSite=Strict session cookie from POST /api/auth/verify" },
        apiKey: { type: "http", scheme: "bearer", description: "decID Verify secret key (dk_test_…). Server to server only; no Origin header required." },
        business: { type: "apiKey", in: "cookie", name: "decid_biz", description: "Business dashboard session from POST /api/business/session" },
      },
      schemas: { Error: schema(res.ErrorBody, "output") },
    },
    paths,
  };
}
