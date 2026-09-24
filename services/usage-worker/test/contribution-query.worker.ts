import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";
import { ContributionFault } from "../../../lib/usage/contributions";
import { contributionCellKey, parseContributionCell, type ContributionCell } from "../../../lib/usage/contribution-rollups";
import { stageContributionIndex, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { type ContributionQuery, type ContributionQueryPage } from "../../../lib/usage/contribution-query";
import { ensureContributionIndexStage, readContributionIndexObject } from "../src/contribution-index-objects";
import { ContributionQueryFault, queryContributionPage, type ContributionQuerySnapshot } from "../src/contribution-query";

const owner = { accountId: `acct_${"1".repeat(32)}`, generation: "2".repeat(64) };
const query: ContributionQuery = { schemaVersion: 3, accountId: owner.accountId, sessionExpiresAtMs: 10_000,
  firstUtcDay: 20_000, dayCount: 31, limit: 2, cursor: null };
function cell(day: number, amount = String(day)): ContributionCell {
  const value = parseContributionCell({ schemaVersion: 3, dimensions: { utcDay: day, client: "codex", provider: null, model: null,
    tokenBasis: "reported", breakdownCoverage: "complete", costKind: "none", timed: false }, observations: 1,
    tokens: { input: amount, cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    costMicrousd: null, durationMs: null, timedTokens: "0" });
  if (!value) throw new Error("invalid synthetic cell"); return value;
}
const loader = (reference: ContributionIndexReference) => readContributionIndexObject(env.STAGING, owner, reference);
afterEach(async () => {
  vi.restoreAllMocks(); const keys = (await env.STAGING.list()).objects.map(object => object.key);
  if (keys.length) await env.STAGING.delete(keys);
});
async function setup() {
  const values = Array.from({ length: 4 }, (_, index) => cell(20_000 + index));
  const stage = await stageContributionIndex(owner, null, values.map(after => ({ key: contributionCellKey(after.dimensions), before: null, after })), loader);
  if (!stage.ok) throw new Error(stage.error);
  const stored = await ensureContributionIndexStage(env.STAGING, owner, stage.value, () => true);
  const reference: ContributionQuerySnapshot = { ...owner, sourceRevision: 7, latestAppliedRevision: 6, latestPublishedRevision: 5,
    revision: 5, root: stored.root, unresolvedLegacyBodies: 2, observedAtMs: 1_000 };
  return { values, reference };
}
const success = (result: Awaited<ReturnType<typeof queryContributionPage>>): ContributionQueryPage => {
  if (!result.ok) throw new Error(result.error); return result.value;
};
test("authorized pages retain the old root through a moving correction without read-path writes", async () => {
  const { values, reference } = await setup();
  let latest = reference, retired: ContributionQuerySnapshot | null = null;
  const snapshot = (revision: number | null) => {
    if (revision === null || revision === latest.revision) return latest;
    if (retired && retired.revision === revision) return { ...retired, sourceRevision: latest.sourceRevision,
      latestAppliedRevision: latest.latestAppliedRevision, latestPublishedRevision: latest.latestPublishedRevision };
    throw new ContributionQueryFault("snapshot_expired");
  };
  const first = success(await queryContributionPage(env.STAGING, query, snapshot));
  expect(first.cells).toEqual(values.slice(0, 2)); expect(first.snapshotLag).toBe(2); expect(first.unresolvedLegacyBodies).toBe(2);
  const stage = await stageContributionIndex(owner, reference.root, [{ key: contributionCellKey(values[2].dimensions), before: values[2], after: cell(20_002, "9") }], loader);
  if (!stage.ok) throw new Error(stage.error);
  const changed = await ensureContributionIndexStage(env.STAGING, owner, stage.value, () => true);
  retired = reference; latest = { ...reference, sourceRevision: 8, latestAppliedRevision: 7, latestPublishedRevision: 6, revision: 6, root: changed.root };
  const put = vi.spyOn(env.STAGING, "put"), del = vi.spyOn(env.STAGING, "delete");
  const second = success(await queryContributionPage(env.STAGING, { ...query, cursor: first.next }, snapshot));
  expect(second.cells).toEqual(values.slice(2)); expect(second.next).toBeNull();
  expect(second.snapshotRevision).toBe(5); expect(second.latestPublishedRevision).toBe(6); expect(second.snapshotLag).toBe(3);
  const fresh = success(await queryContributionPage(env.STAGING, { ...query, limit: 4 }, snapshot));
  expect(fresh.cells[2].tokens.input).toBe("9"); expect(fresh.snapshotRevision).toBe(6);
  expect(put).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
});
test("an extant immutable root grants no authority to an unknown or retired publication", async () => {
  const { reference } = await setup(), get = vi.spyOn(env.STAGING, "get");
  expect(await queryContributionPage(env.STAGING, query, () => { throw new ContributionQueryFault("snapshot_expired"); }))
    .toEqual({ ok: false, error: "snapshot_expired" });
  expect(get).not.toHaveBeenCalled();
  const first = success(await queryContributionPage(env.STAGING, query, () => reference)); get.mockClear();
  expect(await queryContributionPage(env.STAGING, { ...query, cursor: first.next }, () => ({ ...reference, generation: "4".repeat(64) })))
    .toEqual({ ok: false, error: "snapshot_expired" });
  expect(get).not.toHaveBeenCalled();
});
test("authority, clock and publication identity are rechecked after provider awaits", async () => {
  const { reference } = await setup();
  for (const error of ["unauthorized", "recovery_required", "clock_regressed"] as const) {
    let calls = 0;
    expect(await queryContributionPage(env.STAGING, query, () => {
      if (++calls >= 3) throw new ContributionFault(error); return reference;
    })).toEqual({ ok: false, error });
    expect(calls).toBe(3);
  }
  for (const mutation of [{ revision: 6, latestPublishedRevision: 6 }, { sourceRevision: 6 }, { latestAppliedRevision: 5 },
    { latestAppliedRevision: 8 }, { observedAtMs: 999 },
    { root: null }, { unresolvedLegacyBodies: 0 }]) {
    let calls = 0;
    expect(await queryContributionPage(env.STAGING, query, () => ++calls >= 3 ? { ...reference, ...mutation } : reference))
      .toEqual({ ok: false, error: "recovery_required" });
  }
});
test("empty initialization exposes lag and never creates, repairs or fetches objects", async () => {
  const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put"); let calls = 0;
  const value = success(await queryContributionPage(env.STAGING, query, () => {
    calls++; return { ...owner, sourceRevision: 7, latestAppliedRevision: 0, latestPublishedRevision: 0, revision: 0,
      root: null, unresolvedLegacyBodies: 0, observedAtMs: 1_000 };
  }));
  expect(value.cells).toEqual([]); expect(value.next).toBeNull(); expect(value.snapshotRevision).toBe(0); expect(value.snapshotLag).toBe(7);
  expect(calls).toBe(2); expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});
test("publication during the first page preserves its initial snapshot and reports the newer watermark", async () => {
  const { values, reference } = await setup(); let calls = 0;
  const value = success(await queryContributionPage(env.STAGING, query, revision => {
    calls++;
    expect(revision).toBe(calls === 1 ? null : 5);
    return calls >= 3 ? { ...reference, sourceRevision: 8, latestAppliedRevision: 7, latestPublishedRevision: 6 } : reference;
  }));
  expect(value.cells).toEqual(values.slice(0, 2)); expect(value.snapshotRevision).toBe(5);
  expect(value.latestPublishedRevision).toBe(6); expect(value.snapshotLag).toBe(3); expect(value.next?.revision).toBe(5);
  expect(value.latestAppliedRevision).toBe(7); expect(value.appliedLag).toBe(1); expect(value.publishedLag).toBe(2);
});
