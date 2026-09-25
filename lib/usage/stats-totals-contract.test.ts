import { expect, test } from "bun:test";
import { decodeStatsTotalsResponse, encodeStatsTotalsRequest, encodeStatsTotalsResponse, parseStatsTotals, parseStatsTotalsQuery,
  parseStatsTotalsResult, STATS_TOTALS_RESPONSE_BYTES, statsAddTokens, statsTotalsTokenTotal, type StatsTotals } from "./stats-totals-contract";

const account = `acct_${"a".repeat(32)}`, device = "1".repeat(64);
const tokens = { input: "18", cacheRead: "5", cacheWrite: "6", output: "10", reasoning: "1" };
const cell = { records: 3, days: 3, firstUtcDay: 20_000, lastUtcDay: 20_003, tokens };
const totals: StatsTotals = { schemaVersion: 2, generatedAtMs: 1_000, revision: 4, updatedAtMs: 900, legacyRevision: 2, legacyVerifiedRevision: 2, legacyComplete: true,
  total: cell,
  clients: [{ client: "claude", basis: "legacy", ...cell }, { client: "codex", basis: "snapshots", records: 1, days: 1, firstUtcDay: 20_003, lastUtcDay: 20_003, tokens }],
  devices: [{ deviceId: device, enrolledAtMs: 10, revokedAtMs: null, ...cell, clients: [{ client: "codex", basis: "mixed", ...cell }] }] };

test("totals parse exactly, refuse drift and round-trip through bounded bytes", () => {
  expect(parseStatsTotals(totals)).toEqual(totals);
  expect(parseStatsTotalsQuery({ schemaVersion: 2, accountId: account, sessionExpiresAtMs: 5 })).toEqual({ schemaVersion: 2, accountId: account, sessionExpiresAtMs: 5 });
  const invalid: unknown[] = [
    { ...totals, legacyComplete: false }, { ...totals, legacyVerifiedRevision: 3 },
    { ...totals, total: { ...cell, days: 0 } }, { ...totals, total: { ...cell, firstUtcDay: null } }, { ...totals, total: { ...cell, days: 9 } },
    { ...totals, clients: [totals.clients[1], totals.clients[0]] }, { ...totals, clients: [{ ...totals.clients[0], basis: "guess" }] },
    { ...totals, devices: [totals.devices[0], totals.devices[0]] }, { ...totals, devices: [{ ...totals.devices[0], deviceId: "0".repeat(64) }] },
    { ...totals, total: { ...cell, tokens: { ...tokens, input: "-1" } } }, { ...totals, extra: "PRIVATE_CANARY" },
    { ...totals, get total() { throw new Error("PRIVATE_CANARY"); } },
  ];
  for (const value of invalid) expect(parseStatsTotals(value)).toBeNull();
  const request = encodeStatsTotalsRequest({ schemaVersion: 2, accountId: account, sessionExpiresAtMs: 5 });
  expect(request).not.toBeNull(); expect(request!.byteLength).toBeLessThanOrEqual(512);
  expect(encodeStatsTotalsRequest({ schemaVersion: 2, accountId: account, sessionExpiresAtMs: 5, uploadSecret: "PRIVATE_CANARY" })).toBeNull();
  const encoded = encodeStatsTotalsResponse({ ok: true, value: totals });
  expect(encoded).not.toBeNull(); expect(encoded!.byteLength).toBeLessThanOrEqual(STATS_TOTALS_RESPONSE_BYTES);
  expect(decodeStatsTotalsResponse(encoded)).toEqual({ ok: true, value: totals });
  expect(parseStatsTotalsResult({ ok: false, error: "not_enrolled" })).toEqual({ ok: false, error: "not_enrolled" });
  expect(parseStatsTotalsResult({ ok: false, error: "takeover_required" })).toBeNull();
  expect(decodeStatsTotalsResponse(new TextEncoder().encode("{}"))).toBeNull();
});

test("token arithmetic is exact past double precision", () => {
  const big = { input: "9007199254740993", cacheRead: "0", cacheWrite: "0", output: "1", reasoning: "0" };
  expect(statsAddTokens(big, big)).toEqual({ input: "18014398509481986", cacheRead: "0", cacheWrite: "0", output: "2", reasoning: "0" });
  expect(statsTotalsTokenTotal(big)).toBe(9007199254740994n);
});
