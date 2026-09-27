import { STATS_MAX_DAY, STATS_MAX_RECORDS, STATS_TOKEN_KEYS, statsDecimal, statsOwnRecord, type StatsTokens } from "./stats-contract";
import { isStatsClient } from "./stats-registry";
import { STATS_MAX_TIME, statsInteger } from "./stats-http-contract";

/** Lifetime account totals: every committed snapshot day, summed across the
 * devices that published it, plus retained v1 heads for device/client/days no
 * snapshot from that device covers. Unlike the windowed report this answer has
 * no date range, so it is the number a person compares with another tracker. */
export const STATS_TOTALS_URL = "https://usage.aicharts.io/internal/usage/totals";
/** Enrolled-device totals read: same answer as the dashboard totals, gated by
 * the device's upload secret instead of a coordinator workload token. */
export const STATS_TOTALS_DEVICE_URL = "https://usage.aicharts.io/v2/snapshots/totals";
export const STATS_TOTALS_REQUEST_BYTES = 512;
export const STATS_TOTALS_RESPONSE_BYTES = 256 * 1024;
export const STATS_TOTALS_MAX_DEVICES = 128;
export const STATS_TOTALS_MAX_CLIENTS = 64;
export const STATS_TOTALS_MAX_DAYS = 100_000_000;
export const STATS_TOTALS_MEDIA = "application/json; charset=utf-8";
const ZERO_TOKENS: StatsTokens = Object.freeze({ input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" });

export type StatsTotalsQuery = Readonly<{ schemaVersion: 2; accountId: string; sessionExpiresAtMs: number }>;
export type StatsTotalsDeviceRequest = Readonly<{ schemaVersion: 2; accountId: string; deviceId: string; generation: string }>;
export type StatsTotalsCell = Readonly<{ records: number; days: number; firstUtcDay: number | null; lastUtcDay: number | null; tokens: StatsTokens }>;
export type StatsTotalsBasis = "snapshots" | "legacy" | "mixed";
export type StatsTotalsClient = StatsTotalsCell & Readonly<{ client: string; basis: StatsTotalsBasis }>;
export type StatsTotalsDevice = StatsTotalsCell & Readonly<{ deviceId: string; enrolledAtMs: number; revokedAtMs: number | null; clients: readonly StatsTotalsClient[] }>;
export type StatsTotals = Readonly<{
  schemaVersion: 2; generatedAtMs: number; revision: number; updatedAtMs: number; legacyRevision: number;
  legacyVerifiedRevision: number; legacyComplete: boolean; total: StatsTotalsCell;
  clients: readonly StatsTotalsClient[]; devices: readonly StatsTotalsDevice[];
}>;
export type StatsTotalsError = "invalid_input" | "unauthorized" | "not_enrolled" | "expired" | "recovery_required"
  | "clock_regressed" | "storage_invalid" | "storage_unavailable" | "limit";
export type StatsTotalsResult = Readonly<{ ok: true; value: StatsTotals }> | Readonly<{ ok: false; error: StatsTotalsError }>;
const errors: readonly string[] = ["invalid_input", "unauthorized", "not_enrolled", "expired", "recovery_required", "clock_regressed",
  "storage_invalid", "storage_unavailable", "limit"];
const account = (value: unknown): value is string => typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value);
const identity = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) && !/^0+$/u.test(value);

export const statsZeroTokens = (): StatsTokens => ZERO_TOKENS;
export const statsAddTokens = (left: StatsTokens, right: StatsTokens): StatsTokens =>
  Object.freeze(Object.fromEntries(STATS_TOKEN_KEYS.map(key => [key, (BigInt(left[key]) + BigInt(right[key])).toString()])) as Record<keyof StatsTokens, string>);
export const statsEmptyCell = (): StatsTotalsCell => Object.freeze({ records: 0, days: 0, firstUtcDay: null, lastUtcDay: null, tokens: ZERO_TOKENS });
export const statsTotalsTokenTotal = (tokens: StatsTokens): bigint => STATS_TOKEN_KEYS.reduce((sum, key) => sum + BigInt(tokens[key]), 0n);

