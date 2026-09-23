import "server-only";
import type { UsageStatsReport } from "./stats-contract";
import { parseStatsQuery, type StatsQuery } from "./stats-http-contract";
import {
  decodeStatsHttpResponse, encodeStatsHttpRequest, parseStatsRange, statsHttpLength,
  STATS_HTTP_RESPONSE_BYTES, STATS_HTTP_URL, type StatsResult,
} from "./stats-http-contract";
import { privateDaysSnapshot } from "./private-days-http-contract";
import {
  PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, PAIRING_HTTP_MEDIA, PAIRING_HTTP_STAGE_MS,
  pairingHttpBody, pairingHttpDiscard, pairingHttpToken,
} from "./pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";

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
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
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
      const token = ownValue(ownValue(getContext(), "headers"), "x-vercel-oidc-token");
      if (!pairingHttpToken(token) || outstanding >= PAIRING_HTTP_CAPACITY) throw unavailable();
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
        let query: StatsQuery | null = null;
        const guard = () => {
          work.guard();
          if (request.signal.aborted || available() !== true || session.current() !== true || (query !== null && sample() >= query.sessionExpiresAtMs)) throw unavailable();
          work.guard();
        };
        guard();
        const raw = await work.stage(PAIRING_HTTP_STAGE_MS, () => session.readOutcome());
        guard();
        const negative = privateDaysSnapshot(raw, ["kind"]);
        if (negative?.kind === "authentication_required") { guard(); return Object.freeze({ kind: "authentication_required" }); }
        const authenticated = privateDaysSnapshot(raw, ["kind", "value"]);
        if (authenticated?.kind !== "authenticated") throw unavailable();
        const account = privateDaysSnapshot(authenticated.value, ["suiteAccountId", "expiresAtMs"]);
        if (account === null) throw unavailable();
        query = parseStatsQuery({ schemaVersion: 2, accountId: account.suiteAccountId,
          sessionExpiresAtMs: account.expiresAtMs, firstUtcDay: range.firstUtcDay, dayCount: range.dayCount });
        if (query === null) throw unavailable();
        const captured = query, encoded = encodeStatsHttpRequest(captured);
        if (encoded === null) throw unavailable();
        const controller = new AbortController(); work.onStop(() => { controller.abort(); });
        guard();
        const response = await fetcher(STATS_HTTP_URL, { method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", authorization: `Bearer ${token}` },
          body: encoded, redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal,
        });
        let reading = false;
        try {
          guard();
          if (response.status !== 200 || response.url !== STATS_HTTP_URL || response.redirected
            || response.headers.get("content-type") !== PAIRING_HTTP_MEDIA || response.headers.has("content-encoding")
            || response.headers.has("location") || response.headers.has("set-cookie")) throw unavailable();
          const length = statsHttpLength(response.headers, STATS_HTTP_RESPONSE_BYTES);
          reading = true;
          const bytes = await pairingHttpBody(response.body, STATS_HTTP_RESPONSE_BYTES, length, work);
          guard();
          const domain = decodeStatsHttpResponse(bytes, captured);
          if (domain === null) throw unavailable();
          guard(); return Object.freeze({ kind: "query", accountId: captured.accountId, result: domain });
        } finally { if (!reading) await pairingHttpDiscard(response); }
      }, startedAt);
      return result;
    } catch { return failed(); }
  };
}
