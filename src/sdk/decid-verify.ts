import { compactVerify, importJWK } from "jose";

/**
 * decID Verify, server-side SDK for businesses. Runs anywhere with `fetch` (Node 18+, edge
 * runtimes). Keep the API key on your server: it never belongs in a browser.
 *
 *   const decid = new DecidVerify({ apiKey: process.env.DECID_API_KEY!, baseUrl: "https://verify.example" });
 *   const v = await decid.createVerification({ policy: "age_over_21", reference: "order-1042" });
 *   // send the customer to v.walletUrl (same device) or show it as a QR code (other device)
 *   const done = await decid.getVerification(v.id);   // poll until done.status !== "pending"
 *   if (done.status === "verified") { ... done.result.ageOver21 === true ... }
 *   const receipt = await decid.verifyReceipt(done.receipt!); // signed record for your auditors
 *
 * The demo businesses in this repository (src/app/api/demo) are built on this file.
 */

export type Policy = "age_over_21" | "age_over_18" | "identity_verified";
export type Status = "pending" | "processing" | "verified" | "rejected" | "expired";

export interface Verification {
  id: string;
  policy: Policy;
  reference: string | null;
  status: Status;
  walletUrl: string;
  createdAt: number;
  expiresAt: number;
  completedAt: number | null;
  result: { ageOver21?: boolean; ageOver18?: boolean; identityVerified?: boolean } | null;
  failureCode: string | null;
  matchCode: string | null;
  issuer: { name: string } | null;
  receipt: string | null;
}

export interface Receipt {
  sid: string;
  merchant: string;
  ref: string | null;
  policy: Policy;
  outcome: "satisfied" | "not_satisfied";
  failureCode: string | null;
  issuer: { name: string; did: string } | null;
  registry: { chainId: number; address: string; status: string | null };
  evidence: string;
  checkedAt: string;
  seq: number;
  prev: string;
  iat: number;
}

export class DecidVerifyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class DecidVerify {
  private jwks?: { keys: { kid: string; kty: string; crv: string; x: string }[] };
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: { apiKey: string; baseUrl: string; fetch?: typeof fetch }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, auth = true): Promise<T> {
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { ...(auth ? { authorization: `Bearer ${this.opts.apiKey}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
    if (!res.ok) throw new DecidVerifyError(res.status, data.error?.code ?? `HTTP_${res.status}`, data.error?.message ?? `request failed (${res.status})`);
    return data as T;
  }

  createVerification(input: { policy: Policy; reference?: string }): Promise<Verification> {
    return this.call("POST", "/api/v1/verifications", input);
  }

  getVerification(id: string): Promise<Verification> {
    return this.call("GET", `/api/v1/verifications/${encodeURIComponent(id)}`);
  }

  /** Checks a receipt's signature against decID's published keys and returns its contents. */
  async verifyReceipt(jws: string): Promise<Receipt> {
    this.jwks ??= await this.call("GET", "/api/v1/receipt-keys", undefined, false);
    const header = JSON.parse(atob(jws.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/")));
    if (header.typ !== "decid-receipt+jwt" || header.alg !== "Ed25519") throw new Error("not a decID receipt");
    const jwk = this.jwks!.keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error("receipt signed with an unknown key");
    const { payload } = await compactVerify(jws, await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x }, "Ed25519"), { algorithms: ["Ed25519"] });
    return JSON.parse(new TextDecoder().decode(payload)) as Receipt;
  }
}
