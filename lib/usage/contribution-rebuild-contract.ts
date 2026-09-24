import { contributionAccount, contributionIdentity, CONTRIBUTION_MAX_OPERATIONS, isContributionError,
  type ContributionError } from "./contribution-contract";
import { parseContributionIndexReference, type ContributionIndexReference } from "./contribution-index";
import { contributionIndexKey, CONTRIBUTION_INDEX_MAX_KEY_BYTES } from "./contribution-index-contract";
import { parseContributionCell, type ContributionCell } from "./contribution-rollups";
import { statsInteger, statsOwnRecord } from "./stats-contract";
import { statsJsonValue } from "./stats-http-contract";

export const CONTRIBUTION_REBUILD_MAX_JOBS = 16;
export const CONTRIBUTION_REBUILD_METADATA_BYTES = 16_384;
export const CONTRIBUTION_REBUILD_REQUEST_BYTES = 2_048;
export const CONTRIBUTION_REBUILD_RESPONSE_BYTES = 16_384;
export const CONTRIBUTION_REBUILD_DEADLINE_MS = 30_000;
export const CONTRIBUTION_REBUILD_MAX_VERSION = 32_771;
export const CONTRIBUTION_REBUILD_MAX_SOURCE_BYTES = 16_777_216;
export const CONTRIBUTION_REBUILD_MAX_COMPARISON_READS = 252;
export const CONTRIBUTION_REBUILD_MAX_COMPARISON_BYTES = 67_108_864;
// Head lookup/planning and stage readback each have a separate 32 MiB bound.
export const CONTRIBUTION_REBUILD_MAX_READS = 1_040;
export const CONTRIBUTION_REBUILD_MAX_READ_BYTES = 83_886_080;
export type ContributionRebuildError = ContributionError | "deadline" | "not_caught_up";
export const isContributionRebuildError = (value: unknown): value is ContributionRebuildError =>
  isContributionError(value) || value === "deadline" || value === "not_caught_up";
export type ContributionRebuildReadRequest = Readonly<{ schemaVersion: 3; accountId: string; generation: string; jobId: string }>;
export type ContributionRebuildAction = "begin" | "advance" | "abort" | "publish";
export type ContributionRebuildRequest = ContributionRebuildReadRequest & (
  Readonly<{ action: "begin"; expectedVersion: 0; expectedRevision: number }>
  | Readonly<{ action: "advance" | "abort" | "publish"; expectedVersion: number }>);
/** `published` records an explicit, separately reviewed repair cutover: the
 * verified scratch root replaced the current publication at the unchanged
 * source revision. `advance` never reaches it. */
export type ContributionRebuildPhase = "building" | "comparing" | "match" | "mismatch" | "aborted" | "published";
/** SELECT-only readiness of a retained job relative to the current canonical
 * position. `ready` means the next `advance` or `publish` may be attempted;
 * every refusal names the exact anchor rule that would refuse it. `terminal`
 * jobs are aborted or published and only readable. `unobserved` means the
 * reader supplied no authority and the anchor was not evaluated. */
export type ContributionRebuildReadiness = "ready" | "terminal" | "not_caught_up" | "legacy_unresolved" | "conflict"
  | "recovery_required" | "generation_conflict" | "clock_regressed" | "storage_invalid" | "unobserved";
export type ContributionRebuildBudget = Readonly<{
  sourceObjects: number; sourceBytes: number; indexObjects: number; indexBytes: number; writeObjects: number; writeBytes: number;
}>;
export type ContributionRebuildDifference = Readonly<{ key: string; rebuilt: ContributionCell | null; published: ContributionCell | null }>;
/** A diagnostic receipt is relative to retained canonical SQL authority. It
 * neither attests that SQL from genesis nor grants repair/publication authority.
 * Pending reservations are deliberately absent, so the last committed result
 * stays identical while a later request reserves its own pending step. */
export type ContributionRebuildReceipt = Readonly<{
  schemaVersion: 3; profile: "canonical-index-rebuild-v3"; scope: "full-index";
  accountId: string; generation: string; jobId: string; sourceRevision: number; headCount: number;
  publishedRoot: ContributionIndexReference | null; scratchRoot: ContributionIndexReference | null;
  version: number; phase: ContributionRebuildPhase; processedHeads: number; liveHeads: number;
  checkedCells: number; headSteps: number; comparisonSteps: number; chargedBytes: number;
  action: ContributionRebuildAction; expectedVersion: number; completedAtMs: number;
  difference: ContributionRebuildDifference | null; budget: ContributionRebuildBudget;
}>;
export type ContributionRebuildStatus = Readonly<{
  receipt: ContributionRebuildReceipt; pending: boolean; chargedBytes: number; readiness: ContributionRebuildReadiness;
}>;
export const isContributionRebuildReadiness = (value: unknown): value is ContributionRebuildReadiness =>
  value === "ready" || value === "terminal" || value === "not_caught_up" || value === "legacy_unresolved" || value === "conflict"
  || value === "recovery_required" || value === "generation_conflict" || value === "clock_regressed" || value === "storage_invalid" || value === "unobserved";
