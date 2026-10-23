import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matchCode, sha256Hex } from "@/lib/shared/receipt-chain";

// The shared (browser-safe) helpers must give byte-for-byte the same results as the node:crypto
// implementations the server used before they were shared with the hosted prototype.
describe("receipt-chain helpers", () => {
  it("sha256Hex equals node's createHash hex digest", () => {
    for (const s of ["", "abc", "ü✓ receipt", randomBytes(64).toString("base64url")]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });

  it("matchCode equals the previous node:crypto implementation", () => {
    const ALPHABET = "ACDEFHJKMNPRTUVWXY3479";
    const old = (id: string, sig: string) => {
      const h = createHash("sha256").update(`${id}|${sig}`).digest();
      return Array.from(h.subarray(0, 4), (b) => ALPHABET[b % ALPHABET.length]).join("");
    };
    for (let i = 0; i < 200; i++) {
      const id = randomBytes(16).toString("hex");
      const sig = `0x${randomBytes(65).toString("hex")}`;
      expect(matchCode(id, sig)).toBe(old(id, sig));
    }
  });
});
