import { contributionAccount, contributionIdentity, CONTRIBUTION_MAX_OPERATIONS, isContributionError,
  type ContributionError } from "./contribution-contract";
import { parseContributionCell, MAX_CONTRIBUTION_ROLLUP_VALUE, type ContributionCell, type ContributionCellDimensions } from "./contribution-rollups";
import { parseUsageStatsRow, statsInteger, statsOwnRecord, STATS_TOKEN_KEYS, type UsageStatsRow } from "./stats-contract";
import { statsJsonBytes, statsJsonValue } from "./stats-http-contract";

// Temporary admitted read envelope, not physical storage or whole-account proof.
export const CONTRIBUTION_SCRUB_MAX_HEADS = 16;
export const CONTRIBUTION_SCRUB_MAX_SOURCE_BYTES = 16_777_216;
export const CONTRIBUTION_SCRUB_MAX_INDEX_READS = 7;
export const CONTRIBUTION_SCRUB_MAX_READS = 23;
export const CONTRIBUTION_SCRUB_MAX_READ_BYTES = 18_874_368;
export const CONTRIBUTION_SCRUB_DEADLINE_MS = 30_000;
export const CONTRIBUTION_SCRUB_REQUEST_BYTES = 2_048;
export const CONTRIBUTION_SCRUB_RESPONSE_BYTES = 8_192;
export type ContributionScrubRequest = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; expectedRevision: number; dimensions: ContributionCellDimensions;
}>;
export type ContributionScrubError = ContributionError | "deadline" | "not_caught_up" | "scope_limit";
export type ContributionScrubReceipt = Readonly<{
  schemaVersion: 3; profile: "canonical-cell-scrub-v3"; scope: "single-cell";
  accountId: string; generation: string; revision: number; rootHash: string | null; dimensions: ContributionCellDimensions;
  verdict: "match" | "mismatch"; expected: ContributionCell | null; published: ContributionCell | null;
  checkedHeads: number; liveHeads: number; matchingHeads: number;
  sourceObjects: number; indexObjects: number; sourceBytes: number; indexBytes: number; readBytes: number;
}>;
export type ContributionScrubResult = Readonly<{ ok: true; value: ContributionScrubReceipt }>
  | Readonly<{ ok: false; error: ContributionScrubError }>;

/** Validate cohort shape through the shared schema, without sharing projection arithmetic. */
function dimensions(value: unknown): ContributionCellDimensions | null {
  const raw = statsOwnRecord(value, ["utcDay", "client", "provider", "model", "tokenBasis", "breakdownCoverage", "costKind", "timed"]);
  if (!raw) return null;
  return parseContributionCell({ schemaVersion: 3, dimensions: raw, observations: 1,
    tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    costMicrousd: raw.costKind === "none" ? null : "0", durationMs: raw.timed === true ? "0" : null, timedTokens: "0" })?.dimensions ?? null;
}
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
export function parseContributionScrubRequest(value: unknown): ContributionScrubRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "expectedRevision", "dimensions"]);
    const selected = raw ? dimensions(raw.dimensions) : null;
    return raw?.schemaVersion === 3 && contributionAccount(raw.accountId) && contributionIdentity(raw.generation)
      && statsInteger(raw.expectedRevision, 0, CONTRIBUTION_MAX_OPERATIONS) && selected
      ? Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation,
        expectedRevision: raw.expectedRevision, dimensions: selected }) : null;
  } catch { return null; }
}
export const decodeContributionScrubRequest = (bytes: Uint8Array): ContributionScrubRequest | null =>
  parseContributionScrubRequest(statsJsonValue(bytes, CONTRIBUTION_SCRUB_REQUEST_BYTES));

/** The receipt establishes one materialized cell relative to canonical heads.
 * It does not audit canonical SQL from genesis, prove source truth, or qualify
 * other cells, legacy imports, external authority or backup completeness. */
