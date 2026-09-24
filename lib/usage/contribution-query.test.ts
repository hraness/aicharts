import { expect, test } from "bun:test";
import { contributionIndexKey } from "./contribution-index";
import { parseContributionCell, type ContributionCell } from "./contribution-rollups";
import { CONTRIBUTION_QUERY_REQUEST_BYTES, decodeContributionQuery, encodeContributionQueryResult,
  parseContributionQuery, parseContributionQueryCursor, parseContributionQueryPage, parseContributionQueryResult,
  type ContributionQuery, type ContributionQueryPage } from "./contribution-query";

const account = `acct_${"1".repeat(32)}`, generation = "2".repeat(64), root = "3".repeat(64);
const query: ContributionQuery = { schemaVersion: 3, accountId: account, sessionExpiresAtMs: 10_000,
  firstUtcDay: 20_000, dayCount: 31, limit: 2, cursor: null };
const cell = (day: number): ContributionCell => {
  const parsed = parseContributionCell({ schemaVersion: 3, dimensions: { utcDay: day, client: "codex", provider: null,
    model: null, tokenBasis: "reported", breakdownCoverage: "complete", costKind: "none", timed: false }, observations: 1,
    tokens: { input: "9007199254740993", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    costMicrousd: null, durationMs: null, timedTokens: "0" });
  if (!parsed) throw new Error("invalid synthetic cell"); return parsed;
};
function page(): ContributionQueryPage {
  const cells = [cell(20_000), cell(20_001)];
  return { schemaVersion: 3, profile: "contribution-cells-v3", coverage: "observed-only", accountId: account,
    generation, observedAtMs: 5_000, sourceRevision: 13, latestAppliedRevision: 12, latestPublishedRevision: 10,
    appliedLag: 1, publishedLag: 3, snapshotRevision: 10,
    snapshotLag: 3, rootHash: root, unresolvedLegacyBodies: 4, firstUtcDay: query.firstUtcDay, dayCount: query.dayCount,
    cells, next: { schemaVersion: 3, accountId: account, generation, revision: 10, rootHash: root,
      firstUtcDay: query.firstUtcDay, dayCount: query.dayCount, limit: query.limit, afterKey: contributionIndexKey(cells[1]) } };
}
test("bounded cursors bind owner, range and page size without trusting client expiry", () => {
  const cursor = page().next!;
  expect(parseContributionQuery({ ...query, cursor })).toEqual({ ...query, cursor });
  for (const changed of [{ ...query, cursor, accountId: `acct_${"4".repeat(32)}` }, { ...query, cursor, firstUtcDay: 19_999 },
    { ...query, cursor, dayCount: 30 }, { ...query, cursor, limit: 1 }, { ...query, dayCount: 367 },
    { ...query, firstUtcDay: 99_999_999, dayCount: 2 }, { ...query, limit: 257 }, { ...query, limit: -0 },
    { ...query, sessionExpiresAtMs: -0 }, { ...query, cursor: { ...cursor, expiresAtMs: Number.MAX_SAFE_INTEGER } }])
    expect(parseContributionQuery(changed)).toBeNull();
  for (const changed of [{ ...cursor, revision: 0 }, { ...cursor, afterKey: "PRIVATE_PROMPT_CANARY" },
    { ...cursor, afterKey: contributionIndexKey(cell(20_031)) }, { ...cursor, rootHash: "0".repeat(64) },
    { ...cursor, afterKey: `00020000:[${"x".repeat(600)}` }]) expect(parseContributionQueryCursor(changed)).toBeNull();
});
test("exact page admission retains explicit lag, unresolved legacy and integer precision", () => {
  const value = page(), parsed = parseContributionQueryPage(query, value)!;
  expect(parsed).toEqual(value); expect(Object.isFrozen(parsed.cells[0].tokens)).toBe(true);
  expect(parsed.cells[0].tokens.input).toBe("9007199254740993");
  expect(parsed.snapshotLag).toBe(3); expect(parsed.unresolvedLegacyBodies).toBe(4);
  const bytes = encodeContributionQueryResult(query, { ok: true, value });
  expect(bytes).not.toBeNull(); expect(new TextDecoder().decode(bytes!)).toContain('"9007199254740993"');
  expect(parseContributionQueryResult(query, { ok: false, error: "snapshot_expired" })).toEqual({ ok: false, error: "snapshot_expired" });
  expect(parseContributionQueryResult(query, { ok: false, error: "PRIVATE_ERROR_CANARY" })).toBeNull();
});
test("request/result correlation refuses foreign, stale, impossible and partial-total shapes", () => {
  const value = page();
  for (const change of [{ accountId: `acct_${"4".repeat(32)}` }, { generation: "bad" }, { firstUtcDay: 20_001 }, { dayCount: 1 },
    { coverage: "complete" }, { sourceRevision: 9 }, { snapshotRevision: 11, snapshotLag: 2 }, { snapshotLag: 0 },
    { latestAppliedRevision: 14 }, { latestAppliedRevision: 9 }, { appliedLag: 0 }, { appliedLag: -0 }, { publishedLag: 2 },
    { observedAtMs: 10_000 }, { observedAtMs: -0 }, { unresolvedLegacyBodies: -1 }, { rootHash: null },
    { totalTokens: "1" }, { cells: [cell(20_001), cell(20_000)] }, { cells: [cell(20_000), cell(20_000)] },
    { cells: [cell(19_999), cell(20_000)] }, { cells: [cell(20_000), cell(20_001), cell(20_002)] },
    { cells: [cell(20_000)] }, { next: { ...value.next, afterKey: contributionIndexKey(cell(20_002)) } },
    { next: { ...value.next, revision: 11 } }, { next: { ...value.next, rootHash: "4".repeat(64) } }])
    expect(parseContributionQueryPage(query, { ...value, ...change })).toBeNull();
});
test("continuation stays on its authorized snapshot when the newest publication changes", () => {
  const value = page(), continued = { ...query, cursor: value.next };
  const next = { ...value, latestPublishedRevision: 12, publishedLag: 1, cells: [cell(20_002)], next: null };
  expect(parseContributionQueryPage(continued, next)).toEqual(next);
  for (const change of [{ generation: "5".repeat(64) }, { snapshotRevision: 12, snapshotLag: 1 },
    { rootHash: "5".repeat(64) }, { cells: [cell(20_001)] }]) expect(parseContributionQueryPage(continued, { ...next, ...change })).toBeNull();
});
test("empty not-yet-built and empty committed snapshots stay distinct and bounded", () => {
  const waiting = { ...page(), latestPublishedRevision: 0, publishedLag: 13, snapshotRevision: 0, snapshotLag: 13, rootHash: null, cells: [], next: null };
  expect(parseContributionQueryPage(query, waiting)).toEqual(waiting);
  expect(parseContributionQueryPage(query, { ...waiting, rootHash: root })).toBeNull();
  const empty = { ...waiting, latestAppliedRevision: 13, appliedLag: 0, latestPublishedRevision: 13, publishedLag: 0, snapshotRevision: 13, snapshotLag: 0 };
  expect(parseContributionQueryPage(query, empty)).toEqual(empty);
  for (const field of ["appliedLag", "publishedLag", "snapshotLag"])
    expect(parseContributionQueryPage(query, { ...empty, [field]: -0 })).toBeNull();
});
test("untrusted DTO admission never executes getters or custom array iteration", () => {
  let invoked = 0;
  const accessor = { ...query }; Object.defineProperty(accessor, "cursor", { enumerable: true, get() { invoked++; return null; } });
  expect(parseContributionQuery(accessor)).toBeNull();
  const cells = [cell(20_000), cell(20_001)];
  Object.defineProperty(cells, Symbol.iterator, { value: () => { invoked++; throw new Error("PRIVATE_CANARY"); } });
  expect(parseContributionQueryPage(query, { ...page(), cells })).toBeNull();
  expect(invoked).toBe(0);
  const bytes = new TextEncoder().encode(JSON.stringify(query)); expect(decodeContributionQuery(bytes)).toEqual(query);
  expect(decodeContributionQuery(new Uint8Array(CONTRIBUTION_QUERY_REQUEST_BYTES + 1))).toBeNull();
  expect(decodeContributionQuery(new TextEncoder().encode('{"schemaVersion":3,"schemaVersion":3}'))).toBeNull();
});
