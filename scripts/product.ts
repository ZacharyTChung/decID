/**
 * npm run product [-- --lan] [-- --port 3000]
 *
 * Starts the whole decID product demo with one command: a local chain, fresh issuer and
 * receipt keys, deployed contracts, two demo businesses (Hopline, an online drinks shop; Neon
 * Hall, a 21+ venue) with their own API keys, and the app (production build) in demo mode.
 *
 *   --lan   listen on the local network and use this machine's LAN address, so a phone on the
 *           same Wi-Fi can scan the door QR code and use decID Pass. (Plain HTTP works: the
 *           Pass needs no secure-context browser APIs.)
 *
 * Everything is local and synthetic. Stop with Ctrl+C; the next run starts fresh.
 */
import { networkInterfaces } from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { startLocalStack } from "./lib/local-stack";
import { newApiKey } from "../src/lib/server/verify-api/merchants";

const args = process.argv.slice(2);
const lan = args.includes("--lan");
const port = Number(args[args.indexOf("--port") + 1] || 3000) || 3000;

function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) return i.address;
  }
  return undefined;
}

const host = lan ? lanAddress() : undefined;
if (lan && !host) {
  console.error("No LAN address found. Connect to Wi-Fi, or run without --lan.");
  process.exit(1);
}
const origin = `http://${host ?? "localhost"}:${port}`;

console.log("Starting decID (local chain, synthetic data)…");
const stack = await startLocalStack({
  dir: path.join(process.cwd(), ".product"),
  chainPort: 8545,
  appPort: port,
  mode: "start",
  distDir: ".next-product",
  host: lan ? "0.0.0.0" : undefined,
  origin,
  log: (m) => console.log(`  ${m}`),
  appEnv: {
    DEMO_MODE: "1",
    ISSUER_AUTO_APPROVE: "1",
    DEMO_HOPLINE_API_KEY: newApiKey(),
    DEMO_NEONHALL_API_KEY: newApiKey(),
    DECID_API_BASE: `http://127.0.0.1:${port}`,
  },
});

const rows: [string, string][] = [
  ["Product home", `${origin}/`],
  ["Demo stage (laptop: phone + business side by side)", `${origin}/demo`],
  ["decID Pass (consumer wallet)", `${origin}/pass`],
  ["Hopline (online shop, 21+ checkout)", `${origin}/demo/shop`],
  ["Neon Hall (venue door, 21+)", `${origin}/demo/door`],
  ["Business dashboard", `${origin}/business`],
  ["Protocol lab (issuer console, verifier)", `${origin}/lab`],
];
console.log("\n decID is running\n");
for (const [label, url] of rows) console.log(`  ${label.padEnd(52)} ${url}`);
if (lan) {
  console.log(`\n  Phone: join the same Wi-Fi and scan this to open decID Pass (${origin}/pass):\n`);
  console.log(await QRCode.toString(`${origin}/pass`, { type: "terminal", small: true }));
}
console.log("\n  Press Ctrl+C to stop. Each run starts from a clean slate.\n");

const stop = () => {
  stack.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => undefined);
