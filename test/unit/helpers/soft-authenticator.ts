import { createHash, generateKeyPairSync, sign, randomBytes, type KeyObject } from "node:crypto";
import { Encoder } from "cbor-x";

/**
 * A software platform authenticator for tests: produces real WebAuthn registration and
 * authentication responses (ES256, "none" attestation), the way Face ID / Touch ID does, so the
 * server's verification runs unmodified. `uv` controls the user-verified flag.
 */

const cbor = new Encoder({ mapsAsObjects: false, useRecords: false, tagUint8Array: false });
const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly key: { privateKey: KeyObject; publicKey: KeyObject };
  private counter = 0;
  constructor(
    readonly origin: string,
    readonly rpId = new URL(origin).hostname,
  ) {
    this.key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  }

  private authData(flags: number, attested?: Buffer): Buffer {
    this.counter++;
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), c, attested ?? Buffer.alloc(0)]);
  }

  register(challenge: string, opts: { uv?: boolean; origin?: string } = {}) {
    const jwk = this.key.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const cose = new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), len, this.credentialId, Buffer.from(cbor.encode(cose))]);
    const authData = this.authData(0x01 | (opts.uv === false ? 0 : 0x04) | 0x40, attested);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const attestationObject = Buffer.from(cbor.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])));
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key" as const,
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  assert(challenge: string, opts: { uv?: boolean; origin?: string; counter?: number } = {}) {
    if (opts.counter !== undefined) this.counter = opts.counter - 1; // e.g. an old counter: a cloned key
    const authData = this.authData(0x01 | (opts.uv === false ? 0 : 0x04));
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.key.privateKey);
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key" as const,
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
