import "server-only";
import QRCode from "qrcode";
import {
  BusinessLoginRequest,
  CreateVerificationRequest,
  DemoBusinessLoginRequest,
  DemoSessionRequest,
  PassRegistrationRequest,
  PasskeyRegistrationRequest,
  AssistantRequest,
  WalletPresentation,
} from "../../shared/api";
import { passkeyRegistrationOptions, registerPasskey } from "../pass/passkey";
import { detectRisk, riskSummary } from "../../shared/risk";
import { answerQuestion } from "../../shared/assistant";
import { appConfig, demoMode } from "../config";
import { readRecord } from "../chain";
import { ApiError } from "../errors";
import { json, readJson, route } from "../http";
import { requireSession } from "../auth/session";
import { relayRegistration, registrationParams } from "../pass/registration";
import {
  createBusinessSession,
  endBusinessSession,
  ensureMerchant,
  merchantByKey,
  requireBusiness,
  requireMerchant,
} from "../verify-api/merchants";
import { exportReceipts, receiptJwks, verifyReceiptChainAnchored } from "../verify-api/receipts";
import { checkRecords, createSession, getSessionForMerchant, listSessions, merchantStats, storedFields, submitPresentation, walletRequest } from "../verify-api/sessions";
import { DecidVerify } from "../../../sdk/decid-verify";
import { friendlyReason } from "../../shared/policies";

/**
 * Product routes: decID Verify (business API), decID Pass (consumer wallet support), the
 * business dashboard, and two demo businesses built on the public SDK.
 */

const sessionId = (id: string | undefined) => {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404, "UNKNOWN_SESSION", "no such verification");
  return id;
};

// ---------------------------------------------------------------- decID Verify: business API (API key)

export const postVerification = route(
  async (req) => {
    const merchant = requireMerchant(req);
    const body = await readJson(req, CreateVerificationRequest);
    return json(createSession(merchant, body.policy, body.reference, { requireUserVerification: body.requireUserVerification }), { status: 201 });
  },
  { csrf: false, rateLimit: { name: "v1-create", perMinute: 600 } },
);

export async function getVerification(req: Request, id: string | undefined): Promise<Response> {
  return route(async (r) => json(getSessionForMerchant(requireMerchant(r), sessionId(id))), { rateLimit: { name: "v1-get", perMinute: 3000 } })(req);
}

export const getReceiptKeys = route(async () => json(await receiptJwks()));

// ---------------------------------------------------------------- decID Verify: wallet side (public)

export async function getWalletRequest(req: Request, id: string | undefined): Promise<Response> {
  return route(async () => json(walletRequest(sessionId(id))), { rateLimit: { name: "v1-request", perMinute: 600 } })(req);
}

export async function postWalletPresentation(req: Request, id: string | undefined): Promise<Response> {
  return route(
    async (r) => {
      const body = await readJson(r, WalletPresentation);
      return json(await submitPresentation(sessionId(id), body));
    },
    { rateLimit: { name: "v1-present", perMinute: 300 } },
  )(req);
}

// ---------------------------------------------------------------- decID Pass (holder session)

export const getPassRegistration = route(async (req) => json(await registrationParams(requireSession(req, "holder"))));

export const postPassRegistration = route(
  async (req) => {
    const session = requireSession(req, "holder");
    const { rawTx } = await readJson(req, PassRegistrationRequest);
    return json(await relayRegistration(session, rawTx));
  },
  { rateLimit: { name: "pass-register", perMinute: 20 } },
);

export async function getPassCredentialStatus(req: Request, commitment: string | undefined): Promise<Response> {
  return route(async () => {
    if (!commitment || !/^0x[0-9a-fA-F]{64}$/.test(commitment)) throw new ApiError(400, "BAD_COMMITMENT", "invalid commitment");
    const rec = await readRecord(commitment);
    return json({ status: rec.exists ? rec.status : "NotRegistered" });
  }, { rateLimit: { name: "pass-status", perMinute: 600 } })(req);
}

// ---------------------------------------------------------------- business dashboard (cookie)

export const postBusinessSession = route(
  async (req) => {
    const { apiKey } = await readJson(req, BusinessLoginRequest);
    const merchant = merchantByKey(apiKey);
    if (!merchant) throw new ApiError(401, "INVALID_API_KEY", "that API key is not valid");
    return json({ merchant: { id: merchant.id, name: merchant.name } }, { headers: { "set-cookie": createBusinessSession(merchant.id) } });
  },
  { rateLimit: { name: "business-login", perMinute: 20 } },
);

export const postBusinessLogout = route(async (req) => json({ ok: true }, { headers: { "set-cookie": endBusinessSession(req) } }));

export const getBusinessOverview = route(async (req) => {
  const merchant = requireBusiness(req);
  return json({
    merchant: { id: merchant.id, name: merchant.name, kind: merchant.kind, keyPrefix: merchant.keyPrefix },
    stats: merchantStats(merchant),
    receipts: await verifyReceiptChainAnchored(merchant.id),
    storedFields: storedFields(),
    recent: listSessions(merchant, 100).map(({ receipt: _r, walletUrl: _w, ...v }) => v),
  });
});

