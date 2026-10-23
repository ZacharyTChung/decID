/**
 * npm run site:evidence: runs every check and records the results for the showcase site
 * (site/data/evidence.json). Nothing is typed in by hand: each number and test name comes
 * from the output of the command that produced it. Takes several minutes (it runs the
 * contract, fuzz, coverage, app, demo, browser UI, red-team, multi-instance and bench suites).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "site", "data");
mkdirSync(path.join(OUT, "screenshots"), { recursive: true });

interface Run {
  command: string;
  ok: boolean;
  seconds: number;
  out: string;
}
function run(command: string): Run {
  const t0 = Date.now();
  console.log(`▶ ${command}`);
  const r = spawnSync("bash", ["-lc", command], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const res = { command, ok: r.status === 0, seconds: Math.round((Date.now() - t0) / 100) / 10, out };
  console.log(`  ${res.ok ? "ok" : "FAILED"} in ${res.seconds}s`);
  return res;
}
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

interface Group {
  name: string;
  tests: { name: string; ok: boolean }[];
}
/** Mocha / Hardhat spec output: indented describe lines, then ✔ / numbered failure lines. */
function parseSpec(out: string): Group[] {
  const groups: Group[] = [];
  const stack: { indent: number; name: string }[] = [];
  for (const raw of strip(out).split("\n")) {
    if (!raw.trim() || /passing|failing|pending|Running|No contracts|Compil/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    const test = /^(✔|✓|\d+\))\s+(.*?)(\s+\(\d+ms\))?$/.exec(line);
    if (test) {
      const name = stack.map((s) => s.name).join(" › ");
      let g = groups.find((x) => x.name === name);
      if (!g) groups.push((g = { name, tests: [] }));
      g.tests.push({ name: test[2]!, ok: test[1] !== undefined && !/^\d+\)$/.test(test[1]) });
      continue;
    }
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    stack.push({ indent, name: line.replace(/^test\/solidity\/[^:]+:/, "") });
  }
  return groups;
}

/** A markdown table (first one after `marker`, or the first in the text) as row objects. */
function mdTable(text: string, marker?: string): Record<string, string>[] {
  const from = marker ? text.indexOf(marker) : 0;
  const lines = text.slice(Math.max(0, from)).split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("|"));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const l of lines.slice(start)) {
    if (!l.trim().startsWith("|")) break;
    rows.push(l.trim().slice(1, -1).split("|").map((c) => c.trim()));
  }
  const [head, , ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const evidence: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  commit: git,
  environment: { node: process.version, platform: `${os.platform()} ${os.release()}`, cpu: `${os.cpus()[0]?.model ?? "?"} × ${os.cpus().length}` },
};
const suites: Record<string, unknown>[] = [];

// Contracts.
const mocha = run("npx hardhat test mocha");
suites.push({ id: "contracts", name: "Contract tests (Hardhat + Mocha)", command: "npm run test:contracts", ok: mocha.ok, seconds: mocha.seconds, groups: parseSpec(mocha.out) });
const fuzz = run("npx hardhat test solidity");
suites.push({ id: "fuzz", name: "Solidity fuzz and invariant tests", command: "npm run test:fuzz", ok: fuzz.ok, seconds: fuzz.seconds, groups: parseSpec(fuzz.out) });
const cov = run("npx hardhat test --coverage");
evidence.coverage = strip(cov.out)
  .split("\n")
  .filter((l) => /contracts\/\S+\.sol/.test(l) && /║/.test(l))
  .map((l) => {
    const cells = l.split("│").map((c) => c.replace(/[║]/g, "").trim());
    return { file: cells[0], line: cells[1], statement: cells[2] };
  });

