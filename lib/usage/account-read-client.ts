import { broadcastSuiteOidcBrowserSignOut, loadSuiteOidcBrowserSession, signOutSuiteOidcBrowserSession, type SuiteOidcExclusiveLock } from "@hraness/suite-accounts/browser-session";
import { readUsageAccount } from "./account-client";
import { clearUsageAccountViews } from "./account-session-events";
import { readPrivateDays } from "./private-days-client";
import { readPrivateStats, disposeStatsReadReply, StatsReadDeadline } from "./stats-client";
import type { MetricWorkerFactory } from "./metric-explorer-session";
import { readUsageConsent } from "./consent-client";
import { readPrivateTotals } from "./stats-totals-client";
import type { PrivateDaysRange } from "./private-days-public";

type Options = Readonly<{
  fetch?: typeof fetch;
  /** Trusted test port; production leaves serialization with the SDK. */
  withExclusiveLock?: SuiteOidcExclusiveLock | null;
  /** Trusted test port; production uses the fixed settle delay. */
  transientRetryDelayMs?: number;
  /** Trusted test port; production uses the fixed freshness window. */
  sessionWarmMs?: number;
  onAuthenticationRequired?: () => void;
  /** Trusted test port; production uses the bundled private stats worker. */
  statsWorkerFactory?: MetricWorkerFactory;
  /** Carry the same expiry through account-generation retries. */
  statsDeadline?: StatsReadDeadline;
}>;
const unavailable = () => new Error("usage_unavailable");
const SESSION_BYTES = 32_768;
const TRANSIENT_RETRY_DELAY_MS = 1_500;
const SESSION_WARM_MS = 60_000;
const SESSION_WARM_BOUND_MS = 15_000;

/** The caller's existing deadline also covers waiting for the SDK's refresh
 * lock. A late lock owner still meets the fetch fence before any provider work. */
function untilAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(unavailable()); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void pending.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(unavailable()); else resolve(value);
    }, () => {
      signal.removeEventListener("abort", abort); reject(unavailable());
    });
  });
}

/** The SDK parses the session response, but its reader has no read-count or
 * caller-abort fence. Own a finite decoded stream before handing it over. */
async function sessionResponse(response: Response, signal: AbortSignal): Promise<Response> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    if (signal.aborted || response.redirected || response.body === null) throw unavailable();
    reader = response.body.getReader();
    const bytes = new Uint8Array(SESSION_BYTES);
    let length = 0;
    for (let reads = 0; reads <= SESSION_BYTES; reads++) {
      if (signal.aborted) throw unavailable();
      const chunk = await untilAbort(reader.read(), signal);
      if (chunk.done) { complete = true; break; }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0 || chunk.value.byteLength > SESSION_BYTES - length) throw unavailable();
      bytes.set(chunk.value, length); length += chunk.value.byteLength;
    }
    if (!complete || signal.aborted) throw unavailable();
    return new Response(bytes.subarray(0, length), { status: response.status, headers: response.headers });
  } finally {
    if (reader) {
      if (!complete) { try { await reader.cancel(); } catch { /* Browser owns disposal. */ } }
      reader.releaseLock();
    } else { try { await response.body?.cancel(); } catch { /* No response disclosure. */ } }
  }
}

function signedIn(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  // This envelope permits one fresh private read, never account authority.
  // The SDK's local session/account projection is neither retained nor used.
  return keys.length === 2 && keys.includes("kind") && keys.includes("session")
    && Reflect.get(value, "kind") === "signed_in" && Reflect.get(value, "session") !== null
    && typeof Reflect.get(value, "session") === "object" && !Array.isArray(Reflect.get(value, "session"));
}

function sessionLock(signal: AbortSignal, options: Options) {
  return options.withExclusiveLock ?? (options.withExclusiveLock !== null
    && typeof navigator !== "undefined" && navigator.locks !== undefined
    ? (name: string, task: () => Promise<unknown>) => navigator.locks.request(name, { mode: "exclusive", signal }, async () => {
      if (signal.aborted) throw unavailable();
      return task();
    }) : options.withExclusiveLock);
}

