import { describe, expect, test } from "bun:test";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_MAX_HEADS, CONTRIBUTION_MAX_MEMBERS, CONTRIBUTION_MAX_MUTATIONS,
  CONTRIBUTION_PROFILE, CONTRIBUTION_ZERO_HASH, ContributionFault, contributionBatchText, contributionBodyHash,
  contributionCoverage, parseContributionBatch, parseContributionGrant, parseUnresolvedContributionLegacy, referenceFold,
  parseContributionStatus, type ContributionAuthority, type ContributionBatch, type ContributionMutation, type ContributionReference, type ContributionError,
  type ContributionReferenceState } from "./contributions";
import { parseUsageStatsRow, statsTokenTotal, type UsageStatsRow } from "./stats-contract";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const ACCOUNT = `acct_${hex(1, 32)}`, GENERATION = hex(2), DEVICE = hex(3), POPULATION = hex(4), COPY = hex(5);
const auth = (fields: Partial<ContributionAuthority> = {}): ContributionAuthority => ({ accountId: ACCOUNT,
  generation: GENERATION, deviceId: DEVICE, observedAtMs: 100_000, active: true, allowAccountTombstone: true, ...fields });
const row = (input: number, fields: Partial<UsageStatsRow> = {}): UsageStatsRow => {
  const parsed = parseUsageStatsRow({ utcDay: 0, client: "codex", provider: null, model: null,
    tokens: { input: String(input), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, records: 1,
    reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete", ...fields });
  if (!parsed) throw new Error("invalid synthetic row"); return parsed;
};
function initial(): ContributionReferenceState {
  return { control: { accountId: ACCOUNT, generation: GENERATION, revision: 0, updatedAtMs: 0, headCount: 0,
    membershipCount: 0, populationCount: 2, operationCount: 0, immutableBytes: 0, phase: "active", activationOperationId: hex(90),
    activationHash: hex(91), migrationManifestHash: null, legacySeal: null }, heads: new Map(), memberships: new Map(),
    populations: new Map([POPULATION, COPY].map(id => [id, { id, generation: GENERATION, deviceId: DEVICE, writerRevision: 1,
      revision: 0, headHash: CONTRIBUTION_ZERO_HASH, memberCount: 0 }])), unresolvedLegacy: [] };
}
function fixture() {
  let state = initial(), operation = 100;
  const bodies = new Map<string, ContributionBatch>();
  const batch = (mutations: readonly ContributionMutation[], populationId = POPULATION,
    fields: Partial<ContributionBatch> = {}): ContributionBatch => {
    const population = state.populations.get(populationId)!;
    const parsed = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
      grain: "observation", accountId: ACCOUNT, generation: GENERATION, deviceId: DEVICE, operationId: hex(++operation), sequence: 1,
      expectedRevision: state.control.revision, populationId, writerRevision: population.writerRevision,
      expectedPopulationRevision: population.revision, expectedPopulationHead: population.headHash, replacement: null,
      mutations, ...fields });
    if (!parsed) throw new Error("invalid synthetic batch"); return parsed;
  };
  const put = (id: number, amount: number, fields: Partial<UsageStatsRow> = {}): ContributionMutation => ({ kind: "put", id: hex(id, 32),
    expectedHeadHash: state.heads.get(hex(id, 32))?.headHash ?? null, row: row(amount, fields) });
  const apply = (value: ContributionBatch, authority = auth()) => {
    const folded = referenceFold(state, value, authority); state = folded.state;
    bodies.set(contributionBodyHash(value), value); return folded.plan;
  };
  const resolve = (reference: ContributionReference): UsageStatsRow => {
    const mutation = bodies.get(reference.bodyHash)?.mutations[reference.index];
    if (mutation?.kind !== "put") throw new Error("missing retained synthetic body"); return mutation.row;
  };
  const total = () => [...state.heads.values()].reduce((sum, head) => sum + (head.members > 0 && head.reference
    ? statsTokenTotal(resolve(head.reference).tokens) : 0n), 0n);
  return { get state() { return state; }, batch, put, apply, total, resolve };
}
function refuses(run: () => unknown, code: ContributionError): void {
  try { run(); throw new Error("expected rejection"); } catch (error) { expect(error).toBeInstanceOf(ContributionFault); expect((error as ContributionFault).code).toBe(code); }
}

describe("canonical contribution identities and exact corrections", () => {
  test("120 plus distinct 15 is 135; any number of source copies adds zero", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)]));
    f.apply(f.batch([f.put(2, 15)]));
    expect(f.total()).toBe(135n);
    const copied = f.apply(f.batch([f.put(1, 120), f.put(2, 15)], COPY));
    expect(copied.deltas).toEqual([]); expect(f.total()).toBe(135n);
    expect(contributionCoverage(f.state)).toEqual({ exactAccountTotal: true, canonicalObservations: 2, unresolvedLegacyBodies: 0 });
  });
  test("equal aggregate totals cannot identify equal populations", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)]));
    f.apply(f.batch([f.put(2, 120)], COPY));
    expect(f.total()).toBe(240n); expect(f.state.heads.size).toBe(2);
  });
  test("partial scans preserve absent observations; complete replacement owns one population only", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120), f.put(2, 15)]));
    f.apply(f.batch([f.put(1, 120)], COPY));
    f.apply(f.batch([f.put(2, 20)])); expect(f.total()).toBe(140n);
    const plan = f.apply(f.batch([], POPULATION, { replacement: { members: [] } }));
    expect(f.total()).toBe(120n); expect(plan.deltas).toHaveLength(1);
    expect(f.state.heads.get(hex(1, 32))?.members).toBe(1);
  });
  test("a moving correction removes the exact old cell and publishes the new cell", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)]));
    const plan = f.apply(f.batch([f.put(1, 15, { utcDay: 1, model: "gpt-5" })]));
    expect(plan.deltas).toHaveLength(1);
    expect(f.resolve(plan.deltas[0].before!)).toMatchObject({ utcDay: 0, model: null, tokens: { input: "120" } });
    expect(f.resolve(plan.deltas[0].after!)).toMatchObject({ utcDay: 1, model: "gpt-5", tokens: { input: "15" } });
    expect(f.total()).toBe(15n);
  });
  test("stale copied history cannot overwrite a correction it has not witnessed", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)])); f.apply(f.batch([f.put(1, 120)], COPY));
    f.apply(f.batch([f.put(1, 15)]));
    refuses(() => f.apply(f.batch([f.put(1, 120)], COPY)), "population_conflict");
    expect(f.total()).toBe(15n);
    f.apply(f.batch([f.put(1, 15)], COPY));
    f.apply(f.batch([f.put(1, 18)], COPY)); expect(f.total()).toBe(18n);
  });
  test("population removal can be rejoined, while an account tombstone cannot", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)]));
    f.apply(f.batch([{ kind: "remove", id: hex(1, 32), expectedHeadHash: f.state.heads.get(hex(1, 32))!.headHash }]));
    expect(f.total()).toBe(0n); f.apply(f.batch([f.put(1, 120)], COPY)); expect(f.total()).toBe(120n);
    f.apply(f.batch([{ kind: "tombstone", id: hex(1, 32), expectedHeadHash: f.state.heads.get(hex(1, 32))!.headHash }], COPY));
    expect(f.total()).toBe(0n);
    refuses(() => f.apply(f.batch([f.put(1, 120)])), "subject_deleted");
  });
  test("tombstones require explicit account authority", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)]));
    refuses(() => f.apply(f.batch([{ kind: "tombstone", id: hex(1, 32), expectedHeadHash: f.state.heads.get(hex(1, 32))!.headHash }]),
      auth({ allowAccountTombstone: false })), "unauthorized"); expect(f.total()).toBe(120n);
  });
  test("population and fact predecessors independently refuse stale callbacks", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)]));
    const old = f.batch([f.put(1, 15)]); f.apply(f.batch([f.put(2, 5)]));
    refuses(() => f.apply(old), "conflict");
    refuses(() => f.apply({ ...old, expectedRevision: f.state.control.revision }), "population_conflict");
    refuses(() => f.apply(f.batch([{ ...f.put(1, 15), expectedHeadHash: hex(777) } as ContributionMutation])), "predecessor_conflict");
  });
  test("writer, generation, account, revocation, and clock authority bind the transition", () => {
    const f = fixture(), value = f.batch([f.put(1, 1)]);
    refuses(() => f.apply({ ...value, writerRevision: 2 }), "writer_conflict");
    refuses(() => f.apply(value, auth({ generation: hex(999) })), "generation_conflict");
    refuses(() => f.apply(value, auth({ accountId: `acct_${hex(888, 32)}` })), "unauthorized");
    refuses(() => f.apply(value, auth({ active: false })), "revoked");
    f.apply(value); refuses(() => f.apply(f.batch([f.put(2, 1)]), auth({ observedAtMs: 1 })), "clock_regressed");
  });
  test("complete membership cannot invent observations or silently remove another population", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 20)]));
    refuses(() => f.apply(f.batch([], COPY, { replacement: { members: [hex(1, 32)] } })), "population_conflict");
    expect(f.total()).toBe(20n);
  });
  test("unresolved V2 evidence makes the combined total explicitly unavailable", () => {
    const f = fixture(); f.apply(f.batch([f.put(1, 120)]));
    const legacy = parseUnresolvedContributionLegacy({ schemaVersion: 3, kind: "aggregate-v2", bodyHash: hex(44), generation: GENERATION,
      client: "codex", firstUtcDay: 0, dayCount: 1 });
    expect(legacy).not.toBeNull();
    expect(contributionCoverage({ ...f.state, unresolvedLegacy: [legacy!] })).toEqual({ exactAccountTotal: false,
      canonicalObservations: 1, unresolvedLegacyBodies: 1 });
  });
});

