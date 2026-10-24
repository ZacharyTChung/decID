"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowUp, CircleAlert, Download, MessageSquareText, ShieldAlert, ShieldCheck } from "lucide-react";
import type { AssistantAnswer } from "../../lib/shared/assistant";
import type { RiskAlert } from "../../lib/shared/risk";
import { Panel, relativeTime } from "./dashboard";

/**
 * The dashboard's Risk page (fraud signals from shared/risk.ts) and Assistant page (grounded
 * answers from shared/assistant.ts). Presentational: the host supplies the alerts and an `ask`.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const SEVERITY = {
  high: { label: "High", dot: "bg-bad", chip: "bg-bad-soft text-bad" },
  medium: { label: "Medium", dot: "bg-warn-dot", chip: "bg-warn-soft text-warn" },
  low: { label: "Low", dot: "bg-ink-7", chip: "bg-ink-3 text-ink-11" },
} as const;

const WATCHES = [
  ["Pass-back", "The same Pass admitted twice at a door within 30 minutes."],
  ["Repeat orders", "Four or more orders from one Pass within an hour (online)."],
  ["Forgery probing", "Three or more forged or edited Passes within 15 minutes."],
  ["Someone else’s Pass", "A credential presented from a phone it wasn’t issued to."],
  ["Revoked Pass", "A Pass its owner reported lost or stolen."],
  ["Unusual rates", "Under-age attempts or traffic far above this business’s normal (Poisson test)."],
] as const;

export function RiskPage({ alerts, checksAnalysed, now, onOpenCheck }: { alerts: RiskAlert[]; checksAnalysed: number; now: number; onOpenCheck?: (id: string) => void }) {
  const counts = { high: alerts.filter((a) => a.severity === "high").length, medium: alerts.filter((a) => a.severity === "medium").length, low: alerts.filter((a) => a.severity === "low").length };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-white px-5 py-4 shadow-card" data-testid="risk-summary">
        {alerts.length ? <ShieldAlert size={20} strokeWidth={1.75} className="text-bad" aria-hidden /> : <ShieldCheck size={20} strokeWidth={1.75} className="text-ok" aria-hidden />}
        <span className="text-body font-medium">{alerts.length ? `${alerts.length} fraud signal${alerts.length === 1 ? "" : "s"}` : "No fraud signals"}</span>
        {(["high", "medium", "low"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-ui text-ink-11">
            <span className={cx("h-2 w-2 rounded-full", SEVERITY[s].dot)} aria-hidden />
            {SEVERITY[s].label} {counts[s]}
          </span>
        ))}
        <span className="ml-auto text-meta text-ink-10">{checksAnalysed} checks analysed · no personal data used</span>
      </div>

      {alerts.length > 0 && (
        <ol className="space-y-3" aria-label="Fraud signals">
          {alerts.map((a) => (
            <li key={a.id} className="rounded-lg bg-white px-5 py-4 shadow-card" data-testid="risk-alert" data-kind={a.kind}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx("rounded-full px-2 py-0.5 text-meta font-medium", SEVERITY[a.severity].chip)}>{SEVERITY[a.severity].label}</span>
                <h3 className="text-body font-semibold">{a.title}</h3>
                <span className="ml-auto text-meta text-ink-10">{relativeTime(a.at, now)}</span>
              </div>
              <p className="mt-1.5 text-ui text-ink-11">{a.detail}</p>
              <p className="mt-1 text-ui font-medium text-ink-12">{a.action}</p>
              <p className="mt-2 flex flex-wrap gap-1.5 text-meta text-ink-10">
                Evidence:
                {a.receipts.map((r, i) => (
                  <button key={r} type="button" onClick={() => onOpenCheck?.(a.sessions[i]!)} className="rounded-full bg-ink-3 px-2 font-mono text-ink-11 hover:bg-ink-4">
                    receipt #{r}
                  </button>
                ))}
              </p>
            </li>
          ))}
        </ol>
      )}

      <Panel title="What decID watches for" description="Rules for known abuse, and a statistical test for unusual rates. Signals never refuse anyone by themselves; forged, borrowed and revoked Passes are already refused by the cryptographic checks.">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {WATCHES.map(([t, d]) => (
            <div key={t}>
              <dt className="text-ui font-medium">{t}</dt>
              <dd className="text-ui text-ink-10">{d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-meta text-ink-10">
          To spot a Pass used twice, each check keeps a pseudonym of the Pass that is only stable at this business for one UTC day, and is deleted after 48 hours. It can’t be linked to other businesses or to the person.
        </p>
      </Panel>
    </div>
  );
}

const STARTERS = ["How many checks did we run today?", "Why were people refused?", "Anything suspicious?", "Is our record intact?", "Write this week’s compliance report"];

export function AssistantPage({ ask, onOpenCheck, starters = STARTERS }: { ask: (q: string) => Promise<AssistantAnswer>; onOpenCheck?: (id: string) => void; starters?: string[] }) {
  const [thread, setThread] = useState<{ q: string; a?: AssistantAnswer; error?: string }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setBusy(true);
    setThread((t) => [...t, { q: text }]);
    try {
      const a = await ask(text);
      setThread((t) => t.map((m, i) => (i === t.length - 1 ? { ...m, a } : m)));
    } catch (e) {
      setThread((t) => t.map((m, i) => (i === t.length - 1 ? { ...m, error: (e as Error).message } : m)));
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), 50);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(q);
  };
  const last = thread[thread.length - 1]?.a;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-lg bg-white px-5 py-4 shadow-card">
        <MessageSquareText size={20} strokeWidth={1.75} className="mt-0.5 text-accent" aria-hidden />
        <p className="text-ui text-ink-11">
          Ask about your age checks. Answers are computed from your own signed receipts and the on-chain anchor, and cite the receipts they use. Nothing is guessed, and no personal data is involved. Not legal advice.
        </p>
      </div>

      <div className="space-y-4" aria-live="polite">
        {thread.map((m, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[80%] rounded-[18px] rounded-br-[6px] bg-accent px-4 py-2 text-ui text-white">{m.q}</p>
            {m.error && (
              <p className="flex items-center gap-2 text-ui text-bad" role="alert">
                <CircleAlert size={15} aria-hidden /> {m.error}
              </p>
            )}
            {!m.a && !m.error && <p className="text-ui text-ink-10">Reading your records…</p>}
            {m.a && <AnswerCard a={m.a} onOpenCheck={onOpenCheck} />}
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="flex flex-wrap gap-2">
        {(last?.suggestions ?? starters).map((s) => (
          <button key={s} type="button" onClick={() => void send(s)} disabled={busy} className="press rounded-full bg-white px-3 py-1.5 text-ui text-accent shadow-card hover:bg-ink-1 disabled:opacity-50" data-testid="assistant-suggestion">
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-5 pr-1.5 shadow-card">
        <label htmlFor="assistant-q" className="sr-only">
          Ask the compliance assistant
        </label>
        <input id="assistant-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your checks, an order, or your record…" className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-8" data-testid="assistant-input" maxLength={500} />
        <button type="submit" disabled={!q.trim() || busy} aria-label="Ask" className="press grid h-9 w-9 place-items-center rounded-full bg-accent text-white disabled:opacity-40" data-testid="assistant-send">
          <ArrowUp size={18} strokeWidth={2.25} aria-hidden />
        </button>
      </form>
    </div>
  );
}

function AnswerCard({ a, onOpenCheck }: { a: AssistantAnswer; onOpenCheck?: (id: string) => void }) {
  return (
    <div className="max-w-[92%] rounded-[18px] rounded-bl-[6px] bg-white px-5 py-4 shadow-card" data-testid="assistant-answer" data-intent={a.intent}>
      <div className="space-y-1.5 text-body text-ink-12">
        {a.text.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </div>
      {a.facts.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-2">
          {a.facts.map((f) => (
            <div key={f.label} className="rounded-[10px] bg-ink-2 px-3 py-1.5">
              <dt className="text-meta text-ink-10">{f.label}</dt>
              <dd className="num text-ui font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {a.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {a.actions.map((x) => (
            <a key={x.href} href={x.href} download className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-ui font-medium text-white hover:bg-accent-hover">
              <Download size={14} aria-hidden /> {x.label}
            </a>
          ))}
        </div>
      )}
      {a.citations.receipts.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-meta text-ink-10" data-testid="assistant-citations">
          Sources:
          {a.citations.receipts.slice(0, 12).map((r, i) => (
            <button key={r} type="button" onClick={() => onOpenCheck?.(a.citations.sessions[i]!)} className="rounded-full bg-ink-3 px-2 font-mono text-ink-11 hover:bg-ink-4">
              receipt #{r}
            </button>
          ))}
          {a.citations.receipts.length > 12 && <span>and {a.citations.receipts.length - 12} more</span>}
        </p>
      )}
      <p className="mt-2 text-meta text-ink-9">{a.basis}</p>
    </div>
  );
}
