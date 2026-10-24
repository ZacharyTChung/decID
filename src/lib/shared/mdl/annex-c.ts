import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Decoder, Encoder, Tag } from "cbor-x";
import { base64url } from "jose";

/**
 * Asking the ID in a phone's wallet (Apple Wallet, Google Wallet, a state wallet) for one answer,
 * through the browser's Digital Credentials API, as defined by ISO/IEC 18013-7 Annex C
 * ("org-iso-mdoc"). Safari 26+ and Chrome 141+ support it.
 *
 * The page calls navigator.credentials.get({ digital: { requests: [{ protocol: "org-iso-mdoc",
 * data: { deviceRequest, encryptionInfo } }] } }). The wallet shows the person who is asking and
 * what for; on approval it returns a DeviceResponse encrypted to our one-time key (HPKE), bound to
 * this request and to the page's origin through the SessionTranscript. A response captured on
 * another site, or replayed, does not decrypt or does not verify.
 *
 * Shared by the server and the in-browser prototype (no Node APIs).
 */

export const MDL_DOCTYPE = "org.iso.18013.5.1.mDL";
export const MDL_NAMESPACE = "org.iso.18013.5.1";
export const DC_PROTOCOL = "org-iso-mdoc";

/** Only the age answers. Never the birth date, name, address, photo or licence number. */
export const AGE_ELEMENTS = ["age_over_18", "age_over_21"] as const;

const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
const enc = new Encoder({ mapsAsObjects: false, useRecords: false, tagUint8Array: false });
const dec = new Decoder({ mapsAsObjects: false, useRecords: false });
export const cbor = (v: unknown) => new Uint8Array(enc.encode(v));
export const uncbor = (b: Uint8Array) => dec.decode(b) as unknown;

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
}

export interface ReaderKey {
  /** 32-byte P-256 private scalar, base64url. Kept server-side (or in memory) for one request. */
  privateKey: string;
  publicKey: CryptoKey;
}

export async function newReaderKey(): Promise<ReaderKey> {
  const kp = await suite.kem.generateKeyPair();
  return { privateKey: base64url.encode(new Uint8Array(await suite.kem.serializePrivateKey(kp.privateKey))), publicKey: kp.publicKey };
}

/** The `data` member of the DC API request, plus what the verifier keeps to check the answer. */
export interface MdocRequest {
  deviceRequest: string;
  encryptionInfo: string;
}

