import { MAX_TOKEN_COUNT } from "./wire";

/** Numeric projection syntax only. An account assertion is not an auth grant. */
export const PRIVATE_DAYS_MAX_DAYS = 31;
export const PRIVATE_DAYS_MAX_RESPONSE_BYTES = 16_384;
export const PRIVATE_DAYS_LAST_DAY = 100_000_000;
export const PRIVATE_DAYS_MAX_REVISIONS = 4_096;
export const PRIVATE_DAYS_MAX_HEADS = 1_000_000;
export const PRIVATE_DAYS_MAX_DAY_HEADS = 65_536;
const MAX_TIME = 8_640_000_000_000_000;

export type PrivateDaysRequestV1 = Readonly<{
  schemaVersion: 1; accountId: string; sessionExpiresAtMs: number; firstUtcDay: number; dayCount: number;
}>;
export type ProviderImportedTotals = Readonly<{
  usageOccurrences: number; observedAccountedTokens: string; observedOutputTokens: string;
}>;
export type PrivateDayV1 = Readonly<{
  utcDay: number; codex: ProviderImportedTotals; claudeCode: ProviderImportedTotals;
  devin: ProviderImportedTotals;
}>;
export type PrivateDaysV1 = Readonly<{
  schemaVersion: 1; measurementProfile: "imported-tokens-v1"; coverage: "partial";
  journalRevision: number; journalCommittedAtMs: number | null; firstUtcDay: number; days: readonly PrivateDayV1[];
}>;

const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;

/** Own data fields only; reflection is not a hostile-JavaScript resource sandbox. */
function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    copy[key] = descriptor.value as unknown;
  }
  return copy;
}

export function parsePrivateDaysRequest(value: unknown): PrivateDaysRequestV1 | null {
  try {
    const input = snapshot(value, ["schemaVersion", "accountId", "sessionExpiresAtMs", "firstUtcDay", "dayCount"]);
    if (input === null || input.schemaVersion !== 1 || typeof input.accountId !== "string"
      || input.accountId.length !== 37 || !/^acct_[0-9a-f]{32}$/u.test(input.accountId)
      || !integer(input.sessionExpiresAtMs, 0, MAX_TIME) || !integer(input.firstUtcDay, 0, PRIVATE_DAYS_LAST_DAY)
      || !integer(input.dayCount, 1, PRIVATE_DAYS_MAX_DAYS)
      || input.firstUtcDay + input.dayCount - 1 > PRIVATE_DAYS_LAST_DAY) return null;
    return Object.freeze({ schemaVersion: 1, accountId: input.accountId, sessionExpiresAtMs: input.sessionExpiresAtMs,
      firstUtcDay: input.firstUtcDay, dayCount: input.dayCount });
  } catch { return null; }
}

function decimal(value: unknown): bigint | null {
  return typeof value === "string" && value.length <= 18 && /^(0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}
function providerTotals(value: unknown, provider: 1 | 2 | 3): ProviderImportedTotals | null {
  const input = snapshot(value, ["usageOccurrences", "observedAccountedTokens", "observedOutputTokens"]);
  if (input === null || !integer(input.usageOccurrences, 0, PRIVATE_DAYS_MAX_DAY_HEADS)) return null;
  const total = decimal(input.observedAccountedTokens), output = decimal(input.observedOutputTokens);
  const count = BigInt(input.usageOccurrences);
  if (total === null || output === null || total < count || total > count * MAX_TOKEN_COUNT * (provider === 2 ? 5n : 3n)
    || output > count * MAX_TOKEN_COUNT || output > total) return null;
  return Object.freeze({ usageOccurrences: input.usageOccurrences,
    observedAccountedTokens: total.toString(), observedOutputTokens: output.toString() });
}

/** Validated fields are ASCII; count canonical JSON bytes without serialization hooks. */
function responseBytes(value: PrivateDaysV1): number {
  const providerBytes = (cell: ProviderImportedTotals) =>
    '{"usageOccurrences":,"observedAccountedTokens":"","observedOutputTokens":""}'.length
    + String(cell.usageOccurrences).length + cell.observedAccountedTokens.length + cell.observedOutputTokens.length;
  let size = '{"schemaVersion":1,"measurementProfile":"imported-tokens-v1","coverage":"partial","journalRevision":,"journalCommittedAtMs":,"firstUtcDay":,"days":[]}'.length
    + String(value.journalRevision).length + String(value.journalCommittedAtMs).length + String(value.firstUtcDay).length;
  for (const day of value.days) size += '{"utcDay":,"codex":,"claudeCode":,"devin":}'.length
    + String(day.utcDay).length + providerBytes(day.codex) + providerBytes(day.claudeCode) + providerBytes(day.devin);
  return size + value.days.length - 1;
}

/** Copy and validate a complete response against its request; never truncate. */
export function parsePrivateDaysValue(request: unknown, value: unknown): PrivateDaysV1 | null {
  try {
    const query = parsePrivateDaysRequest(request);
    const input = snapshot(value, ["schemaVersion", "measurementProfile", "coverage", "journalRevision", "journalCommittedAtMs", "firstUtcDay", "days"]);
    if (query === null || input === null || input.schemaVersion !== 1 || input.measurementProfile !== "imported-tokens-v1"
      || input.coverage !== "partial" || input.firstUtcDay !== query.firstUtcDay || Object.is(input.firstUtcDay, -0)
      || !integer(input.journalRevision, 0, PRIVATE_DAYS_MAX_REVISIONS)
      || (input.journalRevision === 0 ? input.journalCommittedAtMs !== null : !integer(input.journalCommittedAtMs, 0, MAX_TIME))
      || !Array.isArray(input.days) || Object.getPrototypeOf(input.days) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(input.days, "length");
    if (length === undefined || !("value" in length) || length.value !== query.dayCount) return null;
    const entries = Object.getOwnPropertyDescriptors(input.days);
    if (Reflect.ownKeys(entries).length !== query.dayCount + 1) return null;
    const days: PrivateDayV1[] = [];
    let occurrences = 0;
    for (let index = 0; index < query.dayCount; index++) {
      const entry = entries[String(index)];
      if (entry === undefined || !("value" in entry) || entry.enumerable !== true) return null;
      const day = snapshot(entry.value, ["utcDay", "codex", "claudeCode", "devin"]);
      if (day === null || day.utcDay !== query.firstUtcDay + index || Object.is(day.utcDay, -0)) return null;
      const codex = providerTotals(day.codex, 1), claudeCode = providerTotals(day.claudeCode, 2);
      const devin = providerTotals(day.devin, 3);
      if (codex === null || claudeCode === null || devin === null
        || codex.usageOccurrences + claudeCode.usageOccurrences + devin.usageOccurrences > PRIVATE_DAYS_MAX_DAY_HEADS) return null;
      occurrences += codex.usageOccurrences + claudeCode.usageOccurrences + devin.usageOccurrences;
      days.push(Object.freeze({ utcDay: day.utcDay as number, codex, claudeCode, devin }));
    }
    if (occurrences > PRIVATE_DAYS_MAX_HEADS || occurrences > 256 * input.journalRevision) return null;
    const result: PrivateDaysV1 = Object.freeze({ schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
      journalRevision: input.journalRevision, journalCommittedAtMs: input.journalCommittedAtMs as number | null,
      firstUtcDay: query.firstUtcDay, days: Object.freeze(days) });
    return responseBytes(result) <= PRIVATE_DAYS_MAX_RESPONSE_BYTES ? result : null;
  } catch { return null; }
}
