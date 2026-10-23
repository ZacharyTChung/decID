import { ACTION_POLICIES, VERIFIER_ACTIONS, type VerifierAction } from "../../src/lib/shared/constants";
import { CHECK_LABELS, type VerificationResult } from "../../src/lib/shared/verification";
import { decodeDisclosure, encodeDisclosure } from "../../src/lib/shared/sd-jwt";
import type { HolderBundle } from "../../src/lib/shared/bundle";
import type { ChallengeResponse, PresentationSubmissionT } from "../../src/lib/shared/api";
import evidence from "../data/evidence.json";
import { World, type Holder, type TxInfo } from "./world";

// ------------------------------------------------------------------ tiny DOM helper

type Child = Node | string | number | null | undefined | false | Child[];
function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const short = (s: string, n = 10) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);
const chip = (tone: "ok" | "bad" | "warn" | "skip" | "accent", text: string) => h("span", { class: `chip chip-${tone}` }, text);
const b64json = (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))));

// ------------------------------------------------------------------ evidence (rendered from evidence.json)

type Ev = typeof evidence;
interface Test { name: string; ok: boolean; skipped?: boolean }
interface Suite { id: string; name: string; command: string; ok: boolean; seconds: number; groups: { name: string; tests: Test[] }[] }

function suiteCount(s: Suite) {
  const tests = s.groups.flatMap((g) => g.tests);
  return { total: tests.length, passed: tests.filter((t) => t.ok).length, skipped: tests.filter((t) => t.skipped).length };
}

