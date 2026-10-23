/**
 * npm run redteam: an adversarial test campaign against a LIVE local stack.
 *
 * Starts its own Hardhat node (8550) and Next.js server (3300, behind a simulated trusted proxy
 * so each attacker has its own rate-limit bucket), issues legitimate credentials, then attacks
 * the system the way an outsider would: over HTTP and JSON-RPC, with real signatures, crafted
 * tokens and its own contracts. Every scenario states the defense it expects; the run fails
 * (exit 1) if any defense does not hold. Writes .redteam/REPORT.md.
 *
 * Synthetic data and Hardhat's public dev keys only. Time-based attacks (expiry, not-yet-valid,
 * deadline) need clock control and are covered by the contract fuzz/invariant tests instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CompactSign, SignJWT, exportJWK, generateKeyPair, importJWK } from "jose";
import { Contract, ContractFactory, hexlify, randomBytes, toUtf8Bytes, type HDNodeWallet, type InterfaceAbi } from "ethers";
import { CREDENTIAL_REGISTRY_ABI, DEMO_GATE_ABI } from "../src/generated/contracts";
import { commitmentFor } from "../src/lib/shared/commitment";
import { buildIdentityCredential } from "../src/lib/shared/credential-profile";
import { deriveHolderDid } from "../src/lib/shared/did-pkh";
import { PRESENTATION_TYPES, presentationDomain, presentationMessage } from "../src/lib/shared/eip712";
import { createDisclosures, decodeDisclosure, encodeDisclosure, sdHash } from "../src/lib/shared/sd-jwt";
import type { HolderBundle } from "../src/lib/shared/bundle";
import type { ChallengeResponse } from "../src/lib/shared/api";
import type { VerificationResult } from "../src/lib/shared/verification";
import { deriveDidKeyFromJwk } from "../src/lib/server/did/did-key";
import { DEV_ROLES, devWallet } from "./lib/dev-accounts";
import { HttpActor } from "./lib/http-actor";
import { startLocalStack, type LocalStack } from "./lib/local-stack";
import { parseEnvFile } from "./lib/setup-keys";

const ROOT = process.cwd();
const DIR = path.join(ROOT, ".redteam");
const SYNTHETIC = { fullName: "Redteam Sentinel-Narwhal", dateOfBirth: "1904-04-04", country: "ZZ", syntheticDataConfirmed: true };

interface Outcome {
  ok: boolean;
  observed: string;
}
interface Scenario {
  id: string;
  category: string;
  attack: string;
  expected: string;
  run: () => Promise<Outcome>;
}

let stack: LocalStack;
const results: (Scenario & Outcome)[] = [];

// ------------------------------------------------------------------ helpers

const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const firstFail = (r: VerificationResult) => r.checks?.find((c) => c.status === "fail")?.code ?? (r.verified ? "VERIFIED" : "UNKNOWN");
const expectCode = (r: VerificationResult, code: string): Outcome => ({ ok: !r.verified && firstFail(r) === code, observed: r.verified ? "VERIFIED (!)" : firstFail(r) });
const expectStatus = (status: number, wanted: number, extra = ""): Outcome => ({ ok: status === wanted, observed: `HTTP ${status}${extra ? ` ${extra}` : ""}` });
async function expectRevert(p: Promise<unknown>, name: string, iface: Contract): Promise<Outcome> {
  try {
    await p;
    return { ok: false, observed: "transaction succeeded (!)" };
  } catch (e) {
    const data = (e as { data?: string }).data;
    let decoded = "reverted";
    try {
      if (data) decoded = iface.interface.parseError(data)?.name ?? decoded;
    } catch {
      // keep generic
    }
    return { ok: decoded === name, observed: decoded };
  }
}

function actor(name: string, index: number, ip: string): HttpActor {
  return new HttpActor(stack.origin, name, devWallet(index, stack.provider), ip);
}

async function challenge(a: HttpActor, action = "access-verified-member-area"): Promise<ChallengeResponse> {
  const res = await a.call("POST", "/api/verifier/challenges", { action });
  if (res.status !== 201) throw new Error(`challenge failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

interface ProofOpts {
  signer?: HDNodeWallet;
  holder?: string;
  commitment?: string;
  audience?: string;
  expiresAt?: number;
  chainId?: number;
  registry?: string;
  /** Challenge action (decides the requested claims). */
  action?: string;
  /** Disclosures submitted (default: none). */
  disclosures?: string[];
  /** Disclosures the holder's signature covers, if different from the submitted ones (tampering in transit). */
  signedDisclosures?: string[];
}
async function proofFor(c: ChallengeResponse, defaults: { signer: HDNodeWallet; holder: string; commitment: string; token: string; disclosures: string[] }, o: ProofOpts = {}) {
  const signer = o.signer ?? defaults.signer;
  const holder = o.holder ?? defaults.holder;
  const commitment = o.commitment ?? defaults.commitment;
  const audience = o.audience ?? c.audience;
  const expiresAt = o.expiresAt ?? c.expiresAt;
  const signed = o.signedDisclosures ?? defaults.disclosures;
  const names = signed.map((d) => {
    try {
      return decodeDisclosure(d).name;
    } catch {
      return "?";
    }
  });
  const message = presentationMessage({ audience, action: c.action, challenge: c.nonce, holder, commitment, disclosed: names, sdHash: sdHash(defaults.token, signed), expiresAt });
  const signature = await signer.signTypedData(presentationDomain(o.chainId ?? c.chainId, o.registry ?? c.registry), PRESENTATION_TYPES, message);
  return { holder, commitment, expiresAt, signature };
}

