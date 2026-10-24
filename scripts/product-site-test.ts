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

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0]!;
  const name = url === "/" ? "local.html" : path.normalize(url).replace(/^([/\\.])+/, "");
  try {
    const body = readFileSync(path.join(DIST, name));
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
  await phone.getByTestId("add-id").waitFor({ timeout: 30_000 });
  check(true, `the page boots: in-page chain, contracts deployed, issuer keys created (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  check(await page.evaluate(async () => (await document.fonts.load("14px 'Inter Variable'")).length > 0), "the fallback UI font (Inter) is embedded and loads");
  await page.screenshot({ path: path.join(SHOTS, "01-start.png") });
  await audit(page, "start");

  // Alex adds an ID
  await phone.getByTestId("add-id").click();
  await phone.getByRole("button", { name: /Simulated Identity Office/ }).click();
  check((await phone.locator("#pass-dob").inputValue()) === "1990-04-04", "Alex is the default demo person");
  await page.screenshot({ path: path.join(SHOTS, "02-details.png") });
  await audit(page, "add ID: details");
  await phone.getByTestId("verify-me").click();
  await phone.getByRole("group", { name: "decID Pass for Alex: 21+" }).waitFor({ timeout: 30_000 });
  await phone.getByTestId("pass-status").getByText(/^Active/).waitFor();
  check(true, "Alex's credential is issued and active on the registry");
  await page.screenshot({ path: path.join(SHOTS, "03-wallet.png") });

  // Hopline
  await page.getByTestId("verify-age").click();
  await page.getByRole("button", { name: "Open on the demo phone" }).click();
  await phone.getByRole("dialog").getByText("Requested").waitFor();
  await page.waitForTimeout(400); // let the sheet finish sliding in
  await page.screenshot({ path: path.join(SHOTS, "04-consent.png") });
  await audit(page, "consent sheet");
  await phone.getByTestId("share").click();
  await phone.getByText("Shared with Hopline").waitFor({ timeout: 15_000 });
  await page.getByTestId("age-verified").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "What Hopline received" }).click();
  const received = await page.getByLabel("What Hopline received").innerText();
  check(received.includes('"ageOver21": true') && received.includes('"valid": true'), "Hopline received { ageOver21: true } and a receipt whose signature verified");
  check(!/Alex|1990|SYN-|did:pkh|0x[0-9a-fA-F]{40}/.test(received), "…and nothing personal");
  await page.screenshot({ path: path.join(SHOTS, "05-hopline-verified.png") });
  await page.getByTestId("place-order").click();
  await page.getByText("Order confirmed").waitFor();
  check(true, "the order can be placed once age is verified");
  await phone.getByRole("button", { name: "Back to Hopline" }).click();

  // Neon Hall
  await page.getByRole("button", { name: "Venue entry" }).click();
  await page.getByRole("button", { name: "Scan with the demo phone" }).click();
  await page.screenshot({ path: path.join(SHOTS, "06-door-idle.png") });
  await phone.getByTestId("share").click();
  await page.getByText("OK to enter").waitFor({ timeout: 15_000 });
  const phoneCode = (await phone.getByTestId("match-code").innerText()).trim();
  const doorCode = (await page.getByTestId("door-match-code").innerText()).trim();
  check(phoneCode.length === 4 && phoneCode === doorCode, `door and phone show the same match code (${doorCode})`);
  await page.screenshot({ path: path.join(SHOTS, "07-door-ok.png") });
  await audit(page, "door: admitted");
  await page.getByRole("button", { name: "Codes match · next guest" }).click();
  await phone.getByRole("button", { name: "Back to Neon Hall" }).click();

  // Sam
  await phone.locator("#pass-person").selectOption("__new");
  await phone.getByRole("button", { name: /Simulated Identity Office/ }).click();
  await phone.getByRole("radio", { name: "Sam" }).click();
  await phone.getByTestId("verify-me").click();
  await phone.getByRole("group", { name: "decID Pass for Sam: Under 18" }).waitFor({ timeout: 30_000 });
  check((await phone.locator("#pass-person").evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)) === "Sam", "the person menu reads “Sam”");
  await page.getByRole("button", { name: "Scan with the demo phone" }).click({ timeout: 20_000 });
  await phone.getByText(/Your ID says you are not 21 or older/).waitFor();
  check(true, "the sheet warns Sam before sharing");
  await phone.getByTestId("share").click();
  await page.getByText("Do not admit").waitFor({ timeout: 15_000 });
  check(/not old enough/i.test(await page.getByTestId("door-reason").innerText()), "Sam is refused: “Not old enough”");
  await page.screenshot({ path: path.join(SHOTS, "08-door-refused.png") });
  await audit(page, "door: refused");

  // Jo (19) uses the licence in the phone's wallet (test wallet, test DMV)
  await phone.getByRole("button", { name: "Back to Neon Hall" }).click();
  await phone.locator("#pass-person").selectOption("__new");
  await phone.getByRole("button", { name: /Test wallet/ }).click();
  await phone.getByRole("button", { name: /Jo Sample/ }).click();
  await phone.getByTestId("use-test-licence").click();
  check(await phone.getByText(/Not shared: name, birth date, photo, address, licence number/).isVisible(), "the wallet sheet asks only for “Over 18” and “Over 21”");
  await page.screenshot({ path: path.join(SHOTS, "08a-wallet-sheet.png") });
  await audit(page, "Pass: wallet sheet");
  await phone.getByTestId("wallet-share").click();
  await phone.getByRole("group", { name: "decID Pass for Jo: 18+" }).waitFor({ timeout: 30_000 });
  check(await phone.getByTestId("pass-status").getByText(/^Active/).isVisible(), "Jo's Pass comes from the (test) licence: 18+, not 21+, active");
  // The same licence used again for another Pass: the first one is revoked (one licence, one Pass).
  await phone.locator("#pass-person").selectOption("__new");
  await phone.getByRole("button", { name: /Test wallet/ }).click();
  await phone.getByRole("button", { name: /Jo Sample/ }).click();
  await phone.getByTestId("use-test-licence").click();
  await phone.getByTestId("wallet-share").click();
  await phone.getByRole("group", { name: "decID Pass for Jo: 18+" }).waitFor({ timeout: 30_000 });
  await phone.locator("#pass-person").selectOption({ index: 2 });
  await phone.getByTestId("pass-status").getByText(/^Revoked/).waitFor({ timeout: 10_000 });
  check(true, "one licence backs one Pass: making a second Pass with Jo's licence revoked the first");
  await phone.locator("#pass-person").selectOption({ index: 3 });

  // Dashboard
  await page.getByRole("button", { name: "Business dashboard" }).click();
  check((await page.locator("[data-tour][data-done]").count()) === 5, "the walkthrough shows all five steps done");
  check(await page.getByRole("img", { name: /Passed: 1, Not old enough: 1/ }).isVisible(), "outcome chart: 1 passed, 1 not old enough");
  check(await page.getByRole("img", { name: /Median verification time \d+ ms over 2 checks/ }).isVisible(), "timing chart over 2 checks");
  await page.screenshot({ path: path.join(SHOTS, "09-dashboard.png"), fullPage: true });
  await audit(page, "dashboard: overview");
  await page.getByRole("region", { name: "Checks table" }).getByRole("row").nth(1).click();
  await page.getByRole("dialog").getByText("Signature valid").waitFor();
  check(true, "a check opens in a drawer with its verified receipt");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "10-drawer.png") });
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Receipts" }).click();
  await page.getByTestId("chain-status").getByText("Chain intact · 2 signed receipts").waitFor();
  await page.getByTestId("anchor-status").getByText("Anchored on-chain · 2 receipts").waitFor();
  check(true, "both receipts are anchored on-chain (ReceiptAnchor contract on the in-page chain)");

  // Attack 1: an insider edits a receipt without decID's key → the signature check catches it.
  await page.getByRole("button", { name: /Edit a receipt as an insider/ }).click();
  await page.getByTestId("chain-status").getByText(/Tampering detected at receipt 1: signature does not verify/).waitFor();
  check(true, "an insider's edit is caught by the signature check");
  await page.screenshot({ path: path.join(SHOTS, "11-tamper.png") });
  await page.getByRole("button", { name: "Restore the receipts" }).click();
  await page.getByTestId("chain-status").getByText("Chain intact · 2 signed receipts").waitFor();

  // Attack 2: the operator re-signs and re-chains history → signatures pass, the chain disagrees.
  await page.getByRole("button", { name: /Rewrite history as the operator/ }).click();
  await page.getByTestId("anchor-status").getByText(/Doesn’t match the chain: entry \d differs from the hash anchored on-chain/).waitFor();
  check(await page.getByTestId("chain-status").getByText("Chain intact · 2 signed receipts").isVisible(), "an operator rewrite passes every signature and link check…");
  check(true, "…and is caught only by the on-chain checkpoints");
  await page.screenshot({ path: path.join(SHOTS, "11b-operator-rewrite.png") });
  await page.getByRole("button", { name: "Restore the receipts" }).click();

  // Attack 3: the newest receipt is deleted → a shorter chain is valid, the anchored count is not.
  await page.getByRole("button", { name: /Delete the newest receipt/ }).click();
  await page.getByTestId("anchor-status").getByText(/entries were removed: 2 were anchored on-chain, 1 remain/).waitFor();
  check(await page.getByTestId("chain-status").getByText("Chain intact · 1 signed receipt").isVisible(), "a truncated chain still passes the signature check…");
  check(true, "…and is caught only by the anchored count");
  await page.getByRole("button", { name: "Restore the receipts" }).click();
  await page.getByTestId("anchor-status").getByText("Anchored on-chain · 2 receipts").waitFor();
  check(true, "restoring the receipts makes both checks pass again");

  await page.getByTestId("run-night").click();
  await page.getByTestId("run-night").getByText("Simulate a busy night").waitFor({ timeout: 120_000 });
  const log = await page.getByTestId("night-log").innerText();
  check(/Borrowed credential: refused · credential belongs to someone else/.test(log), "busy night: the borrowed credential is refused");
  check(/Revoked Pass: refused · credential revoked/.test(log), "busy night: the revoked Pass is refused");
  check((log.match(/admitted ·/g) ?? []).length >= 8 && (log.match(/not old enough/g) ?? []).length >= 2, "busy night: adults admitted, under-21 guests refused");
  await page.getByTestId("chain-status").getByText("Chain intact · 16 signed receipts").waitFor();
  await page.getByTestId("anchor-status").getByText("Anchored on-chain · 16 receipts").waitFor();
  check(true, "16 receipts, chain intact and all anchored on-chain");
  await page.getByRole("button", { name: "Overview" }).click();
  await page.screenshot({ path: path.join(SHOTS, "12-dashboard-night.png"), fullPage: true });
  await page.getByRole("button", { name: "Data & privacy" }).click();
  await audit(page, "dashboard: data & privacy");

  // Phone width
  const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  watch(mobile, "mobile");
  await mobile.goto(base);
  await mobile.getByTestId("verify-age").waitFor({ timeout: 30_000 });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal scrolling at phone width (overflow ${overflow}px)`);
  await mobile.getByRole("tab", { name: "Phone" }).click();
  const mp = mobile.getByTestId("phone");
  await mp.getByTestId("add-id").click();
  await mp.getByRole("button", { name: /Simulated Identity Office/ }).click();
  await mp.getByTestId("verify-me").click();
  await mp.getByTestId("pass-status").getByText(/^Active/).waitFor({ timeout: 30_000 });
  await mobile.getByRole("tab", { name: "Website" }).click();
  await mobile.getByTestId("verify-age").click();
  await mobile.getByRole("button", { name: "Open on the demo phone" }).click();
  await mp.getByTestId("share").click();
  await mp.getByRole("button", { name: "Back to Hopline" }).click();
  await mobile.getByTestId("age-verified").waitFor();
  check(true, "phone width: the whole checkout works with the Website / Phone switcher");
  // Ignore elements inside horizontal scrollers (they are meant to scroll).
  const offscreen = await mobile.evaluate(() =>
    Array.from(document.querySelectorAll("button, h1, h2")).filter((e) => {
      for (let p = e.parentElement; p; p = p.parentElement) if (["auto", "scroll"].includes(getComputedStyle(p).overflowX)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > window.innerWidth + 1;
    }).length,
  );
  check(offscreen === 0, `phone width: nothing pushed off screen (${offscreen} element(s))`);
  await mobile.screenshot({ path: path.join(SHOTS, "13-mobile.png") });
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await mobile.getByRole("tab", { name: "Phone" }).click();
  await mobile.screenshot({ path: path.join(SHOTS, "14-mobile-phone.png") });
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
