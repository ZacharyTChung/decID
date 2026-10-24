import { friendlyReason } from "./policies";
import type { CheckRecord, RiskAlert } from "./risk";

/**
 * decID Verify compliance assistant. Answers a business's questions about its age checks from
 * its own records: the checks, the signed receipt chain, the on-chain anchor and the fraud
 * signals. It does not generate text from a language model, so it can't invent a number: every
 * figure is computed here and every answer cites the receipts it is based on.
 *
 * Shared by the server (POST /api/business/assistant) and the in-browser prototype.
 */

export interface AssistantContext {
  merchant: { id: string; name: string; kind: "online" | "venue" };
  records: CheckRecord[];
  chain: { ok: boolean; count: number; firstBrokenSeq?: number; problem?: string; anchor?: { ok: boolean; anchoredCount: number; checkpoints: number; unanchored: number; latestBlock?: number; problem?: string } | { unavailable: true } | null };
  alerts: RiskAlert[];
  storedFields: string[];
  now: number;
  /** Where the auditor export can be downloaded, if the host offers one. */
  exportHref?: string;
}

export type Intent = "prove_order" | "integrity" | "risk" | "refusals" | "summary" | "biometrics" | "data" | "export" | "report" | "help";

export interface AssistantAnswer {
  intent: Intent;
  /** The answer in plain sentences. */
  text: string[];
  facts: { label: string; value: string }[];
  citations: { receipts: number[]; sessions: string[] };
  actions: { label: string; href: string }[];
  suggestions: string[];
  /** What the answer is based on, in one line. */
  basis: string;
}

const SUGGESTIONS = ["How many checks did we run today?", "Why were people refused?", "Was order HL-1042 age-checked?", "Is our record intact?", "Anything suspicious?", "Write this week’s compliance report"];

