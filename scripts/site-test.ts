/**
 * npm run test:site: opens the built showcase site (site/dist, from `npm run site`) in Chromium
 * and drives the playground: the in-page chain must boot, deploy the real contracts, and every
 * scenario must produce the verifier result the production code produces. Also checks the
 * page at phone width and in dark mode, and fails on any console error.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const DIST = path.join(process.cwd(), "site", "dist");
const SHOTS = path.join(process.cwd(), ".site-test");
mkdirSync(SHOTS, { recursive: true });

// The artifact host wraps the page in a document skeleton; do the same here.
const wrap = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const types: Record<string, string> = { ".js": "text/javascript", ".png": "image/png", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    let body: Buffer | string = readFileSync(path.join(DIST, path.normalize(file)));
    if (file === "index.html") body = wrap(body.toString());
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(3510, r));

const failures: string[] = [];
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "✔" : "✘"} ${name}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch();
const errors: string[] = [];
const watch = (page: Page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
};

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  watch(page);
  await page.goto("http://localhost:3510/");
  await page.getByText(/Chain started, CredentialRegistry and DemoGate deployed/).waitFor({ timeout: 60_000 });
  check(true, "in-page chain boots and deploys CredentialRegistry + DemoGate from the compiled bytecode");
  await page.locator(".verdict-ok").waitFor({ timeout: 30_000 });
  check(true, "opens in a working state: Alex issued, registered and verified");
  check((await page.locator("#stats .stat").count()) === 4, "headline numbers render from evidence.json");

  const results: string[] = [];
  const present = async (action: string, presenter: string, cred: string, attack: string) => {
    await page.selectOption("#pg-action", action);
    await page.selectOption("#pg-presenter", presenter);
    await page.selectOption("#pg-cred", cred);
    await page.check(`input[name=pg-attack][value=${attack}]`);
    const before = await page.locator("#log li").count();
    await page.click("#pg-present");
    await page.waitForFunction((n) => document.querySelectorAll("#log li").length > n, before);
    const text = (await page.locator("#result .verdict").innerText()).replace(/\s+/g, " ");
    results.push(text);
    return text;
  };

  // Sam: issue + register via the person card buttons.
  const sam = page.locator(".person", { hasText: "Sam" });
  await sam.getByRole("button", { name: "Issuer approves" }).click();
  await sam.getByRole("button", { name: "Register on-chain" }).click();
  await sam.getByText("Active").waitFor();
  check(true, "Sam's credential issued and registered through the UI");

  check(/^Verified/.test(await present("access-age-restricted-area", "alex", "alex", "none")), "18+ area: Alex verified");
  check((await page.locator("#result").innerText()).includes("ageOver18=true"), "18+ area: verifier learned ageOver18=true");
  check(/POLICY_NOT_SATISFIED/.test(await present("access-age-restricted-area", "sam", "sam", "none")), "18+ area: Sam (16) rejected, POLICY_NOT_SATISFIED");
  check(/DISCLOSURE_NOT_REFERENCED/.test(await present("access-age-restricted-area", "sam", "sam", "flip")), "Sam flips ageOver18: DISCLOSURE_NOT_REFERENCED");
  check(/SUBJECT_NOT_PRESENTER/.test(await present("access-verified-member-area", "mallory", "alex", "none")), "Mallory presents Alex's credential: SUBJECT_NOT_PRESENTER");
  check(/BAD_SIGNATURE/.test(await present("access-verified-member-area", "alex", "alex", "token")), "edited issuer signature: BAD_SIGNATURE");
  check(/UNREQUESTED_DISCLOSURE/.test(await present("access-verified-member-area", "alex", "alex", "extra")), "over-sharing: UNREQUESTED_DISCLOSURE");
  await present("access-verified-member-area", "alex", "alex", "none");
  check(/CHALLENGE_REUSED/.test(await present("access-verified-member-area", "alex", "alex", "replay")), "replay: CHALLENGE_REUSED");

  // Gate, revocation, expiry.
  const alex = page.locator(".person", { hasText: "Alex" });
  const mallory = page.locator(".person", { hasText: "Mallory" });
  await alex.getByRole("button", { name: "Gate check-in" }).click();
  await page.locator("#log li").first().filter({ hasText: "Alex calls DemoGate.checkIn" }).waitFor();
  check(!(await page.locator("#log li").first().getAttribute("class"))!.includes("log-bad"), "Alex passes the on-chain gate");
  await mallory.getByRole("button", { name: "Gate check-in" }).click();
  await page.locator("#log li").first().filter({ hasText: "Mallory calls DemoGate.checkIn" }).waitFor();
  check((await page.locator("#log li").first().innerText()).includes("AccessDenied"), "Mallory with Alex's public commitment: AccessDenied");
  await page.click("#pg-revoke");
  await alex.getByText("Revoked").waitFor();
  check(/REVOKED/.test(await present("access-verified-member-area", "alex", "alex", "none")), "after revocation: REVOKED");
  await page.click("#pg-ff");
  await sam.getByText("Expired").waitFor();
  check(/EXPIRED/.test(await present("access-verified-member-area", "sam", "sam", "none")), "one year later: EXPIRED");

  // Inspector.
  await sam.getByRole("button", { name: "Inspect" }).click();
  check((await page.locator("#inspect").innerText()).includes("vc+sd-jwt"), "inspector shows the decoded vc+sd-jwt credential");

  await page.screenshot({ path: path.join(SHOTS, "desktop-light.png"), fullPage: true });
  const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!horizontal, "no horizontal scroll at desktop width");

  // Guided tour in a fresh page.
  const tour = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  watch(tour);
  await tour.goto("http://localhost:3510/");
  await tour.locator(".verdict-ok").waitFor({ timeout: 60_000 });
  await tour.click("#pg-tour");
  await tour.waitForFunction(() => document.querySelectorAll("#log li").length >= 12, undefined, { timeout: 60_000 });
  await tour.waitForFunction(() => !document.body.classList.contains("busy"), undefined, { timeout: 60_000 });
  check((await tour.locator("#log").innerText()).includes("CHALLENGE_REUSED"), "guided tour runs to the end");

  // Phone width and dark mode.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  watch(phone);
  await phone.goto("http://localhost:3510/");
  await phone.locator(".verdict-ok").waitFor({ timeout: 60_000 });
  check(!(await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), "no horizontal scroll at phone width");
  const bg = await phone.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === "rgb(12, 20, 19)", `dark theme applies (body ${bg})`);
  await phone.screenshot({ path: path.join(SHOTS, "phone-dark.png"), fullPage: true });

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n✘ SITE TEST FAILED: ${failures.length} check(s)` : "\n✔ SITE TEST PASSED (screenshots in .site-test/)");
process.exit(failures.length ? 1 : 0);
