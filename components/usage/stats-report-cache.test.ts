import { expect, test } from "bun:test";
import { createUsageStatsExample } from "@/lib/usage/stats-example";
import { clearUsageAccountViews } from "@/lib/usage/account-session-events";
import { cachedStatsReport, clearStatsReports, rememberStatsReport } from "./stats-report-cache";

const range = { firstUtcDay: 20_600, dayCount: 30 };

test("a remembered report is served for the exact same range only", () => {
  clearStatsReports();
  const report = createUsageStatsExample(20_629);
  rememberStatsReport(range, report);
  expect(cachedStatsReport(range)).toBe(report);
  expect(cachedStatsReport({ firstUtcDay: 20_600, dayCount: 7 })).toBeUndefined();
  expect(cachedStatsReport({ firstUtcDay: 20_599, dayCount: 30 })).toBeUndefined();
});

test("the cache is bounded and evicts the least recently remembered range", () => {
  clearStatsReports();
  for (let index = 0; index < 9; index++) rememberStatsReport({ firstUtcDay: 20_000 + index * 10, dayCount: 7 }, createUsageStatsExample(20_000 + index * 10));
  expect(cachedStatsReport({ firstUtcDay: 20_000, dayCount: 7 })).toBeUndefined();
  expect(cachedStatsReport({ firstUtcDay: 20_080, dayCount: 7 })).not.toBeUndefined();
});

test("sign-out clears every remembered report in this tab", () => {
  clearStatsReports();
  rememberStatsReport(range, createUsageStatsExample(20_629));
  clearUsageAccountViews();
  expect(cachedStatsReport(range)).toBeUndefined();
});
