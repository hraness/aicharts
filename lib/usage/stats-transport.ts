import "server-only";
import type { UsageStatsReport } from "./stats-contract";
import { parseStatsQuery, type StatsRange } from "./stats-http-contract";
import {
  decodeStatsHttpResponse, encodeStatsHttpRequest, parseStatsRange, statsHttpLength,
  STATS_HTTP_RESPONSE_BYTES, STATS_HTTP_URL, type StatsResult,
} from "./stats-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, pairingHttpToken } from "./pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";
import { usageWorkerCall, verifyUsageSession, type UsageWorkerPort, type VerifiedUsageAccount } from "./usage-worker-read";

/** Trusted request-owned port: readOutcome() verifies the live Accounts session.
 * current() fences the exact configuration/authority across awaits; finish()
 * invalidates the scope without authorizing retries. No default port is installed. */
export interface StatsSessionScope {
  read(): Promise<unknown>;
  readOutcome(): Promise<unknown>;
  current(): boolean;
  finish(): void;
}
export interface StatsTransportDependencies extends PairingHttpEffects {
  available(): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getContext(): unknown;
  registerLifetime(terminal: Promise<void>): void;
  beginSession(request: Request): StatsSessionScope | null;
}
export type StatsTransportOutcome = Readonly<{ kind: "query"; accountId: string; result: StatsResult<UsageStatsReport> }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("stats_transport_unavailable");
const failed = (): StatsTransportOutcome => Object.freeze({ kind: "unavailable" });
export function usageWorkloadToken(context: unknown): string | null {
  const ownValue = (value: unknown, key: string): unknown => {
    if (value === null || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  };
  const token = ownValue(ownValue(context, "headers"), "x-vercel-oidc-token");
  return pairingHttpToken(token) ? token : null;
}

/** The windowed report for an account this request already verified. */
export async function readUsageStatsForAccount(port: UsageWorkerPort, account: VerifiedUsageAccount, range: StatsRange): Promise<StatsTransportOutcome> {
  const query = parseStatsQuery({ schemaVersion: 2, accountId: account.suiteAccountId,
    sessionExpiresAtMs: account.expiresAtMs, firstUtcDay: range.firstUtcDay, dayCount: range.dayCount });
  if (query === null) throw unavailable();
  const encoded = encodeStatsHttpRequest(query);
  if (encoded === null) throw unavailable();
  const result = await usageWorkerCall(port, { url: STATS_HTTP_URL, body: encoded, expiresAtMs: query.sessionExpiresAtMs,
    maxBytes: STATS_HTTP_RESPONSE_BYTES, kind: "read", length: headers => statsHttpLength(headers, STATS_HTTP_RESPONSE_BYTES),
    decode: bytes => decodeStatsHttpResponse(bytes, query) });
  return Object.freeze({ kind: "query", accountId: query.accountId, result });
}

/** Only the range comes from product input. No browser-supplied account or expiry. */
export function createStatsTransport(dependencies: StatsTransportDependencies) {
  const { fetch: fetcher, getContext, registerLifetime, beginSession, available, now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;
  return async (request: Request, input: unknown): Promise<StatsTransportOutcome> => {
    try {
      if (available() !== true) return failed();
      const startedAt = now(), range = parseStatsRange(input);
      if (range === null || request.signal.aborted) throw unavailable();
      // Capture only the actual platform request context, before the first await.
      const token = usageWorkloadToken(getContext());
      if (token === null || outstanding >= PAIRING_HTTP_CAPACITY) throw unavailable();
      outstanding++;
      let observed = startedAt;
      const sample = () => {
        const current = now();
        if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) throw unavailable();
        observed = current; return current;
      };
      const result = await pairingHttpWork<StatsTransportOutcome>({ ...effects, now: sample }, PAIRING_HTTP_CLIENT_MS, registerLifetime, failed, () => { outstanding--; }, async work => {
        const session = beginSession(request);
        if (session === null) throw unavailable();
        work.onStop(() => { session.finish(); });
        const guard = () => {
          work.guard();
          if (request.signal.aborted || available() !== true || session.current() !== true) throw unavailable();
          work.guard();
        };
        guard();
        const verified = await verifyUsageSession(work, guard, session);
        if (verified.kind === "authentication_required") return verified;
        return readUsageStatsForAccount({ work, guard, sample, fetch: fetcher, setTimeout, token }, verified.account, range);
      }, startedAt);
      return result;
    } catch { return failed(); }
  };
}
