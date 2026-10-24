"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, FileCheck2, LayoutGrid, Link2, ListChecks, ScrollText, ShieldCheck } from "lucide-react";
import { friendlyReason } from "../../lib/shared/policies";
import { DecidWordmark } from "./brand";
import { MerchantLogo, type MerchantBrand } from "./merchant";
import { Button, DefinitionList, Drawer, EmptyRow, KpiStrip, OutcomeChart, Panel, Segmented, StatusLabel, TimingChart, relativeTime, td, th, type CheckStatus } from "./dashboard";

/**
 * The decID Verify business dashboard. Data comes from the host: the hosted prototype reads its
 * in-page decID; the Next app reads GET /api/business/overview. Features a host can't provide
 * (the receipt list, the integrity test, the traffic simulation, per-check timings) are optional.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export interface CheckRow {
  id: string;
  reference: string | null;
  status: CheckStatus;
  failureCode: string | null;
  matchCode: string | null;
  issuerName: string | null;
  createdAt: number;
  completedAt: number | null;
}
export interface CheckDetail extends CheckRow {
  answer: boolean | null;
  verifyMs?: number | null;
  receipt?: { valid: boolean; payload: Record<string, unknown> } | null;
}
export interface ChainStatus {
  ok: boolean;
  count: number;
  head: string;
  firstBrokenSeq?: number;
  problem?: string;
  /** The same log compared with its on-chain checkpoints (null: anchoring not deployed). */
  anchor?: AnchorView | null;
}
export type AnchorView = { ok: boolean; anchoredCount: number; checkpoints: number; unanchored: number; latestBlock?: number; latestTx?: string; brokenAt?: number; problem?: string } | { unavailable: true };
export type TamperKind = "insider" | "operator" | "truncate";
const ATTACKS: { kind: TamperKind; label: string; did: (seq: number) => string; caughtBy: string }[] = [
  { kind: "insider", label: "Edit a receipt as an insider", did: (n) => `Receipt ${n}’s outcome was flipped and its stored hash recomputed, without decID’s key.`, caughtBy: "Caught by the signature check." },
  { kind: "operator", label: "Rewrite history as the operator", did: (n) => `Receipt ${n} was flipped and re-signed with decID’s real key, and every later receipt re-chained. Signatures and links all verify.`, caughtBy: "Only the on-chain checkpoints catch this." },
  { kind: "truncate", label: "Delete the newest receipt", did: (n) => `Receipt ${n} was deleted. A shorter chain is still a valid chain.`, caughtBy: "Only the anchored count catches this." },
];
export interface ReceiptRow {
  seq: number;
  hash: string;
  prev: string;
  outcome: string;
  signedAt: number | null;
}

export interface VerifyDashboardProps {
  merchant: MerchantBrand;
  merchants: MerchantBrand[];
  onMerchant: (id: string) => void;
  keyHint: string;
  stats: { verified: number; rejected: number; failures: Record<string, number>; medianSecondsToAnswer?: number | null; verifyMs?: { id: string; ms: number; ok: boolean }[] };
  checks: CheckRow[];
  chain?: ChainStatus;
  storedFields: string[];
  now: number;
  loadCheck: (id: string) => Promise<CheckDetail>;
  receipts?: ReceiptRow[];
  integrity?: { tampered: { kind: TamperKind; seq: number } | null; tamper: (kind: TamperKind) => void; undo: () => void };
  simulate?: { label: string; description: string; run: () => void; progress: { done: number; total: number; lines: string[] } | null };
  receiptKeyId?: string;
  accountMenu?: ReactNode;
  className?: string;
}

type Page = "overview" | "checks" | "receipts" | "data";

/** Chart labels: short names for the ways a check is blocked. */
const SHORT_REASON: Record<string, string> = {
  SUBJECT_NOT_PRESENTER: "Borrowed credential",
  PROOF_SIGNER_MISMATCH: "Borrowed credential",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
  REGISTRY_EXPIRED: "Expired",
  NOT_REGISTERED: "Not activated",
  CHALLENGE_REUSED: "Replayed",
  SESSION_USED: "Replayed",
};

