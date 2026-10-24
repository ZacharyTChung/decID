/**
 * decID Verify fraud and risk signals. Runs over a business's check records, which hold no
 * personal data: time, policy, outcome, failure code and, for completed checks, a per-business,
 * per-day pseudonym of the Pass (`passTag`). Shared by the server and the in-browser prototype.
 *
 * Rules catch known abuse patterns; a statistical test catches unusual volume or refusal rates.
 * Every alert names the checks it is based on (session ids and receipt numbers), so a person can
 * verify it from the signed receipts, and says what to do.
 */

export interface CheckRecord {
  id: string;
  createdAt: number;
  completedAt: number | null;
  status: "pending" | "processing" | "verified" | "rejected" | "expired";
  policy: string;
  reference: string | null;
  failureCode: string | null;
  receiptSeq: number | null;
  /** Same Pass at this business on this UTC day ⇒ same tag. Null for unanswered checks. */
  passTag: string | null;
  /** The holder unlocked their phone (biometric or device PIN) to answer. Null when unknown. */
  userVerified: boolean | null;
}

export type RiskKind = "pass_reuse" | "repeat_orders" | "forgery_probing" | "borrowed_pass" | "revoked_pass" | "underage_spike" | "volume_spike";
export type Severity = "high" | "medium" | "low";

export interface RiskAlert {
  id: string;
  kind: RiskKind;
  severity: Severity;
  title: string;
  detail: string;
  action: string;
  at: number;
  /** The checks this alert is based on. */
  sessions: string[];
  receipts: number[];
}

/** Codes meaning the presentation itself was forged or tampered with (not just "too young"). */
export const FORGERY_CODES = new Set([
  "BAD_SIGNATURE",
  "ISSUER_NOT_TRUSTED",
  "UNSIGNED_TOKEN",
  "ALG_NOT_ALLOWED",
  "FORBIDDEN_HEADER",
  "COMMITMENT_MISMATCH",
  "COMMITMENT_INPUT_INVALID",
  "PROOF_SIGNATURE_INVALID",
  "DISCLOSURE_MALFORMED",
  "UNREQUESTED_DISCLOSURE",
  "NOT_REGISTERED",
]);
export const BORROWED_CODES = new Set(["SUBJECT_NOT_PRESENTER", "PROOF_SIGNER_MISMATCH"]);
export const REVOKED_CODES = new Set(["REVOKED"]);

export const WINDOWS = {
  passReuseVenue: 30 * 60,
  repeatOrders: 60 * 60,
  forgery: 15 * 60,
  rate: 60 * 60,
};

const done = (r: CheckRecord) => r.status === "verified" || r.status === "rejected";
const at = (r: CheckRecord) => r.completedAt ?? r.createdAt;
const seqs = (rs: CheckRecord[]) => rs.map((r) => r.receiptSeq).filter((s): s is number => s !== null);
const ago = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