/** At most one SDK session protocol runs at a time; every private read that
 * needs authentication joins the same flight instead of serializing its own
 * status/refresh sequence behind the SDK lock. Joiners only observe the
 * settled projection — the owning caller's fetch, lock and signal drive it. */
let sessionFlight: Promise<unknown> | null = null;
let sessionCheckedAt = Number.NEGATIVE_INFINITY;
function beginSessionFlight(signal: AbortSignal, options: Options): { flight: Promise<unknown>; owner: boolean } {
  if (sessionFlight !== null) return { flight: sessionFlight, owner: false };
  const fetcher = options.fetch ?? globalThis.fetch;
  let calls = 0;
  const flight = untilAbort(loadSuiteOidcBrowserSession({
    withExclusiveLock: sessionLock(signal, options),
    fetch: async (input, init) => {
      if (signal.aborted) throw unavailable();
      // SDK protocol: initial status, locked status recheck, then at most one
      // refresh POST. No arbitrary target, headers, credentials or retry loop.
      const expected = calls < 2 ? "/api/suite-auth/session" : "/api/suite-auth/refresh";
      if (calls >= 3 || input !== expected || init?.method !== (calls < 2 ? "GET" : "POST")) throw unavailable();
      calls++;
      const response = await fetcher(input, { ...init, signal });
      return sessionResponse(response, signal);
    },
  }), signal).then(value => { sessionCheckedAt = Date.now(); return value; },
    () => { sessionCheckedAt = Date.now(); return null; });
  sessionFlight = flight;
  void flight.then(() => { if (sessionFlight === flight) sessionFlight = null; });
  return { flight, owner: true };
}

/** Best-effort session freshness check so a needed renewal overlaps the
 * optimistic private read instead of serializing behind its refusal. Bounded,
 * never throws, and shares any recovery flight already running. */
export function warmUsageAccountSession(options: Options = {}): void {
  if (sessionFlight !== null || Date.now() - sessionCheckedAt < (options.sessionWarmMs ?? SESSION_WARM_MS)) return;
  try { beginSessionFlight(AbortSignal.timeout(SESSION_WARM_BOUND_MS), options); } catch { /* Best-effort warm only. */ }
}

/** One settle before a transient retry. The first attempt's server-side work
 * leaves the account object warm, so the retry is the fast path; a caller
 * abort still settles promptly instead of dispatching a stale read. */
async function settleTransient(signal: AbortSignal, options: Options): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); clearTimeout(timer); reject(unavailable()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); },
      options.transientRetryDelayMs ?? TRANSIENT_RETRY_DELAY_MS);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function recoverRead<T>(read: () => Promise<T>, needsAuthentication: (reply: T) => boolean,
  transient: (reply: T) => boolean, signal: AbortSignal, options: Options, dispose: (reply: T) => void = () => {}): Promise<T> {
  if (signal.aborted) throw unavailable();
  let owned: T | undefined;
  const deliver = (reply: T): T => { owned = undefined; return reply; };
  // A thrown transport failure and a refused reply's error value are the same
  // transient outcome here: both mark one bounded retry, never recursion.
  const attempt = async (): Promise<{ reply: T | undefined; transient: boolean }> => {
    if (owned !== undefined) { dispose(owned); owned = undefined; }
    try {
      const reply = await read();
      owned = reply;
      return { reply, transient: !signal.aborted && transient(reply) };
    } catch (error) {
      if (!signal.aborted && error instanceof Error && error.message === "usage_unavailable") {
        return { reply: undefined, transient: true };
      }
      throw error;
    }
  };
  try {
    let outcome = await attempt();
    if (signal.aborted) throw unavailable();
    if (outcome.reply !== undefined && needsAuthentication(outcome.reply)) {
      const first = outcome.reply;
      options.onAuthenticationRequired?.();
      if (signal.aborted) throw unavailable();
      try {
        let joined = beginSessionFlight(signal, options);
        let session = await untilAbort(joined.flight, signal);
        // A null settlement means the joined flight died with its owner; a mere
        // joiner may still drive one fresh protocol before giving up. A failed
        // owned flight and a signed_out answer are both definitive as-is.
        if (session === null && !joined.owner && !signal.aborted) {
          joined = beginSessionFlight(signal, options);
          session = await untilAbort(joined.flight, signal);
        }
        if (!signedIn(session)) return deliver(first);
      } catch {
        if (signal.aborted) throw unavailable();
        return deliver(first);
      }
      if (signal.aborted) throw unavailable();
      // Even an optimistic signed-in view must pass the original strict server
      // read. A second authentication failure returns as-is; it cannot recurse.
      outcome = await attempt();
      if (signal.aborted) throw unavailable();
    }
    if (outcome.transient) {
      await settleTransient(signal, options);
      outcome = await attempt();
      if (signal.aborted) throw unavailable();
    }
    if (outcome.reply === undefined) throw unavailable();
    return deliver(outcome.reply);
  } finally { if (owned !== undefined) dispose(owned); }
}

