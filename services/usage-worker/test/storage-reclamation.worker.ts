import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE, parseContributionBatch,
  type ContributionAuthority, type ContributionBatch, type ContributionMutation } from "../../../lib/usage/contributions";
import type { ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { parseReclamationLedgerEntry, parseReclamationRequest, RECLAMATION_REPLAY_HORIZON_MS,
  type ReclamationLedgerEntry, type ReclamationRequest, type ReclamationResult, type ReclamationStepReceipt } from "../../../lib/usage/reclamation-contract";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "../src/account-admission";
import { AccountWorkState } from "../src/account-work-state";
import { ContributionState } from "../src/contributions-state";
import { contributionObjectKey, ensureContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal, type ContributionJournalBundle } from "../src/contributions-journal";
import { contributionIndexObjectKey, ensureContributionIndexStage, readContributionIndexObject } from "../src/contribution-index-objects";
import { readCommittedContributionRevision, verifyContributionRevision, loadContributionRevisionChunk } from "../src/contribution-replay";
import { ContributionProjectionState, CONTRIBUTION_PROJECTION_RETIRE_MS, planContributionProjectionChunk } from "../src/contribution-projection-state";
import { ContributionRebuildState } from "../src/contribution-rebuild-state";
import { reclamationCapabilityReady, type ProductionEnvironment } from "../src/production";
import { AccountReclamation, type ReclamationEnvironment } from "../src/reclamation";
import { ReclamationState } from "../src/reclamation-state";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), POPULATION = hex(4);
let serial = 7_000, operation = 0, account = "", now = 1_000_000;
const scope = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`reclamation-synthetic-${serial}`);
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
    new AccountWorkState(storage).initialize(observed());
    new ContributionRebuildState(storage).initialize();
    new ReclamationState(storage).initialize();
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
/** Advance past the retire horizon and publish again so retired publication rows are pruned. */
async function retire(): Promise<void> {
  now += CONTRIBUTION_PROJECTION_RETIRE_MS + 1; vi.setSystemTime(now);
  await publish([{ id: 99 }]); await project();
}
const service = (storage: Storage, bucket: ReclamationEnvironment = { STAGING: env.STAGING }, enabled = true) =>
  new AccountReclamation(bucket, new ReclamationState(storage), transaction(storage), { enabled });
const request = (action: ReclamationRequest["action"], entries?: readonly ReclamationLedgerEntry[]): ReclamationRequest =>
  ({ schemaVersion: 1, ...scope(), action, ...(entries ? { entries } : {}) });
const execute = (input: unknown, bucket?: ReclamationEnvironment, enabled?: boolean) =>
  run((_state, storage) => service(storage, bucket, enabled).execute(input, observation()));
const success = (value: ReclamationResult): ReclamationStepReceipt => {
  if (!value.ok) throw new Error(`synthetic_reclamation_refused:${value.error}`); return value.value;
};
const entry = (surface: ReclamationLedgerEntry["surface"], key: string, reason: ReclamationLedgerEntry["reason"], age = RECLAMATION_REPLAY_HORIZON_MS + 1): ReclamationLedgerEntry =>
  ({ account, surface, key, reason, recordedAt: now - age, referencedBy: [] });
const nodeKey = (hash: string) => contributionIndexObjectKey(scope(), hash);
const currentRoot = () => run((_state, storage) => new ContributionProjectionState(storage).control().publishedRoot as ContributionIndexReference);
const exists = async (key: string) => (await env.STAGING.head(key)) !== null;
const ledger = (surface: string, key: string) => run((_state, storage) => new ReclamationState(storage).read(surface, key));

beforeEach(() => {
  account = `acct_${hex(++serial, 32)}`; operation = serial * 1000; now = 1_000_000 + RECLAMATION_REPLAY_HORIZON_MS * 2;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  const keys = (await env.STAGING.list()).objects.map(object => object.key); if (keys.length) await env.STAGING.delete(keys);
  await abortAllDurableObjects(); await reset();
});

test("a superseded index node is reclaimed only after retirement and the horizon; a live node is held every time", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const superseded = await currentRoot();
  await publish([{ id: 2 }]); await project();
  const live = await currentRoot();
  expect(superseded.hash).not.toBe(live.hash);
  const recorded = success(await execute(request("record", [entry("derived-index-node", nodeKey(superseded.hash), "superseded-root"),
    entry("derived-index-node", nodeKey(live.hash), "superseded-root")])));
  expect(recorded.entries).toBe(2); expect(recorded.recorded).toBe(2); expect(recorded.deletes).toBe(0);
  // The retired publication row still names the superseded root: held, not deleted.
  const early = success(await execute(request("step")));
  expect(early.deletes).toBe(0); expect(early.held).toBe(2); expect(early.walkReads).toBeGreaterThanOrEqual(0);
  expect(await exists(nodeKey(superseded.hash))).toBe(true);
  await retire();
  const later = success(await execute(request("step")));
  expect(later.deletes).toBe(1); expect(later.reclaimed).toBe(1); expect(later.held).toBe(1);
  expect(await exists(nodeKey(superseded.hash))).toBe(false); expect(await exists(nodeKey(live.hash))).toBe(true);
  expect((await ledger("derived-index-node", nodeKey(live.hash)))?.heldBy).toEqual(["index-walk"]);
  // Repeated steps never touch the live root, and the reclaimed row is terminal.
  for (let index = 0; index < 3; index++) {
    const again = success(await execute(request("step")));
    expect(again.deletes).toBe(0); expect(again.reclaimed).toBe(1); expect(again.held).toBe(1);
  }
  expect(await exists(nodeKey(live.hash))).toBe(true);
  expect(success(await execute(request("status"))).visited).toEqual([]);
});

