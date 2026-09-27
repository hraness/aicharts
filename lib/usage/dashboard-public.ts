/** Browser-facing `/api/usage/dashboard` contract: one same-origin GET that
 * verifies the session once and returns several private reads together.
 *
 * The body is a frame, not JSON: a 4-byte big-endian header length, an ASCII
 * JSON header, then each part's bytes in canonical order. Every part carries
 * exactly the body and status its standalone endpoint would return, so the
 * browser admits it with that endpoint's own decoder. The stats part stays
 * opaque bytes for the private report worker. */
import { USAGE_ACCOUNT_BYTES, usageAccountId } from "./account-public";
import { USAGE_CONSENT_PUBLIC_MAX_BYTES } from "./consent-public";
import { parseStatsRange, type StatsRange } from "./stats-http-contract";
import { STATS_PUBLIC_MAX_BYTES } from "./stats-public";
import { STATS_TOTALS_PUBLIC_MAX_BYTES } from "./stats-totals-public";

export const USAGE_DASHBOARD_PATH = "/api/usage/dashboard";
export const USAGE_DASHBOARD_URL = `https://aicharts.io${USAGE_DASHBOARD_PATH}`;
export const USAGE_DASHBOARD_MEDIA = "application/vnd.aicharts.usage-dashboard.v1";
export const USAGE_DASHBOARD_PARTS = Object.freeze(["account", "totals", "consent", "stats"] as const);
export type UsageDashboardPart = typeof USAGE_DASHBOARD_PARTS[number];
export type UsageDashboardQuery = Readonly<{ parts: readonly UsageDashboardPart[]; range: StatsRange | null }>;
export type UsageDashboardError = "invalid_request" | "request_rejected" | "authentication_required" | "method_not_allowed" | "unavailable";
/** Longest delay the header may name before the browser renews its session. */
export const USAGE_DASHBOARD_REFRESH_MAX_MS = 24 * 60 * 60_000;
const HEADER_BYTES = 1_024;
const PART_BYTES: Readonly<Record<UsageDashboardPart, number>> = Object.freeze({
  account: USAGE_ACCOUNT_BYTES, totals: STATS_TOTALS_PUBLIC_MAX_BYTES, consent: USAGE_CONSENT_PUBLIC_MAX_BYTES, stats: STATS_PUBLIC_MAX_BYTES,
});
/** Statuses a part can carry once the session is verified; anything else fails closed. */
const PART_STATUSES: Readonly<Record<UsageDashboardPart, readonly number[]>> = Object.freeze({
  account: Object.freeze([200]), totals: Object.freeze([200, 503]), consent: Object.freeze([200, 503]), stats: Object.freeze([200, 413, 503]),
});
const ERROR_STATUS: Readonly<Record<UsageDashboardError, number>> = Object.freeze({
  invalid_request: 400, request_rejected: 403, authentication_required: 401, method_not_allowed: 405, unavailable: 503,
});
export const USAGE_DASHBOARD_MAX_BYTES = 4 + HEADER_BYTES + Object.values(PART_BYTES).reduce((sum, bytes) => sum + bytes, 0);

export type UsageDashboardFramePart = Readonly<{ part: UsageDashboardPart; status: number; bytes: Uint8Array<ArrayBuffer> }>;
export type UsageDashboardFrame =
  | Readonly<{ kind: "ready"; accountId: string; sessionRefreshInMs: number; parts: readonly UsageDashboardFramePart[] }>
  | Readonly<{ kind: "error"; error: UsageDashboardError }>;

export const usageDashboardErrorStatus = (error: UsageDashboardError): number => ERROR_STATUS[error];

function canonicalParts(value: unknown): readonly UsageDashboardPart[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > USAGE_DASHBOARD_PARTS.length) return null;
  const parts = USAGE_DASHBOARD_PARTS.filter(part => value.includes(part));
  return parts.length === value.length && parts.every((part, index) => value[index] === part) ? Object.freeze(parts) : null;
}

/** Stats needs a range and nothing else may carry one; parts keep canonical order. */
export function parseUsageDashboardQuery(value: unknown): UsageDashboardQuery | null {
  try {
    if (value === null || typeof value !== "object") return null;
    const parts = canonicalParts(Reflect.get(value, "parts"));
    if (parts === null) return null;
    const raw = Reflect.get(value, "range");
    const range = raw === null ? null : parseStatsRange(raw);
    if (parts.includes("stats") !== (range !== null) || (raw !== null && range === null)) return null;
    return Object.freeze({ parts, range });
  } catch { return null; }
}

/** Parts are joined by ".", an unreserved character: platforms re-serialize
 * query strings like URLSearchParams, which percent-encodes "," but never "." */
const PART_SEPARATOR = ".";

export function usageDashboardPath(value: unknown): string | null {
  const query = parseUsageDashboardQuery(value);
  if (query === null) return null;
  const range = query.range === null ? "" : `&firstUtcDay=${query.range.firstUtcDay}&dayCount=${query.range.dayCount}`;
  return `${USAGE_DASHBOARD_PATH}?parts=${query.parts.join(PART_SEPARATOR)}${range}`;
}

