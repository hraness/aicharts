import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  parsePrivateDaysRequest, parsePrivateDaysValue, PRIVATE_DAYS_MAX_RESPONSE_BYTES,
  type PrivateDaysRequestV1, type PrivateDaysV1,
} from "./private-days-contract";

const request: PrivateDaysRequestV1 = { schemaVersion: 1, accountId: `acct_${"1".repeat(32)}`,
  sessionExpiresAtMs: 2_000, firstUtcDay: 0, dayCount: 2 };
const totals = (count = 0, total = "0", output = "0") => ({ usageOccurrences: count, observedAccountedTokens: total, observedOutputTokens: output });
const value = (query = request) => ({ schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
  journalRevision: 1, journalCommittedAtMs: 1_000, firstUtcDay: query.firstUtcDay,
  days: Array.from({ length: query.dayCount }, (_, index) => ({ utcDay: query.firstUtcDay + index, codex: totals(), claudeCode: totals(), devin: totals() })) } satisfies PrivateDaysV1);

test("request validation copies exact data and never establishes current authentication", () => {
  const source = { ...request }, parsed = parsePrivateDaysRequest(source);
  source.accountId = `acct_${"2".repeat(32)}`;
  expect(parsed).toEqual(request); expect(Object.isFrozen(parsed)).toBe(true);
  expect(parsePrivateDaysRequest({ ...request, sessionExpiresAtMs: 0 })).not.toBeNull();
  expect(parsePrivateDaysRequest({ ...request, firstUtcDay: 100_000_000, dayCount: 1 })).not.toBeNull();
  expect(parsePrivateDaysRequest({ ...request, firstUtcDay: 99_999_970, dayCount: 31 })).not.toBeNull();
});

test("request closure and numeric bounds reject malformed fields", () => {
  const bad: unknown[] = [null, [], true, {}, { ...request, extra: "PRIVATE_CANARY" }, { ...request, schemaVersion: 2 },
    { ...request, accountId: `acct_${"a".repeat(33)}` }, { ...request, accountId: `acct_${"A".repeat(32)}` },
    { ...request, sessionExpiresAtMs: -0 }, { ...request, sessionExpiresAtMs: 8_640_000_000_000_001 },
    { ...request, firstUtcDay: -0 }, { ...request, firstUtcDay: -1 }, { ...request, firstUtcDay: 1.5 },
    { ...request, firstUtcDay: 100_000_000 }, { ...request, dayCount: 0 }, { ...request, dayCount: 32 },
    { ...request, dayCount: "2" }, { ...request, dayCount: NaN }, { ...request, dayCount: Infinity }];
  for (const input of bad) expect(parsePrivateDaysRequest(input)).toBeNull();
  for (const key of Object.keys(request)) {
    const input: Record<string, unknown> = { ...request }; delete input[key];
    expect(parsePrivateDaysRequest(input)).toBeNull();
  }
});

test("accessors, symbols and unsafe prototypes fail without evaluating field getters", () => {
  let calls = 0;
  const accessor = Object.defineProperty({ ...request }, "accountId", { get() { calls++; return request.accountId; }, enumerable: true });
  const symbol = { ...request, [Symbol("private")]: 1 };
  const inherited = Object.assign(Object.create({ extra: true }), request);
  const hidden = Object.defineProperty({ ...request }, "accountId", { value: request.accountId, enumerable: false });
  for (const input of [accessor, symbol, inherited, hidden, new Proxy({}, { ownKeys() { throw new Error("PRIVATE_CANARY"); } })]) {
    expect(parsePrivateDaysRequest(input)).toBeNull();
  }
  expect(calls).toBe(0);
});

test("response is owned, deeply frozen, range-bound and excludes arbitrary data", () => {
  const source = value(); source.days[0].codex = totals(1, "15", "5");
  const parsed = parsePrivateDaysValue(request, source);
  expect(parsed).toEqual(source);
  source.days[0].codex.observedAccountedTokens = "90"; source.days.reverse();
  expect(parsed?.days[0].codex.observedAccountedTokens).toBe("15");
  for (const part of [parsed, parsed?.days, parsed?.days[0], parsed?.days[0].codex]) expect(Object.isFrozen(part)).toBe(true);
  expect(parsePrivateDaysValue({ ...request, firstUtcDay: 1 }, value())).toBeNull();
  expect(parsePrivateDaysValue(request, { ...value(), accountId: request.accountId })).toBeNull();
});

