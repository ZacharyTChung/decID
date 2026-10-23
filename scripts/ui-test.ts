/**
 * npm run test:ui: browser test of the Holder / Issuer / Verifier views.
 *
 * Builds nothing itself: `npm run test:ui` first runs a production build into
 * .next-uitest, then this script starts an isolated stack (chain on 8548, app on
 * 3200, state in .uitest/) and drives Chromium through Playwright.
 *
 * The page's wallet is a test EIP-1193 provider injected by Playwright. It
 * signs with Hardhat's PUBLIC dev keys in this Node process and forwards
 * everything else to the local chain, so signatures and transactions are real.
 * It is test tooling, not part of the app. Real users bring their own wallet.
 *
 * Needs a Chromium for Playwright (`npx playwright install chromium`, unless
 * PLAYWRIGHT_BROWSERS_PATH already provides one). Exits 1 on failure.
 * Screenshots are written to .uitest/screenshots/.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type { JsonRpcProvider } from "ethers";
import { DEV_ROLES, devWallet } from "./lib/dev-accounts";
import { startLocalStack, type LocalStack } from "./lib/local-stack";

const ROOT = process.cwd();
const DIR = path.join(ROOT, ".uitest");
const SHOTS = path.join(DIR, "screenshots");
const errors: string[] = [];

async function walletContext(browser: Browser, index: number, rpc: string, provider: JsonRpcProvider): Promise<BrowserContext> {
  const wallet = devWallet(index, provider);
  const ctx = await browser.newContext({ acceptDownloads: true });
  let connected = false; // like a real wallet: no accounts until the user approves a connection
  await ctx.exposeBinding("__testWallet", async (_src, method: string, params: unknown[] = []) => {
    switch (method) {
      case "eth_requestAccounts":
        connected = true;
        return [wallet.address];
      case "eth_accounts":
        return connected ? [wallet.address] : [];
      case "eth_chainId":
        return "0x7a69";
      case "personal_sign": {
        const msg = params[0] as string;
        return wallet.signMessage(msg.startsWith("0x") ? Buffer.from(msg.slice(2), "hex").toString("utf8") : msg);
      }
      case "eth_signTypedData_v4": {
        const { domain, types, message } = JSON.parse(params[1] as string);
        delete types.EIP712Domain;
        return wallet.signTypedData(domain, types, message);
      }
      case "eth_sendTransaction": {
        const tx = params[0] as { to: string; data?: string; value?: string };
        return (await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0 })).hash;
      }
      default: {
        // Raw JSON-RPC so errors keep { code, message, data } as a real wallet's would.
        const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = (await res.json()) as { result?: unknown; error?: unknown };
        return body.error ? { __rpcError: body.error } : body.result;
      }
    }
  });
  // Passed as a string: tsx/esbuild would otherwise inject helpers (e.g. __name) that do not exist in the page.
  await ctx.addInitScript(`
    window.ethereum = {
      request: async ({ method, params }) => {
        const r = await window.__testWallet(method, params);
        if (r && r.__rpcError) throw Object.assign(new Error(r.__rpcError.message), r.__rpcError);
        return r;
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  `);
  return ctx;
}

function watch(page: Page, name: string) {
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => {
    // 401/404/422 responses are expected outcomes in this flow; anything else is an error.
    if (m.type() === "error" && !/status of (401|404|422)/.test(m.text())) errors.push(`${name} console: ${m.text()}`);
  });
}

const step = (s: string) => console.log(`  ✔ ${s}`);

/**
 * Accessibility audit (axe-core, WCAG 2.1 A/AA rules) of the page in its current state.
 * Serious and critical violations fail the run; minor/moderate ones are printed as warnings.
 */
const a11ySummary: string[] = [];
async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const v of result.violations) {
    const line = `${label}: [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s): ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(", ")})`;
    if (v.impact === "serious" || v.impact === "critical") errors.push(`a11y ${line}`);
    else console.log(`  ! a11y warning ${line}`);
  }
  a11ySummary.push(`${label}: ${result.violations.length} violation(s), ${result.passes.length} rule(s) passed`);
}