async function present(a: HttpActor, token: string, salt: string, o: ProofOpts = {}): Promise<{ result: VerificationResult; body: unknown; c: ChallengeResponse }> {
  const c = await challenge(a, o.action);
  const commitment = o.commitment ?? (() => {
    try {
      return commitmentFor(token, salt);
    } catch {
      return "0x" + "00".repeat(32);
    }
  })();
  const disclosures = o.disclosures ?? [];
  const proof = await proofFor(c, { signer: a.wallet, holder: a.address, commitment, token, disclosures }, o);
  const body = { challengeId: c.challengeId, credentialJwt: token, disclosures, salt, proof };
  const res = await a.call("POST", "/api/verifier/presentations", body);
  return { result: res.body as VerificationResult, body, c };
}

async function issue(holder: HttpActor, issuer: HttpActor, doc: string, opts: { register: boolean; pickup?: boolean; dateOfBirth?: string }) {
  if ((await holder.signIn("holder")).status !== 200) throw new Error(`${holder.name} sign-in failed`);
  const req = await holder.call("POST", "/api/holder/requests", { ...SYNTHETIC, documentNumber: doc, ...(opts.dateOfBirth ? { dateOfBirth: opts.dateOfBirth } : {}) });
  if (req.status !== 201) throw new Error(`request failed: ${JSON.stringify(req.body)}`);
  const ok = await issuer.call("POST", `/api/issuer/requests/${req.body.id}/decision`, { decision: "approve" });
  if (ok.status !== 200) throw new Error(`approve failed: ${JSON.stringify(ok.body)}`);
  if (opts.pickup === false) return { requestId: req.body.id as string, bundle: undefined };
  const pickup = await holder.call("POST", `/api/holder/requests/${req.body.id}/bundle`, {});
  const bundle = pickup.body.bundle as HolderBundle;
  if (opts.register) {
    const registry = new Contract(stack.deployment.registry, CREDENTIAL_REGISTRY_ABI, holder.wallet);
    await (await registry.getFunction("register")(bundle.authorization, bundle.authorizationSignature)).wait();
  }
  return { requestId: req.body.id as string, bundle };
}

async function attackerKey() {
  const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
  const jwk = await exportJWK(privateKey);
  const { did, kid } = await deriveDidKeyFromJwk({ kty: "OKP", crv: "Ed25519", x: jwk.x! });
  return { key: await importJWK(jwk, "Ed25519"), jwk, did, kid };
}

async function signWith(key: CryptoKey | Uint8Array, header: Record<string, unknown>, payload: unknown): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: "Ed25519", typ: "vc+sd-jwt", cty: "vc", ...header }).sign(key);
}

// ------------------------------------------------------------------ campaign

