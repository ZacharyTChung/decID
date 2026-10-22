import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, enforceRateLimit } from "@/lib/server/http";
import { db } from "@/lib/server/db";

/**
 * Red-team finding: the rate limiter keyed clients by X-Forwarded-For, which any client can
 * set, so rotating that header bypassed every limit. It must only be trusted behind a proxy
 * that sets it (TRUST_PROXY=1).
 */
const req = (xff?: string) => new Request("http://localhost/api/x", { headers: xff ? { "x-forwarded-for": xff } : {} });

function hits(n: number, name: string, xff: (i: number) => string | undefined): number {
  let limited = 0;
  for (let i = 0; i < n; i++) {
    try {
      enforceRateLimit(req(xff(i)), name, 5);
    } catch (e) {
      if (e instanceof ApiError && e.code === "RATE_LIMITED") limited++;
      else throw e;
    }
  }
  return limited;
}

describe("rate limiting", () => {
  const saved = { disable: process.env.DISABLE_RATE_LIMIT, trust: process.env.TRUST_PROXY };
  beforeEach(() => {
    delete process.env.DISABLE_RATE_LIMIT;
    db().prepare("DELETE FROM rate_limits").run();
  });
  afterEach(() => {
    process.env.DISABLE_RATE_LIMIT = saved.disable;
    if (saved.trust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved.trust;
  });

  it("cannot be bypassed by rotating a spoofed X-Forwarded-For header", () => {
    delete process.env.TRUST_PROXY;
    expect(hits(10, "spoof", (i) => `198.51.100.${i}`)).toBe(5);
  });

  it("buckets per forwarded client only when a trusted proxy is configured", () => {
    process.env.TRUST_PROXY = "1";
    expect(hits(10, "proxied", (i) => `198.51.100.${i}`)).toBe(0);
    expect(hits(10, "proxied-same", () => "203.0.113.7")).toBe(5);
  });
});