async function run(stack: LocalStack) {
  const BASE = stack.origin;
  const browser = await chromium.launch();
  try {
    // Strict CSP: a fresh nonce per response, no 'unsafe-inline', and injected inline handlers must not run.
    const csp1 = (await fetch(`${BASE}/holder`)).headers.get("content-security-policy") ?? "";
    const csp2 = (await fetch(`${BASE}/holder`)).headers.get("content-security-policy") ?? "";
    const nonceOf = (c: string) => /'nonce-([^']+)'/.exec(c)?.[1];
    if (!nonceOf(csp1) || nonceOf(csp1) === nonceOf(csp2) || csp1.includes("'unsafe-inline'")) {
      throw new Error(`unexpected page CSP: ${csp1}`);
    }
    step("pages carry a per-request nonce CSP without 'unsafe-inline'");

    const plain = await (await browser.newContext()).newPage();
    await plain.goto(`${BASE}/holder`);
    await plain.getByText("No browser wallet detected").waitFor();
    await plain.screenshot({ path: `${SHOTS}/00-no-wallet.png`, fullPage: true });
    await audit(plain, "holder (no wallet)");
    const injected = await plain.evaluate(async () => {
      const w = window as unknown as { __injected?: boolean };
      // Classic HTML-injection XSS: markup with an inline event handler. Without 'unsafe-inline'
      // the handler must not run. (Scripts created by page JS via createElement are allowed by
      // 'strict-dynamic' by design, so they are not the threat this CSP addresses.)
      const div = document.createElement("div");
      div.innerHTML = '<img src="data:," onerror="window.__injected = true">';
      document.body.appendChild(div);
      await new Promise((r) => setTimeout(r, 300));
      return w.__injected === true;
    });
    if (injected) throw new Error("an injected inline event handler executed despite the CSP");
    step("an injected inline event handler is blocked by the CSP");
    step("without a wallet the UI says so instead of simulating one");

    const holder = await (await walletContext(browser, DEV_ROLES.holder, stack.rpc, stack.provider)).newPage();
    watch(holder, "holder");
    await holder.goto(`${BASE}/`);
    await holder.getByText("Local Hardhat 31337").waitFor();
    await holder.goto(`${BASE}/holder`);
    await holder.getByRole("button", { name: "Connect wallet" }).click();
    await holder.getByText(`did:pkh:eip155:31337:${devWallet(DEV_ROLES.holder).address}`).waitFor();
    await holder.getByRole("button", { name: "Sign in with wallet" }).click();
    await holder.getByText("Signed in as").waitFor();
    await holder.getByLabel(/I confirm this is synthetic/).check();
    await holder.getByRole("button", { name: "Submit request" }).click();
    await holder.getByText("pending", { exact: true }).waitFor();
    await audit(holder, "holder (signed in, request pending)");
    step("holder connected, derived its did:pkh, signed in with SIWE and submitted a synthetic request");

    const issuer = await (await walletContext(browser, DEV_ROLES.issuerOperator, stack.rpc, stack.provider)).newPage();
    watch(issuer, "issuer");
    await issuer.goto(`${BASE}/issuer`);
    await issuer.getByRole("button", { name: "Connect wallet" }).click();
    await issuer.getByRole("button", { name: "Sign in with wallet" }).click();
    await issuer.getByRole("button", { name: "Approve and issue" }).click();
    await issuer.getByText("Not registered yet").waitFor({ timeout: 20_000 });
    await issuer.screenshot({ path: `${SHOTS}/01-issuer-issued.png`, fullPage: true });
    await audit(issuer, "issuer (credential issued)");
    step("issuer operator signed in and approved");

    const intruder = await (await walletContext(browser, DEV_ROLES.otherHolder, stack.rpc, stack.provider)).newPage();
    await intruder.goto(`${BASE}/issuer`);
    await intruder.getByRole("button", { name: "Connect wallet" }).click();
    await intruder.getByRole("button", { name: "Sign in with wallet" }).click();
    await intruder.getByText(/not an authorized issuer operator/).waitFor();
    step("a non-operator wallet is refused the issuer role by the server");

    await holder.getByRole("button", { name: "Receive credential" }).click({ timeout: 15_000 });
    await holder.getByText("Unregistered", { exact: true }).waitFor();
    await holder.getByRole("button", { name: "Register credential" }).click();
    await holder.getByText(/Registered in block/).waitFor({ timeout: 20_000 });
    await holder.getByText("Valid", { exact: true }).waitFor({ timeout: 20_000 });
    await holder.getByRole("button", { name: "Check in to member area" }).click();
    await holder.getByText(/Checked in to the verified member area/).waitFor({ timeout: 20_000 });
    await holder.screenshot({ path: `${SHOTS}/02-holder-valid.png`, fullPage: true });
    await holder.getByRole("button", { name: "Show technical details" }).click();
    await audit(holder, "holder (credential, technical details open)");
    await holder.getByRole("button", { name: "Hide technical details" }).click();
    step("holder received the bundle, registered it on-chain and used the gated action");

    await holder.getByLabel("Export password").fill("ui-test-password-1");
    const [download] = await Promise.all([holder.waitForEvent("download"), holder.getByRole("button", { name: "Download encrypted backup" }).click()]);
    const backup = path.join(DIR, "backup.json");
    await download.saveAs(backup);
    step("encrypted backup exported");

    await holder.getByLabel("Vault passphrase").fill("vault-passphrase-1");
    await holder.getByRole("button", { name: "Save encrypted on this device" }).click();
    await holder.getByText("Saved, encrypted, on this device.").waitFor();
    // What is actually at rest in IndexedDB: an encrypted envelope, never the token or salt.
    const atRest = await holder.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const open = indexedDB.open("did-mvp-vault", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction("bundles").objectStore("bundles").getAll();
            all.onsuccess = () => resolve(JSON.stringify(all.result));
            all.onerror = () => reject(all.error);
          };
        }),
    );
    if (!atRest.includes("did-mvp.encrypted-holder-bundle/v1") || atRest.includes("eyJ") || /0x[0-9a-f]{64}/i.test(atRest)) {
      throw new Error("the device vault stores something other than ciphertext");
    }
    step("credential saved to the device vault; IndexedDB holds only the encrypted envelope");

    await holder.getByRole("link", { name: "Go to the verifier →" }).click();
    await holder.getByRole("button", { name: "New verification request" }).click();
    await holder.getByLabel(/I consent to share/).check();
    await holder.getByRole("button", { name: "Sign and present" }).click();
    await holder.getByText(/^Verified\./).waitFor({ timeout: 20_000 });
    await holder.screenshot({ path: `${SHOTS}/03-verifier-pass.png`, fullPage: true });
    await audit(holder, "verifier (verified result)");
    step("verifier accepted the consented presentation");

    // Selective disclosure: the 18+ action requests ageOver18 only; consent text names it, result shows it.
    await holder.getByLabel("Action").selectOption("access-age-restricted-area");
    await holder.getByRole("button", { name: "New verification request" }).click();
    await holder.getByText(/only ageOver18 = true\. Your other optional claims stay hidden\./).waitFor({ timeout: 10_000 });
    await holder.getByLabel(/I consent to share/).check();
    await holder.getByRole("button", { name: "Sign and present" }).click();
    await holder.getByText(/^Verified\./).waitFor({ timeout: 20_000 });
    const disclosedText = await holder.locator("dd", { hasText: "ageOver18" }).first().innerText();
    if (!/ageOver18:\s*true/.test(disclosedText) || /countryOfResidence|ageOver21/.test(await holder.locator("main").innerText().then((t) => t.split("Disclosed claims")[1] ?? ""))) {
      throw new Error(`unexpected disclosed claims: ${disclosedText}`);
    }
    await holder.screenshot({ path: `${SHOTS}/03b-verifier-age.png`, fullPage: true });
    await audit(holder, "verifier (18+, selective disclosure)");
    await holder.getByLabel("Action").selectOption("access-verified-member-area");
    step("18+ action: consent names only ageOver18, verifier shows ageOver18 = true and nothing else");

    await issuer.reload();
    await issuer.getByRole("button", { name: "Revoke" }).click({ timeout: 15_000 });
    await issuer.getByRole("button", { name: "Confirm revoke" }).click();
    await issuer.getByText("Revoked", { exact: true }).first().waitFor({ timeout: 20_000 });
    step("issuer revoked on-chain");

    await holder.getByRole("button", { name: "New verification request" }).click();
    await holder.getByLabel(/I consent to share/).check();
    await holder.getByRole("button", { name: "Sign and present" }).click();
    await holder.getByText("fail: REVOKED").waitFor({ timeout: 20_000 });
    await holder.screenshot({ path: `${SHOTS}/04-verifier-revoked.png`, fullPage: true });
    step("fresh verification fails with REVOKED");

    await holder.goto(`${BASE}/holder`);
    await holder.getByText("No credential loaded").waitFor();
    await holder.getByLabel("Unlock passphrase").fill("not-the-passphrase");
    await holder.getByRole("button", { name: "Unlock saved credential" }).click();
    await holder.getByText(/wrong password or the file was modified/).waitFor();
    await holder.getByLabel("Unlock passphrase").fill("vault-passphrase-1");
    await holder.getByRole("button", { name: "Unlock saved credential" }).click();
    await holder.getByText("Revoked", { exact: true }).waitFor({ timeout: 20_000 });
    step("after a reload the device vault unlocks only with the right passphrase");
    await holder.getByRole("button", { name: "Remove from this device" }).click();
    await holder.getByText("Removed from this device.").waitFor();

    await holder.goto(`${BASE}/holder`);
    await holder.getByText("No credential loaded").waitFor();
    await holder.getByText("Nothing saved on this device for this wallet.").waitFor();
    await holder.getByLabel("Backup file").setInputFiles(backup);
    await holder.getByLabel("Backup password").fill("wrong-password-123");
    await holder.getByRole("button", { name: "Import backup" }).click();
    await holder.getByText(/wrong password or the file was modified/).waitFor();
    await holder.getByLabel("Backup password").fill("ui-test-password-1");
    await holder.getByRole("button", { name: "Import backup" }).click();
    await holder.getByText("Revoked", { exact: true }).waitFor({ timeout: 20_000 });
    await holder.getByRole("button", { name: "Check in to member area" }).click();
    await holder.getByText(/Access denied by the gate: registry status is Revoked/).waitFor({ timeout: 20_000 });
    await holder.screenshot({ path: `${SHOTS}/05-holder-revoked.png`, fullPage: true });
    await audit(holder, "holder (revoked, gate refused)");
    await holder.goto(`${BASE}/`);
    await audit(holder, "home");
    step("after reload: wrong backup password rejected, import works, gate refuses the revoked credential");
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("UI test (Playwright + Chromium, local stack)");
  mkdirSync(SHOTS, { recursive: true });
  const stack = await startLocalStack({ dir: DIR, chainPort: 8548, appPort: 3200, mode: "start", distDir: ".next-uitest", log: step });
  mkdirSync(SHOTS, { recursive: true }); // the stack resets DIR
  try {
    await run(stack);
  } finally {
    stack.provider.destroy();
    stack.stop();
  }
}

main()
  .then(() => {
    if (errors.length) {
      console.error("\n✘ UI TEST FAILED: browser errors\n" + errors.join("\n"));
      process.exit(1);
    }
    console.log(`\nAccessibility (axe, WCAG 2.1 A/AA):\n  ${a11ySummary.join("\n  ")}`);
    console.log(`\n✔ UI TEST PASSED (screenshots in ${path.relative(ROOT, SHOTS)}/)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n✘ UI TEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
    if (errors.length) console.error(errors.join("\n"));
    process.exit(1);
  });
