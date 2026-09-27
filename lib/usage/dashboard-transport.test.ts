import { expect, mock, test } from "bun:test";
import { encodeUsageConsentHttpResponse, USAGE_CONSENT_HTTP_URL } from "./consent-http-contract";
import { PAIRING_HTTP_COLD_READ_RETRY_MS, PAIRING_HTTP_MEDIA } from "./pairing-http-contract";
import { decodeStatsHttpRequest, encodeStatsHttpResponse, STATS_HTTP_URL } from "./stats-http-contract";
import { encodeStatsTotalsResponse, STATS_TOTALS_URL } from "./stats-totals-contract";
mock.module("server-only", () => ({}));
const { createUsageDashboardTransport } = await import("./dashboard-transport");

const A = `acct_${"a".repeat(32)}`, now = 1_800_000_000_000;
const all = { parts: ["account", "totals", "consent", "stats"], range: { firstUtcDay: 20_000, dayCount: 7 } } as const;
function worker(url: string, status = 200, body?: Uint8Array<ArrayBuffer>) {
  const response = new Response(status === 200 ? body : null, { status, headers: status === 200 ? { "content-type": PAIRING_HTTP_MEDIA } : {} });
  Object.defineProperty(response, "url", { value: url }); return response;
}
function fixture(options: { outcome?: unknown; stats?: boolean; fail?: string; cold?: string } = {}) {
  const calls: string[] = []; let reads = 0; const terminals: Promise<void>[] = []; const seen = new Map<string, number>();
  const run = createUsageDashboardTransport({ available: () => true, statsAvailable: () => options.stats ?? true, now: () => now,
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds === PAIRING_HTTP_COLD_READ_RETRY_MS ? 0 : milliseconds),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    getContext: () => ({ headers: { "x-vercel-oidc-token": "a.b.c" } }), registerLifetime: terminal => { terminals.push(terminal); },
    beginSession: () => ({ read: async () => null, current: () => true, finish() {},
      readOutcome: async () => { reads++; return Object.hasOwn(options, "outcome") ? options.outcome : { kind: "authenticated", value: { suiteAccountId: A, expiresAtMs: now + 60_000 } }; } }),
    fetch: async (input, init) => {
      const url = String(input); calls.push(url); seen.set(url, (seen.get(url) ?? 0) + 1);
      if (url === options.fail) return worker(url, 500);
      if (url === options.cold && seen.get(url) === 1) return worker(url, 503);
      if (url === STATS_HTTP_URL) return worker(url, 200, encodeStatsHttpResponse(decodeStatsHttpRequest(init?.body), { ok: false, error: "not_started" })!);
      if (url === STATS_TOTALS_URL) return worker(url, 200, encodeStatsTotalsResponse({ ok: false, error: "not_enrolled" })!);
      return worker(url, 200, encodeUsageConsentHttpResponse({ ok: false, error: "not_enrolled" })!);
    },
  });
  return { run, calls, reads: () => reads, settle: () => Promise.all(terminals) };
}
const request = () => new Request("https://aicharts.io/api/usage/dashboard");

test("one Accounts read serves every requested Worker read for the same verified account", async () => {
  const f = fixture();
  const outcome = await f.run(request(), all); await f.settle();
  expect(f.reads()).toBe(1);
  expect([...f.calls].sort()).toEqual([STATS_HTTP_URL, STATS_TOTALS_URL, USAGE_CONSENT_HTTP_URL].sort());
  expect(outcome).toEqual({ kind: "query", accountId: A, expiresAtMs: now + 60_000, observedAtMs: now,
    totals: { kind: "query", accountId: A, result: { ok: false, error: "not_enrolled" } },
    consent: { kind: "query", accountId: A, result: { ok: false, error: "not_enrolled" } },
    stats: { kind: "query", accountId: A, result: { ok: false, error: "not_started" } } });
});

test("only the requested parts reach the Worker, and the account part needs none", async () => {
  const f = fixture();
  expect(await f.run(request(), { parts: ["account"], range: null })).toEqual({ kind: "query", accountId: A, expiresAtMs: now + 60_000, observedAtMs: now });
  expect(f.calls).toEqual([]);
  const g = fixture();
  const outcome = await g.run(request(), { parts: ["account", "stats"], range: all.range });
  expect(g.calls).toEqual([STATS_HTTP_URL]); expect(Object.keys(outcome).sort()).toEqual(["accountId", "expiresAtMs", "kind", "observedAtMs", "stats"]);
});

test("a failed part is isolated, a cold part rides out one retry, and closed stats flags skip the Worker", async () => {
  const f = fixture({ fail: STATS_TOTALS_URL, cold: STATS_HTTP_URL });
  const outcome = await f.run(request(), all); await f.settle();
  expect(outcome).toMatchObject({ kind: "query", totals: { kind: "unavailable" },
    stats: { kind: "query", accountId: A, result: { ok: false, error: "not_started" } } });
  expect(f.calls.filter(url => url === STATS_HTTP_URL)).toHaveLength(2);
  const closed = fixture({ stats: false });
  expect(await closed.run(request(), all)).toMatchObject({ totals: { kind: "unavailable" }, stats: { kind: "unavailable" },
    consent: { kind: "query", accountId: A } });
  expect(closed.calls).toEqual([USAGE_CONSENT_HTTP_URL]);
});

test("refused, failed or expired sessions and malformed queries never reach the Worker", async () => {
  for (const outcome of [{ kind: "authentication_required" }, { kind: "unavailable" }, { kind: "authenticated", value: { suiteAccountId: A, expiresAtMs: now } },
    { kind: "authenticated", value: { suiteAccountId: "acct_x", expiresAtMs: now + 60_000 } }, null]) {
    const f = fixture({ outcome });
    expect(await f.run(request(), all)).toEqual(outcome !== null && typeof outcome === "object" && outcome.kind === "authentication_required"
      ? { kind: "authentication_required" } : { kind: "unavailable" });
    expect(f.calls).toEqual([]);
  }
  for (const query of [{ parts: ["stats"], range: null }, { parts: [], range: null }, { parts: ["totals", "account"], range: null }, null]) {
    const f = fixture();
    expect(await f.run(request(), query)).toEqual({ kind: "unavailable" }); expect(f.reads()).toBe(0);
  }
});
