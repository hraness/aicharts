import { contributionAccount, contributionIdentity, CONTRIBUTION_MAX_OPERATIONS,
  CONTRIBUTION_ERRORS, type ContributionError } from "./contribution-contract";
import { contributionIndexKey, CONTRIBUTION_INDEX_MAX_KEY_BYTES, CONTRIBUTION_INDEX_MAX_PAGE_CELLS } from "./contribution-index-contract";
import { parseContributionCell, type ContributionCell } from "./contribution-rollups";
import { STATS_MAX_DAY, STATS_MAX_DAYS, statsInteger, statsOwnRecord } from "./stats-contract";
import { statsJsonBytes, statsJsonValue } from "./stats-http-contract";

export const CONTRIBUTION_QUERY_URL = "https://usage.aicharts.io/v3/private/contributions";
export const CONTRIBUTION_QUERY_REQUEST_BYTES = 4_096;
export const CONTRIBUTION_QUERY_RESPONSE_BYTES = 1_048_576;
export type ContributionQueryCursor = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; revision: number; rootHash: string;
  firstUtcDay: number; dayCount: number; limit: number; afterKey: string;
}>;
export type ContributionQuery = Readonly<{
  schemaVersion: 3; accountId: string; sessionExpiresAtMs: number;
  firstUtcDay: number; dayCount: number; limit: number; cursor: ContributionQueryCursor | null;
}>;
/** A page contains complete cells, never a complete-range subtotal. The source
 * and snapshot watermarks distinguish absence of observations from backfill.
 * Observed-only coverage is not a claim that all client activity was captured. */
export type ContributionQueryPage = Readonly<{
  schemaVersion: 3; profile: "contribution-cells-v3"; coverage: "observed-only";
  accountId: string; generation: string; observedAtMs: number;
  sourceRevision: number; latestAppliedRevision: number; latestPublishedRevision: number;
  appliedLag: number; publishedLag: number; snapshotRevision: number; snapshotLag: number;
  rootHash: string | null; unresolvedLegacyBodies: number; firstUtcDay: number; dayCount: number;
  cells: readonly ContributionCell[]; next: ContributionQueryCursor | null;
}>;
export type ContributionQueryError = ContributionError | "snapshot_expired" | "expired";
export type ContributionQueryResult = Readonly<{ ok: true; value: ContributionQueryPage }>
  | Readonly<{ ok: false; error: ContributionQueryError }>;
const MAX_TIME = 8_640_000_000_000_000;
const range = (first: unknown, count: unknown): boolean => statsInteger(first, 0, STATS_MAX_DAY)
  && statsInteger(count, 1, STATS_MAX_DAYS) && first + count - 1 <= STATS_MAX_DAY;
