import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LEADERBOARD_RANKING, type LeaderboardSnapshotV1 } from "@/lib/usage/leaderboard-contract";
import { LeaderboardView } from "./leaderboard-view";

const snapshot: LeaderboardSnapshotV1 = { schemaVersion: 1, ranking: LEADERBOARD_RANKING, computedAtMs: 1_800_000_000_000, entries: [
  { rank: 1, publicHandle: "first", observedTokens: "9007199254740993", usageRecords: 10, consentedAtMs: 1_800_000_000_000, refreshedAtMs: 1_800_000_000_000, windowFirstUtcDay: 20000, windowUtcDays: 30 },
  { rank: 2, publicHandle: "second", observedTokens: "1000", usageRecords: 1, consentedAtMs: 1_800_000_000_000, refreshedAtMs: 1_800_000_000_000, windowFirstUtcDay: 19990, windowUtcDays: 20 },
] };

test("an unavailable public read is distinct from disabled publication", () => {
  const paused = renderToStaticMarkup(<LeaderboardView available={false} snapshot={null} />);
  expect(paused).toContain("Not live yet");
  expect(paused).toContain("Inspect local sessions");
  const unavailable = renderToStaticMarkup(<LeaderboardView available snapshot={null} />);
  expect(unavailable).toContain("Rankings could not be loaded");
  expect(unavailable).toContain('href="/leaderboard"');
  expect(unavailable).not.toContain("Not live yet");
});

test("each ranking retains its own coverage window and exact token total", () => {
  const html = renderToStaticMarkup(<LeaderboardView available snapshot={snapshot} />);
  expect(html).toContain("9,007,199,254,740,993");
  expect(html).toContain("Oct 4, 2024");
  expect(html).toContain("Sep 24, 2024");
  expect(html.match(/usage-board__coverage/g)?.length).toBe(2);
  expect(html).toContain("Reporting windows and refresh times may differ");
  expect(html).not.toContain("Provider-aware cohorts");
  expect(html).toContain("Last refreshed");
  expect(html).toContain("not independently verified or a provider billing record");
});

test("a live empty leaderboard offers explicit consent without fake rankings", () => {
  const html = renderToStaticMarkup(<LeaderboardView available snapshot={{ ...snapshot, entries: [] }} />);
  expect(html).toContain("No published entries yet");
  expect(html).toContain("Manage publishing");
  expect(html).not.toContain("<table");
});
