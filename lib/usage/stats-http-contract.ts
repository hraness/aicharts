import { parseUsageStatsReport, STATS_MAX_DAY, STATS_MAX_DAYS, type UsageStatsReport } from "./stats-contract";
import { isStatsClient } from "./stats-registry";
import { privateDaysSnapshot as snapshot } from "./private-days-http-contract";

export const STATS_HTTP_URL = "https://usage.aicharts.io/internal/usage/stats";
export const STATS_UPLOAD_URL = "https://usage.aicharts.io/v2/snapshots";
export const STATS_STATUS_URL = "https://usage.aicharts.io/v2/snapshots/status";
export const STATS_ABANDON_URL = "https://usage.aicharts.io/v2/snapshots/abandon";
export const STATS_ABANDON_BYTES = 1_024;
export const STATS_HTTP_REQUEST_BYTES = 512;
export const STATS_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
export const STATS_HTTP_RESPONSE_ROWS = 8_192;
export const STATS_UPLOAD_BYTES = 4 * 1024 * 1024;
export const STATS_UPLOAD_ROWS = 8_192;
/** The device boundary waits out the account object's history audit, which is
 * linear in retained history and must pass before a mutation may commit. The
 * pairing boundary keeps its own shorter budgets.
 *
 * The binding constraint is the CLI's `timeout_recv_response` of 15s, not its
 * 20s global: that global is shared with resolve, connect and body send, and
 * the client's response clock starts before the Worker's does. These leave
 * headroom under 15s so an exhausted budget still delivers this boundary's own
 * refusal rather than being abandoned client-side as uncertain. Raising either
 * one requires raising `timeout_recv_response` in lockstep.
 *
 * The audit they wait on is bounded by recent history rather than retained
 * history, so these do not need to grow as an account does. Widening them
 * again would be the wrong answer to a slow audit; bounding what the audit
 * decodes is. */
export const STATS_UPLOAD_HTTP_WORKER_MS = 12_000;
export const STATS_UPLOAD_HTTP_STAGE_MS = 10_000;
export const STATS_MEDIA = "application/json; charset=utf-8";
export const STATS_MAX_TIME = 8_640_000_000_000_000;
export type StatsRange = Readonly<{ firstUtcDay: number; dayCount: number }>;
export type StatsQuery = StatsRange & Readonly<{ schemaVersion: 2; accountId: string; sessionExpiresAtMs: number }>;
export type StatsError = "invalid_input" | "unauthorized" | "not_enrolled" | "expired" | "revoked" | "conflict"
  | "recovery_required" | "clock_regressed" | "storage_invalid" | "storage_unavailable" | "limit"
  | "takeover_required" | "writer_conflict" | "profile_superseded" | "not_started" | "replacement_required";
export type StatsResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: StatsError }>;
export type StatsUpload = Readonly<{
  schemaVersion: 2; operationId: string; accountId: string; deviceId: string; generation: string;
  sequence: number; expectedRevision: number; mode: "replace-window" | "preserve-history" | "replace-snapshot";
  takeover: Readonly<{ expectedV1Revision: number; headDigest: string }> | null;
  report: UsageStatsReport;
}>;
export type StatsReceipt = Readonly<{
  schemaVersion: 2; operationId: string; bodyHash: string; sequence: number; revision: number;
  committedAtMs: number; client: string; firstUtcDay: number; dayCount: number;
}>;
export type StatsStatusRequest = StatsRange & Readonly<{
  schemaVersion: 2; accountId: string; deviceId: string; generation: string; client: string;
}>;
export type StatsStatus = Readonly<{
  schemaVersion: 2; revision: number; nextSequence: number; writerDeviceId: string | null;
  v1Revision: number; headDigest: string; legacyRecords: number; takeoverEligible: boolean;
}>;
export type StatsAbandonRequest = Readonly<{
  schemaVersion: 2; operationId: string; accountId: string; deviceId: string; generation: string;
  sequence: number; expectedRevision: number; bodyHash: string;
}>;
export type StatsAbandonment = Readonly<{ schemaVersion: 2; outcome: "committed"; receipt: StatsReceipt }>
  | Readonly<{ schemaVersion: 2; outcome: "abandoned"; operationId: string; bodyHash: string;
    sequence: number; expectedRevision: number; fencedAtRevision: number }>;
