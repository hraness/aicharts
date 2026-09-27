import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE, contributionHash, parseContributionBatch,
  type ContributionAuthority, type ContributionBatch, type ContributionMutation } from "../../../lib/usage/contributions";
import { readContributionIndexPage, stageContributionIndex, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { contributionCellKey, parseContributionCell, type ContributionCell } from "../../../lib/usage/contribution-rollups";
import { parseContributionRebuildReceipt, type ContributionRebuildReadRequest, type ContributionRebuildReceipt,
  type ContributionRebuildRequest, type ContributionRebuildResult } from "../../../lib/usage/contribution-rebuild-contract";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "../src/account-admission";
import { ContributionState } from "../src/contributions-state";
import { ensureContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal, type ContributionJournalBundle } from "../src/contributions-journal";
import { contributionIndexObjectKey, ensureContributionIndexStage, readContributionIndexObject } from "../src/contribution-index-objects";
import { readCommittedContributionRevision, verifyContributionRevision, loadContributionRevisionChunk } from "../src/contribution-replay";
import { ContributionProjectionState, CONTRIBUTION_PROJECTION_RETIRE_MS, planContributionProjectionChunk } from "../src/contribution-projection-state";
import { ContributionRebuildState } from "../src/contribution-rebuild-state";
import { AccountContributionRebuild } from "../src/contribution-rebuild";
import { queryContributionPage, type ContributionQuerySnapshot } from "../src/contribution-query";
import type { ContributionQueryCursor } from "../../../lib/usage/contribution-query";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), POPULATION = hex(4), JOB = hex(910);
let serial = 5_000, operation = 0, account = "", now = 1_000_000;
const scope = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`cutover-synthetic-${serial}`);
type Storage = Pick<DurableObjectStorage, "sql" | "transactionSync">;
const run = <T>(callback: (state: ContributionState, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> =>
  runInDurableObject(stub(), (_instance, context) => callback(new ContributionState(context.storage), context.storage));
const authority = (): ContributionAuthority => ({ ...scope(), deviceId: DEVICE, active: true, observedAtMs: now, allowAccountTombstone: true });
const observed = () => ({ ...scope(), active: true, observedAtMs: now });
const observation = (): AdmissionObservation => ({ generation: env.USAGE_ENROLLMENT_GENERATION, observed: now, committed: false, fence: null });
const owner = (): AdmissionOwner => ({ ...scope(), phase: "active", observedAtMs: now, devices: [],
  anchor: { ...scope(), namespaceKey: hex(6), intentId: hex(7), reservationId: hex(8), createdAtMs: 1_000_000 } });
function transaction(storage: Storage): AdmissionTransaction {
  return (_observation, callback) => storage.transactionSync(() => ({ ok: true, value: callback(owner(), now) }));
}
const readRequest = (jobId = JOB): ContributionRebuildReadRequest => ({ schemaVersion: 3, ...scope(), jobId });
const advanceRequest = (expectedVersion: number, jobId = JOB): ContributionRebuildRequest => ({ ...readRequest(jobId), action: "advance", expectedVersion });
const publishRequest = (expectedVersion: number, jobId = JOB): ContributionRebuildRequest => ({ ...readRequest(jobId), action: "publish", expectedVersion });
const success = (value: ContributionRebuildResult): ContributionRebuildReceipt => {
  if (!value.ok) throw new Error(`synthetic_rebuild_refused:${value.error}`); expect(parseContributionRebuildReceipt(value.value)).toEqual(value.value); return value.value;
};
const row = (value = 1, fields: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const result = parseUsageStatsRow({ utcDay: 20_000, client: "claude", provider: null, model: null,
    records: 1, tokens: { input: String(value), cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "1" },
    reportedCostMicrousd: "5", reportedCostRecords: 1, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: "7", timedRecords: 1, timedTokens: "5", tokenBasis: "reported", breakdownCoverage: "partial", ...fields });
  if (!result) throw new Error("invalid_synthetic_row"); return result;
};
type Item = Readonly<{ id: number; row?: UsageStatsRow }>;
async function fresh(): Promise<void> {
  await run((state, storage) => {
    state.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    state.activateFresh({ schemaVersion: 3, ...scope(), deviceId: DEVICE, operationId: hex(++operation), expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    state.grantPopulation({ schemaVersion: 3, ...scope(), deviceId: DEVICE, populationId: POPULATION, operationId: hex(++operation),
      expectedRevision: state.control().revision, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
    new ContributionProjectionState(storage).initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    new ContributionRebuildState(storage).initialize();
  });
}
type Staged = Readonly<{ value: ContributionBatch; bundle: ContributionJournalBundle }>;
/** Reserve a batch without committing it: the canonical control row then carries a pending operation. */
async function stage(items: readonly Item[]): Promise<Staged> {
  const value = await run(state => {
    const population = state.population(POPULATION)!;
    const mutations: ContributionMutation[] = items.map(item => ({ kind: "put", id: hex(item.id, 32), expectedHeadHash: state.head(hex(item.id, 32))?.headHash ?? null, row: item.row ?? row(item.id) }));
    const result = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY, grain: "observation",
      ...scope(), deviceId: DEVICE, operationId: hex(++operation), sequence: state.sequence(env.USAGE_ENROLLMENT_GENERATION, DEVICE) + 1,
      expectedRevision: state.control().revision, populationId: POPULATION, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null, mutations });
    if (!result) throw new Error("invalid_synthetic_batch"); return result;
  });
  const bundle = await run(state => { const result = state.deltaBundle(value, authority()); state.reserve(value, authority()); return result; });
  return { value, bundle };
}
async function finish({ value, bundle }: Staged): Promise<ContributionBatch> {
  const body = await ensureContributionBody(env.STAGING, value, () => true); if (!body.ok) throw new Error(body.error);
  const journal = await ensureContributionJournal(env.STAGING, bundle, () => true);
  await run(state => state.commit(value, body.value, authority(), journal)); return value;
}
const publish = async (items: readonly Item[]): Promise<ContributionBatch> => finish(await stage(items));
async function project(): Promise<void> {
  await run(async (state, storage) => {
    const projection = new ContributionProjectionState(storage);
    for (let iteration = 0; iteration < 128; iteration++) {
      const control = projection.control(); if (control.appliedRevision === state.control().revision) break;
      const source = readCommittedContributionRevision(state, control.appliedRevision); if (!source) throw new Error("missing_synthetic_revision");
      const proof = await verifyContributionRevision(env.STAGING, source, () => true);
      if (control.source === null) projection.begin(proof, observed());
      const current = projection.control();
      if (source.deltaCount === 0 || current.phase === "add" && current.cursor === source.deltaCount) { projection.apply(observed()); continue; }
      const chunk = await loadContributionRevisionChunk(env.STAGING, proof, current.phase!, current.cursor, () => true);
      const plan = await planContributionProjectionChunk(current, chunk, reference => readContributionIndexObject(env.STAGING, scope(), reference));
      projection.reserve(plan, observed());
      const stored = await ensureContributionIndexStage(env.STAGING, scope(), plan.stage, () => true);
      projection.commit(plan, stored, observed());
    }
    now += 16_000; vi.setSystemTime(now); projection.publish(observed());
  });
}
const service = (storage: Storage) => new AccountContributionRebuild({ STAGING: env.STAGING }, new ContributionRebuildState(storage), transaction(storage));
const execute = (input: unknown) => run((_state, storage) => service(storage).execute(input, observation()));
const publishStep = (input: unknown, storage?: Storage) => run((_state, real) => service(storage ?? real).publish(input, observation()));
async function complete(): Promise<ContributionRebuildReceipt> {
  const expectedRevision = await run(state => state.control().revision);
  let value = success(await execute({ ...readRequest(), action: "begin", expectedVersion: 0, expectedRevision }));
  for (let index = 0; index < 32 && (value.phase === "building" || value.phase === "comparing"); index++) value = success(await execute(advanceRequest(value.version)));
  return value;
}
const status = () => run((_state, storage) => new ContributionRebuildState(storage).status(JOB, observed()));
const control = () => run((_state, storage) => new ContributionProjectionState(storage).control());
const publication = () => run((state, storage) => new ContributionProjectionState(storage).publication(state.control().revision, now));
const quota = async () => (await control()).immutableBytes;
async function replacePublishedRoot(reference: ContributionIndexReference | null): Promise<void> {
  await run((state, storage) => {
    const text = reference === null ? null : JSON.stringify(reference);
    storage.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=?,published_root=? WHERE id=1", text, text);
    storage.sql.exec("UPDATE usage_contribution_projection_publications SET root=? WHERE revision=?", text, state.control().revision);
  });
}
async function cellsOf(root: ContributionIndexReference | null): Promise<readonly ContributionCell[]> {
  const result = await readContributionIndexPage(scope(), root, { firstUtcDay: 20_000, dayCount: 366, limit: 256, cursor: null },
    reference => readContributionIndexObject(env.STAGING, scope(), reference));
  if (!result.ok) throw new Error(result.error); return result.value.cells;
}
async function replacePublishedCells(cells: readonly ContributionCell[]): Promise<void> {
  const plan = await stageContributionIndex(scope(), null, cells.map(cell => ({ key: contributionCellKey(cell.dimensions), before: null, after: cell })), async () => null);
  if (!plan.ok) throw new Error(plan.error);
  const stored = await ensureContributionIndexStage(env.STAGING, scope(), plan.value, () => true); await replacePublishedRoot(stored.root);
}
async function snapshot(): Promise<(revision: number | null) => ContributionQuerySnapshot> {
  const [source, projection, current] = [await run(state => state.control()), await control(), await publication()];
  return revision => {
    if (revision !== null && revision !== current.revision) throw new Error("synthetic_snapshot_scope");
    return Object.freeze({ accountId: account, generation: scope().generation, sourceRevision: source.revision, latestAppliedRevision: projection.appliedRevision,
      latestPublishedRevision: projection.publishedRevision, revision: current.revision, root: current.root, unresolvedLegacyBodies: 0, observedAtMs: now });
  };
}
const query = (cursor: ContributionQueryCursor | null = null) => ({ schemaVersion: 3 as const, accountId: account, sessionExpiresAtMs: now + 60_000, firstUtcDay: 20_000, dayCount: 366, limit: 4, cursor });

beforeEach(() => {
  account = `acct_${hex(++serial, 32)}`; operation = serial * 1000; now = 1_000_000;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  const keys = (await env.STAGING.list()).objects.map(object => object.key); if (keys.length) await env.STAGING.delete(keys);
  await abortAllDurableObjects(); await reset();
});

test("explicit publish swaps the current root at the unchanged revision, charges nothing, and retries return the retained receipt", async () => {
  await fresh(); await publish(Array.from({ length: 17 }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index }) }))); await project();
  const matched = await complete(); expect(matched.phase).toBe("match");
  const before = await control(), charged = await quota(), retired = await publication();
  expect((await status())!.readiness).toBe("ready");
  // Only the explicit cutover entry publishes; the diagnostic entry refuses.
  expect(await execute(publishRequest(matched.version))).toEqual({ ok: false, error: "invalid_input" });
  expect(await publishStep(advanceRequest(matched.version))).toEqual({ ok: false, error: "invalid_input" });
  const put = vi.spyOn(env.STAGING, "put"), get = vi.spyOn(env.STAGING, "get");
  const published = success(await publishStep(publishRequest(matched.version)));
  expect(published).toMatchObject({ phase: "published", action: "publish", version: matched.version + 1, expectedVersion: matched.version,
    sourceRevision: matched.sourceRevision, scratchRoot: matched.scratchRoot, publishedRoot: matched.publishedRoot, chargedBytes: matched.chargedBytes });
  expect(put).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  const after = await control(), current = await publication();
  expect(after.publishedRoot).toEqual(matched.scratchRoot); expect(after.appliedRoot).toEqual(matched.scratchRoot);
  expect(after.publishedRevision).toBe(before.publishedRevision); expect(after.appliedRevision).toBe(before.appliedRevision);
  expect(after.immutableBytes).toBe(charged); expect(after.source).toBeNull();
  expect(current).toEqual({ revision: retired.revision, root: matched.scratchRoot, publishedAtMs: now, expiresAtMs: null });
  expect(success(await publishStep(publishRequest(matched.version)))).toEqual(published);
  expect(await publishStep(publishRequest(published.version))).toEqual({ ok: false, error: "conflict" });
  expect(await execute(advanceRequest(published.version))).toEqual({ ok: false, error: "conflict" });
  expect((await status())!).toEqual({ receipt: published, pending: false, chargedBytes: matched.chargedBytes, readiness: "terminal" });
  expect(await run((_state, storage) => new ContributionRebuildState(storage).retiredRoots()))
    .toEqual([{ previousRoot: matched.publishedRoot, retiredAtMs: now, expiresAtMs: now + CONTRIBUTION_PROJECTION_RETIRE_MS }]);
  // Fresh pages read the published (verified) root. A matching rebuild may
  // reproduce the identical content-addressed tree, so the stale-cursor
  // refusal is asserted on the mismatch repair below, where roots differ.
  const snap = await snapshot(), first = await queryContributionPage(env.STAGING, query(), snap);
  if (!first.ok) throw new Error(first.error);
  expect(first.value.rootHash).toBe(matched.scratchRoot!.hash);
  expect((await queryContributionPage(env.STAGING, query(first.value.next), snap)).ok).toBe(true);
  expect(await cellsOf(after.publishedRoot)).toEqual(await cellsOf(matched.publishedRoot));
});
test("a mismatch repair publishes exactly the verified scratch root and a fresh diagnostic then matches", async () => {
  await fresh(); await publish(Array.from({ length: 5 }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index }) }))); await project();
  const correct = [...await cellsOf((await control()).publishedRoot)], wrong = [...correct];
  const changed = parseContributionCell({ ...correct[2], tokens: { ...correct[2].tokens, input: "424242" } }); if (!changed) throw new Error("invalid_negative_control");
  wrong[2] = changed; await replacePublishedCells(wrong);
  const mismatch = await complete(); expect(mismatch.phase).toBe("mismatch"); expect(mismatch.difference?.published?.tokens.input).toBe("424242");
  const published = success(await publishStep(publishRequest(mismatch.version)));
  expect(published).toMatchObject({ phase: "published", difference: mismatch.difference, scratchRoot: mismatch.scratchRoot });
  expect((await control()).publishedRoot).toEqual(mismatch.scratchRoot);
  expect(await cellsOf((await control()).publishedRoot)).toEqual(correct);
  expect(mismatch.scratchRoot!.hash).not.toBe(mismatch.publishedRoot!.hash);
  // Cursors pinned to the retired (wrong) root fail closed; fresh pages read the repaired root.
  const snap = await snapshot(), first = await queryContributionPage(env.STAGING, query(), snap);
  if (!first.ok) throw new Error(first.error);
  expect(first.value.rootHash).toBe(mismatch.scratchRoot!.hash);
  expect(await queryContributionPage(env.STAGING, query({ ...first.value.next!, rootHash: mismatch.publishedRoot!.hash }), snap)).toEqual({ ok: false, error: "snapshot_expired" });
  expect((await queryContributionPage(env.STAGING, query(first.value.next), snap)).ok).toBe(true);
  const again = await run((_state, storage) => {
    const state = new ContributionRebuildState(storage), rebuild = new AccountContributionRebuild({ STAGING: env.STAGING }, state, transaction(storage));
    return rebuild.execute({ ...readRequest(hex(911)), action: "begin", expectedVersion: 0, expectedRevision: mismatch.sourceRevision }, observation());
  });
  let value = success(again);
  for (let index = 0; index < 8 && (value.phase === "building" || value.phase === "comparing"); index++) value = success(await execute(advanceRequest(value.version, hex(911))));
  expect(value).toMatchObject({ phase: "match", publishedRoot: mismatch.scratchRoot, checkedCells: 5 });
});
test("an interrupted cutover commits nothing and its retry performs the swap exactly once", async () => {
  await fresh(); await publish([{ id: 1 }, { id: 2, row: row(2, { utcDay: 20_001 }) }]); await project();
  const matched = await complete(); expect(matched.phase).toBe("match");
  const before = await control(), retired = await publication(), jobRow = await run((_state, storage) => storage.sql.exec("SELECT * FROM usage_contribution_rebuild_jobs").toArray());
  let depth = 0, interrupted = false;
  const result = await run((_state, storage) => {
    const failing: Storage = { sql: storage.sql, transactionSync: callback => storage.transactionSync(() => {
      depth++; try { const value = callback(); if (depth === 1 && !interrupted) { interrupted = true; throw new Error("interrupted_before_commit"); } return value; }
      finally { depth--; }
    }) };
    return service(failing).publish(publishRequest(matched.version), observation());
  });
  expect(result).toEqual({ ok: false, error: "storage_unavailable" }); expect(interrupted).toBe(true);
  expect(await control()).toEqual(before); expect(await publication()).toEqual(retired);
  expect(await run((_state, storage) => storage.sql.exec("SELECT * FROM usage_contribution_rebuild_jobs").toArray())).toEqual(jobRow);
  expect((await status())!).toMatchObject({ receipt: matched, readiness: "ready" });
  await abortAllDurableObjects();
  const published = success(await publishStep(publishRequest(matched.version)));
  expect((await control()).publishedRoot).toEqual(matched.scratchRoot);
  expect(success(await publishStep(publishRequest(matched.version)))).toEqual(published);
  expect((await publication()).publishedAtMs).toBe(now);
});
test("cutover refuses a changed source revision, uncaught-up projection, drifted current root and unfinished jobs, with explicit readiness", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const expectedRevision = await run(state => state.control().revision);
  const initial = success(await execute({ ...readRequest(), action: "begin", expectedVersion: 0, expectedRevision }));
  expect(await publishStep(publishRequest(initial.version))).toEqual({ ok: false, error: "conflict" });
  expect((await status())!.readiness).toBe("ready");
  const matched = await complete(); expect(matched.phase).toBe("match");
  // A reserved-but-uncommitted canonical operation leaves the source revision
  // intact but the projection is no longer provably caught up.
  const staged = await stage([{ id: 1, row: row(9) }]);
  expect((await status())!.readiness).toBe("not_caught_up");
  expect(await publishStep(publishRequest(matched.version))).toEqual({ ok: false, error: "not_caught_up" });
  await finish(staged);
  // A changed source revision is a permanent conflict for this job, whether or
  // not the projection has caught up with it yet.
  expect((await status())!.readiness).toBe("conflict");
  expect(await publishStep(publishRequest(matched.version))).toEqual({ ok: false, error: "conflict" });
  await project();
  expect((await status())!.readiness).toBe("conflict");
  expect(await publishStep(publishRequest(matched.version))).toEqual({ ok: false, error: "conflict" });
  expect((await control()).publishedRoot).not.toEqual(matched.scratchRoot);
  expect((await status())!.receipt).toEqual(matched);
  // A second job at the new revision whose current root drifts before publish.
  const second = await run((_state, storage) => service(storage).execute({ ...readRequest(hex(912)), action: "begin", expectedVersion: 0,
    expectedRevision: expectedRevision + 1 }, observation()));
  let value = success(second);
  for (let index = 0; index < 8 && (value.phase === "building" || value.phase === "comparing"); index++) value = success(await execute(advanceRequest(value.version, hex(912))));
  expect(value.phase).toBe("match");
  const root = value.publishedRoot!, text = JSON.stringify({ schemaVersion: 3, ...scope(), kind: "branch", level: root.level + 1, children: [root] });
  const hash = contributionHash(text), wrapped = { ...root, hash, level: root.level + 1, byteLength: new TextEncoder().encode(text).byteLength };
  await env.STAGING.put(contributionIndexObjectKey(scope(), hash), text, { sha256: Uint8Array.from(Buffer.from(hash, "hex")).buffer,
    httpMetadata: { contentType: "application/vnd.aicharts.contribution-index-v3+json" }, customMetadata: { schemaVersion: "3" } });
  await replacePublishedRoot(wrapped);
  expect(await publishStep(publishRequest(value.version, hex(912)))).toEqual({ ok: false, error: "conflict" });
  expect((await control()).publishedRoot).toEqual(wrapped);
});
