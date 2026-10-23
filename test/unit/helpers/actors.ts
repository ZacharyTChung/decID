import { Contract, JsonRpcProvider, type HDNodeWallet } from "ethers";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "@/generated/contracts";
import { PRESENTATION_TYPES, presentationDomain, presentationMessage } from "@/lib/shared/eip712";
import { decodeDisclosure, sdHash, selectDisclosures } from "@/lib/shared/sd-jwt";
import type { ChallengeResponse } from "@/lib/shared/api";
import type { HolderBundle } from "@/lib/shared/bundle";
import { devWallet } from "../../../scripts/lib/dev-accounts";

type Handler = (req: Request) => Promise<Response>;

/** A test actor: a funded local dev wallet plus a cookie jar, calling handlers in-process. */
export class Actor {
  cookie = "";
  readonly wallet: HDNodeWallet;
  constructor(index: number, provider?: JsonRpcProvider) {
    this.wallet = devWallet(index, provider);
  }
  get address() {
    return this.wallet.address;
  }

  async call(handler: Handler, method: string, body?: unknown, headers: Record<string, string> = {}) {
    const req = new Request(`${process.env.APP_ORIGIN}/api/test`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { origin: process.env.APP_ORIGIN! } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const res = await handler(req);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    return { status: res.status, body: (await res.json()) as any };
  }
}

export async function signIn(actor: Actor, role: "holder" | "issuer", h: { postSignInChallenge: Handler; postSignInVerify: Handler }) {
  const ch = await actor.call(h.postSignInChallenge, "POST", { address: actor.address, chainId: 31337, role });
  if (ch.status !== 200) return ch;
  const signature = await actor.wallet.signMessage(ch.body.message);
  return actor.call(h.postSignInVerify, "POST", { message: ch.body.message, signature });
}

export function contracts(provider: JsonRpcProvider, deployment: { registry: string; gate: string }) {
  return {
    registry: new Contract(deployment.registry, CREDENTIAL_REGISTRY_ABI, provider),
    gate: new Contract(deployment.gate, DEMO_GATE_ABI, provider),
  };
}

/**
 * Signs a presentation proof the way a holder wallet does (preparePresentation), optionally
 * with fields overridden to build attacks. `credentialJwt` / `disclosures` overrides change
 * what the signed sdHash covers; pass the same overrides to submission() to submit them.
 */
export async function signPresentation(
  actor: Actor,
  challenge: ChallengeResponse,
  bundle: HolderBundle,
  overrides: Partial<{ audience: string; action: string; nonce: string; expiresAt: number; credentialJwt: string; disclosures: string[] }> = {},
) {
  const credentialJwt = overrides.credentialJwt ?? bundle.credentialJwt;
  const disclosures = overrides.disclosures ?? selectDisclosures(bundle.disclosures, challenge.requestedClaims);
  const expiresAt = overrides.expiresAt ?? challenge.expiresAt;
  const message = presentationMessage({
    audience: overrides.audience ?? challenge.audience,
    action: overrides.action ?? challenge.action,
    challenge: overrides.nonce ?? challenge.nonce,
    holder: actor.address,
    commitment: bundle.commitment,
    disclosed: disclosures.map((d) => decodeDisclosure(d).name),
    sdHash: sdHash(credentialJwt, disclosures),
    expiresAt,
  });
  const signature = await actor.wallet.signTypedData(presentationDomain(challenge.chainId, challenge.registry), PRESENTATION_TYPES, message);
  return { holder: actor.address, commitment: bundle.commitment, expiresAt, signature };
}

export function submission(
  challenge: ChallengeResponse,
  bundle: HolderBundle,
  proof: Awaited<ReturnType<typeof signPresentation>>,
  overrides: Partial<{ credentialJwt: string; salt: string; disclosures: string[] }> = {},
) {
  return {
    challengeId: challenge.challengeId,
    credentialJwt: overrides.credentialJwt ?? bundle.credentialJwt,
    disclosures: overrides.disclosures ?? selectDisclosures(bundle.disclosures, challenge.requestedClaims),
    salt: overrides.salt ?? bundle.salt,
    proof,
  };
}