const done = (r: CheckRecord) => r.status === "verified" || r.status === "rejected";
const at = (r: CheckRecord) => r.completedAt ?? r.createdAt;
const pct = (n: number, d: number) => (d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`);
const fmtTime = (s: number) => new Date(s * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Recognises what is being asked. Exported for tests. */
export function classify(q: string): Intent {
  const s = q.toLowerCase();
  if (/\b(report|weekly|monthly|summary for|write up)\b/.test(s)) return "report";
  if (orderRef(q)) return "prove_order";
  if (/\b(fraud|suspicious|risk|alert|pass.?back|fake|forg|borrow|stolen|scam)/.test(s)) return "risk";
  if (/\b(intact|tamper|integrity|edited|chain|anchor|blockchain|rewrit|deleted)/.test(s)) return "integrity";
  if (/\b(face ?id|biometric|fingerprint|unlock|passkey)/.test(s)) return "biometrics";
  if (/\b(export|auditor|regulator|inspector|inspection|evidence|subpoena|licen[cs]ing board)/.test(s)) return "export";
  if (/\b(personal data|privacy|gdpr|ccpa|what data|store|stored|keep|hold|retention|breach)/.test(s)) return "data";
  if (/\b(refus|reject|declin|denied|turned away|fail|why .*(not|no))/.test(s)) return "refusals";
  if (/\b(how many|count|volume|total|stats|busy|checks|today|yesterday|week|hour)/.test(s)) return "summary";
  return "help";
}

/** An order / reference named in the question: a token after "order", "ref" or "#" that has a digit. */
export function orderRef(q: string): string | null {
  const m = q.match(/(?:\border|\bref(?:erence)?|#)\s*#?\s*([A-Za-z0-9._:-]*\d[A-Za-z0-9._:-]*)/i);
  return m ? m[1]!.replace(/[.:]+$/, "") : null;
}

/** A time window named in the question ("today", "last 3 hours", "this week"). Exported for tests. */
export function timeWindow(q: string, now: number): { from: number; label: string } {
  const s = q.toLowerCase();
  const day = 86400;
  const startOfDay = Math.floor(now / day) * day;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/last (\d+) hours?/))) return { from: now - Number(m[1]) * 3600, label: `in the last ${m[1]} hours` };
  if ((m = s.match(/last (\d+) days?/))) return { from: now - Number(m[1]) * day, label: `in the last ${m[1]} days` };
  if (/last hour|past hour/.test(s)) return { from: now - 3600, label: "in the last hour" };
  if (/yesterday/.test(s)) return { from: startOfDay - day, label: "yesterday" };
  if (/today|tonight/.test(s)) return { from: startOfDay, label: "today (UTC)" };
  if (/week/.test(s)) return { from: now - 7 * day, label: "in the last 7 days" };
  if (/month/.test(s)) return { from: now - 30 * day, label: "in the last 30 days" };
  return { from: 0, label: "on record" };
}

function inWindow(records: CheckRecord[], q: string, now: number) {
  const w = timeWindow(q, now);
  const until = /yesterday/.test(q.toLowerCase()) ? w.from + 86400 : Infinity;
  return { w, rs: records.filter((r) => at(r) >= w.from && at(r) < until) };
}

function anchorLine(ctx: AssistantContext): string {
  const a = ctx.chain.anchor;
  if (!a || "unavailable" in a) return "No on-chain anchor is configured for this deployment.";
  if (!a.ok) return `The record does NOT match its on-chain checkpoints: ${a.problem ?? "mismatch"}.`;
  return `${plural(a.anchoredCount, "receipt")} ${a.anchoredCount === 1 ? "is" : "are"} anchored on-chain in ${plural(a.checkpoints, "checkpoint")}${a.latestBlock !== undefined ? ` (latest in block ${a.latestBlock})` : ""}${a.unanchored ? `; ${a.unanchored} newer ${a.unanchored === 1 ? "one is" : "ones are"} waiting for the next anchor` : ""}.`;
}

function basis(ctx: AssistantContext, rs: CheckRecord[]): string {
  const ds = rs.filter(done);
  const span = ds.length ? `${fmtTime(Math.min(...ds.map(at)))} – ${fmtTime(Math.max(...ds.map(at)))}` : "no completed checks";
  return `Based on ${plural(ds.length, "completed check")} (${span}) and ${ctx.merchant.name}’s receipt chain (${ctx.chain.ok ? "signatures and links verified" : "BROKEN"}).`;
}

/** Receipts and the checks they belong to, index-aligned. */
const cite = (rs: CheckRecord[]) => {
  const withReceipt = rs.filter((r) => r.receiptSeq !== null);
  return { receipts: withReceipt.map((r) => r.receiptSeq!), sessions: withReceipt.map((r) => r.id) };
};

export function answerQuestion(question: string, ctx: AssistantContext): AssistantAnswer {
  const intent = classify(question);
  const base = { intent, facts: [] as AssistantAnswer["facts"], actions: [] as AssistantAnswer["actions"], citations: { receipts: [] as number[], sessions: [] as string[] } };
  const all = ctx.records;

  switch (intent) {
    case "prove_order": {
      const ref = orderRef(question) ?? "";
      const hits = all.filter((r) => r.reference && r.reference.toLowerCase() === ref.toLowerCase());
      if (!hits.length) {
        return {
          ...base,
          text: [`I found no age check with the reference “${ref}”. Checks are matched by the reference your system sent when it created the verification.`],
          suggestions: ["How many checks did we run today?", "Write this week’s compliance report"],
          basis: basis(ctx, all),
        };
      }
      const passed = hits.filter((h) => h.status === "verified");
      const last = (passed[passed.length - 1] ?? hits[hits.length - 1])!;
      const anchor = ctx.chain.anchor && !("unavailable" in ctx.chain.anchor) ? ctx.chain.anchor : null;
      const anchored = anchor?.ok && last.receiptSeq !== null && last.receiptSeq <= anchor.anchoredCount;
      const text =
        last.status === "verified"
          ? [
              `Yes. Order ${ref} was age-checked on ${fmtTime(at(last))}: the buyer’s Pass answered the ${last.policy.replace(/_/g, " ")} check and it passed.`,
              `The evidence is signed receipt #${last.receiptSeq}. ${ctx.chain.ok ? "Its signature and its link in your receipt chain verify." : "WARNING: your receipt chain does not verify; see “Is our record intact?”."} ${anchored ? "It is also covered by an on-chain checkpoint, so it can’t have been edited or removed since." : "It is not yet covered by an on-chain checkpoint."}`,
              last.userVerified ? "The buyer unlocked their phone (Face ID, fingerprint or PIN) to answer." : "The buyer did not use device unlock for this answer.",
            ]
          : last.status === "rejected"
            ? [`Order ${ref} was checked on ${fmtTime(at(last))} and did not pass: ${friendlyReason(last.failureCode).toLowerCase()}. It must not be released. The refusal is signed receipt #${last.receiptSeq}.`]
            : [`Order ${ref} has an age check that was never answered (${last.status}). Don’t release it without a passed check.`];
      if (hits.length > 1) text.push(`There ${hits.length === 2 ? "was one earlier attempt" : `were ${hits.length - 1} earlier attempts`} for this order; all are listed below.`);
      return {
        ...base,
        text,
        facts: [
          { label: "Outcome", value: last.status === "verified" ? "Passed" : last.status === "rejected" ? friendlyReason(last.failureCode) : last.status },
          { label: "Checked", value: fmtTime(at(last)) },
          { label: "Receipt", value: last.receiptSeq ? `#${last.receiptSeq}` : "—" },
          { label: "On-chain", value: anchored ? "Anchored" : "Not yet" },
        ],
        citations: cite(hits),
        actions: ctx.exportHref ? [{ label: "Download the auditor export", href: ctx.exportHref }] : [],
        suggestions: ["Is our record intact?", "Write this week’s compliance report"],
        basis: basis(ctx, hits),
      };
    }

    case "integrity": {
      const a = ctx.chain.anchor;
      const anchorOk = !a || "unavailable" in a || a.ok;
      const ok = ctx.chain.ok && anchorOk;
      return {
        ...base,
        text: [
          ok ? `Yes. All ${plural(ctx.chain.count, "receipt")} verify: every signature checks against decID’s published key, and each one links to the one before it.` : `No. ${ctx.chain.ok ? "The signatures and links verify, but" : `The chain breaks at receipt #${ctx.chain.firstBrokenSeq}: ${ctx.chain.problem}.`}`,
          anchorLine(ctx),
          ok ? "So no receipt has been edited, re-signed or deleted since it was anchored, by anyone, including decID." : "Treat the record as tampered with until this is explained, and download a fresh export for your records.",
        ],
        facts: [
          { label: "Receipts", value: String(ctx.chain.count) },
          { label: "Signatures & links", value: ctx.chain.ok ? "Valid" : "Broken" },
          { label: "On-chain anchor", value: !a || "unavailable" in a ? "Not configured" : a.ok ? `Matches (${a.anchoredCount})` : "Mismatch" },
        ],
        actions: ctx.exportHref ? [{ label: "Download the auditor export", href: ctx.exportHref }] : [],
        suggestions: ["Anything suspicious?", "Write this week’s compliance report"],
        basis: basis(ctx, all),
      };
    }

    case "risk": {
      const { w, rs } = inWindow(all, question, ctx.now);
      const alerts = ctx.alerts.filter((a) => a.at >= w.from);
      if (!alerts.length) {
        return {
          ...base,
          text: [`No fraud signals ${w.label}. decID watches for a Pass admitted twice (pass-back), many orders from one Pass, forged or edited Passes, someone else’s Pass and revoked Passes, and for unusual refusal or traffic rates.`],
          suggestions: ["Why were people refused?", "Is our record intact?"],
          basis: basis(ctx, rs),
        };
      }
      const high = alerts.filter((a) => a.severity === "high");
      return {
        ...base,
        text: [`${plural(alerts.length, "fraud signal")} ${w.label}${high.length ? `, ${high.length} of them high` : ""}:`, ...alerts.slice(0, 6).map((a) => `• ${a.title} (${a.severity}, ${fmtTime(a.at)}): ${a.detail} ${a.action}`)],
        facts: [
          { label: "High", value: String(high.length) },
          { label: "Medium", value: String(alerts.filter((a) => a.severity === "medium").length) },
          { label: "Low", value: String(alerts.filter((a) => a.severity === "low").length) },
        ],
        citations: { receipts: [...new Set(alerts.flatMap((a) => a.receipts))], sessions: [...new Set(alerts.flatMap((a) => a.sessions))] },
        suggestions: ["Why were people refused?", "Write this week’s compliance report"],
        basis: basis(ctx, rs),
      };
    }

    case "refusals": {
      const { w, rs } = inWindow(all, question, ctx.now);
      const refused = rs.filter((r) => r.status === "rejected");
      const ds = rs.filter(done);
      if (!refused.length) return { ...base, text: [`No one was refused ${w.label} (${plural(ds.length, "completed check")}).`], suggestions: SUGGESTIONS.slice(0, 3), basis: basis(ctx, rs) };
      const by = new Map<string, CheckRecord[]>();
      for (const r of refused) by.set(friendlyReason(r.failureCode), [...(by.get(friendlyReason(r.failureCode)) ?? []), r]);
      const rows = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
      return {
        ...base,
        text: [
          `${plural(refused.length, "refusal")} out of ${plural(ds.length, "completed check")} ${w.label} (${pct(refused.length, ds.length)}):`,
          ...rows.map(([reason, list]) => `• ${reason}: ${list.length}`),
          rows.some(([r]) => r === "Not old enough") ? "“Not old enough” means the person’s own ID says they are under the age asked; nothing else about them was shared." : "",
        ].filter(Boolean),
        facts: rows.map(([reason, list]) => ({ label: reason, value: String(list.length) })),
        citations: cite(refused),
        suggestions: ["Anything suspicious?", "How many checks did we run today?"],
        basis: basis(ctx, rs),
      };
    }

    case "biometrics": {
      const { w, rs } = inWindow(all, question, ctx.now);
      const passed = rs.filter((r) => r.status === "verified");
      const uv = passed.filter((r) => r.userVerified);
      return {
        ...base,
        text: [
          `${uv.length} of ${plural(passed.length, "passed check")} ${w.label} (${pct(uv.length, passed.length)}) were answered with device unlock: the person unlocked their own phone with Face ID, a fingerprint or the phone’s PIN.`,
          "The biometric never leaves the phone; decID checks a passkey signature bound to that one check. You can require it per check (requireUserVerification), and the door kiosk has a switch for it.",
        ],
        facts: [
          { label: "With device unlock", value: String(uv.length) },
          { label: "Without", value: String(passed.length - uv.length) },
        ],
        citations: cite(uv),
        suggestions: ["Anything suspicious?", "Write this week’s compliance report"],
        basis: basis(ctx, rs),
      };
    }

    case "data":
      return {
        ...base,
        text: [
          "decID holds no personal data for your checks: no name, birth date, address, ID number, photo or wallet address.",
          `Each check record has exactly these fields: ${ctx.storedFields.join(", ")}.`,
          "One field, pass_tag, is a pseudonym of the Pass that is only stable at your business for one UTC day, so a Pass handed back through a queue can be spotted. It is deleted after 48 hours and can’t be linked to other businesses.",
          "Receipts are signed statements of the outcome and the policy, with a hash of the evidence that only the person’s phone keeps.",
        ],
        facts: [{ label: "Fields per check", value: String(ctx.storedFields.length) }],
        suggestions: ["Is our record intact?", "Download the auditor export"],
        basis: "Based on the verification record schema.",
      };

    case "export":
      return {
        ...base,
        text: [
          `The auditor export holds all ${plural(ctx.chain.count, "signed receipt")} plus where they are anchored on-chain. An inspector can check it with decID’s published keys and read access to the chain, without access to decID’s or your systems (npm run verify-receipts).`,
          anchorLine(ctx),
          "It contains no personal data, so it can be handed over as is.",
        ],
        actions: ctx.exportHref ? [{ label: "Download the auditor export", href: ctx.exportHref }] : [],
        suggestions: ["Is our record intact?", "Write this week’s compliance report"],
        basis: basis(ctx, all),
      };

    case "report": {
      const { w, rs } = inWindow(all, /month|day|hour|today|yesterday/.test(question.toLowerCase()) ? question : `${question} week`, ctx.now);
      const ds = rs.filter(done);
      const passed = ds.filter((r) => r.status === "verified");
      const refused = ds.filter((r) => r.status === "rejected");
      const alerts = ctx.alerts.filter((a) => a.at >= w.from);
      const reasons = new Map<string, number>();
      for (const r of refused) reasons.set(friendlyReason(r.failureCode), (reasons.get(friendlyReason(r.failureCode)) ?? 0) + 1);
      return {
        ...base,
        text: [
          `Compliance report for ${ctx.merchant.name}, ${w.label}, generated ${fmtTime(ctx.now)}.`,
          `1. Checks: ${plural(ds.length, "completed age check")}: ${passed.length} passed, ${refused.length} refused${refused.length ? ` (${[...reasons.entries()].map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ")})` : ""}. ${rs.length - ds.length} were never answered.`,
          `2. Evidence: every check has a signed receipt. ${ctx.chain.ok ? `All ${ctx.chain.count} verify (signatures and links).` : `The chain BREAKS at #${ctx.chain.firstBrokenSeq}.`} ${anchorLine(ctx)}`,
          `3. Fraud signals: ${alerts.length ? alerts.map((a) => `${a.title.toLowerCase()} (${a.severity})`).join("; ") : "none"}.`,
          `4. Device unlock: ${pct(passed.filter((r) => r.userVerified).length, passed.length)} of passed checks were confirmed with Face ID, fingerprint or PIN.`,
          "5. Personal data held: none. The check records hold outcomes and policies only.",
          "This report is generated from your own records; it is not legal advice. Keep the auditor export with it.",
        ],
        facts: [
          { label: "Checks", value: String(ds.length) },
          { label: "Passed", value: String(passed.length) },
          { label: "Refused", value: String(refused.length) },
          { label: "Fraud signals", value: String(alerts.length) },
        ],
        citations: cite(ds),
        actions: ctx.exportHref ? [{ label: "Download the auditor export", href: ctx.exportHref }] : [],
        suggestions: ["Why were people refused?", "Anything suspicious?"],
        basis: basis(ctx, rs),
      };
    }

    case "summary": {
      const { w, rs } = inWindow(all, question, ctx.now);
      const ds = rs.filter(done);
      const passed = ds.filter((r) => r.status === "verified");
      const times = ds.map((r) => at(r) - r.createdAt).sort((a, b) => a - b);
      return {
        ...base,
        text: [`${plural(ds.length, "completed age check")} ${w.label}: ${passed.length} passed, ${ds.length - passed.length} refused (${pct(ds.length - passed.length, ds.length)}).${times.length ? ` The median time from request to answer was ${times[Math.floor(times.length / 2)]} s.` : ""}`],
        facts: [
          { label: "Completed", value: String(ds.length) },
          { label: "Passed", value: String(passed.length) },
          { label: "Refused", value: String(ds.length - passed.length) },
          { label: "Not answered", value: String(rs.length - ds.length) },
        ],
        citations: cite(ds),
        suggestions: ["Why were people refused?", "Anything suspicious?", "Write this week’s compliance report"],
        basis: basis(ctx, rs),
      };
    }

    default:
      return {
        ...base,
        text: ["I answer questions about your age checks from your own signed records. Try one of these:"],
        suggestions: SUGGESTIONS,
        basis: basis(ctx, all),
      };
  }
}
