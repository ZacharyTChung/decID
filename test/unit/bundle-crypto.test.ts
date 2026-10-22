import { describe, expect, it } from "vitest";
import { BundleDecryptionError, decryptBundle, encryptBundle } from "@/lib/shared/bundle-crypto";
import { HOLDER_BUNDLE_VERSION } from "@/lib/shared/constants";
import type { HolderBundle } from "@/lib/shared/bundle";

// Fewer PBKDF2 iterations keep the tests fast; the format still records the count.
const ITER = 100_000;
const PASSWORD = "correct horse battery staple";

const bundle: HolderBundle = {
  version: HOLDER_BUNDLE_VERSION,
  credentialJwt: "eyJhbGciOiJFZDI1NTE5In0.eyJ4IjoxfQ.c2ln",
  salt: "0x" + "ab".repeat(32),
  commitment: "0x" + "cd".repeat(32),
  authorization: {
    commitment: "0x" + "cd".repeat(32),
    holder: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    issuer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    schemaId: "0x" + "ef".repeat(32),
    validFrom: 1_700_000_000,
    expiresAt: 1_800_000_000,
    issuerEpoch: 0,
    deadline: 1_700_086_400,
  },
  authorizationSignature: "0x" + "12".repeat(65),
  deployment: { chainId: 31337, registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3" },
  issuedAt: "2026-10-22T00:00:00.000Z",
};

function flip(b64: string): string {
  const c = b64[10] === "A" ? "B" : "A";
  return b64.slice(0, 10) + c + b64.slice(11);
}

describe("encrypted holder bundle export (PBKDF2-SHA256 + AES-256-GCM)", () => {
  it("round-trips with the right password and never contains plaintext", async () => {
    const env = await encryptBundle(bundle, PASSWORD, ITER);
    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain(bundle.credentialJwt);
    expect(serialized).not.toContain(bundle.salt.slice(2));
    expect(serialized).not.toContain(PASSWORD);
    expect(await decryptBundle(JSON.parse(serialized), PASSWORD)).toEqual(bundle);
  });

  it("uses fresh randomness per export", async () => {
    const a = await encryptBundle(bundle, PASSWORD, ITER);
    const b = await encryptBundle(bundle, PASSWORD, ITER);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects an incorrect password", async () => {
    const env = await encryptBundle(bundle, PASSWORD, ITER);
    await expect(decryptBundle(env, "wrong password!!")).rejects.toBeInstanceOf(BundleDecryptionError);
  });

  it("rejects modified ciphertext, IV, KDF salt or iteration count", async () => {
    const env = await encryptBundle(bundle, PASSWORD, ITER);
    await expect(decryptBundle({ ...env, ciphertext: flip(env.ciphertext) }, PASSWORD)).rejects.toBeInstanceOf(BundleDecryptionError);
    await expect(decryptBundle({ ...env, cipher: { ...env.cipher, iv: flip(env.cipher.iv) } }, PASSWORD)).rejects.toBeInstanceOf(BundleDecryptionError);
    await expect(decryptBundle({ ...env, kdf: { ...env.kdf, salt: flip(env.kdf.salt) } }, PASSWORD)).rejects.toBeInstanceOf(BundleDecryptionError);
    await expect(decryptBundle({ ...env, kdf: { ...env.kdf, iterations: ITER + 1 } }, PASSWORD)).rejects.toBeInstanceOf(BundleDecryptionError);
  });

  it("rejects short passwords and unknown file formats", async () => {
    await expect(encryptBundle(bundle, "short", ITER)).rejects.toThrow(/at least 12/);
    await expect(decryptBundle({ version: "something-else" }, PASSWORD)).rejects.toBeInstanceOf(BundleDecryptionError);
    await expect(decryptBundle(bundle, PASSWORD)).rejects.toBeInstanceOf(BundleDecryptionError);
  });
});