export const statsInteger = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
export const statsHex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const identity = (value: unknown): value is string => statsHex(value) && value !== "0".repeat(64);
const account = (value: unknown): value is string => typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value);

export function parseStatsRange(value: unknown): StatsRange | null {
  const dto = snapshot(value, ["firstUtcDay", "dayCount"]);
  return dto && statsInteger(dto.firstUtcDay, 0, STATS_MAX_DAY) && statsInteger(dto.dayCount, 1, STATS_MAX_DAYS)
    && dto.firstUtcDay + dto.dayCount - 1 <= STATS_MAX_DAY
    ? Object.freeze({ firstUtcDay: dto.firstUtcDay, dayCount: dto.dayCount }) : null;
}
export function parseStatsQuery(value: unknown): StatsQuery | null {
  const dto = snapshot(value, ["schemaVersion", "accountId", "sessionExpiresAtMs", "firstUtcDay", "dayCount"]);
  if (!dto || dto.schemaVersion !== 2 || !account(dto.accountId) || !statsInteger(dto.sessionExpiresAtMs, 0, STATS_MAX_TIME)) return null;
  const range = parseStatsRange({ firstUtcDay: dto.firstUtcDay, dayCount: dto.dayCount });
  return range ? Object.freeze({ schemaVersion: 2, accountId: dto.accountId, sessionExpiresAtMs: dto.sessionExpiresAtMs, ...range }) : null;
}
export function parseStatsStatusRequest(value: unknown): StatsStatusRequest | null {
  const dto = snapshot(value, ["schemaVersion", "accountId", "deviceId", "generation", "client", "firstUtcDay", "dayCount"]);
  if (!dto || dto.schemaVersion !== 2 || !account(dto.accountId) || !identity(dto.deviceId) || !identity(dto.generation) || !isStatsClient(dto.client)) return null;
  const range = parseStatsRange({ firstUtcDay: dto.firstUtcDay, dayCount: dto.dayCount });
  return range ? Object.freeze({ schemaVersion: 2, accountId: dto.accountId, deviceId: dto.deviceId, generation: dto.generation, client: dto.client, ...range }) : null;
}
export function parseStatsAbandonRequest(value: unknown): StatsAbandonRequest | null {
  const dto = snapshot(value, ["schemaVersion", "operationId", "accountId", "deviceId", "generation", "sequence", "expectedRevision", "bodyHash"]);
  return dto?.schemaVersion === 2 && identity(dto.operationId) && account(dto.accountId) && identity(dto.deviceId) && identity(dto.generation)
    && statsInteger(dto.sequence, 1) && statsInteger(dto.expectedRevision, 0, 999_999) && statsHex(dto.bodyHash)
    ? Object.freeze({ schemaVersion: 2, operationId: dto.operationId, accountId: dto.accountId, deviceId: dto.deviceId, generation: dto.generation,
      sequence: dto.sequence, expectedRevision: dto.expectedRevision, bodyHash: dto.bodyHash }) : null;
}
export function parseStatsAbandonment(value: unknown): StatsAbandonment | null {
  const committed = snapshot(value, ["schemaVersion", "outcome", "receipt"]);
  if (committed?.schemaVersion === 2 && committed.outcome === "committed") {
    const receipt = parseStatsReceipt(committed.receipt);
    return receipt ? Object.freeze({ schemaVersion: 2, outcome: "committed", receipt }) : null;
  }
  const dto = snapshot(value, ["schemaVersion", "outcome", "operationId", "bodyHash", "sequence", "expectedRevision", "fencedAtRevision"]);
  return dto?.schemaVersion === 2 && dto.outcome === "abandoned" && identity(dto.operationId) && statsHex(dto.bodyHash)
    && statsInteger(dto.sequence, 1) && statsInteger(dto.expectedRevision, 0, 999_999)
    && statsInteger(dto.fencedAtRevision, dto.expectedRevision + 1, 1_000_000)
    ? Object.freeze({ schemaVersion: 2, outcome: "abandoned", operationId: dto.operationId, bodyHash: dto.bodyHash,
      sequence: dto.sequence, expectedRevision: dto.expectedRevision, fencedAtRevision: dto.fencedAtRevision }) : null;
}
export function parseStatsUpload(value: unknown): StatsUpload | null {
  try {
    const dto = snapshot(value, ["schemaVersion", "operationId", "accountId", "deviceId", "generation", "sequence", "expectedRevision", "mode", "takeover", "report"]);
    if (!dto || dto.schemaVersion !== 2 || !identity(dto.operationId) || !account(dto.accountId) || !identity(dto.deviceId)
      || !identity(dto.generation) || !statsInteger(dto.sequence, 1) || !statsInteger(dto.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1)
      || (dto.mode !== "replace-window" && dto.mode !== "preserve-history" && dto.mode !== "replace-snapshot")) return null;
    let takeover: StatsUpload["takeover"] = null;
    if (dto.takeover !== null) {
      const prior = snapshot(dto.takeover, ["expectedV1Revision", "headDigest"]);
      if (!prior || !statsInteger(prior.expectedV1Revision, 0, 4_096) || !statsHex(prior.headDigest)) return null;
      takeover = Object.freeze({ expectedV1Revision: prior.expectedV1Revision, headDigest: prior.headDigest });
    }
    const report = parseUsageStatsReport(dto.report);
    if (!report || report.revision !== 0 || report.updatedAtMs !== null || report.sources.length !== 1 || report.rows.length > STATS_UPLOAD_ROWS) return null;
    const source = report.sources[0];
    if ((source.client === "warp") !== (dto.mode === "replace-snapshot")) return null;
    if (dto.mode === "replace-snapshot" && (report.dayCount !== 1 || source.status !== "observed" || source.records === 0
      || source.latestAtMs === null || Math.floor(source.latestAtMs / 86_400_000) !== report.firstUtcDay
      || report.rows.length === 0 || report.rows.some(row => row.tokenBasis !== "unavailable"))) return null;
    if (source.client === "9router" || (source.status !== "observed" && source.status !== "empty") || source.warnings !== 0
      || report.rows.some(row => row.client !== source.client)
      || (source.status === "empty" && (report.rows.length !== 0 || source.records !== 0))) return null;
    const result: StatsUpload = Object.freeze({ schemaVersion: 2, operationId: dto.operationId, accountId: dto.accountId,
      deviceId: dto.deviceId, generation: dto.generation, sequence: dto.sequence, expectedRevision: dto.expectedRevision, mode: dto.mode, takeover, report });
    return new TextEncoder().encode(JSON.stringify(result)).byteLength <= STATS_UPLOAD_BYTES ? result : null;
  } catch { return null; }
}
export function parseStatsReceipt(value: unknown): StatsReceipt | null {
  const dto = snapshot(value, ["schemaVersion", "operationId", "bodyHash", "sequence", "revision", "committedAtMs", "client", "firstUtcDay", "dayCount"]);
  if (!dto || dto.schemaVersion !== 2 || !identity(dto.operationId) || !statsHex(dto.bodyHash) || !statsInteger(dto.sequence, 1)
    || !statsInteger(dto.revision, 1) || !statsInteger(dto.committedAtMs, 0, STATS_MAX_TIME) || !isStatsClient(dto.client)) return null;
  const range = parseStatsRange({ firstUtcDay: dto.firstUtcDay, dayCount: dto.dayCount });
  return range ? Object.freeze({ schemaVersion: 2, operationId: dto.operationId, bodyHash: dto.bodyHash, sequence: dto.sequence,
    revision: dto.revision, committedAtMs: dto.committedAtMs, client: dto.client, ...range }) : null;
}
export function parseStatsStatus(value: unknown): StatsStatus | null {
  const dto = snapshot(value, ["schemaVersion", "revision", "nextSequence", "writerDeviceId", "v1Revision", "headDigest", "legacyRecords", "takeoverEligible"]);
  return dto?.schemaVersion === 2 && statsInteger(dto.revision) && statsInteger(dto.nextSequence, 1)
    && (dto.writerDeviceId === null || identity(dto.writerDeviceId)) && statsInteger(dto.v1Revision, 0, 4_096)
    && statsHex(dto.headDigest) && statsInteger(dto.legacyRecords, 0, 100_000) && typeof dto.takeoverEligible === "boolean"
    ? Object.freeze({ schemaVersion: 2, revision: dto.revision, nextSequence: dto.nextSequence, writerDeviceId: dto.writerDeviceId,
      v1Revision: dto.v1Revision, headDigest: dto.headDigest, legacyRecords: dto.legacyRecords, takeoverEligible: dto.takeoverEligible }) : null;
}
const errors: readonly string[] = ["invalid_input", "unauthorized", "not_enrolled", "expired", "revoked", "conflict", "recovery_required",
  "clock_regressed", "storage_invalid", "storage_unavailable", "limit", "takeover_required", "writer_conflict", "profile_superseded", "not_started", "replacement_required"];
