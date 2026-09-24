import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";
import { contributionCellKey, parseContributionCell, type ContributionCell } from "../../../lib/usage/contribution-rollups";
import { contributionIndexStageHash, readContributionIndexPage, stageContributionIndex, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { contributionIndexObjectKey, ensureContributionIndexStage, isVerifiedContributionIndex, readContributionIndexObject } from "../src/contribution-index-objects";

const owner = { accountId: `acct_${"1".repeat(32)}`, generation: "2".repeat(64) };
const makeCell = (day: number): ContributionCell => {
  const value = parseContributionCell({ schemaVersion: 3, dimensions: { utcDay: day, client: "codex", provider: null, model: null,
    tokenBasis: "reported", breakdownCoverage: "complete", costKind: "none", timed: false }, observations: 1,
    tokens: { input: "9007199254740993", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    costMicrousd: null, durationMs: null, timedTokens: "0" });
  if (!value) throw new Error("synthetic cell invalid"); return value;
};
const loader = (reference: ContributionIndexReference) => readContributionIndexObject(env.STAGING, owner, reference);
afterEach(async () => {
  vi.restoreAllMocks(); const listed = await env.STAGING.list();
  if (listed.objects.length) await env.STAGING.delete(listed.objects.map(object => object.key));
});
async function initial() {
  const cell = makeCell(20_000), result = await stageContributionIndex(owner, null, [{ key: contributionCellKey(cell.dimensions), before: null, after: cell }], loader);
  if (!result.ok) throw new Error(result.error); return result.value;
}
test("real R2 immutable index writes verify, retry exactly, and read without writes", async () => {
  const stage = await initial(), one = await ensureContributionIndexStage(env.STAGING, owner, stage, () => true);
  expect(isVerifiedContributionIndex(one)).toBe(true);
  expect(one.stageHash).toBe(contributionIndexStageHash(stage));
  expect(contributionIndexStageHash({ ...stage })).toBeNull();
  expect(isVerifiedContributionIndex({ ...one })).toBe(false);
  const objects = (await env.STAGING.list()).objects.map(object => [object.key, object.size]);
  const again = await ensureContributionIndexStage(env.STAGING, owner, stage, () => true);
  expect(again).toEqual(one); expect((await env.STAGING.list()).objects.map(object => [object.key, object.size])).toEqual(objects);
  const put = vi.spyOn(env.STAGING, "put");
  const result = await readContributionIndexPage(owner, one.root, { firstUtcDay: 20_000, dayCount: 1, limit: 1, cursor: null }, loader);
  if (!result.ok) throw new Error(result.error);
  expect(result.value.cells).toEqual([makeCell(20_000)]); expect(result.value.next).toBeNull(); expect(put).not.toHaveBeenCalled();
});
test("foreign contexts, copied plans and closed continuations refuse before provider writes", async () => {
  const stage = await initial(), put = vi.spyOn(env.STAGING, "put");
  await expect(ensureContributionIndexStage(env.STAGING, { ...owner, generation: "3".repeat(64) }, stage, () => true)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(ensureContributionIndexStage(env.STAGING, owner, { ...stage }, () => true)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(ensureContributionIndexStage(env.STAGING, owner, stage, () => false)).rejects.toMatchObject({ code: "recovery_required" });
  const noOp = await stageContributionIndex(owner, null, [], loader);
  if (!noOp.ok) throw new Error(noOp.error);
  await expect(ensureContributionIndexStage(env.STAGING, { ...owner, accountId: `acct_${"3".repeat(32)}` }, noOp.value, () => true))
    .rejects.toMatchObject({ code: "invalid_input" });
  expect(put).not.toHaveBeenCalled();
});
test("a pre-existing conflicting body cannot be overwritten or admitted", async () => {
  const stage = await initial(), object = stage.objects[0], key = contributionIndexObjectKey(owner, object.reference.hash);
  await env.STAGING.put(key, "wrong retained bytes", { httpMetadata: { contentType: "application/vnd.aicharts.contribution-index-v3+json" }, customMetadata: { schemaVersion: "3" } });
  await expect(ensureContributionIndexStage(env.STAGING, owner, stage, () => true)).rejects.toMatchObject({ code: "storage_invalid" });
  expect(await (await env.STAGING.get(key))!.text()).toBe("wrong retained bytes");
});
test("closing the publication guard after object I/O yields only an immutable orphan", async () => {
  const stage = await initial(); let calls = 0;
  await expect(ensureContributionIndexStage(env.STAGING, owner, stage, () => ++calls < 3)).rejects.toMatchObject({ code: "recovery_required" });
  expect((await env.STAGING.list()).objects).toHaveLength(1);
  // Reconciliation can verify the exact object, but only the transaction owner
  // may subsequently make its reserved root visible.
  const recovered = await ensureContributionIndexStage(env.STAGING, owner, stage, () => true);
  expect(isVerifiedContributionIndex(recovered)).toBe(true);
});
