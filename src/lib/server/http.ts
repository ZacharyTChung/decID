import "server-only";
import type { z } from "zod";
import { appConfig } from "./config";
import { db, nowSeconds, purgeExpired } from "./db";

/**
 * Small HTTP toolkit for the route handlers. Handlers are plain
 * `(Request) => Promise<Response>` functions, so the same code is exercised by
 * the Next.js server, the API tests and the headless demo.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  // Unknown errors: log only the class/message server-side (never request bodies), return a generic body.
  console.error("[api] internal error:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  return json({ error: { code: "INTERNAL", message: "internal error" } }, { status: 500 });
}

type Handler = (req: Request) => Promise<Response>;

interface RouteOptions {
  /** Rate-limit bucket name and per-minute budget per client. */
  rateLimit?: { name: string; perMinute: number };
}

/** Wraps a handler with origin/CSRF checks for unsafe methods, rate limiting and error mapping. */
export function route(handler: Handler, opts: RouteOptions = {}): Handler {
  return async (req) => {
    try {
      purgeExpired();
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      if (opts.rateLimit) enforceRateLimit(req, opts.rateLimit.name, opts.rateLimit.perMinute);
      return await handler(req);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests: the Origin
 * header must equal the configured app origin, and the body must be JSON (which
 * a cross-site HTML form cannot send without a CORS preflight). Session cookies
 * are also SameSite=Strict.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin !== appConfig().origin) throw new ApiError(403, "BAD_ORIGIN", "request origin not allowed");
}

const MAX_BODY_BYTES = 32 * 1024;

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "expected application/json");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "BODY_TOO_LARGE", "request body too large");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new ApiError(413, "BODY_TOO_LARGE", "request body too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "body is not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Report field paths only, never the submitted values.
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    throw new ApiError(400, "VALIDATION_FAILED", `invalid fields: ${fields}`);
  }
  return parsed.data;
}

function clientKey(req: Request): string {
  // X-Forwarded-For is client-controlled unless a reverse proxy we operate overwrites it.
  // Only with TRUST_PROXY=1 (app deployed behind such a proxy) is it used to tell clients apart;
  // otherwise every request shares one bucket, so rotating a spoofed header cannot bypass limits.
  if (process.env.TRUST_PROXY !== "1") return "direct";
  return (req.headers.get("x-forwarded-for") ?? "direct").split(",")[0]!.trim().slice(0, 64) || "direct";
}

export function enforceRateLimit(req: Request, name: string, perMinute: number): void {
  if (process.env.DISABLE_RATE_LIMIT === "1") return;
  const now = nowSeconds();
  const windowStart = now - (now % 60);
  const bucket = `${name}:${clientKey(req)}`;
  const row = db()
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .get(bucket, windowStart) as { count: number };
  if (row.count > perMinute) throw new ApiError(429, "RATE_LIMITED", "too many requests, try again in a minute");
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return undefined; // malformed cookie: treat as absent rather than failing every request
      }
    }
  }
  return undefined;
}