/** Fraud signals across the business's recent checks (shared/risk.ts). */
export const getBusinessRisk = route(async (req) => {
  const merchant = requireBusiness(req);
  const records = checkRecords(merchant.id);
  const alerts = detectRisk(records, merchant.kind, Math.floor(Date.now() / 1000));
  return json({ alerts, summary: riskSummary(alerts), checksAnalysed: records.length, passTagRetentionHours: 48 });
});

// ---------------------------------------------------------------- decID Pass: device unlock (passkey)

export const postPasskeyOptions = route(async (req) => json(await passkeyRegistrationOptions(requireSession(req, "holder"))), { rateLimit: { name: "passkey", perMinute: 20 } });

export const postPasskey = route(
  async (req) => {
    const session = requireSession(req, "holder");
    const { response } = await readJson(req, PasskeyRegistrationRequest);
    return json(await registerPasskey(session, response as never), { status: 201 });
  },
  { rateLimit: { name: "passkey", perMinute: 20 } },
);

/** The compliance assistant: answers from this business's own checks, receipts and anchor (shared/assistant.ts). */
export const postBusinessAssistant = route(
  async (req) => {
    const merchant = requireBusiness(req);
    const { question } = await readJson(req, AssistantRequest);
    const records = checkRecords(merchant.id, 30 * 86400);
    const now = Math.floor(Date.now() / 1000);
    return json(
      answerQuestion(question, {
        merchant: { id: merchant.id, name: merchant.name, kind: merchant.kind },
        records,
        chain: await verifyReceiptChainAnchored(merchant.id),
        alerts: detectRisk(records, merchant.kind, now),
        storedFields: storedFields(),
        now,
        exportHref: "/api/business/receipts/export",
      }),
    );
  },
  { rateLimit: { name: "assistant", perMinute: 60 } },
);

/** The business's receipts for its auditor: verifiable with `npm run verify-receipts` and nothing else. */
export const getBusinessReceiptExport = route(async (req) => {
  const merchant = requireBusiness(req);
  const body = await exportReceipts(merchant);
  return json(body, { headers: { "content-disposition": `attachment; filename="decid-receipts-${merchant.id}-${body.exportedAt.slice(0, 10)}.json"` } });
});

// ---------------------------------------------------------------- demo businesses (built on the SDK)

const DEMO = {
  hopline: { name: "Hopline", kind: "online" as const, policy: "age_over_21" as const, env: "DEMO_HOPLINE_API_KEY" },
  neonhall: { name: "Neon Hall", kind: "venue" as const, policy: "age_over_21" as const, env: "DEMO_NEONHALL_API_KEY" },
};
type DemoId = keyof typeof DEMO;

function demoClient(id: string | undefined): { client: DecidVerify; demo: (typeof DEMO)[DemoId]; id: DemoId } {
  if (!demoMode()) throw new ApiError(404, "DEMO_DISABLED", "demo businesses are off (set DEMO_MODE=1)");
  if (id !== "hopline" && id !== "neonhall") throw new ApiError(404, "UNKNOWN_DEMO", "no such demo business");
  const demo = DEMO[id];
  const apiKey = process.env[demo.env];
  if (!apiKey) throw new ApiError(503, "DEMO_NOT_CONFIGURED", `${demo.env} is not set: start the demo with npm run product`);
  ensureMerchant({ id, name: demo.name, kind: demo.kind, apiKey });
  // The demo backend talks to decID Verify over HTTP, exactly like an outside business would.
  const baseUrl = process.env.DECID_API_BASE || appConfig().origin;
  return { client: new DecidVerify({ apiKey, baseUrl }), demo, id };
}

export async function postDemoSession(req: Request, merchant: string | undefined): Promise<Response> {
  return route(
    async (r) => {
      const { client, demo } = demoClient(merchant);
      const body = await readJson(r, DemoSessionRequest);
      const v = await client.createVerification({ policy: demo.policy, reference: body.reference, requireUserVerification: body.requireUserVerification });
      const qrSvg = await QRCode.toString(v.walletUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return json({ id: v.id, walletUrl: v.walletUrl, qrSvg, expiresAt: v.expiresAt }, { status: 201 });
    },
    { rateLimit: { name: "demo-session", perMinute: 300 } },
  )(req);
}

export async function getDemoSession(req: Request, merchant: string | undefined, id: string | undefined): Promise<Response> {
  return route(
    async () => {
      const { client } = demoClient(merchant);
      const v = await client.getVerification(sessionId(id));
      let receipt: { valid: boolean; payload?: unknown } | null = null;
      if (v.receipt) {
        try {
          receipt = { valid: true, payload: await client.verifyReceipt(v.receipt) };
        } catch {
          receipt = { valid: false };
        }
      }
      return json({ status: v.status, result: v.result, failureCode: v.failureCode, reason: friendlyReason(v.failureCode), matchCode: v.matchCode, issuer: v.issuer, receipt, reference: v.reference, userVerified: v.userVerified, risk: v.risk });
    },
    { rateLimit: { name: "demo-status", perMinute: 3000 } },
  )(req);
}

export const postDemoBusinessSession = route(
  async (req) => {
    const { merchant } = await readJson(req, DemoBusinessLoginRequest);
    demoClient(merchant); // demo mode only; registers the demo business if needed
    return json({ merchant: { id: merchant, name: DEMO[merchant].name } }, { headers: { "set-cookie": createBusinessSession(merchant) } });
  },
  { rateLimit: { name: "business-login", perMinute: 20 } },
);
