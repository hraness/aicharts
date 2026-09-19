/** Opt-in public leaderboard contracts. These shapes are the only public
 * projection: a consenting account's chosen handle plus numeric totals. No
 * email, account, or device identifier ever appears in a ranked entry. */

export const LEADERBOARD_WINDOW_DAYS = 30;
export const LEADERBOARD_MAX_ENTRIES = 128;
export const LEADERBOARD_MAX_MEMBERS = 128;
/** Singleton materialized-index object name; there is exactly one public index. */
export const LEADERBOARD_INDEX_NAME = "leaderboard-index-v1:public";
export const LEADERBOARD_HANDLE_MAX_LENGTH = 32;
export const LEADERBOARD_RANKING = "observed-tokens-30d-v1";
const MAX_TIME = 8_640_000_000_000_000;
const MAX_RECORDS = 100_000;

function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const owned: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
      owned[key] = descriptor.value as unknown;
    }
    return owned;
  } catch { return null; }
}
function enrollmentTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
}
/** Decimal string non-negative integers are the canonical token wire shape. */
export function leaderboardDecimal(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) && value.length <= 18;
}
/** Bounded public handles: lowercase, 1-32 chars, single interior hyphens. */
export function leaderboardPublicHandle(value: unknown): value is string {
  return typeof value === "string" && value.length <= LEADERBOARD_HANDLE_MAX_LENGTH
    && /^[a-z0-9](?:-?[a-z0-9])*$/u.test(value);
}
function utcDay(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
}
function recordCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_RECORDS;
}

/** The consent fields persisted on the enrolled account object. */
export type LeaderboardConsentViewV1 = Readonly<{
  schemaVersion: 1;
  consent: boolean;
  consentedAtMs: number | null;
  publicHandle: string | null;
}>;
export function parseLeaderboardConsentView(value: unknown): LeaderboardConsentViewV1 | null {
  const owned = snapshot(value, ["schemaVersion", "consent", "consentedAtMs", "publicHandle"]);
  if (owned?.schemaVersion !== 1 || typeof owned.consent !== "boolean") return null;
  if (owned.consent === false) {
    if (owned.consentedAtMs !== null || owned.publicHandle !== null) return null;
  } else if (!enrollmentTime(owned.consentedAtMs) || !leaderboardPublicHandle(owned.publicHandle)) return null;
  return Object.freeze({ schemaVersion: 1, consent: owned.consent,
    consentedAtMs: owned.consentedAtMs as number | null, publicHandle: owned.publicHandle as string | null });
}

/** Internal contribution read: the account object answers its own projection.
 * `accountId` exists only on this internal shape so the index can match the
 * reply to the member it queried; it never enters the public snapshot. */
export type LeaderboardProjectionV1 =
  | Readonly<{ schemaVersion: 1; accountId: string; consent: false }>
  | Readonly<{ schemaVersion: 1; accountId: string; consent: true; consentedAtMs: number; publicHandle: string;
      observedTokens: string; usageRecords: number; windowFirstUtcDay: number; windowUtcDays: number }>;
export function parseLeaderboardProjection(value: unknown): LeaderboardProjectionV1 | null {
  const declined = snapshot(value, ["schemaVersion", "accountId", "consent"]);
  if (declined?.schemaVersion === 1 && declined.consent === false
    && typeof declined.accountId === "string" && /^acct_[0-9a-f]{32}$/u.test(declined.accountId)) {
    return Object.freeze({ schemaVersion: 1, accountId: declined.accountId, consent: false });
  }
  const owned = snapshot(value, ["schemaVersion", "accountId", "consent", "consentedAtMs", "publicHandle",
    "observedTokens", "usageRecords", "windowFirstUtcDay", "windowUtcDays"]);
  if (owned?.schemaVersion !== 1 || owned.consent !== true
    || typeof owned.accountId !== "string" || !/^acct_[0-9a-f]{32}$/u.test(owned.accountId)
    || !enrollmentTime(owned.consentedAtMs) || !leaderboardPublicHandle(owned.publicHandle)
    || !leaderboardDecimal(owned.observedTokens) || !recordCount(owned.usageRecords)
    || !utcDay(owned.windowFirstUtcDay) || !utcDay(owned.windowUtcDays)
    || (owned.windowUtcDays as number) < 1 || (owned.windowUtcDays as number) > LEADERBOARD_WINDOW_DAYS
    || (owned.windowFirstUtcDay as number) + (owned.windowUtcDays as number) - 1 > 100_000_000) return null;
  return Object.freeze({ schemaVersion: 1, accountId: owned.accountId, consent: true,
    consentedAtMs: owned.consentedAtMs as number, publicHandle: owned.publicHandle,
    observedTokens: owned.observedTokens, usageRecords: owned.usageRecords as number,
    windowFirstUtcDay: owned.windowFirstUtcDay as number, windowUtcDays: owned.windowUtcDays as number });
}

