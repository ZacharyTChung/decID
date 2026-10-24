"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, FileCheck2, LayoutGrid, ListChecks, ScrollText, ShieldCheck } from "lucide-react";
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
}
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
  integrity?: { tamperedSeq: number | null; tamper: () => void; undo: () => void };
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
    <div className={cx("relative flex min-h-[720px] bg-ink-1 font-sans text-ink-12", p.className)}>
      <aside className="hidden w-[208px] shrink-0 flex-col border-r border-ink-5 bg-ink-2 md:flex">
        <div className="flex h-12 items-center border-b border-ink-5 px-4">
          <DecidWordmark product="Verify" />
        </div>
        <label className="relative mx-3 mt-3 flex items-center">
          <span className="sr-only">Business</span>
          <span className="pointer-events-none absolute left-2">
            <MerchantLogo merchant={p.merchant} size={20} />
          </span>
          <select id="biz-merchant" value={p.merchant.id} onChange={(e) => p.onMerchant(e.target.value)} className="h-9 w-full appearance-none rounded-sm border border-ink-6 bg-white pl-9 pr-7 text-ui font-medium">
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
            <button key={id} onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined} className={cx("press flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-ui", page === id ? "bg-white font-medium text-ink-12 shadow-[0_0_0_1px_var(--color-ink-5)]" : "text-ink-11 hover:bg-ink-3")}>
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto border-t border-ink-5 px-4 py-3 text-meta text-ink-10">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warn-dot" aria-hidden /> Test mode
          </span>
          <div className="mt-0.5 font-mono">{p.keyHint}</div>
          {p.accountMenu}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2 border-b border-ink-5 px-4 py-2 md:hidden">
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
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-5 px-6 py-3">
          <div>
            <h2 className="text-lead font-medium">{nav.find((n) => n[0] === page)![1]}</h2>
            <p className="text-ui text-ink-10">
              {p.merchant.name} · {p.merchant.kind === "venue" ? "Venue" : "Online store"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-xs border border-ink-5 px-2 py-1 text-meta text-ink-11 sm:inline-flex">
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
                    <p className="num text-h1 font-medium">{p.stats.medianSecondsToAnswer == null ? "–" : `${p.stats.medianSecondsToAnswer}s`}</p>
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
              <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-4 py-3", p.chain?.ok === false ? "border-bad/40 bg-bad-soft" : "border-ink-5 bg-white")} data-testid="chain-status">
                <span className={cx("h-2 w-2 rounded-full", p.chain?.ok === false ? "bg-bad" : "bg-ok")} aria-hidden />
                <span className="text-body font-medium">{p.chain ? (p.chain.ok ? `Chain intact · ${p.chain.count} signed receipt${p.chain.count === 1 ? "" : "s"}` : `Tampering detected at receipt ${p.chain.firstBrokenSeq}: ${p.chain.problem}`) : "Checking…"}</span>
                {p.chain?.ok && p.chain.count > 0 && <span className="font-mono text-meta text-ink-10">head {p.chain.head.slice(0, 16)}…</span>}
              </div>
              {p.integrity && (
                <Panel title="Integrity test" description="Every receipt is signed by decID and names the hash of the one before it, so a stored record can’t be edited without detection.">
                  <div className="flex flex-wrap items-center gap-3">
                    {p.integrity.tamperedSeq !== null ? (
                      <Button onClick={p.integrity.undo}>Restore the original receipt</Button>
                    ) : (
                      <Button variant="danger" disabled={!p.chain?.count} onClick={p.integrity.tamper}>
                        Edit a receipt as an insider
                      </Button>
                    )}
                    <span className="text-ui text-ink-10">{p.integrity.tamperedSeq !== null ? `Receipt ${p.integrity.tamperedSeq}’s outcome was flipped and its hash recomputed. Only decID’s signature gives it away.` : p.chain?.count ? "Flips one receipt’s outcome without decID’s signing key." : "Run a check first."}</span>
                  </div>
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
                            <tr key={r.seq} className={p.integrity?.tamperedSeq === r.seq ? "bg-bad-soft" : undefined}>
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