async function main() {
  console.log("Red-team campaign against a live local stack (synthetic data, local chain only)\n");
  mkdirSync(DIR, { recursive: true });
  stack = await startLocalStack({
    dir: DIR,
    chainPort: 8550,
    appPort: 3300,
    mode: "dev",
    distDir: ".next-redteam",
    appEnv: { TRUST_PROXY: "1" },
    log: (m) => console.log(`  setup: ${m}`),
  });
  const trust = JSON.parse(readFileSync(path.join(DIR, "trusted-issuers.json"), "utf8"));
  const trustedKey = trust.issuers[0].credentialKeys[0] as { did: string; kid: string; publicKeyJwk: { x: string } };
  const issuerEnv = parseEnvFile(path.join(DIR, "issuer.env"));

  const issuer = actor("issuer", DEV_ROLES.issuerOperator, "10.0.0.1");
  const holder = actor("holder", DEV_ROLES.holder, "10.0.0.2");
  const thief = actor("thief", DEV_ROLES.otherHolder, "10.0.0.3");
  const holderB = actor("holder-b", 4, "10.0.0.4");
  const attacker = actor("attacker", 5, "10.0.0.5");
  const holderC = actor("holder-c", 6, "10.0.0.6");
  if ((await issuer.signIn("issuer")).status !== 200) throw new Error("issuer sign-in failed");

  const A = (await issue(holder, issuer, "SYN-REDTEAMA", { register: true })).bundle!; // legit, registered
  const B = (await issue(holderB, issuer, "SYN-REDTEAMB", { register: false })).bundle!; // legit, NOT registered
  const pendingC = await issue(holderC, issuer, "SYN-REDTEAMC", { register: false, pickup: false }); // awaiting pickup
  const minor = actor("minor", 8, "10.0.0.8");
  const M = (await issue(minor, issuer, "SYN-REDTEAMM", { register: true, dateOfBirth: "2015-03-03" })).bundle!; // legit, registered, under 18
  const disclosureOf = (b: HolderBundle, name: string) => b.disclosures.find((d) => decodeDisclosure(d).name === name)!;
  const AGE = "access-age-restricted-area";
  const legitPayload = JSON.parse(Buffer.from(A.credentialJwt.split(".")[1]!, "base64url").toString());
  const [legitHeader, , legitSig] = A.credentialJwt.split(".");
  const evil = await attackerKey();
  const registry = new Contract(stack.deployment.registry, CREDENTIAL_REGISTRY_ABI, stack.provider);
  const gate = new Contract(stack.deployment.gate, DEMO_GATE_ABI, stack.provider);
  const thiefDid = deriveHolderDid(31337, thief.address);
  const now = Math.floor(Date.now() / 1000);
  const selfIssued = buildIdentityCredential({
    credentialId: "urn:uuid:6f1c2a4e-1d2b-4c3d-9e8f-0a1b2c3d4e5f",
    issuerDid: evil.did,
    holderDid: thiefDid,
    validFrom: now - 10,
    validUntil: now + 86400,
    chainId: 31337,
    registry: stack.deployment.registry,
    sd: createDisclosures({ ageOver18: true, ageOver21: true, countryOfResidence: "ZZ" }).sd,
  });
  const forgedSalt = hexlify(randomBytes(32));
  console.log("  setup: legitimate credentials issued (A registered, B unregistered, C awaiting pickup, M registered and under 18)\n");

  const scenarios: Scenario[] = [
    // -------------------------------------------------------------- A: credential forgery
    {
      id: "A1", category: "Credential forgery", attack: "Thief edits the subject DID inside a real credential (signature kept)", expected: "BAD_SIGNATURE",
      run: async () => {
        const forged = `${legitHeader}.${b64({ ...legitPayload, credentialSubject: { ...legitPayload.credentialSubject, id: thiefDid }, sub: thiefDid })}.${legitSig}`;
        return expectCode((await present(thief, forged, A.salt)).result, "BAD_SIGNATURE");
      },
    },
    {
      id: "A2", category: "Credential forgery", attack: "Self-issued credential from the attacker's own did:key (perfect format)", expected: "ISSUER_NOT_TRUSTED",
      run: async () => expectCode((await present(thief, await signWith(evil.key, { kid: evil.kid }, selfIssued), forgedSalt)).result, "ISSUER_NOT_TRUSTED"),
    },
    {
      id: "A3", category: "Credential forgery", attack: 'Unsigned token (alg "none")', expected: "UNSIGNED_TOKEN",
      run: async () => expectCode((await present(thief, `${b64({ alg: "none", typ: "vc+sd-jwt", kid: trustedKey.kid })}.${b64(legitPayload)}.x`, forgedSalt)).result, "UNSIGNED_TOKEN"),
    },
    {
      id: "A4", category: "Credential forgery", attack: "Algorithm confusion: HS256 keyed with the issuer's PUBLIC key", expected: "ALG_NOT_ALLOWED",
      run: async () => {
        const secret = Buffer.from(trustedKey.publicKeyJwk.x, "base64url");
        const token = await new SignJWT({ ...legitPayload, sub: thiefDid, credentialSubject: { ...legitPayload.credentialSubject, id: thiefDid } })
          .setProtectedHeader({ alg: "HS256", typ: "vc+sd-jwt", kid: trustedKey.kid })
          .sign(secret);
        return expectCode((await present(thief, token, forgedSalt)).result, "ALG_NOT_ALLOWED");
      },
    },
    {
      id: "A5", category: "Credential forgery", attack: "Embedded attacker key in the header (jwk) with the trusted kid", expected: "FORBIDDEN_HEADER",
      run: async () => expectCode((await present(thief, await signWith(evil.key, { kid: trustedKey.kid, jwk: { kty: "OKP", crv: "Ed25519", x: evil.jwk.x } }, legitPayload), forgedSalt)).result, "FORBIDDEN_HEADER"),
    },
    {
      id: "A6", category: "Credential forgery", attack: "Trusted issuer kid, but signed with the attacker's key", expected: "BAD_SIGNATURE",
      run: async () => expectCode((await present(thief, await signWith(evil.key, { kid: trustedKey.kid }, { ...legitPayload, sub: thiefDid, credentialSubject: { ...legitPayload.credentialSubject, id: thiefDid } }), forgedSalt)).result, "BAD_SIGNATURE"),
    },
    {
      id: "A7", category: "Credential forgery", attack: "Re-serialized payload (same claims, different JSON bytes) with the original signature", expected: "BAD_SIGNATURE",
      run: async () => expectCode((await present(holder, `${legitHeader}.${b64(JSON.stringify(legitPayload, null, 1))}.${legitSig}`, A.salt)).result, "BAD_SIGNATURE"),
    },
    {
      id: "A8", category: "Credential forgery", attack: 'Deprecated alg identifier "EdDSA" (valid signature by attacker)', expected: "ALG_NOT_ALLOWED",
      run: async () => expectCode((await present(thief, await new CompactSign(new TextEncoder().encode(JSON.stringify(selfIssued))).setProtectedHeader({ alg: "EdDSA", typ: "vc+sd-jwt", kid: evil.kid }).sign(evil.key), forgedSalt)).result, "ALG_NOT_ALLOWED"),
    },
    {
      id: "A9", category: "Credential forgery", attack: "Oversized token (12 KB) to stress the parser", expected: "HTTP 400 before any parsing",
      run: async () => {
        const c = await challenge(thief);
        const res = await thief.call("POST", "/api/verifier/presentations", { challengeId: c.challengeId, credentialJwt: "a".repeat(12_000) + ".b.c", salt: forgedSalt, proof: await proofFor(c, { signer: thief.wallet, holder: thief.address, commitment: "0x" + "11".repeat(32), token: "a.b.c", disclosures: [] }) });
        return expectStatus(res.status, 400, res.body?.error?.code);
      },
    },

    // -------------------------------------------------------------- B: impersonation & replay
    {
      id: "B1", category: "Impersonation & replay", attack: "Thief presents the holder's stolen bundle, signing as themselves", expected: "SUBJECT_NOT_PRESENTER",
      run: async () => expectCode((await present(thief, A.credentialJwt, A.salt)).result, "SUBJECT_NOT_PRESENTER"),
    },
    {
      id: "B2", category: "Impersonation & replay", attack: "Thief claims to BE the holder's wallet but signs with their own key", expected: "PROOF_SIGNER_MISMATCH",
      run: async () => expectCode((await present(thief, A.credentialJwt, A.salt, { holder: holder.address })).result, "PROOF_SIGNER_MISMATCH"),
    },
    {
      id: "B3", category: "Impersonation & replay", attack: "Replay of a captured, valid presentation", expected: "CHALLENGE_REUSED",
      run: async () => {
        const first = await present(holder, A.credentialJwt, A.salt);
        if (!first.result.verified) return { ok: false, observed: `baseline not verified: ${firstFail(first.result)}` };
        const replay = await thief.call("POST", "/api/verifier/presentations", first.body);
        return expectCode(replay.body, "CHALLENGE_REUSED");
      },
    },
    {
      id: "B4", category: "Impersonation & replay", attack: "Holder's proof made for a different verifier (audience) relayed here", expected: "PROOF_SIGNER_MISMATCH",
      run: async () => expectCode((await present(holder, A.credentialJwt, A.salt, { audience: "https://evil-verifier.example" })).result, "PROOF_SIGNER_MISMATCH"),
    },
    {
      id: "B5", category: "Impersonation & replay", attack: "Proof that claims a validity far beyond the challenge expiry", expected: "PROOF_EXPIRY_INVALID",
      run: async () => expectCode((await present(holder, A.credentialJwt, A.salt, { expiresAt: Math.floor(Date.now() / 1000) + 86400 })).result, "PROOF_EXPIRY_INVALID"),
    },
    {
      id: "B6", category: "Impersonation & replay", attack: "Race: the same valid submission fired 8 times concurrently", expected: "exactly 1 accepted",
      run: async () => {
        const c = await challenge(holder);
        const body = { challengeId: c.challengeId, credentialJwt: A.credentialJwt, disclosures: [], salt: A.salt, proof: await proofFor(c, { signer: holder.wallet, holder: holder.address, commitment: A.commitment, token: A.credentialJwt, disclosures: [] }) };
        const all = await Promise.all(Array.from({ length: 8 }, () => holder.call("POST", "/api/verifier/presentations", body)));
        const accepted = all.filter((r) => (r.body as VerificationResult).verified).length;
        return { ok: accepted === 1, observed: `${accepted} accepted, ${8 - accepted} CHALLENGE_REUSED` };
      },
    },
    {
      id: "B7", category: "Impersonation & replay", attack: "Guessed challenge id", expected: "CHALLENGE_UNKNOWN",
      run: async () => {
        const c = await challenge(holder);
        const res = await holder.call("POST", "/api/verifier/presentations", { challengeId: crypto.randomUUID(), credentialJwt: A.credentialJwt, disclosures: [], salt: A.salt, proof: await proofFor(c, { signer: holder.wallet, holder: holder.address, commitment: A.commitment, token: A.credentialJwt, disclosures: [] }) });
        return expectCode(res.body, "CHALLENGE_UNKNOWN");
      },
    },
    {
      id: "B8", category: "Impersonation & replay", attack: "SIWE sign-in replay with a captured message + signature", expected: "NONCE_INVALID",
      run: async () => {
        const ch = await holder.call("POST", "/api/auth/challenge", { address: holder.address, chainId: 31337, role: "holder" });
        const signature = await holder.wallet.signMessage(ch.body.message);
        await holder.call("POST", "/api/auth/verify", { message: ch.body.message, signature });
        const replay = await thief.call("POST", "/api/auth/verify", { message: ch.body.message, signature });
        return { ok: replay.status === 401 && replay.body?.error?.code === "NONCE_INVALID", observed: `HTTP ${replay.status} ${replay.body?.error?.code}` };
      },
    },
    {
      id: "B9", category: "Impersonation & replay", attack: "SIWE role escalation: holder edits /roles/holder → /roles/issuer before signing", expected: "HTTP 401",
      run: async () => {
        const ch = await holder.call("POST", "/api/auth/challenge", { address: holder.address, chainId: 31337, role: "holder" });
        const edited = (ch.body.message as string).replace("/roles/holder", "/roles/issuer");
        const res = await holder.call("POST", "/api/auth/verify", { message: edited, signature: await holder.wallet.signMessage(edited) });
        return expectStatus(res.status, 401, res.body?.error?.code);
      },
    },

    // -------------------------------------------------------------- C: commitment, registry, chain
    {
      id: "C1", category: "Commitment, registry & chain", attack: "Real credential with a guessed salt", expected: "COMMITMENT_MISMATCH",
      run: async () => expectCode((await present(holder, A.credentialJwt, forgedSalt, { commitment: A.commitment })).result, "COMMITMENT_MISMATCH"),
    },
    {
      id: "C2", category: "Commitment, registry & chain", attack: "Commitment substitution: A's token with another credential's (B's) commitment", expected: "COMMITMENT_MISMATCH",
      run: async () => expectCode((await present(holder, A.credentialJwt, A.salt, { commitment: B.commitment })).result, "COMMITMENT_MISMATCH"),
    },
    {
      id: "C3", category: "Commitment, registry & chain", attack: "Valid, correctly signed credential that was never registered on-chain", expected: "NOT_REGISTERED",
      run: async () => expectCode((await present(holderB, B.credentialJwt, B.salt)).result, "NOT_REGISTERED"),
    },
    {
      id: "C4", category: "Commitment, registry & chain", attack: "Front-running: thief submits holder B's registration transaction", expected: "revert SenderNotHolder",
      run: async () => expectRevert((registry.connect(thief.wallet) as Contract).getFunction("register").staticCall(B.authorization, B.authorizationSignature), "SenderNotHolder", registry),
    },
    {
      id: "C5", category: "Commitment, registry & chain", attack: "Thief rewrites B's authorization to name themselves as holder", expected: "revert SignerNotIssuer",
      run: async () => expectRevert((registry.connect(thief.wallet) as Contract).getFunction("register").staticCall({ ...B.authorization, holder: thief.address }, B.authorizationSignature), "SignerNotIssuer", registry),
    },
    {
      id: "C6", category: "Commitment, registry & chain", attack: "Holder re-registers an already registered commitment", expected: "revert AlreadyRegistered",
      run: async () => expectRevert((registry.connect(holder.wallet) as Contract).getFunction("register").staticCall(A.authorization, A.authorizationSignature), "AlreadyRegistered", registry),
    },
    {
      id: "C7", category: "Commitment, registry & chain", attack: "Thief calls the gated action with the holder's (public) commitment", expected: "revert AccessDenied",
      run: async () => expectRevert((gate.connect(thief.wallet) as Contract).getFunction("checkIn").staticCall(A.commitment), "AccessDenied", gate),
    },
    {
      id: "C8", category: "Commitment, registry & chain", attack: "Attacker deploys their OWN registry, makes themselves issuer, registers a self-issued credential", expected: "ISSUER_NOT_TRUSTED (rogue registry never consulted)",
      run: async () => {
        const art = JSON.parse(readFileSync(path.join(ROOT, "artifacts/contracts/CredentialRegistry.sol/CredentialRegistry.json"), "utf8")) as { abi: InterfaceAbi; bytecode: string };
        const rogue = (await new ContractFactory(art.abi, art.bytecode, attacker.wallet).deploy(attacker.address, hexlify(randomBytes(32)))) as unknown as Contract;
        await rogue.waitForDeployment();
        await (await rogue.getFunction("addIssuer")(attacker.address)).wait();
        const token = await signWith(evil.key, { kid: evil.kid }, selfIssued);
        const commitment = commitmentFor(token, forgedSalt);
        const auth = { commitment, holder: thief.address, issuer: attacker.address, schemaId: stack.deployment.schemaId, validFrom: now - 10, expiresAt: now + 86400, issuerEpoch: 0, deadline: now + 3600, deploymentId: await rogue.getFunction("deploymentId")() };
        const sig = await attacker.wallet.signTypedData({ name: "CredentialRegistry", version: "1", chainId: 31337n, verifyingContract: await rogue.getAddress() }, (await import("../src/lib/shared/eip712")).REGISTRATION_TYPES, auth);
        await (await (rogue.connect(thief.wallet) as Contract).getFunction("register")(auth, sig)).wait();
        return expectCode((await present(thief, token, forgedSalt)).result, "ISSUER_NOT_TRUSTED");
      },
    },
    {
      id: "C9", category: "Commitment, registry & chain", attack: "Holder's proof bound to another deployment (rogue registry address in the EIP-712 domain)", expected: "PROOF_SIGNER_MISMATCH",
      run: async () => expectCode((await present(holder, A.credentialJwt, A.salt, { registry: attacker.address })).result, "PROOF_SIGNER_MISMATCH"),
    },

    // -------------------------------------------------------------- D: API & auth abuse
    {
      id: "D1", category: "API & auth abuse", attack: "Approve a request with no session", expected: "HTTP 401",
      run: async () => expectStatus((await new HttpActor(stack.origin, "anon", attacker.wallet, "10.0.0.9").call("POST", `/api/issuer/requests/${pendingC.requestId}/decision`, { decision: "approve" })).status, 401),
    },
    {
      id: "D2", category: "API & auth abuse", attack: "Holder session calls the issuer approval and revocation endpoints", expected: "HTTP 403",
      run: async () => {
        const a = await holder.call("POST", `/api/issuer/requests/${pendingC.requestId}/decision`, { decision: "approve" });
        const r = await holder.call("POST", "/api/issuer/credentials/revoke", { commitment: A.commitment });
        return { ok: a.status === 403 && r.status === 403, observed: `approve HTTP ${a.status}, revoke HTTP ${r.status}` };
      },
    },
    {
      id: "D3", category: "API & auth abuse", attack: "Non-operator wallet asks for the issuer role", expected: "HTTP 403 NOT_ISSUER_OPERATOR",
      run: async () => {
        const res = await attacker.call("POST", "/api/auth/challenge", { address: attacker.address, chainId: 31337, role: "issuer" });
        return { ok: res.status === 403 && res.body?.error?.code === "NOT_ISSUER_OPERATOR", observed: `HTTP ${res.status} ${res.body?.error?.code}` };
      },
    },
    {
      id: "D4", category: "API & auth abuse", attack: "Cross-site request (CSRF) carrying the holder's cookie from evil.example", expected: "HTTP 403 BAD_ORIGIN",
      run: async () => {
        const res = await holder.call("POST", "/api/holder/requests", { ...SYNTHETIC, documentNumber: "SYN-CSRF1" }, { origin: "https://evil.example" });
        return { ok: res.status === 403 && res.body?.error?.code === "BAD_ORIGIN", observed: `HTTP ${res.status} ${res.body?.error?.code}` };
      },
    },
    {
      id: "D5", category: "API & auth abuse", attack: "Mass assignment: request smuggles holderAddress=victim", expected: "HTTP 400 VALIDATION_FAILED",
      run: async () => {
        await thief.signIn("holder");
        const res = await thief.call("POST", "/api/holder/requests", { ...SYNTHETIC, documentNumber: "SYN-MASS1", holderAddress: holder.address });
        return { ok: res.status === 400 && res.body?.error?.code === "VALIDATION_FAILED", observed: `HTTP ${res.status} ${res.body?.error?.code}` };
      },
    },
    {
      id: "D6", category: "API & auth abuse", attack: "Real-looking document number (not SYN-); is it echoed back?", expected: "HTTP 400, value not echoed",
      run: async () => {
        const res = await thief.call("POST", "/api/holder/requests", { ...SYNTHETIC, documentNumber: "X98765432" });
        const echoed = JSON.stringify(res.body).includes("X98765432");
        return { ok: res.status === 400 && !echoed, observed: `HTTP ${res.status}${echoed ? ", value echoed (!)" : ", not echoed"}` };
      },
    },
    {
      id: "D7", category: "API & auth abuse", attack: "Another holder tries to pick up holder C's issued bundle", expected: "HTTP 404 (then the owner still gets it)",
      run: async () => {
        const stolen = await thief.call("POST", `/api/holder/requests/${pendingC.requestId}/bundle`, {});
        const owner = await holderC.call("POST", `/api/holder/requests/${pendingC.requestId}/bundle`, {});
        return { ok: stolen.status === 404 && owner.status === 200, observed: `thief HTTP ${stolen.status}, owner HTTP ${owner.status}` };
      },
    },
    {
      id: "D8", category: "API & auth abuse", attack: "Oversized request body (40 KB)", expected: "HTTP 413",
      run: async () => {
        const res = await thief.call("POST", "/api/verifier/challenges", JSON.stringify({ action: "access-verified-member-area", pad: "x".repeat(40_000) }));
        return expectStatus(res.status, 413, res.body?.error?.code);
      },
    },
    {
      id: "D9", category: "API & auth abuse", attack: "Flood: 40 sign-in challenges per minute from one client (others unaffected)", expected: "HTTP 429 for the flooder only",
      run: async () => {
        const flooder = new HttpActor(stack.origin, "flooder", attacker.wallet, "10.66.66.66");
        let limited = 0;
        for (let i = 0; i < 40; i++) {
          const r = await flooder.call("POST", "/api/auth/challenge", { address: attacker.address, chainId: 31337, role: "holder" });
          if (r.status === 429) limited++;
        }
        const bystander = await holderC.call("POST", "/api/auth/challenge", { address: holderC.address, chainId: 31337, role: "holder" });
        return { ok: limited >= 10 && bystander.status === 200, observed: `${limited}/40 throttled; bystander HTTP ${bystander.status}` };
      },
    },
    {
      id: "D10", category: "API & auth abuse", attack: "Recovery hijack: thief files a recovery request naming the victim's wallet", expected: "request only queued; victim stays valid until an issuer re-verifies (accepted risk)",
      run: async () => {
        await thief.signIn("holder");
        const req = await thief.call("POST", "/api/holder/requests", { ...SYNTHETIC, documentNumber: "SYN-HIJACK1", recoveryOf: holder.address });
        const pending = (await issuer.call("GET", "/api/issuer/requests")).body.requests.find((r: { id: string }) => r.id === req.body.id);
        const stillValid = (await present(holder, A.credentialJwt, A.salt)).result.verified;
        const flagged = pending?.recovery?.previousHolder === holder.address;
        await issuer.call("POST", `/api/issuer/requests/${req.body.id}/decision`, { decision: "reject", reason: "re-verification failed" });
        return { ok: req.status === 201 && flagged && stillValid, observed: `queued with recovery warning=${flagged}; victim still verified=${stillValid}; rejected by issuer` };
      },
    },

    // -------------------------------------------------------------- S: selective disclosure (SD-JWT)
    {
      id: "S0", category: "Selective disclosure", attack: "Control: adult holder discloses ageOver18 to the 18+ area", expected: "VERIFIED with exactly { ageOver18: true }",
      run: async () => {
        const r = (await present(holder, A.credentialJwt, A.salt, { action: AGE, disclosures: [disclosureOf(A, "ageOver18")] })).result;
        const claims = JSON.stringify(r.disclosed?.claims);
        return { ok: r.verified && claims === '{"ageOver18":true}', observed: r.verified ? `VERIFIED ${claims}` : firstFail(r) };
      },
    },
    {
      id: "S1", category: "Selective disclosure", attack: "Adult holder withholds the requested ageOver18 claim", expected: "CLAIM_NOT_DISCLOSED",
      run: async () => expectCode((await present(holder, A.credentialJwt, A.salt, { action: AGE })).result, "CLAIM_NOT_DISCLOSED"),
    },
    {
      id: "S2", category: "Selective disclosure", attack: "Under-18 holder honestly discloses ageOver18=false", expected: "POLICY_NOT_SATISFIED",
      run: async () => expectCode((await present(minor, M.credentialJwt, M.salt, { action: AGE, disclosures: [disclosureOf(M, "ageOver18")] })).result, "POLICY_NOT_SATISFIED"),
    },
    {
      id: "S3", category: "Selective disclosure", attack: "Under-18 holder flips their disclosure to true (same salt, signs it)", expected: "DISCLOSURE_NOT_REFERENCED",
      run: async () => {
        const own = decodeDisclosure(disclosureOf(M, "ageOver18"));
        return expectCode((await present(minor, M.credentialJwt, M.salt, { action: AGE, disclosures: [encodeDisclosure(own.salt, "ageOver18", true)] })).result, "DISCLOSURE_NOT_REFERENCED");
      },
    },
    {
      id: "S4", category: "Selective disclosure", attack: "Under-18 holder borrows the adult's genuine ageOver18=true disclosure", expected: "DISCLOSURE_NOT_REFERENCED",
      run: async () => expectCode((await present(minor, M.credentialJwt, M.salt, { action: AGE, disclosures: [disclosureOf(A, "ageOver18")] })).result, "DISCLOSURE_NOT_REFERENCED"),
    },
    {
      id: "S5", category: "Selective disclosure", attack: "Over-disclosure: country disclosed to an action that requests nothing", expected: "UNREQUESTED_DISCLOSURE",
      run: async () => expectCode((await present(holder, A.credentialJwt, A.salt, { disclosures: [disclosureOf(A, "countryOfResidence")] })).result, "UNREQUESTED_DISCLOSURE"),
    },
    {
      id: "S6", category: "Selective disclosure", attack: "Relay strips the disclosure the holder signed for (to make the holder fail)", expected: "PROOF_SIGNER_MISMATCH",
      run: async () => expectCode((await present(holder, A.credentialJwt, A.salt, { action: AGE, disclosures: [], signedDisclosures: [disclosureOf(A, "ageOver18")] })).result, "PROOF_SIGNER_MISMATCH"),
    },
    {
      id: "S7", category: "Selective disclosure", attack: "Relay appends a disclosure the holder did not consent to (country)", expected: "PROOF_SIGNER_MISMATCH",
      run: async () => {
        const age = disclosureOf(A, "ageOver18");
        return expectCode((await present(holder, A.credentialJwt, A.salt, { action: AGE, disclosures: [age, disclosureOf(A, "countryOfResidence")], signedDisclosures: [age] })).result, "PROOF_SIGNER_MISMATCH");
      },
    },
    {
      id: "S8", category: "Selective disclosure", attack: "The same disclosure presented twice", expected: "DISCLOSURE_DUPLICATE",
      run: async () => {
        const age = disclosureOf(A, "ageOver18");
        return expectCode((await present(holder, A.credentialJwt, A.salt, { action: AGE, disclosures: [age, age] })).result, "DISCLOSURE_DUPLICATE");
      },
    },
    {
      id: "S9", category: "Selective disclosure", attack: "Inspect the signed credential for the hidden claims (plaintext or guessable digests)", expected: "only salted digests; same count for every holder",
      run: async () => {
        const payloadOf = (b: HolderBundle) => JSON.parse(Buffer.from(b.credentialJwt.split(".")[1]!, "base64url").toString());
        const pa = payloadOf(A);
        const pm = payloadOf(M);
        const text = JSON.stringify([pa, pm]);
        const leaks = ["ageOver18", "ageOver21", "countryOfResidence", '"ZZ"'].filter((n) => text.includes(n));
        // An attacker who guesses a value cannot confirm it without the 128-bit salt: try the obvious unsalted forms.
        const guesses = ["ageOver18", "true", '["ageOver18",true]'].map((g) => Buffer.from(g).toString("base64url"));
        const confirmed = guesses.some((g) => pa.credentialSubject._sd.includes(g));
        const sameCount = pa.credentialSubject._sd.length === pm.credentialSubject._sd.length;
        return { ok: leaks.length === 0 && !confirmed && sameCount, observed: `${leaks.length ? `leaks: ${leaks.join(",")}` : "no plaintext"}, ${pa.credentialSubject._sd.length} vs ${pm.credentialSubject._sd.length} digests` };
      },
    },

    // -------------------------------------------------------------- E: privacy probes
    {
      id: "E1", category: "Privacy probes", attack: "Look for issuer secrets in the public config endpoint and page HTML", expected: "no secret material",
      run: async () => {
        const cfg = JSON.stringify((await attacker.call("GET", "/api/config")).body);
        const html = String((await attacker.call("GET", "/issuer")).body);
        const d = JSON.parse(issuerEnv.ISSUER_CREDENTIAL_PRIVATE_JWK!).d as string;
        const evm = issuerEnv.ISSUER_EVM_PRIVATE_KEY!.slice(2);
        const leaked = [d, evm].filter((s) => cfg.includes(s) || html.includes(s)).length;
        return { ok: leaked === 0, observed: leaked ? `${leaked} secret(s) found (!)` : "none found" };
      },
    },
    {
      id: "E2", category: "Privacy probes", attack: "Mine the verifier activity log for holder addresses or commitments", expected: "only reference, action, time, outcome",
      run: async () => {
        const log = JSON.stringify((await attacker.call("GET", "/api/verifier/history")).body).toLowerCase();
        const hits = [holder.address, holderB.address, A.commitment, B.commitment].filter((v) => log.includes(v.slice(2).toLowerCase())).length;
        return { ok: hits === 0, observed: hits ? `${hits} identifier(s) found (!)` : "no identifiers" };
      },
    },
    {
      id: "E3", category: "Privacy probes", attack: "Inspect a successful verification response for application data", expected: "only identityVerified + DIDs + dates",
      run: async () => {
        const r = await present(holder, A.credentialJwt, A.salt);
        const text = JSON.stringify(r.result);
        const leaked = [SYNTHETIC.fullName, SYNTHETIC.dateOfBirth, "SYN-REDTEAMA", A.salt.slice(2)].filter((v) => text.includes(v)).length;
        return { ok: r.result.verified && leaked === 0, observed: `verified=${r.result.verified}; ${leaked} private value(s) in response` };
      },
    },
    {
      id: "E4", category: "Privacy probes", attack: "Check the page CSP an XSS payload would face", expected: "per-request nonce, no 'unsafe-inline'",
      run: async () => {
        const c1 = (await attacker.call("GET", "/holder")).headers.get("content-security-policy") ?? "";
        const c2 = (await attacker.call("GET", "/holder")).headers.get("content-security-policy") ?? "";
        const n = (c: string) => /'nonce-([^']+)'/.exec(c)?.[1];
        const ok = !!n(c1) && n(c1) !== n(c2) && !c1.includes("'unsafe-inline'");
        return { ok, observed: ok ? "fresh nonce per response, no unsafe-inline" : c1 };
      },
    },
    {
      id: "E5", category: "Privacy probes", attack: "Malformed JSON to provoke a stack trace", expected: "stable error code, no internals",
      run: async () => {
        const res = await attacker.call("POST", "/api/verifier/presentations", "{not json");
        const text = JSON.stringify(res.body);
        const internals = /node_modules|\/src\/|at [A-Za-z]+ \(|Error:/.test(text);
        return { ok: res.status === 400 && !internals, observed: `HTTP ${res.status} ${res.body?.error?.code}${internals ? " + internals (!)" : ""}` };
      },
    },
    {
      id: "E6", category: "Privacy probes", attack: "Scan every transaction and event on the chain for identity data, tokens and salts", expected: "nothing private on-chain",
      run: async () => {
        const latest = await stack.provider.getBlockNumber();
        const parts: string[] = [];
        for (let n = 0; n <= latest; n++) {
          const block = await stack.provider.getBlock(n, true);
          for (const tx of block?.prefetchedTransactions ?? []) {
            parts.push(tx.data);
            for (const log of (await stack.provider.getTransactionReceipt(tx.hash))?.logs ?? []) parts.push(log.data, ...log.topics);
          }
        }
        const hay = parts.join("|").toLowerCase();
        const needles = [SYNTHETIC.fullName, SYNTHETIC.dateOfBirth, "SYN-REDTEAMA", A.credentialJwt, B.credentialJwt];
        const found = needles.filter((v) => hay.includes(v.toLowerCase()) || hay.includes(hexlify(toUtf8Bytes(v)).slice(2).toLowerCase())).length;
        const salts = [A.salt, B.salt].filter((s) => hay.includes(s.slice(2).toLowerCase())).length;
        return { ok: found === 0 && salts === 0, observed: `${latest + 1} blocks scanned; ${found + salts} private value(s) found` };
      },
    },
  ];

  for (const s of scenarios) {
    let outcome: Outcome;
    try {
      outcome = await s.run();
    } catch (e) {
      outcome = { ok: false, observed: `harness error: ${e instanceof Error ? e.message : String(e)}` };
    }
    results.push({ ...s, ...outcome });
    console.log(`${outcome.ok ? "  ✔" : "  ✘"} ${s.id} ${s.attack}\n      expected: ${s.expected} | observed: ${outcome.observed}`);
  }
}

