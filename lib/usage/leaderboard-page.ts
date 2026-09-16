import "server-only";
import { connection } from "next/server";
import { usagePublicReadAvailable } from "./auth-server";
import { createVercelLeaderboardTransport } from "./leaderboard-vercel";
import type { LeaderboardSnapshotV1 } from "./leaderboard-contract";

/** Request-time display configuration only; the public flag decides whether
 * the page reads the materialized index at all. */
export async function leaderboardPageConfiguration() {
  await connection();
  return { available: usagePublicReadAvailable() };
}

/** Server-side materialized read for the page. Returns `null` whenever the
 * flag is off or the index cannot answer; the page renders honest paused and
 * empty states instead of fabricating rows. */
export async function readLeaderboardSnapshot(): Promise<LeaderboardSnapshotV1 | null> {
  try {
    if (usagePublicReadAvailable() !== true) return null;
    const transport = createVercelLeaderboardTransport();
    const outcome = await transport(new Request("https://aicharts.io/api/leaderboard"));
    return outcome.kind === "ready" ? outcome.value : null;
  } catch { return null; }
}
