import type { HDNodeWallet } from "ethers";

/**
 * An HTTP client that behaves like a browser user of the app: a cookie jar, JSON bodies and
 * the Origin header a same-origin page would send. Optionally it sends a fixed
 * X-Forwarded-For address, used when the server runs behind a trusted proxy (TRUST_PROXY=1)
 * so separate actors get separate rate-limit buckets.
 */
export class HttpActor {
  cookie = "";
  constructor(
    readonly origin: string,
    readonly name: string,
    readonly wallet: HDNodeWallet,
    readonly clientIp?: string,
  ) {}

  get address() {
    return this.wallet.address;
  }

  async call(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${this.origin}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { origin: this.origin } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.clientIp ? { "x-forwarded-for": this.clientIp } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON body (kept as text)
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  async signIn(role: "holder" | "issuer") {
    const ch = await this.call("POST", "/api/auth/challenge", { address: this.address, chainId: 31337, role });
    if (ch.status !== 200) return ch;
    const signature = await this.wallet.signMessage(ch.body.message);
    return this.call("POST", "/api/auth/verify", { message: ch.body.message, signature });
  }
}
