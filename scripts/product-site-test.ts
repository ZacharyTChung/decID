/**
 * npm run test:product-site: the hosted decID prototype (site/product/dist), driven in Chromium.
 *
 *   phone   : Alex gets verified (real issuance + on-chain activation in the page)
 *   Hopline : checkout → phone shares "21+" → order confirmed; Hopline received no personal data
 *   door    : phone shares → kiosk shows the same match code as the phone
 *   Sam (16): refused at the door, "Not old enough"; the tour marks all steps done
 *   dashboard: outcome and timing charts, intact receipt chain; an insider edit is detected and
 *              undone; a simulated busy night (real flow) blocks the borrowed and revoked passes
 *   phone width: no horizontal scrolling, Business/Phone switcher works
 *
 * Also runs axe (WCAG 2.1 A/AA) and fails on console errors. Screenshots: .product-site-test/.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const DIST = path.join(process.cwd(), "site", "product", "dist");
const SHOTS = path.join(process.cwd(), ".product-site-test");
mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "✔" : "✘"} ${name}`);
  if (!ok) failures.push(name);
};
const errors: string[] = [];
const watch = (p: Page, label: string) => {
  p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${label}: ${m.text()}`));
};
async function audit(p: Page, label: string) {
  const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of serious) console.log(`    axe ${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  check(serious.length === 0, `accessibility (axe, serious/critical): ${label}`);
}

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const name = (req.url ?? "/").split("?")[0] === "/" ? "local.html" : (req.url ?? "").split("?")[0]!.slice(1);
  try {
    const body = readFileSync(path.join(DIST, path.basename(name)));
    res.writeHead(200, { "content-type": TYPES[path.extname(name)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

let browser: Browser | undefined;
try {
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  watch(page, "desktop");
  const phone = page.getByTestId("phone");
  const started = Date.now();
  await page.goto(base);
  await page.getByText("Start as a sample person").waitFor({ timeout: 30_000 });
  check(true, `the page boots: in-page chain, contracts deployed, issuer keys created (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  await page.screenshot({ path: path.join(SHOTS, "01-start.png") });
  await audit(page, "start");

  // Alex gets a Pass
  await phone.getByRole("button", { name: /^Alex/ }).click();
  check((await phone.locator("#pass-dob").inputValue()) === "1990-04-04", "Alex pre-fills the synthetic application");
  await phone.getByRole("button", { name: "Verify me" }).click();
  await phone.getByLabel("Your decID Pass").waitFor({ timeout: 30_000 });
  await phone.getByText("Active", { exact: true }).waitFor();
  check(true, "Alex is verified and the Pass is Active on the registry");

  // Hopline
  await page.getByRole("button", { name: "Verify age with decID" }).click();
  await page.getByRole("button", { name: "Continue in decID Pass →" }).click();
  await phone.getByText("Are you 21 or older?").waitFor();
  await audit(page, "consent screen");
  await phone.getByRole("button", { name: /Share “21\+” with Hopline/ }).click();
  await page.getByText("Order confirmed ✓").waitFor({ timeout: 15_000 });
  const received = await page.getByLabel("What Hopline received").innerText();
  check(received.includes('"ageOver21": true') && received.includes('"valid": true'), "Hopline received { ageOver21: true } and a receipt whose signature verified");
  check(!/Alex|1990|SYN-|did:pkh|0x[0-9a-fA-F]{40}/.test(received), "…and nothing personal");
  await page.screenshot({ path: path.join(SHOTS, "02-hopline.png") });

  // Neon Hall
  await page.getByRole("tab", { name: /Neon Hall/ }).click();
  await page.getByRole("button", { name: "Scan with the phone →" }).click();
  await phone.getByRole("button", { name: /Share “21\+” with Neon Hall/ }).click();
  await page.getByText("21+ VERIFIED").waitFor({ timeout: 15_000 });
  const phoneCode = (await phone.getByTestId("match-code").innerText()).trim();
  const doorCode = (await page.getByTestId("door-match-code").innerText()).trim();
  check(phoneCode.length === 4 && phoneCode === doorCode, `door and phone show the same match code (${doorCode})`);
  await page.screenshot({ path: path.join(SHOTS, "03-door.png") });

  // Sam
  await phone.locator("#pass-person").selectOption("__new");
  await phone.getByRole("button", { name: /^Sam/ }).click();
  await phone.getByRole("button", { name: "Verify me" }).click();
  await phone.getByText("Active", { exact: true }).waitFor({ timeout: 30_000 });
  check((await phone.locator("#pass-person").evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)) === "Sam", "the person menu reads “Sam”");
  await page.getByRole("button", { name: "Scan with the phone →" }).click({ timeout: 20_000 });
  await phone.getByText(/Your Pass says you are not 21\+/).waitFor();
  await phone.getByRole("button", { name: /Share “21\+” with Neon Hall/ }).click();
  await page.getByText("ENTRY REFUSED").waitFor({ timeout: 15_000 });
  check((await page.getByTestId("door-reason").innerText()).includes("Not old enough"), "Sam is refused: “Not old enough”");
  await page.screenshot({ path: path.join(SHOTS, "04-refused.png") });

  // Dashboard
  await page.getByRole("tab", { name: /business dashboard/ }).click();
  await page.getByTestId("chain-status").getByText("Chain intact · 2 signed receipts").waitFor();
  check((await page.locator("[data-tour][data-done]").count()) === 5, "the “Try it” tour shows all five steps done");
  check(await page.getByRole("img", { name: /Passed: 1, Not old enough: 1/ }).isVisible(), "outcome chart: 1 passed, 1 not old enough");
  check(await page.getByRole("img", { name: /Median verification time \d+ ms over 2 checks/ }).isVisible(), "timing chart over 2 checks");
  await page.getByRole("button", { name: "Try it: edit a receipt as an insider" }).click();
  await page.getByTestId("chain-status").getByText(/Tampering detected at receipt 1: signature does not verify/).waitFor();
  check(true, "an insider's edit to a receipt is detected (signature does not verify)");
  await page.getByRole("button", { name: "Restore the original receipt" }).click();
  await page.getByTestId("chain-status").getByText("Chain intact · 2 signed receipts").waitFor();
  check(true, "…and the chain is intact again once restored");
  await page.getByRole("button", { name: "Run the night" }).click();
  await page.getByRole("button", { name: "Run again" }).waitFor({ timeout: 120_000 });
  const log = await page.getByTestId("night-log").innerText();
  check(/Borrowed credential: refused · credential belongs to someone else/.test(log), "busy night: the borrowed credential is refused");
  check(/Revoked Pass: refused · credential revoked/.test(log), "busy night: the revoked Pass is refused");
  check((log.match(/admitted ·/g) ?? []).length >= 8 && (log.match(/not old enough/g) ?? []).length >= 2, "busy night: adults admitted, under-21 guests refused");
  await page.getByTestId("chain-status").getByText("Chain intact · 16 signed receipts").waitFor();
  check(true, "16 receipts, chain intact");
  await page.screenshot({ path: path.join(SHOTS, "05-dashboard.png"), fullPage: true });
  await audit(page, "dashboard");

  // Phone width
  const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  watch(mobile, "mobile");
  await mobile.goto(base);
  await mobile.getByRole("button", { name: "Verify age with decID" }).waitFor({ timeout: 30_000 });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal scrolling at phone width (overflow ${overflow}px)`);
  await mobile.getByRole("tab", { name: "Phone (decID Pass)" }).click();
  await mobile.getByTestId("phone").getByRole("button", { name: /^Alex/ }).click();
  await mobile.getByTestId("phone").getByRole("button", { name: "Verify me" }).click();
  await mobile.getByTestId("phone").getByText("Active", { exact: true }).waitFor({ timeout: 30_000 });
  await mobile.getByRole("tab", { name: "Business" }).click();
  await mobile.getByRole("button", { name: "Verify age with decID" }).click();
  await mobile.getByRole("button", { name: "Continue in decID Pass →" }).click();
  await mobile.getByTestId("phone").getByRole("button", { name: /Share “21\+” with Hopline/ }).click();
  await mobile.getByTestId("phone").getByRole("button", { name: "Back to Hopline" }).click();
  await mobile.getByText("Order confirmed ✓").waitFor();
  check(true, "phone width: the whole checkout works with the Business / Phone switcher");
  const overflowAfter = await mobile.evaluate(() => Array.from(document.querySelectorAll("button, h2")).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
  check(overflowAfter === 0, `phone width: nothing pushed off screen after checkout (${overflowAfter} element(s))`);
  await mobile.screenshot({ path: path.join(SHOTS, "06-mobile.png") });
  await audit(mobile, "phone width");
} catch (e) {
  failures.push(`crashed: ${(e as Error).message.split("\n")[0]}`);
  console.error(e);
  for (const [i, p] of (browser?.contexts().flatMap((c) => c.pages()) ?? []).entries()) await p.screenshot({ path: path.join(SHOTS, `failure-${i}.png`) }).catch(() => undefined);
} finally {
  await browser?.close();
  server.close();
}
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 4).join(" | ")}` : ""}`);
console.log(failures.length ? `\n✘ HOSTED PROTOTYPE TEST FAILED: ${failures.length} check(s)` : "\n✔ HOSTED PROTOTYPE TEST PASSED (screenshots in .product-site-test/)");
process.exit(failures.length ? 1 : 0);
