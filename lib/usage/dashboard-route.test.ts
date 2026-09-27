import { expect, mock, test } from "bun:test";
import { decodeUsageAccountReply } from "./account-public";
import { decodeUsageConsentPublicReply } from "./consent-public";
import { decodeUsageDashboardFrame, USAGE_DASHBOARD_MEDIA, USAGE_DASHBOARD_URL, type UsageDashboardQuery } from "./dashboard-public";
import { parseUsageStatsReport } from "./stats-contract";
import { createUsageStatsExample } from "./stats-example";
import { parseStatsPublicReply } from "./stats-public";
import { decodeStatsTotalsPublicReply } from "./stats-totals-public";
import type { StatsTotals } from "./stats-totals-contract";
mock.module("server-only", () => ({}));
const { createUsageDashboardHandler, USAGE_DASHBOARD_REFRESH_LEAD_MS } = await import("./dashboard-route");

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`, observedAtMs = 1_800_000_000_000;
const tokens = { input: "18", cacheRead: "5", cacheWrite: "6", output: "10", reasoning: "1" };
const cell = { records: 3, days: 3, firstUtcDay: 20_000, lastUtcDay: 20_003, tokens };
const totals: StatsTotals = { schemaVersion: 2, generatedAtMs: 1_000, revision: 4, updatedAtMs: 900, legacyRevision: 2, legacyVerifiedRevision: 2, legacyComplete: true,
  total: cell, clients: [{ client: "codex", basis: "snapshots", ...cell }],
  devices: [{ deviceId: "1".repeat(64), enrolledAtMs: 10, revokedAtMs: null, ...cell, clients: [{ client: "codex", basis: "snapshots", ...cell }] }] };
const example = createUsageStatsExample(20_789);
const report = parseUsageStatsReport({ ...example, revision: 1, updatedAtMs: example.generatedAtMs })!;
const range = { firstUtcDay: report.firstUtcDay, dayCount: report.dayCount };
const search = `?parts=account.totals.consent.stats&firstUtcDay=${range.firstUtcDay}&dayCount=${range.dayCount}`;
const consentView = { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null } as const;
const incoming = (options: RequestInit = {}, url = `${USAGE_DASHBOARD_URL}${search}`) => new Request(url, {
  ...options, headers: { accept: USAGE_DASHBOARD_MEDIA, "sec-fetch-site": "same-origin", ...options.headers },
});
const ready = (overrides: Record<string, unknown> = {}) => ({
  kind: "query", accountId: A, expiresAtMs: observedAtMs + 900_000, observedAtMs,
  totals: { kind: "query", accountId: A, result: { ok: true, value: totals } },
  consent: { kind: "query", accountId: A, result: { ok: true, value: consentView } },
  stats: { kind: "query", accountId: A, result: { ok: true, value: report } }, ...overrides,
});
async function frame(response: Response) {
  expect(response.headers.get("content-type")).toBe(USAGE_DASHBOARD_MEDIA);
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
  for (const name of ["set-cookie", "location", "etag", "access-control-allow-origin"]) expect(response.headers.has(name)).toBe(false);
  const decoded = decodeUsageDashboardFrame(new Uint8Array(await response.arrayBuffer()));
  expect(decoded).not.toBeNull(); return decoded!;
}

test("one verified read returns every part with its standalone body, status and account binding", async () => {
  const seen: UsageDashboardQuery[] = [];
  const handle = createUsageDashboardHandler({ available: () => true, query: async (_request, query) => { seen.push(query); return ready(); } });
  const response = await handle(incoming());
  expect(response.status).toBe(200);
  const decoded = await frame(response);
  expect(seen).toEqual([{ parts: ["account", "totals", "consent", "stats"], range }]);
  if (decoded.kind !== "ready") throw new Error("expected a ready frame");
  expect(decoded.accountId).toBe(A);
  expect(decoded.sessionRefreshInMs).toBe(900_000 - USAGE_DASHBOARD_REFRESH_LEAD_MS);
  expect(decoded.parts.map(part => [part.part, part.status])).toEqual([["account", 200], ["totals", 200], ["consent", 200], ["stats", 200]]);
  const [account, total, consent, stats] = decoded.parts;
  expect(decodeUsageAccountReply(account!.bytes)).toEqual({ schemaVersion: 1, state: "ready", account: { accountId: A } });
  expect(decodeStatsTotalsPublicReply(total!.bytes)).toEqual({ schemaVersion: 2, ok: true, value: totals });
  expect(decodeUsageConsentPublicReply(consent!.bytes)).toEqual({ schemaVersion: 1, state: "ready", value: consentView });
  expect(parseStatsPublicReply(JSON.parse(new TextDecoder().decode(stats!.bytes)), range)).toEqual({ schemaVersion: 2, ok: true, value: report });
});

test("one failing part is reported on its own while the others stay ready", async () => {
  const handle = createUsageDashboardHandler({ available: () => true, query: async () => ready({
    totals: { kind: "unavailable" },
    consent: { kind: "query", accountId: A, result: { ok: false, error: "not_enrolled" } },
    stats: { kind: "query", accountId: A, result: { ok: false, error: "limit" } },
  }) });
  const decoded = await frame(await handle(incoming()));
  if (decoded.kind !== "ready") throw new Error("expected a ready frame");
  expect(decoded.parts.map(part => [part.part, part.status])).toEqual([["account", 200], ["totals", 503], ["consent", 200], ["stats", 413]]);
  expect(decodeStatsTotalsPublicReply(decoded.parts[1]!.bytes)).toEqual({ schemaVersion: 2, ok: false, error: "unavailable" });
  expect(decodeUsageConsentPublicReply(decoded.parts[2]!.bytes)).toEqual({ schemaVersion: 1, state: "not_enrolled" });
});

test("session refusal, outages and any part bound to another account fail the whole reply", async () => {
  const cases: [unknown, number, string][] = [
    [{ kind: "authentication_required" }, 401, "authentication_required"], [{ kind: "unavailable" }, 503, "unavailable"],
    [ready({ totals: { kind: "query", accountId: B, result: { ok: true, value: totals } } }), 503, "unavailable"],
    [ready({ stats: { kind: "query", accountId: B, result: { ok: false, error: "not_started" } } }), 503, "unavailable"],
    [ready({ accountId: "acct_x" }), 503, "unavailable"], [ready({ expiresAtMs: observedAtMs }), 503, "unavailable"],
    [{ ...ready(), extra: true }, 503, "unavailable"], [(() => { const missing: Record<string, unknown> = ready(); delete missing.consent; return missing; })(), 503, "unavailable"],
    [ready({ consent: { kind: "query", accountId: A, result: { ok: false, error: "handle_unavailable" } } }), 503, "unavailable"],
  ];
  for (const [outcome, status, error] of cases) {
    const response = await createUsageDashboardHandler({ available: () => true, query: async () => outcome })(incoming());
    expect(response.status).toBe(status); expect(await frame(response)).toEqual({ kind: "error", error } as never);
  }
});

test("the session refresh delay is clamped to the token lifetime and never negative", async () => {
  for (const [lifetime, expected] of [[5_000, 0], [USAGE_DASHBOARD_REFRESH_LEAD_MS, 0], [60_000, 60_000 - USAGE_DASHBOARD_REFRESH_LEAD_MS], [10 * 86_400_000, 86_400_000]] as const) {
    const decoded = await frame(await createUsageDashboardHandler({ available: () => true,
      query: async () => ready({ expiresAtMs: observedAtMs + lifetime }) })(incoming()));
    expect(decoded.kind === "ready" ? decoded.sessionRefreshInMs : null).toBe(expected);
  }
});

test("method, origin, framing and canonical search reject before any live read", async () => {
  let calls = 0;
  const handle = createUsageDashboardHandler({ available: () => true, query: async () => { calls++; return ready(); } });
  const cases: [Request, number][] = [
    [incoming({ method: "POST" }), 405], [incoming({ headers: { "sec-fetch-site": "cross-site" } }), 403],
    [incoming({ headers: { origin: "https://foreign.example" } }), 403], [incoming({ headers: { accept: "application/json" } }), 400],
    [incoming({ headers: { authorization: "Bearer a.b.c" } }), 400], [incoming({}, `${USAGE_DASHBOARD_URL}?parts=stats`), 400],
    [incoming({}, `${USAGE_DASHBOARD_URL}?parts=totals.account`), 400], [incoming({}, `https://aicharts.io/api/usage/dashboard/${search}`), 400],
    [incoming({}, `https://foreign.example/api/usage/dashboard${search}`), 403], [incoming({}, `${USAGE_DASHBOARD_URL}${search}&x=${"1".repeat(200)}`), 400],
  ];
  for (const [request, status] of cases) {
    const response = await handle(request);
    expect(response.status).toBe(status); expect((await frame(response)).kind).toBe("error");
  }
  const closed = await createUsageDashboardHandler({ available: () => false, query: async () => { calls++; return ready(); } })(incoming());
  expect(closed.status).toBe(503); expect(calls).toBe(0);
  const head = await handle(incoming({ method: "HEAD" })); expect(head.status).toBe(405); expect(await head.text()).toBe("");
});

test("an abort or a closed flag after the read suppresses a late ready reply", async () => {
  const controller = new AbortController();
  let open = true;
  const aborted = await createUsageDashboardHandler({ available: () => true, query: async () => { controller.abort(); return ready(); } })(incoming({ signal: controller.signal }));
  expect(aborted.status).toBe(503);
  const closed = await createUsageDashboardHandler({ available: () => open, query: async () => { open = false; return ready(); } })(incoming());
  expect(closed.status).toBe(503);
});
