import "server-only";
import { z } from "zod";
import {
  ChallengeRequest,
  PresentationSubmission,
  ReviewDecisionRequest,
  RevokeRequest,
  SignInChallengeRequest,
  SignInVerifyRequest,
  HolderRequestBody,
  type PublicConfigResponse,
} from "../../shared/api";
import { appConfig, demoMode, issuerAutoApprove } from "../config";
import { loadDeployment } from "../chain";
import { ApiError, json, readJson, route } from "../http";
import {
  clearedSessionCookie,
  createSignInMessage,
  currentSession,
  destroySession,
  requireSession,
  verifySignIn,
} from "../auth/session";
import * as issuer from "../issuer/service";
import * as verifier from "../verifier/service";
import { listAudit, verifyAuditChain } from "../issuer/audit";
import { loadTrustedIssuers } from "../trust";

/**
 * All API handlers, grouped by module. Route files under src/app/api only
 * re-export these. Each handler goes through `route()` (origin check, rate
 * limit, error mapping) and enforces authorization on the server.
 */

const RequestId = z.string().uuid();
function requestIdParam(id: string | undefined): string {
  const parsed = RequestId.safeParse(id);
  if (!parsed.success) throw new ApiError(400, "BAD_REQUEST_ID", "invalid request id");
  return parsed.data;
}

// ---------------------------------------------------------------- public config

export const getConfig = route(async () => {
  const d = loadDeployment();
  const body: PublicConfigResponse = {
    chainId: d.chainId,
    registry: d.registry,
    gate: d.gate,
    deploymentId: d.deploymentId,
    schemaId: d.schemaId,
    rpcUrl: appConfig().rpcUrl,
    origin: appConfig().origin,
    demo: demoMode(),
    issuers: loadTrustedIssuers().map((i) => ({
      id: i.id,
      name: i.name,
      credentialKeys: i.credentialKeys.map((k) => ({ did: k.did, status: k.status, activatedAt: k.activatedAt, retiredAt: k.retiredAt })),
      evmAttestationSigners: i.evmAttestationSigners.map((e) => ({ address: e.address, status: e.status, activatedAt: e.activatedAt, retiredAt: e.retiredAt })),
    })),
  };
  return json(body);
});

// ---------------------------------------------------------------- auth

export const postSignInChallenge = route(
  async (req) => {
    const body = await readJson(req, SignInChallengeRequest);
    return json({ message: createSignInMessage(body.address, body.chainId, body.role) });
  },
  { rateLimit: { name: "auth", perMinute: 30 } },
);

export const postSignInVerify = route(
  async (req) => {
    const body = await readJson(req, SignInVerifyRequest);
    const { session, cookie } = await verifySignIn(body.message, body.signature);
    return json({ session }, { headers: { "set-cookie": cookie } });
  },
  { rateLimit: { name: "auth", perMinute: 30 } },
);

export const getSession = route(async (req) => json({ session: currentSession(req) ?? null }));

export const postLogout = route(async (req) => {
  destroySession(req);
  return json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie() } });
});

// ---------------------------------------------------------------- holder

export const postHolderRequest = route(
  async (req) => {
    const session = requireSession(req, "holder");
    // The holder address comes from the authenticated session, never from the form.
    const { recoveryOf, ...application } = await readJson(req, HolderRequestBody);
    const created = issuer.submitRequest(session, application, recoveryOf);
    // Demo issuer: approve at once (a server-side policy decision, logged in the audit chain as
    // "auto-approval"). Recovery requests always wait for a human operator.
    if (issuerAutoApprove() && !recoveryOf) {
      await issuer.approveRequest({ address: "auto-approval", chainId: session.chainId, role: "issuer", expiresAt: session.expiresAt }, created.id);
      return json({ ...created, status: "approved" }, { status: 201 });
    }
    return json(created, { status: 201 });
  },
  { rateLimit: { name: "holder-request", perMinute: 10 } },
);

export const getHolderRequests = route(async (req) => {
  const session = requireSession(req, "holder");
  return json({ requests: issuer.listHolderRequests(session) });
});

export async function postBundlePickup(req: Request, id: string | undefined): Promise<Response> {
  return route(async (r) => {
    const session = requireSession(r, "holder");
    return json({ bundle: issuer.pickupBundle(session, requestIdParam(id)) });
  })(req);
}

// ---------------------------------------------------------------- issuer

export const getIssuerRequests = route(async (req) => {
  const session = requireSession(req, "issuer");
  return json({ requests: issuer.listPendingRequests(session) });
});

export async function postIssuerDecision(req: Request, id: string | undefined): Promise<Response> {
  return route(async (r) => {
    const session = requireSession(r, "issuer");
    const requestId = requestIdParam(id);
    const body = await readJson(r, ReviewDecisionRequest);
    if (body.decision === "reject") {
      issuer.rejectRequest(session, requestId, body.reason);
      return json({ status: "rejected" });
    }
    const result = await issuer.approveRequest(session, requestId);
    return json({ status: "approved", ...result });
  })(req);
}

export const getIssuedCredentials = route(async (req) => {
  const session = requireSession(req, "issuer");
  return json({ credentials: await issuer.listIssuedCredentials(session) });
});

export const postRevoke = route(async (req) => {
  const session = requireSession(req, "issuer");
  const body = await readJson(req, RevokeRequest);
  return json(await issuer.revokeCredential(session, body.commitment));
});

// ---------------------------------------------------------------- verifier

export const postChallenge = route(
  async (req) => {
    const body = await readJson(req, ChallengeRequest);
    return json(verifier.createChallenge(body.action), { status: 201 });
  },
  { rateLimit: { name: "verifier-challenge", perMinute: 30 } },
);

export const postPresentation = route(
  async (req) => {
    const body = await readJson(req, PresentationSubmission);
    const result = await verifier.verifyPresentation(body);
    return json(result, { status: result.verified ? 200 : 422 });
  },
  { rateLimit: { name: "verifier-presentation", perMinute: 30 } },
);

export const getVerifierHistory = route(async () => json({ entries: verifier.recentVerifications() }), {
  rateLimit: { name: "verifier-history", perMinute: 60 },
});

export const getIssuerAudit = route(async (req) => {
  requireSession(req, "issuer");
  return json({ verification: verifyAuditChain(), entries: listAudit(50) });
});

export * from "./product-handlers";
