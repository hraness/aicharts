import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE, ContributionFault, parseContributionBatch,
  type ContributionAuthority, type ContributionBatch } from "../../../lib/usage/contributions";
import { readContributionIndexPage } from "../../../lib/usage/contribution-index";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { ensureNamespaceAnchor, type NamespaceAnchor } from "../src/namespace-anchor";
import { ContributionState } from "../src/contributions-state";
import { ensureContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal } from "../src/contributions-journal";
import { readContributionIndexObject, ensureContributionIndexStage } from "../src/contribution-index-objects";
import { readCommittedContributionRevision, verifyContributionRevision, loadContributionRevisionChunk } from "../src/contribution-replay";
import { ContributionProjectionState, planContributionProjectionChunk, CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES,
  CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS, CONTRIBUTION_PROJECTION_RETIRE_MS, CONTRIBUTION_PROJECTION_PUBLISH_INTERVAL_MS,
  type ContributionProjectionStatus } from "../src/contribution-projection-state";
import { AccountContributionProjection, type ContributionProjectionAdvanceResult } from "../src/contribution-projection";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "../src/account-admission";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), POPULATION = hex(4), NOW = Date.UTC(2030, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000);
let account = "", operation = 0, serial = 0, now = NOW, anchor: NamespaceAnchor;
const scope = () => ({ accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const canonical = <T>(run: (value: ContributionState) => T): Promise<T> => runInDurableObject(stub(), (_instance, context) => run(new ContributionState(context.storage)));
const projected = <T>(run: (value: ContributionProjectionState) => T): Promise<T> => runInDurableObject(stub(), (_instance, context) => run(new ContributionProjectionState(context.storage)));
const authority = (): ContributionAuthority => ({ ...scope(), deviceId: DEVICE, observedAtMs: now, active: true, allowAccountTombstone: true });
const projectionAuthority = () => ({ ...scope(), observedAtMs: now, active: true });
const owner = (): AdmissionOwner => ({ ...scope(), observedAtMs: now, phase: "active", anchor,
  devices: [{ deviceId: DEVICE, enrolledAtMs: NOW, revokedAtMs: null, reservation: { intentId: hex(8), uploadCommitment: hex(9) } }] });
function transaction(storage: DurableObjectStorage, admitted: () => boolean): AdmissionTransaction {
  return (observation, run) => {
    if (!admitted() || observation.generation !== env.USAGE_ENROLLMENT_GENERATION) return { ok: false, error: "recovery_required" };
    return storage.transactionSync(() => ({ ok: true, value: run(owner(), now) }));
  };
}
const observation = (): AdmissionObservation => ({ generation: env.USAGE_ENROLLMENT_GENERATION, observed: now, committed: false, fence: null });
const tick = (duration = CONTRIBUTION_PROJECTION_PUBLISH_INTERVAL_MS) => { now += duration; vi.setSystemTime(now); };
async function advance(overrides: Partial<Env> = {}, admitted: () => boolean = () => true): Promise<ContributionProjectionAdvanceResult> {
  return runInDurableObject(stub(), (_instance, context) => new AccountContributionProjection({ ...env, ...overrides },
    new ContributionProjectionState(context.storage), transaction(context.storage, admitted)).advance({ schemaVersion: 3, ...scope() }, observation()));
}
function success(result: ContributionProjectionAdvanceResult): ContributionProjectionStatus {
  if (!result.ok) throw new Error(`synthetic projection refusal: ${result.error}`); return result.value;
}
const row = (id: number, corrected = false): UsageStatsRow => {
  const value = parseUsageStatsRow({ utcDay: DAY + (corrected ? 1 : 0), client: corrected ? "claude" : "codex", provider: null, model: null,
    records: 1, tokens: { input: String(id * (corrected ? 3 : 1)), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" });
  if (!value) throw new Error("invalid synthetic row"); return value;
};
async function batch(count: number, corrected = false, removeAbove = Number.MAX_SAFE_INTEGER, deviceId = DEVICE): Promise<ContributionBatch> {
  return canonical(state => {
    const population = state.population(POPULATION)!;
    const value = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
      grain: "observation", ...scope(), deviceId, operationId: hex(++operation), sequence: state.sequence(env.USAGE_ENROLLMENT_GENERATION, deviceId) + 1,
      expectedRevision: state.control().revision, populationId: POPULATION, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null,
      mutations: Array.from({ length: count }, (_, index) => ({ id: hex(index + 1, 32), expectedHeadHash: state.head(hex(index + 1, 32))?.headHash ?? null,
        ...(index + 1 > removeAbove ? { kind: "remove" } : { kind: "put", row: row(index + 1, corrected) }) })) });
    if (!value) throw new Error("invalid synthetic batch"); return value;
  });
}
async function publish(request: ContributionBatch) {
  await canonical(state => state.reserve(request, authority()));
  const body = await ensureContributionBody(env.STAGING, request, () => true); if (!body.ok) throw new Error(body.error);
  const bundle = await canonical(state => state.deltaBundle(request, authority())), proof = await ensureContributionJournal(env.STAGING, bundle, () => true);
  await canonical(state => state.commit(request, body.value, authority(), proof));
}
async function grantEmpty(): Promise<void> {
  await canonical(state => state.grantPopulation({ schemaVersion: 3, ...scope(), deviceId: DEVICE,
    populationId: hex(++operation), operationId: hex(++operation), expectedRevision: state.control().revision,
    expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false }));
}
async function converge(): Promise<ContributionProjectionStatus> {
  for (let step = 0; step < 600; step++) {
    const result = success(await advance()); if (!result.lag) return result;
    if (result.appliedLag === 0 && result.nextPublicationAtMs !== null && result.nextPublicationAtMs > now) tick(result.nextPublicationAtMs - now);
  }
  throw new Error("bounded synthetic convergence exceeded");
}
async function applyAll(): Promise<ContributionProjectionStatus> {
  for (let step = 0; step < 600; step++) { const result = success(await advance()); if (!result.appliedLag) return result; }
  throw new Error("bounded synthetic application exceeded");
}
async function prepareNumeric(): Promise<void> {
  await publish(await batch(1)); await advance(); await advance(); tick(); await advance(); tick();
}
async function snapshot() {
  return projected(state => ({ control: state.sql.exec("SELECT * FROM usage_contribution_projection_control").toArray(),
    pending: state.sql.exec("SELECT * FROM usage_contribution_projection_pending").toArray(),
    publications: state.sql.exec("SELECT * FROM usage_contribution_projection_publications ORDER BY revision").toArray() }));
}
async function cells(revision: number) {
  const publication = await projected(state => state.publication(revision, now));
  const result = await readContributionIndexPage(scope(), publication.root, { firstUtcDay: DAY, dayCount: 2, limit: 256, cursor: null },
    reference => readContributionIndexObject(env.STAGING, scope(), reference));
  if (!result.ok) throw new Error(result.error); return result.value.cells;
}
function bucket(intercept: (invoke: () => Promise<unknown>) => Promise<unknown>): R2Bucket {
  return new Proxy(env.STAGING, { get(target, property) {
    const value: unknown = Reflect.get(target, property, target);
    if (property === "put" && typeof value === "function") return (...args: unknown[]) => intercept(() => Reflect.apply(value, target, args) as Promise<unknown>);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
beforeEach(async () => {
  account = `acct_${hex(++serial, 32)}`; operation = serial * 1000; now = NOW;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  anchor = { ...scope(), namespaceKey: hex(7), intentId: hex(8), reservationId: hex(9), createdAtMs: NOW };
  const retained: Promise<unknown>[] = [];
  await ensureNamespaceAnchor(env.CONTROL, anchor, () => true, promise => { retained.push(promise); }); await Promise.all(retained);
  await canonical(state => {
    state.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    state.activateFresh({ schemaVersion: 3, ...scope(), deviceId: DEVICE, operationId: hex(++operation), expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    state.grantPopulation({ schemaVersion: 3, ...scope(), deviceId: DEVICE, populationId: POPULATION, operationId: hex(++operation), expectedRevision: 1,
      expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
  });
  await projected(state => state.initialize(account, env.USAGE_ENROLLMENT_GENERATION));
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const store of [env.CONTROL, env.STAGING]) {
    const keys = (await store.list()).objects.map(object => object.key); if (keys.length) await store.delete(keys);
  }
  await reset();
});

test("projection constructors and authorized publication reads perform no persistent writes", async () => {
  const before = await snapshot();
  await projected(state => { new ContributionProjectionState(state.storage); expect(state.status(now)).toMatchObject({ sourceRevision: 2, publishedRevision: 0, lag: 2 });
    expect(state.publication(0, now)).toMatchObject({ revision: 0, root: null, expiresAtMs: null }); });
  await expect(projected(state => state.publication(1, now))).rejects.toMatchObject({ code: "invalid_input" });
  expect(await snapshot()).toEqual(before);
  const id = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(`acct_${hex(900000 + serial, 32)}`));
  await runInDurableObject(id, (_instance, context) => {
    const before = context.storage.sql.exec("SELECT name,sql FROM sqlite_schema").toArray();
    const state = new ContributionProjectionState(context.storage); expect(() => state.control()).toThrow();
    expect(context.storage.sql.exec("SELECT name,sql FROM sqlite_schema").toArray()).toEqual(before);
  });
});
test("empty revisions apply without numeric I/O and caught-up bursts obey the publication interval", async () => {
  const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put");
  expect(success(await advance())).toMatchObject({ sourceRevision: 2, appliedRevision: 1, publishedRevision: 0, appliedLag: 1,
    publishedLag: 2, staged: null, publicationWait: "interval", nextPublicationAtMs: NOW + CONTRIBUTION_PROJECTION_PUBLISH_INTERVAL_MS });
  expect(success(await advance())).toMatchObject({ sourceRevision: 2, appliedRevision: 2, publishedRevision: 0, appliedLag: 0, lag: 2, staged: null });
  await expect(projected(state => state.publish(projectionAuthority()))).rejects.toMatchObject({ code: "conflict" });
  const waiting = await snapshot(); tick(CONTRIBUTION_PROJECTION_PUBLISH_INTERVAL_MS - 1);
  expect(success(await advance()).publishedRevision).toBe(0); expect(await snapshot()).toEqual(waiting);
  tick(1); expect(success(await advance())).toMatchObject({ appliedRevision: 2, publishedRevision: 2, lag: 0, nextPublicationAtMs: null });
  const before = await snapshot(); expect(success(await advance()).lag).toBe(0); expect(await snapshot()).toEqual(before);
  await grantEmpty();
  expect(success(await advance())).toMatchObject({ appliedRevision: 3, publishedRevision: 2, appliedLag: 0, publishedLag: 1, publicationWait: "interval" });
  tick(CONTRIBUTION_PROJECTION_PUBLISH_INTERVAL_MS - 1); expect(success(await advance()).publishedRevision).toBe(2);
  tick(1); expect(success(await advance())).toMatchObject({ appliedRevision: 3, publishedRevision: 3, lag: 0 });
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});
test("chunked moving corrections keep the old snapshot visible until the whole revision publishes", async () => {
  await publish(await batch(70)); const first = await converge(); expect(first.publishedRevision).toBe(3);
  const prior = await cells(3); expect(prior).toHaveLength(1); expect(prior[0]).toMatchObject({ observations: 70, tokens: { input: "2485" } });
  await publish(await batch(70, true, 64));
  const expectedPhases = [["retract", 32], ["retract", 64], ["add", 0], ["add", 32], ["add", 64]];
  for (const [phase, cursor] of expectedPhases) {
    const result = success(await advance()); expect(result).toMatchObject({ sourceRevision: 4, publishedRevision: 3, lag: 1, staged: { revision: 4, phase, cursor } });
    expect(await cells(3)).toEqual(prior);
  }
  expect(success(await advance())).toMatchObject({ appliedRevision: 4, publishedRevision: 3, appliedLag: 0, lag: 1, staged: null, publicationWait: "interval" });
  expect(await cells(3)).toEqual(prior); tick();
  expect(success(await advance())).toMatchObject({ appliedRevision: 4, publishedRevision: 4, lag: 0, staged: null });
  const current = await cells(4); expect(current).toHaveLength(1);
  expect(current[0]).toMatchObject({ observations: 64, dimensions: { client: "claude", utcDay: DAY + 1 }, tokens: { input: "6240" } });
  expect(await cells(3)).toEqual(prior);
});
test("lost immutable write acknowledgement resumes the exact charged pending chunk after restart", async () => {
  await prepareNumeric();
  const prior = await projected(state => state.control()); expect(prior.phase).toBe("add");
  const failed = await advance({ STAGING: bucket(async invoke => { await invoke(); throw new Error("synthetic lost put reply"); }) });
  expect(failed).toMatchObject({ ok: false, error: "storage_unavailable", status: { pending: true, publishedRevision: 2, lag: 1, refusal: "storage_unavailable" } });
  const pending = await projected(state => state.pending()), reserved = await projected(state => state.control().immutableBytes);
  expect(pending).not.toBeNull(); expect(reserved).toBeGreaterThan(prior.immutableBytes);
  await abortAllDurableObjects();
  expect(success(await advance())).toMatchObject({ publishedRevision: 3, lag: 0, pending: false });
  expect(await projected(state => state.control().immutableBytes)).toBe(reserved);
  expect(await cells(3)).toHaveLength(1);
});
test("only owned numeric plans and exact verified object plans can commit a reserved step", async () => {
  await prepareNumeric();
  const control = await projected(state => state.control()), source = (await canonical(state => readCommittedContributionRevision(state, 2)))!;
  const proof = await verifyContributionRevision(env.STAGING, source, () => true), chunk = await loadContributionRevisionChunk(env.STAGING, proof, "add", 0, () => true);
  const load = (ref: Parameters<typeof readContributionIndexObject>[2]) => readContributionIndexObject(env.STAGING, scope(), ref);
  await expect(planContributionProjectionChunk({ ...control }, chunk, load)).rejects.toMatchObject({ code: "invalid_input" });
  const plan = await planContributionProjectionChunk(control, chunk, load), before = await snapshot();
  await expect(projected(state => state.reserve({ ...plan }, projectionAuthority()))).rejects.toMatchObject({ code: "invalid_input" });
  expect(await snapshot()).toEqual(before);
  await projected(state => state.reserve(plan, projectionAuthority())); const reserved = await snapshot();
  await projected(state => state.reserve(plan, projectionAuthority())); expect(await snapshot()).toEqual(reserved);
  const stored = await ensureContributionIndexStage(env.STAGING, scope(), plan.stage, () => true);
  await expect(projected(state => state.commit(plan, { ...stored }, projectionAuthority()))).rejects.toMatchObject({ code: "invalid_input" });
  expect(await snapshot()).toEqual(reserved);
  await projected(state => state.commit(plan, stored, projectionAuthority())); await projected(state => state.apply(projectionAuthority()));
  await projected(state => state.publish(projectionAuthority()));
  expect(await cells(3)).toHaveLength(1);
});
test("capacity exhaustion refuses before index writes while retaining the last published revision", async () => {
  await prepareNumeric();
  await projected(state => state.sql.exec("UPDATE usage_contribution_projection_control SET immutable_bytes=?", CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES));
  const before = await snapshot(), put = vi.spyOn(env.STAGING, "put");
  expect(await advance()).toMatchObject({ ok: false, error: "limit", status: { sourceRevision: 3, publishedRevision: 2, lag: 1, pending: false, refusal: "limit" } });
  expect(await snapshot()).toEqual(before); expect(put).not.toHaveBeenCalled(); expect(await cells(2)).toEqual([]);
});
test("a failure after stage movement rolls back the pending intent and resumes without recharging", async () => {
  await prepareNumeric();
  const original = ContributionProjectionState.prototype.commit; let reachedDelete = false;
  const mocked = vi.spyOn(ContributionProjectionState.prototype, "commit").mockImplementation(function (this: ContributionProjectionState, plan, proof, auth) {
    const sql = new Proxy(this.sql, { get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === "exec" && typeof value === "function") return (query: string, ...args: SqlStorageValue[]) => {
        if (query === "DELETE FROM usage_contribution_projection_pending WHERE id=1") { reachedDelete = true; throw new ContributionFault("storage_invalid"); }
        return Reflect.apply(value, target, [query, ...args]) as ReturnType<SqlStorage["exec"]>;
      };
      return typeof value === "function" ? value.bind(target) : value;
    } });
    original.call(new ContributionProjectionState({ sql, transactionSync: this.storage.transactionSync.bind(this.storage) }), plan, proof, auth);
  });
  expect(await advance()).toMatchObject({ ok: false, error: "storage_invalid", status: { publishedRevision: 2, pending: true, staged: { phase: "add", cursor: 0 } } });
  expect(reachedDelete).toBe(true); mocked.mockRestore();
  const reserved = await projected(state => state.control().immutableBytes);
  await abortAllDurableObjects();
  expect(success(await advance())).toMatchObject({ publishedRevision: 3, pending: false, lag: 0 });
  expect(await projected(state => state.control().immutableBytes)).toBe(reserved);
});
test("an old awaited continuation cannot publish after its admitted authority closes", async () => {
  await prepareNumeric();
  await runInDurableObject(stub(), async (_instance, context) => {
    let admitted = true;
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const delayed = bucket(async invoke => { started.resolve(); await release.promise; return invoke(); });
    const helper = new AccountContributionProjection({ ...env, STAGING: delayed }, new ContributionProjectionState(context.storage), transaction(context.storage, () => admitted));
    const pending = helper.advance({ schemaVersion: 3, ...scope() }, observation());
    await started.promise; admitted = false; release.resolve();
    expect(await pending).toMatchObject({ ok: false, error: "recovery_required", status: null });
    const state = new ContributionProjectionState(context.storage);
    expect(state.control().publishedRevision).toBe(2); expect(state.pending()).not.toBeNull();
  });
  expect(success(await advance()).publishedRevision).toBe(3);
});
test("64 retained references delay publication without blocking application or mutating expired reads", async () => {
  tick(86_400_000);
  while ((await canonical(state => state.control().revision)) < CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS) await grantEmpty();
  await applyAll(); tick(); success(await advance());
  const first = await projected(state => state.publication(0, now));
  expect(first.expiresAtMs).toBe(NOW + 86_400_000 + CONTRIBUTION_PROJECTION_RETIRE_MS);
  // Retained empty roots model a preexisting full reference inventory. The
  // new interval policy cannot create this dense history itself.
  await projected(state => {
    for (let revision = 2; revision < CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS - 1; revision++)
      state.sql.exec("INSERT INTO usage_contribution_projection_publications VALUES (?,NULL,?,?)", revision, now, now + CONTRIBUTION_PROJECTION_RETIRE_MS);
  });
  await grantEmpty();
  expect(success(await advance())).toMatchObject({ appliedRevision: 65, publishedRevision: 64, sourceRevision: 65,
    appliedLag: 0, lag: 1, staged: null, publicationWait: "retention", nextPublicationAtMs: first.expiresAtMs });
  await expect(projected(state => state.publish(projectionAuthority()))).rejects.toMatchObject({ code: "limit" });
  await grantEmpty();
  expect(success(await advance())).toMatchObject({ appliedRevision: 66, publishedRevision: 64, appliedLag: 0, publishedLag: 2 });
  const retained = await snapshot(); expect(retained.publications).toHaveLength(64);
  expect(await projected(state => state.publication(0, first.expiresAtMs! - 1))).toEqual(first);
  await expect(projected(state => state.publication(0, first.expiresAtMs!))).rejects.toMatchObject({ code: "conflict" });
  expect(await snapshot()).toEqual(retained);
  tick(first.expiresAtMs! - now);
  expect(success(await advance())).toMatchObject({ appliedRevision: 66, publishedRevision: 66, lag: 0, staged: null });
  expect((await snapshot()).publications).toHaveLength(64);
  expect(await projected(state => state.publication(64, now))).toMatchObject({ expiresAtMs: now + CONTRIBUTION_PROJECTION_RETIRE_MS });
});
test("more than 64 numeric revisions apply in one cursor horizon and coalesce to an independent fold", async () => {
  await publish(await batch(4)); await converge();
  const prior = await cells(3), expected = new Map<string, UsageStatsRow>(Array.from({ length: 4 }, (_, index) => [hex(index + 1, 32), row(index + 1)]));
  const started = now;
  for (let revision = 0; revision < 70; revision++) {
    // Once a population removes an occurrence, it cannot overwrite that
    // occurrence's head until it has rejoined the exact retained value. Keep
    // the removed member absent while the remaining owned members move.
    const original = await batch(revision > 35 ? 3 : 4, false, revision === 35 ? 3 : 4);
    const request = parseContributionBatch({ ...original, mutations: original.mutations.map((mutation, index) => mutation.kind !== "put" ? mutation
      : { ...mutation, row: { ...mutation.row, utcDay: DAY + (index + revision) % 2, client: (index + revision) % 2 ? "claude" : "codex",
        tokens: { ...mutation.row.tokens, input: String(1000 + revision * 13 + index) } } }) });
    if (!request) throw new Error("invalid synthetic generated correction");
    await publish(request);
    for (const mutation of request.mutations) {
      if (mutation.kind === "put") expected.set(mutation.id, mutation.row);
      else if (mutation.kind === "remove") expected.delete(mutation.id);
      else throw new Error("unexpected synthetic mutation");
    }
    const status = await applyAll();
    expect(status).toMatchObject({ appliedRevision: 4 + revision, publishedRevision: 3, appliedLag: 0, publishedLag: revision + 1 });
  }
  expect(now).toBe(started); expect((await snapshot()).publications).toHaveLength(2);
  expect(await cells(3)).toEqual(prior);
  const applied = await projected(state => state.control()); expect(applied.appliedRoot).not.toBeNull();
  await expect(projected(state => state.publication(applied.appliedRevision, now))).rejects.toMatchObject({ code: "invalid_input" });
  tick(); expect(success(await advance())).toMatchObject({ sourceRevision: 73, appliedRevision: 73, publishedRevision: 73, lag: 0 });
  const folded = new Map<string, { observations: number; tokens: bigint }>();
  for (const value of expected.values()) {
    const key = `${value.utcDay}/${value.client}`, cell = folded.get(key) ?? { observations: 0, tokens: 0n };
    cell.observations++; cell.tokens += BigInt(value.tokens.input); folded.set(key, cell);
  }
  const actual = new Map((await cells(73)).map(value => [`${value.dimensions.utcDay}/${value.dimensions.client}`,
    { observations: value.observations, tokens: BigInt(value.tokens.input) }]));
  expect(actual).toEqual(folded); expect(await cells(3)).toEqual(prior); expect((await snapshot()).publications).toHaveLength(3);
  // An intermediate applied root is not a query grant, even after a later
  // publication makes its revision syntactically eligible for lookup.
  await expect(projected(state => state.publication(4, now))).rejects.toMatchObject({ code: "conflict" });
});
test("a crash after applying a revision resumes publication without replay or another charge", async () => {
  await prepareNumeric();
  const mocked = vi.spyOn(ContributionProjectionState.prototype, "publish").mockImplementation(() => { throw new Error("synthetic crash before publication"); });
  expect(await advance()).toMatchObject({ ok: false, error: "storage_unavailable", status: { appliedRevision: 3, publishedRevision: 2,
    appliedLag: 0, publishedLag: 1, staged: null, pending: false } });
  const reserved = await projected(state => state.control().immutableBytes); mocked.mockRestore();
  await abortAllDurableObjects();
  const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put");
  expect(success(await advance())).toMatchObject({ appliedRevision: 3, publishedRevision: 3, lag: 0 });
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  expect(await projected(state => state.control().immutableBytes)).toBe(reserved);
});
test("publishing a complete applied root during a held next-revision put preserves its exact intent", async () => {
  await publish(await batch(1)); await converge();
  const first = await cells(3);
  await publish(await batch(1, true)); expect(await applyAll()).toMatchObject({ appliedRevision: 4, publishedRevision: 3 });
  await publish(await batch(1)); expect(success(await advance()).staged).toMatchObject({ revision: 5, phase: "add", cursor: 0 });
  await runInDurableObject(stub(), async (_instance, context) => {
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const helper = new AccountContributionProjection({ ...env, STAGING: bucket(async invoke => {
      started.resolve(); await release.promise; return invoke();
    }) }, new ContributionProjectionState(context.storage), transaction(context.storage, () => true));
    const work = helper.advance({ schemaVersion: 3, ...scope() }, observation());
    await started.promise;
    const state = new ContributionProjectionState(context.storage), pending = state.pending(), reserved = state.control().immutableBytes;
    expect(pending).not.toBeNull(); tick();
    expect(state.publish(projectionAuthority()).revision).toBe(4);
    expect(state.pending()).toEqual(pending); expect(state.control().immutableBytes).toBe(reserved);
    release.resolve();
    expect(success(await work)).toMatchObject({ appliedRevision: 5, publishedRevision: 4, pending: false, publicationWait: "interval" });
    expect(state.control().immutableBytes).toBe(reserved);
  });
  expect(await cells(3)).toEqual(first);
  expect((await cells(4))[0]).toMatchObject({ dimensions: { client: "claude", utcDay: DAY + 1 }, tokens: { input: "3" } });
  tick(); expect(success(await advance()).publishedRevision).toBe(5);
  expect(await cells(5)).toEqual(first);
});
test.each(["arm-failed", "authority-closed"] as const)("final progress arming after immutable I/O refuses safely: %s", async mode => {
  await prepareNumeric();
  await runInDurableObject(stub(), async (_instance, context) => {
    let admitted = true, putSettled = false, armedAfterPut = false;
    const state = new ContributionProjectionState(context.storage);
    const helper = new AccountContributionProjection({ ...env, STAGING: bucket(async invoke => {
      const result = await invoke(); putSettled = true; return result;
    }) }, state, transaction(context.storage, () => admitted), async () => {
      if (!putSettled) return;
      armedAfterPut = true; await Promise.resolve();
      if (mode === "arm-failed") throw new Error("synthetic durable alarm refusal");
      admitted = false;
    });
    const result = await helper.advance({ schemaVersion: 3, ...scope() }, observation());
    expect(result).toMatchObject({ ok: false, error: mode === "arm-failed" ? "storage_unavailable" : "recovery_required" });
    expect(armedAfterPut).toBe(true); expect(state.control()).toMatchObject({ appliedRevision: 2, publishedRevision: 2, cursor: 0, phase: "add" });
    expect(state.pending()).not.toBeNull();
  });
  const charge = await projected(state => state.control().immutableBytes);
  expect(success(await advance())).toMatchObject({ appliedRevision: 3, publishedRevision: 3, pending: false });
  expect(await projected(state => state.control().immutableBytes)).toBe(charge);
});
test("real enrolled RPC advances under its retained fence and publishes a pure private query", async () => {
  // This account uses the production enrollment/schema/lease path; the other
  // fixtures isolate the controller and its injected owner transaction.
  account = `acct_${hex(500000 + serial, 32)}`;
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
    if (!result.ok) throw new Error(`synthetic RPC refusal: ${result.error}`); return result.value;
  };
  await runInDurableObject(stub(), instance => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
  });
  const proof = { intentId: hex(++operation), pollSecret: hex(++operation), uploadSecret: hex(++operation) }, browserNonce = hex(++operation);
  const pairing = env.PAIRINGS.getByName(proof.intentId), commitment = unwrap(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  unwrap(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment: commitment }));
  const attempt = unwrap(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce, contextToken: attempt.contextToken };
  unwrap(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: now, sessionExpiresAtMs: now + PAIRING_TTL_MS }));
  unwrap(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: now + PAIRING_TTL_MS, decision: "approve" }));
  unwrap(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account })); unwrap(await pairing.reserveEnrollment(proof));
  const deviceId = unwrap(await stub().enroll(proof)).receipt.deviceId;
  const query = { schemaVersion: 3, accountId: account, sessionExpiresAtMs: now + PAIRING_TTL_MS, firstUtcDay: DAY, dayCount: 2, limit: 256, cursor: null };
  expect(await stub().readContributionPage(query)).toEqual({ ok: false, error: "not_started" });
  unwrap(await stub().activateContributions({ uploadSecret: proof.uploadSecret, request: { schemaVersion: 3, ...scope(), deviceId,
    operationId: hex(++operation), expectedRevision: 0, mode: "fresh-empty" } }));
  unwrap(await stub().grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: { schemaVersion: 3, ...scope(), deviceId,
    operationId: hex(++operation), populationId: POPULATION, expectedRevision: 1, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
  unwrap(await stub().admitContributions({ uploadSecret: proof.uploadSecret, request: await batch(1, false, Number.MAX_SAFE_INTEGER, deviceId) }));
  for (let step = 0; step < 4; step++) {
    tick();
    const advanced = await stub().advanceContributionProjection({ schemaVersion: 3, ...scope() });
    if (!advanced.ok) throw new Error(`synthetic real projection step ${step}: ${JSON.stringify(advanced)}; ${JSON.stringify(await snapshot())}`);
  }
  expect(await projected(state => state.status(now))).toMatchObject({ sourceRevision: 3, publishedRevision: 3, lag: 0 });
  const before = await snapshot(), page = unwrap(await stub().readContributionPage(query));
  expect(page).toMatchObject({ sourceRevision: 3, latestAppliedRevision: 3, latestPublishedRevision: 3, appliedLag: 0,
    publishedLag: 0, snapshotRevision: 3, snapshotLag: 0, unresolvedLegacyBodies: 0 });
  expect(page.cells).toHaveLength(1); expect(page.cells[0]).toMatchObject({ observations: 1, tokens: { input: "1" } });
  expect(await snapshot()).toEqual(before);
  expect(await projected(state => state.sql.exec("SELECT schema_version FROM account_enrollment WHERE id=1").one().schema_version)).toBe(11);
});
