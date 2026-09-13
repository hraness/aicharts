import { expect, mock, test } from "bun:test";
import type { PrivateDaysV1 } from "./private-days-contract";
import { decodePrivateDaysPublicResponse, PRIVATE_DAYS_PUBLIC_MEDIA, PRIVATE_DAYS_PUBLIC_URL } from "./private-days-public";
mock.module("server-only", () => ({}));
const { createPrivateDaysPublicHandler } = await import("./private-days-route");

const range = { firstUtcDay: 10, dayCount: 1 };
const cell = { usageOccurrences: 0, observedAccountedTokens: "0", observedOutputTokens: "0" };
const value: PrivateDaysV1 = { schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
  journalRevision: 0, journalCommittedAtMs: null, firstUtcDay: 10, days: [{ utcDay: 10, codex: cell, claudeCode: cell }] };
const ready = { kind: "query", result: { ok: true, value } };
function incoming(options: { method?: string; url?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  return new Request(options.url ?? `${PRIVATE_DAYS_PUBLIC_URL}?firstUtcDay=10&dayCount=1`, { method: options.method ?? "GET", signal: options.signal,
    headers: { accept: "application/json", "sec-fetch-site": "same-origin", ...options.headers } });
}
function fixture(options: { available?: () => boolean; query?: () => Promise<unknown> } = {}) {
  let calls = 0, checks = 0;
  const handle = createPrivateDaysPublicHandler({ available() { checks++; return options.available?.() ?? true; },
    async query(request, actualRange) {
      calls++; expect(request instanceof Request).toBe(true); expect(actualRange).toEqual(range);
      return options.query ? options.query() : ready;
    } });
  return { handle, counts: () => ({ calls, checks }) };
}
function privacy(response: Response) {
  expect(response.headers.get("content-type")).toBe(PRIVATE_DAYS_PUBLIC_MEDIA);
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  for (const header of ["set-cookie", "location", "etag", "last-modified", "access-control-allow-origin", "access-control-allow-credentials"]) expect(response.headers.has(header)).toBe(false);
}
async function result(response: Response) {
  privacy(response); const bytes = new Uint8Array(await response.arrayBuffer()); expect(bytes.byteLength).toBeLessThanOrEqual(16_384);
  const body = decodePrivateDaysPublicResponse(bytes, range); expect(body).not.toBeNull(); return body;
}

test("ready snapshots and not-enrolled responses preserve distinct 200 states", async () => {
  const f = fixture(), response = await f.handle(incoming({ headers: { cookie: "browser-private-cookie", "if-none-match": "ignored" } }));
  expect(response.status).toBe(200); expect(await result(response)).toEqual({ schemaVersion: 1, state: "ready", value });
  expect(f.counts().calls).toBe(1);
  const absent = fixture({ query: async () => ({ kind: "query", result: { ok: false, error: "not_enrolled" } }) });
  const reply = await absent.handle(incoming()); expect(reply.status).toBe(200);
  expect(await result(reply)).toEqual({ schemaVersion: 1, state: "not_enrolled" });
});

test("unsupported methods including HEAD perform no availability or auth work", async () => {
  const f = fixture({ available() { throw new Error("PRIVATE_CANARY"); }, query: async () => { throw new Error("PRIVATE_CANARY"); } });
  for (const method of ["POST", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
    const response = await f.handle(incoming({ method })); expect(response.status).toBe(405); privacy(response);
    expect(response.headers.get("allow")).toBe("GET");
    if (method === "HEAD") expect(await response.text()).toBe("");
    else expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "method_not_allowed" } });
  }
  expect(f.counts()).toEqual({ calls: 0, checks: 0 });
});

test("a closed feature returns fixed 503 for GET without querying or reading request data", async () => {
  const f = fixture({ available: () => false });
  const request = incoming(); Object.defineProperty(request, "url", { get() { throw new Error("PRIVATE_CANARY"); } });
  const response = await f.handle(request); expect(response.status).toBe(503);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } }); expect(f.counts().calls).toBe(0);
});

