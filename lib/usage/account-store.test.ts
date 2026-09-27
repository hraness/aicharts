import { afterEach, beforeEach, expect, test } from "bun:test";
import { captureUsageAccountRead, currentUsageAccountScope, invalidateUsageAccountGeneration, subscribeUsageAccountInvalidation,
  type UsageAccountInvalidationReason } from "./account-generation";
import {
  readUsageAccountPart, readUsageAccountStats, resetUsageAccountStoreForTests, storeUsageAccountConsent, subscribeUsageAccountRefresh,
  USAGE_ACCOUNT_FRESH_MS, USAGE_ACCOUNT_STALE_MS,
} from "./account-store";
import { retainUsageAccountLifecycle } from "./account-session-events";
import { encodeUsageDashboardFrame, parseUsageDashboardSearch, USAGE_DASHBOARD_MEDIA, type UsageDashboardFramePart,
  type UsageDashboardPart } from "./dashboard-public";
import { TestMetricWorker } from "./metric-explorer-test-worker";

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`;
const range = { firstUtcDay: 20_700, dayCount: 30 };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const consentView = { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null };
const tokens = { input: "18", cacheRead: "5", cacheWrite: "6", output: "10", reasoning: "1" };
const cell = { records: 3, days: 3, firstUtcDay: 20_000, lastUtcDay: 20_003, tokens };
const totals = { schemaVersion: 2, generatedAtMs: 1_000, revision: 4, updatedAtMs: 900, legacyRevision: 2, legacyVerifiedRevision: 2, legacyComplete: true,
  total: cell, clients: [{ client: "codex", basis: "snapshots", ...cell }],
  devices: [{ deviceId: "1".repeat(64), enrolledAtMs: 10, revokedAtMs: null, ...cell, clients: [{ client: "codex", basis: "snapshots", ...cell }] }] };

type Server = { account: string; status: number; down: ReadonlySet<UsageDashboardPart>; session: "signed_in" | "signed_out"; refreshInMs: number };
function harness(initial: Partial<Server> = {}) {
  const server: Server = { account: A, status: 200, down: new Set(), session: "signed_in", refreshInMs: 600_000, ...initial };
  const requests: string[] = [];
  let now = 1_800_000_000_000;
  const part = (name: UsageDashboardPart): UsageDashboardFramePart => {
    const down = server.down.has(name);
    if (name === "account") return { part: name, status: 200, bytes: encode({ schemaVersion: 1, state: "ready", account: { accountId: server.account } }) };
    if (name === "totals") return { part: name, status: down ? 503 : 200, bytes: encode(down ? { schemaVersion: 2, ok: false, error: "unavailable" } : { schemaVersion: 2, ok: true, value: totals }) };
    if (name === "consent") return { part: name, status: down ? 503 : 200, bytes: encode(down ? { schemaVersion: 1, error: { code: "unavailable" } } : { schemaVersion: 1, state: "ready", value: consentView }) };
    return { part: name, status: down ? 503 : 200, bytes: encode({ schemaVersion: 2, ok: false, error: down ? "unavailable" : "not_started" }) };
  };
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input); requests.push(url);
    if (url === "/api/suite-auth/session") return Response.json({ kind: server.session === "signed_in" ? "refresh_required" : "signed_out" });
    if (url === "/api/suite-auth/refresh") {
      // A renewed token is what the private read was waiting for.
      if (server.session === "signed_in" && server.status === 401) server.status = 200;
      return Response.json(server.session === "signed_in" ? { kind: "signed_in", session: {} } : { kind: "signed_out" });
    }
    const query = parseUsageDashboardSearch(url.slice("/api/usage/dashboard".length));
    if (query === null) throw new Error(`unexpected request ${url}`);
    const frame = server.status === 200
      ? encodeUsageDashboardFrame({ kind: "ready", accountId: server.account, sessionRefreshInMs: server.refreshInMs, parts: query.parts.map(part) })
      : encodeUsageDashboardFrame({ kind: "error", error: server.status === 401 ? "authentication_required" : "unavailable" });
    return new Response(frame, { status: server.status, headers: { "content-type": USAGE_DASHBOARD_MEDIA } });
  }) as typeof globalThis.fetch;
  resetUsageAccountStoreForTests({ fetch, withExclusiveLock: null, transientRetryDelayMs: 1, now: () => now });
  const live = { signal: new AbortController().signal, current: () => true };
  return {
    server, requests, live, dashboards: () => requests.filter(url => url.startsWith("/api/usage/dashboard")),
    advance: (ms: number) => { now += ms; },
    stats: () => readUsageAccountStats(range, { ...live, workerFactory: () => new TestMetricWorker() }),
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => { invalidateUsageAccountGeneration("confirmed-signout"); });
afterEach(() => { resetUsageAccountStoreForTests(); });

test("reads issued together become one request and are accepted in the identity it establishes, in one round", async () => {
  const h = harness();
  const reasons: UsageAccountInvalidationReason[] = [];
  const stop = subscribeUsageAccountInvalidation(reason => { reasons.push(reason); });
  try {
    const [account, total, consent, stats] = await Promise.all([readUsageAccountPart("account", h.live), readUsageAccountPart("totals", h.live),
      readUsageAccountPart("consent", h.live), h.stats()]);
    expect(h.dashboards()).toEqual([`/api/usage/dashboard?parts=account,totals,consent,stats&firstUtcDay=${range.firstUtcDay}&dayCount=${range.dayCount}`]);
    expect(reasons).toEqual(["identity-changed"]);
    for (const bound of [account, total, consent, stats]) { expect(bound?.scope?.accountId).toBe(A); expect(currentUsageAccountScope(bound!.scope!)).toBe(true); }
    expect(account?.reply).toEqual({ schemaVersion: 1, state: "ready", account: { accountId: A } });
    expect(total?.reply).toMatchObject({ ok: true, accountId: A }); expect(consent?.reply).toMatchObject({ state: "ready", accountId: A });
    expect(stats?.reply).toEqual({ schemaVersion: 2, ok: false, error: "not_started", accountId: A });
  } finally { stop(); }
});

test("stored replies answer revisits instantly; a stale one renders at once while one background read replaces it", async () => {
  const h = harness();
  await Promise.all([readUsageAccountPart("account", h.live), readUsageAccountPart("totals", h.live)]);
  expect(h.dashboards()).toHaveLength(1);
  h.advance(USAGE_ACCOUNT_FRESH_MS);
  expect((await readUsageAccountPart("totals", h.live))?.scope?.accountId).toBe(A); expect(h.dashboards()).toHaveLength(1);
  let refreshed = 0;
  const stop = subscribeUsageAccountRefresh(() => { refreshed++; });
  try {
    h.advance(1);
    const stale = await readUsageAccountPart("totals", h.live);
    expect(stale?.scope?.accountId).toBe(A);
    await settle();
    expect(h.dashboards()).toEqual([expect.any(String), "/api/usage/dashboard?parts=account,totals"]);
    expect(refreshed).toBe(1);
    h.advance(USAGE_ACCOUNT_STALE_MS + 1);
    await readUsageAccountPart("account", h.live);
    expect(h.dashboards()).toHaveLength(3);
  } finally { stop(); }
});

test("a failed background read keeps what views show; a foreground read of the same part reports it unavailable", async () => {
  const h = harness();
  await readUsageAccountPart("totals", h.live);
  let refreshed = 0;
  const stop = subscribeUsageAccountRefresh(() => { refreshed++; });
  try {
    h.server.status = 503; h.advance(USAGE_ACCOUNT_FRESH_MS + 1);
    const shown = await readUsageAccountPart("totals", h.live);
    expect(shown?.reply).toMatchObject({ ok: true, accountId: A });
    await settle(); await settle();
    expect(refreshed).toBe(0);
    // The stored reply is still served while it lies inside the stale window.
    expect((await readUsageAccountPart("totals", h.live))?.reply).toMatchObject({ ok: true });
  } finally { stop(); }
  resetUsageAccountStoreForTests(); invalidateUsageAccountGeneration("confirmed-signout");
  const cold = harness({ status: 503 });
  expect(await readUsageAccountPart("totals", cold.live)).toEqual({ reply: { schemaVersion: 2, ok: false, error: "unavailable", accountId: null }, scope: null });
  expect(cold.dashboards()).toHaveLength(3);
});

test("one part that fails stays unavailable on its own and is never stored", async () => {
  const h = harness({ down: new Set(["totals", "stats"]) });
  const [account, total, stats] = await Promise.all([readUsageAccountPart("account", h.live), readUsageAccountPart("totals", h.live), h.stats()]);
  expect(account?.scope?.accountId).toBe(A);
  expect(total).toEqual({ reply: { schemaVersion: 2, ok: false, error: "unavailable", accountId: null }, scope: null });
  expect(stats).toEqual({ reply: { schemaVersion: 2, ok: false, error: "unavailable" }, scope: null });
  h.server.down = new Set();
  expect((await readUsageAccountPart("totals", h.live))?.scope?.accountId).toBe(A);
  expect(h.dashboards()).toEqual([expect.stringContaining("parts=account,totals,stats"), "/api/usage/dashboard?parts=totals"]);
});

test("a settled refusal renews once, then clears every view and stored reply", async () => {
  const h = harness();
  await readUsageAccountPart("totals", h.live);
  h.server.status = 401; h.server.session = "signed_out";
  const reasons: UsageAccountInvalidationReason[] = [];
  const stop = subscribeUsageAccountInvalidation(reason => { reasons.push(reason); });
  let cleared = 0;
  try {
    h.advance(USAGE_ACCOUNT_STALE_MS + 1);
    expect(await readUsageAccountPart("totals", { ...h.live, onAuthenticationRequired: () => { cleared++; } })).toBeNull();
    expect(reasons).toEqual(["authentication-required"]); expect(cleared).toBe(1);
    expect(h.requests.filter(url => url.startsWith("/api/suite-auth"))).toEqual(["/api/suite-auth/session"]);
  } finally { stop(); }
  h.server.status = 200; h.server.session = "signed_in";
  await readUsageAccountPart("totals", h.live);
  expect(h.dashboards()).toHaveLength(3);
});

test("an expired token renews through the shared session protocol and the same batch is read once more", async () => {
  const h = harness({ status: 401 });
  expect((await readUsageAccountPart("account", h.live))?.scope?.accountId).toBe(A);
  expect(h.dashboards()).toHaveLength(2);
  expect(h.requests.filter(url => url.startsWith("/api/suite-auth"))).toEqual(["/api/suite-auth/session", "/api/suite-auth/session", "/api/suite-auth/refresh"]);
});

test("an identity switch replaces stored replies, and old-identity entries never answer the new generation", async () => {
  const h = harness();
  const first = await readUsageAccountPart("account", h.live);
  h.server.account = B; h.advance(USAGE_ACCOUNT_STALE_MS + 1);
  const second = await readUsageAccountPart("account", h.live);
  expect(second?.scope?.accountId).toBe(B); expect(currentUsageAccountScope(first!.scope!)).toBe(false);
  expect(second?.reply).toEqual({ schemaVersion: 1, state: "ready", account: { accountId: B } });
});

test("suspension clears stored replies, a restore asks views to read again, and 'visible' revalidates only stale replies", async () => {
  const originals = ["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const target = new EventTarget(), page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  const release = retainUsageAccountLifecycle();
  let refreshed = 0;
  const stop = subscribeUsageAccountRefresh(() => { refreshed++; });
  try {
    const h = harness();
    await readUsageAccountPart("account", h.live);
    page.dispatchEvent(new Event("visibilitychange")); target.dispatchEvent(new Event("focus")); await settle();
    expect(h.dashboards()).toHaveLength(1);
    h.advance(USAGE_ACCOUNT_FRESH_MS + 1);
    page.dispatchEvent(new Event("visibilitychange")); await settle();
    expect(h.dashboards()).toHaveLength(2); expect(refreshed).toBe(1);
    const ticket = captureUsageAccountRead();
    target.dispatchEvent(new Event("pagehide"));
    expect(captureUsageAccountRead().generation).not.toBe(ticket.generation);
    const restored = new Event("pageshow"); Object.defineProperty(restored, "persisted", { value: true });
    target.dispatchEvent(restored); expect(refreshed).toBe(2);
    await readUsageAccountPart("account", h.live);
    expect(h.dashboards()).toHaveLength(3);
  } finally {
    stop(); release();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("a confirmed consent decision replaces the stored status only inside its own scope", async () => {
  const h = harness();
  const read = await readUsageAccountPart("consent", h.live);
  const published = { schemaVersion: 1, state: "ready", value: { schemaVersion: 1, consent: true, consentedAtMs: 1, publicHandle: "reader" }, accountId: A } as const;
  storeUsageAccountConsent(published, read!.scope!);
  expect((await readUsageAccountPart("consent", h.live))?.reply).toEqual(published);
  invalidateUsageAccountGeneration("lifecycle");
  storeUsageAccountConsent(published, read!.scope!);
  await readUsageAccountPart("consent", h.live);
  expect(h.dashboards()).toHaveLength(2);
});

test("aborted or superseded readers settle without a reply and never keep a batch alive", async () => {
  const h = harness();
  const controller = new AbortController();
  const pending = readUsageAccountPart("account", { signal: controller.signal, current: () => true });
  controller.abort();
  expect(await pending).toBeNull();
  let current = true;
  const superseded = readUsageAccountPart("totals", { signal: new AbortController().signal, current: () => current });
  current = false;
  expect(await superseded).toBeNull();
  await settle();
  expect(h.dashboards().length).toBeLessThanOrEqual(1);
});

test("different stats ranges in one tick use separate reads; a stored range is reused", async () => {
  const h = harness();
  const other = { firstUtcDay: 20_723, dayCount: 7 };
  await Promise.all([h.stats(), readUsageAccountStats(other, { ...h.live, workerFactory: () => new TestMetricWorker() })]);
  expect(h.dashboards().sort()).toEqual([`/api/usage/dashboard?parts=stats&firstUtcDay=20700&dayCount=30`,
    `/api/usage/dashboard?parts=stats&firstUtcDay=20723&dayCount=7`].sort());
  expect((await h.stats())?.scope?.accountId).toBe(A); expect(h.dashboards()).toHaveLength(2);
});
