import path from "node:path";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider } from "ethers";
import * as h from "@/lib/server/api/handlers";
import { CREDENTIAL_REGISTRY_ABI } from "@/generated/contracts";
import type { HolderBundle } from "@/lib/shared/bundle";
import type { ChallengeResponse } from "@/lib/shared/api";
import { Actor, signIn, signPresentation, submission } from "./helpers/actors";

/**
 * Chain outage: the verifier must fail CLOSED (never "verified" without the live registry
 * read), the issuer must not half-issue, and everything must work again once the RPC returns.
 */
const DEAD_RPC = "http://127.0.0.1:9"; // discard port: connection refused
let provider: JsonRpcProvider;
let liveRpc: string;
const holder = new Actor(9);
const issuer = new Actor(1);
let bundle: HolderBundle;

const application = (doc: string) => ({ fullName: "Outage Sentinel", dateOfBirth: "1980-01-01", documentNumber: doc, country: "ZZ", syntheticDataConfirmed: true });

beforeAll(async () => {
  const dir = path.join(process.cwd(), ".test-data", "resilience");
  rmSync(dir, { recursive: true, force: true });
  process.env.DATA_DIR = dir;
  liveRpc = process.env.RPC_URL!;
  provider = new JsonRpcProvider(liveRpc, undefined, { cacheTimeout: -1 });
  expect((await signIn(holder, "holder", h)).status).toBe(200);
  expect((await signIn(issuer, "issuer", h)).status).toBe(200);
  const req = await holder.call(h.postHolderRequest, "POST", application("SYN-OUTAGE1"));
  expect((await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" })).status).toBe(200);
  bundle = (await holder.call((r) => h.postBundlePickup(r, req.body.id), "POST", {})).body.bundle;
  const registry = new Contract(bundle.deployment.registry, CREDENTIAL_REGISTRY_ABI, holder.wallet.connect(provider));
  await (await registry.getFunction("register")(bundle.authorization, bundle.authorizationSignature)).wait();
});

afterAll(() => {
  process.env.RPC_URL = liveRpc;
  provider.destroy();
});

async function present() {
  const c = (await holder.call(h.postChallenge, "POST", { action: "access-verified-member-area" })).body as ChallengeResponse;
  return holder.call(h.postPresentation, "POST", submission(c, bundle, await signPresentation(holder, c, bundle)));
}

describe("chain outage", () => {
  it("verifier fails closed with RPC_UNAVAILABLE, after every offline check passed", async () => {
    process.env.RPC_URL = DEAD_RPC;
    const res = await present();
    expect(res.status).toBe(422);
    expect(res.body.verified).toBe(false);
    const registry = res.body.checks.find((c: { id: string }) => c.id === "registry");
    expect(registry).toMatchObject({ status: "fail", code: "RPC_UNAVAILABLE" });
    // Everything that does not need the chain still ran and passed.
    expect(res.body.checks.filter((c: { status: string }) => c.status === "pass").length).toBe(res.body.checks.length - 1);
  });

  it("issuer approval fails with 503 and leaves the request pending (no half-issued credential)", async () => {
    const req = await holder.call(h.postHolderRequest, "POST", application("SYN-OUTAGE2"));
    const res = await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("RPC_UNAVAILABLE");
    const mine = (await holder.call(h.getHolderRequests, "GET")).body.requests.find((r: { id: string }) => r.id === req.body.id);
    expect(mine).toMatchObject({ status: "pending", bundleAvailable: false });

    // RPC back: the same request is approved normally.
    process.env.RPC_URL = liveRpc;
    expect((await issuer.call((r) => h.postIssuerDecision(r, req.body.id), "POST", { decision: "approve" })).status).toBe(200);
  });

  it("verification works again once the RPC is back", async () => {
    process.env.RPC_URL = liveRpc;
    const res = await present();
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });
});
