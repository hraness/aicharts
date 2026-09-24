import "server-only";
import { privateDaysSnapshot } from "./private-days-http-contract";
import {
  PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS, PAIRING_HTTP_MEDIA, PAIRING_HTTP_STAGE_MS,
  pairingHttpBody, pairingHttpDiscard, pairingHttpToken,
} from "./pairing-http-contract";
import { pairingHttpWork } from "./pairing-http-work";
import type { StatsSessionScope, StatsTransportDependencies } from "./stats-transport";
import { decodeStatsTotalsResponse, encodeStatsTotalsRequest, parseStatsTotalsQuery, statsTotalsHttpLength,
  STATS_TOTALS_RESPONSE_BYTES, STATS_TOTALS_URL, type StatsTotalsQuery, type StatsTotalsResult } from "./stats-totals-contract";

export type StatsTotalsTransportOutcome = Readonly<{ kind: "query"; accountId: string; result: StatsTotalsResult }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("stats_totals_transport_unavailable");
const failed = (): StatsTotalsTransportOutcome => Object.freeze({ kind: "unavailable" });
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

/** No product input at all: the account and expiry come from one live
 * Accounts read, exactly as the windowed report transport derives them. */
export function createStatsTotalsTransport(dependencies: StatsTransportDependencies) {
  const { fetch: fetcher, getContext, registerLifetime, beginSession, available, now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;
  return async (request: Request): Promise<StatsTotalsTransportOutcome> => {
    try {
      if (available() !== true) return failed();
      const startedAt = now();
      if (request.signal.aborted) throw unavailable();
      const token = ownValue(ownValue(getContext(), "headers"), "x-vercel-oidc-token");
      if (!pairingHttpToken(token) || outstanding >= PAIRING_HTTP_CAPACITY) throw unavailable();
      outstanding++;
      let observed = startedAt;
      const sample = () => {
        const current = now();
        if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) throw unavailable();
        observed = current; return current;
      };
      return await pairingHttpWork<StatsTotalsTransportOutcome>({ ...effects, now: sample }, PAIRING_HTTP_CLIENT_MS, registerLifetime, failed, () => { outstanding--; }, async work => {
        const session: StatsSessionScope | null = beginSession(request);
        if (session === null) throw unavailable();
        work.onStop(() => { session.finish(); });
        let query: StatsTotalsQuery | null = null;
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
        query = parseStatsTotalsQuery({ schemaVersion: 2, accountId: account.suiteAccountId, sessionExpiresAtMs: account.expiresAtMs });
        if (query === null) throw unavailable();
        const captured = query, encoded = encodeStatsTotalsRequest(captured);
        if (encoded === null) throw unavailable();
        const controller = new AbortController(); work.onStop(() => { controller.abort(); });
        guard();
        const response = await fetcher(STATS_TOTALS_URL, { method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", authorization: `Bearer ${token}` },
          body: encoded, redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal,
        });
        let reading = false;
        try {
          guard();
          if (response.status !== 200 || response.url !== STATS_TOTALS_URL || response.redirected
            || response.headers.get("content-type") !== PAIRING_HTTP_MEDIA || response.headers.has("content-encoding")
            || response.headers.has("location") || response.headers.has("set-cookie")) throw unavailable();
          const length = statsTotalsHttpLength(response.headers, STATS_TOTALS_RESPONSE_BYTES);
          reading = true;
          const bytes = await pairingHttpBody(response.body, STATS_TOTALS_RESPONSE_BYTES, length, work);
          guard();
          const domain = decodeStatsTotalsResponse(bytes);
          if (domain === null) throw unavailable();
          guard(); return Object.freeze({ kind: "query", accountId: captured.accountId, result: domain });
        } finally { if (!reading) await pairingHttpDiscard(response); }
      }, startedAt);
    } catch { return failed(); }
  };
}