export function parseContributionScrubReceipt(input: ContributionScrubRequest, value: unknown): ContributionScrubReceipt | null {
  try {
    const request = parseContributionScrubRequest(input), raw = statsOwnRecord(value, ["schemaVersion", "profile", "scope", "accountId", "generation",
      "revision", "rootHash", "dimensions", "verdict", "expected", "published", "checkedHeads", "liveHeads", "matchingHeads",
      "sourceObjects", "indexObjects", "sourceBytes", "indexBytes", "readBytes"]), selected = raw ? dimensions(raw.dimensions) : null;
    if (!request || raw?.schemaVersion !== 3 || raw.profile !== "canonical-cell-scrub-v3" || raw.scope !== "single-cell"
      || raw.accountId !== request.accountId || raw.generation !== request.generation || raw.revision !== request.expectedRevision
      || (raw.rootHash !== null && !contributionIdentity(raw.rootHash)) || !selected || !same(selected, request.dimensions)
      || !statsInteger(raw.checkedHeads, 0, CONTRIBUTION_SCRUB_MAX_HEADS) || !statsInteger(raw.liveHeads, 0, raw.checkedHeads)
      || !statsInteger(raw.matchingHeads, 0, raw.liveHeads) || raw.sourceObjects !== raw.liveHeads
      || !statsInteger(raw.indexObjects, raw.rootHash === null ? 0 : 1, CONTRIBUTION_SCRUB_MAX_INDEX_READS)
      || (raw.rootHash === null && raw.indexObjects !== 0) || raw.sourceObjects + raw.indexObjects > CONTRIBUTION_SCRUB_MAX_READS
      || !statsInteger(raw.sourceBytes, raw.sourceObjects, raw.sourceObjects * 1_048_576)
      || raw.sourceBytes > CONTRIBUTION_SCRUB_MAX_SOURCE_BYTES
      || !statsInteger(raw.indexBytes, raw.indexObjects, raw.indexObjects * 262_144)
      || !statsInteger(raw.readBytes, 0, CONTRIBUTION_SCRUB_MAX_READ_BYTES) || raw.readBytes !== raw.sourceBytes + raw.indexBytes) return null;
    const expected = raw.expected === null ? null : parseContributionCell(raw.expected), published = raw.published === null ? null : parseContributionCell(raw.published);
    const verdict = same(expected, published) ? "match" : "mismatch";
    if ((raw.expected !== null && (!expected || !same(expected.dimensions, selected)))
      || (raw.published !== null && (!published || !same(published.dimensions, selected)))
      || (expected?.observations ?? 0) !== raw.matchingHeads || (raw.rootHash === null && published !== null)
      || raw.verdict !== verdict) return null;
    return Object.freeze({ schemaVersion: 3, profile: "canonical-cell-scrub-v3", scope: "single-cell", accountId: request.accountId,
      generation: request.generation, revision: request.expectedRevision, rootHash: raw.rootHash as string | null, dimensions: selected,
      verdict, expected, published, checkedHeads: raw.checkedHeads, liveHeads: raw.liveHeads, matchingHeads: raw.matchingHeads,
      sourceObjects: raw.sourceObjects, indexObjects: raw.indexObjects, sourceBytes: raw.sourceBytes, indexBytes: raw.indexBytes, readBytes: raw.readBytes });
  } catch { return null; }
}
export function parseContributionScrubResult(request: ContributionScrubRequest, value: unknown): ContributionScrubResult | null {
  try {
    const success = statsOwnRecord(value, ["ok", "value"]);
    if (success?.ok === true) { const receipt = parseContributionScrubReceipt(request, success.value); return receipt ? { ok: true, value: receipt } : null; }
    const failure = statsOwnRecord(value, ["ok", "error"]);
    return parseContributionScrubRequest(request) && failure?.ok === false
      && (isContributionError(failure.error) || failure.error === "deadline" || failure.error === "not_caught_up" || failure.error === "scope_limit")
      ? { ok: false, error: failure.error } : null;
  } catch { return null; }
}
export const encodeContributionScrubResult = (request: ContributionScrubRequest, value: unknown): Uint8Array<ArrayBuffer> | null => {
  const result = parseContributionScrubResult(request, value);
  return result ? statsJsonBytes({ schemaVersion: 3, result }, CONTRIBUTION_SCRUB_RESPONSE_BYTES) : null;
};

/** Addition from zero for one exact cohort. This deliberately does not call
 * planContributionRollups, its update helper, or any projection delta reader. */