// App tests (JSON reporter: every test by name, file and status).
mkdirSync(path.join(ROOT, ".evidence"), { recursive: true });
const vit = run("npx vitest run --reporter=json --outputFile=.evidence/vitest.json");
const vj = JSON.parse(readFileSync(path.join(ROOT, ".evidence", "vitest.json"), "utf8")) as {
  testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string }[] }[];
};
suites.push({
  id: "app",
  name: "App tests (Vitest: credentials, API, interop, W3C conformance, resilience)",
  command: "npm run test:app",
  ok: vit.ok,
  seconds: vit.seconds,
  groups: vj.testResults
    .map((f) => ({
      name: path.relative(ROOT, f.name),
      tests: f.assertionResults.map((a) => ({ name: [...a.ancestorTitles, a.title].join(" › "), ok: a.status === "passed", skipped: a.status !== "passed" && a.status !== "failed" })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
});

// Live-stack scripts.
const demo = run("npm run -s demo");
suites.push({
  id: "demo",
  name: "Headless lifecycle demo",
  command: "npm run demo",
  ok: demo.ok,
  seconds: demo.seconds,
  groups: (() => {
    const gs: Group[] = [];
    for (const l of strip(demo.out).split("\n")) {
      const step = /^▶ (.*)$/.exec(l.trim());
      if (step) gs.push({ name: step[1]!, tests: [] });
      const c = /^(✔|✘) (.*)$/.exec(l.trim());
      if (c && gs.length && !/DEMO (PASSED|FAILED)/.test(c[2]!)) gs[gs.length - 1]!.tests.push({ name: c[2]!, ok: c[1] === "✔" });
    }
    return gs.filter((g) => g.tests.length);
  })(),
});

const ui = run("npm run -s test:ui");
const uiSteps = strip(ui.out).split("\n").map((l) => /^\s*✔ (.*)$/.exec(l)?.[1]).filter((x): x is string => !!x && !/^(Hardhat node|Issuer keys|Contracts deployed|App server|UI TEST)/.test(x));
const axe = strip(ui.out).split("\n").map((l) => /^\s*(.+): (\d+) violation\(s\), (\d+) rule\(s\) passed/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ state: m[1], violations: Number(m[2]), rulesPassed: Number(m[3]) }));
suites.push({ id: "ui", name: "Browser UI test (Playwright + axe)", command: "npm run test:ui", ok: ui.ok, seconds: ui.seconds, groups: [{ name: "Holder → issuer → verifier, in Chromium with an injected EIP-1193 wallet", tests: uiSteps.map((name) => ({ name, ok: true })) }] });
evidence.accessibility = axe;
const shots = existsSync(path.join(ROOT, ".uitest", "screenshots")) ? readdirSync(path.join(ROOT, ".uitest", "screenshots")).filter((f) => f.endsWith(".png")).sort() : [];
for (const f of shots) copyFileSync(path.join(ROOT, ".uitest", "screenshots", f), path.join(OUT, "screenshots", f));
evidence.screenshots = shots;

const red = run("npm run -s redteam");
evidence.redteam = mdTable(readFileSync(path.join(ROOT, ".redteam", "REPORT.md"), "utf8"), "| ID |").map((r) => ({
  id: r.ID,
  category: r.Category,
  attack: r.Attack,
  expected: r["Expected defense"],
  observed: r.Observed,
  held: r.Result === "held",
}));
suites.push({ id: "redteam", name: "Red-team campaign", command: "npm run redteam", ok: red.ok, seconds: red.seconds, groups: [] });

const multi = run("npm run -s test:multi-instance");
evidence.multiInstance = strip(multi.out).split("\n").map((l) => /^(✔|✘) (?!MULTI)(.*)$/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m).map((m) => ({ name: m[2], ok: m[1] === "✔" }));
suites.push({ id: "multi", name: "Two app instances, one database and issuer key", command: "npm run test:multi-instance", ok: multi.ok, seconds: multi.seconds, groups: [] });

const bench = run("npm run -s bench");
const benchMd = readFileSync(path.join(ROOT, ".bench", "REPORT.md"), "utf8");
evidence.bench = {
  environment: /Environment: (.*?)\. Production/.exec(benchMd)?.[1],
  latency: mdTable(benchMd, "## Request latency"),
  load: mdTable(benchMd, "## Verification under load"),
  gas: mdTable(benchMd, "## Gas"),
};
suites.push({ id: "bench", name: "Benchmark (correctness-checked)", command: "npm run bench", ok: bench.ok, seconds: bench.seconds, groups: [] });

evidence.suites = suites;
writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
const failed = suites.filter((s) => !s.ok).map((s) => s.id);
console.log(failed.length ? `\n✘ evidence collected, but these suites FAILED: ${failed.join(", ")}` : "\n✔ evidence collected: site/data/evidence.json");
process.exit(failed.length ? 1 : 0);
