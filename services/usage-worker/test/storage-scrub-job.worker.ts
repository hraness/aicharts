import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE, parseContributionBatch,
  type ContributionAuthority, type ContributionBatch, type ContributionMutation } from "../../../lib/usage/contributions";
import { readContributionIndexPage, stageContributionIndex, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { contributionCellKey, parseContributionCell, type ContributionCell, type ContributionCellDimensions } from "../../../lib/usage/contribution-rollups";
import { CONTRIBUTION_SCRUB_MAX_HEADS, parseContributionScrubJobReceipt, parseContributionScrubJobRequest,
  type ContributionScrubJobReceipt, type ContributionScrubJobRequest, type ContributionScrubJobResult, type ContributionScrubRequest } from "../../../lib/usage/contribution-scrub";
import type { ContributionRebuildReadRequest, ContributionRebuildReceipt, ContributionRebuildRequest, ContributionRebuildResult } from "../../../lib/usage/contribution-rebuild-contract";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "../src/account-admission";
import { ContributionState } from "../src/contributions-state";
import { ensureContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal, type ContributionJournalBundle } from "../src/contributions-journal";
import { ensureContributionIndexStage, readContributionIndexObject } from "../src/contribution-index-objects";
import { readCommittedContributionRevision, verifyContributionRevision, loadContributionRevisionChunk } from "../src/contribution-replay";
import { ContributionProjectionState, planContributionProjectionChunk } from "../src/contribution-projection-state";
import { ContributionRebuildState } from "../src/contribution-rebuild-state";
import { AccountContributionRebuild } from "../src/contribution-rebuild";
import { scrubContributionCell, scrubContributionJobCell } from "../src/contribution-scrub";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";

/** Scrub envelope for larger accounts (plan 6.3): the rebuild job is the
 * bounded, resumable whole-account head walk; the job-cell scrub reads one
 * cell of its verified scratch root against the pinned published root. */
const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), POPULATION = hex(4), JOB = hex(930);
let serial = 9_000, operation = 0, account = "", now = 1_000_000;
const scope = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`scrub-job-synthetic-${serial}`);
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
const success = (value: ContributionRebuildResult): ContributionRebuildReceipt => {
  if (!value.ok) throw new Error(`synthetic_rebuild_refused:${value.error}`); return value.value;
};
const row = (value = 1, fields: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const result = parseUsageStatsRow({ utcDay: 20_000, client: "claude", provider: null, model: null,
    records: 1, tokens: { input: String(value), cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "1" },
    reportedCostMicrousd: "5", reportedCostRecords: 1, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: "7", timedRecords: 1, timedTokens: "5", tokenBasis: "reported", breakdownCoverage: "partial", ...fields });
  if (!result) throw new Error("invalid_synthetic_row"); return result;
};
const dimensions = (utcDay: number): ContributionCellDimensions => ({ utcDay, client: "claude", provider: null, model: null,
  tokenBasis: "reported", breakdownCoverage: "partial", costKind: "reported", timed: true });
const cellRequest = (utcDay: number, expectedRevision: number): ContributionScrubRequest => ({ schemaVersion: 3, ...scope(), expectedRevision, dimensions: dimensions(utcDay) });
const jobRequest = (utcDay: number, receipt: ContributionRebuildReceipt, fields: Partial<ContributionScrubJobRequest> = {}): ContributionScrubJobRequest =>
  ({ ...cellRequest(utcDay, receipt.sourceRevision), jobId: receipt.jobId, expectedVersion: receipt.version, ...fields });
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
async function begin(jobId = JOB): Promise<ContributionRebuildReceipt> {
  const expectedRevision = await run(state => state.control().revision);
  return success(await execute({ ...readRequest(jobId), action: "begin", expectedVersion: 0, expectedRevision }));
}
async function complete(jobId = JOB): Promise<ContributionRebuildReceipt> {
  let value = await begin(jobId);
  for (let index = 0; index < 32 && (value.phase === "building" || value.phase === "comparing"); index++) value = success(await execute(advanceRequest(value.version, jobId)));
  return value;
}
const control = () => run((_state, storage) => new ContributionProjectionState(storage).control());
const scrubJob = (input: unknown): Promise<ContributionScrubJobResult> =>
  run((_state, storage) => scrubContributionJobCell(env.STAGING, input, new ContributionRebuildState(storage), observed));
