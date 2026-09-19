import { expect, test } from "bun:test";
import {
  leaderboardPublicHandle, parseLeaderboardConsentView,
  parseLeaderboardEntry, parseLeaderboardProjection, parseLeaderboardSnapshot,
  rankLeaderboardEntries, type LeaderboardRankable,
} from "./leaderboard-contract";

const account = `acct_${"ab".repeat(16)}`;
const base = { publicHandle: "alpha-coder", observedTokens: "1000", usageRecords: 4,
  consentedAtMs: 1_800_000_000_000, refreshedAtMs: 1_800_000_100_000, windowFirstUtcDay: 20_900, windowUtcDays: 30 };

test("bounded public handles admit lowercase digits and single interior hyphens only", () => {
  for (const valid of ["a", "abc", "a-b-c", "user-42", "x".repeat(32), "0"]) {
    expect(leaderboardPublicHandle(valid)).toBe(true);
  }
  for (const invalid of ["", "-a", "a-", "a--b", "A", "a b", "a_b", "a.b", "a@b", "acct_x",
    "x".repeat(33), "café", "a\nb", " a", "a ", "-", "--", "a--b"]) {
    expect(leaderboardPublicHandle(invalid)).toBe(false);
  }
  for (const invalid of [null, undefined, 0, {}, [], "a".repeat(33)]) {
    expect(leaderboardPublicHandle(invalid)).toBe(false);
  }
});

test("consent views require coherent grant and withdrawal shapes", () => {
  const withdrawn = parseLeaderboardConsentView({ schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null });
  expect(withdrawn).toEqual({ schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null });
  const granted = parseLeaderboardConsentView({ schemaVersion: 1, consent: true, consentedAtMs: 1_800_000_000_000, publicHandle: "alpha-coder" });
  expect(granted?.publicHandle).toBe("alpha-coder");
  for (const bad of [
    { schemaVersion: 1, consent: false, consentedAtMs: 1, publicHandle: null },
    { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: "x" },
    { schemaVersion: 1, consent: true, consentedAtMs: null, publicHandle: "x" },
    { schemaVersion: 1, consent: true, consentedAtMs: 1_800_000_000_000, publicHandle: "Bad-Handle" },
    { schemaVersion: 1, consent: true, consentedAtMs: 1_800_000_000_000, publicHandle: "x", extra: "PRIVATE_CANARY" },
    { schemaVersion: 2, consent: false, consentedAtMs: null, publicHandle: null },
    null, "PRIVATE_CANARY", 0,
  ]) expect(parseLeaderboardConsentView(bad)).toBeNull();
});

test("projections split the consent:true contribution from the removal signal", () => {
  const declined = parseLeaderboardProjection({ schemaVersion: 1, accountId: account, consent: false });
  expect(declined).toEqual({ schemaVersion: 1, accountId: account, consent: false });
  const granted = parseLeaderboardProjection({ schemaVersion: 1, accountId: account, consent: true,
    consentedAtMs: 1_800_000_000_000, publicHandle: "alpha-coder", observedTokens: "9007199254740993",
    usageRecords: 4, windowFirstUtcDay: 20_900, windowUtcDays: 30 });
  expect(granted).toMatchObject({ consent: true, publicHandle: "alpha-coder", observedTokens: "9007199254740993" });
  for (const bad of [
    { schemaVersion: 1, accountId: account, consent: false, publicHandle: "x" },
    { schemaVersion: 1, accountId: account, consent: true, consentedAtMs: 1, publicHandle: "Bad",
      observedTokens: "1", usageRecords: 0, windowFirstUtcDay: 1, windowUtcDays: 30 },
    { schemaVersion: 1, accountId: "acct_bad", consent: false },
    { schemaVersion: 1, accountId: account, consent: true, consentedAtMs: 1, publicHandle: "x",
      observedTokens: "-1", usageRecords: 0, windowFirstUtcDay: 1, windowUtcDays: 30 },
    { schemaVersion: 1, accountId: account, consent: true, consentedAtMs: 1, publicHandle: "x",
      observedTokens: "1", usageRecords: 0, windowFirstUtcDay: 1, windowUtcDays: 31 },
    { schemaVersion: 1, accountId: account, consent: true, consentedAtMs: 1, publicHandle: "x",
      observedTokens: "1", usageRecords: 0, windowFirstUtcDay: 1, windowUtcDays: 30, deviceId: "PRIVATE_CANARY" },
    null,
  ]) expect(parseLeaderboardProjection(bad)).toBeNull();
});

