import { err, ok, type Result } from "../result";
import { isStatsClient, isStatsModel, isStatsProvider, STATS_REGISTRY_REVISION } from "./stats-registry";

export const STATS_PROFILE = "client-stats-v2" as const;
export const STATS_MAX_DAYS = 366;
export const STATS_MAX_ROWS = 65_536;
export const STATS_MAX_BYTES = 32 * 1024 * 1024;
export const STATS_MAX_SOURCES = 64;
export const STATS_MAX_RECORDS = 10_000_000;
export const STATS_MAX_DAY = 99_999_999;
export const STATS_DAY_MS = 86_400_000;
export const STATS_TOKEN_KEYS = ["input", "cacheRead", "cacheWrite", "output", "reasoning"] as const;
export type StatsTokenKey = typeof STATS_TOKEN_KEYS[number];
export type StatsTokens = Readonly<Record<StatsTokenKey, string>>;
export type SourceCoverage = Readonly<{
  client: string; status: "observed" | "empty" | "not_found" | "incomplete" | "unavailable";
  tokenBasis: "reported" | "estimated" | "mixed" | "unavailable";
  records: number; warnings: number; latestAtMs: number | null;
}>;
export type UsageStatsRow = Readonly<{
  utcDay: number; client: string; provider: string | null; model: string | null;
  tokens: StatsTokens; records: number;
  reportedCostMicrousd: string | null; reportedCostRecords: number;
  estimatedCostMicrousd: string | null; estimatedCostRecords: number;
  durationMs: string | null; timedRecords: number; timedTokens: string;
  tokenBasis: "reported" | "estimated" | "unavailable"; breakdownCoverage: "partial" | "complete";
}>;
export type UsageStatsReport = Readonly<{
  schemaVersion: 2; profile: typeof STATS_PROFILE; registryRevision: 1;
  firstUtcDay: number; dayCount: number; generatedAtMs: number; revision: number;
  updatedAtMs: number | null; sources: readonly SourceCoverage[]; rows: readonly UsageStatsRow[];
}>;

export const statsInteger = (value: unknown, min: number, max: number): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
export const statsDecimal = (value: unknown): value is string => typeof value === "string"
  && /^(0|[1-9][0-9]{0,23})$/u.test(value);
const time = (value: unknown): value is number => statsInteger(value, 0, 8_640_000_000_000_000);

/** Read own data properties only, so unknown input cannot run accessors. */
export function statsOwnRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const owned: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    owned[key] = descriptor.value as unknown;
  }
  return owned;
}
function array(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !statsInteger(length.value, 0, maximum)) return null;
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(entries).length !== length.value + 1) return null;
  const owned: unknown[] = [];
  for (let index = 0; index < length.value; index++) {
    const entry = entries[String(index)];
    if (entry === undefined || !("value" in entry) || !entry.enumerable) return null;
    owned.push(entry.value as unknown);
  }
  return owned;
}
export const statsRowKey = (row: UsageStatsRow): string => [String(row.utcDay).padStart(8, "0"), row.client, row.provider ?? "", row.model ?? "", row.tokenBasis].join("\u0000");

export const STATS_U128_MAX = (1n << 128n) - 1n;
/** The 24-digit `statsDecimal` ceiling, as the native kernel's `MAX_DECIMAL`. */
export const STATS_MAX_DECIMAL = 10n ** 24n - 1n;
export type StatsArithmeticError = "overflow" | "limit";
/** Full-width addition, then a separate profile limit, as the native kernel's
 * `checked_add_bounded`. Overflow and limit refusals stay distinct. */
export function statsCheckedAddBounded(left: bigint, right: bigint, limit: bigint): Result<bigint, StatsArithmeticError> {
  if (left < 0n || right < 0n || left > STATS_U128_MAX || right > STATS_U128_MAX) return err("overflow");
  const sum = left + right;
  if (sum > STATS_U128_MAX) return err("overflow");
  return sum > limit ? err("limit") : ok(sum);
}
/** Five bounded buckets never exceed this, so a refusal is a corrupted row. */
const STATS_MAX_TOKEN_TOTAL = 5n * STATS_MAX_DECIMAL;
export const statsTokenTotal = (tokens: StatsTokens): bigint => STATS_TOKEN_KEYS.reduce((total, key) => {
  const sum = statsCheckedAddBounded(total, BigInt(tokens[key]), STATS_MAX_TOKEN_TOTAL);
  if (!sum.ok) throw new Error("stats_token_total_invalid");
  return sum.value;
}, 0n);
export type StatsPricingError = StatsArithmeticError | "missing_rate";
/** The native retail estimate, as the kernel's `price_microusd`: rates are
 * pico-USD per token in bucket order (input, cache read, cache write, output,
 * reasoning); a used bucket needs a rate, an unused bucket does not; one
 * half-up rounding per observation, then the 24-digit profile limit. This is
 * the differential reference for the native estimate; hosted views never
 * price usage themselves. */
