import { expect, mock, test } from "bun:test";
import { statsFixture } from "./stats-contract.test";
import { readPrivateStats } from "./stats-client";
import { parseStatsPublicSearch, STATS_ACCOUNT_HEADER, STATS_PUBLIC_MAX_BYTES, STATS_PUBLIC_MEDIA, STATS_PUBLIC_URL } from "./stats-public";
mock.module("server-only", () => ({}));
const { createStatsPublicHandler } = await import("./stats-route");
const range = { firstUtcDay: 20_715, dayCount: 1 };
const value = { ...statsFixture(), revision: 1, updatedAtMs: 20_716 * 86_400_000 };
const accountId = `acct_${"a".repeat(32)}`;
const ready = { kind: "query", accountId, result: { ok: true, value } };
const request = (headers: Record<string, string> = {}, url = `${STATS_PUBLIC_URL}?firstUtcDay=20715&dayCount=1`, method = "GET") => new Request(url, { method, headers: { accept: "application/json", "sec-fetch-site": "same-origin", ...headers } });

test("public query spelling consumes the whole input and uses the hosted byte ceiling", () => {
  expect(parseStatsPublicSearch("?firstUtcDay=20715&dayCount=1")).toEqual(range);
  for (const suffix of ["\n", "\r", "\r\n", "&accountId=private", " "]) {
    expect(parseStatsPublicSearch(`?firstUtcDay=20715&dayCount=1${suffix}`)).toBeNull();
  }
  expect(STATS_PUBLIC_MAX_BYTES).toBe(4 * 1024 * 1024 + 128);
});

test("hosted stats bind the authenticated account result to the requested range", async () => {
  let calls = 0;
  const handle = createStatsPublicHandler({ available: () => true, async query(_req, actual) { calls++; expect(actual).toEqual(range); return ready; } });
  const response = await handle(request());
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get(STATS_ACCOUNT_HEADER)).toBe(accountId);
  expect(response.headers.has("access-control-expose-headers")).toBe(false);
  expect(response.headers.get("vary")).toBe("Cookie"); expect(await response.json()).toEqual({ schemaVersion: 2, ok: true, value });
  for (const req of [request({ origin: "https://foreign.example" }), request({ authorization: "Bearer PRIVATE_CANARY" }),
    request({}, `${STATS_PUBLIC_URL}?firstUtcDay=20715&dayCount=1&accountId=PRIVATE_CANARY`), request({ "sec-fetch-site": "cross-site" }), request({}, undefined, "HEAD")]) {
    expect((await handle(req)).status).toBeGreaterThanOrEqual(400);
  }
  expect(calls).toBe(1);
});
test("closed features and late closures never expose an authenticated result", async () => {
  let available = false, calls = 0;
  const handle = createStatsPublicHandler({ available: () => available, async query() { calls++; available = false; return ready; } });
  expect((await handle(request())).status).toBe(503); expect(calls).toBe(0);
  available = true; const response = await handle(request());
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("rows");
});
test("invalid or private service failures become a fixed safe response", async () => {
  for (const result of [null, { kind: "authentication_required", email: "PRIVATE_CANARY" }, { kind: "query", accountId, result: { ok: true, value: { ...value, dayCount: 2 } } },
    { kind: "query", result: { ok: true, value } }, { ...ready, accountId: "PRIVATE_CANARY" },
    { kind: "query", accountId, result: { ok: false, error: "PRIVATE_CANARY" } }]) {
    const handle = createStatsPublicHandler({ available: () => true, query: async () => result });
    const response = await handle(request()); expect(response.status).toBe(503); expect(await response.text()).toBe('{"schemaVersion":2,"ok":false,"error":"unavailable"}');
  }
});
test("client checks range, revision, media, length and HTTP envelope consistency", async () => {
  const good = { schemaVersion: 2, ok: true, value } as const;
  const fetcher = (body: unknown, status = 200, headers: Record<string, string> = {}) => (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(input).toBe("/api/usage/stats?firstUtcDay=20715&dayCount=1"); expect(init?.credentials).toBe("same-origin"); expect(init?.redirect).toBe("error");
    return new Response(JSON.stringify(body), { status, headers: { "content-type": STATS_PUBLIC_MEDIA, [STATS_ACCOUNT_HEADER]: accountId, ...headers } });
  }) as typeof fetch;
  const read = (f: typeof fetch) => readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal, f);
  expect(await read(fetcher(good))).toEqual({ ...good, accountId });
  for (const f of [fetcher(good, 401), fetcher(good, 200, { "content-length": "1" }), fetcher(good, 200, { "content-length": String(STATS_PUBLIC_MAX_BYTES + 1) }), fetcher(good, 200, { "content-type": "text/html" }),
    fetcher({ ...good, value: statsFixture() }), fetcher({ ...good, value: { ...value, firstUtcDay: 20_716 } }), fetcher({ ...good, privateField: "PRIVATE_CANARY" })]) {
    expect(await read(f)).toEqual({ schemaVersion: 2, ok: false, error: "unavailable" });
  }
  const controller = new AbortController(); controller.abort(); let called = false;
  await readPrivateStats(20_715, 1, controller.signal, (async () => { called = true; throw new Error("PRIVATE"); }) as unknown as typeof fetch); expect(called).toBe(false);
});

test("a successful report without one canonical acquisition account is refused", async () => {
  for (const identity of [null, "", "acct_PRIVATE", `acct_${"A".repeat(32)}`, `acct_${"a".repeat(16)} ${"a".repeat(16)}`, `${accountId},${accountId}`]) {
    const headers = new Headers({ "content-type": STATS_PUBLIC_MEDIA });
    if (identity !== null) headers.set(STATS_ACCOUNT_HEADER, identity);
    const read = await readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal,
      (async () => new Response(JSON.stringify({ schemaVersion: 2, ok: true, value }), { headers })) as unknown as typeof fetch);
    expect(read).toEqual({ schemaVersion: 2, ok: false, error: "unavailable" });
  }
});
