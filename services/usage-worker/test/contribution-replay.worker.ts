import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { contributionBodyHash, contributionHash, CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE,
  parseContributionBatch, type ContributionAuthority, type ContributionBatch, type ContributionDelta } from "../../../lib/usage/contributions";
import { planContributionRollups, type ContributionCell } from "../../../lib/usage/contribution-rollups";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { ContributionState } from "../src/contributions-state";
import { contributionObjectKey, ensureContributionBody } from "../src/contributions-objects";
import { contributionArtifact, contributionDeltaBundle, ensureContributionArtifact, ensureContributionJournal,
  readContributionJournalRoot } from "../src/contributions-journal";
import { CONTRIBUTION_REPLAY_CHUNK_ENTRIES, isVerifiedContributionChunk, isVerifiedContributionRevision,
  loadContributionRevisionChunk, readCommittedContributionRevision, verifyContributionRevision,
  type CommittedContributionRevision } from "../src/contribution-replay";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), POPULATION = hex(4), NOW = Date.UTC(2026, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000);
let serial = 0, operation = 0, account = "";
const authority = (): ContributionAuthority => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION,
  deviceId: DEVICE, active: true, observedAtMs: NOW, allowAccountTombstone: true });
const state = <T>(run: (value: ContributionState) => T): Promise<T> => runInDurableObject(
  env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account)), (_instance, context) => run(new ContributionState(context.storage)));