test("ranked entries keep exact decimals, bounded ranks and no account fields", () => {
  const entry = parseLeaderboardEntry({ rank: 1, ...base });
  expect(entry).toMatchObject({ rank: 1, publicHandle: "alpha-coder" });
  for (const bad of [
    { rank: 0, ...base }, { rank: 129, ...base }, { rank: 1, ...base, publicHandle: "Bad" },
    { rank: 1, ...base, observedTokens: "1.5" }, { rank: 1, ...base, accountId: account },
    { rank: 1, ...base, usageRecords: -1 }, { rank: 1, ...base, windowUtcDays: 31 },
    { rank: 1, ...base, windowFirstUtcDay: 100_000_000, windowUtcDays: 2 },
    { rank: 1, ...base, refreshedAtMs: -1 }, null,
  ]) expect(parseLeaderboardEntry(bad)).toBeNull();
});

test("all leaderboard windows end within the supported date range", () => {
  const edge = { ...base, windowFirstUtcDay: 100_000_000, windowUtcDays: 1 };
  expect(parseLeaderboardEntry({ rank: 1, ...edge })).not.toBeNull();
  expect(rankLeaderboardEntries([{ ...edge, windowUtcDays: 2 }])).toEqual([]);
  const projection = { publicHandle: edge.publicHandle, observedTokens: edge.observedTokens,
    usageRecords: edge.usageRecords, consentedAtMs: edge.consentedAtMs,
    windowFirstUtcDay: edge.windowFirstUtcDay, windowUtcDays: edge.windowUtcDays };
  expect(parseLeaderboardProjection({ schemaVersion: 1, accountId: account, consent: true, ...projection })).not.toBeNull();
  expect(parseLeaderboardProjection({ schemaVersion: 1, accountId: account, consent: true, ...projection, windowUtcDays: 2 })).toBeNull();
});

test("snapshots require the pinned ranking and unique ranks", () => {
  const snapshot = parseLeaderboardSnapshot({ schemaVersion: 1, ranking: "observed-tokens-30d-v1",
    computedAtMs: 1_800_000_000_000, entries: [{ rank: 1, ...base }] });
  expect(snapshot?.entries).toHaveLength(1);
  expect(parseLeaderboardSnapshot({ schemaVersion: 1, ranking: "observed-tokens-30d-v1",
    computedAtMs: 1_800_000_000_000, entries: [] })).not.toBeNull();
  for (const bad of [
    { schemaVersion: 1, ranking: "different-ranking", computedAtMs: 1_800_000_000_000, entries: [] },
    { schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs: 1_800_000_000_000,
      entries: [{ rank: 1, ...base }, { rank: 1, ...base, publicHandle: "other" }] },
    { schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs: -1, entries: [] },
    { schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs: 1_800_000_000_000,
      entries: [{ rank: 1, ...base, accountId: account }] },
    null,
  ]) expect(parseLeaderboardSnapshot(bad)).toBeNull();
});

test("ranking orders by exact tokens, records, then handle; collisions exclude", () => {
  const ranked = rankLeaderboardEntries([
    { ...base, publicHandle: "charlie", observedTokens: "50" },
    { ...base, publicHandle: "alice", observedTokens: "200" },
    { ...base, publicHandle: "bob", observedTokens: "200", usageRecords: 5 },
    { ...base, publicHandle: "alice", observedTokens: "900" },
  ] satisfies LeaderboardRankable[]);
  // Both "alice" entries collide on the same handle and are both excluded.
  expect(ranked.map(entry => entry.publicHandle)).toEqual(["bob", "charlie"]);
  expect(ranked.map(entry => entry.rank)).toEqual([1, 2]);
  const big = rankLeaderboardEntries([
    { ...base, publicHandle: "a", observedTokens: "9007199254740993" },
    { ...base, publicHandle: "b", observedTokens: "9007199254740992" },
  ]);
  expect(big[0]?.publicHandle).toBe("a");
  expect(rankLeaderboardEntries([{ ...base, publicHandle: "Bad Handle" }, { ...base, observedTokens: "NaN" }])).toEqual([]);
});
