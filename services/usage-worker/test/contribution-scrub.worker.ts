import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE, contributionBodyHash, contributionHash, contributionPayloadHash,
  parseContributionBatch, type ContributionAuthority, type ContributionBatch, type ContributionMutation } from "../../../lib/usage/contributions";
import { stageContributionIndex, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { contributionCellKey, type ContributionCell } from "../../../lib/usage/contribution-rollups";
import { CONTRIBUTION_SCRUB_DEADLINE_MS, CONTRIBUTION_SCRUB_MAX_HEADS, CONTRIBUTION_SCRUB_MAX_READ_BYTES,
  parseContributionScrubReceipt, type ContributionScrubReceipt, type ContributionScrubRequest, type ContributionScrubResult } from "../../../lib/usage/contribution-scrub";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { ContributionState } from "../src/contributions-state";
import { ensureContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal } from "../src/contributions-journal";
import { contributionIndexObjectKey, ensureContributionIndexStage, readContributionIndexObject } from "../src/contribution-index-objects";
import { readCommittedContributionRevision, verifyContributionRevision, loadContributionRevisionChunk } from "../src/contribution-replay";
import { ContributionProjectionState, planContributionProjectionChunk } from "../src/contribution-projection-state";
import { scrubContributionCell, type ContributionScrubObservation } from "../src/contribution-scrub";

const hex = (n: number, width = 64) => n.toString(16).padStart(width, "0");
const DEVICE = hex(3), POPULATION = hex(4), COPY = hex(5);
let serial = 0, operation = 0, account = "", now = 1_000_000;
const owner = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`scrub-synthetic-${serial}`);
const run = <T>(callback: (state: ContributionState, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> =>
  runInDurableObject(stub(), (_instance, context) => callback(new ContributionState(context.storage), context.storage));
const authority = (): ContributionAuthority => ({ ...owner(), deviceId: DEVICE, active: true, observedAtMs: now, allowAccountTombstone: true });
const observe = (): ContributionScrubObservation => ({ ...owner(), active: true, observedAtMs: now });
const row = (n = 1, fields: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const value = parseUsageStatsRow({ utcDay: 20_000, client: "claude", provider: null, model: null,
    records: 1, tokens: { input: String(n), cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "1" },
    reportedCostMicrousd: "5", reportedCostRecords: 1, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: "7", timedRecords: 1, timedTokens: "5", tokenBasis: "reported", breakdownCoverage: "partial", ...fields });
  if (!value) throw new Error("invalid_synthetic_row"); return value;
};
const dimensions = (value = row()) => ({ utcDay: value.utcDay, client: value.client, provider: value.provider, model: value.model,
  tokenBasis: value.tokenBasis, breakdownCoverage: value.breakdownCoverage,
  costKind: value.reportedCostMicrousd !== null ? "reported" as const : value.estimatedCostMicrousd !== null ? "estimated" as const : "none" as const,
  timed: value.durationMs !== null });
const request = (state: ContributionState, value = row()): ContributionScrubRequest => ({ schemaVersion: 3, ...owner(),
  expectedRevision: state.control().revision, dimensions: dimensions(value) });
const success = (result: ContributionScrubResult): ContributionScrubReceipt => {
  if (!result.ok) throw new Error(`synthetic_scrub_refused:${result.error}`); return result.value;
};
async function fresh() {
  await run((state, storage) => {
    state.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    state.activateFresh({ schemaVersion: 3, ...owner(), deviceId: DEVICE, operationId: hex(++operation), expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    for (const populationId of [POPULATION, COPY]) state.grantPopulation({ schemaVersion: 3, ...owner(), deviceId: DEVICE,
      populationId, operationId: hex(++operation), expectedRevision: state.control().revision, expectedWriterRevision: 0, previousDeviceId: null,
      abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
    new ContributionProjectionState(storage).initialize(account, env.USAGE_ENROLLMENT_GENERATION);
  });
}
type Item = Readonly<{ id: number; row?: UsageStatsRow; kind?: "remove" | "tombstone" }>;
async function batch(items: readonly Item[], populationId = POPULATION): Promise<ContributionBatch> {
  return run(state => {
    const population = state.population(populationId)!;
    const mutations: ContributionMutation[] = items.map(item => {
      const id = hex(item.id, 32), expectedHeadHash = state.head(id)?.headHash ?? null;
      return item.kind ? { kind: item.kind, id, expectedHeadHash: expectedHeadHash! } : { kind: "put", id, expectedHeadHash, row: item.row ?? row() };
    });
    const value = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY, grain: "observation",
      ...owner(), deviceId: DEVICE, operationId: hex(++operation), sequence: state.sequence(env.USAGE_ENROLLMENT_GENERATION, DEVICE) + 1,
      expectedRevision: state.control().revision, populationId, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null, mutations });
    if (!value) throw new Error("invalid_synthetic_batch"); return value;
  });
}
async function publish(items: readonly Item[], populationId = POPULATION): Promise<ContributionBatch> {
  const value = await batch(items, populationId);
  const bundle = await run(state => { const result = state.deltaBundle(value, authority()); state.reserve(value, authority()); return result; });
  const body = await ensureContributionBody(env.STAGING, value, () => true); if (!body.ok) throw new Error(body.error);
  const journal = await ensureContributionJournal(env.STAGING, bundle, () => true);
  await run(state => state.commit(value, body.value, authority(), journal)); return value;
}
/** Exercise real staged projection state and R2 readers/writers for the expected
 * integration candidate. The scrub itself will not reuse these delta folds. */
async function project() {
  await run(async (state, storage) => {
    const projection = new ContributionProjectionState(storage);
    for (let iteration = 0; iteration < 128; iteration++) {
      const control = projection.control();
      if (control.appliedRevision === state.control().revision) break;
      const source = readCommittedContributionRevision(state, control.appliedRevision);
      if (!source) throw new Error("missing_synthetic_revision");
      const proof = await verifyContributionRevision(env.STAGING, source, () => true);
      if (control.source === null) projection.begin(proof, observe());
      const current = projection.control();
      if (source.deltaCount === 0 || current.phase === "add" && current.cursor === source.deltaCount) { projection.apply(observe()); continue; }
      const chunk = await loadContributionRevisionChunk(env.STAGING, proof, current.phase!, current.cursor, () => true);
      const plan = await planContributionProjectionChunk(current, chunk, reference => readContributionIndexObject(env.STAGING, owner(), reference));
      projection.reserve(plan, observe());
      const index = await ensureContributionIndexStage(env.STAGING, owner(), plan.stage, () => true);
      projection.commit(plan, index, observe());
    }
    expect(projection.control().appliedRevision).toBe(state.control().revision);
    now += 16_000; vi.setSystemTime(now); projection.publish(observe());
  });
}
async function scrub(value = row()) {
  return run((state, storage) => scrubContributionCell(env.STAGING, request(state, value), state, new ContributionProjectionState(storage), observe));
}
function bucket(get: (key: string, invoke: () => Promise<R2ObjectBody | null>) => Promise<R2ObjectBody | null>): R2Bucket {
  return new Proxy(env.STAGING, { get(target, name) {
    const value: unknown = Reflect.get(target, name, target);
    if (name === "get" && typeof value === "function") return (key: string) => get(key, () => Reflect.apply(value, target, [key]) as Promise<R2ObjectBody | null>);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function replacePublishedRoot(root: ContributionIndexReference | null) {
  await run((state, storage) => {
    const text = root === null ? null : JSON.stringify(root), revision = state.control().revision;
    storage.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=?,published_root=? WHERE id=1", text, text);
    storage.sql.exec("UPDATE usage_contribution_projection_publications SET root=? WHERE revision=?", text, revision);
  });
}
async function publishWrongCell(cell: ContributionCell) {
  const staged = await stageContributionIndex(owner(), null, [{ key: contributionCellKey(cell.dimensions), before: null, after: cell }], async () => null);
  if (!staged.ok) throw new Error(staged.error);
  const proof = await ensureContributionIndexStage(env.STAGING, owner(), staged.value, () => true);
  await replacePublishedRoot(proof.root);
}
beforeEach(() => {
  account = `acct_${hex(++serial, 32)}`; operation = serial * 1000; now = 1_000_000;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  const keys = (await env.STAGING.list()).objects.map(object => object.key); if (keys.length) await env.STAGING.delete(keys);
  await abortAllDurableObjects(); await reset();
});

test("single-cell scrub matches every numeric field without DML, writes, alarms or repair", async () => {
  await fresh(); const value = await publish([{ id: 1, row: row(7) }, { id: 2, row: row(9) }]); await project();
  await run(async (state, storage) => {
    const input = request(state), exec = vi.spyOn(storage.sql, "exec"), transaction = vi.spyOn(storage, "transactionSync"), alarm = vi.spyOn(storage, "setAlarm");
    const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put"), del = vi.spyOn(env.STAGING, "delete");
    const result = success(await scrubContributionCell(env.STAGING, input, state, new ContributionProjectionState(storage), observe));
    expect(parseContributionScrubReceipt(input, result)).toEqual(result);
    expect(result).toMatchObject({ scope: "single-cell", verdict: "match", checkedHeads: 2, liveHeads: 2, matchingHeads: 2, sourceObjects: 2, indexObjects: 1,
      expected: { observations: 2, tokens: { input: "16", cacheRead: "4", cacheWrite: "6", output: "8", reasoning: "2" },
        costMicrousd: "10", durationMs: "14", timedTokens: "10" } });
    expect(result.expected).toEqual(result.published); expect(result.sourceBytes).toBe(2 * new TextEncoder().encode(JSON.stringify(value)).byteLength);
    expect(result.readBytes).toBe(result.sourceBytes + result.indexBytes); expect(get).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    for (const spy of [transaction, alarm, put, del]) expect(spy).not.toHaveBeenCalled();
  });
});

test("moving correction independently empties the old cohort and fills the new one", async () => {
  await fresh(); await publish([{ id: 1, row: row(7) }]); await project();
  const changed = row(11, { utcDay: 20_001, client: "codex", reportedCostMicrousd: null, reportedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", breakdownCoverage: "complete" });
  await publish([{ id: 1, row: changed }]);
  expect(await scrub()).toEqual({ ok: false, error: "not_caught_up" });
  await project();
  expect(success(await scrub())).toMatchObject({ verdict: "match", expected: null, published: null, matchingHeads: 0 });
  expect(success(await scrub(changed))).toMatchObject({ verdict: "match", matchingHeads: 1,
    expected: { tokens: { input: "11" }, costMicrousd: null, durationMs: null, timedTokens: "0" } });
});

test("copies contribute once and zero-members or tombstoned heads never contribute", async () => {
  await fresh(); await publish([{ id: 1, row: row(7) }]); await publish([{ id: 1, row: row(7) }], COPY); await project();
  expect(success(await scrub())).toMatchObject({ checkedHeads: 1, liveHeads: 1, expected: { observations: 1, tokens: { input: "7" } } });
  await publish([{ id: 1, kind: "remove" }]); await project();
  expect(success(await scrub()).matchingHeads).toBe(1);
  await publish([{ id: 1, kind: "remove" }], COPY); await project();
  expect(success(await scrub())).toMatchObject({ checkedHeads: 1, liveHeads: 0, sourceObjects: 0, expected: null, published: null });
  await publish([{ id: 2, row: row(4) }]); await publish([{ id: 2, kind: "tombstone" }]); await project();
  expect(success(await scrub())).toMatchObject({ verdict: "match", checkedHeads: 2, liveHeads: 0, expected: null, published: null });
});

test("validly hashed but wrong, missing and phantom published cells produce mismatch", async () => {
  await fresh(); await publish([{ id: 1, row: row(7) }]); await project();
  const correct = success(await scrub()).expected!;
  await publishWrongCell({ ...correct, tokens: { ...correct.tokens, input: "8" } });
  expect(success(await scrub())).toMatchObject({ verdict: "mismatch", expected: { tokens: { input: "7" } }, published: { tokens: { input: "8" } } });
  await replacePublishedRoot(null);
  expect(success(await scrub())).toMatchObject({ verdict: "mismatch", expected: { observations: 1 }, published: null, indexObjects: 0 });
  const absent = row(7, { utcDay: 20_002 });
  await publishWrongCell({ ...correct, dimensions: dimensions(absent) });
  expect(success(await scrub(absent))).toMatchObject({ verdict: "mismatch", expected: null, matchingHeads: 0, published: { observations: 1 } });
});

for (const outcome of ["orphan", "pending", "abandoned"] as const) test(`${outcome} body cannot authorize a canonical head even when hashes match`, async () => {
  await fresh(); await publish([{ id: 1, row: row(7) }]); await project();
  const invalid = await batch([{ id: 1, row: row(7) }]);
  if (outcome !== "orphan") await run(state => state.reserve(invalid, authority()));
  const body = await ensureContributionBody(env.STAGING, invalid, () => true); if (!body.ok) throw new Error(body.error);
  if (outcome === "abandoned") { await run(state => state.abandon(invalid.operationId, contributionBodyHash(invalid), authority())); await project(); }
  await run(state => {
    const payload = contributionPayloadHash(row(7)), id = hex(1, 32);
    const reference = { kind: "batch-v3", bodyHash: contributionBodyHash(invalid), index: 0, payloadHash: payload };
    const headHash = contributionHash(`aicharts:contribution-head:v3\0${JSON.stringify([account, invalid.generation, invalid.operationId, id, payload])}`);
    state.sql.exec("UPDATE usage_contribution_heads SET head_hash=?,reference=? WHERE id=?", headHash, JSON.stringify(reference), id);
  });
  expect(await scrub()).toEqual({ ok: false, error: "storage_invalid" });
});

test("held reads recheck current SQL, authority, generation, clock and exact root", async () => {
  for (const change of ["revision", "authority", "generation", "clock", "root"] as const) {
    // Each iteration uses its own complete synthetic account.
    if (change !== "revision") { account = `acct_${hex(++serial, 32)}`; operation = serial * 1000; }
    await fresh(); await publish([{ id: 1 }]); await project();
    await run(async (state, storage) => {
      const entered = deferred(), release = deferred(); let current = observe(), gets = 0;
      const selected = bucket(async (_key, invoke) => { gets++; if (gets === 1) { entered.resolve(); await release.promise; } return invoke(); });
      const reading = scrubContributionCell(selected, request(state), state, new ContributionProjectionState(storage), () => current);
      await entered.promise;
      if (change === "revision") state.grantPopulation({ schemaVersion: 3, ...owner(), deviceId: DEVICE, populationId: hex(++operation), operationId: hex(++operation),
        expectedRevision: state.control().revision, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
      if (change === "authority") current = { ...current, active: false };
      if (change === "generation") current = { ...current, generation: hex(999) };
      if (change === "clock") current = { ...current, observedAtMs: now - 1 };
      if (change === "root") {
        state.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=NULL,published_root=NULL WHERE id=1");
        state.sql.exec("UPDATE usage_contribution_projection_publications SET root=NULL WHERE revision=?", state.control().revision);
      }
      release.resolve();
      expect(await reading).toEqual({ ok: false, error: change === "authority" ? "unauthorized" : change === "generation" ? "generation_conflict"
        : change === "clock" ? "clock_regressed" : "conflict" });
      expect(gets).toBe(1);
    });
  }
});

test("larger and legacy scopes refuse before provider reads, while keyset scans use the primary key", async () => {
  await fresh(); await publish(Array.from({ length: 17 }, (_, index) => ({ id: index + 1 }))); await project();
  const get = vi.spyOn(env.STAGING, "get");
  expect(await scrub()).toEqual({ ok: false, error: "scope_limit" }); expect(get).not.toHaveBeenCalled();
  await run(async (state, storage) => {
    const explain = storage.sql.exec("EXPLAIN QUERY PLAN SELECT id FROM usage_contribution_heads WHERE id > ? ORDER BY id LIMIT ?", "", 17).toArray();
    expect(explain.some(row => typeof row.detail === "string" && /SEARCH.*PRIMARY KEY/u.test(row.detail))).toBe(true);
    const original = state.control.bind(state);
    vi.spyOn(state, "control").mockImplementation(() => ({ ...original(), headCount: 16, legacySeal: { schemaVersion: 3 } as never }));
    expect(await scrubContributionCell(env.STAGING, { ...request(state) }, state, new ContributionProjectionState(storage), observe))
      .toEqual({ ok: false, error: "legacy_unresolved" });
    expect(get).not.toHaveBeenCalled();
  });
});

test("maximum 16 source reads plus 7 authenticated index nodes count exact bytes", async () => {
  await fresh(); await publish(Array.from({ length: CONTRIBUTION_SCRUB_MAX_HEADS }, (_, index) => ({ id: index + 1 }))); await project();
  let root = await run((_state, storage) => new ContributionProjectionState(storage).control().publishedRoot!);
  expect(root.level).toBe(0);
  for (let level = 1; level <= 6; level++) {
    const text = JSON.stringify({ schemaVersion: 3, ...owner(), kind: "branch", level, children: [root] });
    const hash = contributionHash(text), byteLength = new TextEncoder().encode(text).byteLength;
    await env.STAGING.put(contributionIndexObjectKey(owner(), hash), text, { sha256: Uint8Array.from(Buffer.from(hash, "hex")).buffer,
      httpMetadata: { contentType: "application/vnd.aicharts.contribution-index-v3+json" }, customMetadata: { schemaVersion: "3" } });
    root = { ...root, hash, level, byteLength };
  }
  await replacePublishedRoot(root);
  const get = vi.spyOn(env.STAGING, "get"); const value = success(await scrub());
  expect(value).toMatchObject({ verdict: "match", checkedHeads: 16, liveHeads: 16, matchingHeads: 16, sourceObjects: 16, indexObjects: 7 });
  expect(get).toHaveBeenCalledTimes(23); expect(value.readBytes).toBe(value.sourceBytes + value.indexBytes);
  expect(value.readBytes).toBeLessThanOrEqual(CONTRIBUTION_SCRUB_MAX_READ_BYTES);
});

test("one nonrenewable deadline retires a late read before observe, SQL or another get", async () => {
  await fresh(); await publish(Array.from({ length: 8 }, (_, index) => ({ id: index + 1 }))); await project();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] }); vi.setSystemTime(now);
  await run(async (state, storage) => {
    const entered = Array.from({ length: 8 }, deferred), observed = vi.fn(observe), exec = vi.spyOn(storage.sql, "exec"); let gets = 0;
    const selected = bucket(async (_key, invoke) => {
      const current = gets++; entered[current]?.resolve();
      await new Promise<void>(done => { setTimeout(done, 4_000); }); return invoke();
    });
    const reading = scrubContributionCell(selected, request(state), state, new ContributionProjectionState(storage), observed);
    for (let index = 0; index < 7; index++) { await entered[index].promise; await vi.advanceTimersByTimeAsync(4_000); }
    await entered[7].promise; await vi.advanceTimersByTimeAsync(CONTRIBUTION_SCRUB_DEADLINE_MS - 28_000);
    expect(await reading).toEqual({ ok: false, error: "deadline" });
    const observedCount = observed.mock.calls.length, sqlCount = exec.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gets).toBe(8); expect(observed).toHaveBeenCalledTimes(observedCount); expect(exec).toHaveBeenCalledTimes(sqlCount);
    exec.mockRestore();
  });
});
