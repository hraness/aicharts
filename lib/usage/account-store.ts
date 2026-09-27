import {
  adoptUsageAccountReply, captureUsageAccountRead, currentUsageAccountRead, currentUsageAccountScope,
  invalidateUsageAccountGeneration, subscribeUsageAccountInvalidation, type UsageAccountScope,
} from "./account-generation";
import type { UsageAccountReply } from "./account-public";
import { readAccountDashboard, settleUsageAccountSession } from "./account-read-client";
import { subscribeUsageAccountLifecycle } from "./account-session-events";
import type { UsageConsentReadReply } from "./consent-client";
import type { UsageDashboardRead, UsageDashboardStatsBody } from "./dashboard-client";
import { parseUsageDashboardQuery, USAGE_DASHBOARD_PARTS, type UsageDashboardPart } from "./dashboard-public";
import { MetricReportSession, type HostedStatsSessionReply, type MetricWorkerFactory } from "./metric-explorer-session";
import { disposeStatsReadReply, MAX_STATS_READ_MS } from "./stats-client";
import type { StatsRange } from "./stats-http-contract";
import type { StatsTotalsReadReply } from "./stats-totals-client";

/** One tab's private read model. Reads issued together become one request, the
 * reply is accepted in the identity it establishes, and accepted replies stay
 * in memory for this account generation only: nothing is persisted, and every
 * sign-out, refusal, identity change or page suspension drops all of it. */
export type UsageAccountPart = "account" | "totals" | "consent";
type Replies = Readonly<{ account: UsageAccountReply; totals: StatsTotalsReadReply; consent: UsageConsentReadReply }>;
export type UsageAccountBound<T> = Readonly<{ reply: T; scope: UsageAccountScope | null }>;
/** `fresh` is for explicit user actions (retry, refresh, check status): it
 * always asks the server, and its answer replaces what is stored. */
export type UsageAccountReadOptions = Readonly<{ signal: AbortSignal; current(): boolean; onAuthenticationRequired?(): void; fresh?: boolean }>;
/** "revalidated" follows a background read that replaced stored replies;
 * "restored" follows a suspension that cleared every private view. */
export type UsageAccountRefreshReason = "revalidated" | "restored";

/** A stored reply answers reads without the network for this long. */
export const USAGE_ACCOUNT_FRESH_MS = 30_000;
/** Older stored replies still render at once while a background read replaces them. */
export const USAGE_ACCOUNT_STALE_MS = 15 * 60_000;
const STATS_RANGES = 3;
const SESSION_SETTLE_MS = 15_000;
const RETRIES_AFTER_STALE = 1;

type Entry<T> = Readonly<{ reply: T; scope: UsageAccountScope; at: number }>;
type Settled = Readonly<{ kind: "ready"; read: Extract<UsageDashboardRead, { kind: "ready" }>; scope: UsageAccountScope }>
  | Readonly<{ kind: "unavailable" }> | null;
type Waiter = { readonly part: UsageDashboardPart; readonly range: StatsRange | null; readonly options: UsageAccountReadOptions;
  attempts: number; settle(result: Settled): void };
type Batch = { readonly parts: Set<UsageDashboardPart>; range: StatsRange | null; readonly waiters: Waiter[]; readonly background: boolean };