export function statsPriceMicrousd(tokens: readonly [bigint, bigint, bigint, bigint, bigint], rates: readonly [bigint | null, bigint | null, bigint | null, bigint | null, bigint | null]): Result<bigint, StatsPricingError> {
  let pico = 0n;
  for (let index = 0; index < 5; index++) {
    const count = tokens[index]!, rate = rates[index]!;
    if (count < 0n || count > STATS_U128_MAX || (rate !== null && (rate < 0n || rate > STATS_U128_MAX))) return err("overflow");
    if (count === 0n) continue;
    if (rate === null) return err("missing_rate");
    const amount = count * rate;
    if (amount > STATS_U128_MAX) return err("overflow");
    const sum = statsCheckedAddBounded(pico, amount, STATS_U128_MAX);
    if (!sum.ok) return sum;
    pico = sum.value;
  }
  const offset = statsCheckedAddBounded(pico, 500_000n, STATS_U128_MAX);
  if (!offset.ok) return offset;
  const rounded = offset.value / 1_000_000n;
  return rounded > STATS_MAX_DECIMAL ? err("limit") : ok(rounded);
}

const sourceKeys = ["client", "status", "tokenBasis", "records", "warnings", "latestAtMs"];
const rowKeys = ["utcDay", "client", "provider", "model", "tokens", "records", "reportedCostMicrousd", "reportedCostRecords", "estimatedCostMicrousd", "estimatedCostRecords", "durationMs", "timedRecords", "timedTokens", "tokenBasis", "breakdownCoverage"];
function source(value: unknown): SourceCoverage | null {
  const raw = statsOwnRecord(value, sourceKeys);
  if (raw === null || !isStatsClient(raw.client)
    || typeof raw.status !== "string" || !["observed", "empty", "not_found", "incomplete", "unavailable"].includes(raw.status)
    || typeof raw.tokenBasis !== "string" || !["reported", "estimated", "mixed", "unavailable"].includes(raw.tokenBasis)
    || !statsInteger(raw.records, 0, STATS_MAX_RECORDS) || !statsInteger(raw.warnings, 0, STATS_MAX_RECORDS)
    || (raw.latestAtMs !== null && !time(raw.latestAtMs))) return null;
  if (["empty", "not_found", "unavailable"].includes(raw.status) && (raw.records !== 0 || raw.latestAtMs !== null)) return null;
  return Object.freeze({ ...raw }) as SourceCoverage;
}
export function parseUsageStatsRow(value: unknown): UsageStatsRow | null {
  try {
    const raw = statsOwnRecord(value, rowKeys);
    if (raw === null || !statsInteger(raw.utcDay, 0, STATS_MAX_DAY) || !isStatsClient(raw.client)
      || (raw.provider !== null && !isStatsProvider(raw.provider)) || (raw.model !== null && !isStatsModel(raw.model))
      || !statsInteger(raw.records, 1, STATS_MAX_RECORDS) || !statsInteger(raw.reportedCostRecords, 0, raw.records)
      || !statsInteger(raw.estimatedCostRecords, 0, raw.records) || !statsInteger(raw.timedRecords, 0, raw.records)
      || typeof raw.tokenBasis !== "string" || !["reported", "estimated", "unavailable"].includes(raw.tokenBasis)
      || typeof raw.breakdownCoverage !== "string" || !["partial", "complete"].includes(raw.breakdownCoverage)) return null;
    if (raw.reportedCostRecords + raw.estimatedCostRecords > raw.records) return null;
    for (const [amount, count] of [[raw.reportedCostMicrousd, raw.reportedCostRecords], [raw.estimatedCostMicrousd, raw.estimatedCostRecords], [raw.durationMs, raw.timedRecords]] as const) {
      if (amount === null ? count !== 0 : !statsDecimal(amount) || count === 0) return null;
    }
    if (!statsDecimal(raw.timedTokens)) return null;
    const tokenFields = statsOwnRecord(raw.tokens, STATS_TOKEN_KEYS);
    if (tokenFields === null || STATS_TOKEN_KEYS.some(key => !statsDecimal(tokenFields[key]))) return null;
    const tokens = Object.freeze({ ...tokenFields }) as StatsTokens;
    if (raw.tokenBasis === "unavailable" && (statsTokenTotal(tokens) !== 0n || raw.timedTokens !== "0" || raw.breakdownCoverage !== "partial")) return null;
    if (BigInt(raw.timedTokens) > statsTokenTotal(tokens) || (raw.timedRecords === 0 && raw.timedTokens !== "0")) return null;
    return Object.freeze({ ...raw, tokens }) as UsageStatsRow;
  } catch { return null; }
}

