import { parseUsageStatsReport, statsOwnRecord, type UsageStatsReport } from "./stats-contract";
import { parseStatsRange, STATS_HTTP_RESPONSE_BYTES, type StatsRange } from "./stats-http-contract";

export const STATS_PUBLIC_URL = "https://aicharts.io/api/usage/stats";
export const STATS_PUBLIC_MEDIA = "application/json; charset=utf-8";
export const STATS_PUBLIC_MAX_BYTES = STATS_HTTP_RESPONSE_BYTES + 128;
export type StatsPublicError = "invalid_request" | "request_rejected" | "authentication_required" | "method_not_allowed" | "unavailable" | "not_enrolled" | "not_started" | "range_too_large";
export type StatsPublicReply = Readonly<{ schemaVersion: 2; ok: true; value: UsageStatsReport }>
  | Readonly<{ schemaVersion: 2; ok: false; error: StatsPublicError }>;
const statuses: Readonly<Record<StatsPublicError, number>> = Object.freeze({ invalid_request: 400, request_rejected: 403,
  authentication_required: 401, method_not_allowed: 405, unavailable: 503, not_enrolled: 200, not_started: 200, range_too_large: 413 });
export const statsPublicStatus = (reply: StatsPublicReply): number => reply.ok ? 200 : statuses[reply.error];

export function statsPublicPath(value: unknown): string | null {
  const range = parseStatsRange(value);
  return range === null ? null : `/api/usage/stats?firstUtcDay=${range.firstUtcDay}&dayCount=${range.dayCount}`;
}
export function parseStatsPublicSearch(search: string): StatsRange | null {
  const match = /^\?firstUtcDay=(0|[1-9][0-9]{0,7})&dayCount=([1-9][0-9]{0,2})$/u.exec(search);
  return match === null || match[0] !== search ? null : parseStatsRange({ firstUtcDay: Number(match[1]), dayCount: Number(match[2]) });
}
export function parseStatsPublicReply(value: unknown, range?: StatsRange): StatsPublicReply | null {
  try {
    const negative = statsOwnRecord(value, ["schemaVersion", "ok", "error"]);
    if (negative?.schemaVersion === 2 && negative.ok === false && typeof negative.error === "string" && Object.hasOwn(statuses, negative.error)) {
      return Object.freeze({ schemaVersion: 2, ok: false, error: negative.error as StatsPublicError });
    }
    const raw = statsOwnRecord(value, ["schemaVersion", "ok", "value"]);
    if (raw?.schemaVersion !== 2 || raw.ok !== true || range === undefined) return null;
    const report = parseUsageStatsReport(raw.value);
    return report && report.revision > 0 && report.firstUtcDay === range.firstUtcDay && report.dayCount === range.dayCount
      ? Object.freeze({ schemaVersion: 2, ok: true, value: report }) : null;
  } catch { return null; }
}
