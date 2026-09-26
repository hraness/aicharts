import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ensureContributionJournal, readContributionJournalRoot, readContributionJournalPage, CONTRIBUTION_JOURNAL_MAX_ENTRIES,
  type VerifiedContributionJournal } from "../src/contributions-journal";
import { ContributionState, CONTRIBUTION_MAX_METADATA_BYTES } from "../src/contributions-state";
import { ensureContributionBody, readContributionBody, resolveContributionReference, type VerifiedContributionBody } from "../src/contributions-objects";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_MAX_HEADS, CONTRIBUTION_MAX_IMMUTABLE_BYTES,
  CONTRIBUTION_PROFILE, ContributionFault, contributionBodyHash, contributionHash, contributionPayloadHash,
  parseContributionBatch, type ContributionAuthority, type ContributionBatch, type ContributionMutation, type ContributionResult,
  type ContributionMigrationRequest, type ContributionMigrationReceipt, type ContributionTerminal } from "../../../lib/usage/contributions";
import { parseUsageStatsRow, parseUsageStatsReport, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { parseStatsUpload } from "../../../lib/usage/stats-http-contract";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { admissionHex, decodeAdmissionBatch, encodeAdmissionBatch, encodeAdmissionOperation } from "../../../lib/usage/admission";
import { AdmissionState, admissionIdBytes, type AdmissionAuthority } from "../src/admission-state";
import { advanceContributionMigration, captureContributionMigration, clearMigrationScratch, contributionMigrationBundle,
  ensureContributionMigration, stagedMigrationSnapshot,
  CONTRIBUTION_MIGRATION_MAX_HEADS, CONTRIBUTION_MIGRATION_STAGE_ROUNDS } from "../src/contributions-migration";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { StatsState } from "../src/stats-state";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const NOW = Date.UTC(2030, 8, 23, 12), DAY = Math.floor(NOW / DAY_MS), DEVICE = hex(3), OTHER = hex(4), POPULATION = hex(5), COPY = hex(6);
let serial = 0, operation = 100, account = "";
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const authority = (fields: Partial<ContributionAuthority> = {}): ContributionAuthority => ({ accountId: account,
  generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, active: true, observedAtMs: NOW, allowAccountTombstone: true, ...fields });
const success = <T>(result: ContributionResult<T> | { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic contribution failure: ${result.error}`); return result.value;
};
const onState = <T>(run: (state: ContributionState, storage: DurableObjectStorage) => T): Promise<T> =>
  runInDurableObject(stub(), (_instance, context) => run(new ContributionState(context.storage), context.storage));
const row = (input: number, fields: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const parsed = parseUsageStatsRow({ utcDay: DAY, client: "codex", provider: null, model: null,
    tokens: { input: String(input), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, records: 1,
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete", ...fields });
  if (!parsed) throw new Error("invalid synthetic row"); return parsed;
};
beforeEach(() => { account = `acct_${hex(++serial, 32)}`; operation = 1000 * serial; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(object => object.key); if (keys.length) await bucket.delete(keys);
  }
  await reset();
});
async function fresh(activate = true) {
  await onState(state => {
    state.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    if (activate) state.activateFresh({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    for (const populationId of [POPULATION, COPY]) state.grantPopulation({ schemaVersion: 3, operationId: hex(++operation),
      accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, populationId,
      expectedRevision: state.control().revision, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null },
    { ...authority(), previousWriterRevoked: false });
  });
}
async function request(items: readonly { id: number; input?: number; kind?: "remove" | "tombstone"; fields?: Partial<UsageStatsRow> }[],
  populationId = POPULATION, deviceId = DEVICE, fields: Partial<ContributionBatch> = {}): Promise<ContributionBatch> {
  const value = await onState(state => {
    const population = state.population(populationId)!;
    const mutations: ContributionMutation[] = items.map(item => {
      const id = hex(item.id, 32), expectedHeadHash = state.head(id)?.headHash ?? null;
      return item.kind ? { kind: item.kind, id, expectedHeadHash: expectedHeadHash! }
        : { kind: "put", id, expectedHeadHash, row: row(item.input ?? 1, item.fields) };
    });
    return { schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY, grain: "observation",
      accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId, operationId: hex(++operation),
      sequence: state.sequence(env.USAGE_ENROLLMENT_GENERATION, deviceId) + 1, expectedRevision: state.control().revision,
      populationId, writerRevision: population.writerRevision, expectedPopulationRevision: population.revision,
      expectedPopulationHead: population.headHash, replacement: null, mutations, ...fields };
  });
  const parsed = parseContributionBatch(value); if (!parsed) throw new Error("invalid synthetic batch"); return parsed;
}
const journals = new WeakMap<VerifiedContributionBody, VerifiedContributionJournal>();
async function journalFor(batch: ContributionBatch, body: VerifiedContributionBody): Promise<VerifiedContributionJournal> {
  const bundle = await onState(state => state.deltaBundle(batch, authority({ deviceId: batch.deviceId })));
  const journal = await ensureContributionJournal(env.STAGING, bundle, () => true); journals.set(body, journal); return journal;
}
async function reserveAndStore(batch: ContributionBatch): Promise<VerifiedContributionBody> {
  await onState(state => state.reserve(batch, authority({ deviceId: batch.deviceId })));
  const body = success(await ensureContributionBody(env.STAGING, batch, () => true)); await journalFor(batch, body); return body;
}
async function publish(batch: ContributionBatch) {
  const body = await reserveAndStore(batch);
  return onState(state => state.commit(batch, body, authority({ deviceId: batch.deviceId }), journals.get(body)!));
}
async function snapshot() {
  return onState(state => ({ control: state.control(), heads: state.sql.exec("SELECT * FROM usage_contribution_heads ORDER BY id").toArray(),
    memberships: state.sql.exec("SELECT * FROM usage_contribution_memberships ORDER BY population_id, id").toArray(),
    populations: state.sql.exec("SELECT * FROM usage_contribution_populations ORDER BY id").toArray(),
    operations: state.sql.exec("SELECT * FROM usage_contribution_operations ORDER BY id").toArray(),
    devices: state.sql.exec("SELECT * FROM usage_contribution_devices ORDER BY generation, device_id").toArray() }));
}
async function expectsFault(run: () => Promise<unknown>, code: string) {
  await expect(run()).rejects.toMatchObject({ code });
}
function proxyBucket(intercept: (invoke: () => Promise<unknown>) => Promise<unknown>): R2Bucket {
  return new Proxy(env.STAGING, { get(target, property) {
    const value: unknown = Reflect.get(target, property, target);
    if (property === "put" && typeof value === "function") return (...args: unknown[]) => intercept(() => Reflect.apply(value, target, args) as Promise<unknown>);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function enable() {
  await runInDurableObject(stub(), instance => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
  });
}
async function enrolled(): Promise<{ proof: EnrollmentProof; deviceId: string }> {
  await enable();
  const proof = { intentId: hex(++operation), pollSecret: hex(++operation), uploadSecret: hex(++operation) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(++operation);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof));
  const device = success(await stub().enroll(proof)); return { proof, deviceId: device.receipt.deviceId };
}
const activation = (deviceId: string) => ({ schemaVersion: 3 as const, operationId: hex(++operation), accountId: account,
  generation: env.USAGE_ENROLLMENT_GENERATION, deviceId, expectedRevision: 0, mode: "fresh-empty" as const });
async function rpcFresh() {
  const device = await enrolled();
  success(await stub().activateContributions({ uploadSecret: device.proof.uploadSecret, request: activation(device.deviceId) }));
  const expectedRevision = await onState(state => state.control().revision);
  success(await stub().grantContributionPopulation({ uploadSecret: device.proof.uploadSecret, request: { schemaVersion: 3,
    operationId: hex(++operation), accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: device.deviceId,
    populationId: POPULATION, expectedRevision, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
  return device;
}
function legacyBatch(deviceId: string, input = 120, identity = 1, sequence = 1) {
  const id = admissionIdBytes(hex(identity, 32));
  const frame = success(encodeUsageBatch({ utcDay: DAY, registryRevision: 1, usage: [{ id, executionId: new Uint8Array(16),
    accountId: new Uint8Array(16), offsetMs: 1, provider: 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
    tokens: { inputUncached: BigInt(input), cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, output: 0n, reasoningOutput: 0n } }], prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
  const operation = success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: admissionIdBytes(deviceId),
    generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: 1, sequence, occurrenceId: id, expectedHeadHash: new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  return success(decodeAdmissionBatch(success(encodeAdmissionBatch([operation], ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
}
function legacyStats(deviceId: string, client = "claude") {
  const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1, firstUtcDay: DAY,
    dayCount: 1, generatedAtMs: NOW, revision: 0, updatedAtMs: null, sources: [{ client, status: "observed",
      tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: NOW - 1 }], rows: [row(15, { client })] });
  const request = parseStatsUpload({ schemaVersion: 2, operationId: hex(++operation), accountId: account, deviceId,
    generation: env.USAGE_ENROLLMENT_GENERATION, sequence: 1, expectedRevision: 0, mode: "replace-window", takeover: null, report });
  if (!request) throw new Error("invalid legacy stats fixture"); return request;
}
async function preparedPopulation(device: { proof: EnrollmentProof; deviceId: string }) {
  success(await stub().grantContributionPopulation({ uploadSecret: device.proof.uploadSecret, request: { schemaVersion: 3,
    operationId: hex(++operation), accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: device.deviceId,
    populationId: POPULATION, expectedRevision: 0, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
}
async function migrationRequest(deviceId: string): Promise<ContributionMigrationRequest> {
  return onState(state => ({ schemaVersion: 3, operationId: hex(++operation), accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION,
    deviceId, expectedRevision: state.control().revision,
    expectedV1Revision: state.sql.exec("SELECT published_revision FROM usage_admission_control").one().published_revision as number,
    expectedV2Revision: new StatsState(state.sql).control().revision }));
}
type MigrationRpc = { migrateContributions(input: unknown): Promise<ContributionResult<ContributionMigrationReceipt>>;
  cancelContributionMigration(input: unknown): Promise<ContributionResult<ContributionTerminal>> };
const migrationRpc = () => stub() as unknown as MigrationRpc;

describe("V3 additive SQL and immutable numeric bodies", () => {
  test("constructors and reads never create or repair persistent storage", async () => {
    const before = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT name, sql FROM sqlite_schema ORDER BY name").toArray());
    await runInDurableObject(stub(), (_instance, state) => { new ContributionState(state.storage); });
    const after = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT name, sql FROM sqlite_schema ORDER BY name").toArray());
    expect(after).toEqual(before);
    await fresh(); const stored = await snapshot();
    await onState(state => { state.control(); state.population(POPULATION); state.head(hex(1, 32)); state.members(POPULATION); state.sequence(env.USAGE_ENROLLMENT_GENERATION, DEVICE); state.journal(0, 256); });
    expect(await snapshot()).toEqual(stored);
  });
  test("prepared state cannot admit; activation is explicit, exact and independently checked", async () => {
    await fresh(false); const batch = await request([{ id: 1, input: 120 }]), before = await snapshot();
    await expectsFault(() => onState(state => state.reserve(batch, authority())), "recovery_required");
    const value = { ...activation(DEVICE), expectedRevision: before.control.revision };
    await expectsFault(() => onState(state => state.activateFresh(value, authority(), () => false)), "recovery_required");
    expect(await snapshot()).toEqual(before);
    const receipt = await onState(state => state.activateFresh(value, authority(), () => true));
    expect(await onState(state => state.activateFresh(value, authority(), () => { throw new Error("retry must read terminal"); }))).toEqual(receipt);
    expect((await snapshot()).control.phase).toBe("active");
  });
  test("reserve charges once and R2 presence cannot publish; exact retries return immutable outcomes", async () => {
    await fresh(); const batch = await request([{ id: 1, input: 120 }]);
    const reserved = await onState(state => state.reserve(batch, authority())), first = await snapshot();
    expect(await onState(state => state.reserve(batch, authority()))).toEqual(reserved);
    expect(await snapshot()).toEqual(first);
    const body = success(await ensureContributionBody(env.STAGING, batch, () => true)); await journalFor(batch, body);
    expect((await snapshot()).heads).toEqual([]);
    expect(await onState(state => state.journal(3, 256))).toEqual([]);
    await expectsFault(() => onState(state => state.commit(batch, { ...body }, authority(), journals.get(body)!)), "storage_invalid");
    const terminal = await onState(state => state.commit(batch, body, authority(), journals.get(body)!));
    const committed = await snapshot();
    expect(await onState(state => state.commit(batch, body, authority(), journals.get(body)!))).toEqual(terminal);
    expect((await onState(state => state.reserve(batch, authority()))).terminal).toEqual(terminal);
    expect(await snapshot()).toEqual(committed);
    expect(JSON.stringify(committed)).not.toContain('"input"');
    const retained = success(await readContributionBody(env.STAGING, account, contributionBodyHash(batch)));
    expect(retained.batch).toEqual(batch);
  });
  test("120 plus 15 retains two facts while copied populations add only associations", async () => {
    await fresh(); await publish(await request([{ id: 1, input: 120 }, { id: 2, input: 15 }]));
    const copy = await request([{ id: 1, input: 120 }, { id: 2, input: 15 }], COPY), body = await reserveAndStore(copy);
    const deltas = await onState(state => {
      let count = -1; state.commit(copy, body, authority(), journals.get(body)!, values => { count = values.length; return undefined; }); return count;
    });
    expect(deltas).toBe(0);
    const state = await snapshot(); expect(state.heads).toHaveLength(2); expect(state.memberships).toHaveLength(4);
    expect(state.control.headCount).toBe(2); expect(state.control.membershipCount).toBe(4);
  });
  test("partial scans and empty complete replacements preserve other population copies", async () => {
    await fresh(); await publish(await request([{ id: 1, input: 120 }, { id: 2, input: 15 }]));
    await publish(await request([{ id: 1, input: 120 }], COPY));
    await publish(await request([{ id: 2, input: 18 }]));
    expect((await snapshot()).heads).toHaveLength(2);
    const clear = await request([], POPULATION, DEVICE, { replacement: { members: [] } }); await publish(clear);
    expect(await onState(state => state.head(hex(1, 32))?.members)).toBe(1);
    expect(await onState(state => state.head(hex(2, 32))?.members)).toBe(0);
    expect(await onState(state => state.members(POPULATION))).toEqual([]);
  });
  test("moved correction publishes exact old/new immutable references atomically", async () => {
    await fresh(); const first = await request([{ id: 1, input: 120 }]); await publish(first);
    const moved = await request([{ id: 1, input: 15, fields: { utcDay: DAY - 1, model: "gpt-5" } }]), body = await reserveAndStore(moved);
    const deltas = await onState(state => {
      let result: unknown; state.commit(moved, body, authority(), journals.get(body)!, changes => { result = changes; return undefined; }); return result;
    });
    expect(deltas).toMatchObject([{ id: hex(1, 32), before: { bodyHash: contributionBodyHash(first), index: 0 }, after: { bodyHash: contributionBodyHash(moved), index: 0 } }]);
  });
  test("multi-page replacement journals retain every removed reference and reserve every emitted byte", async () => {
    // Migration delta journals carry one entry per retained legacy head, so
    // the shared journal bound is the protocol head ceiling, not the smaller
    // batch-only member+mutation envelope.
    expect(CONTRIBUTION_JOURNAL_MAX_ENTRIES).toBe(CONTRIBUTION_MAX_HEADS);
    await fresh();
    await publish(await request(Array.from({ length: 256 }, (_, index) => ({ id: index + 1, input: index + 1 }))));
    await publish(await request([{ id: 257, input: 257 }]));
    const clear = await request([], POPULATION, DEVICE, { replacement: { members: [] } }), before = await snapshot();
    const objectsBefore = new Map((await env.STAGING.list()).objects.map(object => [object.key, object.size]));
    const body = await reserveAndStore(clear), reserved = await snapshot();
    const journal = journals.get(body)!, root = await readContributionJournalRoot(env.STAGING, account, journal.hash);
    expect(root.pages.map(page => page.count)).toEqual([256, 1]); expect(root.count).toBe(257);
    const entries = (await Promise.all(root.pages.map((_, index) => readContributionJournalPage(env.STAGING, root, index)))).flatMap(page => page.entries);
    expect(contributionHash(JSON.stringify(entries))).toBe(root.entriesHash);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(257);
    let removed = 0n;
    for (const entry of entries) {
      expect(entry.after).toBeNull();
      removed += BigInt(success(await resolveContributionReference(env.STAGING, account, entry.id, entry.before!)).tokens.input);
    }
    expect(removed).toBe(257n * 258n / 2n);
    const emittedBytes = (await env.STAGING.list()).objects.filter(object => !objectsBefore.has(object.key)).reduce((sum, object) => sum + object.size, 0);
    expect(reserved.control.immutableBytes - before.control.immutableBytes).toBe(emittedBytes);
    await onState(state => state.commit(clear, body, authority(), journal));
    expect(await onState(state => state.members(POPULATION))).toEqual([]);
    expect((await snapshot()).control.immutableBytes).toBe(reserved.control.immutableBytes);
  });
  test("a journal proof cannot be minted from a missing page, forged charge or copied capability", async () => {
    await fresh(); const batch = await request([{ id: 1, input: 120 }]);
    await onState(state => state.reserve(batch, authority()));
    const bundle = await onState(state => state.deltaBundle(batch, authority()));
    await expectsFault(() => ensureContributionJournal(env.STAGING, { ...bundle, pages: [] }, () => true), "invalid_input");
    await expectsFault(() => ensureContributionJournal(env.STAGING, { ...bundle, byteLength: bundle.byteLength - 1 }, () => true), "invalid_input");
    expect((await env.STAGING.list()).objects).toEqual([]);
    const body = success(await ensureContributionBody(env.STAGING, batch, () => true)), journal = await journalFor(batch, body), before = await snapshot();
    await expectsFault(() => onState(state => state.commit(batch, body, authority(), { ...journal })), "storage_invalid");
    expect(await snapshot()).toEqual(before);
    const ref = (await readContributionJournalPage(env.STAGING, bundle.root, 0)).entries[0].after!;
    expect(await resolveContributionReference(env.STAGING, account, hex(1, 32), { ...ref, index: 0.5 })).toEqual({ ok: false, error: "invalid_input" });
  });
  test("a lost immutable put reply reconciles without a second reservation or overwrite", async () => {
    await fresh(); const batch = await request([{ id: 1, input: 120 }]); await onState(state => state.reserve(batch, authority()));
    const before = await snapshot();
    const failed = await ensureContributionBody(proxyBucket(async invoke => { await invoke(); throw new Error("synthetic lost reply"); }), batch, () => true);
    expect(failed).toEqual({ ok: false, error: "storage_unavailable" }); expect(await snapshot()).toEqual(before);
    await onState(state => state.reserve(batch, authority()));
    const body = success(await ensureContributionBody(env.STAGING, batch, () => true)); await journalFor(batch, body); await onState(state => state.commit(batch, body, authority(), journals.get(body)!));
    expect((await snapshot()).control.immutableBytes).toBe(before.control.immutableBytes);
    expect((await env.STAGING.list()).objects).toHaveLength(3);
  });
  test("pending intent cannot be superseded; exact abandon is terminal and consumes sequence once", async () => {
    await fresh(); const first = await request([{ id: 1 }]), body = await reserveAndStore(first), before = await snapshot();
    const second = await request([{ id: 2 }]);
    await expectsFault(() => onState(state => state.reserve(second, authority())), "conflict"); expect(await snapshot()).toEqual(before);
    const terminal = await onState(state => state.abandon(first.operationId, contributionBodyHash(first), authority()));
    const after = await snapshot();
    expect(await onState(state => state.commit(first, body, authority(), journals.get(body)!))).toEqual(terminal);
    expect(await onState(state => state.abandon(first.operationId, contributionBodyHash(first), authority()))).toEqual(terminal);
    expect(await snapshot()).toEqual(after); expect(after.heads).toEqual([]);
    const next = await request([{ id: 2 }]); expect(next.sequence).toBe(first.sequence + 1); await publish(next);
  });
  test("writer transfer explicitly abandons the named old flight and preserves all committed heads", async () => {
    await fresh(); await publish(await request([{ id: 1, input: 120 }]));
    const pending = await request([{ id: 2, input: 15 }]), body = await reserveAndStore(pending);
    const before = await snapshot();
    const grant = { schemaVersion: 3 as const, operationId: hex(++operation), accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION,
      deviceId: OTHER, populationId: POPULATION, expectedRevision: before.control.revision, expectedWriterRevision: 1,
      previousDeviceId: DEVICE, abandonOperationId: pending.operationId };
    await expectsFault(() => onState(state => state.grantPopulation(grant, { ...authority({ deviceId: OTHER }), previousWriterRevoked: false })), "writer_conflict");
    await onState(state => state.grantPopulation(grant, { ...authority({ deviceId: OTHER }), previousWriterRevoked: true }));
    await expectsFault(() => onState(state => state.commit(pending, body, authority({ active: false }), journals.get(body)!)), "revoked");
    expect(await onState(state => state.head(hex(1, 32)))).not.toBeNull(); expect(await onState(state => state.head(hex(2, 32)))).toBeNull();
    expect((await onState(state => state.operation(pending.operationId)))?.outcome).toBe("abandoned");
    await publish(await request([{ id: 2, input: 15 }], POPULATION, OTHER));
    expect((await snapshot()).heads).toHaveLength(2);
  });
  test("capacity and wrong-generation refusal perform no reservation or object write", async () => {
    await fresh(); const batch = await request([{ id: 1 }]);
    await expectsFault(() => onState(state => state.reserve(batch, authority({ generation: hex(888) }))), "generation_conflict");
    await onState(state => state.sql.exec("UPDATE usage_contribution_control SET immutable_bytes=? WHERE id=1", CONTRIBUTION_MAX_IMMUTABLE_BYTES));
    const before = await snapshot(); await expectsFault(() => onState(state => state.reserve(batch, authority())), "limit"); expect(await snapshot()).toEqual(before);
    await onState(state => state.sql.exec("UPDATE usage_contribution_control SET immutable_bytes=0, metadata_bytes=? WHERE id=1", CONTRIBUTION_MAX_METADATA_BYTES));
    await expectsFault(() => onState(state => state.reserve(batch, authority())), "limit"); expect((await env.STAGING.list()).objects).toEqual([]);
  });
});

describe("sealed retained-history migration", () => {
  test("actual retained row counts refuse understated controls before any full history replay", async () => {
    const device = await enrolled(), batch = legacyBatch(device.deviceId);
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: batch.bytes })); await preparedPopulation(device);
    const replay = vi.spyOn(AdmissionState.prototype, "verifyHistory");
    const capture = () => onState(state => {
      const payload = state.sql.exec("SELECT payload FROM account_enrollment WHERE id=1").one().payload;
      if (typeof payload !== "string") throw new Error("missing synthetic authority");
      return captureContributionMigration(state.sql, JSON.parse(payload) as AdmissionAuthority);
    });
    await onState(state => state.sql.exec("UPDATE usage_admission_control SET head_count=0,live_count=0 WHERE id=1"));
    await expectsFault(capture, "storage_invalid"); expect(replay).not.toHaveBeenCalled();
    await onState((state, storage) => storage.transactionSync(() => {
      state.sql.exec("UPDATE usage_admission_control SET head_count=1,live_count=1 WHERE id=1");
      // The retained journal table itself cannot exceed 4,096 revisions, so
      // the reachable overflow is the head count: push retained heads past
      // the migration bound with synthetic rows (checked before any parse).
      for (let index = 2; index <= CONTRIBUTION_MIGRATION_MAX_HEADS + 1; index++) {
        const id = new Uint8Array(16); new DataView(id.buffer).setUint32(12, index);
        state.sql.exec("INSERT INTO usage_admission_heads VALUES (?,zeroblob(184),1,NULL)", id);
      }
    }));
    await expectsFault(capture, "limit"); expect(replay).not.toHaveBeenCalled();
  });
  test("migration metadata charge includes the extra large rejected batch retained per device", async () => {
    const device = await enrolled(), first = legacyBatch(device.deviceId);
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: first.bytes }));
    const rejected = success(encodeAdmissionBatch(Array.from({ length: 256 }, (_, index) => success(encodeAdmissionOperation({
      accountId: first.accountId, generation: first.generation, deviceId: first.deviceId, action: 2, sequence: index + 2,
      occurrenceId: admissionIdBytes(hex(index + 2, 32)), expectedHeadHash: first.operations[0].operationHash,
      frame: new Uint8Array(0) }, ADMISSION_POLICY_V1))), ADMISSION_POLICY_V1));
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: rejected })); await preparedPopulation(device);
    const retained = await onState(state => ({
      journal: state.sql.exec("SELECT SUM(length(batch)+length(journal)) AS bytes FROM usage_admission_journal").one().bytes as number,
      device: state.sql.exec("SELECT SUM(length(last_batch)+length(last_journal)) AS bytes FROM usage_admission_devices").one().bytes as number,
    }));
    expect(retained.device).toBeGreaterThan(65_536 + 1_024);
    const receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: await migrationRequest(device.deviceId) }));
    expect(receipt.headCount).toBe(1);
    const seal = await onState(state => state.control().legacySeal);
    expect(seal?.metadataBytes).toBeGreaterThanOrEqual(retained.journal + retained.device);
  });
  test("120 retained V1 plus new 15 is 135; copied support and removal cannot erase the sealed base", async () => {
    const device = await enrolled(), legacy = legacyBatch(device.deviceId);
    const oldReceipt = success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacy.bytes }));
    await preparedPopulation(device);
    const original = await onState(state => state.sql.exec("SELECT * FROM usage_admission_heads").toArray());
    const migration = await migrationRequest(device.deviceId), receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: migration }));
    expect(receipt).toMatchObject({ headCount: 1, deltaCount: 1, suppressedV1Heads: 0, unresolvedV2Bodies: 0 });
    const root = await readContributionJournalRoot(env.STAGING, account, receipt.deltaManifestHash), page = await readContributionJournalPage(env.STAGING, root, 0);
    expect(page.entries).toHaveLength(1); expect(page.entries[0].after?.kind).toBe("admission-v1");
    const base = success(await resolveContributionReference(env.STAGING, account, hex(1, 32), page.entries[0].after!));
    expect(base.tokens.input).toBe("120");
    await runInDurableObject(stub(), async (instance, context) => {
      const before = context.storage.sql.exec("SELECT * FROM account_enrollment").toArray();
      const exec = vi.spyOn(context.storage.sql, "exec"), alarm = vi.spyOn(context.storage, "setAlarm"), put = vi.spyOn(env.STAGING, "put");
      try {
        const binding = { schemaVersion: 3 as const, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION,
          deviceId: device.deviceId, populationId: POPULATION, writerRevision: 1, expectedRevision: receipt.revision };
        const recovered = success(await instance.readContributionHeads({ uploadSecret: device.proof.uploadSecret,
          request: { ...binding, mode: "heads", ids: [hex(1, 32), hex(2, 32)] } }));
        expect(recovered.revision).toBe(receipt.revision);
        expect(recovered.entries).toEqual([{ id: hex(1, 32), membershipHeadHash: null, head: { id: hex(1, 32),
          headHash: admissionHex(legacy.operations[0].operationHash), payloadHash: contributionPayloadHash(base),
          reference: page.entries[0].after, members: 0, deleted: false, legacySupport: true, suppressedLegacy: false } },
        { id: hex(2, 32), head: null, membershipHeadHash: null }]);
        // The sealed account base is exact retained evidence, not an invented
        // population membership for the device performing this migration.
        const members = success(await instance.readContributionHeads({ uploadSecret: device.proof.uploadSecret,
          request: { ...binding, mode: "members", limit: 256, cursor: null } }));
        expect(members.entries).toEqual([]); expect(members.population.memberCount).toBe(0); expect(members.next).toBeNull();
        expect(context.storage.sql.exec("SELECT * FROM account_enrollment").toArray()).toEqual(before);
        expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
        expect(alarm).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
      } finally { exec.mockRestore(); alarm.mockRestore(); put.mockRestore(); }
    });
    const copied = await request([{ id: 1, input: 120, fields: { breakdownCoverage: "partial" } }], POPULATION, device.deviceId);
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: copied }));
    expect(await onState(state => state.operation(copied.operationId)?.deltaCount)).toBe(0);
    const removal = await request([{ id: 1, kind: "remove" }], POPULATION, device.deviceId);
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: removal }));
    expect(await onState(state => state.operation(removal.operationId)?.deltaCount)).toBe(0);
    const next = await request([{ id: 2, input: 15 }], POPULATION, device.deviceId);
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: next }));
    let total = 0n;
    for (const id of [1, 2]) {
      const head = await onState(state => state.head(hex(id, 32))); expect(head).not.toBeNull();
      expect(head!.legacySupport || head!.members > 0).toBe(true);
      total += BigInt(success(await resolveContributionReference(env.STAGING, account, hex(id, 32), head!.reference!)).tokens.input);
    }
    expect(total).toBe(135n);
    expect(success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: migration }))).toEqual(receipt);
    expect(success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacy.bytes }))).toEqual(oldReceipt);
    expect(await onState(state => state.sql.exec("SELECT * FROM usage_admission_heads").toArray())).toEqual(original);
  });
  test("opaque V2 bodies remain separate and historical takeover cells do not resurrect V1", async () => {
    const device = await enrolled(), oldStats = legacyStats(device.deviceId, "codex");
    // Use the real V2 writer before V1 admission, reproducing retained overlap
    // that older versions could accept. No manufactured V3 identity is added.
    success(await stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: oldStats }));
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    await preparedPopulation(device);
    const original = await onState(state => ({ v1: state.sql.exec("SELECT * FROM usage_admission_heads").toArray(), v2: state.sql.exec("SELECT * FROM usage_stats_days").toArray() }));
    const receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: await migrationRequest(device.deviceId) }));
    expect(receipt).toMatchObject({ headCount: 1, deltaCount: 0, suppressedV1Heads: 1, unresolvedV2Bodies: 1 });
    const root = await readContributionJournalRoot(env.STAGING, account, receipt.deltaManifestHash); expect(root.pages).toEqual([]);
    expect(await onState(state => state.head(hex(1, 32))?.suppressedLegacy)).toBe(true);
    const copy = await request([{ id: 1, input: 120, fields: { breakdownCoverage: "partial" } }], POPULATION, device.deviceId);
    expect(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: copy })).toEqual({ ok: false, error: "legacy_unresolved" });
    expect(await onState(state => ({ v1: state.sql.exec("SELECT * FROM usage_admission_heads").toArray(), v2: state.sql.exec("SELECT * FROM usage_stats_days").toArray() }))).toEqual(original);
    expect(success(await stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: oldStats })).bodyHash).toBeDefined();
  });
  test("missing retained source bytes refuse activation without repairing or deleting legacy data", async () => {
    const device = await enrolled(), legacy = legacyBatch(device.deviceId);
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacy.bytes })); await preparedPopulation(device);
    const key = (await env.STAGING.list()).objects.find(object => object.key.endsWith(".aicb"))!.key;
    const retained = await env.STAGING.get(key); if (!retained) throw new Error("missing fixture");
    const bytes = new Uint8Array(await retained.arrayBuffer()); await env.STAGING.delete(key);
    const before = await onState(state => state.sql.exec("SELECT * FROM usage_admission_heads").toArray()), migration = await migrationRequest(device.deviceId);
    expect(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: migration })).toEqual({ ok: false, error: "storage_invalid" });
    expect(await onState(state => state.control().phase)).toBe("prepared");
    expect(await onState(state => state.sql.exec("SELECT * FROM usage_admission_heads").toArray())).toEqual(before); expect(await env.STAGING.get(key)).toBeNull();
    await env.STAGING.put(key, bytes, { sha256: await crypto.subtle.digest("SHA-256", bytes),
      httpMetadata: { contentType: "application/vnd.aicharts.usage-batch-v1" }, customMetadata: { schemaVersion: "1" } });
    const reserved = await onState(state => state.control().immutableBytes);
    success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: migration }));
    expect(await onState(state => state.control().immutableBytes)).toBeGreaterThan(reserved);
  });
  test("legacy source change during staged artifact write refuses cutover and permits exact explicit cancellation", async () => {
    const device = await enrolled(); success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    await preparedPopulation(device); const migration = await migrationRequest(device.deviceId);
    await runInDurableObject(stub(), async (instance, state) => {
      const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const owner = instance as unknown as { env: Env }, original = owner.env; let held = false;
      owner.env = { ...original, STAGING: proxyBucket(async invoke => { if (!held) { held = true; started.resolve(); await release.promise; } return invoke(); }) };
      const pending = (instance as unknown as MigrationRpc).migrateContributions({ uploadSecret: device.proof.uploadSecret, request: migration });
      try {
        await started.promise;
        success(await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId, 15, 2, 2).bytes }));
      } finally { release.resolve(); }
      expect(await pending).toEqual({ ok: false, error: "conflict" }); owner.env = original;
      expect(new ContributionState(state.storage).control().phase).toBe("prepared");
    });
    const charged = await onState(state => state.control().immutableBytes);
    const canceled = success(await migrationRpc().cancelContributionMigration({ uploadSecret: device.proof.uploadSecret, request: migration }));
    expect(canceled.outcome).toBe("abandoned");
    expect(success(await migrationRpc().cancelContributionMigration({ uploadSecret: device.proof.uploadSecret, request: migration }))).toEqual(canceled);
    expect(await onState(state => state.control().immutableBytes)).toBe(charged);
    const receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: await migrationRequest(device.deviceId) }));
    expect(receipt.headCount).toBe(2); expect(receipt.deltaCount).toBe(2);
  });
  test("activation replay retains exact predecessor references for moving correction reconstruction", async () => {
    const device = await enrolled(); success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    await preparedPopulation(device); success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: await migrationRequest(device.deviceId) }));
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret,
      request: await request([{ id: 1, input: 120, fields: { breakdownCoverage: "partial" } }], POPULATION, device.deviceId) }));
    const corrected = await request([{ id: 1, input: 15, fields: { utcDay: DAY - 1, model: "gpt-5" } }], POPULATION, device.deviceId);
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: corrected }));
    const operation = await onState(state => state.operation(corrected.operationId));
    const root = await readContributionJournalRoot(env.STAGING, account, operation!.deltaHash!), page = await readContributionJournalPage(env.STAGING, root, 0);
    expect(page.entries[0].before?.kind).toBe("admission-v1"); expect(page.entries[0].after?.kind).toBe("batch-v3");
    expect(success(await resolveContributionReference(env.STAGING, account, hex(1, 32), page.entries[0].before!))).toMatchObject({ utcDay: DAY, tokens: { input: "120" } });
    expect(success(await resolveContributionReference(env.STAGING, account, hex(1, 32), page.entries[0].after!))).toMatchObject({ utcDay: DAY - 1, model: "gpt-5", tokens: { input: "15" } });
  });
  test("migration does not trust corruption hidden behind an existing legacy audit checkpoint", async () => {
    const device = await enrolled();
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId, 15, 2, 2).bytes }));
    await preparedPopulation(device);
    const maintenance = { schemaVersion: 1, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" };
    success(await stub().maintainAccount(maintenance));
    expect(await onState(state => state.sql.exec("SELECT revision FROM usage_admission_audit").one().revision)).toBe(2);
    await onState(state => state.sql.exec("UPDATE usage_admission_journal SET journal=zeroblob(length(journal)) WHERE revision=1"));
    success(await stub().maintainAccount(maintenance));
    const before = await snapshot(), objects = (await env.STAGING.list()).objects;
    expect(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: await migrationRequest(device.deviceId) }))
      .toEqual({ ok: false, error: "storage_invalid" });
    expect(await snapshot()).toEqual(before); expect((await env.STAGING.list()).objects).toEqual(objects);
  });
  test("failure between migration terminal and activation updates rolls back before exact retry", async () => {
    const device = await enrolled(); success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    await preparedPopulation(device); const request = await migrationRequest(device.deviceId);
    const legacy = await onState(state => ({ heads: state.sql.exec("SELECT * FROM usage_admission_heads").toArray(),
      journals: state.sql.exec("SELECT * FROM usage_admission_journal").toArray() }));
    const original = ContributionState.prototype.commitMigration; let failedBetweenWrites = false;
    const mocked = vi.spyOn(ContributionState.prototype, "commitMigration").mockImplementation(function (this: ContributionState, bundle, proof, auth, capture) {
      const sql = new Proxy(this.sql, { get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (property === "exec" && typeof value === "function") return (query: string, ...args: SqlStorageValue[]) => {
          if (query.startsWith("UPDATE usage_contribution_control SET revision=") && query.includes("phase='active'")) {
            failedBetweenWrites = true; throw new ContributionFault("storage_invalid");
          }
          return Reflect.apply(value, target, [query, ...args]) as ReturnType<SqlStorage["exec"]>;
        };
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const isolated = new ContributionState({ sql, transactionSync: this.storage.transactionSync.bind(this.storage) });
      return original.call(isolated, bundle, proof, auth, capture);
    });
    expect(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request })).toEqual({ ok: false, error: "storage_invalid" });
    expect(failedBetweenWrites).toBe(true); mocked.mockRestore();
    await abortAllDurableObjects(); await enable();
    const staged = await snapshot(); expect(staged.control.phase).toBe("prepared"); expect(staged.control.revision).toBe(request.expectedRevision);
    expect(await onState(state => state.operation(request.operationId)?.outcome)).toBe("pending");
    expect(await onState(state => ({ heads: state.sql.exec("SELECT * FROM usage_admission_heads").toArray(),
      journals: state.sql.exec("SELECT * FROM usage_admission_journal").toArray() }))).toEqual(legacy);
    const receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request }));
    const committed = await snapshot(); expect(receipt.deltaCount).toBe(1);
    expect(committed.control.immutableBytes - staged.control.immutableBytes).toBe(committed.control.legacySeal?.immutableBytes);
    expect(success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request }))).toEqual(receipt);
    expect(await snapshot()).toEqual(committed);
  });
  test("retained V1 tombstones survive migration and cannot be revived by a fresh population", async () => {
    const device = await enrolled(), first = legacyBatch(device.deviceId);
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: first.bytes }));
    const removal = success(encodeAdmissionOperation({ accountId: first.accountId, deviceId: first.deviceId, generation: first.generation,
      action: 2, sequence: 2, occurrenceId: first.operations[0].occurrenceId, expectedHeadHash: first.operations[0].operationHash,
      frame: new Uint8Array(0) }, ADMISSION_POLICY_V1));
    const deleted = success(encodeAdmissionBatch([removal], ADMISSION_POLICY_V1));
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: deleted }));
    await preparedPopulation(device);
    const receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: await migrationRequest(device.deviceId) }));
    expect(receipt).toMatchObject({ headCount: 1, deltaCount: 0 });
    expect(await onState(state => state.head(hex(1, 32)))).toMatchObject({ deleted: true, legacySupport: true, reference: null });
    const recovered = success(await stub().readContributionHeads({ uploadSecret: device.proof.uploadSecret, request: {
      schemaVersion: 3, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: device.deviceId,
      populationId: POPULATION, writerRevision: 1, expectedRevision: receipt.revision, mode: "heads", ids: [hex(1, 32)],
    } }));
    expect(recovered.entries).toMatchObject([{ id: hex(1, 32), membershipHeadHash: null,
      head: { deleted: true, legacySupport: true, payloadHash: null, reference: null } }]);
    const revived = await request([{ id: 1, input: 120 }], POPULATION, device.deviceId);
    expect(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: revived })).toEqual({ ok: false, error: "subject_deleted" });
  });
  test("a retained migration terminal must match every original request identity field", async () => {
    const device = await enrolled(); success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    await preparedPopulation(device); const request = await migrationRequest(device.deviceId);
    const receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request }));
    for (const tamper of [{ accountId: `acct_${hex(99999, 32)}` }, { generation: hex(99999) }, { deviceId: hex(99999) },
      { expectedV1Revision: receipt.expectedV1Revision + 1 }, { expectedV2Revision: receipt.expectedV2Revision + 1 }]) {
      await onState(state => state.sql.exec("UPDATE usage_contribution_operations SET terminal=? WHERE id=?", JSON.stringify({ ...receipt, ...tamper }), request.operationId));
      await expectsFault(() => onState(state => state.operation(request.operationId)), "storage_invalid");
      expect(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request })).toEqual({ ok: false, error: "storage_invalid" });
    }
    await onState(state => state.sql.exec("UPDATE usage_contribution_operations SET terminal=? WHERE id=?", JSON.stringify(receipt), request.operationId));
    expect(success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request }))).toEqual(receipt);
  });
});

describe("actual AccountEnrollment V3 joins", () => {
  test("a populated V1 account cannot activate fresh-empty or lose its original numeric head", async () => {
    const device = await enrolled(), batch = legacyBatch(device.deviceId);
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: batch.bytes }));
    const original = await onState(state => state.sql.exec("SELECT * FROM usage_admission_heads").toArray());
    expect(await stub().activateContributions({ uploadSecret: device.proof.uploadSecret, request: activation(device.deviceId) }))
      .toEqual({ ok: false, error: "recovery_required" });
    expect(await onState(state => state.sql.exec("SELECT * FROM usage_admission_heads").toArray())).toEqual(original);
    expect((await onState(state => state.control())).phase).toBe("prepared");
  });
  test("prepared V3 populations preserve both V1 and V2 writers until verified cutover", async () => {
    const device = await enrolled();
    success(await stub().grantContributionPopulation({ uploadSecret: device.proof.uploadSecret, request: { schemaVersion: 3,
      operationId: hex(++operation), accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: device.deviceId,
      populationId: POPULATION, expectedRevision: 0, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    success(await stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: legacyStats(device.deviceId) }));
    expect(await onState(state => state.control().phase)).toBe("prepared");
    expect(await onState(state => state.sql.exec("SELECT COUNT(*) AS n FROM usage_admission_heads").one().n)).toBe(1);
    expect(await onState(state => state.sql.exec("SELECT COUNT(*) AS n FROM usage_stats_days").one().n)).toBe(1);
  });
  test("fresh cutover refuses new V1/V2 writes even if the new V3 route is disabled", async () => {
    const device = await rpcFresh();
    await runInDurableObject(stub(), instance => {
      const owner = instance as unknown as { env: Env };
      owner.env = { ...owner.env, AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "0" } as Env;
    });
    const before = await onState(state => ({ v1: state.sql.exec("SELECT * FROM usage_admission_control").toArray(),
      v2: state.sql.exec("SELECT * FROM usage_stats_control").toArray() }));
    expect(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }))
      .toEqual({ ok: false, error: "profile_superseded" });
    expect(await stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: legacyStats(device.deviceId) }))
      .toEqual({ ok: false, error: "profile_superseded" });
    expect(await onState(state => ({ v1: state.sql.exec("SELECT * FROM usage_admission_control").toArray(),
      v2: state.sql.exec("SELECT * FROM usage_stats_control").toArray() }))).toEqual(before);
  });
  test("a retained legacy immutable continuation prevents fresh activation until it settles", async () => {
    const device = await enrolled();
    await runInDurableObject(stub(), async (instance, state) => {
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const delayed = proxyBucket(async invoke => { entered.resolve(); await release.promise; return invoke(); });
      const owner = instance as unknown as { env: Env }, original = owner.env;
      owner.env = { ...owner.env, STAGING: delayed };
      const pending = instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes });
      try {
        await entered.promise;
        expect(await instance.activateContributions({ uploadSecret: device.proof.uploadSecret, request: activation(device.deviceId) }))
          .toEqual({ ok: false, error: "recovery_required" });
        expect(new ContributionState(state.storage).control().phase).toBe("prepared");
      } finally { release.resolve(); success(await pending); owner.env = original; }
    });
    expect(await onState(state => state.sql.exec("SELECT COUNT(*) AS n FROM usage_admission_heads").one().n)).toBe(1);
  });
  test("ordinary device helpers cannot perform account-wide tombstones", async () => {
    const device = await rpcFresh();
    const initial = await request([{ id: 1, input: 120 }], POPULATION, device.deviceId);
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: initial }));
    const remove = await request([{ id: 1, kind: "tombstone" }], POPULATION, device.deviceId);
    expect(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: remove })).toEqual({ ok: false, error: "unauthorized" });
    expect((await onState(state => state.head(hex(1, 32))))?.deleted).toBe(false);
    const association = await request([{ id: 1, kind: "remove" }], POPULATION, device.deviceId);
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: association }));
    expect((await onState(state => state.head(hex(1, 32))))?.members).toBe(0);
  });
  test("real nested DO transactions roll back projection, heads, outer account payload and observed control", async () => {
    const device = await rpcFresh(), batch = await request([{ id: 1, input: 120 }], POPULATION, device.deviceId), body = await reserveAndStore(batch);
    const before = await snapshot(), outerBefore = await onState(state => ({ account: state.sql.exec("SELECT * FROM account_enrollment").toArray(),
      admission: state.sql.exec("SELECT * FROM usage_admission_control").toArray() }));
    await expectsFault(() => onState((state, storage) => storage.transactionSync(() => {
      state.sql.exec("UPDATE account_enrollment SET revision=revision+1, payload='{}' WHERE id=1");
      state.sql.exec("UPDATE usage_admission_control SET observed_at_ms=observed_at_ms+1 WHERE id=1");
      state.commit(batch, body, authority({ deviceId: device.deviceId }), journals.get(body)!, () => { throw new ContributionFault("storage_invalid"); });
    })), "storage_invalid");
    await abortAllDurableObjects();
    expect(await snapshot()).toEqual(before);
    expect(await onState(state => ({ account: state.sql.exec("SELECT * FROM account_enrollment").toArray(), admission: state.sql.exec("SELECT * FROM usage_admission_control").toArray() }))).toEqual(outerBefore);
  });
  test("a projection failure through the real RPC cannot leave a canonical commit behind", async () => {
    const device = await rpcFresh(), batch = await request([{ id: 1, input: 120 }], POPULATION, device.deviceId);
    const original = ContributionState.prototype.commit;
    const restore = vi.spyOn(ContributionState.prototype, "commit").mockImplementation(function (this: ContributionState, request, body, auth, journal) {
      return original.call(this, request, body, auth, journal, () => { throw new ContributionFault("storage_invalid"); });
    });
    expect(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: batch })).toEqual({ ok: false, error: "storage_invalid" });
    restore.mockRestore();
    expect(await onState(state => state.head(hex(1, 32)))).toBeNull();
    expect((await onState(state => state.operation(batch.operationId)))?.outcome).toBe("pending");
    const reserved = (await snapshot()).control.immutableBytes;
    success(await stub().admitContributions({ uploadSecret: device.proof.uploadSecret, request: batch }));
    expect((await snapshot()).control.immutableBytes).toBe(reserved);
  });

  test("staged migration carries accounts beyond the original one-shot journal cap", async () => {
    const device = await enrolled();
    const HEADS = 9_000;
    for (let batch = 0; batch < Math.ceil(HEADS / 256); batch++) {
      const count = Math.min(256, HEADS - batch * 256);
      const operations = Array.from({ length: count }, (_, index) => {
        const sequence = batch * 256 + index + 1;
        const id = admissionIdBytes(hex(sequence, 32));
        const frame = success(encodeUsageBatch({ utcDay: DAY, registryRevision: 1, usage: [{ id, executionId: new Uint8Array(16),
          accountId: new Uint8Array(16), offsetMs: 1, provider: 1 as const, authMode: 0 as const, evidence: 1 as const, modelId: 0,
          contextTier: 0 as const, tokens: { inputUncached: BigInt(sequence), cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n,
            output: 0n, reasoningOutput: 0n } }], prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
        return success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: admissionIdBytes(device.deviceId),
          generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: 1 as const, sequence, occurrenceId: id,
          expectedHeadHash: new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
      });
      const encoded = success(encodeAdmissionBatch(operations, ADMISSION_POLICY_V1));
      success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret,
        batch: success(decodeAdmissionBatch(encoded, ADMISSION_POLICY_V1)).bytes }));
    }
    await preparedPopulation(device);
    const request = await migrationRequest(device.deviceId);
    // The proof-of-storage budget splits this scale across several exchanges;
    // the identical request replays until the terminal receipt.
    let migration: ContributionMigrationReceipt | undefined;
    for (let attempts = 0; attempts < 40 && !migration; attempts++) {
      const reply = await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request });
      if (!reply.ok) expect(reply.error).toBe("storage_unavailable"); else migration = reply.value;
    }
    if (!migration) throw new Error("staged migration did not complete in 40 exchanges");
    expect(migration.headCount).toBe(HEADS);
    expect(migration.deltaCount).toBe(HEADS);
    const root = await readContributionJournalRoot(env.STAGING, account, migration.deltaManifestHash);
    expect(root.count).toBe(HEADS);
    expect(root.pages.length).toBe(Math.ceil(HEADS / 256));
    expect(root.pages.length).toBeGreaterThan(33);
    const snapshot = await onState(state => state.control());
    expect(snapshot.phase).toBe("active"); expect(snapshot.headCount).toBe(HEADS);
    expect(await onState(state => state.sql.exec("SELECT name FROM sqlite_schema WHERE name GLOB 'migration_*'").toArray())).toEqual([]);
  }, 120_000);

  test("staged capture resumes through a durable cursor and reproduces the same seal", async () => {
    const device = await enrolled();
    for (let batch = 0; batch < 4; batch++) success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret,
      batch: legacyBatch(device.deviceId, 10 + batch, batch + 1, batch + 1).bytes }));
    success(await stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: legacyStats(device.deviceId) }));
    await preparedPopulation(device);
    const authority = await onState(state => JSON.parse(state.sql.exec("SELECT payload FROM account_enrollment WHERE id=1").one().payload as string) as AdmissionAuthority);
    const request = await migrationRequest(device.deviceId);
    const advance = () => onState((state, storage) => storage.transactionSync(() =>
      advanceContributionMigration(state.sql, authority, request)));
    let steps = 0, snapshot = await advance();
    for (let rounds = 0; snapshot === null && rounds < CONTRIBUTION_MIGRATION_STAGE_ROUNDS; rounds++) {
      steps += 1;
      if (steps === 3) { await abortAllDurableObjects(); await enable(); }
      snapshot = await advance();
    }
    if (!snapshot) throw new Error("staged capture did not reach ready");
    expect(steps).toBeGreaterThan(1);
    const rerun = await onState(state => captureContributionMigration(state.sql, authority));
    expect(JSON.stringify(rerun.seal)).toBe(JSON.stringify(snapshot.seal));
    expect(rerun.manifest.hash).toBe(snapshot.manifest.hash);
    expect(snapshot.seal.v1HeadCount).toBe(4);
    // The snapshot's lazy iterables bind the producing object's storage; the
    // bundle assembly therefore runs inside the object context.
    const journalCount = await onState(() => contributionMigrationBundle(request, snapshot).journal.root.count);
    expect(journalCount).toBe(4);
    await onState(state => clearMigrationScratch(state.sql));
  });

  test("proof-of-storage resumes at the durable ensure cursor after a spent exchange budget", async () => {
    const device = await enrolled();
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId, 15, 2, 2).bytes }));
    await preparedPopulation(device);
    const admission = await onState(state => JSON.parse(state.sql.exec("SELECT payload FROM account_enrollment WHERE id=1").one().payload as string) as AdmissionAuthority);
    const request = await migrationRequest(device.deviceId), granted = authority({ deviceId: device.deviceId });
    const { cursor, receipt } = await runInDurableObject(stub(), async (_instance, context) => {
      const state = new ContributionState(context.storage), sql = state.sql;
      const bundle = context.storage.transactionSync(() =>
        state.reserveMigration(request, captureContributionMigration(sql, admission, request), granted));
      let tick = 0;
      const spent = vi.spyOn(performance, "now").mockImplementation(() => { tick += 9_000; return tick; });
      try {
        await expect(ensureContributionMigration(env, bundle, () => true, sql, 25_000)).rejects.toMatchObject({ code: "storage_unavailable" });
      } finally { spent.mockRestore(); }
      const cursor = (JSON.parse(sql.exec("SELECT v FROM migration_meta WHERE k='meta'").one().v as string) as { ensureIndex?: number }).ensureIndex;
      const proof = await ensureContributionMigration(env, bundle, () => true, sql, 60_000);
      const out = context.storage.transactionSync(() => state.commitMigration(bundle, proof, granted, () => stagedMigrationSnapshot(sql)));
      return { cursor, receipt: out };
    });
    expect(cursor).toBeGreaterThan(0);
    expect(receipt.headCount).toBe(2);
    expect((await snapshot()).control.phase).toBe("active");
  });

  test("a fresh migration request resets orphaned staged scratch after source drift", async () => {
    const device = await enrolled();
    success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: legacyBatch(device.deviceId).bytes }));
    success(await stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: legacyStats(device.deviceId) }));
    await preparedPopulation(device);
    const admission = await onState(state => JSON.parse(state.sql.exec("SELECT payload FROM account_enrollment WHERE id=1").one().payload as string) as AdmissionAuthority);
    const stale = await migrationRequest(device.deviceId);
    await onState((state, storage) => storage.transactionSync(() => advanceContributionMigration(state.sql, admission, stale)));
    // The account's V2 revision moves under the staged capture; the pinned
    // request can never complete but its scratch would otherwise wedge.
    const drifted = legacyStats(device.deviceId, "codex");
    success(await stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: { ...drifted, operationId: hex(++operation),
      sequence: 2, expectedRevision: 1 } }));
    await expectsFault(() => onState((state, storage) => storage.transactionSync(() => advanceContributionMigration(state.sql, admission, stale))), "conflict");
    const fresh = await migrationRequest(device.deviceId);
    const receipt = success(await migrationRpc().migrateContributions({ uploadSecret: device.proof.uploadSecret, request: fresh }));
    expect(receipt.headCount).toBe(1);
    expect((await snapshot()).control.phase).toBe("active");
    expect(await onState(state => state.sql.exec("SELECT name FROM sqlite_schema WHERE name GLOB 'migration_*'").toArray())).toEqual([]);
  });
});