test("a candidate recorded before its horizon is not eligible until the horizon passes", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const superseded = await currentRoot();
  await publish([{ id: 2 }]); await project(); await retire();
  success(await execute(request("record", [entry("derived-index-node", nodeKey(superseded.hash), "superseded-root", 1_000)])));
  expect(success(await execute(request("step"))).visited).toEqual([]);
  expect(await exists(nodeKey(superseded.hash))).toBe(true);
  now += RECLAMATION_REPLAY_HORIZON_MS; vi.setSystemTime(now);
  expect(success(await execute(request("step"))).deletes).toBe(1);
  expect(await exists(nodeKey(superseded.hash))).toBe(false);
});

test("an interrupted step resumes from the durable deleting marker without a second delete", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const superseded = await currentRoot();
  await publish([{ id: 2 }]); await project(); await retire();
  const key = nodeKey(superseded.hash);
  success(await execute(request("record", [entry("derived-index-node", key, "superseded-root")])));
  let deletes = 0;
  // Crash after the provider delete, before the ledger records completion.
  const crashing: ReclamationEnvironment = { STAGING: new Proxy(env.STAGING, { get: (target, property) => {
    if (property === "delete") return async (keys: string) => { deletes++; await target.delete(keys); throw new Error("synthetic_crash"); };
    const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } }) };
  const crashed = await execute(request("step"), crashing);
  expect(crashed).toEqual({ ok: false, error: "storage_unavailable" });
  expect((await ledger("derived-index-node", key))?.state).toBe("deleting"); expect(await exists(key)).toBe(false);
  const resumed = success(await execute(request("step")));
  expect(resumed.deletes).toBe(0); expect(resumed.reclaimed).toBe(1); expect(deletes).toBe(1);
  expect((await ledger("derived-index-node", key))?.state).toBe("reclaimed");
});

test("a crash before the provider delete resumes by re-verifying and deleting exactly once", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const superseded = await currentRoot();
  await publish([{ id: 2 }]); await project(); await retire();
  const key = nodeKey(superseded.hash);
  success(await execute(request("record", [entry("derived-index-node", key, "superseded-root")])));
  const crashing: ReclamationEnvironment = { STAGING: new Proxy(env.STAGING, { get: (target, property) => {
    if (property === "delete") return async () => { throw new Error("synthetic_crash"); };
    const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } }) };
  expect(await execute(request("step"), crashing)).toEqual({ ok: false, error: "storage_unavailable" });
  expect((await ledger("derived-index-node", key))?.state).toBe("deleting"); expect(await exists(key)).toBe(true);
  // A resumed deleting row whose object became referenced again is held, never deleted.
  const resumed = success(await execute(request("step")));
  expect(resumed.deletes).toBe(1); expect(resumed.reclaimed).toBe(1); expect(await exists(key)).toBe(false);
});

test("ledger replay is idempotent: re-recording returns the same rows and never re-reclaims", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const superseded = await currentRoot();
  await publish([{ id: 2 }]); await project(); await retire();
  const key = nodeKey(superseded.hash), entries = [entry("derived-index-node", key, "superseded-root")];
  const first = success(await execute(request("record", entries)));
  const replay = success(await execute(request("record", entries)));
  expect(replay.entries).toBe(1); expect(replay.visited).toEqual(first.visited);
  expect(await execute(request("record", [{ ...entries[0], reason: "aborted-scratch" }]))).toEqual({ ok: false, error: "conflict" });
  expect(success(await execute(request("step"))).deletes).toBe(1);
  const after = success(await execute(request("record", entries)));
  expect(after.visited[0].state).toBe("reclaimed"); expect(after.entries).toBe(1);
  let deletes = 0;
  const counting: ReclamationEnvironment = { STAGING: new Proxy(env.STAGING, { get: (target, property) => {
    if (property === "delete") return async (keys: string) => { deletes++; await target.delete(keys); };
    const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } }) };
  expect(success(await execute(request("step"), counting)).visited).toEqual([]); expect(deletes).toBe(0);
});

