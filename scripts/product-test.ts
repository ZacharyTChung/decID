/**
 * npm run test:product: the decID product, end to end, in Chromium, the way the class demo runs:
 *
 *   phone  : decID Pass — create a Pass as Alex (adult), get verified, activated with sponsored gas
 *   laptop : Hopline checkout — "Verify age with decID" → phone shares "21+" → order confirmed,
 *            and the shop's view of what it received contains no personal data
 *   laptop : Neon Hall door — phone shares → door turns green with the SAME match code as the phone
 *   phone  : a second person, Sam (16) → refused at the door with "Not old enough"
 *   laptop : business dashboard — counts, intact signed receipt chain, no personal fields
 *   laptop : demo stage — the business asks, and the phone frame opens the request by itself
 *
 * Also runs an axe accessibility audit (WCAG 2.1 A/AA) of each screen and fails on console
 * errors. Screenshots go to .product-test/ (useful for slides).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { startLocalStack, type LocalStack } from "./lib/local-stack";
import { newApiKey } from "../src/lib/server/verify-api/merchants";

const SHOTS = path.join(process.cwd(), ".product-test");
mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "✔" : "✘"} ${name}`);
  if (!ok) failures.push(name);
};
const errors: string[] = [];
const watch = (p: Page, label: string) => {
  p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource: the server responded with a status of 40[14]/.test(m.text())) errors.push(`${label}: ${m.text()}`);
  });
};
const axeResults: string[] = [];
async function audit(p: Page, label: string) {
  const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeResults.push(`${label}: ${serious.length} serious, ${r.violations.length - serious.length} minor, ${r.passes.length} rules passed`);
  for (const v of serious) console.log(`    axe ${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  check(serious.length === 0, `accessibility (axe, serious/critical): ${label}`);
}

let stack: LocalStack | undefined;
let browser: Browser | undefined;
try {
  stack = await startLocalStack({
    dir: path.join(process.cwd(), ".product-test", "stack"),
    chainPort: 8562,
    appPort: 3520,
    mode: "start",
    distDir: ".next-product",
    appEnv: { DEMO_MODE: "1", ISSUER_AUTO_APPROVE: "1", DEMO_HOPLINE_API_KEY: newApiKey(), DEMO_NEONHALL_API_KEY: newApiKey(), DECID_API_BASE: "http://127.0.0.1:3520" },
    log: (m) => console.log(`  ${m}`),
  });
  const base = stack.origin;
  browser = await chromium.launch();
  // One browser context = one device. The phone is its own device; the laptop screens share one.
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const laptopCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const phone = await phoneCtx.newPage();
  watch(phone, "phone");

  // ---------------------------------------------------------------- landing
  const home = await laptopCtx.newPage();
  watch(home, "home");
  await home.goto(`${base}/`);
  check(await home.getByRole("heading", { name: "Prove you’re 21. Nothing else." }).isVisible(), "product home renders");
  check(await home.evaluate(async () => (await document.fonts.load("16px 'Inter Variable'")).length > 0), "the fallback UI font (Inter) loads, self-hosted and allowed by the CSP");
  await home.screenshot({ path: path.join(SHOTS, "00-home.png"), fullPage: true });
  await audit(home, "product home");

  // ---------------------------------------------------------------- Alex adds an ID
  await phone.goto(`${base}/pass`);
  await phone.getByRole("heading", { name: "Add your ID" }).waitFor();
  await phone.screenshot({ path: path.join(SHOTS, "01-pass-add.png") });
  await audit(phone, "Pass: add ID");
  await phone.getByRole("button", { name: /Simulated Identity Office/ }).click();
  check((await phone.locator("#pass-dob").inputValue()) === "1990-04-04", "Alex is the default synthetic person");
  await audit(phone, "Pass: details");
  await phone.getByTestId("verify-me").click();
  await phone.getByRole("group", { name: "decID Pass for Alex: 21+" }).waitFor({ timeout: 60_000 });
  await phone.getByTestId("pass-status").getByText(/^Active/).waitFor({ timeout: 30_000 });
  check(true, "Alex verified once and the Pass is Active (gas sponsored; no wallet extension, no crypto)");
  await phone.screenshot({ path: path.join(SHOTS, "02-pass-card.png") });
  await audit(phone, "Pass: wallet");

  // ---------------------------------------------------------------- Hopline checkout
  const shop = await laptopCtx.newPage();
  watch(shop, "shop");
  await shop.goto(`${base}/demo/shop`);
  await shop.getByRole("heading", { name: "Age verification" }).waitFor();
  await audit(shop, "Hopline: checkout");
  await shop.getByTestId("verify-age").click();
  const walletUrl = await shop.locator("[data-wallet-url]").first().getAttribute("data-wallet-url");
  check(!!walletUrl && walletUrl.includes("/pass/r/"), "Hopline's backend created a decID check (wallet link + QR code)");
  await shop.screenshot({ path: path.join(SHOTS, "03-shop-waiting.png"), fullPage: true });

  await phone.goto(walletUrl!);
  await phone.getByRole("dialog").getByText("Requested").waitFor();
  check(await phone.getByText(/Your name, date of birth, address, ID number, photo/).isVisible(), "the consent sheet says what Hopline will NOT see");
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(SHOTS, "04-pass-consent.png") });
  await audit(phone, "Pass: consent");
  await phone.getByTestId("share").click();
  await phone.getByText("Shared with Hopline").waitFor();
  await phone.screenshot({ path: path.join(SHOTS, "05-pass-shared.png") });

  await shop.getByTestId("age-verified").waitFor({ timeout: 15_000 });
  await shop.getByRole("button", { name: "What Hopline received" }).click();
  const received = await shop.getByLabel("What Hopline received").innerText();
  check(received.includes('"ageOver21": true') && received.includes('"valid": true'), "Hopline received { ageOver21: true } and a receipt whose signature it verified");
  check(!/Alex|1990|SYN-|did:pkh|0x[0-9a-fA-F]{40}/.test(received), "…and nothing personal: no name, birth date, ID number, DID or wallet address");
  await shop.getByTestId("place-order").click();
  await shop.getByText("Order confirmed").waitFor();
  await shop.screenshot({ path: path.join(SHOTS, "06-shop-confirmed.png"), fullPage: true });

  // ---------------------------------------------------------------- Neon Hall door
  const door = await laptopCtx.newPage();
  watch(door, "door");
  await door.goto(`${base}/demo/door`);
  const doorUrl = await door.locator("[data-wallet-url]").getAttribute("data-wallet-url");
  await door.screenshot({ path: path.join(SHOTS, "07-door-scan.png") });
  await audit(door, "Neon Hall: scan");
  await phone.goto(doorUrl!);
  await phone.getByTestId("share").click();
  const phoneCode = (await phone.getByTestId("match-code").innerText()).trim();
  await door.getByText("OK to enter").waitFor({ timeout: 15_000 });
  const doorCode = (await door.getByTestId("door-match-code").innerText()).trim();
  check(phoneCode.length === 4 && phoneCode === doorCode, `door and phone show the same match code (${doorCode})`);
  await door.screenshot({ path: path.join(SHOTS, "08-door-admitted.png") });
  await phone.screenshot({ path: path.join(SHOTS, "09-pass-door-code.png") });
  await audit(door, "Neon Hall: admitted");

  // ---------------------------------------------------------------- Sam (16) is refused
  await phone.goto(`${base}/pass`);
  await phone.locator("#pass-person").selectOption("__new");
  await phone.getByRole("button", { name: /Simulated Identity Office/ }).click();
  await phone.getByRole("radio", { name: "Sam" }).click();
  await phone.getByTestId("verify-me").click();
  await phone.getByRole("group", { name: "decID Pass for Sam: Under 18" }).waitFor({ timeout: 60_000 });
  check((await phone.locator("#pass-person").evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)) === "Sam", "Sam has a Pass too, and the person menu reads “Sam”");
  await door.waitForSelector("[data-wallet-url]", { timeout: 20_000 }); // the door resets for the next guest
  const doorUrl2 = await door.locator("[data-wallet-url]").getAttribute("data-wallet-url");
  await phone.goto(doorUrl2!);
  await phone.getByText(/Your ID says you are not 21 or older/).waitFor();
  check(true, "the Pass warns Sam before sharing that the answer will be “No”");
  await phone.getByTestId("share").click();
  await door.getByText("Do not admit").waitFor({ timeout: 15_000 });
  check(/not old enough/i.test(await door.getByTestId("door-reason").innerText()), "Sam is refused at the door: “Not old enough”");
  check(!(await phone.getByText("shows the same code").isVisible()), "Sam’s phone does not mention a match code it doesn’t show");
  await door.screenshot({ path: path.join(SHOTS, "10-door-refused.png") });
  await audit(door, "Neon Hall: refused");

  // ---------------------------------------------------------------- business dashboard
  const biz = await laptopCtx.newPage();
  watch(biz, "business");
  await biz.goto(`${base}/business`);
  await audit(biz, "business sign-in");
  await biz.getByRole("button", { name: "Neon Hall" }).click();
  await biz.getByRole("img", { name: /Passed: 1, Not old enough: 1/ }).waitFor({ timeout: 10_000 });
  check(await biz.getByText("Personal data held: none").isVisible(), "dashboard: outcomes chart and “Personal data held: none”");
  await biz.screenshot({ path: path.join(SHOTS, "11-business.png"), fullPage: true });
  await audit(biz, "business dashboard");
  await biz.getByRole("button", { name: "Receipts" }).click();
  await biz.getByTestId("chain-status").getByText("Chain intact · 2 signed receipts").waitFor({ timeout: 10_000 });
  check(true, "dashboard: an intact chain of 2 signed receipts");
  await biz.getByRole("button", { name: "Data & privacy" }).click();
  const fields = await biz.locator("tbody code").allInnerTexts();
  check(fields.length > 5 && !fields.some((f) => /holder|wallet|did|name$|birth|address|credential|salt|disclosure|photo/i.test(f) && f !== "issuer_name"), `dashboard: none of the ${fields.length} stored fields can hold personal data`);

  // ---------------------------------------------------------------- demo stage
  const stage = await laptopCtx.newPage();
  watch(stage, "stage");
  await stage.setViewportSize({ width: 1600, height: 1000 });
  await stage.goto(`${base}/demo`);
  const shopFrame = stage.frameLocator('iframe[title="Online checkout"]');
  await shopFrame.getByTestId("verify-age").click();
  await shopFrame.getByRole("button", { name: "Open on the demo phone" }).click();
  const phoneFrame = stage.frameLocator('iframe[title="decID Pass on a phone"]');
  // This browser profile has no ID yet, so the sheet offers to add one: either way the request opened.
  await phoneFrame.getByRole("dialog").getByText(/Hopline asks/).waitFor({ timeout: 15_000 });
  check(true, "demo stage: the business's request opens in the phone frame by itself");
  await stage.waitForTimeout(400);
  await stage.screenshot({ path: path.join(SHOTS, "12-stage.png") });
} catch (e) {
  failures.push(`crashed: ${(e as Error).message.split("\n")[0]}`);
  console.error(e);
  // Leave evidence: a screenshot of every open page at the moment of failure.
  for (const [i, p] of (browser?.contexts().flatMap((c) => c.pages()) ?? []).entries()) {
    await p.screenshot({ path: path.join(SHOTS, `failure-${i}.png`) }).catch(() => undefined);
  }
} finally {
  await browser?.close();
  stack?.stop();
}

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 4).join(" | ")}` : ""}`);
console.log(`\n  ${axeResults.join("\n  ")}`);
console.log(failures.length ? `\n✘ PRODUCT TEST FAILED: ${failures.length} check(s)` : "\n✔ PRODUCT TEST PASSED (screenshots in .product-test/)");
process.exit(failures.length ? 1 : 0);
