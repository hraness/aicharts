import { expect, mock, test } from "bun:test";
import {
  decodeUsageConsentPublicReply, encodeUsageConsentDecision,
  USAGE_CONSENT_PUBLIC_MEDIA, USAGE_CONSENT_PUBLIC_URL,
} from "./consent-public";
import type { LeaderboardConsentViewV1 } from "./leaderboard-contract";
mock.module("server-only", () => ({}));
const { createUsageConsentHandler } = await import("./consent-route");

const view: LeaderboardConsentViewV1 = { schemaVersion: 1, consent: true, consentedAtMs: 1_800_000_000_000, publicHandle: "alpha-coder" };
const ready = { kind: "query", result: { ok: true, value: view } };
function incoming(options: { method?: string; url?: string; headers?: Record<string, string>;
  body?: Uint8Array<ArrayBuffer> | string | null; signal?: AbortSignal } = {}) {
  const method = options.method ?? "GET";
  const body = options.body ?? null;
  return new Request(options.url ?? USAGE_CONSENT_PUBLIC_URL, { method, signal: options.signal,
    body: body === null ? null : body,
    headers: { accept: "application/json", "sec-fetch-site": "same-origin",
      ...(method === "POST" ? { origin: "https://aicharts.io", "content-type": "application/json" } : {}),
      ...options.headers } });
}
function fixture(options: { available?: () => boolean; query?: () => Promise<unknown> } = {}) {
  let calls = 0, checks = 0, lifetime = 0;
  const handle = createUsageConsentHandler({
    available() { checks++; return options.available?.() ?? true; },
    async query(request, input) {
      calls++; expect(request instanceof Request).toBe(true);
      expect(typeof input).toBe("object");
      return options.query ? options.query() : ready;
    },
    registerLifetime(terminal) { lifetime++; void terminal.catch(() => undefined); },
    now: () => 1_800_000_000_000,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  return { handle, counts: () => ({ calls, checks, lifetime }) };
}
function privacy(response: Response) {
  expect(response.headers.get("content-type")).toBe(USAGE_CONSENT_PUBLIC_MEDIA);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  for (const header of ["set-cookie", "location", "etag", "last-modified",
    "access-control-allow-origin", "access-control-allow-credentials"]) expect(response.headers.has(header)).toBe(false);
}
async function result(response: Response) {
  privacy(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.byteLength).toBeLessThanOrEqual(1_024);
  const body = decodeUsageConsentPublicReply(bytes); expect(body).not.toBeNull(); return body;
}

test("GET status and POST decisions reach the authenticated query port", async () => {
  const f = fixture();
  const status = await f.handle(incoming({ headers: { cookie: "private-session-cookie" } }));
  expect(status.status).toBe(200);
  expect(await result(status)).toEqual({ schemaVersion: 1, state: "ready", value: view });
  const grant = encodeUsageConsentDecision({ consent: true, publicHandle: "alpha-coder" })!;
  const posted = await f.handle(incoming({ method: "POST", body: grant,
    headers: { "content-length": String(grant.byteLength) } }));
  expect(posted.status).toBe(200);
  expect(await result(posted)).toEqual({ schemaVersion: 1, state: "ready", value: view });
  const absent = fixture({ query: async () => ({ kind: "query", result: { ok: false, error: "not_enrolled" } }) });
  const reply = await absent.handle(incoming());
  expect(reply.status).toBe(200);
  expect(await result(reply)).toEqual({ schemaVersion: 1, state: "not_enrolled" });
});

test("a checked authentication-required outcome becomes a fixed 401", async () => {
  const f = fixture({ query: async () => ({ kind: "authentication_required" }) });
  const response = await f.handle(incoming());
  expect(response.status).toBe(401);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "authentication_required" } });
});

test.each(["handle_unavailable", "publishing_full"])("a publishing refusal is an explicit private conflict response (%s)", async error => {
  const f = fixture({ query: async () => ({ kind: "query", result: { ok: false, error } }) });
  const response = await f.handle(incoming({ method: "POST", body: encodeUsageConsentDecision({ consent: true, publicHandle: "taken" })! }));
  expect(response.status).toBe(409);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: error } });
});

test("unsupported methods perform no availability or auth work", async () => {
  const f = fixture({ available() { throw new Error("CONSENT_CANARY"); }, query: async () => { throw new Error("CONSENT_CANARY"); } });
  for (const method of ["HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
    const response = await f.handle(incoming({ method }));
    expect(response.status).toBe(405); privacy(response);
    expect(response.headers.get("allow")).toBe("GET, POST");
    if (method === "HEAD") expect(await response.text()).toBe("");
    else expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "method_not_allowed" } });
  }
  expect(f.counts().calls).toBe(0);
});

test("a closed feature returns fixed 503 without reading identity or body", async () => {
  const f = fixture({ available: () => false });
  const request = incoming({ method: "POST", body: encodeUsageConsentDecision({ consent: true, publicHandle: "x" })!,
    headers: { "content-length": "43" } });
  Object.defineProperty(request, "url", { get() { throw new Error("CONSENT_CANARY"); } });
  const response = await f.handle(request);
  expect(response.status).toBe(503);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  expect(f.counts().calls).toBe(0);
});