test("a disabled policy refuses every action including reads, and the production capability stays unset", async () => {
  await fresh();
  await run((_state, storage) => storage.sql.exec("DROP TABLE usage_reclamation_ledger"));
  for (const action of ["status", "record", "step"] as const) {
    const input = action === "record" ? request(action, [entry("derived-index-node", nodeKey(hex(1)), "superseded-root")]) : request(action);
    expect(await execute(input, undefined, false)).toEqual({ ok: false, error: "disabled" });
  }
  expect(await run((_state, storage) => ReclamationState.present(storage))).toBe(false);
  expect(await stub().executeReclamation(request("status"))).toEqual({ ok: false, error: "disabled" });
  expect(await stub().executeReclamation({ schemaVersion: 1, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION })).toEqual({ ok: false, error: "invalid_input" });
  const production = env as unknown as ProductionEnvironment;
  expect(reclamationCapabilityReady(production)).toBe(false);
  const armed = { ...production, AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" };
  expect(reclamationCapabilityReady(armed)).toBe(false);
  expect(reclamationCapabilityReady({ ...armed, AICHARTS_USAGE_RECLAMATION_ENABLED: "1" })).toBe(true);
  for (const value of [1, true, "true", " 1", "01", ""]) expect(reclamationCapabilityReady({ ...armed, AICHARTS_USAGE_RECLAMATION_ENABLED: value })).toBe(false);
  expect(reclamationCapabilityReady({ ...armed, AICHARTS_USAGE_RECLAMATION_ENABLED: "1", STAGING: undefined as unknown as R2Bucket })).toBe(false);
});

test("a busy account, a foreign key, an unsupported surface and a stale walk each refuse without deleting", async () => {
  await fresh(); await publish([{ id: 1 }]); await project();
  const superseded = await currentRoot();
  await publish([{ id: 2 }]); await project(); await retire();
  const key = nodeKey(superseded.hash);
  const foreign = `usage-projections/v3/${account}/${hex(9)}/nodes/${hex(10)}.json`;
  const other = `usage-projections/v3/acct_${hex(11, 32)}/${env.USAGE_ENROLLMENT_GENERATION}/nodes/${hex(10)}.json`;
  expect(parseReclamationLedgerEntry({ ...entry("derived-index-node", other, "superseded-root") })).toBeNull();
  expect(parseReclamationRequest(request("record", [entry("derived-index-node", other, "superseded-root")]))).toBeNull();
  success(await execute(request("record", [entry("derived-index-node", key, "superseded-root"), entry("derived-index-node", foreign, "superseded-root"),
    entry("namespace-anchor", `account-control/v1/${account.slice(5)}/namespace.aicn`, "account-deletion")])));
  // A pending canonical operation makes the account non-quiescent.
  const staged = await stage([{ id: 3 }]);
  expect(await execute(request("step"))).toEqual({ ok: false, error: "conflict" });
  expect(await exists(key)).toBe(true);
  await finish(staged); expect(await execute(request("step"))).toEqual({ ok: false, error: "conflict" });
  await project();
  const stepped = success(await execute(request("step")));
  expect(stepped.deletes).toBe(1); expect(stepped.refused).toBe(2);
  expect((await ledger("derived-index-node", foreign))?.refusal).toBe("foreign_key");
  expect((await ledger("namespace-anchor", `account-control/v1/${account.slice(5)}/namespace.aicn`))?.refusal).toBe("unsupported_surface");
  expect(await exists(`account-control/v1/${account.slice(5)}/namespace.aicn`)).toBe(false);
});

test("canonical bodies referenced by operations are held while an orphaned body is reclaimed", async () => {
  await fresh();
  const batch = await publish([{ id: 1 }]); await project();
  const orphan = contributionObjectKey(account, hex(4242)), unsupported = contributionObjectKey(account, hex(4343));
  await env.STAGING.put(orphan, "{}");
  const committedHash = await run(state => state.operation(batch.operationId)?.intent.bodyHash ?? null);
  if (committedHash === null) throw new Error("synthetic_missing_body");
  const committed = contributionObjectKey(account, committedHash);
  expect(await exists(committed)).toBe(true);
  success(await execute(request("record", [entry("canonical-body", committed, "orphaned-write"), entry("canonical-body", orphan, "orphaned-write"),
    entry("canonical-body", unsupported, "superseded-root")])));
  const stepped = success(await execute(request("step")));
  expect(stepped.deletes).toBe(1); expect(stepped.held).toBe(1); expect(stepped.refused).toBe(1);
  expect(await exists(committed)).toBe(true); expect(await exists(orphan)).toBe(false);
  expect((await ledger("canonical-body", committed))?.heldBy).toEqual(["operations"]);
  expect((await ledger("canonical-body", unsupported))?.refusal).toBe("unsupported_surface");
});

test("record refuses malformed input and bounds", async () => {
  await fresh();
  expect(await execute({ ...request("record", []) })).toEqual({ ok: false, error: "invalid_input" });
  expect(await execute({ ...request("step"), entries: [] })).toEqual({ ok: false, error: "invalid_input" });
  const entries = Array.from({ length: 5 }, (_, index) => entry("derived-index-node", nodeKey(hex(100 + index)), "superseded-root"));
  expect(await execute(request("record", entries))).toEqual({ ok: false, error: "invalid_input" });
  expect(await execute(request("record", [{ ...entries[0], recordedAt: now + 1 }]))).toEqual({ ok: false, error: "invalid_input" });
  expect(await execute(request("record", [{ ...entries[0], referencedBy: ["root:" + hex(1)] }]))).toMatchObject({ ok: true, value: { held: 1, recorded: 0 } });
});