const FIELD_PURPOSE: Record<string, string> = {
  id: "Random request ID",
  merchant_id: "Your business",
  policy: "What you asked (age_over_21)",
  reference: "Your order or door reference",
  nonce: "One-time challenge",
  audience: "Your business, as signed by the customer",
  chain_id: "Registry network",
  registry: "Registry contract",
  created_at: "Time",
  expires_at: "Time",
  status: "Outcome",
  failure_code: "Why a check failed",
  completed_at: "Time",
  match_code: "Four-character door code",
  issuer_name: "Who vouched",
  receipt_seq: "Receipt number",
};

export function VerifyDashboard(p: VerifyDashboardProps) {
  const [page, setPage] = useState<Page>("overview");
  const [open, setOpen] = useState<CheckDetail>();
  const underAge = p.stats.failures.POLICY_NOT_SATISFIED ?? 0;
  const blocked = p.stats.rejected - underAge;
  const night = p.simulate?.progress ?? null;
  const running = !!night && night.done < night.total;
  const nav: [Page, string, typeof LayoutGrid][] = [
    ["overview", "Overview", LayoutGrid],
    ["checks", "Checks", ListChecks],
    ["receipts", "Receipts", ScrollText],
    ["data", "Data & privacy", ShieldCheck],
  ];
  const openCheck = async (id: string) => setOpen(await p.loadCheck(id));

  return (
    <div className={cx("relative flex min-h-[720px] bg-ink-2 font-sans text-ink-12", p.className)}>
      <aside className="hidden w-[216px] shrink-0 flex-col border-r border-ink-4 bg-white/70 md:flex">
        <div className="flex h-14 items-center px-5">
          <DecidWordmark product="Verify" />
        </div>
        <label className="relative mx-3 mt-3 flex items-center">
          <span className="sr-only">Business</span>
          <span className="pointer-events-none absolute left-2">
            <MerchantLogo merchant={p.merchant} size={20} />
          </span>
          <select id="biz-merchant" value={p.merchant.id} onChange={(e) => p.onMerchant(e.target.value)} className="h-9 w-full appearance-none rounded-[10px] bg-ink-3 pl-9 pr-7 text-ui font-medium">
            {p.merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 text-ink-10" aria-hidden />
        </label>
        <nav className="mt-3 flex flex-col gap-0.5 px-2" aria-label="Dashboard">
          {nav.map(([id, label, Icon]) => (
            <button key={id} onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined} className={cx("flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-ui transition-colors", page === id ? "bg-ink-3 font-medium text-ink-12" : "text-ink-11 hover:bg-ink-2")}>
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-5 py-4 text-meta text-ink-10">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warn-dot" aria-hidden /> Test mode
          </span>
          <div className="mt-0.5 font-mono">{p.keyHint}</div>
          {p.accountMenu}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2 px-4 py-2 md:hidden">
          <select aria-label="Business" value={p.merchant.id} onChange={(e) => p.onMerchant(e.target.value)} className="h-8 rounded-sm border border-ink-6 bg-white px-2 text-ui">
            {p.merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select aria-label="Page" value={page} onChange={(e) => setPage(e.target.value as Page)} className="h-8 rounded-sm border border-ink-6 bg-white px-2 text-ui">
            {nav.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <header className="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-6">
          <div>
            <h2 className="font-display text-h2 font-semibold">{nav.find((n) => n[0] === page)![1]}</h2>
            <p className="text-ui text-ink-10">
              {p.merchant.name} · {p.merchant.kind === "venue" ? "Venue" : "Online store"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-meta text-ink-11 shadow-card sm:inline-flex">
              <ShieldCheck size={13} strokeWidth={1.75} aria-hidden /> Personal data held: none
            </span>
            {p.simulate && (
              <Button variant="primary" onClick={p.simulate.run} busy={running} testId="run-night">
                {running ? `Simulating ${night!.done}/${night!.total}` : p.simulate.label}
              </Button>
            )}
          </div>
        </header>

        <div className="space-y-6 px-6 py-5">
          {night && p.simulate && page !== "data" && (
            <Panel title="Simulated night" description={p.simulate.description} actions={running ? undefined : <span className="text-meta text-ink-10">Done</span>}>
              <ol tabIndex={0} aria-label="Door log" data-testid="night-log" className="grid max-h-40 gap-x-8 overflow-y-auto font-mono text-meta text-ink-11 sm:grid-cols-2">
                {night.lines.map((l, i) => (
                  <li key={i} className={/^(Borrowed|Revoked)/.test(l) ? "text-bad" : ""}>
                    {l}
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {page === "overview" && (
            <>
              <KpiStrip
                items={[
                  { label: "Checks", value: p.stats.verified + p.stats.rejected },
                  { label: "Passed", value: p.stats.verified },
                  { label: "Under 21", value: underAge },
                  { label: "Blocked", value: blocked, hint: "Borrowed, revoked or invalid" },
                ]}
              />
              <div className="grid gap-6 xl:grid-cols-2">
                <Panel title="Outcomes" description="Every completed check.">
                  <OutcomeChart
                    rows={[
                      { label: "Passed", n: p.stats.verified, tone: "ok" },
                      { label: "Not old enough", n: underAge, tone: "neutral" },
                      ...Object.entries(p.stats.failures)
                        .filter(([c]) => c !== "POLICY_NOT_SATISFIED")
                        .map(([c, n]) => ({ label: SHORT_REASON[c] ?? friendlyReason(c), n, tone: "bad" as const })),
                    ]}
                  />
                </Panel>
                {p.stats.verifyMs ? (
                  <Panel title="Verification time" description="Signature, issuer, holder binding and live registry status.">
                    <TimingChart points={p.stats.verifyMs} />
                  </Panel>
                ) : (
                  <Panel title="Time to answer" description="From your request to the customer’s answer.">
                    <p className="num font-display text-h1 font-semibold">{p.stats.medianSecondsToAnswer == null ? "–" : `${p.stats.medianSecondsToAnswer}s`}</p>
                    <p className="mt-1 text-ui text-ink-10">Median across completed checks.</p>
                  </Panel>
                )}
              </div>
              <Panel title="Recent checks" flush actions={<Button size="sm" variant="ghost" onClick={() => setPage("checks")}>View all</Button>}>
                <ChecksTable rows={p.checks.slice(0, 6)} now={p.now} onOpen={openCheck} />
              </Panel>
            </>
          )}

          {page === "checks" && <ChecksPage rows={p.checks} now={p.now} onOpen={openCheck} />}

          {page === "receipts" && (
            <>
              <div className="overflow-hidden rounded-lg bg-white shadow-card">
                <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4", p.chain?.ok === false && "bg-bad-soft")} data-testid="chain-status">
                  <span className={cx("h-2 w-2 rounded-full", p.chain?.ok === false ? "bg-bad" : "bg-ok")} aria-hidden />
                  <span className="text-body font-medium">{p.chain ? (p.chain.ok ? `Chain intact · ${p.chain.count} signed receipt${p.chain.count === 1 ? "" : "s"}` : `Tampering detected at receipt ${p.chain.firstBrokenSeq}: ${p.chain.problem}`) : "Checking…"}</span>
                  <span className="text-meta text-ink-10">Signatures and links</span>
                </div>
                {p.chain?.anchor !== undefined && <AnchorRow anchor={p.chain.anchor} />}
              </div>
              {p.integrity && (
                <Panel title="Integrity test" description="Try to falsify the record. Each attack is caught by a different layer: decID’s signature, or the checkpoints on the public chain that nobody, not even decID, can rewrite.">
                  {p.integrity.tampered ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="max-w-xl text-ui text-ink-11">
                        {ATTACKS.find((x) => x.kind === p.integrity!.tampered!.kind)!.did(p.integrity.tampered.seq)} <span className="font-medium text-ink-12">{ATTACKS.find((x) => x.kind === p.integrity!.tampered!.kind)!.caughtBy}</span>
                      </p>
                      <Button onClick={p.integrity.undo}>Restore the receipts</Button>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-3">
                      {ATTACKS.map((x) => (
                        <button key={x.kind} disabled={!p.chain?.count} onClick={() => p.integrity!.tamper(x.kind)} className="press rounded-md bg-ink-2 px-4 py-3 text-left transition-colors hover:bg-ink-3 disabled:opacity-50">
                          <span className="block text-ui font-medium text-bad">{x.label}</span>
                          <span className="mt-0.5 block text-meta text-ink-10">{x.caughtBy}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              )}
              {p.receipts ? (
                <Panel title="Receipts" flush>
                  <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Receipts table">
                    <table className="w-full min-w-[620px] border-collapse">
                      <thead>
                        <tr>
                          <th className={cx(th, "w-14")}>#</th>
                          <th className={th}>Outcome</th>
                          <th className={th}>Signed</th>
                          <th className={th}>Hash</th>
                          <th className={th}>Previous</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.receipts.length === 0 && <EmptyRow colSpan={5}>No receipts yet.</EmptyRow>}
                        {p.receipts
                          .slice()
                          .reverse()
                          .map((r) => (
                            <tr key={r.seq} className={p.integrity?.tampered?.seq === r.seq ? "bg-bad-soft" : undefined}>
                              <td className={cx(td, "num font-mono text-ink-10")}>{r.seq}</td>
                              <td className={td}>{r.outcome}</td>
                              <td className={cx(td, "num text-ink-10")}>{r.signedAt ? new Date(r.signedAt * 1000).toLocaleTimeString() : "–"}</td>
                              <td className={cx(td, "font-mono text-meta")}>{r.hash.slice(0, 12)}…</td>
                              <td className={cx(td, "font-mono text-meta text-ink-10")}>{/^0+$/.test(r.prev) ? "genesis" : `${r.prev.slice(0, 12)}…`}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              ) : (
                <Panel title="Receipts">
                  <p className="text-ui text-ink-10">Each check’s signed receipt is in its detail view (Checks → open a check). The whole chain is re-verified every time this page loads.</p>
                </Panel>
              )}
            </>
          )}

          {page === "data" && (
            <>
              <Panel title="What you hold about customers" description="This is the complete record decID Verify keeps per check. None of these fields can contain a name, birth date, address, ID number or photo.">
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Stored fields">
                  <table className="w-full min-w-[480px] border-collapse">
                    <thead>
                      <tr>
                        <th className={th}>Field</th>
                        <th className={th}>What it’s for</th>
                        <th className={th}>Personal data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.storedFields.map((f) => (
                        <tr key={f}>
                          <td className={cx(td, "font-mono")}>
                            <code>{f}</code>
                          </td>
                          <td className={cx(td, "text-ink-11")}>{FIELD_PURPOSE[f] ?? ""}</td>
                          <td className={cx(td, "text-ink-10")}>No</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="What you never receive">
                <p className="text-ui text-ink-11">The customer’s name, date of birth, address, ID number, photo, wallet address or any other claim on their credential. The presentation is verified in memory and discarded.</p>
              </Panel>
            </>
          )}
        </div>
      </div>

      {open && (
        <Drawer title={`Check ${open.id.slice(0, 8)}`} subtitle={<StatusLabel status={open.status} reason={open.status === "rejected" ? friendlyReason(open.failureCode) : undefined} />} onClose={() => setOpen(undefined)}>
          <DefinitionList
            rows={[
              ["Reference", <span className="font-mono">{open.reference ?? "–"}</span>],
              ["Asked", "21 or older"],
              ["Answer", open.answer === null ? "None (check failed)" : open.answer ? "Yes" : "No"],
              ["Match code", <span className="font-mono">{open.matchCode ?? "–"}</span>],
              ["Vouched by", open.issuerName ?? "–"],
              ...(open.verifyMs != null ? ([["Verification", `${open.verifyMs.toFixed(1)} ms`]] as [string, ReactNode][]) : []),
              ["Received", new Date(open.createdAt * 1000).toLocaleString()],
            ]}
          />
          {open.receipt && (
            <section className="mt-6">
              <h4 className="flex items-center gap-2 text-ui font-medium">
                <FileCheck2 size={15} strokeWidth={1.75} aria-hidden /> Receipt #{String(open.receipt.payload.seq ?? "")}
                <span className={cx("ml-auto inline-flex items-center gap-1.5 text-meta font-normal", open.receipt.valid ? "text-ok" : "text-bad")}>
                  <span className={cx("h-1.5 w-1.5 rounded-full", open.receipt.valid ? "bg-ok" : "bg-bad")} aria-hidden />
                  {open.receipt.valid ? "Signature valid" : "Signature invalid"}
                </span>
              </h4>
              <pre tabIndex={0} className="mt-2 overflow-x-auto rounded-sm border border-ink-5 bg-ink-2 p-3 font-mono text-[11.5px] leading-[17px] text-ink-11">
                {JSON.stringify(open.receipt.payload, null, 2)}
              </pre>
              <p className="mt-2 text-meta text-ink-10">Ed25519 signature from decID{p.receiptKeyId ? `, key id ${p.receiptKeyId.slice(0, 12)}…` : ""}. No personal data.</p>
            </section>
          )}
        </Drawer>
      )}
    </div>
  );
}

/** The second check: the stored chain against its checkpoints on the public chain. */
function AnchorRow({ anchor }: { anchor: AnchorView | null }) {
  if (anchor === null) {
    return <div className="border-t border-ink-4 px-5 py-3 text-ui text-ink-10">On-chain anchoring is not deployed for this network.</div>;
  }
  if ("unavailable" in anchor) {
    return <div className="border-t border-ink-4 px-5 py-3 text-ui text-ink-10">Couldn’t reach the chain to compare checkpoints.</div>;
  }
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-4 px-5 py-4", !anchor.ok && "bg-bad-soft")} data-testid="anchor-status">
      <Link2 size={15} strokeWidth={1.75} className={anchor.ok ? "text-ok" : "text-bad"} aria-hidden />
      <span className="text-body font-medium">
        {anchor.ok ? `Anchored on-chain · ${anchor.anchoredCount} receipt${anchor.anchoredCount === 1 ? "" : "s"}${anchor.unanchored ? `, ${anchor.unanchored} pending` : ""}` : `Doesn’t match the chain: ${anchor.problem}`}
      </span>
      <span className="text-meta text-ink-10">
        {anchor.checkpoints} checkpoint{anchor.checkpoints === 1 ? "" : "s"}
        {anchor.latestBlock !== undefined ? ` · latest in block ${anchor.latestBlock}` : ""}
      </span>
    </div>
  );
}

function ChecksPage({ rows, now, onOpen }: { rows: CheckRow[]; now: number; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "passed" | "under" | "blocked">("all");
  const under = (r: CheckRow) => r.failureCode === "POLICY_NOT_SATISFIED";
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "passed" ? r.status === "verified" : filter === "under" ? under(r) : r.status === "rejected" && !under(r)));
  return (
    <>
      <Segmented
        label="Filter checks"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "All", count: rows.length },
          { id: "passed", label: "Passed", count: rows.filter((r) => r.status === "verified").length },
          { id: "under", label: "Under 21", count: rows.filter(under).length },
          { id: "blocked", label: "Blocked", count: rows.filter((r) => r.status === "rejected" && !under(r)).length },
        ]}
      />
      <Panel title={`${shown.length} check${shown.length === 1 ? "" : "s"}`} flush>
        <ChecksTable rows={shown} now={now} onOpen={onOpen} />
      </Panel>
    </>
  );
}

function ChecksTable({ rows, now, onOpen }: { rows: CheckRow[]; now: number; onOpen: (id: string) => void }) {
  return (
    <div className="max-h-[420px] overflow-auto" tabIndex={0} role="region" aria-label="Checks table">
      <table className="w-full min-w-[620px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Check</th>
            <th className={th}>Reference</th>
            <th className={th}>Result</th>
            <th className={th}>Code</th>
            <th className={cx(th, "text-right")}>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No checks yet. Run one from the checkout or the door.</EmptyRow>}
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer hover:bg-ink-2">
              <td className={cx(td, "font-mono text-meta")}>
                <button
                  className="hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(r.id);
                  }}
                >
                  {r.id.slice(0, 8)}
                </button>
              </td>
              <td className={cx(td, "font-mono text-meta text-ink-11")}>{r.reference ?? "–"}</td>
              <td className={td}>
                <StatusLabel status={r.status} reason={r.status === "rejected" ? friendlyReason(r.failureCode) : undefined} />
              </td>
              <td className={cx(td, "font-mono text-meta")}>{r.matchCode ?? <span className="text-ink-8">–</span>}</td>
              <td className={cx(td, "num text-right text-ink-10")} title={new Date((r.completedAt ?? r.createdAt) * 1000).toLocaleString()}>
                {relativeTime(r.completedAt ?? r.createdAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
