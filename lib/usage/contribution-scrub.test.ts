import { expect, test } from "bun:test";
import fc from "fast-check";
import { ContributionCellScrubFold, CONTRIBUTION_SCRUB_MAX_HEADS, CONTRIBUTION_SCRUB_REQUEST_BYTES,
  CONTRIBUTION_SCRUB_RESPONSE_BYTES, decodeContributionScrubRequest, encodeContributionScrubResult,
  parseContributionScrubReceipt, parseContributionScrubRequest, parseContributionScrubResult,
  type ContributionScrubReceipt, type ContributionScrubRequest } from "./contribution-scrub";
import { parseUsageStatsRow, STATS_MAX_TOKENS_PER_RECORD, type UsageStatsRow } from "./stats-contract";

const dimensions = { utcDay: 20_000, client: "claude", provider: null, model: null,
  tokenBasis: "reported" as const, breakdownCoverage: "partial" as const, costKind: "reported" as const, timed: true };
const request: ContributionScrubRequest = { schemaVersion: 3, accountId: `acct_${"1".repeat(32)}`, generation: "2".repeat(64), expectedRevision: 10, dimensions };
const row = (n = 1, fields: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const parsed = parseUsageStatsRow({ utcDay: 20_000, client: "claude", provider: null, model: null,
    tokens: { input: String(10 * n), cacheRead: String(2 * n), cacheWrite: String(3 * n), output: String(4 * n), reasoning: String(n) },
    records: 1, reportedCostMicrousd: String(5 * n), reportedCostRecords: 1, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: String(7 * n), timedRecords: 1, timedTokens: String(20 * n), tokenBasis: "reported", breakdownCoverage: "partial", ...fields });
  if (!parsed) throw new Error("invalid_synthetic_row"); return parsed;
};
function receipt(): ContributionScrubReceipt {
  const fold = new ContributionCellScrubFold(dimensions); fold.add(row());
  return { schemaVersion: 3, profile: "canonical-cell-scrub-v3", scope: "single-cell", accountId: request.accountId,
    generation: request.generation, revision: 10, rootHash: "3".repeat(64), dimensions, verdict: "match", expected: fold.cell(), published: fold.cell(),
    checkedHeads: 1, liveHeads: 1, matchingHeads: 1, sourceObjects: 1, indexObjects: 1, sourceBytes: 1_000, indexBytes: 500, readBytes: 1_500 };
}

test("independent fold adds every sufficient statistic and keeps exact nullable cohorts", () => {
  const fold = new ContributionCellScrubFold(dimensions);
  expect(fold.cell()).toBeNull(); expect(fold.add(row(1))).toBe(true); expect(fold.add(row(2))).toBe(true);
  expect(fold.cell()).toEqual({ schemaVersion: 3, dimensions, observations: 2,
    tokens: { input: "30", cacheRead: "6", cacheWrite: "9", output: "12", reasoning: "3" }, costMicrousd: "15", durationMs: "21", timedTokens: "60" });
  for (const fields of [{ utcDay: 20_001 }, { client: "codex" }, { tokenBasis: "estimated" as const }, { breakdownCoverage: "complete" as const },
    { reportedCostMicrousd: null, reportedCostRecords: 0 }, { durationMs: null, timedRecords: 0, timedTokens: "0" }])
    expect(fold.add(row(1, fields))).toBe(false);
  expect(fold.cell()?.observations).toBe(2);
  const unknown = new ContributionCellScrubFold({ ...dimensions, costKind: "none", timed: false });
  unknown.add(row(1, { reportedCostMicrousd: null, reportedCostRecords: 0, durationMs: null, timedRecords: 0, timedTokens: "0" }));
  expect(unknown.cell()).toMatchObject({ costMicrousd: null, durationMs: null, timedTokens: "0" });
  const estimated = new ContributionCellScrubFold({ ...dimensions, costKind: "estimated" });
  estimated.add(row(1, { reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: "0", estimatedCostRecords: 1 }));
  expect(estimated.cell()?.costMicrousd).toBe("0");
});

