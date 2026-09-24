import { expect, test } from "bun:test";
import { CONTRIBUTION_MAX_MEMBERS, CONTRIBUTION_MAX_MUTATIONS, CONTRIBUTION_MAX_POPULATIONS, parseContributionReference,
  type ContributionHead, type ContributionPopulation } from "./contributions";
import { CONTRIBUTION_HEAD_QUERY_MAX_IDS, CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES, CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES,
  decodeContributionHeadQuery, encodeContributionHeadQueryResult, parseContributionHeadPage, parseContributionHeadQuery,
  parseContributionHeadQueryResult, parseContributionMemberCursor, type ContributionHeadPage, type ContributionHeadQuery,
  type ContributionMemberCursor } from "./contribution-head-query";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const binding = { schemaVersion: 3 as const, accountId: `acct_${hex(1, 32)}`, generation: hex(2), deviceId: hex(3), populationId: hex(4), writerRevision: 1 };
const query = (ids = [hex(1, 32), hex(2, 32)]): ContributionHeadQuery => ({ ...binding, expectedRevision: null, mode: "heads", ids });
const members = (limit = 2, cursor: ContributionMemberCursor | null = null): ContributionHeadQuery =>
  ({ ...binding, expectedRevision: cursor?.revision ?? null, mode: "members", limit, cursor });
const population = (memberCount = 3): ContributionPopulation => ({ id: binding.populationId, generation: binding.generation,
  deviceId: binding.deviceId, writerRevision: binding.writerRevision, revision: 2, headHash: hex(5), memberCount });
const head = (id: number): ContributionHead => ({ id: hex(id, 32), headHash: hex(id + 10), payloadHash: hex(id + 20),
  reference: { kind: "batch-v3", bodyHash: hex(30), index: id % 256, payloadHash: hex(id + 20) },
  members: 1, deleted: false, legacySupport: false, suppressedLegacy: false });