export type ContributionRebuildResult = Readonly<{ ok: true; value: ContributionRebuildReceipt }>
  | Readonly<{ ok: false; error: ContributionRebuildError }>;
export type ContributionRebuildStatusResult = Readonly<{ ok: true; value: ContributionRebuildStatus | null }>
  | Readonly<{ ok: false; error: ContributionRebuildError }>;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const phase = (value: unknown): value is ContributionRebuildPhase =>
  value === "building" || value === "comparing" || value === "match" || value === "mismatch" || value === "aborted" || value === "published";
const action = (value: unknown): value is ContributionRebuildAction =>
  value === "begin" || value === "advance" || value === "abort" || value === "publish";
export function parseContributionRebuildReadRequest(value: unknown): ContributionRebuildReadRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "jobId"]);
    return raw?.schemaVersion === 3 && contributionAccount(raw.accountId) && contributionIdentity(raw.generation) && contributionIdentity(raw.jobId)
      ? Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation, jobId: raw.jobId }) : null;
  } catch { return null; }
}
export function parseContributionRebuildRequest(value: unknown): ContributionRebuildRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "jobId", "action", "expectedVersion", "expectedRevision"])
      ?? statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "jobId", "action", "expectedVersion"]);
    const owner = raw ? parseContributionRebuildReadRequest({ schemaVersion: raw.schemaVersion, accountId: raw.accountId,
      generation: raw.generation, jobId: raw.jobId }) : null;
    if (!raw || !owner) return null;
    if (raw.action === "begin" && statsInteger(raw.expectedVersion, 0, 0) && statsInteger(raw.expectedRevision, 1, CONTRIBUTION_MAX_OPERATIONS))
      return Object.freeze({ ...owner, action: "begin", expectedVersion: 0, expectedRevision: raw.expectedRevision });
    return (raw.action === "advance" || raw.action === "abort" || raw.action === "publish") && !("expectedRevision" in raw)
      && statsInteger(raw.expectedVersion, 1, CONTRIBUTION_REBUILD_MAX_VERSION - 1)
      ? Object.freeze({ ...owner, action: raw.action, expectedVersion: raw.expectedVersion }) : null;
  } catch { return null; }
}
export const decodeContributionRebuildRequest = (value: Uint8Array): ContributionRebuildRequest | null =>
  parseContributionRebuildRequest(statsJsonValue(value, CONTRIBUTION_REBUILD_REQUEST_BYTES));
