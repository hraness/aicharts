import { expect, test } from "bun:test";
import {
  decodeLeaderboardHttpResponse, encodeLeaderboardHttpResponse, leaderboardHttpFailure,
  LEADERBOARD_HTTP_RESPONSE_BYTES, parseLeaderboardQueryResult, type LeaderboardQueryResult,
} from "./leaderboard-http-contract";
import { decodeLeaderboardPublicReply, encodeLeaderboardPublicReply,
  parseLeaderboardPublicReply } from "./leaderboard-public";
import type { LeaderboardEntryV1, LeaderboardSnapshotV1 } from "./leaderboard-contract";

const entry: LeaderboardEntryV1 = { rank: 1, publicHandle: "alpha-coder", observedTokens: "9007199254740993", usageRecords: 4,
  consentedAtMs: 1_799_000_000_000, refreshedAtMs: 1_800_000_000_000, windowFirstUtcDay: 20_900, windowUtcDays: 30 };
const snapshot: LeaderboardSnapshotV1 = { schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs: 1_800_000_000_000, entries: [entry] };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("query results admit only the materialized snapshot or fixed errors", () => {
  expect(parseLeaderboardQueryResult({ ok: true, value: snapshot })).toEqual({ ok: true, value: snapshot });
  expect(parseLeaderboardQueryResult({ ok: false, error: "storage_unavailable" })).toEqual({ ok: false, error: "storage_unavailable" });
  for (const bad of [
    { ok: false, error: "not_enrolled" }, { ok: false, error: "authentication_required" },
    { ok: true, value: { ...snapshot, ranking: "other" } },
    { ok: true, value: { ...snapshot, entries: [{ ...entry, accountId: "acct_x" }] } },
    { ok: true, value: snapshot, extra: 1 }, null,
  ]) expect(parseLeaderboardQueryResult(bad)).toBeNull();
});

test("worker responses round-trip the pinned envelope and reject identity", () => {
  for (const result of [{ ok: true, value: snapshot }, { ok: true, value: { ...snapshot, entries: [] } },
    { ok: false, error: "storage_invalid" }] as LeaderboardQueryResult[]) {
    const encoded = encodeLeaderboardHttpResponse(result);
    expect(encoded).not.toBeNull(); expect(encoded!.byteLength).toBeLessThanOrEqual(LEADERBOARD_HTTP_RESPONSE_BYTES);
    expect(text(encoded!)).toBe(JSON.stringify({ schemaVersion: 1, result }));
    expect(decodeLeaderboardHttpResponse(encoded!)).toEqual(result);
  }
  for (const bad of [
    { ok: false, error: "not_enrolled" }, { ok: true, value: { ...snapshot, computedAtMs: -1 } }, null,
  ]) expect(encodeLeaderboardHttpResponse(bad)).toBeNull();
  for (const bad of [
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, result: { ok: false, error: "not_enrolled" } })),
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, result: { ok: true, value: { ...snapshot, entries: [{ ...entry, deviceId: "PRIVATE_CANARY" }] } } })),
    new Uint8Array([0xff]), "x", null,
  ]) expect(decodeLeaderboardHttpResponse(bad)).toBeNull();
});

test("fixed public failures stay constant and bounded", () => {
  for (const [code, expected] of [["invalid_request", 'invalid_request'], ["leaderboard_unavailable", "leaderboard_unavailable"]] as const) {
    const bytes = leaderboardHttpFailure(code);
    expect(text(bytes)).toBe(`{"schemaVersion":1,"error":{"code":"${expected}"}}`);
    expect(bytes.byteLength).toBeLessThanOrEqual(128);
  }
});

test("public browser replies keep ready/error states distinct", () => {
  for (const reply of [
    { schemaVersion: 1, state: "ready", value: snapshot },
    { schemaVersion: 1, error: { code: "unavailable" } },
    { schemaVersion: 1, error: { code: "method_not_allowed" } },
  ]) {
    const parsed = parseLeaderboardPublicReply(reply);
    expect(parsed).not.toBeNull();
    const encoded = encodeLeaderboardPublicReply(parsed);
    expect(encoded).not.toBeNull();
    expect(decodeLeaderboardPublicReply(encoded!)).toEqual(parsed);
  }
  for (const bad of [
    { schemaVersion: 1, state: "unavailable" }, { schemaVersion: 1, state: "not_enrolled" },
    { schemaVersion: 1, state: "ready", value: { ...snapshot, ranking: "x" } },
    { schemaVersion: 1, state: "authentication_required" }, { schemaVersion: 2, error: { code: "unavailable" } }, null,
  ]) expect(parseLeaderboardPublicReply(bad)).toBeNull();
});
