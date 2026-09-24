import { expect, test } from "bun:test";
import { CONTRIBUTION_CANCEL_REQUEST_BYTES, CONTRIBUTION_CANCEL_RESPONSE_BYTES, decodeContributionCancelRequest,
  encodeContributionCancelResult, parseContributionCancelRequest, parseContributionCancelResult,
  type ContributionCancelRequest } from "./contribution-cancel";
import { contributionBodyHash, contributionHash, CONTRIBUTION_IDENTITY, CONTRIBUTION_MAX_BYTES, CONTRIBUTION_MAX_OPERATIONS,
  CONTRIBUTION_PROFILE, CONTRIBUTION_ZERO_HASH, parseContributionBatch, type ContributionReceipt } from "./contributions";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
function request(): ContributionCancelRequest {
  const batch = parseContributionBatch({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
    grain: "observation", accountId: `acct_${hex(1, 32)}`, generation: hex(2), deviceId: hex(3), operationId: hex(4), sequence: 1,
    expectedRevision: 2, populationId: hex(5), writerRevision: 1, expectedPopulationRevision: 0, expectedPopulationHead: CONTRIBUTION_ZERO_HASH,
    replacement: null, mutations: [{ kind: "put", id: hex(1, 32), expectedHeadHash: null,
      row: { utcDay: 0, client: "claude", provider: null, model: null, tokens: { input: "120", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
        records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
        durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" } }] });
  if (!batch) throw new Error("invalid synthetic batch");
  return { schemaVersion: 3, accountId: batch.accountId, generation: batch.generation, deviceId: batch.deviceId,
    expectedRevision: 7, batch };
}
function receipt(value = request()): ContributionReceipt {
  const batch = value.batch, bodyHash = contributionBodyHash(batch);
  return { schemaVersion: 3, accountId: batch.accountId, generation: batch.generation, deviceId: batch.deviceId,
    operationId: batch.operationId, bodyHash, sequence: batch.sequence, revision: batch.expectedRevision + 1,
    populationId: batch.populationId, populationRevision: batch.expectedPopulationRevision + 1,
    populationHead: contributionHash(`aicharts:population-history:v3\0${JSON.stringify([batch.expectedPopulationHead, bodyHash])}`), committedAtMs: 1_000 };
}

test("fresh cancellation CAS preserves the exact frozen batch and routing identity", () => {
  const input = request();
  expect(parseContributionCancelRequest(input)).toEqual(input);
  const parsed = parseContributionCancelRequest({ ...input, expectedRevision: 0 });
  // Shape validation admits a stale retry: a retained terminal wins before the
  // mutable CAS condition in the authenticated state owner.
  expect(parsed?.expectedRevision).toBe(0);
  expect(parsed?.batch.expectedRevision).toBe(2);
  expect(contributionBodyHash(parsed!.batch)).toBe(contributionBodyHash(input.batch));
  for (const fields of [{ accountId: `acct_${hex(9, 32)}` }, { generation: hex(9) }, { deviceId: hex(9) },
    { expectedRevision: -0 }, { expectedRevision: CONTRIBUTION_MAX_OPERATIONS + 1 }, { extra: "PRIVATE_PROMPT_CANARY" },
    { batch: { ...input.batch, sequence: 0 } }, { batch: { ...input.batch, mutations: [] } }])
    expect(parseContributionCancelRequest({ ...input, ...fields })).toBeNull();
  let accessed = false;
  expect(parseContributionCancelRequest({ ...input, get batch() { accessed = true; return input.batch; } })).toBeNull();
  expect(accessed).toBe(false);
});

test("wire admission bounds the entire envelope before JSON parsing", () => {
  expect(CONTRIBUTION_CANCEL_REQUEST_BYTES).toBe(CONTRIBUTION_MAX_BYTES + 512);
  const input = request(), bytes = new TextEncoder().encode(JSON.stringify(input));
  expect(decodeContributionCancelRequest(bytes)).toEqual(input);
  const padded = new Uint8Array(CONTRIBUTION_CANCEL_REQUEST_BYTES).fill(32); padded.set(bytes);
  expect(decodeContributionCancelRequest(padded)).toEqual(input);
  expect(decodeContributionCancelRequest(new Uint8Array(CONTRIBUTION_CANCEL_REQUEST_BYTES + 1))).toBeNull();
  expect(decodeContributionCancelRequest(new Uint8Array([0xff]))).toBeNull();
});

test("abandoned terminal binds the original operation and body, not a later retry CAS", () => {
  const input = request(), abandoned = { outcome: "abandoned", operationId: input.batch.operationId,
    bodyHash: contributionBodyHash(input.batch), revision: 8 } as const;
  const value = { ok: true, value: abandoned } as const;
  expect(parseContributionCancelResult(input, value)).toEqual(value);
  expect(parseContributionCancelResult({ ...input, expectedRevision: 0 }, value)).toEqual(value);
  for (const fields of [{ operationId: hex(9) }, { bodyHash: hex(9) }, { revision: input.batch.expectedRevision },
    { revision: CONTRIBUTION_MAX_OPERATIONS + 1 }, { extra: true }])
    expect(parseContributionCancelResult(input, { ok: true, value: { ...abandoned, ...fields } })).toBeNull();
  expect(parseContributionCancelResult({ ...input, batch: { ...input.batch, sequence: 2 } }, value)).toBeNull();
  const encoded = encodeContributionCancelResult(input, value);
  expect(encoded).not.toBeNull(); expect(encoded!.byteLength).toBeLessThanOrEqual(CONTRIBUTION_CANCEL_RESPONSE_BYTES);
  expect(JSON.parse(new TextDecoder().decode(encoded!))).toEqual({ schemaVersion: 3, result: value });
});

test("an already committed reply must correlate every original receipt anchor", () => {
  const input = request(), committed = receipt(input), value = { ok: true, value: { outcome: "committed", receipt: committed } } as const;
  expect(parseContributionCancelResult(input, value)).toEqual(value);
  for (const fields of [{ accountId: `acct_${hex(9, 32)}` }, { generation: hex(9) }, { deviceId: hex(9) }, { operationId: hex(9) },
    { bodyHash: hex(9) }, { sequence: 2 }, { revision: 8 }, { populationId: hex(9) }, { populationRevision: 2 }, { populationHead: hex(9) }])
    expect(parseContributionCancelResult(input, { ok: true, value: { outcome: "committed", receipt: { ...committed, ...fields } } })).toBeNull();
});

test("result decoding keeps owned failures and refuses malformed terminal envelopes", () => {
  const input = request();
  for (const error of ["conflict", "writer_conflict", "revoked", "limit", "storage_unavailable"] as const)
    expect(parseContributionCancelResult(input, { ok: false, error })).toEqual({ ok: false, error });
  for (const value of [{ ok: false, error: "PRIVATE_PATH_CANARY" }, { ok: true, value: null },
    { ok: true, value: { outcome: "pending" } }, { ok: true, value: { outcome: "committed", receipt: receipt() }, extra: true }])
    expect(parseContributionCancelResult(input, value)).toBeNull();
});