type Ports = NonNullable<Parameters<typeof readAccountDashboard>[2]> & Readonly<{ now?: () => number }>;
let ports: Ports = {};
const clock = () => (ports.now ?? Date.now)();
const entries: { account?: Entry<UsageAccountReply>; totals?: Entry<StatsTotalsReadReply>; consent?: Entry<UsageConsentReadReply> } = {};
const statsEntries = new Map<string, Entry<UsageDashboardStatsBody>>();
const refreshListeners = new Set<Readonly<{ listener: (reason: UsageAccountRefreshReason) => void }>>();
let queued: Batch[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundInFlight = false;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
let renewAt: number | null = null;
let installed = false;

const rangeKey = (range: StatsRange) => `${range.firstUtcDay}:${range.dayCount}`;
const sameRange = (left: StatsRange | null, right: StatsRange | null) => left !== null && right !== null && rangeKey(left) === rangeKey(right);
const unavailableReply: Replies = Object.freeze({
  account: Object.freeze({ schemaVersion: 1, error: Object.freeze({ code: "unavailable" }) }),
  totals: Object.freeze({ schemaVersion: 2, ok: false, error: "unavailable", accountId: null }),
  consent: Object.freeze({ schemaVersion: 1, error: Object.freeze({ code: "unavailable" }) }),
} as const);
const statsUnavailable = Object.freeze({ schemaVersion: 2, ok: false, error: "unavailable" } as const);

function clear(): void {
  delete entries.account; delete entries.totals; delete entries.consent; statsEntries.clear();
}
function cancelSession(): void {
  if (sessionTimer !== null) clearTimeout(sessionTimer);
  sessionTimer = null; renewAt = null;
}
function emitRefresh(reason: UsageAccountRefreshReason): void {
  for (const { listener } of [...refreshListeners]) {
    try { listener(reason); } catch { /* One view cannot prevent sibling refresh. */ }
  }
}
function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}
function install(): void {
  if (installed) return;
  installed = true;
  subscribeUsageAccountInvalidation(reason => {
    // Every invalidation retires the stored scope; an adoption re-stores after this.
    clear();
    if (reason === "confirmed-signout" || reason === "authentication-required") cancelSession();
  });
  subscribeUsageAccountLifecycle(event => {
    if (event === "restored") { emitRefresh("restored"); return; }
    void (async () => {
      // A token that lapsed while hidden is renewed first, so the revalidation
      // below is not refused and retried.
      if (renewAt !== null && clock() >= renewAt) {
        cancelSession();
        await settleUsageAccountSession(AbortSignal.timeout(SESSION_SETTLE_MS), ports);
      }
      revalidate(false);
    })();
  });
}

/** Renew shortly before the access token expires while this page is visible,
 * then read again to learn the next deadline. A hidden page waits for "visible". */
function scheduleSession(delay: number): void {
  cancelSession();
  if (!Number.isSafeInteger(delay) || delay < 0) return;
  renewAt = clock() + delay;
  sessionTimer = setTimeout(() => {
    sessionTimer = null;
    if (!visible()) return;
    void (async () => {
      renewAt = null;
      if (await settleUsageAccountSession(AbortSignal.timeout(SESSION_SETTLE_MS), ports)) revalidate(true);
    })();
  }, delay);
}

function lookup(part: UsageDashboardPart, range: StatsRange | null): Readonly<{ entry: Entry<unknown>; fresh: boolean }> | null {
  const entry: Entry<unknown> | undefined = part === "stats" ? (range === null ? undefined : statsEntries.get(rangeKey(range))) : entries[part];
  if (entry === undefined || !currentUsageAccountScope(entry.scope)) return null;
  const age = clock() - entry.at;
  if (age < 0 || age > USAGE_ACCOUNT_STALE_MS) return null;
  if (part === "stats" && range !== null) { statsEntries.delete(rangeKey(range)); statsEntries.set(rangeKey(range), entry as Entry<UsageDashboardStatsBody>); }
  return Object.freeze({ entry, fresh: age <= USAGE_ACCOUNT_FRESH_MS });
}

function store(read: Extract<UsageDashboardRead, { kind: "ready" }>, scope: UsageAccountScope): void {
  const at = clock();
  if (read.account !== undefined && "account" in read.account) entries.account = Object.freeze({ reply: read.account, scope, at });
  if (read.totals !== undefined && read.totals.accountId === scope.accountId) entries.totals = Object.freeze({ reply: read.totals, scope, at });
  if (read.consent !== undefined && "accountId" in read.consent && read.consent.accountId === scope.accountId
    && !("error" in read.consent)) entries.consent = Object.freeze({ reply: read.consent, scope, at });
  if (read.stats !== undefined && read.stats.accountId === scope.accountId) {
    const key = rangeKey(read.stats.range);
    statsEntries.delete(key); statsEntries.set(key, Object.freeze({ reply: read.stats, scope, at }));
    while (statsEntries.size > STATS_RANGES) statsEntries.delete(statsEntries.keys().next().value!);
  }
}

