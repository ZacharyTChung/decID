"use client";

/** Browser API client. Same-origin JSON requests; the session cookie is HttpOnly and sent automatically. */
export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(0, "NETWORK", "Could not reach the app server.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
  if (!res.ok && data.error) throw new ClientApiError(res.status, data.error.code, data.error.message, data);
  if (!res.ok && res.status !== 422) throw new ClientApiError(res.status, "HTTP_" + res.status, `Request failed (${res.status}).`, data);
  return data as T;
}
