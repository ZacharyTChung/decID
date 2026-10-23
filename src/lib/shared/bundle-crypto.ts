import { ENCRYPTED_BUNDLE_VERSION } from "./constants";
import { EncryptedBundleV1, HolderBundleV2, type EncryptedBundle, type HolderBundle } from "./bundle";

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_EXPORT_PASSWORD_LENGTH = 12;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(iterations: number, kdfSalt: string, iv: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${ENCRYPTED_BUNDLE_VERSION}|${iterations}|${kdfSalt}|${iv}`);
}

export async function encryptBundle(
  bundle: HolderBundle,
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<EncryptedBundle> {
  if (password.length < MIN_EXPORT_PASSWORD_LENGTH) {
    throw new Error(`export password must be at least ${MIN_EXPORT_PASSWORD_LENGTH} characters`);
  }
  const validated = HolderBundleV2.parse(bundle);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const saltB64 = b64url(salt);
  const ivB64 = b64url(iv);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(iterations, saltB64, ivB64), tagLength: 128 },
    key,
    new TextEncoder().encode(JSON.stringify(validated)),
  );
  return {
    version: ENCRYPTED_BUNDLE_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: saltB64 },
    cipher: { name: "AES-GCM", iv: ivB64 },
    ciphertext: b64url(new Uint8Array(ciphertext)),
  };
}

export class BundleDecryptionError extends Error {}

/** Throws BundleDecryptionError for a wrong password or any modified byte. */
export async function decryptBundle(envelope: unknown, password: string): Promise<HolderBundle> {
  const parsed = EncryptedBundleV1.safeParse(envelope);
  if (!parsed.success) throw new BundleDecryptionError("not a supported encrypted bundle file");
  const e = parsed.data;
  const key = await deriveKey(password, unb64url(e.kdf.salt), e.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64url(e.cipher.iv), additionalData: aad(e.kdf.iterations, e.kdf.salt, e.cipher.iv), tagLength: 128 },
      key,
      unb64url(e.ciphertext),
    );
  } catch {
    throw new BundleDecryptionError("wrong password or the file was modified");
  }
  const bundle = HolderBundleV2.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));
  if (!bundle.success) throw new BundleDecryptionError("decrypted content is not a valid holder bundle");
  return bundle.data;
}
