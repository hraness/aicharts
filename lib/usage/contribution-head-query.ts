import { contributionAccount, contributionHex, contributionIdentity, CONTRIBUTION_MAX_OPERATIONS,
  isContributionError, type ContributionResult } from "./contribution-contract";
import { statsInteger, statsOwnRecord } from "./stats-contract";
import { statsJsonBytes, statsJsonValue } from "./stats-http-contract";
import type { ContributionHead, ContributionPopulation, ContributionReference } from "./contributions";

export const CONTRIBUTION_HEAD_QUERY_MAX_IDS = 256;
export const CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES = 16_384;
export const CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES = 524_288;
type Owner = Readonly<{ schemaVersion: 3; accountId: string; generation: string; deviceId: string; populationId: string; writerRevision: number }>;
export type ContributionMemberCursor = Owner & Readonly<{
  revision: number; populationRevision: number; populationHead: string; afterId: string;
}>;
export type ContributionHeadQuery = Owner & Readonly<{ expectedRevision: number | null }> & (
  Readonly<{ mode: "heads"; ids: readonly string[] }>
  | Readonly<{ mode: "members"; limit: number; cursor: ContributionMemberCursor | null }>
);
/** Canonical heads and a population's last assertion are distinct. A mirror's
 * membershipHeadHash can precede the current headHash after another writer
 * corrects the same observation. No numeric payload is inferred from a hash. */
export type ContributionHeadEntry = Readonly<{ id: string; head: ContributionHead | null; membershipHeadHash: string | null }>;
/** Recovery enumerates one current population. A cursor names its exact
 * canonical revision; it grants no authority to read a historical snapshot.
 * Consumers must collect every page and match population.memberCount before
 * treating the membership set as complete. */
