import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE, contributionBodyHash, contributionHash, contributionPayloadHash,
  parseContributionBatch, type ContributionAuthority, type ContributionBatch, type ContributionMutation } from "../../../lib/usage/contributions";
import { readContributionIndexPage, stageContributionIndex, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { contributionCellKey, parseContributionCell, type ContributionCell } from "../../../lib/usage/contribution-rollups";
import { CONTRIBUTION_REBUILD_DEADLINE_MS, CONTRIBUTION_REBUILD_MAX_JOBS, CONTRIBUTION_REBUILD_METADATA_BYTES,
  parseContributionRebuildRequest, parseContributionRebuildReceipt, type ContributionRebuildReadRequest,
  type ContributionRebuildReceipt, type ContributionRebuildRequest, type ContributionRebuildResult } from "../../../lib/usage/contribution-rebuild-contract";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "../src/account-admission";
import { ContributionState } from "../src/contributions-state";
import { ensureContributionBody, readContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal } from "../src/contributions-journal";
import { contributionIndexObjectKey, ensureContributionIndexStage, readContributionIndexObject } from "../src/contribution-index-objects";
import { readCommittedContributionRevision, verifyContributionRevision, loadContributionRevisionChunk } from "../src/contribution-replay";
import { ContributionProjectionState, CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES, planContributionProjectionChunk } from "../src/contribution-projection-state";
import { ContributionRebuildState, type ContributionRebuildHeadPlan, type CheckedContributionRebuildJob } from "../src/contribution-rebuild-state";
import { AccountContributionRebuild } from "../src/contribution-rebuild";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), POPULATION = hex(4), COPY = hex(5), JOB = hex(900);
let serial = 0, operation = 0, account = "", now = 1_000_000;
const scope = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`rebuild-synthetic-${serial}`);
const run = <T>(callback: (state: ContributionState, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> =>
  runInDurableObject(stub(), (_instance, context) => callback(new ContributionState(context.storage), context.storage));
const authority = (): ContributionAuthority => ({ ...scope(), deviceId: DEVICE, active: true, observedAtMs: now, allowAccountTombstone: true });
const observed = () => ({ ...scope(), active: true, observedAtMs: now });
const observation = (): AdmissionObservation => ({ generation: env.USAGE_ENROLLMENT_GENERATION, observed: now, committed: false, fence: null });
const owner = (): AdmissionOwner => ({ ...scope(), phase: "active", observedAtMs: now, devices: [],
  anchor: { ...scope(), namespaceKey: hex(6), intentId: hex(7), reservationId: hex(8), createdAtMs: 1_000_000 } });
function transaction(storage: DurableObjectStorage, admitted: () => boolean = () => true): AdmissionTransaction {
  return (_observation, callback) => admitted() ? storage.transactionSync(() => ({ ok: true, value: callback(owner(), now) }))
    : { ok: false, error: "recovery_required" };
}
const readRequest = (jobId = JOB): ContributionRebuildReadRequest => ({ schemaVersion: 3, ...scope(), jobId });
const advanceRequest = (expectedVersion: number, jobId = JOB): ContributionRebuildRequest => ({ ...readRequest(jobId), action: "advance", expectedVersion });
const abortRequest = (expectedVersion: number, jobId = JOB): ContributionRebuildRequest => ({ ...readRequest(jobId), action: "abort", expectedVersion });
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
type Item = Readonly<{ id: number; row?: UsageStatsRow; kind?: "remove" | "tombstone" }>;
async function fresh(): Promise<void> {
  await run((state, storage) => {
    state.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    state.activateFresh({ schemaVersion: 3, ...scope(), deviceId: DEVICE, operationId: hex(++operation), expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    for (const populationId of [POPULATION, COPY]) state.grantPopulation({ schemaVersion: 3, ...scope(), deviceId: DEVICE,
      populationId, operationId: hex(++operation), expectedRevision: state.control().revision, expectedWriterRevision: 0, previousDeviceId: null,
      abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
    new ContributionProjectionState(storage).initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    new ContributionRebuildState(storage).initialize();
  });
}
async function batch(items: readonly Item[], populationId = POPULATION): Promise<ContributionBatch> {
  return run(state => {
    const population = state.population(populationId)!;
    const mutations: ContributionMutation[] = items.map(item => {
      const id = hex(item.id, 32), expectedHeadHash = state.head(id)?.headHash ?? null;
      return item.kind ? { kind: item.kind, id, expectedHeadHash: expectedHeadHash! } : { kind: "put", id, expectedHeadHash, row: item.row ?? row(item.id) };
    });
    const result = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY, grain: "observation",
      ...scope(), deviceId: DEVICE, operationId: hex(++operation), sequence: state.sequence(env.USAGE_ENROLLMENT_GENERATION, DEVICE) + 1,
      expectedRevision: state.control().revision, populationId, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null, mutations });
    if (!result) throw new Error("invalid_synthetic_batch"); return result;
  });
}
async function publish(items: readonly Item[], populationId = POPULATION): Promise<ContributionBatch> {
  const value = await batch(items, populationId);
  const bundle = await run(state => { const result = state.deltaBundle(value, authority()); state.reserve(value, authority()); return result; });
  const body = await ensureContributionBody(env.STAGING, value, () => true); if (!body.ok) throw new Error(body.error);
  const journal = await ensureContributionJournal(env.STAGING, bundle, () => true);
  await run(state => state.commit(value, body.value, authority(), journal)); return value;
}
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
    expect(projection.control().appliedRevision).toBe(state.control().revision);
    now += 16_000; vi.setSystemTime(now); projection.publish(observed());
  });
}
async function execute(input: unknown, staging = env.STAGING, admitted: () => boolean = () => true): Promise<ContributionRebuildResult> {
  return run((_state, storage) => new AccountContributionRebuild({ STAGING: staging }, new ContributionRebuildState(storage), transaction(storage, admitted)).execute(input, observation()));
}
async function begin(jobId = JOB): Promise<ContributionRebuildReceipt> {
  const expectedRevision = await run(state => state.control().revision);
  return success(await execute({ ...readRequest(jobId), action: "begin", expectedVersion: 0, expectedRevision }));
}
async function complete(initial?: ContributionRebuildReceipt): Promise<ContributionRebuildReceipt> {
  let value = initial ?? await begin();
  for (let index = 0; index < 32 && (value.phase === "building" || value.phase === "comparing"); index++) value = success(await execute(advanceRequest(value.version, value.jobId)));
  if (value.phase === "building" || value.phase === "comparing") throw new Error("synthetic_rebuild_exceeded_bound"); return value;
}
const status = (jobId = JOB) => run((_state, storage) => new ContributionRebuildState(storage).status(jobId));
const quota = () => run((_state, storage) => new ContributionProjectionState(storage).control().immutableBytes);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function bucket(intercept: (method: "get" | "put", key: string, invoke: () => Promise<unknown>) => Promise<unknown>): R2Bucket {
  return new Proxy(env.STAGING, { get(target, name) {
    const value: unknown = Reflect.get(target, name, target);
    if ((name === "get" || name === "put") && typeof value === "function") return (key: string, ...args: unknown[]) =>
      intercept(name, key, () => Reflect.apply(value, target, [key, ...args]) as Promise<unknown>);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function replacePublishedRoot(reference: ContributionIndexReference | null): Promise<void> {
  await run((state, storage) => {
    const text = reference === null ? null : JSON.stringify(reference);
    storage.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=?,published_root=? WHERE id=1", text, text);
    storage.sql.exec("UPDATE usage_contribution_projection_publications SET root=? WHERE revision=?", text, state.control().revision);
  });
}
async function replacePublishedCells(cells: readonly ContributionCell[]): Promise<void> {
  const plan = await stageContributionIndex(scope(), null, cells.map(cell => ({ key: contributionCellKey(cell.dimensions), before: null, after: cell })), async () => null);
  if (!plan.ok) throw new Error(plan.error);
  const stored = await ensureContributionIndexStage(env.STAGING, scope(), plan.value, () => true); await replacePublishedRoot(stored.root);
}
async function forgedHead(value: ContributionBatch): Promise<void> {
  const mutation = value.mutations[0]; if (mutation.kind !== "put") throw new Error("fixture_requires_put");
  const payloadHash = contributionPayloadHash(mutation.row);
  const headHash = contributionHash(`aicharts:contribution-head:v3\0${JSON.stringify([account, scope().generation, value.operationId, mutation.id, payloadHash])}`);
  await run((_state, storage) => storage.sql.exec("UPDATE usage_contribution_heads SET head_hash=?,payload_hash=?,reference=? WHERE id=?", headHash, payloadHash,
    JSON.stringify({ kind: "batch-v3", bodyHash: contributionBodyHash(value), index: 0, payloadHash }), mutation.id));
}
async function publishedCells(): Promise<readonly ContributionCell[]> {
  const root = await run((_state, storage) => new ContributionProjectionState(storage).control().publishedRoot);
  const result = await readContributionIndexPage(scope(), root, { firstUtcDay: 20_000, dayCount: 366, limit: 256, cursor: null },
    reference => readContributionIndexObject(env.STAGING, scope(), reference));
  if (!result.ok) throw new Error(result.error); return result.value.cells;
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

test("strict requests reject hostile, oversized, extra, missing and signed-zero positions before SQL or provider work", async () => {
  const valid = { ...readRequest(), action: "begin", expectedVersion: 0, expectedRevision: 3 };
  let getters = 0;
  const hostile = { ...valid }; Object.defineProperty(hostile, "jobId", { enumerable: true, get() { getters++; return JOB; } });
  for (const value of [{ ...valid, extra: true }, { ...valid, jobId: "x".repeat(2050) }, { ...valid, expectedVersion: -0 },
    { ...valid, expectedRevision: 0 }, { ...valid, action: "advance" }, { ...advanceRequest(1), expectedRevision: 3 }, hostile]) {
    expect(parseContributionRebuildRequest(value)).toBeNull();
    expect(await execute(value)).toEqual({ ok: false, error: "invalid_input" });
  }
  expect(getters).toBe(0); expect(parseContributionRebuildRequest(valid)).toEqual(valid);
});
test("constructors, status and bounded inventory are SELECT-only and do not initialize missing state", async () => {
  await fresh(); await project(); await begin();
  await run((_state, storage) => {
    const exec = vi.spyOn(storage.sql, "exec"), alarm = vi.spyOn(storage, "setAlarm"), put = vi.spyOn(env.STAGING, "put"), get = vi.spyOn(env.STAGING, "get");
    const state = new ContributionRebuildState(storage), reader = new AccountContributionRebuild(env, state, transaction(storage));
    expect(reader.status(readRequest(), observation())).toMatchObject({ ok: true, value: { pending: false, chargedBytes: 0 } });
    expect(state.inventory()).toHaveLength(1); expect(state.status(hex(999))).toBeNull();
    expect(exec.mock.calls.every(([text]) => /^SELECT /u.test(text))).toBe(true);
    expect(exec.mock.calls.some(([text, limit]) => text.includes("ORDER BY id LIMIT ?") && limit === 17)).toBe(true);
    expect(alarm).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  await runInDurableObject(env.ACCOUNT_ENROLLMENTS.getByName(`rebuild-absent-${serial}`), (_instance, context) => {
    const before = context.storage.sql.exec("SELECT name,sql FROM sqlite_schema").toArray();
    const absent = new ContributionRebuildState(context.storage); expect(() => absent.status(JOB)).toThrow();
    expect(context.storage.sql.exec("SELECT name,sql FROM sqlite_schema").toArray()).toEqual(before);
  });
});
test("empty committed source compares without object I/O and begin replay retains its initial receipt", async () => {
  await fresh(); await project(); const initial = await begin();
  const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put");
  const result = await complete(initial);
  expect(result).toMatchObject({ phase: "match", headCount: 0, processedHeads: 0, checkedCells: 0, headSteps: 0, comparisonSteps: 1, version: 2 });
  expect(await begin()).toEqual(initial); expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  expect(await execute(advanceRequest(result.version))).toEqual({ ok: false, error: "conflict" });
});
test("multiple head and comparison chunks independently match corrections, copies, removals and tombstones", async () => {
  await fresh();
  await publish(Array.from({ length: 37 }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index }) })));
  await publish([{ id: 1, row: row(1) }], COPY);
  await publish([{ id: 1, kind: "remove" }, { id: 2, kind: "tombstone" }, { id: 3, row: row(900, { utcDay: 20_100, client: "codex" }) }]);
  await publish([{ id: 1, kind: "remove" }], COPY); await project();
  const result = await complete();
  expect(result).toMatchObject({ phase: "match", processedHeads: 37, liveHeads: 35, checkedCells: 35, headSteps: 3, comparisonSteps: 3 });
  expect(result.scratchRoot?.cells).toBe(35);
  expect((await status())!.chargedBytes).toBe(result.chargedBytes);
});
test("sixteen-head cursor boundary advances exactly once and a repeated last request performs no new I/O", async () => {
  await fresh(); await publish(Array.from({ length: 17 }, (_, index) => ({ id: index + 1 }))); await project();
  const initial = await begin(), first = success(await execute(advanceRequest(initial.version)));
  expect(first).toMatchObject({ phase: "building", processedHeads: 16, version: 2, budget: { sourceObjects: 16 } });
  const charged = await quota(), get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put");
  expect(success(await execute(advanceRequest(initial.version)))).toEqual(first);
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(await quota()).toBe(charged);
  const second = success(await execute(advanceRequest(first.version))); expect(second.processedHeads).toBe(17);
  expect(await execute(advanceRequest(initial.version))).toEqual({ ok: false, error: "conflict" });
});
test("validly encoded wrong published cells fail independent comparison after a durable matched prefix", async () => {
  await fresh(); await publish(Array.from({ length: 33 }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index }) }))); await project();
  const cells = [...await publishedCells()], changed = parseContributionCell({ ...cells[32], tokens: { ...cells[32].tokens, input: "999999" } });
  if (!changed) throw new Error("invalid_negative_control"); cells[32] = changed; await replacePublishedCells(cells);
  let value = await begin(); while (value.phase === "building") value = success(await execute(advanceRequest(value.version)));
  value = success(await execute(advanceRequest(value.version))); expect(value.checkedCells).toBe(16);
  await abortAllDurableObjects();
  value = success(await execute(advanceRequest(value.version))); expect(value.checkedCells).toBe(32);
  const result = success(await execute(advanceRequest(value.version)));
  expect(result).toMatchObject({ phase: "mismatch", checkedCells: 32, difference: { rebuilt: { tokens: { input: "33" } }, published: { tokens: { input: "999999" } } } });
});
test("semantic equality traverses equal hashes and also accepts a different valid tree history", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const root = await run((_state, storage) => new ContributionProjectionState(storage).control().publishedRoot!);
  const text = JSON.stringify({ schemaVersion: 3, ...scope(), kind: "branch", level: 1, children: [root] }), hash = contributionHash(text);
  const parent = { ...root, hash, level: 1, byteLength: new TextEncoder().encode(text).byteLength };
  await env.STAGING.put(contributionIndexObjectKey(scope(), hash), text, { sha256: Uint8Array.from(Buffer.from(hash, "hex")).buffer,
    httpMetadata: { contentType: "application/vnd.aicharts.contribution-index-v3+json" }, customMetadata: { schemaVersion: "3" } });
  await replacePublishedRoot(parent);
  const result = await complete(); expect(result.phase).toBe("match"); expect(result.scratchRoot?.hash).not.toBe(result.publishedRoot?.hash);
  await replacePublishedRoot(root); let second = await begin(hex(901)); second = success(await execute(advanceRequest(second.version, second.jobId)));
  expect(second.scratchRoot?.hash).toBe(second.publishedRoot?.hash);
  const get = vi.spyOn(env.STAGING, "get"); const compared = success(await execute(advanceRequest(second.version, second.jobId)));
  expect(compared.phase).toBe("match"); expect(get).toHaveBeenCalled();
});
test("lost stage acknowledgement and process restart reconstruct the exact reservation without another charge", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); const initial = await begin(), before = await quota();
  let lost = false;
  const failing = bucket(async (method, _key, invoke) => { const value = await invoke(); if (method === "put" && !lost) { lost = true; throw new Error("lost_ack"); } return value; });
  expect(await execute(advanceRequest(initial.version), failing)).toEqual({ ok: false, error: "storage_unavailable" });
  const pending = (await status())!; expect(pending.pending).toBe(true); expect(pending.receipt).toEqual(initial); expect(pending.chargedBytes).toBeGreaterThan(0);
  const reserved = await quota(); expect(reserved).toBe(before + pending.chargedBytes);
  await abortAllDurableObjects();
  const result = success(await execute(advanceRequest(initial.version))); expect(result.phase).toBe("comparing"); expect(await quota()).toBe(reserved);
  expect((await status())!.pending).toBe(false);
});
test("shared projection quota is charged atomically and exhausted rebuild admission performs no put", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); const initial = await begin();
  await run((_state, storage) => storage.sql.exec("UPDATE usage_contribution_projection_control SET immutable_bytes=? WHERE id=1", CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES));
  const put = vi.spyOn(env.STAGING, "put");
  expect(await execute(advanceRequest(initial.version))).toEqual({ ok: false, error: "limit" });
  expect(put).not.toHaveBeenCalled(); expect((await status())!).toEqual({ receipt: initial, pending: false, chargedBytes: 0, readiness: "unobserved" });
  expect(await quota()).toBe(CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES);
});
test("aborted scratch charges remain visible to later ordinary projection reservations", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); const initial = await begin();
  const failing = bucket(async (method, _key, invoke) => { if (method === "put") throw new Error("provider_unavailable"); return invoke(); });
  expect(await execute(advanceRequest(initial.version), failing)).toEqual({ ok: false, error: "storage_unavailable" });
  const reserved = await quota(), aborted = success(await execute(abortRequest(initial.version)));
  expect(aborted.phase).toBe("aborted"); expect(aborted.chargedBytes).toBeGreaterThan(0); expect(await quota()).toBe(reserved);
  await publish([{ id: 1, row: row(42) }]); await project();
  expect(await quota()).toBeGreaterThan(reserved); expect((await status())!.chargedBytes).toBe(aborted.chargedBytes);
  expect(success(await execute(abortRequest(initial.version)))).toEqual(aborted);
});
test("source correction during a body await refuses the old step and explicit abort tolerates that drift", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); const initial = await begin(), entered = deferred(), release = deferred();
  const correction = await batch([{ id: 1, row: row(88) }]);
  const delayed = bucket(async (method, key, invoke) => { if (method === "get" && key.startsWith("usage-contributions/")) { entered.resolve(); await release.promise; } return invoke(); });
  await run(async (canonical, storage) => {
    const pending = new AccountContributionRebuild({ STAGING: delayed }, new ContributionRebuildState(storage), transaction(storage))
      .execute(advanceRequest(initial.version), observation());
    await entered.promise;
    const bundle = canonical.deltaBundle(correction, authority()); canonical.reserve(correction, authority());
    const body = await ensureContributionBody(env.STAGING, correction, () => true); if (!body.ok) throw new Error(body.error);
    const journal = await ensureContributionJournal(env.STAGING, bundle, () => true);
    canonical.commit(correction, body.value, authority(), journal); release.resolve();
    expect(await pending).toEqual({ ok: false, error: "conflict" });
  });
  expect((await status())!.receipt.processedHeads).toBe(0);
  expect(success(await execute(abortRequest(initial.version))).phase).toBe("aborted");
});
test("late immutable completion after abort cannot move the cursor or start a readback", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); const initial = await begin(), entered = deferred(), release = deferred();
  let readsAfterRelease = 0, released = false;
  const delayed = bucket(async (method, _key, invoke) => {
    if (method === "put") { entered.resolve(); await release.promise; }
    if (method === "get" && released) readsAfterRelease++;
    return invoke();
  });
  await run(async (_canonical, storage) => {
    const state = new ContributionRebuildState(storage), service = new AccountContributionRebuild({ STAGING: delayed }, state, transaction(storage));
    const pending = service.execute(advanceRequest(initial.version), observation()); await entered.promise;
    const projection = new ContributionProjectionState(storage), reserved = projection.control().immutableBytes;
    const aborted = success(await service.execute(abortRequest(initial.version), observation())); released = true; release.resolve();
    expect(await pending).toEqual({ ok: false, error: "conflict" }); expect(readsAfterRelease).toBe(0);
    expect(state.status(JOB)!.receipt).toEqual(aborted); expect(projection.control().immutableBytes).toBe(reserved);
    state.begin(hex(901), initial.sourceRevision, observed()); expect(state.status(JOB)!.receipt).toEqual(aborted);
  });
});
test("full published reference drift during comparison refuses even when its hash is unchanged", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); let value = await begin(); value = success(await execute(advanceRequest(value.version)));
  const entered = deferred(), release = deferred();
  const delayed = bucket(async (method, _key, invoke) => { if (method === "get") { entered.resolve(); await release.promise; } return invoke(); });
  await run(async (canonical, storage) => {
    const state = new ContributionRebuildState(storage);
    const pending = new AccountContributionRebuild({ STAGING: delayed }, state, transaction(storage)).execute(advanceRequest(value.version), observation());
    await entered.promise;
    const text = JSON.stringify({ ...value.publishedRoot!, byteLength: value.publishedRoot!.byteLength + 1 });
    storage.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=?,published_root=? WHERE id=1", text, text);
    storage.sql.exec("UPDATE usage_contribution_projection_publications SET root=? WHERE revision=?", text, canonical.control().revision);
    release.resolve(); expect(await pending).toEqual({ ok: false, error: "conflict" }); expect(state.status(JOB)!.receipt).toEqual(value);
  });
});
test("failure on the second comparison side commits neither prefix and retries from the same SQL position", async () => {
  await fresh(); await publish(Array.from({ length: 17 }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index }) }))); await project();
  const original = await publishedCells(); await replacePublishedCells(original);
  let value = await begin(); while (value.phase === "building") value = success(await execute(advanceRequest(value.version)));
  // Wrap the published root to force a distinct second-side provider read.
  const root = value.publishedRoot!, text = JSON.stringify({ schemaVersion: 3, ...scope(), kind: "branch", level: root.level + 1, children: [root] });
  const hash = contributionHash(text), wrapped = { ...root, hash, level: root.level + 1, byteLength: new TextEncoder().encode(text).byteLength };
  await env.STAGING.put(contributionIndexObjectKey(scope(), hash), text, { sha256: Uint8Array.from(Buffer.from(hash, "hex")).buffer,
    httpMetadata: { contentType: "application/vnd.aicharts.contribution-index-v3+json" }, customMetadata: { schemaVersion: "3" } });
  // A new job must pin that root; an existing job is never repinned.
  success(await execute(abortRequest(value.version))); await replacePublishedRoot(wrapped);
  value = await begin(hex(901)); while (value.phase === "building") value = success(await execute(advanceRequest(value.version, value.jobId)));
  const failing = bucket(async (method, key, invoke) => { if (method === "get" && key === contributionIndexObjectKey(scope(), hash)) throw new Error("second_side_failed"); return invoke(); });
  expect(await execute(advanceRequest(value.version, value.jobId), failing)).toEqual({ ok: false, error: "storage_unavailable" });
  expect((await status(value.jobId))!.receipt).toEqual(value);
  const result = await complete(value); expect(result.phase).toBe("match"); expect(result.checkedCells).toBe(17);
});
test("one end-to-end deadline does not renew between bodies and checks retirement before late SQL", async () => {
  await fresh(); await publish([{ id: 1 }, { id: 2 }, { id: 3 }]); await project(); const initial = await begin();
  let elapsed = 0, reads = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const delayed = bucket(async (method, _key, invoke) => { const value = await invoke(); if (method === "get") { reads++; elapsed += 16_000; } return value; });
  expect(await execute(advanceRequest(initial.version), delayed)).toEqual({ ok: false, error: "deadline" });
  expect(reads).toBe(2); expect((await status())!.receipt).toEqual(initial);
});
test("terminal timer retirement prevents SQL and new provider calls when a held read later completes", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); const initial = await begin(), entered = deferred(), release = deferred();
  let expire!: () => void, gets = 0;
  const originalTimer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    if (delay === CONTRIBUTION_REBUILD_DEADLINE_MS) expire = () => callback(...args);
    return originalTimer(callback, delay, ...args);
  });
  const delayed = bucket(async (method, _key, invoke) => { if (method === "get") { gets++; entered.resolve(); await release.promise; } return invoke(); });
  await run(async (_canonical, storage) => {
    const state = new ContributionRebuildState(storage), sql = vi.spyOn(storage.sql, "exec");
    const pending = new AccountContributionRebuild({ STAGING: delayed }, state, transaction(storage)).execute(advanceRequest(initial.version), observation());
    await entered.promise; expire(); expect(await pending).toEqual({ ok: false, error: "deadline" });
    const statements = sql.mock.calls.length; release.resolve();
    await new Promise<void>(resolve => originalTimer(resolve, 20));
    expect(sql.mock.calls.length).toBe(statements); expect(gets).toBe(1);
  });
  expect((await status())!.receipt).toEqual(initial);
});
test("authority refusal during an await stops further work and preserves the original diagnostic", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); const initial = await begin(); let admitted = true, gets = 0;
  const revoked = bucket(async (method, _key, invoke) => { const value = await invoke(); if (method === "get") { gets++; admitted = false; } return value; });
  expect(await execute(advanceRequest(initial.version), revoked, () => admitted)).toEqual({ ok: false, error: "recovery_required" });
  expect(gets).toBe(1); expect((await status())!.receipt).toEqual(initial);
});
test("canonical head lookahead and committed SQL operation binding reject corrupt inventories and orphan bytes", async () => {
  await fresh(); await publish(Array.from({ length: 17 }, (_, index) => ({ id: index + 1 }))); await project();
  await run((_state, storage) => storage.sql.exec("UPDATE usage_contribution_control SET head_count=16 WHERE id=1"));
  let initial = await begin(); const get = vi.spyOn(env.STAGING, "get");
  expect(await execute(advanceRequest(initial.version))).toEqual({ ok: false, error: "storage_invalid" }); expect(get).not.toHaveBeenCalled();
  success(await execute(abortRequest(initial.version)));
  await run((_state, storage) => storage.sql.exec("UPDATE usage_contribution_control SET head_count=17 WHERE id=1"));
  const orphan = await batch([{ id: 1, row: row(999) }]), body = await ensureContributionBody(env.STAGING, orphan, () => true);
  if (!body.ok) throw new Error(body.error);
  await forgedHead(orphan);
  initial = await begin(hex(901));
  expect(await execute(advanceRequest(initial.version, initial.jobId))).toEqual({ ok: false, error: "storage_invalid" });
});
test.each(["pending", "abandoned"] as const)("a %s SQL operation cannot authorize a live head even when body bytes and head hashes are valid", async outcome => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const candidate = await batch([{ id: 1, row: row(999) }]); await run(state => state.reserve(candidate, authority()));
  const body = await ensureContributionBody(env.STAGING, candidate, () => true); if (!body.ok) throw new Error(body.error);
  if (outcome === "abandoned") { await run(state => state.abandon(candidate.operationId, contributionBodyHash(candidate), authority())); await project(); }
  else await run((_state, storage) => storage.sql.exec("UPDATE usage_contribution_control SET pending_operation=NULL WHERE id=1"));
  // Coordinated corruption of the head is still caught by retained terminal
  // authority. The checker does not infer commitment from valid object bytes.
  await forgedHead(candidate); const initial = await begin();
  expect(await execute(advanceRequest(initial.version))).toEqual({ ok: false, error: "storage_invalid" });
});
test("uncaught-up, pending canonical and legacy head states refuse without being labelled verified", async () => {
  await fresh(); await publish([{ id: 1 }]);
  let expectedRevision = await run(state => state.control().revision);
  expect(await execute({ ...readRequest(), action: "begin", expectedVersion: 0, expectedRevision })).toEqual({ ok: false, error: "not_caught_up" });
  await project(); const pending = await batch([{ id: 1, row: row(2) }]); await run(state => state.reserve(pending, authority()));
  expect(await execute({ ...readRequest(), action: "begin", expectedVersion: 0, expectedRevision })).toEqual({ ok: false, error: "not_caught_up" });
  await run(state => state.abandon(pending.operationId, contributionBodyHash(pending), authority())); await project();
  await run((_state, storage) => storage.sql.exec("UPDATE usage_contribution_heads SET legacy_support=1 WHERE id=?", hex(1, 32)));
  expectedRevision = await run(state => state.control().revision);
  const initial = success(await execute({ ...readRequest(), action: "begin", expectedVersion: 0, expectedRevision }));
  expect(await execute(advanceRequest(initial.version))).toEqual({ ok: false, error: "legacy_unresolved" });
});
test("fabricated and stale job/plan capabilities cannot skip a prefix or reserve writes", async () => {
  await fresh(); const source = await publish([{ id: 1 }]); await project(); const initial = await begin();
  await run(async (_canonical, storage) => {
    const state = new ContributionRebuildState(storage), job = state.checked(JOB, initial.version, observed());
    expect(() => state.headChunk({ ...job }, observed())).toThrow();
    const chunk = state.headChunk(job, observed()), loaded = await readContributionBody(env.STAGING, account, contributionBodyHash(source));
    if (!loaded.ok) throw new Error(loaded.error);
    const checked = state.resolveHead(chunk, hex(1, 32), loaded.value.batch, loaded.value.verified, observed());
    await expect(state.planHeadStep(job, chunk, [{ ...checked }], () => Promise.resolve(null))).rejects.toMatchObject({ code: "invalid_input" });
    const plan = await state.planHeadStep(job, chunk, [checked], reference => readContributionIndexObject(env.STAGING, scope(), reference));
    expect(() => state.reserveHeadStep({ ...plan } as ContributionRebuildHeadPlan, observed())).toThrow();
    state.abort(JOB, initial.version, observed());
    expect(() => state.reserveHeadStep(plan, observed())).toThrow();
    await expect(state.planComparison({ ...job, receipt: { ...job.receipt, phase: "comparing", checkedCells: 999 } } as CheckedContributionRebuildJob,
      () => Promise.resolve(null))).rejects.toMatchObject({ code: "invalid_input" });
  });
});
test("job IDs are permanent, one job is active, and the sixteenth retained identity exhausts admission", async () => {
  await fresh(); await project(); const first = await begin();
  expect(await execute({ ...readRequest(hex(901)), action: "begin", expectedVersion: 0, expectedRevision: first.sourceRevision }))
    .toEqual({ ok: false, error: "conflict" });
  for (let index = 0; index < CONTRIBUTION_REBUILD_MAX_JOBS; index++) {
    const initial = index === 0 ? first : await begin(hex(900 + index));
    success(await execute(abortRequest(initial.version, initial.jobId)));
  }
  expect(await execute({ ...readRequest(hex(999)), action: "begin", expectedVersion: 0, expectedRevision: first.sourceRevision }))
    .toEqual({ ok: false, error: "limit" });
  expect(await begin()).toEqual(first);
  expect(await run((_state, storage) => new ContributionRebuildState(storage).inventory())).toHaveLength(16);
});
test("job metadata has an exact UTF-8 SQL cap and malformed comparison prefixes fail closed", async () => {
  await fresh(); await publish([{ id: 1 }]); await project(); await begin();
  await run((_canonical, storage) => {
    const state = new ContributionRebuildState(storage);
    expect(() => storage.sql.exec("UPDATE usage_contribution_rebuild_jobs SET metadata=? WHERE id=?", "é".repeat(CONTRIBUTION_REBUILD_METADATA_BYTES / 2 + 1), JOB)).toThrow();
    const raw = storage.sql.exec("SELECT metadata FROM usage_contribution_rebuild_jobs WHERE id=?", JOB).one().metadata;
    expect(new TextEncoder().encode(String(raw)).byteLength).toBeLessThan(CONTRIBUTION_REBUILD_METADATA_BYTES);
    const parsed = JSON.parse(String(raw)); parsed.leftCursor = { rootHash: hex(42), afterKey: "bad", scannedCells: 16 };
    storage.sql.exec("UPDATE usage_contribution_rebuild_jobs SET metadata=? WHERE id=?", JSON.stringify(parsed), JOB);
    expect(() => state.status(JOB)).toThrow(); expect(() => state.inventory()).toThrow();
  });
});
