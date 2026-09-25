import { expect, mock, test } from "bun:test";
import { decodeStatsTotalsPublicReply, STATS_TOTALS_PUBLIC_MEDIA, STATS_TOTALS_PUBLIC_URL, STATS_TOTALS_ACCOUNT_HEADER } from "./stats-totals-public";
import type { StatsTotals } from "./stats-totals-contract";
mock.module("server-only", () => ({}));
const { createStatsTotalsPublicHandler } = await import("./stats-totals-route");
const accountId = `acct_${"a".repeat(32)}`;
const tokens = { input: "18", cacheRead: "5", cacheWrite: "6", output: "10", reasoning: "1" };
const cell = { records: 3, days: 3, firstUtcDay: 20_000, lastUtcDay: 20_003, tokens };
const totals: StatsTotals = { schemaVersion: 2, generatedAtMs: 1_000, revision: 4, updatedAtMs: 900, legacyRevision: 2, legacyVerifiedRevision: 2, legacyComplete: true,
  total: cell, clients: [{ client: "codex", basis: "snapshots", ...cell }],
  devices: [{ deviceId: "1".repeat(64), enrolledAtMs: 10, revokedAtMs: null, ...cell, clients: [{ client: "codex", basis: "snapshots", ...cell }] }] };
const incoming = (options: RequestInit = {}, url = STATS_TOTALS_PUBLIC_URL) => new Request(url, {
  ...options, headers: { accept: "application/json", "sec-fetch-site": "same-origin", ...options.headers },
});
async function reply(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe(STATS_TOTALS_PUBLIC_MEDIA);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  for (const name of ["set-cookie", "location", "etag", "access-control-allow-origin"]) expect(response.headers.has(name)).toBe(false);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const value = decodeStatsTotalsPublicReply(bytes); expect(value).not.toBeNull(); return value!;
}

test("GET returns the verified account's totals, binds the account header and maps refusals", async () => {
  const outcomes = [
    { raw: { kind: "query", accountId, result: { ok: true, value: totals } }, status: 200, body: { schemaVersion: 2, ok: true, value: totals }, header: accountId },
    { raw: { kind: "query", accountId, result: { ok: false, error: "not_enrolled" } }, status: 200, body: { schemaVersion: 2, ok: false, error: "not_enrolled" }, header: accountId },
    { raw: { kind: "query", accountId, result: { ok: false, error: "storage_unavailable" } }, status: 503, body: { schemaVersion: 2, ok: false, error: "unavailable" }, header: null },
    { raw: { kind: "authentication_required" }, status: 401, body: { schemaVersion: 2, ok: false, error: "authentication_required" }, header: null },
    { raw: { kind: "unavailable" }, status: 503, body: { schemaVersion: 2, ok: false, error: "unavailable" }, header: null },
    { raw: { kind: "query", accountId, result: { ok: true, value: { ...totals, secret: "PRIVATE_CANARY" } } }, status: 503, body: { schemaVersion: 2, ok: false, error: "unavailable" }, header: null },
  ];
  for (const outcome of outcomes) {
    let reads = 0;
    const handle = createStatsTotalsPublicHandler({ available: () => true, query: async () => { reads++; return outcome.raw; } });
    const response = await handle(incoming({ headers: { cookie: "PRIVATE_CANARY" } }));
    expect(response.status).toBe(outcome.status);
    expect(response.headers.get(STATS_TOTALS_ACCOUNT_HEADER)).toBe(outcome.header);
    const body = await reply(response); expect(body).toEqual(outcome.body as typeof body); expect(JSON.stringify(body)).not.toContain("PRIVATE_CANARY"); expect(reads).toBe(1);
  }
});

test("method, origin, framing and exact path reject before any live read", async () => {
  let reads = 0;
  const handle = createStatsTotalsPublicHandler({ available: () => true, query: async () => { reads++; return { kind: "query", accountId, result: { ok: true, value: totals } }; } });
  for (const method of ["HEAD", "POST", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
    const response = await handle(incoming({ method })); expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
  }
  for (const url of [STATS_TOTALS_PUBLIC_URL + "?accountId=" + accountId, STATS_TOTALS_PUBLIC_URL + "/", STATS_TOTALS_PUBLIC_URL + "#x"]) {
    expect((await handle(incoming({}, url))).status).toBe(400);
  }
  const invalid: Record<string, string>[] = [{ authorization: "Bearer PRIVATE_CANARY" }, { "content-type": "application/json" }, { "content-encoding": "gzip" }, { accept: "*/*" }];
  for (const headers of invalid) {
    expect((await handle(incoming({ headers }))).status).toBe(400);
  }
  const rejected: Record<string, string>[] = [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
  for (const headers of rejected) {
    expect((await handle(incoming({ headers }))).status).toBe(403);
  }
  expect(reads).toBe(0);
  const closed = createStatsTotalsPublicHandler({ available: () => false, query: async () => { reads++; return {}; } });
  expect((await closed(incoming())).status).toBe(503); expect(reads).toBe(0);
});
