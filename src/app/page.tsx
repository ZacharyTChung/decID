"use client";

import Link from "next/link";
import { useApp } from "@/components/providers";
import { Badge, Card, Mono, Notice, Shell } from "@/components/ui";

const ROLES = [
  {
    href: "/holder",
    title: "Holder",
    text: "Connect a wallet, request a credential with synthetic data, keep it privately, register its commitment on-chain, and use the gated action.",
  },
  {
    href: "/issuer",
    title: "Issuer (simulated)",
    text: "An authorized operator reviews synthetic requests, issues a minimal signed credential, and can revoke it on-chain.",
  },
  {
    href: "/verifier",
    title: "Verifier",
    text: "Creates a single-use challenge, checks the credential, the wallet proof, the issuer trust policy and the live registry, and reports each check.",
  },
];

export default function Home() {
  const app = useApp();
  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-semibold">A privacy-conscious credential, end to end</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          A W3C Verifiable Credential (VC 2.0, secured as <Mono>application/vc+jwt</Mono>) is held off-chain by the holder. A local EVM registry stores only a randomized
          commitment, its status, and the issuer’s authorization. Verification combines both, and revocation is visible to every verifier and contract.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {ROLES.map((r) => (
          <Link key={r.href} href={r.href} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-400">
            <div className="font-semibold">{r.title} →</div>
            <p className="mt-2 text-sm text-slate-600">{r.text}</p>
          </Link>
        ))}
      </div>
      <Card title="Deployment">
        {app.configError ? (
          <Notice tone="error">Not configured: {app.configError}. Run <Mono>npm run chain</Mono>, then <Mono>npm run setup && npm run deploy</Mono>.</Notice>
        ) : app.config ? (
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Chain</dt>
              <dd>
                <Badge tone="green">Local Hardhat {app.config.chainId}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">CredentialRegistry</dt>
              <dd><Mono>{app.config.registry}</Mono></dd>
            </div>
            <div>
              <dt className="text-slate-500">DemoGate</dt>
              <dd><Mono>{app.config.gate}</Mono></dd>
            </div>
            <div>
              <dt className="text-slate-500">Schema id</dt>
              <dd><Mono>{app.config.schemaId}</Mono></dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </Card>
      <Card title="What this prototype is and is not" tone="muted">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>It demonstrates the trust and verification flow. It does not verify anyone’s real identity, and its issuer is simulated.</li>
          <li>It is data-minimized and pseudonymous, not anonymous: wallet addresses, the issuer relationship, timestamps and repeated presentations can be linked.</li>
          <li>Hashing is not encryption. The on-chain commitment is salted with 32 random bytes the holder keeps private.</li>
          <li>Not audited, not production-ready, and no health or official identity integrations.</li>
        </ul>
      </Card>
    </Shell>
  );
}