function enqueue(waiter: Waiter): void {
  let batch = queued.find(candidate => !candidate.background
    && (waiter.part !== "stats" || candidate.range === null || sameRange(candidate.range, waiter.range)));
  if (batch === undefined) { batch = { parts: new Set(), range: null, waiters: [], background: false }; queued.push(batch); }
  batch.parts.add(waiter.part);
  if (waiter.part === "stats") batch.range = waiter.range;
  batch.waiters.push(waiter);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    const ready = queued; queued = [];
    for (const next of ready) void run(next);
  }, 0);
}

/** Answer from memory when this generation holds the part, else join the next batch. */
function request(waiter: Waiter): void {
  if (waiter.options.signal.aborted || !waiter.options.current()) { waiter.settle(null); return; }
  const hit = waiter.options.fresh === true ? null : lookup(waiter.part, waiter.range);
  if (hit !== null) {
    const read = { kind: "ready", accountId: hit.entry.scope.accountId, sessionRefreshInMs: 0, [waiter.part]: hit.entry.reply } as unknown as Extract<UsageDashboardRead, { kind: "ready" }>;
    waiter.settle(Object.freeze({ kind: "ready", read, scope: hit.entry.scope }));
    if (!hit.fresh) revalidate(false);
    return;
  }
  enqueue(waiter);
}

async function run(batch: Batch): Promise<void> {
  const query = parseUsageDashboardQuery({ parts: USAGE_DASHBOARD_PARTS.filter(part => batch.parts.has(part)), range: batch.parts.has("stats") ? batch.range : null });
  if (query === null) { for (const waiter of batch.waiters) waiter.settle({ kind: "unavailable" }); return; }
  const ticket = captureUsageAccountRead(), controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), MAX_STATS_READ_MS);
  const abandoned = () => { if (!batch.background && batch.waiters.every(waiter => waiter.options.signal.aborted)) controller.abort(); };
  for (const waiter of batch.waiters) waiter.options.signal.addEventListener("abort", abandoned, { once: true });
  let read: UsageDashboardRead | null = null;
  try {
    read = await readAccountDashboard(query, controller.signal, { ...ports, onAuthenticationRequired: () => {
      for (const waiter of batch.waiters) { try { waiter.options.onAuthenticationRequired?.(); } catch { /* View cleanup is best effort. */ } }
    } });
  } catch { read = null; }
  finally {
    clearTimeout(deadline);
    for (const waiter of batch.waiters) waiter.options.signal.removeEventListener("abort", abandoned);
  }
  const retry = () => {
    for (const waiter of batch.waiters) {
      if (waiter.attempts >= RETRIES_AFTER_STALE) { waiter.settle(null); continue; }
      waiter.attempts++; request(waiter);
    }
  };
  if (read === null || (read.kind === "error" && read.error !== "authentication_required")) {
    // A foreground reader sees its part as unavailable; a background refresh
    // leaves every view exactly as it was.
    for (const waiter of batch.waiters) waiter.settle({ kind: "unavailable" });
    return;
  }
  if (read.kind === "error") {
    // A refusal for an older generation says nothing about the current one.
    if (!currentUsageAccountRead(ticket)) { retry(); return; }
    // A settled refusal clears every private view and its stored replies.
    invalidateUsageAccountGeneration("authentication-required");
    for (const waiter of batch.waiters) waiter.settle(null);
    return;
  }
  // Adoption decides staleness: it accepts this reply's own generation, or the
  // identity-less generation the current identity was adopted from.
  const accepted = adoptUsageAccountReply(ticket, read.accountId);
  if (accepted.kind !== "accepted") { retry(); return; }
  store(read, accepted.scope);
  scheduleSession(read.sessionRefreshInMs);
  for (const waiter of batch.waiters) waiter.settle(Object.freeze({ kind: "ready", read, scope: accepted.scope }));
  if (batch.background) emitRefresh("revalidated");
}

/** Background replacement of what views are showing. Nothing is cleared first;
 * only a successful read (or a definite refusal) reaches the views. */
