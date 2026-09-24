import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { contributionBodyHash, CONTRIBUTION_IDENTITY, CONTRIBUTION_MAX_IMMUTABLE_BYTES, CONTRIBUTION_MAX_OPERATIONS,
  CONTRIBUTION_PROFILE, parseContributionBatch, type ContributionAuthority, type ContributionBatch,
  type ContributionResult, type ContributionTerminal } from "../../../lib/usage/contributions";
import { type ContributionCancelRequest } from "../../../lib/usage/contribution-cancel";
import { ContributionState, CONTRIBUTION_MAX_METADATA_BYTES } from "../src/contributions-state";
import { AccountContributions } from "../src/contributions-admission";
import { ensureContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal } from "../src/contributions-journal";
import { readCommittedContributionRevision, verifyContributionRevision } from "../src/contribution-replay";
import { ensureNamespaceAnchor, type NamespaceAnchor } from "../src/namespace-anchor";
import { uploadSecretCommitment } from "../src/pairing";
import { type AdmissionObservation, type AdmissionOwner, type AdmissionTransaction } from "../src/account-admission";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), OTHER = hex(4), POPULATION = hex(5), COPY = hex(6), SECRET = hex(7), INTENT = hex(8);
const NOW = Date.UTC(2030, 8, 23, 12);
let serial = 0, operation = 0, account = "", commitment = "", anchor: NamespaceAnchor, revoked = false, admitted = true;
const scope = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`cancel-synthetic-${serial}`);
const run = <T>(callback: (state: ContributionState, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> =>
  runInDurableObject(stub(), (_instance, context) => callback(new ContributionState(context.storage), context.storage));
const authority = (fields: Partial<ContributionAuthority> = {}): ContributionAuthority => ({ ...scope(), deviceId: DEVICE,
  observedAtMs: NOW, active: true, allowAccountTombstone: false, ...fields });
const observe = (): AdmissionObservation => ({ generation: env.USAGE_ENROLLMENT_GENERATION, observed: NOW, committed: false, fence: null });
const owner = (): AdmissionOwner => ({ ...scope(), observedAtMs: NOW, phase: "active", anchor,
  devices: [{ deviceId: DEVICE, enrolledAtMs: NOW, revokedAtMs: revoked ? NOW : null,
    reservation: { intentId: INTENT, uploadCommitment: commitment } }] });
const transaction = (storage: DurableObjectStorage): AdmissionTransaction => (observation, callback) =>
  admitted && observation.generation === env.USAGE_ENROLLMENT_GENERATION
    ? storage.transactionSync(() => ({ ok: true, value: callback(owner(), NOW) })) : { ok: false, error: "recovery_required" };
function success<T>(result: ContributionResult<T> | { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`synthetic_cancel_failure:${result.error}`); return result.value;
}
async function batch(fields: Partial<ContributionBatch> = {}): Promise<ContributionBatch> {
  return run(state => {
    const population = state.population(POPULATION)!;
    const value = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
      grain: "observation", ...scope(), deviceId: DEVICE, operationId: hex(++operation), sequence: state.sequence(scope().generation, DEVICE) + 1,
      expectedRevision: state.control().revision, populationId: POPULATION, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null,
      mutations: [{ kind: "put", id: hex(1, 32), expectedHeadHash: null,
        row: { utcDay: Math.floor(NOW / 86_400_000), client: "claude", provider: null, model: null,
          tokens: { input: "120", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, records: 1,
          reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
          durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" } }], ...fields });
    if (!value) throw new Error("invalid_synthetic_batch"); return value;
  });
}
const request = (value: ContributionBatch, expectedRevision = value.expectedRevision): ContributionCancelRequest =>
  ({ schemaVersion: 3, ...scope(), deviceId: value.deviceId, expectedRevision, batch: value });
const snapshot = () => run(state => ({ control: state.control(), operations: state.sql.exec("SELECT * FROM usage_contribution_operations ORDER BY id").toArray(),
  heads: state.sql.exec("SELECT * FROM usage_contribution_heads ORDER BY id").toArray(),
  memberships: state.sql.exec("SELECT * FROM usage_contribution_memberships ORDER BY population_id,id").toArray(),
  populations: state.sql.exec("SELECT * FROM usage_contribution_populations ORDER BY id").toArray(),
  devices: state.sql.exec("SELECT * FROM usage_contribution_devices ORDER BY generation,device_id").toArray() }));
async function extraGrant() {
  await run(state => state.grantPopulation({ schemaVersion: 3, ...scope(), deviceId: DEVICE, populationId: COPY,
    operationId: hex(++operation), expectedRevision: state.control().revision, expectedWriterRevision: 0,
    previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false }));
}
async function reserveAndStore(value: ContributionBatch) {
  const bundle = await run(state => { state.reserve(value, authority()); return state.deltaBundle(value, authority()); });
  const body = success(await ensureContributionBody(env.STAGING, value, () => true));
  const journal = await ensureContributionJournal(env.STAGING, bundle, () => true);
  return { body, journal };
}
async function cancel(value: ContributionCancelRequest, beforeCommit?: () => Promise<void>, secret = SECRET, storageBucket = env.STAGING) {
  return run((state, storage) => new AccountContributions({ ...env, STAGING: storageBucket }, state, transaction(storage), beforeCommit)
    .cancel(value, secret, observe()));
}

beforeEach(async () => {
  account = `acct_${hex(++serial, 32)}`; operation = serial * 1000; revoked = false; admitted = true;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  commitment = success(await uploadSecretCommitment(INTENT, SECRET));
  anchor = { ...scope(), namespaceKey: hex(9), intentId: INTENT, reservationId: hex(10), createdAtMs: NOW };
  const retained: Promise<unknown>[] = [];
  await ensureNamespaceAnchor(env.CONTROL, anchor, () => true, promise => { retained.push(promise); }); await Promise.all(retained);
  await run(state => {
    state.initialize(account, scope().generation);
    state.activateFresh({ schemaVersion: 3, ...scope(), deviceId: DEVICE, operationId: hex(++operation), expectedRevision: 0,
      mode: "fresh-empty" }, authority(), () => true);
    state.grantPopulation({ schemaVersion: 3, ...scope(), deviceId: DEVICE, operationId: hex(++operation), populationId: POPULATION,
      expectedRevision: 1, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
  });
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(value => value.key); if (keys.length) await bucket.delete(keys);
  }
  await reset();
});

test("absent cancellation fences a stale batch with one empty revision and metadata-only charge", async () => {
  const frozen = await batch(); await extraGrant();
  const before = await snapshot(), input = request(frozen, before.control.revision);
  const terminal = success(await cancel(input));
  expect(terminal).toEqual({ outcome: "abandoned", operationId: frozen.operationId, bodyHash: contributionBodyHash(frozen), revision: before.control.revision + 1 });
  const after = await snapshot();
  expect(after.control).toMatchObject({ revision: before.control.revision + 1, operationCount: before.control.operationCount + 1,
    metadataBytes: before.control.metadataBytes + 8192, immutableBytes: before.control.immutableBytes, pendingOperation: null });
  expect(after.heads).toEqual(before.heads); expect(after.memberships).toEqual(before.memberships); expect(after.populations).toEqual(before.populations);
  await run(state => {
    expect(state.sequence(scope().generation, DEVICE)).toBe(1);
    const retained = state.operation(frozen.operationId)!;
    expect(retained.intent).toMatchObject({ expectedRevision: frozen.expectedRevision, deltaManifestHash: null, deltaBytes: 0, deltaCount: 0 });
    expect(retained).toMatchObject({ outcome: "abandoned", deltaHash: null, deltaCount: null });
    expect(state.reserve(frozen, authority()).terminal).toEqual(terminal);
  });
  expect((await env.STAGING.list()).objects).toEqual([]);
});

test("lost cancellation replies survive restart and exact retry ignores stale CAS without recharging", async () => {
  const frozen = await batch(), input = request(frozen), terminal = success(await cancel(input));
  const before = await snapshot(); await abortAllDurableObjects();
  const beforeCommit = vi.fn(async () => { throw new Error("must_not_arm_retained_terminal"); });
  expect(success(await cancel({ ...input, expectedRevision: 0 }, beforeCommit))).toEqual(terminal);
  expect(beforeCommit).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
  const status = await run((state, storage) => new AccountContributions(env, state, transaction(storage)).status({ schemaVersion: 3,
    ...scope(), deviceId: DEVICE, populationId: POPULATION, operationId: frozen.operationId }, SECRET, observe()));
  expect(success(status)).toMatchObject({ nextSequence: 2, operation: { outcome: "abandoned", terminal } });
  expect(await snapshot()).toEqual(before);
});

test("cancellation's canonical step replays without any numeric object read", async () => {
  const frozen = await batch(); success(await cancel(request(frozen)));
  let reads = 0;
  const denied = new Proxy(env.STAGING, { get() { reads++; throw new Error("numeric_object_read"); } });
  await run(async state => {
    const source = readCommittedContributionRevision(state, frozen.expectedRevision)!;
    expect(source).toMatchObject({ revision: frozen.expectedRevision + 1, deltaManifestHash: null, deltaCount: 0 });
    expect((await verifyContributionRevision(denied, source, () => true)).source).toEqual(source);
  });
  expect(reads).toBe(0);
});

test("cancel after reservation wins over a late verified-body commit and keeps original charges", async () => {
  const frozen = await batch(), proof = await reserveAndStore(frozen), before = await snapshot();
  const terminal = success(await cancel(request(frozen)));
  await run(state => expect(state.commit(frozen, proof.body, authority(), proof.journal)).toEqual(terminal));
  const after = await snapshot();
  expect(after.control).toMatchObject({ operationCount: before.control.operationCount, immutableBytes: before.control.immutableBytes,
    metadataBytes: before.control.metadataBytes, revision: before.control.revision + 1 });
  expect(after.heads).toEqual([]);
  await run(state => expect(state.operation(frozen.operationId)!.intent.deltaManifestHash).not.toBeNull());
});

test("cancellation during held R2 I/O settles the late upload as abandoned without publishing heads", async () => {
  const frozen = await batch();
  await run(async (state, storage) => {
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let puts = 0;
    const held = new Proxy(env.STAGING, { get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === "put" && typeof value === "function") return async (...args: unknown[]) => {
        puts++; entered.resolve(); await release.promise; return Reflect.apply(value, target, args) as Promise<unknown>;
      };
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const service = new AccountContributions({ ...env, STAGING: held }, state, transaction(storage));
    const upload = service.admit(frozen, SECRET, observe());
    let terminal: ContributionTerminal | null = null, late: ContributionResult<ContributionTerminal> | null = null;
    try {
      await Promise.race([entered.promise, upload.then(() => { throw new Error("upload_did_not_reach_held_io"); })]);
      const reserved = state.control();
      terminal = success(await service.cancel(request(frozen), SECRET, observe()));
      expect(state.control()).toMatchObject({ operationCount: reserved.operationCount, immutableBytes: reserved.immutableBytes,
        metadataBytes: reserved.metadataBytes, revision: reserved.revision + 1, pendingOperation: null });
      expect(state.head(hex(1, 32))).toBeNull(); expect(puts).toBe(1);
    } finally { release.resolve(); late = await upload; }
    expect(success(late)).toEqual(terminal); expect(puts).toBe(1);
    expect(state.sequence(scope().generation, DEVICE)).toBe(1); expect(state.head(hex(1, 32))).toBeNull();
    expect(state.reserve(frozen, authority()).terminal).toEqual(terminal);
  });
});

test("a completed commit wins over cancellation and preserves its original receipt", async () => {
  const frozen = await batch(), proof = await reserveAndStore(frozen);
  const terminal = await run(state => state.commit(frozen, proof.body, authority(), proof.journal));
  const before = await snapshot();
  expect(success(await cancel(request(frozen, 0)))).toEqual(terminal);
  expect(await snapshot()).toEqual(before);
});

test("current auth still fences exact terminal reads while changed population position does not", async () => {
  const frozen = await batch(), input = request(frozen), terminal = success(await cancel(input));
  await run(state => state.sql.exec("UPDATE usage_contribution_populations SET device_id=?,writer_revision=2 WHERE id=?", OTHER, POPULATION));
  expect(success(await cancel(input))).toEqual(terminal);
  const before = await snapshot(); revoked = true;
  expect(await cancel(input)).toEqual({ ok: false, error: "revoked" });
  revoked = false;
  expect(await cancel(input, undefined, hex(999))).toEqual({ ok: false, error: "unauthorized" });
  expect(await snapshot()).toEqual(before);
});

test("stale or future cancellation CAS cannot mutate either an absent or pending batch", async () => {
  const frozen = await batch();
  for (const pending of [false, true]) {
    if (pending) await run(state => state.reserve(frozen, authority()));
    const before = await snapshot();
    for (const expectedRevision of [0, frozen.expectedRevision + 1])
      expect(await cancel(request(frozen, expectedRevision))).toEqual({ ok: false, error: "conflict" });
    expect(await snapshot()).toEqual(before);
  }
});

test("fresh cancellation cannot take another population's writer or consume another sequence", async () => {
  const frozen = await batch(), before = await snapshot();
  for (const fields of [{ writerRevision: 2 }, { populationId: COPY }])
    expect(await cancel(request({ ...frozen, ...fields }))).toEqual({ ok: false, error: "writer_conflict" });
  expect(await cancel(request({ ...frozen, sequence: 2 }))).toEqual({ ok: false, error: "conflict" });
  expect(await snapshot()).toEqual(before);
  await expect(run(state => state.cancelBatch(request(frozen), authority({ generation: hex(999) })))).rejects.toMatchObject({ code: "generation_conflict" });
  await expect(run(state => state.cancelBatch(request(frozen), authority({ observedAtMs: NOW - 1 })))).rejects.toMatchObject({ code: "clock_regressed" });
  expect(await snapshot()).toEqual(before);
});

test("a foreign pending operation is preserved and a changed frozen body never adopts its ID", async () => {
  const frozen = await batch(), foreign = await batch();
  await run(state => state.reserve(foreign, authority()));
  const before = await snapshot();
  expect(await cancel(request(frozen))).toEqual({ ok: false, error: "conflict" });
  expect(await cancel(request({ ...foreign, sequence: 2 }))).toEqual({ ok: false, error: "conflict" });
  expect(await snapshot()).toEqual(before);
  const terminal = success(await cancel(request(foreign)));
  expect(terminal.outcome).toBe("abandoned");
  expect(await cancel(request({ ...foreign, expectedPopulationHead: hex(999) }))).toEqual({ ok: false, error: "conflict" });
});

test("metadata-only cancellation can settle at immutable capacity but refuses missing metadata or revision capacity", async () => {
  const frozen = await batch();
  await run(state => state.sql.exec("UPDATE usage_contribution_control SET immutable_bytes=?", CONTRIBUTION_MAX_IMMUTABLE_BYTES));
  expect(success(await cancel(request(frozen))).outcome).toBe("abandoned");
  const next = await batch();
  await run(state => state.sql.exec("UPDATE usage_contribution_control SET metadata_bytes=?", CONTRIBUTION_MAX_METADATA_BYTES));
  const full = await snapshot();
  expect(await cancel(request(next))).toEqual({ ok: false, error: "limit" }); expect(await snapshot()).toEqual(full);
  await run(state => state.sql.exec("UPDATE usage_contribution_control SET revision=?", CONTRIBUTION_MAX_OPERATIONS));
  const final = await snapshot();
  expect(await cancel(request(next, CONTRIBUTION_MAX_OPERATIONS))).toEqual({ ok: false, error: "limit" }); expect(await snapshot()).toEqual(final);
});

test("failed pre-arm and revoked authority after its await preserve unknown or pending bytes", async () => {
  const frozen = await batch(), before = await snapshot();
  expect(await cancel(request(frozen), async () => { throw new Error("arm_failed"); })).toEqual({ ok: false, error: "storage_unavailable" });
  expect(await snapshot()).toEqual(before);
  expect(await cancel(request(frozen), async () => { revoked = true; })).toEqual({ ok: false, error: "revoked" });
  expect(await snapshot()).toEqual(before); revoked = false;
  expect(await cancel(request(frozen), async () => { admitted = false; })).toEqual({ ok: false, error: "recovery_required" });
  expect(await snapshot()).toEqual(before);
});

test("a concurrent exact cancellation during pre-arm is reconciled without another write or any R2 dispatch", async () => {
  const frozen = await batch(); let terminal: ContributionTerminal | null = null, attempts = 0;
  const denied = new Proxy(env.STAGING, { get() { attempts++; throw new Error("forbidden_r2_dispatch"); } });
  const result = await cancel(request(frozen), async () => { terminal = await run(state => state.cancelBatch(request(frozen), authority())); }, SECRET, denied);
  expect(success(result)).toEqual(terminal); expect(attempts).toBe(0);
  await run(state => expect(state.control()).toMatchObject({ operationCount: 3, metadataBytes: 3 * 8192, immutableBytes: 0 }));
});

test("unknown status and the older abandon route never fabricate absent cancellation authority", async () => {
  const frozen = await batch(), before = await snapshot();
  const status = await run((state, storage) => new AccountContributions(env, state, transaction(storage)).status({ schemaVersion: 3,
    ...scope(), deviceId: DEVICE, populationId: POPULATION, operationId: frozen.operationId }, SECRET, observe()));
  expect(success(status)).toMatchObject({ operation: null, nextSequence: 1 });
  await expect(run(state => state.abandon(frozen.operationId, contributionBodyHash(frozen), authority()))).rejects.toMatchObject({ code: "not_started" });
  expect(await snapshot()).toEqual(before);
});

test("the tagged terminal reader rejects mutated anchors or invented delta publication", async () => {
  const frozen = await batch(); success(await cancel(request(frozen)));
  await run(state => {
    const retained = state.sql.exec("SELECT metadata FROM usage_contribution_operations WHERE id=?", frozen.operationId).one().metadata as string;
    for (const fields of [{ mode: "pending" }, { accountId: `acct_${hex(999, 32)}` }, { sequence: 2 }, { metadataBytes: 8193 },
      { cancellationExpectedRevision: 0 }, { cancellationExpectedRevision: frozen.expectedRevision + 1 }, { deltaManifestHash: hex(999) }]) {
      state.sql.exec("UPDATE usage_contribution_operations SET metadata=? WHERE id=?", JSON.stringify({ ...JSON.parse(retained), ...fields }), frozen.operationId);
      expect(() => state.operation(frozen.operationId)).toThrow();
    }
    state.sql.exec("UPDATE usage_contribution_operations SET metadata=?,delta_hash=?,delta_count=0 WHERE id=?", retained, hex(999), frozen.operationId);
    expect(() => state.operation(frozen.operationId)).toThrow();
    state.sql.exec("UPDATE usage_contribution_operations SET delta_hash=NULL,delta_count=NULL WHERE id=?", frozen.operationId);
    expect(state.operation(frozen.operationId)!.terminal).toMatchObject({ outcome: "abandoned" });
  });
});