export type ContributionHeadPage = Readonly<{
  schemaVersion: 3; profile: "contribution-heads-v3"; mode: "heads" | "members";
  accountId: string; generation: string; deviceId: string; revision: number; observedAtMs: number;
  population: ContributionPopulation; entries: readonly ContributionHeadEntry[]; next: ContributionMemberCursor | null;
}>;
export type ContributionHeadQueryResult = ContributionResult<ContributionHeadPage>;
const ZERO_HASH = "0".repeat(64);
const revision = (value: unknown): value is number => statsInteger(value, 0, CONTRIBUTION_MAX_OPERATIONS);
function owner(raw: Record<string, unknown>): Owner | null {
  return raw.schemaVersion === 3 && contributionAccount(raw.accountId) && contributionIdentity(raw.generation)
    && contributionIdentity(raw.deviceId) && contributionIdentity(raw.populationId) && statsInteger(raw.writerRevision, 1, CONTRIBUTION_MAX_OPERATIONS)
    ? { schemaVersion: 3, accountId: raw.accountId, generation: raw.generation, deviceId: raw.deviceId,
      populationId: raw.populationId, writerRevision: raw.writerRevision } : null;
}
function sameOwner(left: Owner, right: Owner): boolean {
  return left.accountId === right.accountId && left.generation === right.generation && left.deviceId === right.deviceId
    && left.populationId === right.populationId && left.writerRevision === right.writerRevision;
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
export function parseContributionMemberCursor(value: unknown): ContributionMemberCursor | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "deviceId", "populationId", "writerRevision",
      "revision", "populationRevision", "populationHead", "afterId"]), binding = raw ? owner(raw) : null;
    return raw && binding && revision(raw.revision) && statsInteger(raw.populationRevision, 0, raw.revision)
      && contributionHex(raw.populationHead) && ((raw.populationRevision === 0) === (raw.populationHead === ZERO_HASH))
      && contributionIdentity(raw.afterId, 32)
      ? Object.freeze({ ...binding, revision: raw.revision, populationRevision: raw.populationRevision,
        populationHead: raw.populationHead, afterId: raw.afterId }) : null;
  } catch { return null; }
}
export function parseContributionHeadQuery(value: unknown): ContributionHeadQuery | null {
  try {
    const fields = ["schemaVersion", "accountId", "generation", "deviceId", "populationId", "writerRevision", "expectedRevision", "mode"];
    const named = statsOwnRecord(value, [...fields, "ids"]);
    const raw = named ?? statsOwnRecord(value, [...fields, "limit", "cursor"]), binding = raw ? owner(raw) : null;
    if (!raw || !binding || (raw.expectedRevision !== null && !revision(raw.expectedRevision))) return null;
    if (named) {
      if (raw.mode !== "heads") return null;
      const ids = array(raw.ids, CONTRIBUTION_HEAD_QUERY_MAX_IDS);
      if (!ids?.length || ids.some((id, index) => !contributionIdentity(id, 32) || (index > 0 && String(ids[index - 1]) >= id))) return null;
      return Object.freeze({ ...binding, expectedRevision: raw.expectedRevision, mode: "heads", ids: Object.freeze(ids as string[]) });
    }
    if (raw.mode !== "members" || !statsInteger(raw.limit, 1, CONTRIBUTION_HEAD_QUERY_MAX_IDS)) return null;
    const cursor = raw.cursor === null ? null : parseContributionMemberCursor(raw.cursor);
    if (raw.cursor !== null && (!cursor || !sameOwner(binding, cursor) || raw.expectedRevision !== cursor.revision)) return null;
    return Object.freeze({ ...binding, expectedRevision: raw.expectedRevision, mode: "members", limit: raw.limit, cursor });
  } catch { return null; }
}
// These browser-side wire bounds mirror the canonical state contract. Runtime
// hash implementations stay in the server kernel; its types erase at build.
function population(value: unknown): ContributionPopulation | null {
  const raw = statsOwnRecord(value, ["id", "generation", "deviceId", "writerRevision", "revision", "headHash", "memberCount"]);
  return raw && contributionIdentity(raw.id) && contributionIdentity(raw.generation) && contributionIdentity(raw.deviceId)
    && statsInteger(raw.writerRevision, 1, CONTRIBUTION_MAX_OPERATIONS) && revision(raw.revision)
    && contributionHex(raw.headHash) && ((raw.revision === 0) === (raw.headHash === ZERO_HASH)) && statsInteger(raw.memberCount, 0, 8_192)
    ? Object.freeze({ id: raw.id, generation: raw.generation, deviceId: raw.deviceId, writerRevision: raw.writerRevision,
      revision: raw.revision, headHash: raw.headHash, memberCount: raw.memberCount }) : null;
}
function reference(value: unknown): ContributionReference | null {
  const v3 = statsOwnRecord(value, ["kind", "bodyHash", "index", "payloadHash"]);
  if (v3?.kind === "batch-v3" && contributionIdentity(v3.bodyHash) && statsInteger(v3.index, 0, 255) && contributionIdentity(v3.payloadHash))
    return Object.freeze({ kind: "batch-v3", bodyHash: v3.bodyHash, index: v3.index, payloadHash: v3.payloadHash });
  const v1 = statsOwnRecord(value, ["kind", "generation", "bodyHash", "index", "payloadHash", "operationHash"]);
  return v1?.kind === "admission-v1" && contributionIdentity(v1.generation) && contributionIdentity(v1.bodyHash)
    && statsInteger(v1.index, 0, 255) && contributionIdentity(v1.payloadHash) && contributionIdentity(v1.operationHash)
    ? Object.freeze({ kind: "admission-v1", generation: v1.generation, bodyHash: v1.bodyHash, index: v1.index,
      payloadHash: v1.payloadHash, operationHash: v1.operationHash }) : null;
}
function head(value: unknown): ContributionHead | null {
  const raw = statsOwnRecord(value, ["id", "headHash", "payloadHash", "reference", "members", "deleted", "legacySupport", "suppressedLegacy"]);
  if (!raw || !contributionIdentity(raw.id, 32) || !contributionIdentity(raw.headHash) || !statsInteger(raw.members, 0, 1_024)
    || typeof raw.deleted !== "boolean" || typeof raw.legacySupport !== "boolean" || typeof raw.suppressedLegacy !== "boolean") return null;
  const source = raw.reference === null ? null : reference(raw.reference);
  if (raw.deleted ? raw.payloadHash !== null || raw.reference !== null
    : !contributionIdentity(raw.payloadHash) || !source || source.payloadHash !== raw.payloadHash) return null;
  return Object.freeze({ id: raw.id, headHash: raw.headHash, payloadHash: raw.payloadHash as string | null,
    reference: source, members: raw.members, deleted: raw.deleted, legacySupport: raw.legacySupport, suppressedLegacy: raw.suppressedLegacy });
}
export function parseContributionHeadPage(input: ContributionHeadQuery, value: unknown): ContributionHeadPage | null {
  try {
    const query = parseContributionHeadQuery(input), raw = statsOwnRecord(value, ["schemaVersion", "profile", "mode", "accountId", "generation",
      "deviceId", "revision", "observedAtMs", "population", "entries", "next"]), selected = raw ? population(raw.population) : null;
    if (!query || raw?.schemaVersion !== 3 || raw.profile !== "contribution-heads-v3" || raw.mode !== query.mode
      || raw.accountId !== query.accountId || raw.generation !== query.generation || raw.deviceId !== query.deviceId || !revision(raw.revision)
      || (query.expectedRevision !== null && query.expectedRevision !== raw.revision) || !statsInteger(raw.observedAtMs, 0, 8_640_000_000_000_000)
      || !selected || selected.id !== query.populationId || selected.generation !== query.generation || selected.deviceId !== query.deviceId
      || selected.writerRevision !== query.writerRevision || selected.revision > raw.revision) return null;
    if (query.mode === "members" && query.cursor && (selected.revision !== query.cursor.populationRevision || selected.headHash !== query.cursor.populationHead)) return null;
    const items = array(raw.entries, query.mode === "heads" ? query.ids.length : query.limit);
    if (!items || (query.mode === "heads" && items.length !== query.ids.length)) return null;
    const entries: ContributionHeadEntry[] = []; let prior = query.mode === "members" ? query.cursor?.afterId ?? "" : "", memberships = 0;
    for (const [index, item] of items.entries()) {
      const row = statsOwnRecord(item, ["id", "head", "membershipHeadHash"]), current = row?.head === null ? null : head(row?.head);
      if (!row || !contributionIdentity(row.id, 32) || row.id <= prior || (row.head !== null && (!current || current.id !== row.id))
        || (row.membershipHeadHash !== null && (!contributionIdentity(row.membershipHeadHash) || !current || current.members < 1))
        || (query.mode === "heads" ? row.id !== query.ids[index] : row.membershipHeadHash === null)) return null;
      if (row.membershipHeadHash !== null) memberships++;
      entries.push(Object.freeze({ id: row.id, head: current, membershipHeadHash: row.membershipHeadHash as string | null })); prior = row.id;
    }
    if (memberships > selected.memberCount) return null;
    const next = raw.next === null ? null : parseContributionMemberCursor(raw.next);
    if (raw.next !== null && (!next || query.mode !== "members" || !sameOwner(next, query) || entries.length !== query.limit
      || next.revision !== raw.revision || next.populationRevision !== selected.revision || next.populationHead !== selected.headHash || next.afterId !== prior)) return null;
    if (query.mode === "members" && query.cursor === null
      && (next === null ? entries.length !== selected.memberCount : entries.length >= selected.memberCount)) return null;
    return Object.freeze({ schemaVersion: 3, profile: "contribution-heads-v3", mode: query.mode, accountId: query.accountId,
      generation: query.generation, deviceId: query.deviceId, revision: raw.revision, observedAtMs: raw.observedAtMs,
      population: selected, entries: Object.freeze(entries), next });
  } catch { return null; }
}
export function parseContributionHeadQueryResult(query: ContributionHeadQuery, value: unknown): ContributionHeadQueryResult | null {
  try {
    if (!parseContributionHeadQuery(query)) return null;
    const success = statsOwnRecord(value, ["ok", "value"]);
    if (success?.ok === true) {
      const page = parseContributionHeadPage(query, success.value); return page ? Object.freeze({ ok: true, value: page }) : null;
    }
    const failure = statsOwnRecord(value, ["ok", "error"]);
    return failure?.ok === false && isContributionError(failure.error) ? Object.freeze({ ok: false, error: failure.error }) : null;
  } catch { return null; }
}
export const decodeContributionHeadQuery = (bytes: Uint8Array): ContributionHeadQuery | null =>
  bytes.byteLength <= CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES ? parseContributionHeadQuery(statsJsonValue(bytes, CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES)) : null;
export const encodeContributionHeadQueryResult = (query: ContributionHeadQuery, value: unknown): Uint8Array<ArrayBuffer> | null => {
  const result = parseContributionHeadQueryResult(query, value);
  return result ? statsJsonBytes({ schemaVersion: 3, result }, CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES) : null;
};