export async function buildRequest(readerPublicKey: CryptoKey, elements: readonly string[] = AGE_ELEMENTS): Promise<MdocRequest> {
  const raw = new Uint8Array(await suite.kem.serializePublicKey(readerPublicKey)); // 0x04 || x || y
  const coseKey = new Map<number, unknown>([
    [1, 2], // kty: EC2
    [-1, 1], // crv: P-256
    [-2, raw.slice(1, 33)],
    [-3, raw.slice(33, 65)],
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const encryptionInfo = ["dcapi", new Map<string, unknown>([["nonce", nonce], ["recipientPublicKey", coseKey]])];
  const itemsRequest = new Map<string, unknown>([
    ["docType", MDL_DOCTYPE],
    // intentToRetain = false: decID keeps none of it.
    ["nameSpaces", new Map([[MDL_NAMESPACE, new Map(elements.map((e) => [e, false]))]])],
  ]);
  const deviceRequest = new Map<string, unknown>([
    ["version", "1.0"],
    ["docRequests", [new Map([["itemsRequest", new Tag(cbor(itemsRequest), 24)]])]],
  ]);
  return { deviceRequest: base64url.encode(cbor(deviceRequest)), encryptionInfo: base64url.encode(cbor(encryptionInfo)) };
}

/**
 * The bytes inside a #6.24 (embedded CBOR) item. A plain cbor-x Tag normally, but @auth0/mdl
 * registers a global tag-24 extension (DataItem), which applies wherever both share one cbor-x
 * instance (browser bundles).
 */
function embedded(v: unknown): Uint8Array {
  if (v instanceof Tag) return v.value as Uint8Array;
  const buffer = (v as { buffer?: unknown } | null)?.buffer;
  if (buffer instanceof Uint8Array) return buffer;
  throw new MdocProtocolError("expected embedded CBOR (tag 24)");
}

/** Reads the requested element names back out of a DeviceRequest (the test wallet uses this). */
export function requestedElements(deviceRequest: string): { docType: string; elements: string[] } {
  const dr = uncbor(base64url.decode(deviceRequest)) as Map<string, unknown>;
  const first = (dr.get("docRequests") as Map<string, unknown>[])[0]!;
  const items = uncbor(embedded(first.get("itemsRequest"))) as Map<string, unknown>;
  const ns = (items.get("nameSpaces") as Map<string, Map<string, boolean>>).get(MDL_NAMESPACE) ?? new Map();
  return { docType: items.get("docType") as string, elements: [...ns.keys()] };
}

/**
 * SessionTranscript = [null, null, ["dcapi", SHA-256(CBOR([encryptionInfo, origin]))]].
 * `plain` is the HPKE `info`; `tagged` (#6.24) is what the DeviceAuthentication signature covers.
 */
export async function sessionTranscript(encryptionInfo: string, origin: string): Promise<{ plain: Uint8Array; tagged: Uint8Array }> {
  const serializedOrigin = origin.replace(/\/+$/, "");
  const hash = await sha256(cbor([encryptionInfo, serializedOrigin]));
  const transcript = [null, null, ["dcapi", hash]];
  const plain = cbor(transcript);
  return { plain, tagged: cbor(new Tag(plain, 24)) };
}

export class MdocProtocolError extends Error {}

/** Decrypts the wallet's `response` (base64url CBOR ["dcapi", {enc, cipherText}]) into DeviceResponse bytes. */
export async function decryptResponse(response: string, readerPrivateKey: string, transcriptPlain: Uint8Array): Promise<Uint8Array> {
  let encBytes: Uint8Array;
  let cipherText: Uint8Array;
  try {
    const parsed = uncbor(base64url.decode(response)) as [string, Map<string, Uint8Array>];
    if (!Array.isArray(parsed) || parsed[0] !== "dcapi" || !(parsed[1] instanceof Map)) throw new Error("shape");
    encBytes = parsed[1].get("enc")!;
    cipherText = parsed[1].get("cipherText")!;
    if (!(encBytes instanceof Uint8Array) || !(cipherText instanceof Uint8Array)) throw new Error("shape");
  } catch {
    throw new MdocProtocolError("the wallet's answer is not an org-iso-mdoc encrypted response");
  }
  const recipientKey = await suite.kem.deserializePrivateKey(base64url.decode(readerPrivateKey) as BufferSource as ArrayBuffer);
  try {
    return new Uint8Array(await suite.open({ recipientKey, enc: encBytes as BufferSource as ArrayBuffer, info: transcriptPlain as BufferSource as ArrayBuffer }, cipherText as BufferSource as ArrayBuffer));
  } catch {
    // Wrong key, wrong request or a different origin: the transcript is part of the HPKE info.
    throw new MdocProtocolError("the wallet's answer was not made for this request on this site");
  }
}

/** Wallet side: encrypts a DeviceResponse to the reader key named in `encryptionInfo`. */
export async function encryptResponse(deviceResponse: Uint8Array, encryptionInfo: string, transcriptPlain: Uint8Array): Promise<string> {
  const ei = uncbor(base64url.decode(encryptionInfo)) as [string, Map<string, unknown>];
  const ck = ei[1].get("recipientPublicKey") as Map<number, Uint8Array>;
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(ck.get(-2)!, 1);
  raw.set(ck.get(-3)!, 33);
  const recipientPublicKey = await suite.kem.deserializePublicKey(raw.buffer);
  const sealed = await suite.seal({ recipientPublicKey, info: transcriptPlain as BufferSource as ArrayBuffer }, deviceResponse as BufferSource as ArrayBuffer);
  const out = ["dcapi", new Map<string, Uint8Array>([["enc", new Uint8Array(sealed.enc)], ["cipherText", new Uint8Array(sealed.ct)]])];
  return base64url.encode(cbor(out));
}