function renderStats() {
  const suites = evidence.suites as Suite[];
  const automated = suites.filter((s) => ["contracts", "fuzz", "app"].includes(s.id)).map(suiteCount);
  const passed = automated.reduce((a, c) => a + c.passed, 0);
  const total = automated.reduce((a, c) => a + c.total, 0);
  const red = evidence.redteam as { held: boolean }[];
  const app = suites.find((s) => s.id === "app")!;
  const interop = app.groups.filter((g) => /interop|w3c-conformance/.test(g.name)).flatMap((g) => g.tests);
  const p50 = (evidence.bench as { load: Record<string, string>[] }).load[0]?.["present p50"];
  const stats = [
    [`${passed}/${total}`, "automated tests pass", "contracts, fuzz/invariants, app"],
    [`${red.filter((r) => r.held).length}/${red.length}`, "red-team attacks blocked", "against a live local stack"],
    [`${interop.filter((t) => t.ok).length}/${interop.length}`, "independent interop checks", "third-party libraries, W3C files"],
    [`${p50} ms`, "per verification (p50)", "one client, 4-core machine"],
  ];
  $("#stats").replaceChildren(...stats.map(([v, l, n]) => h("div", { class: "stat" }, h("div", { class: "stat-v" }, v!), h("div", { class: "stat-l" }, l!), h("div", { class: "stat-n" }, n!))));

  // Machine-readable zone: real values from the evidence, in passport MRZ style.
  const pad = (s: string) => (s.toUpperCase().replace(/[^A-Z0-9<]/g, "<") + "<".repeat(44)).slice(0, 44);
  $("#mrz").textContent = [
    pad(`VC<DECID<<IDVERIFIED<SDJWT<ED25519<<31337`),
    pad(`${evidence.commit}<<T${passed}OF${total}<<RT${red.filter((r) => r.held).length}OF${red.length}<<IO${interop.length}`),
  ].join("\n");
  $("#gen-date").textContent = new Date(evidence.generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  $("#gen-commit").textContent = evidence.commit;
  $("#gen-env").textContent = `${evidence.environment.cpu}, Node ${evidence.environment.node}`;
}

function renderSuites() {
  const suites = evidence.suites as Suite[];
  $("#suites").replaceChildren(
    ...suites.map((s) => {
      const c = suiteCount(s);
      const summary = h(
        "summary",
        {},
        h("span", { class: "suite-name" }, s.name),
        h("span", { class: "suite-meta" }, s.groups.length ? `${c.passed}/${c.total}` : "", h("code", {}, s.command), `${s.seconds}s`, chip(s.ok ? "ok" : "bad", s.ok ? "pass" : "fail")),
      );
      const body = s.groups.length
        ? s.groups.map((g) =>
            h("div", { class: "tgroup" }, h("div", { class: "tgroup-name" }, g.name), h("ul", { class: "tlist" }, ...g.tests.map((t) => h("li", { class: t.ok ? "t-ok" : t.skipped ? "t-skip" : "t-bad" }, h("span", { class: "tmark", "aria-hidden": "true" }, t.ok ? "✓" : t.skipped ? "–" : "✗"), t.name)))),
          )
        : h("p", { class: "muted" }, s.id === "redteam" ? "Scenario by scenario in the Red team tab." : s.id === "bench" ? "Numbers in the Load & gas tab." : "Checks listed in the Deployment tab.");
      return h("details", { class: "suite" }, summary, h("div", { class: "suite-body" }, body));
    }),
  );
}

function renderRedteam(filter = "all") {
  const rows = evidence.redteam as { id: string; category: string; attack: string; expected: string; observed: string; held: boolean }[];
  const cats = ["all", ...new Set(rows.map((r) => r.category))];
  $("#rt-filter").replaceChildren(...cats.map((c) => h("button", { class: `pill${c === filter ? " pill-on" : ""}`, "aria-pressed": c === filter ? "true" : "false", onclick: () => renderRedteam(c) }, c === "all" ? `All ${rows.length}` : c)));
  $("#rt-rows").replaceChildren(
    ...rows
      .filter((r) => filter === "all" || r.category === filter)
      .map((r) => h("tr", {}, h("td", { class: "mono" }, r.id), h("td", {}, r.attack), h("td", { class: "mono small" }, r.expected), h("td", { class: "mono small" }, r.observed), h("td", {}, chip(r.held ? "ok" : "bad", r.held ? "held" : "FAILED")))),
  );
}

function renderInterop() {
  const app = (evidence.suites as Suite[]).find((s) => s.id === "app")!;
  const groups = app.groups.filter((g) => /interop|w3c-conformance/.test(g.name));
  $("#interop").replaceChildren(...groups.flatMap((g) => g.tests.map((t) => {
    const [area, ...rest] = t.name.split(" › ");
    return h("li", { class: "io" }, chip(t.ok ? "ok" : t.skipped ? "skip" : "bad", t.ok ? "pass" : t.skipped ? "skipped" : "fail"), h("div", {}, h("div", { class: "io-area" }, area!), h("div", {}, rest.join(" › "))));
  })));
}

function renderBench() {
  const b = evidence.bench as { environment: string; latency: Record<string, string>[]; load: Record<string, string>[]; gas: Record<string, string>[] };
  const table = (rows: Record<string, string>[]) => {
    const cols = Object.keys(rows[0] ?? {});
    return h("div", { class: "scroll" }, h("table", { class: "data" }, h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", { scope: "col" }, c)))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...cols.map((c, i) => h("td", { class: i ? "num" : "" }, r[c]!)))))));
  };
  // Throughput and latency bars, one scale per metric.
  const load = b.load.map((r) => ({ c: r.Concurrency!, p50: Number(r["present p50"]), p95: Number(r["present p95"]), rate: Number(r["verifications/s"]) }));
  const maxLat = Math.max(...load.map((l) => l.p95));
  const maxRate = Math.max(...load.map((l) => l.rate));
  const bars = h(
    "div",
    { class: "bars", role: "img", "aria-label": `Verification latency and throughput at concurrency ${load.map((l) => l.c).join(", ")}` },
    ...load.map((l) =>
      h(
        "div",
        { class: "bar-row" },
        h("div", { class: "bar-label" }, `${l.c} client${l.c === "1" ? "" : "s"}`),
        h("div", { class: "bar-track" }, h("div", { class: "bar bar-p95", style: `width:${(l.p95 / maxLat) * 100}%` }), h("div", { class: "bar bar-p50", style: `width:${(l.p50 / maxLat) * 100}%` })),
        h("div", { class: "bar-val" }, `${l.p50} / ${l.p95} ms`),
        h("div", { class: "bar-track" }, h("div", { class: "bar bar-rate", style: `width:${(l.rate / maxRate) * 100}%` })),
        h("div", { class: "bar-val" }, `${l.rate}/s`),
      ),
    ),
  );
  $("#bench").replaceChildren(
    h("p", { class: "muted small" }, `Measured on ${b.environment}; client, app server and chain share the machine.`),
    h("div", { class: "bars-head" }, h("span", {}), h("span", {}, h("i", { class: "key key-p50" }), "p50 ", h("i", { class: "key key-p95" }), "p95 latency"), h("span", {}), h("span", {}, h("i", { class: "key key-rate" }), "verifications per second"), h("span", {})),
    bars,
    h("h4", {}, "Request latency (ms)"),
    table(b.latency),
    h("h4", {}, "Gas per transaction (from receipts)"),
    table(b.gas),
    h("h4", {}, "Contract coverage"),
    table((evidence.coverage as Record<string, string>[]).map((r) => ({ File: r.file!, "Line %": r.line!, "Statement %": r.statement! }))),
  );
}

function renderDeployment() {
  $("#multi").replaceChildren(...(evidence.multiInstance as { name: string; ok: boolean }[]).map((c) => h("li", { class: c.ok ? "t-ok" : "t-bad" }, h("span", { class: "tmark", "aria-hidden": "true" }, c.ok ? "✓" : "✗"), c.name)));
  $("#axe").replaceChildren(...(evidence.accessibility as { state: string; violations: number; rulesPassed: number }[]).map((a) => h("tr", {}, h("td", {}, a.state), h("td", { class: "num" }, String(a.rulesPassed)), h("td", {}, chip(a.violations ? "bad" : "ok", `${a.violations} violations`)))));
}

function renderShots() {
  const caption: Record<string, string> = {
    "00-no-wallet.png": "No wallet installed: the app says so instead of faking one",
    "01-issuer-issued.png": "Issuer console after approving a synthetic application",
    "02-holder-valid.png": "Holder's credential, registered on-chain and valid",
    "03-verifier-pass.png": "Verifier: every check reported separately",
    "03b-verifier-age.png": "18+ area: only ageOver18 is disclosed",
    "04-verifier-revoked.png": "After revocation: rejected with REVOKED",
    "05-holder-revoked.png": "Holder view after revocation; the gate refuses",
  };
  $("#shots").replaceChildren(
    ...(evidence.screenshots as string[]).map((f) =>
      h("figure", { class: "shot" }, h("a", { href: `screenshots/${f}`, target: "_blank", rel: "noopener" }, h("img", { src: `screenshots/${f}`, alt: caption[f] ?? f, loading: "lazy" })), h("figcaption", {}, caption[f] ?? f)),
    ),
  );
}

// ------------------------------------------------------------------ playground

interface Person extends Holder {
  key: "alex" | "sam" | "mallory";
  dob?: string;
  country?: string;
  registered?: boolean;
}

let world: World | undefined;
const people: Record<string, Person> = {};
let lastSubmission: PresentationSubmissionT | undefined;

function log(kind: "tx" | "verify" | "info" | "bad", text: Child, detail?: Child) {
  const item = h("li", { class: `log log-${kind}` }, h("div", { class: "log-text" }, text), detail ? h("div", { class: "log-detail" }, detail) : null);
  $("#log").prepend(item);
}

function txDetail(t: TxInfo): Child {
  return t.ok ? [h("span", { class: "mono" }, short(t.hash, 8)), ` · block ${t.block} · ${Number(t.gasUsed).toLocaleString()} gas`] : h("span", { class: "mono" }, t.revert ?? "reverted");
}

async function refreshPeople() {
  if (!world) return;
  const cards = await Promise.all(
    Object.values(people).map(async (p) => {
      const status = p.bundle ? (p.registered ? await world!.status(p.bundle.commitment) : "Issued, not registered") : "No credential";
      const tone = status === "Active" ? "ok" : status === "No credential" ? "skip" : status.startsWith("Issued") ? "warn" : "bad";
      const claims = p.bundle ? p.bundle.disclosures.map((d) => decodeDisclosure(d)).map((d) => `${d.name}=${String(d.value)}`).join(" · ") : p.key === "mallory" ? "Attacker. Owns a wallet, no credential." : "";
      return h(
        "article",
        { class: "person" },
        h("header", {}, h("h4", {}, p.label), chip(tone, status)),
        h("div", { class: "mono small addr", title: p.wallet.address }, `wallet ${short(p.wallet.address, 8)}`),
        p.dob ? h("div", { class: "small muted" }, `Synthetic application: born ${p.dob}, country ${p.country}`) : null,
        claims ? h("div", { class: "small" }, claims) : null,
        h(
          "div",
          { class: "row" },
          p.key !== "mallory" && !p.bundle ? h("button", { class: "btn", onclick: () => act(() => issue(p)) }, "Issuer approves") : null,
          p.bundle && !p.registered ? h("button", { class: "btn", onclick: () => act(() => register(p)) }, "Register on-chain") : null,
          p.bundle ? h("button", { class: "btn btn-quiet", onclick: () => inspect(p) }, "Inspect") : null,
          h("button", { class: "btn btn-quiet", onclick: () => act(() => gate(p)) }, "Gate check-in"),
        ),
      );
    }),
  );
  $("#people").replaceChildren(...cards);
  const block = await world.provider.getBlockNumber();
  $("#chain-block").textContent = String(block);
  $("#chain-time").textContent = new Date(world.now() * 1000).toISOString().slice(0, 10);
}

let busy = false;
async function act(fn: () => Promise<void>) {
  if (busy || !world) return;
  busy = true;
  document.body.classList.add("busy");
  try {
    await fn();
  } catch (e) {
    log("bad", `Error: ${(e as Error).message}`);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    await refreshPeople();
  }
}

async function issue(p: Person) {
  const t0 = performance.now();
  const b = await world!.issue(p, { dateOfBirth: p.dob!, country: p.country! });
  log("info", `Issuer approved ${p.label}'s application and signed an SD-JWT credential`, [`commitment `, h("span", { class: "mono" }, short(b.commitment, 8)), ` · ${b.disclosures.length} disclosures · ${Math.round(performance.now() - t0)} ms`]);
  inspect(p);
}

async function register(p: Person) {
  const t = await world!.register(p);
  if (t.ok) p.registered = true;
  log(t.ok ? "tx" : "bad", `${p.label} registers the commitment from their own wallet`, txDetail(t));
}

async function gate(p: Person) {
  // Mallory has no credential; she tries Alex's commitment, which is public on-chain.
  const target = p.bundle ?? people.alex!.bundle;
  if (!target) return log("bad", "No commitment exists yet to check in with.");
  const whose = p.bundle ? "their own" : "Alex's public";
  const t = await world!.checkIn(p, target.commitment);
  log(t.ok ? "tx" : "bad", `${p.label} calls DemoGate.checkIn with ${whose} commitment`, txDetail(t));
}

function inspect(p: Person) {
  const b = p.bundle;
  if (!b) return;
  const [hd, pl] = b.credentialJwt.split(".");
  const payload = b64json(pl!);
  $("#inspect-title").textContent = `${p.label}'s credential`;
  $("#inspect").replaceChildren(
    h("div", { class: "kv" }, h("div", {}, "JOSE header"), h("pre", {}, JSON.stringify(b64json(hd!), null, 2))),
    h("div", { class: "kv" }, h("div", {}, "Signed payload (decoded, not verified)"), h("pre", {}, JSON.stringify(payload, null, 2))),
    h(
      "div",
      { class: "kv" },
      h("div", {}, "Disclosures (held by the holder; shown one at a time to verifiers)"),
      h("ul", { class: "disc" }, ...b.disclosures.map((d) => {
        const x = decodeDisclosure(d);
        return h("li", {}, h("code", {}, `${x.name} = ${JSON.stringify(x.value)}`), h("span", { class: "mono small muted" }, ` salt ${x.salt.slice(0, 8)}… → digest ${x.digest.slice(0, 10)}…`), payload.credentialSubject._sd.includes(x.digest) ? chip("ok", "in _sd") : chip("bad", "not in _sd"));
      })),
    ),
    h("div", { class: "kv" }, h("div", {}, "On-chain commitment"), h("pre", {}, `keccak256(domain ‖ salt ‖ keccak256(token))\n= ${b.commitment}\nsalt (private): ${b.salt.slice(0, 10)}…`)),
    h("div", { class: "kv" }, h("div", {}, "EIP-712 registration authorization (issuer's EVM key)"), h("pre", {}, JSON.stringify(b.authorization, null, 2))),
  );
}

type Attack = "none" | "flip" | "token" | "extra" | "replay";

async function present() {
  const action = ($("#pg-action") as HTMLSelectElement).value as VerifierAction;
  const presenter = people[($("#pg-presenter") as HTMLSelectElement).value]!;
  const owner = people[($("#pg-cred") as HTMLSelectElement).value]!;
  const attack = (document.querySelector("input[name=pg-attack]:checked") as HTMLInputElement).value as Attack;
  if (attack === "replay") {
    if (!lastSubmission) return log("bad", "Nothing to replay yet: present once first.");
    showResult(await world!.verify(lastSubmission), "Replay of the previous submission", undefined, lastSubmission);
    return;
  }
  if (!owner.bundle) return log("bad", `${owner.label} has no credential yet.`);
  const c = world!.createChallenge(action);
  let bundle: HolderBundle = owner.bundle;
  let note = `${presenter.label} presents ${owner === presenter ? "their own" : `${owner.label}'s`} credential`;
  if (attack === "flip") {
    const age = owner.bundle.disclosures.map(decodeDisclosure).find((d) => d.name === "ageOver18")!;
    bundle = { ...bundle, disclosures: [encodeDisclosure(age.salt, "ageOver18", !age.value), ...bundle.disclosures.filter((d) => decodeDisclosure(d).name !== "ageOver18")] };
    note += `, with ageOver18 flipped to ${String(!age.value)} (same salt)`;
  } else if (attack === "token") {
    const [x, y, z] = bundle.credentialJwt.split(".");
    bundle = { ...bundle, credentialJwt: `${x}.${y}.${z!.slice(0, -2)}${z!.endsWith("AA") ? "BB" : "AA"}` };
    note += ", with the issuer signature edited";
  }
  let sub = await world!.present(presenter, c, bundle);
  if (attack === "extra") {
    // A wallet that over-shares: adds country to what was asked, and signs over it.
    const extraChallenge = { ...c, requestedClaims: [...c.requestedClaims, "countryOfResidence"] };
    sub = await world!.present(presenter, extraChallenge, bundle);
    note += ", over-sharing countryOfResidence";
  }
  lastSubmission = sub;
  showResult(await world!.verify(sub), note, c, sub);
}

function showResult(r: VerificationResult & { rpcCalls: string[] }, note: string, c: ChallengeResponse | undefined, sub: PresentationSubmissionT) {
  const fail = r.checks.find((x) => x.status === "fail");
  log(r.verified ? "verify" : "bad", `${note}: ${r.verified ? "VERIFIED" : `rejected, ${fail?.code}`}`);
  const parts: Child[] = [
    h("div", { class: `verdict ${r.verified ? "verdict-ok" : "verdict-bad"}` }, h("strong", {}, r.verified ? "Verified" : "Not verified"), h("span", {}, r.verified ? ` Access to “${ACTION_POLICIES[(c?.action ?? "access-verified-member-area") as VerifierAction].label}” may be granted.` : ` ${fail?.code}: ${fail?.detail ?? ""}`)),
    c ? h("p", { class: "small consent" }, h("span", { class: "muted" }, "Holder signed: "), `“${c.statement}”`) : null,
    h("div", { class: "small muted" }, `Sent: issuer-signed JWT (${sub.credentialJwt.length} chars), ${sub.disclosures.length} disclosure(s)${sub.disclosures.length ? ` [${sub.disclosures.map((d) => { try { return decodeDisclosure(d).name; } catch { return "?"; } }).join(", ")}]` : ""}, salt, EIP-712 proof`),
    h("ol", { class: "checks" }, ...r.checks.map((k) => h("li", { class: `check check-${k.status}` }, h("span", { class: "check-mark", "aria-hidden": "true" }, k.status === "pass" ? "✓" : k.status === "fail" ? "✗" : "·"), h("span", {}, CHECK_LABELS[k.id]), k.code ? h("code", {}, k.code) : null))),
    r.disclosed ? h("div", { class: "small" }, h("strong", {}, "Verifier learned: "), `identityVerified=true, holder ${short(r.disclosed.holderDid.split(":").pop()!, 6)}, issuer “${r.disclosed.issuerName}”`, Object.keys(r.disclosed.claims).length ? `, ${Object.entries(r.disclosed.claims).map(([k, v]) => `${k}=${String(v)}`).join(", ")}` : ", no optional claims") : null,
    r.rpcCalls.length ? h("div", { class: "small muted" }, `Chain reads for this verification: ${r.rpcCalls.join(", ")} (registry status: ${r.registryStatus ?? "not reached"})`) : null,
  ];
  $("#result").replaceChildren(h("div", { class: "result-body" }, parts));
}

async function revokeAlex() {
  const alex = people.alex!;
  if (!alex.bundle || !alex.registered) return log("bad", "Alex's credential is not registered yet.");
  const t = await world!.revoke(alex.bundle);
  log(t.ok ? "tx" : "bad", "Issuer revokes Alex's credential with its attestation key", txDetail(t));
}

async function fastForward() {
  await world!.travel(366 * 24 * 60 * 60);
  log("info", "Chain and verifier clocks moved forward 366 days (credentials are valid for one year)");
}

async function guidedTour() {
  const steps: [string, () => Promise<void>][] = [];
  const alex = people.alex!, sam = people.sam!;
  const set = (action: string, presenter: string, cred: string, attack: Attack) => {
    ($("#pg-action") as HTMLSelectElement).value = action;
    ($("#pg-presenter") as HTMLSelectElement).value = presenter;
    ($("#pg-cred") as HTMLSelectElement).value = cred;
    (document.querySelector(`input[name=pg-attack][value=${attack}]`) as HTMLInputElement).checked = true;
  };
  if (!alex.bundle) steps.push(["", () => issue(alex)]);
  if (!alex.registered) steps.push(["", () => register(alex)]);
  if (!sam.bundle) steps.push(["", () => issue(sam)]);
  if (!sam.registered) steps.push(["", () => register(sam)]);
  steps.push(
    ["", async () => { set("access-verified-member-area", "alex", "alex", "none"); await present(); }],
    ["", async () => { set("access-age-restricted-area", "alex", "alex", "none"); await present(); }],
    ["", async () => { set("access-age-restricted-area", "sam", "sam", "none"); await present(); }],
    ["", async () => { set("access-age-restricted-area", "sam", "sam", "flip"); await present(); }],
    ["", async () => { set("access-verified-member-area", "mallory", "alex", "none"); await present(); }],
    ["", async () => { set("access-verified-member-area", "alex", "alex", "replay"); await present(); }],
  );
  for (const [, fn] of steps) {
    await fn();
    await refreshPeople();
    await new Promise((r) => setTimeout(r, 350));
  }
  set("access-verified-member-area", "alex", "alex", "none");
}

async function boot() {
  const t0 = performance.now();
  $("#pg-status").textContent = "Starting the in-page chain and deploying the contracts…";
  try {
    world = await World.create();
  } catch (e) {
    const msg = (e as Error).message;
    const hint = /ed25519|algorithm|NotSupported/i.test(msg) ? " This browser lacks WebCrypto Ed25519 (supported in Chrome 137+, Firefox 129+, Safari 17+)." : "";
    $("#pg-status").textContent = `The playground could not start in this browser: ${msg}.${hint}`;
    return;
  }
  people.alex = { ...world.newHolder("Alex"), key: "alex", dob: "1990-04-04", country: "ZZ" };
  people.sam = { ...world.newHolder("Sam"), key: "sam", dob: "2010-09-15", country: "QQ" };
  people.mallory = { ...world.newHolder("Mallory"), key: "mallory" };
  $("#chain-registry").textContent = short(world.deployment.registry, 8);
  $("#chain-gate").textContent = short(world.deployment.gate, 8);
  $("#chain-issuer").textContent = short(world.issuer.did, 14);
  $("#pg-status").textContent = `Chain started, CredentialRegistry and DemoGate deployed, issuer authorized in ${Math.round(performance.now() - t0)} ms. Everything below runs in this tab.`;
  log("info", "In-page chain started; CredentialRegistry and DemoGate deployed from the compiled bytecode; issuer attestation key authorized");

  const opt = (v: string, t: string) => h("option", { value: v }, t);
  $("#pg-action").replaceChildren(...VERIFIER_ACTIONS.map((a) => opt(a, `${ACTION_POLICIES[a].label}${ACTION_POLICIES[a].requested.length ? ` (requests ${ACTION_POLICIES[a].requested.join(", ")})` : ""}`)));
  $("#pg-presenter").replaceChildren(opt("alex", "Alex (adult)"), opt("sam", "Sam (16)"), opt("mallory", "Mallory (attacker)"));
  $("#pg-cred").replaceChildren(opt("alex", "Alex's credential"), opt("sam", "Sam's credential"));
  $("#pg-present").addEventListener("click", () => act(present));
  $("#pg-revoke").addEventListener("click", () => act(revokeAlex));
  $("#pg-ff").addEventListener("click", () => act(fastForward));
  $("#pg-tour").addEventListener("click", () => act(guidedTour));
  $("#pg-reset").addEventListener("click", () => location.reload());
  document.querySelectorAll<HTMLButtonElement>(".pg-controls button, .pg-controls select, .pg-controls input").forEach((b) => (b.disabled = false));

  // Open in a working state: Alex is issued and registered, and has passed one verification.
  await act(async () => {
    await issue(people.alex!);
    await register(people.alex!);
    await present();
  });
}

// ------------------------------------------------------------------ tabs

function tabs(root: string) {
  const buttons = document.querySelectorAll<HTMLButtonElement>(`${root} [role=tab]`);
  const select = (b: HTMLButtonElement) => {
    buttons.forEach((x) => {
      x.setAttribute("aria-selected", String(x === b));
      x.tabIndex = x === b ? 0 : -1;
      ($(`#${x.getAttribute("aria-controls")}`) as HTMLElement).hidden = x !== b;
    });
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => select(b));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const next = buttons[(i + d + buttons.length) % buttons.length]!;
      next.focus();
      select(next);
    });
  });
}

renderStats();
renderSuites();
renderRedteam();
renderInterop();
renderBench();
renderDeployment();
renderShots();
tabs("#evidence");
void boot();

export type { Ev };