const scrubCell = (input: unknown) => run((state, storage) => scrubContributionCell(env.STAGING, input, state, new ContributionProjectionState(storage), observed));
const ok = (value: ContributionScrubJobResult): ContributionScrubJobReceipt => { if (!value.ok) throw new Error(`synthetic_scrub_refused:${value.error}`); return value.value; };
async function cellsOf(root: ContributionIndexReference | null): Promise<readonly ContributionCell[]> {
  const result = await readContributionIndexPage(scope(), root, { firstUtcDay: 20_000, dayCount: 366, limit: 256, cursor: null },
    reference => readContributionIndexObject(env.STAGING, scope(), reference));
  if (!result.ok) throw new Error(result.error); return result.value.cells;
}
async function replacePublishedCells(cells: readonly ContributionCell[]): Promise<void> {
  const plan = await stageContributionIndex(scope(), null, cells.map(cell => ({ key: contributionCellKey(cell.dimensions), before: null, after: cell })), async () => null);
  if (!plan.ok) throw new Error(plan.error);
  const stored = await ensureContributionIndexStage(env.STAGING, scope(), plan.value, () => true);
  await run((state, storage) => {
    const text = JSON.stringify(stored.root);
    storage.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=?,published_root=? WHERE id=1", text, text);
    storage.sql.exec("UPDATE usage_contribution_projection_publications SET root=? WHERE revision=?", text, state.control().revision);
  });
}

beforeEach(() => {
  account = `acct_${hex(++serial, 32)}`; operation = serial * 1000; now = 1_000_000;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(object => object.key); if (keys.length) await bucket.delete(keys);
  }
  await abortAllDurableObjects(); await reset();
});

test("an account above the single-cell head envelope is scrubbed per cell through its matched rebuild job without source reads", async () => {
  const heads = CONTRIBUTION_SCRUB_MAX_HEADS + 3;
  await fresh(); await publish(Array.from({ length: heads }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index % 4 }) }))); await project();
  const revision = await run(state => state.control().revision);
  expect(await scrubCell(cellRequest(20_000, revision))).toEqual({ ok: false, error: "scope_limit" });
  const matched = await complete(); expect(matched.phase).toBe("match"); expect(matched.headCount).toBe(heads);
  const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put");
  const receipt = ok(await scrubJob(jobRequest(20_001, matched)));
  expect(parseContributionScrubJobReceipt(jobRequest(20_001, matched), receipt)).toEqual(receipt);
  expect(receipt).toMatchObject({ scope: "rebuild-job", verdict: "match", phase: "match", jobId: JOB, version: matched.version, revision: matched.sourceRevision,
    headCount: heads, scratchRootHash: matched.scratchRoot!.hash, rootHash: matched.publishedRoot!.hash, dimensions: dimensions(20_001) });
  expect(receipt.expected).toEqual(receipt.published); expect(receipt.expected?.observations).toBe(Math.ceil((heads - 1) / 4));
  const published = (await cellsOf(matched.publishedRoot)).find(cell => cell.dimensions.utcDay === 20_001);
  expect(receipt.published).toEqual(published);
  expect(receipt.scratchObjects).toBeGreaterThanOrEqual(1); expect(receipt.indexObjects).toBeGreaterThanOrEqual(1);
  expect(receipt.readBytes).toBe(receipt.scratchBytes + receipt.indexBytes);
  expect(get.mock.calls.length).toBeGreaterThanOrEqual(receipt.scratchObjects + receipt.indexObjects); expect(put).not.toHaveBeenCalled();
  expect(get.mock.calls.every(([key]) => typeof key === "string" && key.includes("/nodes/"))).toBe(true);
  // An absent cohort reads as null on both roots and still matches.
  const empty = ok(await scrubJob(jobRequest(20_100, matched)));
  expect(empty).toMatchObject({ verdict: "match", expected: null, published: null });
});

test("a mismatch job names exactly the cohort the published index disagrees on and matches every other cell", async () => {
  await fresh(); await publish(Array.from({ length: 5 }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index }) }))); await project();
  const correct = [...await cellsOf((await control()).publishedRoot)], wrong = [...correct];
  const changed = parseContributionCell({ ...correct[2], tokens: { ...correct[2].tokens, input: "424242" } }); if (!changed) throw new Error("invalid_negative_control");
  wrong[2] = changed; await replacePublishedCells(wrong);
  const mismatch = await complete(); expect(mismatch.phase).toBe("mismatch");
  const bad = ok(await scrubJob(jobRequest(20_002, mismatch)));
  expect(bad).toMatchObject({ verdict: "mismatch", phase: "mismatch", expected: correct[2], published: changed });
  for (const day of [20_000, 20_001, 20_003, 20_004]) {
    const good = ok(await scrubJob(jobRequest(day, mismatch)));
    expect(good).toMatchObject({ verdict: "match", expected: correct[day - 20_000], published: correct[day - 20_000] });
  }
  // A forged "match" phase over a mismatching cell never parses.
  expect(parseContributionScrubJobReceipt(jobRequest(20_002, mismatch), { ...bad, phase: "match" })).toBeNull();
  expect(parseContributionScrubJobReceipt(jobRequest(20_002, mismatch), { ...bad, verdict: "match" })).toBeNull();
  expect(parseContributionScrubJobRequest({ ...jobRequest(20_002, mismatch), expectedVersion: 0 })).toBeNull();
});

