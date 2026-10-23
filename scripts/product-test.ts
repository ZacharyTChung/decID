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
  await home.screenshot({ path: path.join(SHOTS, "00-home.png"), fullPage: true });
  await audit(home, "product home");

  // ---------------------------------------------------------------- Alex gets a Pass
  await phone.goto(`${base}/pass`);
  await phone.getByRole("heading", { name: /Prove you’re old enough/ }).waitFor();
  await phone.screenshot({ path: path.join(SHOTS, "01-pass-welcome.png") });
  await audit(phone, "Pass: welcome");
  await phone.getByRole("button", { name: /^Alex/ }).click();
  await phone.getByRole("heading", { name: "Get verified" }).waitFor();
  check((await phone.locator("#pass-dob").inputValue()) === "1990-04-04", "sample person Alex pre-fills the synthetic application");
  await audit(phone, "Pass: get verified");
  await phone.getByRole("button", { name: "Verify me" }).click();
  await phone.getByLabel("Your decID Pass").waitFor({ timeout: 60_000 });
  await phone.getByText("Active", { exact: true }).waitFor({ timeout: 30_000 });
  check(true, "Alex verified once and the Pass is Active (gas sponsored; no wallet extension, no crypto)");
  await phone.screenshot({ path: path.join(SHOTS, "02-pass-card.png") });
  await audit(phone, "Pass: card");

  // ---------------------------------------------------------------- Hopline checkout
  const shop = await laptopCtx.newPage();
  watch(shop, "shop");
  await shop.goto(`${base}/demo/shop`);
  await shop.getByRole("heading", { name: "Age check required" }).waitFor();
  await audit(shop, "Hopline: checkout");
  await shop.getByRole("button", { name: "Verify age with decID" }).click();
  const walletUrl = await shop.locator("[data-wallet-url]").first().getAttribute("data-wallet-url");
  check(!!walletUrl && walletUrl.includes("/pass/r/"), "Hopline's backend created a decID check (wallet link + QR code)");
  await shop.screenshot({ path: path.join(SHOTS, "03-shop-waiting.png"), fullPage: true });

  await phone.goto(walletUrl!);
  await phone.getByText("Are you 21 or older?").waitFor();
  check(await phone.getByText("Name", { exact: false }).first().isVisible(), "consent screen lists what Hopline will NOT see");
  await phone.screenshot({ path: path.join(SHOTS, "04-pass-consent.png") });
  await audit(phone, "Pass: consent");
  await phone.getByRole("button", { name: /Share “21\+” with Hopline/ }).click();
  await phone.getByText("21+ confirmed").waitFor();
  await phone.screenshot({ path: path.join(SHOTS, "05-pass-shared.png") });

  await shop.getByText("Order confirmed ✓").waitFor({ timeout: 15_000 });
  const received = await shop.getByLabel("What Hopline received").innerText();
  check(received.includes('"ageOver21": true') && received.includes('"valid": true'), "Hopline received { ageOver21: true } and a receipt whose signature it verified");
  check(!/Alex|1990|SYN-|did:pkh|0x[0-9a-fA-F]{40}/.test(received), "…and nothing personal: no name, birth date, ID number, DID or wallet address");
  await shop.screenshot({ path: path.join(SHOTS, "06-shop-confirmed.png"), fullPage: true });

  // ---------------------------------------------------------------- Neon Hall door
  const door = await laptopCtx.newPage();
  watch(door, "door");
  await door.goto(`${base}/demo/door`);
  const doorUrl = await door.locator("[data-wallet-url]").getAttribute("data-wallet-url");
  await door.screenshot({ path: path.join(SHOTS, "07-door-scan.png") });
  await audit(door, "Neon Hall: scan");
  await phone.goto(doorUrl!);
  await phone.getByRole("button", { name: /Share “21\+” with Neon Hall/ }).click();
  const phoneCode = (await phone.getByTestId("match-code").innerText()).trim();
  await door.getByText("21+ VERIFIED").waitFor({ timeout: 15_000 });
  const doorCode = (await door.getByTestId("door-match-code").innerText()).trim();
  check(phoneCode.length === 4 && phoneCode === doorCode, `door and phone show the same match code (${doorCode})`);
  await door.screenshot({ path: path.join(SHOTS, "08-door-admitted.png") });
  await phone.screenshot({ path: path.join(SHOTS, "09-pass-door-code.png") });

  // ---------------------------------------------------------------- Sam (16) is refused
  await phone.goto(`${base}/pass`);
  await phone.getByLabel("Demo person").selectOption("__new");
  await phone.getByRole("heading", { name: "Get verified" }).waitFor();
  await phone.getByRole("button", { name: /Fill as Sam/ }).click();
  await phone.getByRole("button", { name: "Verify me" }).click();
  await phone.getByText("Active", { exact: true }).waitFor({ timeout: 60_000 });
  check(await phone.getByText("21+").first().isVisible(), "Sam has a Pass too (18+ ✕, 21+ ✕ on the card)");
  await door.waitForSelector("[data-wallet-url]", { timeout: 20_000 }); // the door resets for the next guest
  const doorUrl2 = await door.locator("[data-wallet-url]").getAttribute("data-wallet-url");
  await phone.goto(doorUrl2!);
  await phone.getByText(/Your Pass says you are not 21\+/).waitFor();
  check(true, "the Pass warns Sam before sharing that the answer will be “no”");
  await phone.getByRole("button", { name: /Share “21\+” with Neon Hall/ }).click();
  await door.getByText("ENTRY REFUSED").waitFor({ timeout: 15_000 });
  check((await door.getByTestId("door-reason").innerText()).includes("Not old enough"), "Sam is refused at the door: “Not old enough”");
  await door.screenshot({ path: path.join(SHOTS, "10-door-refused.png") });

  // ---------------------------------------------------------------- business dashboard
  const biz = await laptopCtx.newPage();
  watch(biz, "business");
  await biz.goto(`${base}/business`);
  await biz.getByRole("button", { name: "Neon Hall (venue)" }).click();
  await biz.getByText("Chain intact · 2 signed receipts").waitFor({ timeout: 10_000 });
  const text = await biz.locator("main").innerText();
  check(/Age checks\s*\n?\s*/.test(text) && text.includes("Personal data held: none"), "dashboard: totals, an intact signed receipt chain, “Personal data held: none”");
  const fields = await biz.locator("ul li code").allInnerTexts();
  check(fields.length > 5 && !fields.some((f) => /holder|wallet|did|name$|birth|address|credential|salt|disclosure|photo/i.test(f) && f !== "issuer_name"), `dashboard: none of the ${fields.length} stored fields can hold personal data`);
  await biz.screenshot({ path: path.join(SHOTS, "11-business.png"), fullPage: true });
  await audit(biz, "business dashboard");

  // ---------------------------------------------------------------- demo stage
  const stage = await laptopCtx.newPage();
  watch(stage, "stage");
  await stage.setViewportSize({ width: 1600, height: 1000 });
  await stage.goto(`${base}/demo`);
  const shopFrame = stage.frameLocator('iframe[title="Hopline · online checkout"]');
  await shopFrame.getByRole("button", { name: "Verify age with decID" }).click();
  await shopFrame.getByRole("button", { name: "Open decID Pass on this device" }).click();
  const phoneFrame = stage.frameLocator('iframe[title="decID Pass on a phone"]');
  await phoneFrame.getByText("Are you 21 or older?").waitFor({ timeout: 15_000 });
  check(true, "demo stage: the business's request opens in the phone frame by itself");
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
