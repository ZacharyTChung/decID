import "server-only";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir, mdlAcceptTestIds, mdlTrustDir } from "../config";
import type { TrustAnchor } from "../../shared/mdl/verify";
import { createTestAuthority, type TestAuthority } from "../../shared/mdl/test-wallet";

/** The issuing authorities whose mobile licences this deployment accepts. */
export async function mdlTrustAnchors(): Promise<TrustAnchor[]> {
  const anchors: TrustAnchor[] = [];
  const dir = mdlTrustDir();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".pem")).sort()) {
      const pem = readFileSync(path.join(dir, f), "utf8");
      const named = /^#\s*name:\s*(.+)$/m.exec(pem)?.[1]?.trim();
      anchors.push({ name: named ?? f.replace(/\.pem$/, ""), pem: pem.replace(/^#.*$/gm, "").trim(), test: false });
    }
  }
  if (mdlAcceptTestIds()) {
    const t = await testAuthority();
    anchors.push({ name: t.name, pem: t.rootPem, test: true });
  }
  return anchors;
}

let cached: { file: string; authority: TestAuthority } | undefined;

/**
 * The generated TEST issuing authority (dev, tests, demo). Created once per data directory; the
 * file is written exclusively, so concurrent instances end up sharing one authority.
 */
export async function testAuthority(): Promise<TestAuthority> {
  const file = path.join(dataDir(), "mdl-test-authority.json");
  if (cached?.file === file) return cached.authority;
  if (!existsSync(file)) {
    const fresh = await createTestAuthority();
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      writeFileSync(file, JSON.stringify(fresh), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  const authority = JSON.parse(readFileSync(file, "utf8")) as TestAuthority;
  cached = { file, authority };
  return authority;
}
