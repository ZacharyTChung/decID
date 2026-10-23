"use client";

import { EncryptedBundleV1, type EncryptedBundle } from "@/lib/shared/bundle";

/**
 * Device vault: the holder's bundle, ENCRYPTED with their passphrase (the same
 * PBKDF2-SHA-256 / AES-256-GCM envelope as the file export), stored in IndexedDB under the
 * holder's wallet address. Only ciphertext is persisted. The passphrase and the decrypted
 * bundle never touch storage, so a copy of the browser profile does not reveal the credential
 * without the passphrase. Script running in this origin (XSS) could still capture the
 * passphrase as it is typed; the strict CSP is the defense there.
 */

const DB_NAME = "did-mvp-vault";
const STORE = "bundles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

const keyFor = (address: string) => address.toLowerCase();

export async function saveToVault(address: string, envelope: EncryptedBundle): Promise<void> {
  await tx("readwrite", (s) => s.put(EncryptedBundleV1.parse(envelope), keyFor(address)));
}

export async function loadFromVault(address: string): Promise<EncryptedBundle | undefined> {
  const raw = await tx<unknown>("readonly", (s) => s.get(keyFor(address)));
  if (raw === undefined) return undefined;
  const parsed = EncryptedBundleV1.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function deleteFromVault(address: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(keyFor(address)));
}