test("fold permutation and cohort partition laws hold over bounded generated observations", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: Math.floor(Number(STATS_MAX_TOKENS_PER_RECORD) / 20) }), { maxLength: CONTRIBUTION_SCRUB_MAX_HEADS }), values => {
    const forward = new ContributionCellScrubFold(dimensions), reverse = new ContributionCellScrubFold(dimensions);
    for (const value of values) forward.add(row(value));
    for (const value of [...values].reverse()) reverse.add(row(value));
    expect(reverse.cell()).toEqual(forward.cell());
    const cell = forward.cell();
    if (cell) {
      const sum = values.reduce((a, b) => a + BigInt(b), 0n);
      expect(cell.observations).toBe(values.length); expect(cell.timedTokens).toBe((20n * sum).toString());
      expect(cell.costMicrousd).toBe((5n * sum).toString()); expect(cell.durationMs).toBe((7n * sum).toString());
    } else expect(values).toHaveLength(0);
  }), { numRuns: 100 });
});

test("invalid or excessive folds fail before changing retained sums", () => {
  const fold = new ContributionCellScrubFold(dimensions);
  for (let index = 0; index < CONTRIBUTION_SCRUB_MAX_HEADS; index++) fold.add(row());
  const prior = fold.cell();
  expect(() => fold.add(row())).toThrow("scrub_limit");
  expect(() => fold.add({ ...row(), records: 2 })).toThrow("invalid_scrub_row");
  expect(() => fold.add({ ...row(), tokens: { ...row().tokens, input: "PRIVATE_PROMPT_CANARY" } })).toThrow("invalid_scrub_row");
  expect(fold.cell()).toEqual(prior);
});

test("request boundary owns cohort shape and bounds encoded input", () => {
  expect(parseContributionScrubRequest(request)).toEqual(request);
  for (const fields of [{ extra: "PRIVATE_PATH_CANARY" }, { expectedRevision: -0 }, { expectedRevision: 1_000_001 },
    { generation: "0".repeat(64) }, { dimensions: { ...dimensions, timed: "yes" } },
    { dimensions: { ...dimensions, costKind: "unpriced" } }, { dimensions: { ...dimensions, extra: true } }])
    expect(parseContributionScrubRequest({ ...request, ...fields })).toBeNull();
  const encoded = new TextEncoder().encode(JSON.stringify(request));
  expect(decodeContributionScrubRequest(encoded)).toEqual(request);
  const tooLarge = new Uint8Array(CONTRIBUTION_SCRUB_REQUEST_BYTES + 1).fill(32); tooLarge.set(encoded);
  expect(decodeContributionScrubRequest(tooLarge)).toBeNull();
  let accessed = false;
  expect(parseContributionScrubRequest({ ...request, get generation() { accessed = true; return "2".repeat(64); } })).toBeNull();
  expect(accessed).toBe(false);
});

test("receipt cannot claim match for different cells or widen its admitted scope and budgets", () => {
  const valid = receipt(); expect(parseContributionScrubReceipt(request, valid)).toEqual(valid);
  const changed = { ...valid.published!, tokens: { ...valid.published!.tokens, input: "11" } };
  expect(parseContributionScrubReceipt(request, { ...valid, published: changed })).toBeNull();
  expect(parseContributionScrubReceipt(request, { ...valid, published: changed, verdict: "mismatch" })?.verdict).toBe("mismatch");
  for (const fields of [{ scope: "account" }, { revision: 11 }, { accountId: `acct_${"9".repeat(32)}` }, { generation: "9".repeat(64) },
    { checkedHeads: 17 }, { liveHeads: 2 }, { matchingHeads: 0 }, { sourceObjects: 2 }, { indexObjects: 8 }, { sourceBytes: 1_048_577 },
    { indexBytes: 262_145 }, { readBytes: 1_499 }, { rootHash: null }, { expected: null }, { expected: { ...valid.expected!, dimensions: { ...dimensions, utcDay: 1 } } }])
    expect(parseContributionScrubReceipt(request, { ...valid, ...fields })).toBeNull();
  const encoded = encodeContributionScrubResult(request, { ok: true, value: valid });
  expect(encoded).not.toBeNull(); expect(encoded!.byteLength).toBeLessThanOrEqual(CONTRIBUTION_SCRUB_RESPONSE_BYTES);
  for (const error of ["deadline", "not_caught_up", "scope_limit", "legacy_unresolved", "conflict"] as const)
    expect(parseContributionScrubResult(request, { ok: false, error })).toEqual({ ok: false, error });
  expect(parseContributionScrubResult(request, { ok: false, error: "PRIVATE_PROMPT_CANARY" })).toBeNull();
});