function keyInRange(value: unknown, first: number, count: number): value is string {
  if (typeof value !== "string" || value.length > CONTRIBUTION_INDEX_MAX_KEY_BYTES
    || new TextEncoder().encode(value).byteLength > CONTRIBUTION_INDEX_MAX_KEY_BYTES || !/^[0-9]{8}:\[/u.test(value)) return false;
  const day = Number(value.slice(0, 8)); return day >= first && day < first + count;
}
export function parseContributionQueryCursor(value: unknown): ContributionQueryCursor | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "revision", "rootHash", "firstUtcDay", "dayCount", "limit", "afterKey"]);
    if (raw?.schemaVersion !== 3 || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)
      || !statsInteger(raw.revision, 1, CONTRIBUTION_MAX_OPERATIONS) || !contributionIdentity(raw.rootHash)
      || !range(raw.firstUtcDay, raw.dayCount) || !statsInteger(raw.limit, 1, CONTRIBUTION_INDEX_MAX_PAGE_CELLS)
      || !keyInRange(raw.afterKey, raw.firstUtcDay as number, raw.dayCount as number)) return null;
    return Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation, revision: raw.revision,
      rootHash: raw.rootHash, firstUtcDay: raw.firstUtcDay as number, dayCount: raw.dayCount as number, limit: raw.limit, afterKey: raw.afterKey });
  } catch { return null; }
}
export function parseContributionQuery(value: unknown): ContributionQuery | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "sessionExpiresAtMs", "firstUtcDay", "dayCount", "limit", "cursor"]);
    if (raw?.schemaVersion !== 3 || !contributionAccount(raw.accountId) || !statsInteger(raw.sessionExpiresAtMs, 1, MAX_TIME)
      || !range(raw.firstUtcDay, raw.dayCount) || !statsInteger(raw.limit, 1, CONTRIBUTION_INDEX_MAX_PAGE_CELLS)) return null;
    const cursor = raw.cursor === null ? null : parseContributionQueryCursor(raw.cursor);
    if (raw.cursor !== null && (!cursor || cursor.accountId !== raw.accountId || cursor.firstUtcDay !== raw.firstUtcDay
      || cursor.dayCount !== raw.dayCount || cursor.limit !== raw.limit)) return null;
    return Object.freeze({ schemaVersion: 3, accountId: raw.accountId, sessionExpiresAtMs: raw.sessionExpiresAtMs,
      firstUtcDay: raw.firstUtcDay as number, dayCount: raw.dayCount as number, limit: raw.limit, cursor });
  } catch { return null; }
}
function array(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = descriptors[String(index)]; if (!item || !("value" in item) || !item.enumerable) return null;
    result.push(item.value as unknown);
  }
  return result;
}
export function parseContributionQueryPage(input: ContributionQuery, value: unknown): ContributionQueryPage | null {
  try {
    const query = parseContributionQuery(input), raw = statsOwnRecord(value, ["schemaVersion", "profile", "coverage", "accountId", "generation",
      "observedAtMs", "sourceRevision", "latestAppliedRevision", "latestPublishedRevision", "appliedLag", "publishedLag",
      "snapshotRevision", "snapshotLag", "rootHash", "unresolvedLegacyBodies",
      "firstUtcDay", "dayCount", "cells", "next"]);
    if (!query || raw?.schemaVersion !== 3 || raw.profile !== "contribution-cells-v3" || raw.coverage !== "observed-only"
      || raw.accountId !== query.accountId || !contributionIdentity(raw.generation) || !statsInteger(raw.observedAtMs, 0, query.sessionExpiresAtMs - 1)
      || raw.firstUtcDay !== query.firstUtcDay || raw.dayCount !== query.dayCount
      || !statsInteger(raw.sourceRevision, 0, CONTRIBUTION_MAX_OPERATIONS)
      || !statsInteger(raw.latestAppliedRevision, 0, raw.sourceRevision)
      || !statsInteger(raw.latestPublishedRevision, 0, raw.latestAppliedRevision) || !statsInteger(raw.snapshotRevision, 0, raw.latestPublishedRevision)
      || !statsInteger(raw.appliedLag, 0, CONTRIBUTION_MAX_OPERATIONS) || !statsInteger(raw.publishedLag, 0, CONTRIBUTION_MAX_OPERATIONS)
      || raw.appliedLag !== raw.sourceRevision - raw.latestAppliedRevision || raw.publishedLag !== raw.sourceRevision - raw.latestPublishedRevision
      || !statsInteger(raw.snapshotLag, 0, CONTRIBUTION_MAX_OPERATIONS) || raw.snapshotLag !== raw.sourceRevision - raw.snapshotRevision
      || (raw.rootHash !== null && !contributionIdentity(raw.rootHash)) || !statsInteger(raw.unresolvedLegacyBodies, 0, 65_536)) return null;
    // A first page selects the latest publication at the start of the read.
    // A newer publication may finish during object I/O; continuations remain
    // pinned while the latest watermark honestly reports that advancement.
    if (query.cursor && (raw.snapshotRevision !== query.cursor.revision || raw.generation !== query.cursor.generation || raw.rootHash !== query.cursor.rootHash)) return null;
    const values = array(raw.cells, query.limit); if (!values) return null;
    const cells: ContributionCell[] = []; let previous = query.cursor?.afterKey ?? "";
    for (const value of values) {
      const cell = parseContributionCell(value); if (!cell || cell.dimensions.utcDay < query.firstUtcDay || cell.dimensions.utcDay >= query.firstUtcDay + query.dayCount) return null;
      const key = contributionIndexKey(cell); if (key <= previous) return null;
      cells.push(cell); previous = key;
    }
    if ((raw.rootHash === null || raw.snapshotRevision === 0) && (cells.length > 0 || raw.next !== null || raw.rootHash !== null)) return null;
    const next = raw.next === null ? null : parseContributionQueryCursor(raw.next);
    if (raw.next !== null && (!next || cells.length !== query.limit || next.accountId !== query.accountId || next.generation !== raw.generation
      || next.revision !== raw.snapshotRevision || next.rootHash !== raw.rootHash || next.firstUtcDay !== query.firstUtcDay
      || next.dayCount !== query.dayCount || next.limit !== query.limit || next.afterKey !== previous)) return null;
    return Object.freeze({ schemaVersion: 3, profile: "contribution-cells-v3", coverage: "observed-only", accountId: query.accountId,
      generation: raw.generation, observedAtMs: raw.observedAtMs, sourceRevision: raw.sourceRevision,
      latestAppliedRevision: raw.latestAppliedRevision, latestPublishedRevision: raw.latestPublishedRevision,
      appliedLag: raw.appliedLag, publishedLag: raw.publishedLag,
      snapshotRevision: raw.snapshotRevision, snapshotLag: raw.snapshotLag, rootHash: raw.rootHash as string | null,
      unresolvedLegacyBodies: raw.unresolvedLegacyBodies, firstUtcDay: query.firstUtcDay, dayCount: query.dayCount,
      cells: Object.freeze(cells), next });
  } catch { return null; }
}
export function parseContributionQueryResult(query: ContributionQuery, value: unknown): ContributionQueryResult | null {
  try {
    const success = statsOwnRecord(value, ["ok", "value"]);
    if (success?.ok === true) {
      const page = parseContributionQueryPage(query, success.value); return page ? Object.freeze({ ok: true, value: page }) : null;
    }
    const failure = statsOwnRecord(value, ["ok", "error"]);
    return failure?.ok === false && (failure.error === "snapshot_expired" || failure.error === "expired" || CONTRIBUTION_ERRORS.includes(failure.error as ContributionError))
      ? Object.freeze({ ok: false, error: failure.error as ContributionQueryError }) : null;
  } catch { return null; }
}
export const decodeContributionQuery = (bytes: Uint8Array): ContributionQuery | null =>
  bytes.byteLength <= CONTRIBUTION_QUERY_REQUEST_BYTES ? parseContributionQuery(statsJsonValue(bytes, CONTRIBUTION_QUERY_REQUEST_BYTES)) : null;
export const encodeContributionQueryResult = (query: ContributionQuery, value: unknown): Uint8Array<ArrayBuffer> | null => {
  const result = parseContributionQueryResult(query, value);
  return result ? statsJsonBytes({ schemaVersion: 3, result }, CONTRIBUTION_QUERY_RESPONSE_BYTES) : null;
};