export function parseUsageDashboardSearch(search: string): UsageDashboardQuery | null {
  const match = /^\?parts=([a-z]{1,8}(?:\.[a-z]{1,8}){0,3})(?:&firstUtcDay=(0|[1-9][0-9]{0,7})&dayCount=([1-9][0-9]{0,2}))?$/u.exec(search);
  if (match === null || match[0] !== search) return null;
  const query = parseUsageDashboardQuery({ parts: match[1]!.split(PART_SEPARATOR),
    range: match[2] === undefined ? null : { firstUtcDay: Number(match[2]), dayCount: Number(match[3]) } });
  return query !== null && usageDashboardPath(query) === `${USAGE_DASHBOARD_PATH}${search}` ? query : null;
}

function ascii(text: string, cap: number): Uint8Array<ArrayBuffer> | null {
  if (text.length < 1 || text.length > cap) return null;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return null;
    bytes[index] = code;
  }
  return bytes;
}
function frame(header: string, parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> | null {
  const head = ascii(header, HEADER_BYTES);
  if (head === null) return null;
  const total = 4 + head.byteLength + parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total > USAGE_DASHBOARD_MAX_BYTES) return null;
  const bytes = new Uint8Array(total);
  new DataView(bytes.buffer).setUint32(0, head.byteLength);
  bytes.set(head, 4);
  let offset = 4 + head.byteLength;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
const errorHeader = (error: UsageDashboardError) => JSON.stringify({ schemaVersion: 1, error });
const readyHeader = (accountId: string, sessionRefreshInMs: number, parts: readonly UsageDashboardFramePart[]) =>
  JSON.stringify({ schemaVersion: 1, accountId, sessionRefreshInMs, parts: parts.map(part => [part.part, part.status, part.bytes.byteLength]) });
const refreshDelay = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
  && value >= 0 && value <= USAGE_DASHBOARD_REFRESH_MAX_MS;

export function encodeUsageDashboardFrame(value: UsageDashboardFrame): Uint8Array<ArrayBuffer> | null {
  try {
    if (value.kind === "error") return Object.hasOwn(ERROR_STATUS, value.error) ? frame(errorHeader(value.error), []) : null;
    if (!usageAccountId(value.accountId) || !refreshDelay(value.sessionRefreshInMs)) return null;
    if (canonicalParts(value.parts.map(part => part.part)) === null) return null;
    for (const part of value.parts) {
      if (!PART_STATUSES[part.part].includes(part.status) || part.bytes.byteLength < 1 || part.bytes.byteLength > PART_BYTES[part.part]) return null;
    }
    return frame(readyHeader(value.accountId, value.sessionRefreshInMs, value.parts), value.parts.map(part => part.bytes));
  } catch { return null; }
}

/** Exact inverse of the encoder: canonical header text, known statuses, bounded
 * lengths that sum to the frame, and owned copies of every part's bytes. */
export function decodeUsageDashboardFrame(bytes: Uint8Array): UsageDashboardFrame | null {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5 || bytes.byteLength > USAGE_DASHBOARD_MAX_BYTES) return null;
    const owned = new Uint8Array(bytes);
    const headerLength = new DataView(owned.buffer).getUint32(0);
    if (headerLength < 1 || headerLength > HEADER_BYTES || 4 + headerLength > owned.byteLength) return null;
    let text = "";
    for (const code of owned.subarray(4, 4 + headerLength)) {
      if (code < 0x20 || code > 0x7e) return null;
      text += String.fromCharCode(code);
    }
    const header: unknown = JSON.parse(text);
    if (header === null || typeof header !== "object" || Array.isArray(header)) return null;
    const keys = Object.keys(header);
    const error = Reflect.get(header, "error");
    if (keys.length === 2 && typeof error === "string" && Object.hasOwn(ERROR_STATUS, error)) {
      return errorHeader(error as UsageDashboardError) === text && owned.byteLength === 4 + headerLength
        ? Object.freeze({ kind: "error", error: error as UsageDashboardError }) : null;
    }
    const accountId = Reflect.get(header, "accountId"), refresh = Reflect.get(header, "sessionRefreshInMs"), listed = Reflect.get(header, "parts");
    if (keys.length !== 4 || Reflect.get(header, "schemaVersion") !== 1 || !usageAccountId(accountId) || !refreshDelay(refresh) || !Array.isArray(listed)) return null;
    const names = listed.map(entry => Array.isArray(entry) ? entry[0] : null);
    if (canonicalParts(names) === null) return null;
    const parts: UsageDashboardFramePart[] = [];
    let offset = 4 + headerLength;
    for (const entry of listed as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 3) return null;
      const [part, status, length] = entry as [UsageDashboardPart, unknown, unknown];
      if (typeof status !== "number" || !PART_STATUSES[part].includes(status) || typeof length !== "number" || !Number.isSafeInteger(length)
        || length < 1 || length > PART_BYTES[part] || offset + length > owned.byteLength) return null;
      parts.push(Object.freeze({ part, status, bytes: owned.slice(offset, offset + length) }));
      offset += length;
    }
    if (offset !== owned.byteLength || readyHeader(accountId, refresh, parts) !== text) return null;
    return Object.freeze({ kind: "ready", accountId, sessionRefreshInMs: refresh, parts: Object.freeze(parts) });
  } catch { return null; }
}