test("the job-cell scrub refuses unknown, unfinished, stale, unanchored and moved jobs with explicit statuses", async () => {
  await fresh(); await publish([{ id: 1 }, { id: 2, row: row(2, { utcDay: 20_001 }) }]); await project();
  const initial = await begin();
  expect(await scrubJob(jobRequest(20_000, { ...initial, jobId: hex(931) }))).toEqual({ ok: false, error: "invalid_input" });
  expect(await scrubJob(jobRequest(20_000, initial))).toEqual({ ok: false, error: "scope_limit" });
  const matched = await complete(); expect(matched.phase).toBe("match");
  expect(await scrubJob(jobRequest(20_000, matched, { expectedVersion: matched.version - 1 }))).toEqual({ ok: false, error: "conflict" });
  expect(await scrubJob(jobRequest(20_000, matched, { expectedRevision: matched.sourceRevision + 1 }))).toEqual({ ok: false, error: "conflict" });
  expect(await scrubJob(jobRequest(20_000, matched, { generation: hex(77) }))).toEqual({ ok: false, error: "generation_conflict" });
  ok(await scrubJob(jobRequest(20_000, matched)));
  const staged = await stage([{ id: 1, row: row(9) }]);
  expect(await scrubJob(jobRequest(20_000, matched))).toEqual({ ok: false, error: "not_caught_up" });
  await finish(staged);
  expect(await scrubJob(jobRequest(20_000, matched))).toEqual({ ok: false, error: "conflict" });
  await project();
  expect(await scrubJob(jobRequest(20_000, matched))).toEqual({ ok: false, error: "conflict" });
  const second = await complete(hex(932)); expect(second.phase).toBe("match");
  expect(ok(await scrubJob(jobRequest(20_000, second))).expected?.tokens.input).toBe("9");
  // Every anchor refusal is forwarded verbatim; unobserved and terminal are storage faults of the caller.
  for (const readiness of ["legacy_unresolved", "recovery_required", "clock_regressed", "unobserved", "terminal"] as const) {
    const result = await run((_state, storage) => {
      const rebuild = new ContributionRebuildState(storage), original = rebuild.status.bind(rebuild);
      vi.spyOn(rebuild, "status").mockImplementation((id, auth) => { const value = original(id, auth); return value && { ...value, readiness }; });
      return scrubContributionJobCell(env.STAGING, jobRequest(20_000, second), rebuild, observed);
    });
    expect(result).toEqual({ ok: false, error: readiness === "unobserved" || readiness === "terminal" ? "storage_invalid" : readiness });
  }
});

test("a job that moves during an index read invalidates the receipt as conflict", async () => {
  await fresh(); await publish(Array.from({ length: 3 }, (_, index) => ({ id: index + 1, row: row(index + 1, { utcDay: 20_000 + index }) }))); await project();
  const matched = await complete(); expect(matched.phase).toBe("match");
  const result = await run(async (_state, storage) => {
    const rebuild = new ContributionRebuildState(storage);
    const original = env.STAGING.get.bind(env.STAGING); let reads = 0;
    const get = vi.spyOn(env.STAGING, "get").mockImplementation(async (...args: Parameters<R2Bucket["get"]>) => {
      const value = await original(...args);
      if (++reads === 1) expect(rebuild.abort(matched.jobId, matched.version, observed()).phase).toBe("aborted");
      return value;
    });
    try { return await scrubContributionJobCell(env.STAGING, jobRequest(20_000, matched), rebuild, observed); } finally { get.mockRestore(); }
  });
  expect(result).toEqual({ ok: false, error: "conflict" });
});

/** RPC path on a real enrolled account: fenced authority, namespace anchor
 * checks before and after, SELECT-only local reads and no writes or alarm. */
