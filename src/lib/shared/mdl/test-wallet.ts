import { DeviceResponse, Document, MDoc } from "@auth0/mdl";
import * as x509 from "@peculiar/x509";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import { MDL_DOCTYPE, MDL_NAMESPACE, encryptResponse, requestedElements, sessionTranscript, type MdocRequest } from "./annex-c";

/**
 * A TEST issuing authority and a TEST phone wallet, for development, automated tests and the
 * hosted demo. The root is clearly named as a test root and is trusted only when a deployment
 * allows test IDs (MDL_ACCEPT_TEST_IDS); real licences chain to a state's own root instead.
 *
 * The wallet does what Apple Wallet or Google Wallet does on the phone: it holds a licence signed
 * by the issuing authority plus a device key, answers only the requested elements, signs the
 * session with the device key and encrypts the answer to the requester.
 */

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
x509.cryptoProvider.set(crypto);

export interface TestAuthority {
  name: string;
  rootPem: string;
  signerPem: string;
  signerPrivateJwk: JWK;
}

export async function createTestAuthority(opts: { name?: string; jurisdiction?: string } = {}): Promise<TestAuthority> {
  const name = opts.name ?? "decID Test DMV";
  const st = opts.jurisdiction ?? "US-CA";
  const now = Date.now();
  const notBefore = new Date(now - 24 * 3600 * 1000);
  const notAfter = new Date(now + 5 * 365 * 24 * 3600 * 1000);
  const rootKeys = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: hexSerial(),
    name: `C=US, ST=${st}, CN=${name} (TEST ROOT)`,
    notBefore,
    notAfter,
    signingAlgorithm: ALG,
    keys: rootKeys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(rootKeys.publicKey),
    ],
  });
  const signerKeys = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const signer = await x509.X509CertificateGenerator.create({
    serialNumber: hexSerial(),
    subject: `C=US, ST=${st}, CN=${name} document signer (TEST)`,
    issuer: root.subject,
    notBefore,
    notAfter: new Date(now + 2 * 365 * 24 * 3600 * 1000),
    signingAlgorithm: ALG,
    publicKey: signerKeys.publicKey,
    signingKey: rootKeys.privateKey,
    extensions: [
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension(["1.0.18013.5.1.2"], true), // mdlDS
      await x509.AuthorityKeyIdentifierExtension.create(rootKeys.publicKey),
    ],
  });
  return { name, rootPem: root.toString("pem"), signerPem: signer.toString("pem"), signerPrivateJwk: { ...((await crypto.subtle.exportKey("jwk", signerKeys.privateKey)) as JWK), alg: "ES256" } };
}

function hexSerial(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b, i) => (i === 0 ? b & 0x7f : b).toString(16).padStart(2, "0")).join("");
}

export interface TestLicenceHolder {
  /** Synthetic licence data. */
  birthDate: string;
  givenName?: string;
  familyName?: string;
  jurisdiction?: string;
  /** How long the licence's mobile credential is valid (default one year). */
  validDays?: number;
}

export interface TestWallet {
  /** The issuer-signed licence (CBOR). */
  mdoc: Uint8Array;
  devicePrivateJwk: JWK;
}

/** Issues a synthetic licence to a fresh device key, the way a DMV provisions a phone. */
export async function provisionTestLicence(authority: TestAuthority, holder: TestLicenceHolder, now = new Date()): Promise<TestWallet> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const devicePublicJwk = await exportJWK(publicKey);
  const devicePrivateJwk = await exportJWK(privateKey);
  const age = ageOn(holder.birthDate, now);
  const st = holder.jurisdiction ?? "US-CA";
  const validUntil = new Date(now.getTime() + (holder.validDays ?? 365) * 24 * 3600 * 1000);
  const doc = await new Document(MDL_DOCTYPE)
    .addIssuerNameSpace(MDL_NAMESPACE, {
      family_name: holder.familyName ?? "Sample",
      given_name: holder.givenName ?? "Alex",
      birth_date: holder.birthDate,
      issue_date: now.toISOString().slice(0, 10),
      expiry_date: validUntil.toISOString().slice(0, 10),
      issuing_country: "US",
      issuing_jurisdiction: st,
      document_number: `T${Math.floor(Math.random() * 1e8)}`,
      age_over_18: age >= 18,
      age_over_21: age >= 21,
    })
    .useDigestAlgorithm("SHA-256")
    .addValidityInfo({ signed: now, validFrom: now, validUntil })
    .addDeviceKeyInfo({ deviceKey: devicePublicJwk })
    .sign({ issuerPrivateKey: authority.signerPrivateJwk, issuerCertificate: authority.signerPem, alg: "ES256" });
  return { mdoc: new Uint8Array(new MDoc([doc]).encode()), devicePrivateJwk };
}

/**
 * The wallet's answer to a DC API request from `origin`: only the requested elements, signed by
 * the device key over this session, encrypted to the requester. Returns the DC API `response`.
 */
export async function answerRequest(wallet: TestWallet, request: MdocRequest, origin: string, opts: { tamper?: (deviceResponse: Uint8Array) => Uint8Array; unsigned?: boolean } = {}): Promise<string> {
  const { docType, elements } = requestedElements(request.deviceRequest);
  if (docType !== MDL_DOCTYPE) throw new Error(`the test wallet holds only a licence, not ${docType}`);
  const transcript = await sessionTranscript(request.encryptionInfo, origin);
  const pd = {
    id: "decid",
    input_descriptors: [
      {
        id: MDL_DOCTYPE,
        format: { mso_mdoc: { alg: ["ES256"] } },
        constraints: { limit_disclosure: "required", fields: elements.map((e) => ({ path: [`$['${MDL_NAMESPACE}']['${e}']`], intent_to_retain: false })) },
      },
    ],
  };
  let builder = DeviceResponse.from(wallet.mdoc).usingPresentationDefinition(pd).usingSessionTranscriptBytes(transcript.tagged as never);
  if (!opts.unsigned) builder = builder.authenticateWithSignature({ ...wallet.devicePrivateJwk, alg: "ES256" }, "ES256");
  let bytes: Uint8Array = new Uint8Array((await builder.sign()).encode());
  if (opts.tamper) bytes = new Uint8Array(opts.tamper(bytes));
  return encryptResponse(bytes, request.encryptionInfo, transcript.plain);
}

export function ageOn(birthDate: string, at: Date): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = at.getUTCFullYear() - y;
  if (at.getUTCMonth() + 1 < m || (at.getUTCMonth() + 1 === m && at.getUTCDate() < d)) age--;
  return age;
}
