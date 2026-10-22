// Minimal typings for the Digital Bazaar did:key libraries (they ship no TypeScript types).
declare module "@digitalbazaar/did-method-key" {
  export interface VerificationMethod {
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
  }
  export interface DidDocument {
    id: string;
    verificationMethod?: VerificationMethod[];
    assertionMethod?: (string | VerificationMethod)[];
    [key: string]: unknown;
  }
  export interface DidKeyDriver {
    use(options: { multibaseMultikeyHeader: string; fromMultibase: (vm: unknown) => Promise<unknown> }): void;
    get(options: { did?: string; url?: string }): Promise<DidDocument>;
    fromKeyPair(options: { verificationKeyPair: unknown }): Promise<{ didDocument: DidDocument }>;
    publicMethodFor(options: { didDocument: DidDocument; purpose: string }): VerificationMethod;
  }
  export function driver(): DidKeyDriver;
}

declare module "@digitalbazaar/ed25519-multikey" {
  export interface Ed25519KeyPair {
    id?: string;
    controller?: string;
    publicKeyMultibase: string;
  }
  export function from(key: unknown): Promise<Ed25519KeyPair>;
  export function fromJwk(options: { jwk: unknown; secretKey?: boolean; id?: string; controller?: string }): Promise<Ed25519KeyPair>;
  export function toJwk(options: { keyPair: Ed25519KeyPair; secretKey?: boolean }): Promise<{ kty: string; crv: string; x: string; d?: string }>;
}