test("response sizing never invokes inherited object or array JSON hooks", () => {
  for (const prototype of [Object.prototype, Array.prototype]) for (const throwing of [false, true]) {
    const source = value({ ...request, dayCount: 31 }), query = { ...request, dayCount: 31 };
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    let calls = 0, parsed: PrivateDaysV1 | null = null;
    try {
      Object.defineProperty(prototype, "toJSON", { configurable: true, value() {
        calls++; if (throwing) throw new Error("SYNTHETIC_PRIVATE_CANARY"); return "SYNTHETIC_PRIVATE_CANARY";
      } });
      parsed = parsePrivateDaysValue(query, source);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(prototype, "toJSON");
      else Object.defineProperty(prototype, "toJSON", descriptor);
    }
    expect(calls).toBe(0); expect(parsed).toEqual(source); expect(parsed?.days.map(day => day.utcDay)).toHaveLength(31);
  }
});

test("canonical totals preserve values above 2^53 and current provider token limits", () => {
  const query = { ...request, dayCount: 31 }, source = value(query);
  source.journalRevision = 4_096;
  source.days[0].codex = totals(50_000, "150000000000000000", "50000000000000000");
  source.days[1].claudeCode = totals(30_000, "150000000000000000", "30000000000000000");
  source.days[2].devin = totals(20_000, "60000000000000000", "20000000000000000");
  const parsed = parsePrivateDaysValue(query, source);
  expect(parsed?.days[0].codex.observedAccountedTokens).toBe("150000000000000000");
  expect(parsed?.days[1].claudeCode.observedAccountedTokens).toBe("150000000000000000");
  expect(parsed?.days[2].devin.observedAccountedTokens).toBe("60000000000000000");
  expect(JSON.stringify(parsed).length).toBeLessThan(PRIVATE_DAYS_MAX_RESPONSE_BYTES);
  source.days[2].codex = totals(1, "1");
  expect(parsePrivateDaysValue(query, source)).toBeNull();
});

test("invalid totals, zero semantics, provider and journal bounds fail closed", () => {
  for (const candidate of [totals(0, "1"), totals(1, "0"), totals(1, "01"), totals(1, "1", "2"), totals(1, "-1"),
    totals(1, "1.0"), totals(1, "1e1"), totals(1, "1\n"), totals(1, "1\r"), totals(1, "1\u2028"),
    totals(1, "1", "0\n"), totals(1, "9".repeat(19)), totals(-0), totals(65_537, "65537"),
    totals(1, "3000000000001"), totals(1, "2000000000000", "1000000000001")]) {
    const source = value(); source.days[0].codex = candidate;
    expect(parsePrivateDaysValue(request, source)).toBeNull();
  }
  const zero = { ...value(), journalRevision: 0, journalCommittedAtMs: null };
  expect(parsePrivateDaysValue(request, zero)).not.toBeNull();
  zero.days[0].codex = totals(1, "1");
  expect(parsePrivateDaysValue(request, zero)).toBeNull();
  for (const fields of [{ journalRevision: 4_097 }, { journalRevision: -0 }, { journalCommittedAtMs: null },
    { journalRevision: 0 }, { journalCommittedAtMs: -0 }, { firstUtcDay: -0 }, { coverage: "complete" }, { measurementProfile: "turns-v1" }]) {
    expect(parsePrivateDaysValue(request, { ...value(), ...fields })).toBeNull();
  }
  const devin = value(); devin.days[0].devin = totals(1, "4000000000001");
  expect(parsePrivateDaysValue(request, devin)).toBeNull();
  const exceeded = value(); exceeded.journalRevision = 4_096;
  exceeded.days[0].codex = totals(65_536, "65536"); exceeded.days[0].claudeCode = totals(1, "1");
  expect(parsePrivateDaysValue(request, exceeded)).toBeNull();
});

test("day arrays must be exact dense data with no getters or additional fields", () => {
  const candidates = [value(), value(), value(), value(), value(), value()];
  candidates[0].days.reverse(); candidates[1].days.pop(); delete candidates[2].days[0];
  Object.defineProperty(candidates[3].days, "extra", { value: 1 });
  Object.defineProperty(candidates[4].days, "0", { get() { throw new Error("PRIVATE_CANARY"); } });
  Object.defineProperty(candidates[5].days[0].codex, "observedOutputTokens", { get() { throw new Error("PRIVATE_CANARY"); } });
  for (const source of candidates) expect(parsePrivateDaysValue(request, source)).toBeNull();
});

test("bounded ranges preserve exact order and reject a single shifted day", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_970 }), fc.integer({ min: 1, max: 31 }), (firstUtcDay, dayCount) => {
    const query = { ...request, firstUtcDay, dayCount }, source = value(query);
    expect(parsePrivateDaysValue(query, source)).toEqual(source);
    source.days[dayCount - 1].utcDay++;
    expect(parsePrivateDaysValue(query, source)).toBeNull();
  }), { numRuns: 100 });
});