/** One public ranked row. */
export type LeaderboardEntryV1 = Readonly<{
  rank: number;
  publicHandle: string;
  observedTokens: string;
  usageRecords: number;
  consentedAtMs: number;
  refreshedAtMs: number;
  windowFirstUtcDay: number;
  windowUtcDays: number;
}>;
export function parseLeaderboardEntry(value: unknown): LeaderboardEntryV1 | null {
  const owned = snapshot(value, ["rank", "publicHandle", "observedTokens", "usageRecords", "consentedAtMs",
    "refreshedAtMs", "windowFirstUtcDay", "windowUtcDays"]);
  if (owned === null || !recordCount(owned.rank) || (owned.rank as number) < 1
    || (owned.rank as number) > LEADERBOARD_MAX_ENTRIES || !leaderboardPublicHandle(owned.publicHandle)
    || !leaderboardDecimal(owned.observedTokens) || !recordCount(owned.usageRecords)
    || !enrollmentTime(owned.consentedAtMs) || !enrollmentTime(owned.refreshedAtMs)
    || !utcDay(owned.windowFirstUtcDay) || !utcDay(owned.windowUtcDays)
    || (owned.windowUtcDays as number) < 1 || (owned.windowUtcDays as number) > LEADERBOARD_WINDOW_DAYS
    || (owned.windowFirstUtcDay as number) + (owned.windowUtcDays as number) - 1 > 100_000_000) return null;
  return Object.freeze({ rank: owned.rank as number, publicHandle: owned.publicHandle,
    observedTokens: owned.observedTokens, usageRecords: owned.usageRecords as number,
    consentedAtMs: owned.consentedAtMs as number, refreshedAtMs: owned.refreshedAtMs as number,
    windowFirstUtcDay: owned.windowFirstUtcDay as number, windowUtcDays: owned.windowUtcDays as number });
}

/** The materialized public snapshot. This is the only object the public route
 * serves; it is rebuilt by the index object and never reflects a live account
 * enumeration at request time. */
export type LeaderboardSnapshotV1 = Readonly<{
  schemaVersion: 1;
  ranking: "observed-tokens-30d-v1";
  computedAtMs: number;
  entries: readonly LeaderboardEntryV1[];
}>;
export function parseLeaderboardSnapshot(value: unknown): LeaderboardSnapshotV1 | null {
  const owned = snapshot(value, ["schemaVersion", "ranking", "computedAtMs", "entries"]);
  if (owned?.schemaVersion !== 1 || owned.ranking !== LEADERBOARD_RANKING || !enrollmentTime(owned.computedAtMs)
    || !Array.isArray(owned.entries) || owned.entries.length > LEADERBOARD_MAX_ENTRIES) return null;
  const entries: LeaderboardEntryV1[] = [];
  for (const candidate of owned.entries) {
    const entry = parseLeaderboardEntry(candidate);
    if (entry === null) return null;
    entries.push(entry);
  }
  const ranks = new Set<number>();
  for (const entry of entries) ranks.add(entry.rank);
  if (ranks.size !== entries.length) return null;
  return Object.freeze({ schemaVersion: 1, ranking: LEADERBOARD_RANKING,
    computedAtMs: owned.computedAtMs as number, entries: Object.freeze(entries) });
}

export type LeaderboardRankable = Readonly<{
  publicHandle: string;
  observedTokens: string;
  usageRecords: number;
  consentedAtMs: number;
  refreshedAtMs: number;
  windowFirstUtcDay: number;
  windowUtcDays: number;
}>;
/** Pure deterministic ranking. Entries are sorted by total observed accounted
 * tokens over the trailing window, ties by record count then handle. Two
 * members claiming the same handle are both excluded rather than guessing
 * which consent is newer. */
export function rankLeaderboardEntries(input: readonly LeaderboardRankable[]): readonly LeaderboardEntryV1[] {
  const candidates: LeaderboardRankable[] = [];
  for (const entry of input) {
    if (!leaderboardPublicHandle(entry.publicHandle) || !leaderboardDecimal(entry.observedTokens)
      || !recordCount(entry.usageRecords) || !enrollmentTime(entry.consentedAtMs)
      || !enrollmentTime(entry.refreshedAtMs) || !utcDay(entry.windowFirstUtcDay)
      || !utcDay(entry.windowUtcDays) || entry.windowUtcDays < 1 || entry.windowUtcDays > LEADERBOARD_WINDOW_DAYS
      || entry.windowFirstUtcDay + entry.windowUtcDays - 1 > 100_000_000) continue;
    candidates.push(entry);
  }
  const claimed = new Map<string, number>();
  for (const entry of candidates) claimed.set(entry.publicHandle, (claimed.get(entry.publicHandle) ?? 0) + 1);
  const ranked = candidates.filter(entry => claimed.get(entry.publicHandle) === 1);
  ranked.sort((a, b) => {
    const tokens = BigInt(b.observedTokens) < BigInt(a.observedTokens) ? -1 : a.observedTokens === b.observedTokens ? 0 : 1;
    if (tokens !== 0) return tokens;
    if (a.usageRecords !== b.usageRecords) return b.usageRecords - a.usageRecords;
    return a.publicHandle < b.publicHandle ? -1 : 1;
  });
  const entries = ranked.slice(0, LEADERBOARD_MAX_ENTRIES).map((entry, index) => Object.freeze({
    rank: index + 1, publicHandle: entry.publicHandle, observedTokens: entry.observedTokens,
    usageRecords: entry.usageRecords, consentedAtMs: entry.consentedAtMs, refreshedAtMs: entry.refreshedAtMs,
    windowFirstUtcDay: entry.windowFirstUtcDay, windowUtcDays: entry.windowUtcDays }));
  return Object.freeze(entries);
}