export function parseContributionRebuildBudget(value: unknown): ContributionRebuildBudget | null {
  try {
    const raw = statsOwnRecord(value, ["sourceObjects", "sourceBytes", "indexObjects", "indexBytes", "writeObjects", "writeBytes"]);
    if (!raw || !statsInteger(raw.sourceObjects, 0, 16) || !statsInteger(raw.sourceBytes, raw.sourceObjects, CONTRIBUTION_REBUILD_MAX_SOURCE_BYTES)
      || raw.sourceBytes > raw.sourceObjects * 1_048_576 || !statsInteger(raw.indexObjects, 0, 1_024)
      || !statsInteger(raw.indexBytes, raw.indexObjects, CONTRIBUTION_REBUILD_MAX_COMPARISON_BYTES)
      || raw.indexBytes > raw.indexObjects * 262_144 || !statsInteger(raw.writeObjects, 0, 512)
      || !statsInteger(raw.writeBytes, raw.writeObjects, 33_554_432) || raw.writeBytes > raw.writeObjects * 262_144
      || raw.sourceObjects + raw.indexObjects > CONTRIBUTION_REBUILD_MAX_READS
      || raw.sourceBytes + raw.indexBytes > CONTRIBUTION_REBUILD_MAX_READ_BYTES) return null;
    return Object.freeze({ sourceObjects: raw.sourceObjects, sourceBytes: raw.sourceBytes, indexObjects: raw.indexObjects,
      indexBytes: raw.indexBytes, writeObjects: raw.writeObjects, writeBytes: raw.writeBytes });
  } catch { return null; }
}
export function parseContributionRebuildDifference(value: unknown): ContributionRebuildDifference | null {
  try {
    const raw = statsOwnRecord(value, ["key", "rebuilt", "published"]);
    if (!raw || typeof raw.key !== "string" || bytes(raw.key) > CONTRIBUTION_INDEX_MAX_KEY_BYTES) return null;
    const rebuilt = raw.rebuilt === null ? null : parseContributionCell(raw.rebuilt), published = raw.published === null ? null : parseContributionCell(raw.published);
    if ((raw.rebuilt !== null && !rebuilt) || (raw.published !== null && !published) || (!rebuilt && !published)
      || (rebuilt && contributionIndexKey(rebuilt) !== raw.key) || (published && contributionIndexKey(published) !== raw.key)
      || same(rebuilt, published)) return null;
    return Object.freeze({ key: raw.key, rebuilt, published });
  } catch { return null; }
}
export function parseContributionRebuildReceipt(value: unknown): ContributionRebuildReceipt | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "profile", "scope", "accountId", "generation", "jobId", "sourceRevision", "headCount",
      "publishedRoot", "scratchRoot", "version", "phase", "processedHeads", "liveHeads", "checkedCells", "headSteps", "comparisonSteps", "chargedBytes",
      "action", "expectedVersion", "completedAtMs", "difference", "budget"]);
    if (!raw || raw.schemaVersion !== 3 || raw.profile !== "canonical-index-rebuild-v3" || raw.scope !== "full-index"
      || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation) || !contributionIdentity(raw.jobId)
      || !statsInteger(raw.sourceRevision, 1, CONTRIBUTION_MAX_OPERATIONS) || !statsInteger(raw.headCount, 0, 262_144)
      || !statsInteger(raw.version, 1, CONTRIBUTION_REBUILD_MAX_VERSION) || !phase(raw.phase)
      || !statsInteger(raw.processedHeads, 0, raw.headCount) || !statsInteger(raw.liveHeads, 0, raw.processedHeads)
      || !statsInteger(raw.checkedCells, 0, 262_144) || !statsInteger(raw.headSteps, 0, 16_384)
      || !statsInteger(raw.comparisonSteps, 0, 16_384) || !statsInteger(raw.chargedBytes, 0, 4_294_967_296)
      || !action(raw.action)
      || !statsInteger(raw.expectedVersion, 0, raw.version - 1) || raw.expectedVersion !== raw.version - 1
      || !statsInteger(raw.completedAtMs, 0, 8_640_000_000_000_000)) return null;
    const publishedRoot = raw.publishedRoot === null ? null : parseContributionIndexReference(raw.publishedRoot);
    const scratchRoot = raw.scratchRoot === null ? null : parseContributionIndexReference(raw.scratchRoot);
    const difference = raw.difference === null ? null : parseContributionRebuildDifference(raw.difference), budget = parseContributionRebuildBudget(raw.budget);
    if ((raw.publishedRoot !== null && !publishedRoot) || (raw.scratchRoot !== null && !scratchRoot)
      || (raw.difference !== null && !difference) || !budget || (raw.phase === "mismatch" && difference === null)
      || (difference !== null && raw.phase !== "mismatch" && raw.phase !== "published")
      || (raw.phase === "building" && raw.processedHeads >= raw.headCount)
      || ((raw.phase === "comparing" || raw.phase === "match" || raw.phase === "mismatch" || raw.phase === "published") && raw.processedHeads !== raw.headCount)
      || (raw.phase === "published") !== (raw.action === "publish") || (raw.phase === "aborted") !== (raw.action === "abort")
      || (scratchRoot?.cells ?? 0) > raw.liveHeads || raw.checkedCells > Math.min(scratchRoot?.cells ?? 0, publishedRoot?.cells ?? 0)
      || (raw.phase === "match" && ((scratchRoot?.cells ?? 0) !== raw.checkedCells || (publishedRoot?.cells ?? 0) !== raw.checkedCells))) return null;
    const result: ContributionRebuildReceipt = Object.freeze({ schemaVersion: 3, profile: "canonical-index-rebuild-v3", scope: "full-index",
      accountId: raw.accountId, generation: raw.generation, jobId: raw.jobId, sourceRevision: raw.sourceRevision, headCount: raw.headCount,
      publishedRoot, scratchRoot, version: raw.version, phase: raw.phase, processedHeads: raw.processedHeads, liveHeads: raw.liveHeads,
      checkedCells: raw.checkedCells, headSteps: raw.headSteps, comparisonSteps: raw.comparisonSteps, chargedBytes: raw.chargedBytes,
      action: raw.action, expectedVersion: raw.expectedVersion, completedAtMs: raw.completedAtMs, difference, budget });
    return bytes(JSON.stringify(result)) <= CONTRIBUTION_REBUILD_RESPONSE_BYTES ? result : null;
  } catch { return null; }
}
