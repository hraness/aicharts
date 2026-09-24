import { expect, test } from "bun:test";
import fixture from "../../fixtures/usage/contribution-producer-v3.json";
import { decodeContributionHeadQuery, parseContributionHeadQueryResult } from "./contribution-head-query";
import { contributionHttpResult } from "./contributions-http-contract";
import { contributionBatchText, contributionBodyHash, contributionPayloadHash, parseContributionJson,
  parseContributionTerminal, referenceFold, type ContributionReferenceState } from "./contributions";
import { parseUsageStatsRow, statsTokenTotal } from "./stats-contract";

const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_producer_fixture");
  return value as Record<string, unknown>;
};
const result = (text: string): unknown => record(JSON.parse(text) as unknown).result;
const batch = () => {
  const parsed = parseContributionJson(fixture.batchText);
  if (!parsed) throw new Error("invalid_producer_fixture"); return parsed;
};

test("native producer freezes exact TypeScript canonical bytes, hashes and unknown coverage", () => {
  const value = batch();
  expect(contributionBatchText(value)).toBe(fixture.batchText);
  expect(contributionBodyHash(value)).toBe(fixture.bodyHash);
  expect(value.sequence).toBe(Number.MAX_SAFE_INTEGER);
  expect(value.replacement).toBeNull();
  const hashes: string[] = []; let total = 0n;
  for (const mutation of value.mutations) {
    if (mutation.kind !== "put") throw new Error("invalid_producer_fixture");
    const row = parseUsageStatsRow(mutation.row)!;
    expect(row).toEqual(mutation.row); expect(row.records).toBe(1);
    expect(row).toMatchObject({ client: "claude", provider: null, model: null, breakdownCoverage: "partial",
      reportedCostMicrousd: null, estimatedCostMicrousd: null, durationMs: null, timedTokens: "0" });
    hashes.push(contributionPayloadHash(row)); total += statsTokenTotal(row.tokens);
    // Order at the immutable boundary is normalized, including nested tokens.
    const reordered: Record<string, unknown> = Object.fromEntries(Object.entries(row).reverse());
    reordered.tokens = Object.fromEntries(Object.entries(row.tokens).reverse());
    expect(contributionPayloadHash(parseUsageStatsRow(reordered)!)).toBe(hashes.at(-1)!);
  }
  expect(hashes).toEqual(fixture.payloadHashes); expect(total).toBe(172n);
  expect(fixture.batchText).not.toMatch(/PRIVATE_|synthetic-(request|message|session)/u);
  expect(fixture.batchText).not.toContain(fixture.syntheticKeyHex);
});

test("the exact named-head reply and committed terminal correlate through existing HTTP contracts", () => {
  const query = decodeContributionHeadQuery(new TextEncoder().encode(fixture.queryText));
  if (!query) throw new Error("invalid_producer_fixture");
  expect(JSON.stringify(query)).toBe(fixture.queryText);
  const heads = parseContributionHeadQueryResult(query, result(fixture.headReplyText));
  if (!heads?.ok) throw new Error("invalid_producer_fixture");
  expect(heads.value.entries.map(entry => entry.id)).toEqual(batch().mutations.map(mutation => mutation.id));
  expect(heads.value.entries.every(entry => entry.head === null && entry.membershipHeadHash === null)).toBe(true);
  const terminal = parseContributionTerminal(record(result(fixture.terminalReplyText)).value);
  expect(terminal?.outcome).toBe("committed");
  expect(contributionHttpResult({ operation: "upload", request: batch() }, result(fixture.terminalReplyText)))
    .toEqual({ ok: true, value: terminal });
});

test("server reference transition accepts the native bytes and derives the same population history", () => {
  const value = batch(), heads = decodeContributionHeadQuery(new TextEncoder().encode(fixture.queryText))!;
  const reply = parseContributionHeadQueryResult(heads, result(fixture.headReplyText));
  if (!reply?.ok) throw new Error("invalid_producer_fixture");
  const state: ContributionReferenceState = {
    control: { accountId: value.accountId, generation: value.generation, revision: value.expectedRevision,
      updatedAtMs: 1_000, headCount: 0, membershipCount: 0, populationCount: 1, operationCount: 12, immutableBytes: 0,
      phase: "active", activationOperationId: "1".repeat(64), activationHash: "2".repeat(64), migrationManifestHash: null, legacySeal: null },
    populations: new Map([[value.populationId, reply.value.population]]), heads: new Map(), memberships: new Map(), unresolvedLegacy: [],
  };
  const folded = referenceFold(state, value, { accountId: value.accountId, generation: value.generation,
    deviceId: value.deviceId, active: true, allowAccountTombstone: false, observedAtMs: 1_001 });
  const terminal = parseContributionTerminal(record(result(fixture.terminalReplyText)).value);
  if (terminal?.outcome !== "committed") throw new Error("invalid_producer_fixture");
  expect(folded.plan.receipt).toEqual(terminal.receipt);
  expect(folded.state.heads.size).toBe(2); expect(folded.plan.deltas).toHaveLength(2);
  expect(folded.plan.population.memberCount).toBe(2);
});

test("number, decimal-string, null and coverage distinctions change or reject a payload", () => {
  const first = batch().mutations[0];
  if (first.kind !== "put") throw new Error("invalid_producer_fixture");
  const row = first.row;
  for (const changed of [{ ...row, tokens: { ...row.tokens, input: Number(row.tokens.input) } },
    { ...row, tokens: { ...row.tokens, reasoning: "00" } }, { ...row, durationMs: "0" }, { ...row, utcDay: -0 }])
    expect(parseUsageStatsRow(changed)).toBeNull();
  for (const changed of [{ ...row, breakdownCoverage: "complete" },
    { ...row, reportedCostMicrousd: "0", reportedCostRecords: 1 }]) {
    const parsed = parseUsageStatsRow(changed); expect(parsed).not.toBeNull();
    expect(contributionPayloadHash(parsed!)).not.toBe(contributionPayloadHash(row));
  }
});