test("origin and fetch metadata are checked before any session or body work", async () => {
  const f = fixture();
  for (const options of [
    { url: "https://www.aicharts.io/api/usage/consent" },
    { url: "https://foreign.example/api/usage/consent" },
    { headers: { origin: "https://foreign.example" } },
    { headers: { "sec-fetch-site": "cross-site" } },
    { headers: { "sec-fetch-site": "same-site" } },
    { method: "POST", body: "{}", headers: { origin: "https://foreign.example" } },
  ] as Parameters<typeof incoming>[0][]) {
    const response = await f.handle(incoming(options));
    expect(response.status).toBe(403);
    expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "request_rejected" } });
  }
  const missing = incoming(); missing.headers.delete("sec-fetch-site");
  expect((await f.handle(missing)).status).toBe(403);
  const noOrigin = incoming({ method: "POST", body: "{}" }); noOrigin.headers.delete("origin");
  expect((await f.handle(noOrigin)).status).toBe(403); // POST requires an explicit same-origin Origin
  expect(f.counts().calls).toBe(0);
});

test("exact URL, GET framing and POST decision framing refuse arbitrary input", async () => {
  const f = fixture();
  for (const options of [
    { url: `${USAGE_CONSENT_PUBLIC_URL}?accountId=CONSENT_CANARY` },
    { url: `${USAGE_CONSENT_PUBLIC_URL}/` },
    { headers: { authorization: "Bearer CONSENT_CANARY" } },
    { headers: { "content-type": "application/json" } }, // GET must not carry a content type
    { headers: { "content-length": "0" } }, // GET must not declare a body
    { method: "POST", body: "{}", headers: { "content-type": "text/plain" } },
    { method: "POST", body: "{}", headers: { "content-length": "999" } },
    { method: "POST", body: "{}", headers: { "content-encoding": "gzip" } },
    { method: "POST", body: "{}", headers: { "transfer-encoding": "chunked" } },
    { method: "POST" }, // POST requires a body
    { method: "POST", body: "{}", headers: { accept: "*/*" } },
  ] as Parameters<typeof incoming>[0][]) {
    const response = await f.handle(incoming(options));
    expect(response.status).toBe(400);
    expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "invalid_request" } });
  }
  expect(f.counts().calls).toBe(0);
});

test("malformed decision bodies never reach the authenticated query", async () => {
  const f = fixture();
  for (const body of [
    "not-json", "{}", "[]", "null",
    JSON.stringify({ consent: false, publicHandle: "x" }),
    JSON.stringify({ consent: true, publicHandle: null }),
    JSON.stringify({ consent: true, publicHandle: "Bad Handle" }),
    JSON.stringify({ consent: true, publicHandle: "x", accountId: "acct_0123" }),
    JSON.stringify({ consent: true, publicHandle: "x", trailing: 1 }),
    ` ${JSON.stringify({ consent: false, publicHandle: null })}`,
  ]) {
    const response = await f.handle(incoming({ method: "POST", body }));
    expect(response.status).toBe(400);
    expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "invalid_request" } });
  }
  const oversized = await f.handle(incoming({ method: "POST", body: JSON.stringify({ consent: true,
    publicHandle: "x", pad: "y".repeat(200) }), headers: { "content-length": "200" } }));
  expect(oversized.status).toBe(400);
  expect(f.counts().calls).toBe(0);
});

test("unchecked late outcomes are all fixed 503", async () => {
  for (const raw of [null, { kind: "unavailable" }, { kind: "authentication_required", email: "CONSENT_CANARY" },
    { kind: "query", result: { ok: true, value: view, extra: "CONSENT_CANARY" } },
    { kind: "query", result: { ok: true, value: { ...view, consent: false } } },
    ...["invalid_input", "unauthorized", "expired", "recovery_required", "clock_regressed",
      "storage_invalid", "storage_unavailable", "limit"].map(error => ({ kind: "query", result: { ok: false, error } }))]) {
    const g = fixture({ query: async () => raw });
    const reply = await g.handle(incoming());
    expect(reply.status).toBe(503);
    expect(await result(reply)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  }
});

test("feature closure, abort and thrown queries suppress every late outcome", async () => {
  for (const raw of [ready, { kind: "authentication_required" }]) {
    let available = true;
    const f = fixture({ available: () => available, query: async () => { available = false; return raw; } });
    expect((await f.handle(incoming())).status).toBe(503);
  }
  const controller = new AbortController();
  const aborted = fixture({ query: async () => { controller.abort(); return ready; } });
  expect((await aborted.handle(incoming({ signal: controller.signal }))).status).toBe(503);
  const thrown = fixture({ query: async () => { throw new Error("CONSENT_CANARY"); } });
  const response = await thrown.handle(incoming());
  expect(response.status).toBe(503);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
});
