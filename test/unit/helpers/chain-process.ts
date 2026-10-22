import { spawn, type ChildProcess } from "node:child_process";

/** Starts `hardhat node` on a port and resolves once JSON-RPC answers. */
export async function startHardhatNode(port: number, cwd = process.cwd()): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/hardhat/dist/src/cli.js", "node", "--port", String(port)], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += String(d)));
  child.stderr?.on("data", (d) => (output += String(d)));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`hardhat node exited early:\n${output}`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill("SIGKILL");
  throw new Error(`hardhat node did not start on ${url}:\n${output}`);
}