function revalidate(force: boolean): void {
  if (backgroundInFlight || !visible()) return;
  const now = clock(), stale = (entry: Entry<unknown> | undefined) => entry !== undefined && currentUsageAccountScope(entry.scope)
    && (force || now - entry.at > USAGE_ACCOUNT_FRESH_MS);
  const parts = new Set<UsageDashboardPart>();
  for (const part of ["account", "totals", "consent"] as const) if (stale(entries[part])) parts.add(part);
  const latest = [...statsEntries.values()].at(-1);
  if (stale(latest)) parts.add("stats");
  if (parts.size === 0) return;
  backgroundInFlight = true;
  void run({ parts, range: parts.has("stats") ? latest!.reply.range : null, waiters: [], background: true })
    .finally(() => { backgroundInFlight = false; });
}

function waitFor(part: UsageDashboardPart, range: StatsRange | null, options: UsageAccountReadOptions): Promise<Settled> {
  install();
  return new Promise(resolve => {
    let done = false;
    const settle = (result: Settled) => {
      if (done) return;
      done = true; options.signal.removeEventListener("abort", aborted); resolve(result);
    };
    const aborted = () => settle(null);
    options.signal.addEventListener("abort", aborted, { once: true });
    // Look up after the current task: a view that re-reads from inside an
    // adoption's own notification then finds the replies that adoption stores.
    queueMicrotask(() => { if (!done) request({ part, range, options, attempts: 0, settle }); });
  });
}

/** Same contract as readInUsageAccountGeneration: null once the caller is
 * stale, aborted or refused (a refusal has already cleared every view). */
export async function readUsageAccountPart<P extends UsageAccountPart>(part: P, options: UsageAccountReadOptions): Promise<UsageAccountBound<Replies[P]> | null> {
  const settled = await waitFor(part, null, options);
  if (settled === null || options.signal.aborted || !options.current()) return null;
  if (settled.kind === "unavailable") return Object.freeze({ reply: unavailableReply[part], scope: null });
  const reply = settled.read[part] as Replies[P] | undefined;
  if (reply === undefined) return Object.freeze({ reply: unavailableReply[part], scope: null });
  const bound = part === "account" ? "account" in reply : "accountId" in reply && reply.accountId === settled.scope.accountId;
  return Object.freeze({ reply, scope: bound && currentUsageAccountScope(settled.scope) ? settled.scope : null });
}

/** The windowed report: hosted bytes are shared, but each caller receives its
 * own report session from the private worker and owns its disposal. */
export async function readUsageAccountStats(range: StatsRange, options: UsageAccountReadOptions & Readonly<{ workerFactory?: MetricWorkerFactory }>): Promise<UsageAccountBound<HostedStatsSessionReply> | null> {
  const settled = await waitFor("stats", range, options);
  if (settled === null || options.signal.aborted || !options.current()) return null;
  if (settled.kind === "unavailable" || settled.read.stats === undefined) return Object.freeze({ reply: statsUnavailable, scope: null });
  let reply: HostedStatsSessionReply;
  try {
    const { body, status, accountId } = settled.read.stats;
    reply = await MetricReportSession.openHosted({ body, status, accountId, range }, options.signal, options.workerFactory);
  } catch { return options.signal.aborted || !options.current() ? null : Object.freeze({ reply: statsUnavailable, scope: null }); }
  if (options.signal.aborted || !options.current()) { disposeStatsReadReply(reply); return null; }
  const bound = reply.accountId === settled.scope.accountId && currentUsageAccountScope(settled.scope);
  return Object.freeze({ reply, scope: bound ? settled.scope : null });
}

/** Views re-read on this signal; stored replies answer at once. */
export function subscribeUsageAccountRefresh(listener: (reason: UsageAccountRefreshReason) => void): () => void {
  install();
  const subscription = Object.freeze({ listener });
  refreshListeners.add(subscription);
  return () => { refreshListeners.delete(subscription); };
}

/** A confirmed consent decision replaces the stored status for its own scope. */
export function storeUsageAccountConsent(reply: UsageConsentReadReply, scope: UsageAccountScope): void {
  if (!currentUsageAccountScope(scope) || "error" in reply || reply.accountId !== scope.accountId) return;
  entries.consent = Object.freeze({ reply, scope, at: clock() });
}

/** Test port: forget every stored reply, batch and timer, and install fixed ports. */
export function resetUsageAccountStoreForTests(next: Ports = {}): void {
  ports = next; clear(); cancelSession(); queued = []; backgroundInFlight = false;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
}
