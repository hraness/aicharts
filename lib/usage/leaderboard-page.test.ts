import { expect, mock, test } from "bun:test";
import type { LeaderboardSnapshotV1 } from "./leaderboard-contract";
import type { LeaderboardTransportOutcome } from "./leaderboard-transport";

// Next enforces this import boundary in the application build.
mock.module("server-only", () => ({}));
const { readLeaderboardSnapshot } = await import("./leaderboard-page");

// The page only forwards the checked value; its shape is the transport's concern.
const snapshot = Object.freeze({ synthetic: true }) as unknown as LeaderboardSnapshotV1;
const answer = (outcome: LeaderboardTransportOutcome | Promise<LeaderboardTransportOutcome>) => () => () => Promise.resolve(outcome);

test("a ready transport outcome is the page snapshot", async () => {
  expect(await readLeaderboardSnapshot({ available: () => true, transport: answer({ kind: "ready", value: snapshot }) })).toBe(snapshot);
});

test("an unavailable outcome, a rejection, or a closed flag renders no rows", async () => {
  expect(await readLeaderboardSnapshot({ available: () => true, transport: answer({ kind: "unavailable" }) })).toBeNull();
  expect(await readLeaderboardSnapshot({ available: () => true, transport: () => () => Promise.reject(new Error("synthetic")) })).toBeNull();
  let dispatched = 0;
  expect(await readLeaderboardSnapshot({ available: () => false, transport: () => () => { dispatched++; return Promise.resolve({ kind: "ready", value: snapshot }); } })).toBeNull();
  expect(dispatched).toBe(0);
});

test("a stalled read yields to the page deadline and aborts its request", async () => {
  let seen: Request | undefined;
  const started = Date.now();
  const reply = await readLeaderboardSnapshot({ available: () => true, deadlineMs: 20,
    transport: () => request => { seen = request; return new Promise<LeaderboardTransportOutcome>(() => {}); } });
  expect(reply).toBeNull();
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(seen?.signal.aborted).toBe(true);
});