const row = (id: number, corrected = false): UsageStatsRow => {
  const parsed = parseUsageStatsRow({ utcDay: DAY + (corrected ? 1 : 0), client: corrected ? "claude" : "codex", provider: null, model: null,
    tokens: { input: String(id * (corrected ? 3 : 1)), cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "5" },
    records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" });
  if (!parsed) throw new Error("invalid synthetic row"); return parsed;
};
beforeEach(async () => {
  account = `acct_${hex(++serial, 32)}`; operation = serial * 1000;
  await state(value => {
    value.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    value.activateFresh({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    value.grantPopulation({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, populationId: POPULATION, expectedRevision: 1,
      expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(item => item.key); if (keys.length) await bucket.delete(keys);
  }
  await reset();
});
async function batch(count: number, corrected = false, removeAbove = Number.MAX_SAFE_INTEGER): Promise<ContributionBatch> {
  return state(value => {
    const population = value.population(POPULATION)!;
    const parsed = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
      grain: "observation", accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE,
      operationId: hex(++operation), sequence: value.sequence(env.USAGE_ENROLLMENT_GENERATION, DEVICE) + 1,
      expectedRevision: value.control().revision, populationId: POPULATION, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null,
      mutations: Array.from({ length: count }, (_, index) => {
        const id = index + 1, expectedHeadHash = value.head(hex(id, 32))?.headHash ?? null;
        return id > removeAbove ? { kind: "remove", id: hex(id, 32), expectedHeadHash }
          : { kind: "put", id: hex(id, 32), expectedHeadHash, row: row(id, corrected) };
      }) });
    if (!parsed) throw new Error("invalid synthetic batch"); return parsed;
  });
}
async function reserve(request: ContributionBatch) {
  await state(value => value.reserve(request, authority()));
  const body = await ensureContributionBody(env.STAGING, request, () => true);
  if (!body.ok) throw new Error(body.error);
  const bundle = await state(value => value.deltaBundle(request, authority()));
  const journal = await ensureContributionJournal(env.STAGING, bundle, () => true);
  return { body: body.value, journal };
}
async function publish(request: ContributionBatch): Promise<CommittedContributionRevision> {
  const stored = await reserve(request);
  await state(value => value.commit(request, stored.body, authority(), stored.journal));
  return (await state(value => readCommittedContributionRevision(value, request.expectedRevision)))!;
}
async function sourceWithManifest(hash: string, count: number): Promise<CommittedContributionRevision> {
  return state(value => {
    const control = value.control(), [terminal] = value.journal(control.revision - 1, 1);
    // Model a SQL terminal whose syntactically valid immutable reference was
    // corrupted. Replay must independently bind and verify the full inventory.
    return readCommittedContributionRevision({ control: () => control,
      journal: () => [{ ...terminal, deltaHash: hash, deltaCount: count }] }, control.revision - 1)!;
  });
}
test("committed empty revisions advance without object reads and SQL gaps fail closed", async () => {
  const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put");
  for (const after of [0, 1]) {
    const source = (await state(value => readCommittedContributionRevision(value, after)))!;
    expect(source.revision).toBe(after + 1); expect(source.deltaManifestHash).toBeNull();
    const proof = await verifyContributionRevision(env.STAGING, source, () => true);
    expect(proof.root).toBeNull(); expect(isVerifiedContributionRevision(proof)).toBe(true);
    await expect(loadContributionRevisionChunk(env.STAGING, proof, "add", 0, () => true)).rejects.toMatchObject({ code: "invalid_input" });
  }
  expect(await state(value => readCommittedContributionRevision(value, 2))).toBeNull();
  await expect(state(value => readCommittedContributionRevision({ control: () => value.control(), journal: () => [] }, 0)))
    .rejects.toMatchObject({ code: "storage_invalid" });
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});
test("numeric replay requires the SQL terminal; copies and cancelled continuations have no I/O", async () => {
  const request = await batch(1), stored = await reserve(request);
  expect(await state(value => readCommittedContributionRevision(value, 2))).toBeNull();
  await state(value => value.commit(request, stored.body, authority(), stored.journal));
  const source = (await state(value => readCommittedContributionRevision(value, 2)))!, get = vi.spyOn(env.STAGING, "get");
  await expect(verifyContributionRevision(env.STAGING, { ...source }, () => true)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(verifyContributionRevision(env.STAGING, source, () => false)).rejects.toMatchObject({ code: "recovery_required" });
  expect(get).not.toHaveBeenCalled();
  const proof = await verifyContributionRevision(env.STAGING, source, () => true); get.mockClear();
  expect(isVerifiedContributionRevision({ ...proof })).toBe(false);
  await expect(loadContributionRevisionChunk(env.STAGING, { ...proof }, "add", 0, () => true)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(loadContributionRevisionChunk(env.STAGING, proof, "add", 1, () => true)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(loadContributionRevisionChunk(env.STAGING, proof, "add", 0, () => false)).rejects.toMatchObject({ code: "recovery_required" });
  expect(get).not.toHaveBeenCalled();
});
test("chunked correction replay retracts all old cells then adds exact new cohorts without writes", async () => {
  const initial = await publish(await batch(70)), corrected = await publish(await batch(70, true, 64));
  const cells = new Map<string, ContributionCell>(), put = vi.spyOn(env.STAGING, "put");
  for (const source of [initial, corrected]) {
    const proof = await verifyContributionRevision(env.STAGING, source, () => true);
    for (const phase of ["retract", "add"] as const) {
      for (let cursor = 0; cursor < source.deltaCount; cursor += CONTRIBUTION_REPLAY_CHUNK_ENTRIES) {
        const get = vi.spyOn(env.STAGING, "get"); get.mockClear();
        const chunk = await loadContributionRevisionChunk(env.STAGING, proof, phase, cursor, () => true);
        expect(chunk.consumed).toBe(Math.min(32, source.deltaCount - cursor));
        expect(isVerifiedContributionChunk(chunk)).toBe(true); expect(isVerifiedContributionChunk({ ...chunk })).toBe(false);
        // One exact delta page and at most one shared batch body per chunk.
        expect(get.mock.calls.length).toBeLessThanOrEqual(2);
        const patch = planContributionRollups(key => cells.get(key) ?? null, chunk.values, cells.size);
        if (!patch.ok) throw new Error(patch.error);
        for (const change of patch.value) { if (change.after) cells.set(change.key, change.after); else cells.delete(change.key); }
      }
      if (source === corrected && phase === "retract") expect(cells.size).toBe(0);
    }
    const only = [...cells.values()]; expect(only).toHaveLength(1);
    const correctedStage = source === corrected, observations = correctedStage ? 64 : 70;
    expect(only[0].observations).toBe(observations);
    expect(only[0].tokens).toEqual({ input: String(observations * (observations + 1) / 2 * (correctedStage ? 3 : 1)),
      cacheRead: String(observations * 2), cacheWrite: String(observations * 3), output: String(observations * 4), reasoning: String(observations * 5) });
    expect(only[0].dimensions.client).toBe(correctedStage ? "claude" : "codex");
    expect(only[0].dimensions.utcDay).toBe(DAY + (correctedStage ? 1 : 0));
  }
  expect(put).not.toHaveBeenCalled();
});
test("abandoned uploaded bodies remain an explicit empty canonical revision", async () => {
  const request = await batch(1); await reserve(request);
  await state(value => value.abandon(request.operationId, contributionBodyHash(request), authority()));
  const source = (await state(value => readCommittedContributionRevision(value, 2)))!;
  expect(source.deltaCount).toBe(0); expect(source.deltaManifestHash).toBeNull();
  const get = vi.spyOn(env.STAGING, "get");
  expect((await verifyContributionRevision(env.STAGING, source, () => true)).root).toBeNull();
  expect(get).not.toHaveBeenCalled();
});
test("manifest binding and complete cross-page ordering are verified before a chunk can be minted", async () => {
  const source = await publish(await batch(1)), root = await readContributionJournalRoot(env.STAGING, account, source.deltaManifestHash!);
  for (const alteration of [{ revision: root.revision + 1, previousRevision: root.revision }, { operationId: hex(999) },
    { bodyHash: hex(999) }, { generation: hex(999) }, { entriesHash: hex(999) }]) {
    const artifact = contributionArtifact({ ...root, ...alteration }); await ensureContributionArtifact(env.STAGING, account, artifact, () => true);
    await expect(verifyContributionRevision(env.STAGING, await sourceWithManifest(artifact.hash, root.count), () => true))
      .rejects.toMatchObject({ code: "storage_invalid" });
  }
  const after = { kind: "batch-v3" as const, bodyHash: source.bodyHash, index: 0, payloadHash: hex(1) };
  const entries: ContributionDelta[] = Array.from({ length: 257 }, (_, index) => ({ id: hex(index + 1, 32), before: null, after }));
  const bundle = contributionDeltaBundle(root, entries);
  await ensureContributionJournal(env.STAGING, bundle, () => true);
  expect(isVerifiedContributionRevision(await verifyContributionRevision(env.STAGING, await sourceWithManifest(bundle.artifact.hash, 257), () => true))).toBe(true);
  const overlapping = contributionArtifact({ schemaVersion: 3, kind: "contribution-delta-page", accountId: account,
    generation: root.generation, entries: [entries[255]] });
  await ensureContributionArtifact(env.STAGING, account, overlapping, () => true);
  const corrupt = contributionArtifact({ ...bundle.root,
    entriesHash: contributionHash(JSON.stringify([...entries.slice(0, 256), entries[255]])),
    pages: [bundle.root.pages[0], { hash: overlapping.hash, bytes: overlapping.bytes, count: 1 }] });
  await ensureContributionArtifact(env.STAGING, account, corrupt, () => true);
  await expect(verifyContributionRevision(env.STAGING, await sourceWithManifest(corrupt.hash, 257), () => true))
    .rejects.toMatchObject({ code: "storage_invalid" });
});
test("referenced numeric bytes are reverified per chunk after inventory verification", async () => {
  const source = await publish(await batch(1)), proof = await verifyContributionRevision(env.STAGING, source, () => true);
  await env.STAGING.delete(contributionObjectKey(account, source.bodyHash));
  await expect(loadContributionRevisionChunk(env.STAGING, proof, "add", 0, () => true)).rejects.toMatchObject({ code: "storage_invalid" });
});