export function parseStatsTotalsQuery(value: unknown): StatsTotalsQuery | null {
  const dto = statsOwnRecord(value, ["schemaVersion", "accountId", "sessionExpiresAtMs"]);
  return dto && dto.schemaVersion === 2 && account(dto.accountId) && statsInteger(dto.sessionExpiresAtMs, 0, STATS_MAX_TIME)
    ? Object.freeze({ schemaVersion: 2, accountId: dto.accountId, sessionExpiresAtMs: dto.sessionExpiresAtMs }) : null;
}
export function parseStatsTotalsDeviceRequest(value: unknown): StatsTotalsDeviceRequest | null {
  const dto = statsOwnRecord(value, ["schemaVersion", "accountId", "deviceId", "generation"]);
  return dto?.schemaVersion === 2 && account(dto.accountId) && identity(dto.deviceId) && identity(dto.generation)
    ? Object.freeze({ schemaVersion: 2, accountId: dto.accountId, deviceId: dto.deviceId, generation: dto.generation }) : null;
}
function tokens(value: unknown): StatsTokens | null {
  const fields = statsOwnRecord(value, STATS_TOKEN_KEYS);
  if (fields === null || STATS_TOKEN_KEYS.some(key => !statsDecimal(fields[key]))) return null;
  return Object.freeze({ ...fields }) as StatsTokens;
}
function cell(value: unknown, extra: readonly string[]): (StatsTotalsCell & Record<string, unknown>) | null {
  const dto = statsOwnRecord(value, ["records", "days", "firstUtcDay", "lastUtcDay", "tokens", ...extra]);
  if (dto === null || !statsInteger(dto.records, 0, STATS_MAX_RECORDS) || !statsInteger(dto.days, 0, STATS_TOTALS_MAX_DAYS)
    || (dto.firstUtcDay !== null && !statsInteger(dto.firstUtcDay, 0, STATS_MAX_DAY))
    || (dto.lastUtcDay !== null && !statsInteger(dto.lastUtcDay, 0, STATS_MAX_DAY))
    || (dto.firstUtcDay === null) !== (dto.lastUtcDay === null) || (dto.days === 0) !== (dto.firstUtcDay === null)
    || (dto.firstUtcDay !== null && dto.lastUtcDay !== null && (dto.firstUtcDay > dto.lastUtcDay || dto.lastUtcDay - dto.firstUtcDay + 1 < dto.days))) return null;
  const parsed = tokens(dto.tokens);
  return parsed === null ? null : { ...dto, tokens: parsed } as StatsTotalsCell & Record<string, unknown>;
}
function client(value: unknown): StatsTotalsClient | null {
  const dto = cell(value, ["client", "basis"]);
  if (dto === null || !isStatsClient(dto.client) || (dto.basis !== "snapshots" && dto.basis !== "legacy" && dto.basis !== "mixed")) return null;
  return Object.freeze({ client: dto.client, basis: dto.basis, records: dto.records, days: dto.days, firstUtcDay: dto.firstUtcDay,
    lastUtcDay: dto.lastUtcDay, tokens: dto.tokens });
}
function clients(value: unknown): readonly StatsTotalsClient[] | null {
  if (!Array.isArray(value) || value.length > STATS_TOTALS_MAX_CLIENTS) return null;
  const owned: StatsTotalsClient[] = [];
  let previous = "";
  for (const item of value) {
    const parsed = client(item);
    if (parsed === null || parsed.client <= previous) return null;
    owned.push(parsed); previous = parsed.client;
  }
  return Object.freeze(owned);
}
export function parseStatsTotals(value: unknown): StatsTotals | null {
  try {
    const dto = statsOwnRecord(value, ["schemaVersion", "generatedAtMs", "revision", "updatedAtMs", "legacyRevision", "legacyVerifiedRevision",
      "legacyComplete", "total", "clients", "devices"]);
    if (dto === null || dto.schemaVersion !== 2 || !statsInteger(dto.generatedAtMs, 0, STATS_MAX_TIME) || !statsInteger(dto.revision, 0, 1_000_000)
      || !statsInteger(dto.updatedAtMs, 0, STATS_MAX_TIME) || !statsInteger(dto.legacyRevision, 0, 4_096)
      || !statsInteger(dto.legacyVerifiedRevision, 0, dto.legacyRevision) || typeof dto.legacyComplete !== "boolean"
      || dto.legacyComplete !== (dto.legacyVerifiedRevision === dto.legacyRevision) || !Array.isArray(dto.devices)
      || dto.devices.length > STATS_TOTALS_MAX_DEVICES) return null;
    const total = cell(dto.total, []), owned = clients(dto.clients);
    if (total === null || owned === null) return null;
    const devices: StatsTotalsDevice[] = [];
    const seen = new Set<string>();
    for (const item of dto.devices) {
      const device = cell(item, ["deviceId", "enrolledAtMs", "revokedAtMs", "clients"]);
      if (device === null || !identity(device.deviceId) || seen.has(device.deviceId) || !statsInteger(device.enrolledAtMs, 0, STATS_MAX_TIME)
        || (device.revokedAtMs !== null && !statsInteger(device.revokedAtMs, 0, STATS_MAX_TIME))) return null;
      const deviceClients = clients(device.clients);
      if (deviceClients === null) return null;
      seen.add(device.deviceId);
      devices.push(Object.freeze({ deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, revokedAtMs: device.revokedAtMs, records: device.records,
        days: device.days, firstUtcDay: device.firstUtcDay, lastUtcDay: device.lastUtcDay, tokens: device.tokens, clients: deviceClients }));
    }
    return Object.freeze({ schemaVersion: 2, generatedAtMs: dto.generatedAtMs, revision: dto.revision, updatedAtMs: dto.updatedAtMs,
      legacyRevision: dto.legacyRevision, legacyVerifiedRevision: dto.legacyVerifiedRevision, legacyComplete: dto.legacyComplete,
      total: Object.freeze({ records: total.records, days: total.days, firstUtcDay: total.firstUtcDay, lastUtcDay: total.lastUtcDay, tokens: total.tokens }),
      clients: owned, devices: Object.freeze(devices) });
  } catch { return null; }
}
export function parseStatsTotalsResult(value: unknown): StatsTotalsResult | null {
  const failure = statsOwnRecord(value, ["ok", "error"]);
  if (failure?.ok === false && typeof failure.error === "string" && errors.includes(failure.error)) return Object.freeze({ ok: false, error: failure.error as StatsTotalsError });
  const success = statsOwnRecord(value, ["ok", "value"]), parsed = success?.ok === true ? parseStatsTotals(success.value) : null;
  return parsed === null ? null : Object.freeze({ ok: true, value: parsed });
}