function page(mode: "heads" | "members" = "heads", ids = [1, 2]): ContributionHeadPage {
  const entries = ids.map(id => ({ id: hex(id, 32), head: head(id), membershipHeadHash: hex(id + 10) }));
  return { schemaVersion: 3, profile: "contribution-heads-v3", mode, accountId: binding.accountId, generation: binding.generation,
    deviceId: binding.deviceId, revision: 10, observedAtMs: 1_000, population: population(), entries,
    next: mode === "heads" ? null : { ...binding, revision: 10, populationRevision: 2, populationHead: hex(5), afterId: entries.at(-1)!.id } };
}
test("named lookup owns sorted exact IDs and bounds input before parsing", () => {
  const source = query(), parsed = parseContributionHeadQuery(source)!;
  expect(parsed).toEqual(source); expect(Object.isFrozen(parsed)).toBe(true);
  if (parsed.mode !== "heads") throw new Error("invalid synthetic named query");
  expect(Object.isFrozen(parsed.ids)).toBe(true);
  expect(decodeContributionHeadQuery(new TextEncoder().encode(JSON.stringify(source)))).toEqual(source);
  for (const change of [{ ids: [] }, { ids: [hex(2, 32), hex(1, 32)] }, { ids: [hex(1, 32), hex(1, 32)] },
    { ids: [hex(0, 32)] }, { ids: [hex(1)] }, { expectedRevision: -0 }, { expectedRevision: 1_000_001 },
    { writerRevision: 0 }, { schemaVersion: 2 }, { mode: "members" }, { extra: "PRIVATE_PROMPT_CANARY" }])
    expect(parseContributionHeadQuery({ ...source, ...change })).toBeNull();
  expect(parseContributionHeadQuery(query(Array.from({ length: 257 }, (_, index) => hex(index + 1, 32))))).toBeNull();
  const padded = new Uint8Array(CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES + 1).fill(32);
  padded.set(new TextEncoder().encode(JSON.stringify(source))); expect(decodeContributionHeadQuery(padded)).toBeNull();
});
test("member continuation binds the current revision, generation and writer without an expiry claim", () => {
  const cursor = page("members").next!, input = members(2, cursor);
  expect(parseContributionHeadQuery(input)).toEqual(input);
  for (const changed of [{ ...input, expectedRevision: null }, { ...input, expectedRevision: 11 }, { ...input, writerRevision: 2 },
    { ...input, generation: hex(90) }, { ...input, deviceId: hex(90) }, { ...input, populationId: hex(90) },
    { ...input, accountId: `acct_${hex(90, 32)}` }, { ...input, limit: 0 }, { ...input, limit: 257 }])
    expect(parseContributionHeadQuery(changed)).toBeNull();
  for (const changed of [{ ...cursor, revision: -0 }, { ...cursor, populationRevision: 11 }, { ...cursor, populationRevision: 0 },
    { ...cursor, afterId: hex(0, 32) }, { ...cursor, expiresAtMs: Number.MAX_SAFE_INTEGER }]) expect(parseContributionMemberCursor(changed)).toBeNull();
});
test("named results preserve missing, deleted and stale mirrored membership as different facts", () => {
  const value = page(), current = value.entries[0].head!;
  const changed = { ...value, entries: [{ ...value.entries[0], membershipHeadHash: hex(99) }, { id: hex(2, 32), head: null, membershipHeadHash: null }] };
  const parsed = parseContributionHeadPage(query(), changed)!;
  expect(parsed).toEqual(changed); expect(parsed.entries[0].membershipHeadHash).not.toBe(parsed.entries[0].head!.headHash);
  expect(Object.isFrozen(parsed.entries[0].head!.reference)).toBe(true);
  const deleted = { ...value, entries: [{ ...value.entries[0], head: { ...current, deleted: true, reference: null, payloadHash: null } }, value.entries[1]] };
  expect(parseContributionHeadPage(query(), deleted)).toEqual(deleted);
  for (const entries of [value.entries.slice(0, 1), [...value.entries].reverse(), [value.entries[0], value.entries[0]],
    [{ ...value.entries[0], head: null }, value.entries[1]], [{ ...value.entries[0], head: { ...current, members: 0 } }, value.entries[1]],
    [{ ...value.entries[0], head: { ...current, id: hex(99, 32) } }, value.entries[1]],
    [{ ...value.entries[0], head: { ...current, payloadHash: hex(99) } }, value.entries[1]]])
    expect(parseContributionHeadPage(query(), { ...value, entries })).toBeNull();
});
test("result correlation rejects foreign, reordered and falsely complete membership pages", () => {
  const value = page("members"), input = members();
  expect(parseContributionHeadPage(input, value)).toEqual(value);
  const nextQuery = members(2, value.next), last = { ...value, entries: page("heads", [3]).entries, next: null };
  expect(parseContributionHeadPage(nextQuery, last)).toEqual(last);
  for (const change of [{ accountId: `acct_${hex(91, 32)}` }, { generation: hex(91) }, { deviceId: hex(91) }, { mode: "heads" },
    { profile: "all-observations" }, { observedAtMs: -0 }, { revision: 1 }, { next: null },
    { population: { ...value.population, writerRevision: 2 } }, { population: { ...value.population, memberCount: 1 } },
    { next: { ...value.next, afterId: hex(3, 32) } }, { next: { ...value.next, revision: 11 } },
    { next: { ...value.next, populationRevision: 3 } }, { next: { ...value.next, populationHead: hex(99) } },
    { entries: [value.entries[1], value.entries[0]] }, { entries: [value.entries[0]] },
    { entries: [{ ...value.entries[0], membershipHeadHash: null }, value.entries[1]] }])
    expect(parseContributionHeadPage(input, { ...value, ...change })).toBeNull();
  for (const change of [{ revision: 11 }, { entries: value.entries }, { population: { ...value.population, revision: 3 } },
    { population: { ...value.population, headHash: hex(99) } }]) expect(parseContributionHeadPage(nextQuery, { ...last, ...change })).toBeNull();
  const empty = { ...value, population: { ...value.population, memberCount: 0 }, entries: [], next: null };
  expect(parseContributionHeadPage(input, empty)).toEqual(empty);
});
test("maximum named V1 references fit the bounded transport and mirror canonical wire caps", () => {
  expect(CONTRIBUTION_HEAD_QUERY_MAX_IDS).toBe(CONTRIBUTION_MAX_MUTATIONS);
  const ids = Array.from({ length: CONTRIBUTION_HEAD_QUERY_MAX_IDS }, (_, index) => index + 1), input = query(ids.map(id => hex(id, 32)));
  const value = { ...page("heads", ids), population: population(CONTRIBUTION_MAX_MEMBERS), entries: ids.map(id => {
    const current = head(id), source = { kind: "admission-v1" as const, bodyHash: hex(31), generation: hex(32),
      operationHash: hex(33), index: id % 256, payloadHash: current.payloadHash! };
    expect(parseContributionReference(source)).toEqual(source);
    return { id: current.id, head: { ...current, members: CONTRIBUTION_MAX_POPULATIONS, legacySupport: true, reference: source }, membershipHeadHash: current.headHash };
  }) };
  expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThan(CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES);
  expect(parseContributionHeadPage(input, value)).toEqual(value);
  const bytes = encodeContributionHeadQueryResult(input, { ok: true, value });
  expect(bytes).not.toBeNull(); expect(bytes!.byteLength).toBeLessThan(CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES);
  expect(JSON.parse(new TextDecoder().decode(bytes!))).toEqual({ schemaVersion: 3, result: { ok: true, value } });
  expect(parseContributionHeadPage(input, { ...value, population: population(CONTRIBUTION_MAX_MEMBERS + 1) })).toBeNull();
  for (const fields of [{ members: CONTRIBUTION_MAX_POPULATIONS + 1 }, { reference: { ...value.entries[0].head.reference, index: 256 } },
    { reference: { ...value.entries[0].head.reference, bodyHash: "PRIVATE_PROMPT_CANARY" } }])
    expect(parseContributionHeadPage(input, { ...value, entries: [{ ...value.entries[0], head: { ...value.entries[0].head, ...fields } }, ...value.entries.slice(1)] })).toBeNull();
});
test("array and object admission rejects accessors, sparse arrays and custom iteration without calling them", () => {
  let calls = 0;
  const accessor = { ...query() }; Object.defineProperty(accessor, "ids", { enumerable: true, get() { calls++; return [hex(1, 32)]; } });
  expect(parseContributionHeadQuery(accessor)).toBeNull();
  const ids = [hex(1, 32)]; Object.defineProperty(ids, "0", { enumerable: true, get() { calls++; return hex(1, 32); } });
  expect(parseContributionHeadQuery({ ...query(), ids })).toBeNull();
  const iterator = [hex(1, 32)]; Object.defineProperty(iterator, Symbol.iterator, { value: function* () { calls++; yield hex(1, 32); } });
  expect(parseContributionHeadQuery({ ...query(), ids: iterator })).toBeNull();
  expect(parseContributionHeadQuery({ ...query(), ids: new Array(2) })).toBeNull();
  const value = page(), entry = { ...value.entries[0] }; Object.defineProperty(entry, "head", { enumerable: true, get() { calls++; return head(1); } });
  expect(parseContributionHeadPage(query(), { ...value, entries: [entry, value.entries[1]] })).toBeNull(); expect(calls).toBe(0);
});
test("only declared error vocabulary and request-correlated success cross the wire", () => {
  const input = query();
  expect(parseContributionHeadQueryResult(input, { ok: false, error: "conflict" })).toEqual({ ok: false, error: "conflict" });
  expect(parseContributionHeadQueryResult(input, { ok: false, error: "snapshot_expired" })).toBeNull();
  expect(parseContributionHeadQueryResult(input, { ok: false, error: "PRIVATE_SECRET_CANARY" })).toBeNull();
  expect(parseContributionHeadQueryResult(input, { ok: true, value: page(), extra: true })).toBeNull();
  expect(encodeContributionHeadQueryResult(input, { ok: true, value: { ...page(), revision: -1 } })).toBeNull();
});
