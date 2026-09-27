import "server-only";
import { runUsageConsentForAccount, type UsageConsentTransportOutcome } from "./consent-transport";
import { parseUsageDashboardQuery } from "./dashboard-public";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS } from "./pairing-http-contract";
import { pairingHttpWork } from "./pairing-http-work";
import { readUsageStatsForAccount, usageWorkloadToken, type StatsTransportDependencies, type StatsTransportOutcome } from "./stats-transport";
import { readUsageTotalsForAccount, type StatsTotalsTransportOutcome } from "./stats-totals-transport";
import { verifyUsageSession, type UsageWorkerPort } from "./usage-worker-read";

export interface UsageDashboardTransportDependencies extends StatsTransportDependencies {
  /** Stats and totals keep their own flag; the account and consent need only private reads. */
  statsAvailable(): boolean;
}
export type UsageDashboardTransportOutcome =
  | Readonly<{ kind: "query"; accountId: string; expiresAtMs: number; observedAtMs: number;
      totals?: StatsTotalsTransportOutcome; consent?: UsageConsentTransportOutcome; stats?: StatsTransportOutcome }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;
const unavailable = () => new Error("usage_dashboard_transport_unavailable");
const failed = (): UsageDashboardTransportOutcome => Object.freeze({ kind: "unavailable" });
const partFailed = Object.freeze({ kind: "unavailable" } as const);

/** One live Accounts read for the whole request, then each requested Worker read
 * in parallel for that same verified account. A part that fails is reported as
 * unavailable on its own; a session, fence or deadline failure fails the request. */
export function createUsageDashboardTransport(dependencies: UsageDashboardTransportDependencies) {
  const { fetch: fetcher, getContext, registerLifetime, beginSession, available, statsAvailable, now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;
  return async (request: Request, input: unknown): Promise<UsageDashboardTransportOutcome> => {
    try {
      if (available() !== true) return failed();
      const startedAt = now(), query = parseUsageDashboardQuery(input);
      if (query === null || request.signal.aborted) throw unavailable();
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
      return await pairingHttpWork<UsageDashboardTransportOutcome>({ ...effects, now: sample }, PAIRING_HTTP_CLIENT_MS, registerLifetime, failed, () => { outstanding--; }, async work => {
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
        const account = verified.account;
        if (account.expiresAtMs <= sample()) throw unavailable();
        const port: UsageWorkerPort = { work, guard, sample, fetch: fetcher, setTimeout, token };
        const wanted = (part: "totals" | "consent" | "stats") => query.parts.includes(part);
        const stats = statsAvailable() === true;
        const [totals, consent, report] = await Promise.all([
          !wanted("totals") ? undefined : stats ? readUsageTotalsForAccount(port, account).catch(() => partFailed) : partFailed,
          !wanted("consent") ? undefined : runUsageConsentForAccount(port, account, Object.freeze({ operation: "status" })).catch(() => partFailed),
          !wanted("stats") || query.range === null ? undefined : stats ? readUsageStatsForAccount(port, account, query.range).catch(() => partFailed) : partFailed,
        ]);
        guard();
        return Object.freeze({ kind: "query", accountId: account.suiteAccountId, expiresAtMs: account.expiresAtMs, observedAtMs: sample(),
          ...(totals === undefined ? {} : { totals }), ...(consent === undefined ? {} : { consent }), ...(report === undefined ? {} : { stats: report }) });
      }, startedAt);
    } catch { return failed(); }
  };
}