test("origin and browser fetch metadata are checked before a session query", async () => {
  const f = fixture();
  for (const options of [{ url: "https://www.aicharts.io/api/usage/days?firstUtcDay=10&dayCount=1" },
    { url: "https://foreign.example/api/usage/days?firstUtcDay=10&dayCount=1", headers: { "x-forwarded-host": "aicharts.io" } },
    { headers: { origin: "https://foreign.example" } }, { headers: { "sec-fetch-site": "cross-site" } },
    { headers: { "sec-fetch-site": "same-site" } }, { headers: { "sec-fetch-site": "none" } }] as Parameters<typeof incoming>[0][]) {
    const response = await f.handle(incoming(options)); expect(response.status).toBe(403);
    expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "request_rejected" } });
  }
  const missing = incoming(); missing.headers.delete("sec-fetch-site"); expect((await f.handle(missing)).status).toBe(403);
  expect(f.counts().calls).toBe(0);
});

test("exact URL, query and GET framing refuse arbitrary identity and upload input", async () => {
  const f = fixture();
  for (const options of [{ url: PRIVATE_DAYS_PUBLIC_URL }, { url: `${PRIVATE_DAYS_PUBLIC_URL}/?firstUtcDay=10&dayCount=1` },
    { url: `${PRIVATE_DAYS_PUBLIC_URL}?dayCount=1&firstUtcDay=10` }, { url: `${PRIVATE_DAYS_PUBLIC_URL}?firstUtcDay=10&dayCount=1&accountId=PRIVATE_CANARY` },
    { url: `${PRIVATE_DAYS_PUBLIC_URL}?firstUtcDay=10&dayCount=1&dayCount=1` }, { url: `${PRIVATE_DAYS_PUBLIC_URL}?firstUtcDay=10&dayCount=1#fragment` },
    { url: `${PRIVATE_DAYS_PUBLIC_URL}?${"x".repeat(300)}` }, { headers: { authorization: "Bearer PRIVATE_CANARY" } },
    { headers: { "content-type": "application/json" } }, { headers: { "content-encoding": "gzip" } },
    { headers: { "transfer-encoding": "chunked" } }, { headers: { "content-length": "1" } }, { headers: { accept: "*/*" } }] as Parameters<typeof incoming>[0][]) {
    const response = await f.handle(incoming(options)); expect(response.status).toBe(400);
    expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "invalid_request" } });
  }
  let pulls = 0; const request = incoming();
  Object.defineProperty(request, "body", { value: new ReadableStream({ pull() { pulls++; } }, { highWaterMark: 0 }) });
  expect((await f.handle(request)).status).toBe(400); expect(pulls).toBe(0); expect(f.counts().calls).toBe(0);
});

test("only a checked authentication-required outcome becomes 401", async () => {
  const f = fixture({ query: async () => ({ kind: "authentication_required" }) });
  const response = await f.handle(incoming()); expect(response.status).toBe(401);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "authentication_required" } });
  for (const raw of [null, { kind: "unavailable" }, { kind: "authentication_required", email: "PRIVATE_CANARY" },
    { kind: "query", result: { ok: true, value, extra: "PRIVATE_CANARY" } }, { kind: "query", result: { ok: true, value: { ...value, coverage: "complete" } } },
    ...["invalid_input", "unauthorized", "expired", "recovery_required", "clock_regressed", "storage_invalid", "storage_unavailable"]
      .map(error => ({ kind: "query", result: { ok: false, error } }))]) {
    const g = fixture({ query: async () => raw }); const reply = await g.handle(incoming()); expect(reply.status).toBe(503);
    expect(await result(reply)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  }
});

test("feature closure, abort and thrown service failures suppress every late outcome", async () => {
  for (const raw of [ready, { kind: "authentication_required" }]) {
    let available = true;
    const f = fixture({ available: () => available, query: async () => { available = false; return raw; } });
    expect((await f.handle(incoming())).status).toBe(503);
  }
  const controller = new AbortController();
  const aborted = fixture({ query: async () => { controller.abort(); return ready; } });
  expect((await aborted.handle(incoming({ signal: controller.signal }))).status).toBe(503);
  const thrown = fixture({ query: async () => { throw new Error("PRIVATE_CANARY"); } });
  const response = await thrown.handle(incoming()); expect(response.status).toBe(503);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
});