test("the trusted job-cell scrub RPC qualifies a cell of an enrolled account's matched rebuild job", async () => {
  const NOW = Date.UTC(2032, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000);
  now = NOW; vi.setSystemTime(now); account = `acct_${hex(++serial, 32)}`;
  const proof = { intentId: hex(++serial), pollSecret: hex(++serial), uploadSecret: hex(++serial) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(++serial);
  const admit = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => { if (!result.ok) throw new Error(`synthetic_refusal:${result.error}`); return result.value; };
  admit(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment: admit(await uploadSecretCommitment(proof.intentId, proof.uploadSecret)) }));
  const attempt = admit(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, browserNonce, attemptId: attempt.attemptId, contextToken: attempt.contextToken };
  admit(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: now, sessionExpiresAtMs: now + PAIRING_TTL_MS }));
  admit(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: now + PAIRING_TTL_MS, decision: "approve" }));
  admit(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  admit(await pairing.reserveEnrollment(proof));
  const enrolled = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
  await runInDurableObject(enrolled, instance => {
    const holder = instance as unknown as { env: Env };
    holder.env = { ...holder.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
  });
  const deviceId = admit(await enrolled.enroll(proof)).receipt.deviceId;
  admit(await enrolled.activateContributions({ uploadSecret: proof.uploadSecret, request: { schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), expectedRevision: 0, mode: "fresh-empty" } }));
  admit(await enrolled.grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: { schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial),
    populationId: POPULATION, expectedRevision: 1, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
  admit(await enrolled.admitContributions({ uploadSecret: proof.uploadSecret, request: {
    schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
    grain: "observation", sequence: 1, expectedRevision: 2, populationId: POPULATION, writerRevision: 1,
    expectedPopulationRevision: 0, expectedPopulationHead: "0".repeat(64), replacement: null,
    mutations: [{ kind: "put", id: hex(1, 32), expectedHeadHash: null, row: row(7, { utcDay: DAY }) }] } }));
  for (let step = 0; step < 12; step++) {
    now += 16_000; vi.setSystemTime(now);
    if (admit(await enrolled.advanceContributionProjection({ schemaVersion: 3, ...scope() })).publishedRevision === 3) break;
  }
  await runInDurableObject(enrolled, async (_instance, ctx) => { await ctx.storage.deleteAlarm(); });
  const jobId = hex(933), request = { schemaVersion: 3 as const, ...scope(), jobId };
  let receipt = admit(await enrolled.executeContributionRebuild({ ...request, action: "begin", expectedVersion: 0, expectedRevision: 3 }));
  for (let index = 0; index < 8 && (receipt.phase === "building" || receipt.phase === "comparing"); index++) receipt = admit(await enrolled.executeContributionRebuild({ ...request, action: "advance", expectedVersion: receipt.version }));
  expect(receipt.phase).toBe("match");
  const input: ContributionScrubJobRequest = { schemaVersion: 3, ...scope(), expectedRevision: 3, dimensions: dimensions(DAY), jobId, expectedVersion: receipt.version };
  await runInDurableObject(enrolled, async (instance, ctx) => {
    const exec = vi.spyOn(ctx.storage.sql, "exec"), arm = vi.spyOn(ctx.storage, "setAlarm");
    const put = vi.spyOn(env.STAGING, "put"), del = vi.spyOn(env.STAGING, "delete"), controlPut = vi.spyOn(env.CONTROL, "put");
    const value = admit(await instance.scrubContributionJobCell(input));
    expect(value).toMatchObject({ scope: "rebuild-job", verdict: "match", revision: 3, jobId, version: receipt.version, headCount: 1, phase: "match" });
    expect(value.expected?.tokens.input).toBe("7"); expect(value.expected).toEqual(value.published);
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    expect(arm).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled(); expect(controlPut).not.toHaveBeenCalled();
    expect(await instance.scrubContributionJobCell({ ...input, expectedVersion: receipt.version + 1 })).toEqual({ ok: false, error: "conflict" });
    expect(await instance.scrubContributionJobCell({ ...input, jobId: hex(934) })).toEqual({ ok: false, error: "invalid_input" });
  });
  // A namespace loss during the final external check refuses an otherwise matched cell.
  await runInDurableObject(enrolled, async instance => {
    const holder = instance as unknown as { env: Env }, original = holder.env; let calls = 0;
    const get = vi.fn((...args: Parameters<R2Bucket["get"]>) => ++calls === 2 ? Promise.resolve(null) : original.CONTROL.get(...args));
    holder.env = { ...original, CONTROL: { get } } as unknown as Env;
    try { expect(await instance.scrubContributionJobCell(input)).toEqual({ ok: false, error: "recovery_required" }); expect(calls).toBe(2); }
    finally { holder.env = original; }
  });
});
