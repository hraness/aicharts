import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_MAX_MEMBERS, CONTRIBUTION_PROFILE, contributionPayloadHash, parseContributionBatch,
  type ContributionAuthority, type ContributionMutation, type ContributionResult } from "../../../lib/usage/contributions";
import { CONTRIBUTION_HEAD_QUERY_MAX_IDS, parseContributionHeadPage, type ContributionHeadQuery } from "../../../lib/usage/contribution-head-query";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { ContributionState } from "../src/contributions-state";
import { queryContributionHeads } from "../src/contribution-head-query";
import { ensureContributionBody } from "../src/contributions-objects";
import { ensureContributionJournal } from "../src/contributions-journal";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const DEVICE = hex(3), OTHER = hex(4), POPULATION = hex(5), COPY = hex(6), NOW = 1_000_000;
let serial = 0, operation = 100, account = "";
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(`head-query-synthetic-${serial}`);
const run = <T>(action: (state: ContributionState, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> =>
  runInDurableObject(stub(), (_instance, ctx) => action(new ContributionState(ctx.storage), ctx.storage));
const authority = (fields: Partial<ContributionAuthority> = {}): ContributionAuthority => ({ accountId: account,
  generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, active: true, observedAtMs: NOW, allowAccountTombstone: false, ...fields });
const common = () => ({ schemaVersion: 3 as const, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION,
  deviceId: DEVICE, populationId: POPULATION, writerRevision: 1, expectedRevision: null });
const named = (ids = [1, 2]): ContributionHeadQuery => ({ ...common(), mode: "heads", ids: ids.map(id => hex(id, 32)) });
const members = (limit = 256): ContributionHeadQuery => ({ ...common(), mode: "members", limit, cursor: null });
const success = <T>(result: ContributionResult<T>): T => { if (!result.ok) throw new Error(`synthetic read failed: ${result.error}`); return result.value; };
const row = (input: number): UsageStatsRow => {
  const parsed = parseUsageStatsRow({ utcDay: 20_000, client: "codex", provider: null, model: null,
    tokens: { input: String(input), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, records: 1,
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" });
  if (!parsed) throw new Error("invalid synthetic row"); return parsed;
};
beforeEach(() => { account = `acct_${hex(++serial, 32)}`; operation = 1000 * serial; });
afterEach(async () => {
  vi.restoreAllMocks(); const keys = (await env.STAGING.list()).objects.map(object => object.key);
  if (keys.length) await env.STAGING.delete(keys);
  await abortAllDurableObjects(); await reset();
});
async function fresh(activate = true) {
  await run(state => {
    state.initialize(account, env.USAGE_ENROLLMENT_GENERATION);
    if (activate) state.activateFresh({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, expectedRevision: 0, mode: "fresh-empty" }, authority(), () => true);
    for (const populationId of [POPULATION, COPY]) state.grantPopulation({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, populationId, expectedRevision: state.control().revision,
      expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false });
  });
}
async function publish(items: readonly { id: number; input?: number; kind?: "remove" | "tombstone" }[], populationId = POPULATION) {
  const batch = await run(state => {
    const population = state.population(populationId)!;
    const mutations: ContributionMutation[] = items.map(item => {
      const id = hex(item.id, 32), expectedHeadHash = state.head(id)?.headHash ?? null;
      return item.kind ? { kind: item.kind, id, expectedHeadHash: expectedHeadHash! } : { kind: "put", id, expectedHeadHash, row: row(item.input ?? 1) };
    });
    const parsed = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
      grain: "observation", accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE,
      operationId: hex(++operation), sequence: state.sequence(env.USAGE_ENROLLMENT_GENERATION, DEVICE) + 1,
      expectedRevision: state.control().revision, populationId, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null, mutations });
    if (!parsed) throw new Error("invalid synthetic contribution batch"); return parsed;
  });
  const auth = authority({ allowAccountTombstone: true });
  const bundle = await run(state => { const delta = state.deltaBundle(batch, auth); state.reserve(batch, auth); return delta; });
  const body = success(await ensureContributionBody(env.STAGING, batch, () => true));
  const journal = await ensureContributionJournal(env.STAGING, bundle, () => true);
  await run(state => state.commit(batch, body, auth, journal)); return batch;
}
test("missing and empty stores never initialize, write, arm alarms or read object bodies", async () => {
  await run((state, storage) => {
    const exec = vi.spyOn(storage.sql, "exec"), alarm = vi.spyOn(storage, "setAlarm");
    expect(queryContributionHeads(state, named(), authority())).toEqual({ ok: false, error: "storage_unavailable" });
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true); expect(alarm).not.toHaveBeenCalled();
    exec.mockRestore(); alarm.mockRestore();
  });
  await fresh();
  await run((state, storage) => {
    const exec = vi.spyOn(storage.sql, "exec"), transaction = vi.spyOn(storage, "transactionSync"), alarm = vi.spyOn(storage, "setAlarm");
    const get = vi.spyOn(env.STAGING, "get"), put = vi.spyOn(env.STAGING, "put");
    const empty = success(queryContributionHeads(state, members(), authority())); expect(empty.entries).toEqual([]); expect(empty.next).toBeNull();
    const value = success(queryContributionHeads(state, named(), authority()));
    expect(value.entries).toEqual([1, 2].map(id => ({ id: hex(id, 32), head: null, membershipHeadHash: null })));
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    for (const spy of [transaction, alarm, get, put]) expect(spy).not.toHaveBeenCalled();
  });
});
test("committed shared corrections preserve stale membership and account tombstones independently", async () => {
  await fresh(); const original = await publish([{ id: 1, input: 7 }]);
  const oldHead = await run(state => state.head(hex(1, 32))!.headHash);
  await publish([{ id: 1, input: 7 }], COPY); const corrected = await publish([{ id: 1, input: 9 }], COPY);
  await run((state, storage) => {
    const exec = vi.spyOn(storage.sql, "exec");
    const first = success(queryContributionHeads(state, named(), authority()));
    expect(first.entries[0].membershipHeadHash).toBe(oldHead); expect(first.entries[0].head!.headHash).not.toBe(oldHead);
    expect(first.entries[0].head!.payloadHash).toBe(contributionPayloadHash(row(9))); expect(first.entries[0].head!.members).toBe(2);
    expect(first.entries[0].head!.reference).toMatchObject({ kind: "batch-v3", index: 0 });
    const copy = success(queryContributionHeads(state, { ...named([1]), populationId: COPY }, authority()));
    expect(copy.entries[0].membershipHeadHash).toBe(copy.entries[0].head!.headHash);
    expect(first.revision).toBe(corrected.expectedRevision + 1); expect(first.revision).toBeGreaterThan(original.expectedRevision);
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
  });
  await publish([{ id: 1, kind: "tombstone" }], COPY);
  await run(state => {
    const value = success(queryContributionHeads(state, named(), authority()));
    expect(value.entries[0].head).toMatchObject({ deleted: true, payloadHash: null, reference: null, members: 2 });
    expect(value.entries[0].membershipHeadHash).toBe(oldHead); expect(value.entries[1].head).toBeNull();
  });
});
/** Seed metadata only to test the maximum indexed read; body admission and
 * source-object verification are exercised by the committed fixture above. */
async function maximumPopulation() {
  await fresh();
  await run((state, storage) => storage.transactionSync(() => {
    for (let index = 1; index <= CONTRIBUTION_MAX_MEMBERS + 1; index++) {
      const id = hex(index, 32), populationId = index <= CONTRIBUTION_MAX_MEMBERS ? POPULATION : COPY;
      const reference = JSON.stringify({ kind: "batch-v3", bodyHash: hex(800), index: index % 256, payloadHash: hex(801) });
      state.sql.exec("INSERT INTO usage_contribution_heads VALUES (?, ?, ?, ?, 1, 0, 0, 0)", id, hex(802), hex(801), reference);
      state.sql.exec("INSERT INTO usage_contribution_memberships VALUES (?, ?, ?)", populationId, id, hex(802));
    }
    state.sql.exec("UPDATE usage_contribution_populations SET revision=1,head_hash=?,member_count=? WHERE id=?", hex(803), CONTRIBUTION_MAX_MEMBERS, POPULATION);
    state.sql.exec("UPDATE usage_contribution_populations SET revision=1,head_hash=?,member_count=1 WHERE id=?", hex(804), COPY);
    state.sql.exec("UPDATE usage_contribution_control SET head_count=?,membership_count=? WHERE id=1", CONTRIBUTION_MAX_MEMBERS + 1, CONTRIBUTION_MAX_MEMBERS + 1);
  }));
}
test("all 8,192 members recover through 256-head indexed pages without whole-population scans", async () => {
  await maximumPopulation();
  await run((state, storage) => {
    const explain = state.sql.exec("EXPLAIN QUERY PLAN SELECT id, head_hash FROM usage_contribution_memberships WHERE population_id = ? AND id > ? ORDER BY id LIMIT ?",
      POPULATION, hex(256, 32), 257).toArray();
    expect(explain.map(row => row.detail).join(" ")).toMatch(/SEARCH usage_contribution_memberships USING PRIMARY KEY/u);
    expect(explain.map(row => row.detail).join(" ")).not.toMatch(/SCAN |TEMP B-TREE/u);
    const exec = vi.spyOn(storage.sql, "exec"), wholePopulation = vi.spyOn(state, "members"), head = vi.spyOn(state, "head");
    const get = vi.spyOn(env.STAGING, "get"), transaction = vi.spyOn(storage, "transactionSync");
    let input = members(), pages = 0; const recovered: string[] = [];
    while (true) {
      const page = success(queryContributionHeads(state, input, authority())); pages++;
      expect(page.entries).toHaveLength(CONTRIBUTION_HEAD_QUERY_MAX_IDS); expect(page.population.memberCount).toBe(CONTRIBUTION_MAX_MEMBERS);
      expect(parseContributionHeadPage(input, page)).toEqual(page); recovered.push(...page.entries.map(entry => entry.id));
      if (!page.next) break;
      input = { ...common(), expectedRevision: page.revision, mode: "members", limit: 256, cursor: page.next };
      if (pages > 32) throw new Error("unbounded synthetic recovery");
    }
    expect(pages).toBe(32); expect(recovered).toEqual(Array.from({ length: CONTRIBUTION_MAX_MEMBERS }, (_, index) => hex(index + 1, 32)));
    expect(new Set(recovered).size).toBe(CONTRIBUTION_MAX_MEMBERS); expect(head).toHaveBeenCalledTimes(CONTRIBUTION_MAX_MEMBERS);
    const scans = exec.mock.calls.filter(([sql]) => sql.includes("FROM usage_contribution_memberships"));
    expect(scans).toHaveLength(32);
    expect(scans.every(([sql, population, , limit]) => sql.endsWith("ORDER BY id LIMIT ?") && population === POPULATION && limit === 257)).toBe(true);
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    for (const spy of [wholePopulation, get, transaction]) expect(spy).not.toHaveBeenCalled();
  });
});
test("a new canonical revision invalidates continuation before any head or membership enumeration", async () => {
  await fresh(); await publish([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const first = await run(state => success(queryContributionHeads(state, members(2), authority())));
  expect(first.next).not.toBeNull();
  await run(state => state.grantPopulation({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
    generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, populationId: hex(900), expectedRevision: state.control().revision,
    expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, { ...authority(), previousWriterRevoked: false }));
  await run((state, storage) => {
    const exec = vi.spyOn(storage.sql, "exec"), head = vi.spyOn(state, "head");
    const input: ContributionHeadQuery = { ...common(), expectedRevision: first.revision, mode: "members", limit: 2, cursor: first.next };
    expect(queryContributionHeads(state, input, authority())).toEqual({ ok: false, error: "conflict" });
    expect(queryContributionHeads(state, { ...named(), expectedRevision: first.revision }, authority())).toEqual({ ok: false, error: "conflict" });
    expect(head).not.toHaveBeenCalled(); expect(exec.mock.calls.some(([sql]) => sql.includes("FROM usage_contribution_memberships"))).toBe(false);
    expect(success(queryContributionHeads(state, members(3), authority())).entries).toHaveLength(3);
  });
});
test("read authority independently fences account, generation, device, writer, revocation and clock", async () => {
  await fresh(); await publish([{ id: 1 }]);
  await run(state => {
    for (const [fields, error] of [
      [{ accountId: `acct_${hex(99, 32)}` }, "unauthorized"], [{ generation: hex(99) }, "generation_conflict"],
      [{ deviceId: OTHER }, "unauthorized"], [{ active: false }, "revoked"], [{ observedAtMs: NOW - 1 }, "clock_regressed"],
    ] as const) expect(queryContributionHeads(state, named(), authority(fields))).toEqual({ ok: false, error });
    for (const [fields, error] of [
      [{ accountId: `acct_${hex(99, 32)}` }, "unauthorized"], [{ generation: hex(99) }, "generation_conflict"],
      [{ deviceId: OTHER }, "unauthorized"], [{ writerRevision: 2 }, "writer_conflict"], [{ populationId: hex(99) }, "writer_conflict"],
    ] as const) expect(queryContributionHeads(state, { ...named(), ...fields }, authority())).toEqual({ ok: false, error });
    state.grantPopulation({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: OTHER, populationId: POPULATION, expectedRevision: state.control().revision,
      expectedWriterRevision: 1, previousDeviceId: DEVICE, abandonOperationId: null }, { ...authority({ deviceId: OTHER }), previousWriterRevoked: true });
    expect(queryContributionHeads(state, named(), authority())).toEqual({ ok: false, error: "writer_conflict" });
    expect(success(queryContributionHeads(state, { ...named(), deviceId: OTHER, writerRevision: 2 }, authority({ deviceId: OTHER }))).entries[0].head).not.toBeNull();
  });
});
test("prepared accounts and corrupt membership metadata fail without read-time repair", async () => {
  await fresh(false);
  await run(state => expect(queryContributionHeads(state, named(), authority())).toEqual({ ok: false, error: "recovery_required" }));
  await run(state => state.activateFresh({ schemaVersion: 3, operationId: hex(++operation), accountId: account,
    generation: env.USAGE_ENROLLMENT_GENERATION, deviceId: DEVICE, expectedRevision: state.control().revision, mode: "fresh-empty" }, authority(), () => true));
  await publish([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await run((state, storage) => {
    const first = success(queryContributionHeads(state, members(2), authority())), cursor = first.next!;
    expect(queryContributionHeads(state, { ...common(), mode: "members", limit: 2, expectedRevision: first.revision,
      cursor: { ...cursor, populationHead: hex(999) } }, authority())).toEqual({ ok: false, error: "population_conflict" });
    const stored = state.sql.exec("SELECT * FROM usage_contribution_heads WHERE id=?", hex(1, 32)).one();
    state.sql.exec("DELETE FROM usage_contribution_heads WHERE id=?", hex(1, 32));
    const exec = vi.spyOn(storage.sql, "exec");
    expect(queryContributionHeads(state, members(), authority())).toEqual({ ok: false, error: "storage_invalid" });
    expect(queryContributionHeads(state, named(), authority())).toEqual({ ok: false, error: "storage_invalid" });
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true); exec.mockRestore();
    state.sql.exec("INSERT INTO usage_contribution_heads VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ...Object.values(stored));
    state.sql.exec("UPDATE usage_contribution_memberships SET head_hash=? WHERE population_id=? AND id=?", "0".repeat(64), POPULATION, hex(1, 32));
    expect(queryContributionHeads(state, members(), authority())).toEqual({ ok: false, error: "storage_invalid" });
    state.sql.exec("UPDATE usage_contribution_memberships SET head_hash=? WHERE population_id=? AND id=?", stored.head_hash, POPULATION, hex(1, 32));
    state.sql.exec("UPDATE usage_contribution_populations SET member_count=2 WHERE id=?", POPULATION);
    expect(queryContributionHeads(state, members(), authority())).toEqual({ ok: false, error: "storage_invalid" });
  });
});