describe("strict versioned and bounded contract", () => {
  test("aggregate/session request counts cannot be silently asserted as observation facts", () => {
    const f = fixture(), value = f.batch([f.put(1, 1)]);
    expect(parseContributionBatch({ ...value, grain: "request" })).toBeNull();
    expect(parseContributionBatch({ ...value, identityScheme: "device-total" })).toBeNull();
    expect(parseContributionBatch({ ...value, mutations: [{ ...f.put(1, 1), row: { ...row(1), records: 2 } }] })).toBeNull();
  });
  test("shape, accessors, ordering, duplicates, numeric bounds and population ceilings refuse", () => {
    const f = fixture(), value = f.batch([f.put(1, 1)]);
    for (const changed of [{ ...value, extra: 1 }, { ...value, sequence: -0 }, { ...value, operationId: CONTRIBUTION_ZERO_HASH },
      { ...value, mutations: [f.put(1, 1), f.put(1, 1)] }, { ...value, mutations: [f.put(2, 1), f.put(1, 1)] },
      { ...value, mutations: Array.from({ length: CONTRIBUTION_MAX_MUTATIONS + 1 }, (_, index) => f.put(index + 1, 1)) },
      { ...value, replacement: { members: Array.from({ length: CONTRIBUTION_MAX_MEMBERS + 1 }, (_, index) => hex(index + 1, 32)) } }])
      expect(parseContributionBatch(changed)).toBeNull();
    let accessed = false;
    const evil = { ...value }; Object.defineProperty(evil, "operationId", { enumerable: true, get() { accessed = true; throw new Error("no access"); } });
    expect(parseContributionBatch(evil)).toBeNull(); expect(accessed).toBe(false);
    const sparse = new Array(1); expect(parseContributionBatch({ ...value, mutations: sparse })).toBeNull();
  });
  test("wire order has one canonical body hash; noncanonical aliases do not enter", () => {
    const f = fixture(), value = f.batch([f.put(1, 15)]), reversed = Object.fromEntries(Object.entries(value).reverse());
    expect(contributionBatchText(parseContributionBatch(reversed)!)).toBe(contributionBatchText(value));
    expect(parseContributionBatch({ ...value, mutations: [{ ...f.put(1, 1), id: hex(1, 32).toUpperCase().replace("1", "A") }] })).toBeNull();
    expect(parseContributionGrant({ schemaVersion: 3, operationId: hex(100), accountId: ACCOUNT, generation: GENERATION, deviceId: DEVICE,
      populationId: POPULATION, expectedRevision: 0, expectedWriterRevision: 0, previousDeviceId: DEVICE, abandonOperationId: null })).toBeNull();
  });
  test("head capacity refuses before publishing any transition", () => {
    const f = fixture(), state = { ...f.state, control: { ...f.state.control, headCount: CONTRIBUTION_MAX_HEADS } };
    refuses(() => referenceFold(state, f.batch([f.put(1, 1)]), auth()), "limit");
    expect(state.heads.size).toBe(0);
  });
  test("generated disjoint/copy/correction schedules match an independent numeric map", () => {
    for (const seed of [1066793, 539363619, 1592639710]) {
      const f = fixture(), expected = new Map<number, number>(); let random = seed;
      for (let index = 1; index <= 80; index++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const id = random % 12 + 1, amount = random % 1000;
        const current = expected.get(id);
        if (current !== undefined && f.state.memberships.get(COPY)?.has(hex(id, 32)))
          f.apply(f.batch([f.put(id, current)], POPULATION));
        f.apply(f.batch([f.put(id, amount)])); expected.set(id, amount);
        if (index % 3 === 0) f.apply(f.batch([f.put(id, amount)], COPY));
        expect(f.total()).toBe([...expected.values()].reduce((sum, value) => sum + BigInt(value), 0n));
        expect(contributionCoverage(f.state).canonicalObservations).toBe(expected.size);
      }
    }
  });
});

