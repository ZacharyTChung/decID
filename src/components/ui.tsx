"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { deriveHolderDid } from "@/lib/shared/did-pkh";
import { describeError } from "@/lib/client/errors";
import { useApp } from "./providers";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Card({ title, subtitle, children, tone = "default", id }: { title?: string; subtitle?: ReactNode; children: ReactNode; tone?: "default" | "warn" | "muted"; id?: string }) {
  return (
    <section
      id={id}
      className={cx(
        "rounded-xl border p-5 shadow-sm",
        tone === "default" && "border-slate-200 bg-white",
        tone === "warn" && "border-amber-300 bg-amber-50",
        tone === "muted" && "border-slate-200 bg-slate-50",
      )}
    >
      {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
      {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 ring-slate-300",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-300",
    red: "bg-rose-50 text-rose-800 ring-rose-300",
    amber: "bg-amber-50 text-amber-800 ring-amber-300",
    blue: "bg-sky-50 text-sky-800 ring-sky-300",
  } as const;
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>{children}</span>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  busy,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  busy?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick ? () => void onClick() : undefined}
      className={cx(
        "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-700 focus-visible:ring-slate-900",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-400",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-500 focus-visible:ring-rose-600",
      )}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warn"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-lg px-3 py-2 text-sm",
        tone === "info" && "bg-sky-50 text-sky-900",
        tone === "error" && "bg-rose-50 text-rose-900",
        tone === "success" && "bg-emerald-50 text-emerald-900",
        tone === "warn" && "bg-amber-50 text-amber-900",
      )}
    >
      {children}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="break-all rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800">{children}</code>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-800">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

/** Runs an async action with busy and error state, mapping wallet/RPC/contract errors to plain text. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(describeError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

const NAV = [
  { href: "/lab", label: "Lab" },
  { href: "/holder", label: "Holder" },
  { href: "/issuer", label: "Issuer" },
  { href: "/verifier", label: "Verifier" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Decentralized Identity MVP
          </Link>
          <nav aria-label="Role views" className="flex gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={path === n.href ? "page" : undefined}
                className={cx("rounded-md px-3 py-1.5 text-sm", path === n.href ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900">
          Prototype. Synthetic data only, local test chain only. Not real identity verification and not a production system.
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">{children}</main>
    </div>
  );
}

/** Wallet connection status: address, DID for the active chain, network, and the honest no-wallet state. */
export function WalletBar() {
  const app = useApp();
  const { busy, error, run } = useAction();
  if (app.configError) {
    return (
      <Card tone="warn" title="App is not configured">
        <p className="text-sm">
          Could not load the deployment ({app.configError}). Start the local chain and deploy: <Mono>npm run chain</Mono>, then{" "}
          <Mono>npm run setup && npm run deploy</Mono>.
        </p>
      </Card>
    );
  }
  if (!app.walletAvailable) {
    return (
      <Card tone="warn" title="No browser wallet detected">
        <p className="text-sm">
          This view needs an injected EIP-1193 wallet (for example MetaMask) connected to the local Hardhat chain. Nothing on this page is simulated: without a
          wallet you cannot sign. Run the full lifecycle headlessly with <Mono>npm run demo</Mono> instead.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-sm">
          {app.address ? (
            <>
              <div>
                <span className="text-slate-500">Wallet </span>
                <Mono>{app.address}</Mono>
              </div>
              {app.chainId !== undefined && (
                <div>
                  <span className="text-slate-500">DID </span>
                  <Mono>{deriveHolderDid(app.chainId, app.address)}</Mono>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Network</span>
                {app.onExpectedChain ? <Badge tone="green">Local chain {app.chainId}</Badge> : <Badge tone="red">Wrong network ({app.chainId ?? "unknown"})</Badge>}
              </div>
            </>
          ) : (
            <span className="text-slate-600">Wallet not connected.</span>
          )}
        </div>
        <div className="flex gap-2">
          {!app.address && (
            <Button busy={busy} onClick={() => run(app.connect)}>
              Connect wallet
            </Button>
          )}
          {app.address && !app.onExpectedChain && app.config && (
            <Button busy={busy} onClick={() => run(app.switchToLocalChain)}>
              Switch to local chain {app.config.chainId}
            </Button>
          )}
        </div>
      </div>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
    </Card>
  );
}

/** Requires a SIWE session for the given role on the current wallet. */
export function SignInGate({ role, children }: { role: "holder" | "issuer"; children: ReactNode }) {
  const app = useApp();
  const { busy, error, run } = useAction();
  if (!app.address || !app.onExpectedChain) return null;
  const ok = app.session && app.session.role === role && app.session.address === app.address;
  if (ok) {
    return (
      <>
        <div className="flex items-center justify-between rounded-lg bg-white px-4 py-2 text-sm shadow-sm ring-1 ring-slate-200">
          <span>
            Signed in as <Badge tone="blue">{role}</Badge> (session expires {new Date(app.session!.expiresAt * 1000).toLocaleTimeString()})
          </span>
          <Button variant="secondary" onClick={() => app.signOut()}>
            Sign out
          </Button>
        </div>
        {children}
      </>
    );
  }
  return (
    <Card title={`Sign in as ${role}`} subtitle="Sign-In with Ethereum (ERC-4361). Your wallet signs a text message; no transaction, no gas, and it does not authorize sharing any credential.">
      {app.session && app.session.role !== role && <Notice tone="warn">You are signed in as {app.session.role}. Signing in as {role} replaces that session.</Notice>}
      <div className="mt-3 flex items-center gap-3">
        <Button busy={busy} onClick={() => run(() => app.signIn(role))}>
          Sign in with wallet
        </Button>
      </div>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
    </Card>
  );
}
