import { statsOwnRecord } from "./stats-contract";
import { parseStatsTotals, STATS_TOTALS_RESPONSE_BYTES, type StatsTotals } from "./stats-totals-contract";
import { USAGE_ACCOUNT_HEADER } from "./account-public";

/** Same-origin lifetime totals for the signed-in dashboard. */
export const STATS_TOTALS_PATH = "/api/usage/totals";
export const STATS_TOTALS_PUBLIC_URL = `https://aicharts.io${STATS_TOTALS_PATH}`;
export const STATS_TOTALS_PUBLIC_MEDIA = "application/json; charset=utf-8";
export const STATS_TOTALS_ACCOUNT_HEADER = USAGE_ACCOUNT_HEADER;
export const STATS_TOTALS_PUBLIC_MAX_BYTES = STATS_TOTALS_RESPONSE_BYTES + 128;
export type StatsTotalsPublicError = "invalid_request" | "request_rejected" | "authentication_required" | "method_not_allowed" | "unavailable" | "not_enrolled";
export type StatsTotalsPublicReply = Readonly<{ schemaVersion: 2; ok: true; value: StatsTotals }>
  | Readonly<{ schemaVersion: 2; ok: false; error: StatsTotalsPublicError }>;
const statuses: Readonly<Record<StatsTotalsPublicError, number>> = Object.freeze({ invalid_request: 400, request_rejected: 403,
  authentication_required: 401, method_not_allowed: 405, unavailable: 503, not_enrolled: 200 });
export const statsTotalsPublicStatus = (reply: StatsTotalsPublicReply): number => reply.ok ? 200 : statuses[reply.error];

export function parseStatsTotalsPublicReply(value: unknown): StatsTotalsPublicReply | null {
  try {
    const negative = statsOwnRecord(value, ["schemaVersion", "ok", "error"]);
    if (negative?.schemaVersion === 2 && negative.ok === false && typeof negative.error === "string" && Object.hasOwn(statuses, negative.error)) {
      return Object.freeze({ schemaVersion: 2, ok: false, error: negative.error as StatsTotalsPublicError });
    }
    const raw = statsOwnRecord(value, ["schemaVersion", "ok", "value"]);
    if (raw?.schemaVersion !== 2 || raw.ok !== true) return null;
    const totals = parseStatsTotals(raw.value);
    return totals ? Object.freeze({ schemaVersion: 2, ok: true, value: totals }) : null;
  } catch { return null; }
}
export function decodeStatsTotalsPublicReply(bytes: Uint8Array): StatsTotalsPublicReply | null {
  if (bytes.byteLength === 0 || bytes.byteLength > STATS_TOTALS_PUBLIC_MAX_BYTES) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const reply = parseStatsTotalsPublicReply(JSON.parse(text));
    return reply !== null && JSON.stringify(reply) === text ? reply : null;
  } catch { return null; }
}