describe("status terminal and population history consistency", () => {
  const status = (populationRevision: number, populationHead: string, receiptPopulationRevision = 1, receiptPopulationHead = hex(88)) => ({
    schemaVersion: 3, accountId: ACCOUNT, generation: GENERATION, revision: 2, nextSequence: 2, phase: "active",
    activationHash: hex(90), migrationManifestHash: null,
    population: { id: POPULATION, generation: GENERATION, deviceId: DEVICE, writerRevision: 1,
      revision: populationRevision, headHash: populationHead, memberCount: 1 },
    operation: { operationId: hex(100), bodyHash: hex(101), outcome: "committed", terminal: { outcome: "committed", receipt: {
      schemaVersion: 3, operationId: hex(100), bodyHash: hex(101), accountId: ACCOUNT, generation: GENERATION, deviceId: DEVICE,
      sequence: 1, revision: 1, populationId: POPULATION, populationRevision: receiptPopulationRevision,
      populationHead: receiptPopulationHead, committedAtMs: 1,
    } } },
    legacyResolution: "not_evaluated",
  });

  test("a committed terminal accepts later population history and grant-preserved heads", () => {
    expect(parseContributionStatus(status(1, hex(88)))).not.toBeNull();
    expect(parseContributionStatus(status(2, hex(99)))).not.toBeNull();
  });

  test("a status snapshot cannot predate or contradict the committed population history", () => {
    expect(parseContributionStatus(status(0, CONTRIBUTION_ZERO_HASH))).toBeNull();
    expect(parseContributionStatus(status(1, hex(89)))).toBeNull();
    expect(parseContributionStatus(status(2, hex(99), 2, hex(88)))).toBeNull();
  });

  test("population generation remains bound to the account status generation", () => {
    const value = status(1, hex(88));
    value.population.generation = hex(999);
    expect(parseContributionStatus(value)).toBeNull();
  });
});