/** Validation is shared by local imports, hosted projections and native fixtures. */
export function parseUsageStatsReport(value: unknown): UsageStatsReport | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "profile", "registryRevision", "firstUtcDay", "dayCount", "generatedAtMs", "revision", "updatedAtMs", "sources", "rows"]);
    if (raw === null || raw.schemaVersion !== 2 || raw.profile !== STATS_PROFILE || raw.registryRevision !== STATS_REGISTRY_REVISION
      || !statsInteger(raw.firstUtcDay, 0, STATS_MAX_DAY) || !statsInteger(raw.dayCount, 1, STATS_MAX_DAYS)
      || raw.firstUtcDay + raw.dayCount - 1 > STATS_MAX_DAY || !time(raw.generatedAtMs)
      || !statsInteger(raw.revision, 0, Number.MAX_SAFE_INTEGER) || (raw.updatedAtMs !== null && !time(raw.updatedAtMs))) return null;
    if ((raw.revision === 0) !== (raw.updatedAtMs === null)) return null;
    const sourceItems = array(raw.sources, STATS_MAX_SOURCES), rowItems = array(raw.rows, STATS_MAX_ROWS);
    if (sourceItems === null || rowItems === null) return null;
    const sources: SourceCoverage[] = [], rows: UsageStatsRow[] = [], sourceMap = new Map<string, SourceCoverage>();
    let previous = "";
    for (const item of sourceItems) {
      const owned = source(item);
      if (owned === null || owned.client <= previous || (owned.latestAtMs !== null && owned.latestAtMs > raw.generatedAtMs)) return null;
      sources.push(owned); sourceMap.set(owned.client, owned); previous = owned.client;
    }
    previous = "";
    const totals = new Map<string, number>();
    const bases = new Map<string, Set<string>>();
    for (const item of rowItems) {
      const owned = parseUsageStatsRow(item);
      if (owned === null || owned.utcDay < raw.firstUtcDay || owned.utcDay >= raw.firstUtcDay + raw.dayCount) return null;
      const coverage = sourceMap.get(owned.client), key = statsRowKey(owned);
      if (coverage === undefined || !["observed", "incomplete"].includes(coverage.status) || key <= previous) return null;
      const count = (totals.get(owned.client) ?? 0) + owned.records;
      if (count > coverage.records || count > STATS_MAX_RECORDS) return null;
      totals.set(owned.client, count);
      const basis = bases.get(owned.client) ?? new Set<string>(); basis.add(owned.tokenBasis); bases.set(owned.client, basis);
      rows.push(owned); previous = key;
    }
    for (const coverage of sources) {
      if ((totals.get(coverage.client) ?? 0) !== coverage.records) return null;
      const basis = bases.get(coverage.client);
      if (basis !== undefined && coverage.tokenBasis !== (basis.size > 1 ? "mixed" : [...basis][0])) return null;
    }
    const report = Object.freeze({ ...raw, sources: Object.freeze(sources), rows: Object.freeze(rows) }) as UsageStatsReport;
    return new TextEncoder().encode(JSON.stringify(report)).byteLength <= STATS_MAX_BYTES ? report : null;
  } catch { return null; }
}
export function parseUsageStatsJson(text: string): UsageStatsReport | null {
  if (text.length > STATS_MAX_BYTES || new TextEncoder().encode(text).byteLength > STATS_MAX_BYTES) return null;
  try { return parseUsageStatsReport(JSON.parse(text) as unknown); } catch { return null; }
}