export function parseStatsResult<T>(value: unknown, parse: (input: unknown) => T | null): StatsResult<T> | null {
  const failure = snapshot(value, ["ok", "error"]);
  if (failure?.ok === false && typeof failure.error === "string" && errors.includes(failure.error)) return Object.freeze({ ok: false, error: failure.error as StatsError });
  const success = snapshot(value, ["ok", "value"]), result = success?.ok === true ? parse(success.value) : null;
  return result === null ? null : Object.freeze({ ok: true, value: result });
}
export function statsJsonBytes(value: unknown, cap: number): Uint8Array<ArrayBuffer> | null {
  try { const bytes = Uint8Array.from(new TextEncoder().encode(JSON.stringify(value))); return bytes.length > 0 && bytes.length <= cap ? bytes : null; }
  catch { return null; }
}
export function statsJsonValue(bytes: unknown, cap: number): unknown {
  try {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > cap) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes))) as unknown;
  } catch { return null; }
}
export const encodeStatsHttpRequest = (value: unknown): Uint8Array<ArrayBuffer> | null => {
  const query = parseStatsQuery(value); return query ? statsJsonBytes(query, STATS_HTTP_REQUEST_BYTES) : null;
};
export const decodeStatsHttpRequest = (bytes: unknown): StatsQuery | null => parseStatsQuery(statsJsonValue(bytes, STATS_HTTP_REQUEST_BYTES));
function queryResult(query: StatsQuery, raw: unknown): StatsResult<UsageStatsReport> | null {
  return parseStatsResult(raw, value => {
    const report = parseUsageStatsReport(value);
    return report && report.rows.length <= STATS_HTTP_RESPONSE_ROWS && report.firstUtcDay === query.firstUtcDay && report.dayCount === query.dayCount ? report : null;
  });
}
export function encodeStatsHttpResponse(request: unknown, value: unknown): Uint8Array<ArrayBuffer> | null {
  const query = parseStatsQuery(request), result = query ? queryResult(query, value) : null;
  return result ? statsJsonBytes({ schemaVersion: 2, result }, STATS_HTTP_RESPONSE_BYTES) : null;
}
export function decodeStatsHttpResponse(bytes: unknown, request: unknown): StatsResult<UsageStatsReport> | null {
  const query = parseStatsQuery(request), envelope = snapshot(statsJsonValue(bytes, STATS_HTTP_RESPONSE_BYTES), ["schemaVersion", "result"]);
  return query && envelope?.schemaVersion === 2 ? queryResult(query, envelope.result) : null;
}
export function statsHttpLength(headers: Headers, cap: number): number | null {
  const text = headers.get("content-length");
  if (text === null) return null;
  if (!/^[1-9][0-9]{0,7}$/u.test(text) || Number(text) > cap) throw new Error("stats_http_framing");
  return Number(text);
}
