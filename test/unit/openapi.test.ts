import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider } from "ethers";
import type { z } from "zod";
import * as h from "@/lib/server/api/handlers";
import { CREDENTIAL_REGISTRY_ABI } from "@/generated/contracts";
import { ErrorBody } from "@/lib/shared/api-responses";
import type { HolderBundle } from "@/lib/shared/bundle";
import type { ChallengeResponse } from "@/lib/shared/api";
import { buildOpenApi, OPERATIONS, type Operation } from "../../scripts/lib/openapi-spec";
import { Actor, signIn, signPresentation, submission } from "./helpers/actors";

/**
 * The OpenAPI description must match the code, in three ways:
 *  1. every route file on disk is described, and nothing else is;
 *  2. docs/openapi.json is the current output of the generator;
 *  3. every response the real handlers return (success and error) parses with the schema the
 *     description gives for that status. Response schemas are strict, so an undocumented field fails.
 */

const API_DIR = path.join(process.cwd(), "src", "app", "api");

function routesOnDisk(dir = API_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routesOnDisk(full));
    else if (name === "route.ts") {
      const apiPath = "/api/" + path.relative(API_DIR, dir).split(path.sep).map((s) => s.replace(/^\[(\w+)\]$/, "{$1}")).join("/");
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)) out.push(`${m[1]!.toLowerCase()} ${apiPath}`);
    }
  }
  return out.sort();
}

describe("OpenAPI description matches the code", () => {
  it("describes exactly the routes that exist", () => {
    expect(OPERATIONS.map((o) => `${o.method} ${o.path}`).sort()).toEqual(routesOnDisk());
  });

  it("names every operation after its handler", () => {
    for (const op of OPERATIONS) expect(typeof (h as Record<string, unknown>)[op.operationId], op.operationId).toBe("function");
  });

  it("docs/openapi.json is up to date (npm run openapi)", () => {
    expect(JSON.parse(readFileSync(path.join(process.cwd(), "docs", "openapi.json"), "utf8"))).toEqual(buildOpenApi());
  });
});

// ------------------------------------------------------------------ conformance

const DIR = path.join(process.cwd(), ".test-data", "openapi");
let provider: JsonRpcProvider;
const seen = new Map<string, Set<number>>();

const opById = new Map(OPERATIONS.map((o) => [o.operationId, o]));

/** Calls the real handler for an operation and checks the response against the description. */
async function call(actor: Actor, operationId: string, body?: unknown, id?: string) {
  const op = opById.get(operationId) as Operation;
  const handler = (h as unknown as Record<string, (r: Request, id?: string) => Promise<Response>>)[operationId]!;
  const res = await actor.call((r) => handler(r, id), op.method.toUpperCase(), body);
  const documented = op.responses[res.status];
  const schema: z.ZodType = documented ? documented.schema : ErrorBody;
  const parsed = schema.safeParse(res.body);
  expect(parsed.success, `${operationId} ${res.status} does not match its description: ${JSON.stringify(parsed.error?.issues)}\n${JSON.stringify(res.body)}`).toBe(true);
  if (!documented) expect(res.status, `${operationId}: undocumented error status`).toBeGreaterThanOrEqual(400);
  if (!seen.has(operationId)) seen.set(operationId, new Set());
  seen.get(operationId)!.add(res.status);
  return res;
}

beforeAll(() => {
  provider = new JsonRpcProvider(process.env.RPC_URL, undefined, { cacheTimeout: -1 });
  process.env.DATA_DIR = DIR;
});
afterAll(() => provider.destroy());

describe("real responses conform to the description", () => {
  let holder: Actor;
  const issuer = new Actor(1);
  const stranger = new Actor(7);

  it("full lifecycle, success paths", async () => {
    holder = new Actor(6, provider);
    await call(holder, "getConfig");
    await call(holder, "getSession");
    const ch = await call(holder, "postSignInChallenge", { address: holder.address, chainId: 31337, role: "holder" });
    await call(holder, "postSignInVerify", { message: ch.body.message, signature: await holder.wallet.signMessage(ch.body.message) });
    await call(holder, "getSession");
    expect((await signIn(issuer, "issuer", h)).status).toBe(200);

    const app = { fullName: "Openapi Conformance", dateOfBirth: "1990-01-01", documentNumber: "SYN-OPENAPI01", country: "ZZ", syntheticDataConfirmed: true };
    const created = await call(holder, "postHolderRequest", app);
    await call(holder, "getHolderRequests");
    await call(issuer, "getIssuerRequests");
    await call(issuer, "postIssuerDecision", { decision: "approve" }, created.body.id);
    const rejectMe = await call(holder, "postHolderRequest", { ...app, documentNumber: "SYN-OPENAPI02" });
    await call(issuer, "postIssuerDecision", { decision: "reject", reason: "conformance" }, rejectMe.body.id);
    const bundle = (await call(holder, "postBundlePickup", {}, created.body.id)).body.bundle as HolderBundle;

    const deployment = JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE!, "utf8")) as { registry: string };
    await (await (new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, holder.wallet).getFunction("register"))(bundle.authorization, bundle.authorizationSignature)).wait();

    const present = async () => {
      const c = (await call(holder, "postChallenge", { action: "access-verified-member-area" })).body as ChallengeResponse;
      const proof = await signPresentation(holder, c, bundle);
      return call(holder, "postPresentation", submission(c, bundle, proof));
    };
    expect((await present()).status).toBe(200);
    await call(issuer, "getIssuedCredentials");
    await call(issuer, "postRevoke", { commitment: bundle.commitment });
    expect((await present()).status).toBe(422);
    await call(holder, "getVerifierHistory");
    await call(issuer, "getIssuerAudit");
    await call(holder, "postLogout", {});
  });

  it("error paths", async () => {
    await call(stranger, "getHolderRequests"); // 401
    await call(stranger, "postHolderRequest", { fullName: "x" }); // 401 before validation
    await call(holder, "postSignInChallenge", { address: "nope", chainId: 31337, role: "holder" }); // 400
    await call(holder, "postSignInChallenge", { address: holder.address, chainId: 31337, role: "admin" }); // 400
    expect((await signIn(holder, "holder", h)).status).toBe(200);
    await call(holder, "getIssuerRequests"); // 403
    await call(holder, "postBundlePickup", {}, "not-a-uuid"); // 400
    await call(holder, "postBundlePickup", {}, "00000000-0000-4000-8000-000000000000"); // 404
    await call(issuer, "postIssuerDecision", { decision: "maybe" }, "00000000-0000-4000-8000-000000000000"); // 400
    await call(issuer, "postRevoke", { commitment: "0x" + "ab".repeat(32) }); // not registered
    await call(holder, "postChallenge", { action: "something-else" }); // 400
    await call(holder, "postPresentation", { challengeId: "00000000-0000-4000-8000-000000000000" }); // 400
  });

  it("exercised every operation", () => {
    expect([...seen.keys()].sort()).toEqual(OPERATIONS.map((o) => o.operationId).sort());
    for (const op of OPERATIONS) for (const status of Object.keys(op.responses)) expect(seen.get(op.operationId), `${op.operationId} ${status}`).toContain(Number(status));
  });
});