export function statsTotalsJsonBytes(value: unknown, cap: number): Uint8Array<ArrayBuffer> | null {
  try { const bytes = Uint8Array.from(new TextEncoder().encode(JSON.stringify(value))); return bytes.length > 0 && bytes.length <= cap ? bytes : null; }
  catch { return null; }
}
export function statsTotalsJsonValue(bytes: unknown, cap: number): unknown {
  try {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > cap) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes))) as unknown;
  } catch { return null; }
}
export const encodeStatsTotalsRequest = (value: unknown): Uint8Array<ArrayBuffer> | null => {
  const query = parseStatsTotalsQuery(value); return query ? statsTotalsJsonBytes(query, STATS_TOTALS_REQUEST_BYTES) : null;
};
export const encodeStatsTotalsDeviceRequest = (value: unknown): Uint8Array<ArrayBuffer> | null => {
  const request = parseStatsTotalsDeviceRequest(value);
  return request ? statsTotalsJsonBytes(request, STATS_TOTALS_REQUEST_BYTES) : null;
};
export const decodeStatsTotalsRequest = (bytes: unknown): StatsTotalsQuery | null => parseStatsTotalsQuery(statsTotalsJsonValue(bytes, STATS_TOTALS_REQUEST_BYTES));
export function encodeStatsTotalsResponse(value: unknown): Uint8Array<ArrayBuffer> | null {
  const result = parseStatsTotalsResult(value);
  return result ? statsTotalsJsonBytes({ schemaVersion: 2, result }, STATS_TOTALS_RESPONSE_BYTES) : null;
}
export function decodeStatsTotalsResponse(bytes: unknown): StatsTotalsResult | null {
  const envelope = statsOwnRecord(statsTotalsJsonValue(bytes, STATS_TOTALS_RESPONSE_BYTES), ["schemaVersion", "result"]);
  return envelope?.schemaVersion === 2 ? parseStatsTotalsResult(envelope.result) : null;
}
export function statsTotalsHttpLength(headers: Headers, cap: number): number | null {
  const text = headers.get("content-length");
  if (text === null) return null;
  if (!/^[1-9][0-9]{0,7}$/u.test(text) || Number(text) > cap) throw new Error("stats_totals_http_framing");
  return Number(text);
}