/** Browser recovery only. Private GET handlers remain read-only, and consent
 * mutations deliberately have no entry point here. */
export function readAccountDays(range: PrivateDaysRange, signal: AbortSignal, options: Options = {}) {
  return recoverRead(() => readPrivateDays(range, signal, options.fetch),
    reply => "error" in reply && reply.error.code === "authentication_required",
    reply => "error" in reply && reply.error.code === "unavailable", signal, options);
}
export async function readAccountStats(firstUtcDay: number, dayCount: number, signal: AbortSignal, options: Options = {}) {
  const deadline = new StatsReadDeadline(signal, options.statsDeadline);
  try {
    const reply = await recoverRead(() => readPrivateStats(firstUtcDay, dayCount, deadline.signal, options.fetch,
      { workerFactory: options.statsWorkerFactory, deadline }),
      reply => !reply.ok && reply.error === "authentication_required",
      reply => !reply.ok && reply.error === "unavailable", deadline.signal, options, disposeStatsReadReply);
    if (!deadline.active()) { disposeStatsReadReply(reply); throw unavailable(); }
    return reply;
  } finally { deadline.finish(); }
}
export function readAccountTotals(signal: AbortSignal, options: Options = {}) {
  return recoverRead(() => readPrivateTotals(signal, options.fetch),
    reply => !reply.ok && reply.error === "authentication_required",
    reply => !reply.ok && reply.error === "unavailable", signal, options);
}
export function readAccountConsent(signal: AbortSignal, options: Options = {}) {
  return recoverRead(() => readUsageConsent(signal, options.fetch),
    reply => "error" in reply && reply.error.code === "authentication_required",
    reply => "error" in reply && reply.error.code === "unavailable", signal, options);
}
export function readAccountSummary(signal: AbortSignal, options: Options = {}) {
  return recoverRead(() => readUsageAccount(signal, options.fetch),
    reply => "error" in reply && reply.error.code === "authentication_required",
    reply => "error" in reply && reply.error.code === "unavailable", signal, options);
}

/** Explicit user mutation, never replayed. SDK owns cookie custody and the same
 * refresh lock. The local fallback can join another operation: require this
 * call's actual sign-out POST before accepting its notification as success. */
export async function signOutUsageAccount(signal: AbortSignal, options: Options = {}): Promise<void> {
  if (signal.aborted) throw unavailable();
  const fetcher = options.fetch ?? globalThis.fetch;
  let calls = 0, confirmed = false;
  try {
    await untilAbort(signOutSuiteOidcBrowserSession({
      withExclusiveLock: sessionLock(signal, options),
      fetch: async (input, init) => {
        if (signal.aborted || calls !== 0 || input !== "/api/suite-auth/sign-out" || init?.method !== "POST") throw unavailable();
        calls++;
        return sessionResponse(await fetcher(input, { ...init, signal }), signal);
      },
      notifySignedOut: () => {
        if (signal.aborted || calls !== 1) throw unavailable();
        confirmed = true;
      },
    }), signal);
    if (!confirmed || signal.aborted) throw unavailable();
  } catch { throw unavailable(); }
  // The initiating tab does not receive its own BroadcastChannel event.
  clearUsageAccountViews();
  try { broadcastSuiteOidcBrowserSignOut(); } catch { /* Local custody has ended. */ }
}