/** P(X >= k) for X ~ Poisson(lambda): how surprising k events are when lambda are expected. */
export function poissonTail(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

/**
 * Signals for one check, as it happens: what a door screen or a checkout shows next to the
 * answer. Looks only at earlier checks of the same business.
 */
export function riskForCheck(records: CheckRecord[], id: string, kind: "online" | "venue"): RiskAlert[] {
  const me = records.find((r) => r.id === id);
  if (!me || !done(me)) return [];
  const earlier = records.filter((r) => r.id !== id && done(r) && at(r) <= at(me));
  return detect([...earlier, me], kind, at(me)).filter((a) => a.sessions.includes(id));
}

/** All current alerts for a business, newest first. */
export function detectRisk(records: CheckRecord[], kind: "online" | "venue", now: number): RiskAlert[] {
  return detect(records.filter(done), kind, now).sort((a, b) => b.at - a.at || sevRank(a.severity) - sevRank(b.severity));
}

const sevRank = (s: Severity) => (s === "high" ? 0 : s === "medium" ? 1 : 2);

function detect(rows: CheckRecord[], kind: "online" | "venue", now: number): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const sorted = [...rows].sort((a, b) => at(a) - at(b));

  // 1. Pass-back at a door (one Pass handed back through the queue) / repeat orders online.
  const byTag = new Map<string, CheckRecord[]>();
  for (const r of sorted) if (r.status === "verified" && r.passTag) byTag.set(r.passTag, [...(byTag.get(r.passTag) ?? []), r]);
  for (const [tag, uses] of byTag) {
    const window = kind === "venue" ? WINDOWS.passReuseVenue : WINDOWS.repeatOrders;
    const threshold = kind === "venue" ? 2 : 4;
    for (let i = threshold - 1; i < uses.length; i++) {
      const group = uses.slice(0, i + 1).filter((u) => at(uses[i]!) - at(u) <= window);
      if (group.length < threshold) continue;
      const last = group[group.length - 1]!;
      const first = group[0]!;
      alerts.push(
        kind === "venue"
          ? {
              id: `pass_reuse:${tag}:${last.id}`,
              kind: "pass_reuse",
              severity: "high",
              title: "Same Pass admitted again",
              detail: `This Pass was already admitted ${ago(at(last) - at(group[group.length - 2]!))} earlier (${group.length} entries in ${ago(at(last) - at(first))}). A Pass handed back through the queue looks like this.`,
              action: "Check the guest in front of you: is this their phone, and did they already come in?",
              at: at(last),
              sessions: group.map((g) => g.id),
              receipts: seqs(group),
            }
          : {
              id: `repeat_orders:${tag}:${last.id}`,
              kind: "repeat_orders",
              severity: "medium",
              title: "Many orders from one Pass",
              detail: `${group.length} age checks by the same Pass within ${ago(at(last) - at(first))}. Bulk buying for others (for example, for minors) looks like this.`,
              action: "Review these orders before they ship; consider a quantity limit.",
              at: at(last),
              sessions: group.map((g) => g.id),
              receipts: seqs(group),
            },
      );
    }
  }

  // 2. Forgery probing: several tampered or self-made credentials in a short window.
  const forged = sorted.filter((r) => r.failureCode && FORGERY_CODES.has(r.failureCode));
  for (let i = 0; i < forged.length; i++) {
    const group = forged.filter((f) => at(f) <= at(forged[i]!) && at(forged[i]!) - at(f) <= WINDOWS.forgery);
    if (group.length >= 3 && (i === forged.length - 1 || at(forged[i + 1]!) - at(forged[i]!) > 0)) {
      alerts.push({
        id: `forgery_probing:${forged[i]!.id}`,
        kind: "forgery_probing",
        severity: "high",
        title: "Forged credentials being tried",
        detail: `${group.length} answers in ${ago(at(forged[i]!) - at(group[0]!))} failed cryptographic checks (${[...new Set(group.map((g) => g.failureCode))].join(", ")}). Someone is testing fake or edited Passes.`,
        action: "All of them were refused. If it continues, check who is at the door or which account is ordering.",
        at: at(forged[i]!),
        sessions: group.map((g) => g.id),
        receipts: seqs(group),
      });
    }
  }
  dedupeBy(alerts, "forgery_probing");

  // 3. Someone else's Pass (signed by a different phone) and revoked Passes: each one matters.
  for (const r of sorted) {
    if (r.failureCode && BORROWED_CODES.has(r.failureCode)) {
      alerts.push({
        id: `borrowed_pass:${r.id}`,
        kind: "borrowed_pass",
        severity: "high",
        title: "Someone else’s Pass",
        detail: "The credential belongs to a different phone than the one that answered. A copied or borrowed Pass looks like this.",
        action: "Refused automatically. Ask for the guest’s own phone.",
        at: at(r),
        sessions: [r.id],
        receipts: seqs([r]),
      });
    }
    if (r.failureCode && REVOKED_CODES.has(r.failureCode)) {
      alerts.push({
        id: `revoked_pass:${r.id}`,
        kind: "revoked_pass",
        severity: "medium",
        title: "Revoked Pass used",
        detail: "The Pass was revoked by its issuer, usually because its owner reported the phone lost or stolen.",
        action: "Refused automatically. The person may be using a lost or stolen phone.",
        at: at(r),
        sessions: [r.id],
        receipts: seqs([r]),
      });
    }
  }

  // 4. Statistics: is the last hour unusual compared with the hours before it?
  const recent = sorted.filter((r) => now - at(r) < WINDOWS.rate);
  const history = sorted.filter((r) => now - at(r) >= WINDOWS.rate);
  if (recent.length >= 5) {
    const under = recent.filter((r) => r.failureCode === "POLICY_NOT_SATISFIED");
    const baseRate = history.length >= 20 ? history.filter((r) => r.failureCode === "POLICY_NOT_SATISFIED").length / history.length : 0.1;
    const p = poissonTail(under.length, Math.max(0.5, baseRate * recent.length));
    if (under.length >= 3 && p < 0.01) {
      alerts.push({
        id: `underage_spike:${under[under.length - 1]!.id}`,
        kind: "underage_spike",
        severity: "medium",
        title: "Unusually many under-age attempts",
        detail: `${under.length} of the last ${recent.length} checks were under age, against ${(baseRate * 100).toFixed(0)}% normally (chance of this by luck: ${p < 0.0001 ? "<0.01" : (p * 100).toFixed(2)}%).`,
        action: "A group of minors may be trying; brief the staff on duty.",
        at: at(under[under.length - 1]!),
        sessions: under.map((u) => u.id),
        receipts: seqs(under),
      });
    }
    if (history.length >= 20) {
      const span = Math.max(WINDOWS.rate, at(history[history.length - 1]!) - at(history[0]!));
      const expected = (history.length / span) * WINDOWS.rate;
      const pv = poissonTail(recent.length, expected);
      if (pv < 0.001 && recent.length >= 3 * expected) {
        alerts.push({
          id: `volume_spike:${recent[recent.length - 1]!.id}`,
          kind: "volume_spike",
          severity: "low",
          title: "Traffic far above normal",
          detail: `${recent.length} checks in the last hour against about ${expected.toFixed(1)} normally.`,
          action: "Expected for an event night; otherwise check for automated traffic.",
          at: at(recent[recent.length - 1]!),
          sessions: recent.map((r) => r.id),
          receipts: seqs(recent),
        });
      }
    }
  }
  return alerts;
}

/** Overlapping probing windows produce one alert per run: keep the latest of each run. */
function dedupeBy(alerts: RiskAlert[], kind: RiskKind) {
  const mine = alerts.filter((a) => a.kind === kind);
  for (const a of mine) {
    const covered = mine.some((b) => b !== a && b.at >= a.at && a.sessions.every((s) => b.sessions.includes(s)));
    if (covered) alerts.splice(alerts.indexOf(a), 1);
  }
}

export function riskSummary(alerts: RiskAlert[]): { high: number; medium: number; low: number } {
  return { high: alerts.filter((a) => a.severity === "high").length, medium: alerts.filter((a) => a.severity === "medium").length, low: alerts.filter((a) => a.severity === "low").length };
}
