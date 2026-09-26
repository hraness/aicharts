import "server-only";
import { connection } from "next/server";
import { usagePublicReadAvailable } from "./auth-server";
import { createVercelLeaderboardTransport } from "./leaderboard-vercel";
import type { LeaderboardSnapshotV1 } from "./leaderboard-contract";
import type { LeaderboardTransportOutcome } from "./leaderboard-transport";

/** Request-time display configuration only; the public flag decides whether
 * the page reads the materialized index at all. */
export async function leaderboardPageConfiguration() {
  await connection();
  return { available: usagePublicReadAvailable() };
}

/** The page answers within this budget. The transport's own 35 s ceiling
 * suits the API route; a page visitor should see the unavailable state and a
 * reload link long before that. */
export const LEADERBOARD_PAGE_DEADLINE_MS = 8_000;

/** Server-side materialized read for the page. Returns `null` whenever the
 * flag is off, the index cannot answer, or the page deadline passes; the page
 * renders honest paused and empty states instead of fabricating rows. */
export async function readLeaderboardSnapshot({
  available = usagePublicReadAvailable,
  transport = createVercelLeaderboardTransport,
  deadlineMs = LEADERBOARD_PAGE_DEADLINE_MS,
}: Readonly<{
  available?: () => boolean;
  transport?: () => (request: Request) => Promise<LeaderboardTransportOutcome>;
  deadlineMs?: number;
}> = {}): Promise<LeaderboardSnapshotV1 | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (available() !== true) return null;
    const expired = new Promise<null>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, deadlineMs);
    });
    const read = transport()(new Request("https://aicharts.io/api/leaderboard", { signal: controller.signal }))
      .then(outcome => outcome.kind === "ready" ? outcome.value : null, () => null);
    return await Promise.race([read, expired]);
  } catch { return null; } finally { clearTimeout(timer); }
}
