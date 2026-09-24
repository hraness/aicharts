import { expect, test } from "bun:test";
import { acceptUsageAccountReply, captureUsageAccountRead, currentUsageAccountScope, invalidateUsageAccountGeneration } from "./account-generation";
import { readInUsageAccountGeneration } from "./account-generation-read";
import { USAGE_ACCOUNT_HEADER } from "./account-public";
import { readPrivateDays, type PrivateDaysReadReply } from "./private-days-client";
import { readPrivateStats, type StatsReadReply } from "./stats-client";
import { TestMetricWorker } from "./metric-explorer-test-worker";
import { readUsageConsent, type UsageConsentReadReply } from "./consent-client";

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`;
const absent = { schemaVersion: 1, state: "not_enrolled" } as const;
const cases = [
  { name: "daily not enrolled", body: absent, status: 200, read: (fetcher: typeof fetch) => readPrivateDays({ firstUtcDay: 0, dayCount: 1 }, new AbortController().signal, fetcher) },
  { name: "consent not enrolled", body: absent, status: 200, read: (fetcher: typeof fetch) => readUsageConsent(new AbortController().signal, fetcher) },
  ...(["not_enrolled", "not_started", "range_too_large"] as const).map(error => ({ name: `stats ${error}`, body: { schemaVersion: 2, ok: false, error } as const,
    status: error === "range_too_large" ? 413 : 200, read: (fetcher: typeof fetch) => readPrivateStats(0, 1, new AbortController().signal, fetcher, { workerFactory: () => new TestMetricWorker() }) })),
];
for (const scenario of cases) test(`${scenario.name}: authenticated absence invalidates a previous account's visible scope`, async () => {
  invalidateUsageAccountGeneration("lifecycle");
  acceptUsageAccountReply(captureUsageAccountRead(), A);
  const old = acceptUsageAccountReply(captureUsageAccountRead(), A);
  expect(old.kind).toBe("accepted");
  let reads = 0;
  const fetcher = (async () => { reads++; return new Response(JSON.stringify(scenario.body), {
    status: scenario.status, headers: { "content-type": "application/json; charset=utf-8", [USAGE_ACCOUNT_HEADER]: B },
  }); }) as unknown as typeof fetch;
  const result = await readInUsageAccountGeneration<PrivateDaysReadReply | StatsReadReply | UsageConsentReadReply>(() => scenario.read(fetcher), reply => "accountId" in reply ? reply.accountId ?? null : null, () => true);
  expect(reads).toBe(2); expect(result?.scope?.accountId).toBe(B);
  expect(old.kind === "accepted" && currentUsageAccountScope(old.scope)).toBe(false);
  expect(result?.reply).toEqual({ ...scenario.body, accountId: B });
});
