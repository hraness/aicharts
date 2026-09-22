import type { UsageStatsReport } from "@/lib/usage/stats-contract";
import { subscribeUsageAccountSignOut } from "@/lib/usage/account-session-events";
import type { StatsRange } from "./stats-view";

/** Recent account reports render instantly while a fresh read revalidates.
 * In-memory only — private data never persists — bounded, keyed by exact
 * range, and dropped on sign-out or any authentication refusal. */
const REPORT_CACHE_MAX = 8;
const reports = new Map<string, UsageStatsReport>();
const key = (selected: StatsRange) => `${selected.firstUtcDay}:${selected.dayCount}`;

export function cachedStatsReport(selected: StatsRange): UsageStatsReport | undefined {
  return reports.get(key(selected));
}
export function rememberStatsReport(selected: StatsRange, report: UsageStatsReport): void {
  reports.delete(key(selected));
  reports.set(key(selected), report);
  if (reports.size > REPORT_CACHE_MAX) reports.delete(reports.keys().next().value!);
}
export function clearStatsReports(): void {
  reports.clear();
}
subscribeUsageAccountSignOut(clearStatsReports);