export class ContributionCellScrubFold {
  readonly #dimensions: ContributionCellDimensions;
  #observations = 0;
  #tokens = { input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n, reasoning: 0n };
  #cost = 0n; #duration = 0n; #timedTokens = 0n;
  constructor(input: ContributionCellDimensions) {
    const selected = dimensions(input); if (!selected) throw new Error("invalid_scrub_cohort"); this.#dimensions = selected;
  }
  add(input: UsageStatsRow): boolean {
    const row = parseUsageStatsRow(input);
    if (!row || row.records !== 1) throw new Error("invalid_scrub_row");
    const target = this.#dimensions;
    const costKind = row.reportedCostMicrousd === null ? row.estimatedCostMicrousd === null ? "none" : "estimated" : "reported";
    if (row.utcDay !== target.utcDay || row.client !== target.client || row.provider !== target.provider || row.model !== target.model
      || row.tokenBasis !== target.tokenBasis || row.breakdownCoverage !== target.breakdownCoverage
      || costKind !== target.costKind || (row.durationMs !== null) !== target.timed) return false;
    if (this.#observations === CONTRIBUTION_SCRUB_MAX_HEADS) throw new Error("scrub_limit");
    const checked = (value: bigint) => { if (value > MAX_CONTRIBUTION_ROLLUP_VALUE) throw new Error("scrub_overflow"); return value; };
    const tokens = { ...this.#tokens }; for (const key of STATS_TOKEN_KEYS) tokens[key] = checked(tokens[key] + BigInt(row.tokens[key]));
    checked(STATS_TOKEN_KEYS.reduce((sum, key) => sum + tokens[key], 0n));
    const cost = checked(this.#cost + BigInt(row.reportedCostMicrousd ?? row.estimatedCostMicrousd ?? "0"));
    const duration = checked(this.#duration + BigInt(row.durationMs ?? "0")), timedTokens = checked(this.#timedTokens + BigInt(row.timedTokens));
    this.#tokens = tokens; this.#cost = cost; this.#duration = duration; this.#timedTokens = timedTokens; this.#observations++;
    return true;
  }
  cell(): ContributionCell | null {
    if (this.#observations === 0) return null;
    const result = parseContributionCell({ schemaVersion: 3, dimensions: this.#dimensions, observations: this.#observations,
      tokens: Object.fromEntries(STATS_TOKEN_KEYS.map(key => [key, this.#tokens[key].toString()])),
      costMicrousd: this.#dimensions.costKind === "none" ? null : this.#cost.toString(),
      durationMs: this.#dimensions.timed ? this.#duration.toString() : null, timedTokens: this.#timedTokens.toString() });
    if (!result) throw new Error("invalid_scrub_fold"); return result;
  }
}

/** Rebuild-job cell scrub (plan 6.3): the scrub envelope for accounts above
 * `CONTRIBUTION_SCRUB_MAX_HEADS`. The head walk itself is the bounded,
 * resumable, durably cursored rebuild job (M11): its scratch root is folded
 * from every canonical head at sixteen heads per step. This read qualifies one
 * cell of that verified scratch root against the job's pinned published root
 * with no source reads at all, so a mismatch is per-cell evidence of exactly
 * which cohort the published index disagrees on. It inherits the job's
 * qualification limits: it does not audit canonical SQL from genesis and it
 * does not certify legacy imports. */
export const CONTRIBUTION_SCRUB_JOB_MAX_INDEX_READS = 14;
export const CONTRIBUTION_SCRUB_JOB_MAX_READ_BYTES = 3_670_016;
export type ContributionScrubJobRequest = ContributionScrubRequest & Readonly<{ jobId: string; expectedVersion: number }>;
export type ContributionScrubJobPhase = "comparing" | "match" | "mismatch";
export type ContributionScrubJobReceipt = Readonly<{
  schemaVersion: 3; profile: "canonical-cell-scrub-v3"; scope: "rebuild-job";
  accountId: string; generation: string; revision: number; jobId: string; version: number; phase: ContributionScrubJobPhase;
  headCount: number; scratchRootHash: string | null; rootHash: string | null; dimensions: ContributionCellDimensions;
  verdict: "match" | "mismatch"; expected: ContributionCell | null; published: ContributionCell | null;
  scratchObjects: number; indexObjects: number; scratchBytes: number; indexBytes: number; readBytes: number;
}>;
export type ContributionScrubJobResult = Readonly<{ ok: true; value: ContributionScrubJobReceipt }>
  | Readonly<{ ok: false; error: ContributionScrubError }>;
export function parseContributionScrubJobRequest(value: unknown): ContributionScrubJobRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "expectedRevision", "dimensions", "jobId", "expectedVersion"]);
    if (!raw) return null;
    const { jobId, expectedVersion, ...rest } = raw, base = parseContributionScrubRequest(rest);
    return base && contributionIdentity(jobId) && statsInteger(expectedVersion, 1, 1_000_000)
      ? Object.freeze({ ...base, jobId, expectedVersion }) : null;
  } catch { return null; }
}
export function parseContributionScrubJobReceipt(input: ContributionScrubJobRequest, value: unknown): ContributionScrubJobReceipt | null {
  try {
    const request = parseContributionScrubJobRequest(input), raw = statsOwnRecord(value, ["schemaVersion", "profile", "scope", "accountId", "generation",
      "revision", "jobId", "version", "phase", "headCount", "scratchRootHash", "rootHash", "dimensions", "verdict", "expected", "published",
      "scratchObjects", "indexObjects", "scratchBytes", "indexBytes", "readBytes"]), selected = raw ? dimensions(raw.dimensions) : null;
    if (!request || raw?.schemaVersion !== 3 || raw.profile !== "canonical-cell-scrub-v3" || raw.scope !== "rebuild-job"
      || raw.accountId !== request.accountId || raw.generation !== request.generation || raw.revision !== request.expectedRevision
      || raw.jobId !== request.jobId || raw.version !== request.expectedVersion
      || (raw.phase !== "comparing" && raw.phase !== "match" && raw.phase !== "mismatch")
      || !statsInteger(raw.headCount, 0, 1_000_000)
      || (raw.scratchRootHash !== null && !contributionIdentity(raw.scratchRootHash)) || (raw.rootHash !== null && !contributionIdentity(raw.rootHash))
      || !selected || !same(selected, request.dimensions)
      || !statsInteger(raw.scratchObjects, raw.scratchRootHash === null ? 0 : 1, CONTRIBUTION_SCRUB_MAX_INDEX_READS)
      || (raw.scratchRootHash === null && raw.scratchObjects !== 0)
      || !statsInteger(raw.indexObjects, raw.rootHash === null ? 0 : 1, CONTRIBUTION_SCRUB_MAX_INDEX_READS)
      || (raw.rootHash === null && raw.indexObjects !== 0) || raw.scratchObjects + raw.indexObjects > CONTRIBUTION_SCRUB_JOB_MAX_INDEX_READS
      || !statsInteger(raw.scratchBytes, raw.scratchObjects, raw.scratchObjects * 262_144)
      || !statsInteger(raw.indexBytes, raw.indexObjects, raw.indexObjects * 262_144)
      || !statsInteger(raw.readBytes, 0, CONTRIBUTION_SCRUB_JOB_MAX_READ_BYTES) || raw.readBytes !== raw.scratchBytes + raw.indexBytes) return null;
    const expected = raw.expected === null ? null : parseContributionCell(raw.expected), published = raw.published === null ? null : parseContributionCell(raw.published);
    const verdict = same(expected, published) ? "match" : "mismatch";
    if ((raw.expected !== null && (!expected || !same(expected.dimensions, selected)))
      || (raw.published !== null && (!published || !same(published.dimensions, selected)))
      || (raw.scratchRootHash === null && expected !== null) || (raw.rootHash === null && published !== null)
      || (raw.phase === "match" && verdict !== "match") || raw.verdict !== verdict) return null;
    return Object.freeze({ schemaVersion: 3, profile: "canonical-cell-scrub-v3", scope: "rebuild-job", accountId: request.accountId,
      generation: request.generation, revision: request.expectedRevision, jobId: request.jobId, version: request.expectedVersion, phase: raw.phase,
      headCount: raw.headCount, scratchRootHash: raw.scratchRootHash as string | null, rootHash: raw.rootHash as string | null, dimensions: selected,
      verdict, expected, published, scratchObjects: raw.scratchObjects, indexObjects: raw.indexObjects,
      scratchBytes: raw.scratchBytes, indexBytes: raw.indexBytes, readBytes: raw.readBytes });
  } catch { return null; }
}
export function parseContributionScrubJobResult(request: ContributionScrubJobRequest, value: unknown): ContributionScrubJobResult | null {
  try {
    const success = statsOwnRecord(value, ["ok", "value"]);
    if (success?.ok === true) { const receipt = parseContributionScrubJobReceipt(request, success.value); return receipt ? { ok: true, value: receipt } : null; }
    const failure = statsOwnRecord(value, ["ok", "error"]);
    return parseContributionScrubJobRequest(request) && failure?.ok === false
      && (isContributionError(failure.error) || failure.error === "deadline" || failure.error === "not_caught_up" || failure.error === "scope_limit")
      ? { ok: false, error: failure.error } : null;
  } catch { return null; }
}
