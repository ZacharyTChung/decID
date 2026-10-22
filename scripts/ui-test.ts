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

async function run(stack: LocalStack) {
  const BASE = stack.origin;
  const browser = await chromium.launch();
  try {
    const plain = await browser.newPage();
    await plain.goto(`${BASE}/holder`);
    await plain.getByText("No browser wallet detected").waitFor();
    await plain.screenshot({ path: `${SHOTS}/00-no-wallet.png`, fullPage: true });
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
    step("holder connected, derived its did:pkh, signed in with SIWE and submitted a synthetic request");

    const issuer = await (await walletContext(browser, DEV_ROLES.issuerOperator, stack.rpc, stack.provider)).newPage();
    watch(issuer, "issuer");
    await issuer.goto(`${BASE}/issuer`);
    await issuer.getByRole("button", { name: "Connect wallet" }).click();
    await issuer.getByRole("button", { name: "Sign in with wallet" }).click();
    await issuer.getByRole("button", { name: "Approve and issue" }).click();
    await issuer.getByText("Not registered yet").waitFor({ timeout: 20_000 });
    await issuer.screenshot({ path: `${SHOTS}/01-issuer-issued.png`, fullPage: true });
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
    step("holder received the bundle, registered it on-chain and used the gated action");

    await holder.getByLabel("Export password").fill("ui-test-password-1");
    const [download] = await Promise.all([holder.waitForEvent("download"), holder.getByRole("button", { name: "Download encrypted backup" }).click()]);
    const backup = path.join(DIR, "backup.json");
    await download.saveAs(backup);
    step("encrypted backup exported");

    await holder.getByRole("link", { name: "Go to the verifier →" }).click();
    await holder.getByRole("button", { name: "New verification request" }).click();
    await holder.getByLabel(/I consent to share/).check();
    await holder.getByRole("button", { name: "Sign and present" }).click();
    await holder.getByText(/^Verified\./).waitFor({ timeout: 20_000 });
    await holder.screenshot({ path: `${SHOTS}/03-verifier-pass.png`, fullPage: true });
    step("verifier accepted the consented presentation");

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
    console.log(`\n✔ UI TEST PASSED (screenshots in ${path.relative(ROOT, SHOTS)}/)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n✘ UI TEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
    if (errors.length) console.error(errors.join("\n"));
    process.exit(1);
  });