function report() {
  const held = results.filter((r) => r.ok).length;
  const lines = [
    "# Red-team report",
    "",
    `Run: ${new Date().toISOString()} against a fresh local stack (\`npm run redteam\`). Synthetic data, local chain only.`,
    "",
    `**${held} of ${results.length} defenses held.**`,
    "",
    "| ID | Category | Attack | Expected defense | Observed | Result |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => `| ${r.id} | ${r.category} | ${r.attack} | ${r.expected} | ${r.observed} | ${r.ok ? "held" : "**FAILED**"} |`),
    "",
    "Not covered here (needs clock control): expiry, not-yet-valid and registration-deadline boundaries; these are",
    "covered by the contract tests and the Solidity fuzz/invariant suite (`npm run test:fuzz`).",
    "",
  ];
  writeFileSync(path.join(DIR, "REPORT.md"), lines.join("\n"));
  console.log(`\n${held === results.length ? "✔" : "✘"} ${held}/${results.length} defenses held. Report: .redteam/REPORT.md`);
  return held === results.length;
}

main()
  .then(() => report())
  .catch((e) => {
    console.error(`\n✘ campaign aborted: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  })
  .then((ok) => {
    stack?.provider.destroy();
    stack?.stop();
    process.exit(ok ? 0 : 1);
  });
