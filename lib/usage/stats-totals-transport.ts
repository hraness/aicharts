import "server-only";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS } from "./pairing-http-contract";
import { pairingHttpWork } from "./pairing-http-work";
import { usageWorkloadToken, type StatsSessionScope, type StatsTransportDependencies } from "./stats-transport";
import { decodeStatsTotalsResponse, encodeStatsTotalsRequest, parseStatsTotalsQuery, statsTotalsHttpLength,
  STATS_TOTALS_RESPONSE_BYTES, STATS_TOTALS_URL, type StatsTotalsResult } from "./stats-totals-contract";
import { usageWorkerCall, verifyUsageSession, type UsageWorkerPort, type VerifiedUsageAccount } from "./usage-worker-read";

export type StatsTotalsTransportOutcome = Readonly<{ kind: "query"; accountId: string; result: StatsTotalsResult }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("stats_totals_transport_unavailable");
const failed = (): StatsTotalsTransportOutcome => Object.freeze({ kind: "unavailable" });

/** Lifetime totals for an account this request already verified. */
export async function readUsageTotalsForAccount(port: UsageWorkerPort, account: VerifiedUsageAccount): Promise<StatsTotalsTransportOutcome> {
  const query = parseStatsTotalsQuery({ schemaVersion: 2, accountId: account.suiteAccountId, sessionExpiresAtMs: account.expiresAtMs });
  if (query === null) throw unavailable();
  const encoded = encodeStatsTotalsRequest(query);
  if (encoded === null) throw unavailable();
  const result = await usageWorkerCall(port, { url: STATS_TOTALS_URL, body: encoded, expiresAtMs: query.sessionExpiresAtMs,
    maxBytes: STATS_TOTALS_RESPONSE_BYTES, kind: "read", length: headers => statsTotalsHttpLength(headers, STATS_TOTALS_RESPONSE_BYTES),
    decode: bytes => decodeStatsTotalsResponse(bytes) });
  return Object.freeze({ kind: "query", accountId: query.accountId, result });
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
      const token = usageWorkloadToken(getContext());
      if (token === null || outstanding >= PAIRING_HTTP_CAPACITY) throw unavailable();
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
        const guard = () => {
          work.guard();
          if (request.signal.aborted || available() !== true || session.current() !== true) throw unavailable();
          work.guard();
        };
        guard();
        const verified = await verifyUsageSession(work, guard, session);
        if (verified.kind === "authentication_required") return verified;
        return readUsageTotalsForAccount({ work, guard, sample, fetch: fetcher, setTimeout, token }, verified.account);
      }, startedAt);
    } catch { return failed(); }
  };
}
