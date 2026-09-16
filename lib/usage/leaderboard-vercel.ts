import "server-only";
import { after } from "next/server";
import { usagePublicReadAvailable } from "./auth-server";
import { createLeaderboardTransport, type LeaderboardTransportDependencies } from "./leaderboard-transport";

/** Dormant public-platform binding for the materialized leaderboard read. No
 * session or workload token exists on this path; the public-read flag is the
 * only authority gate. Tests may inject a different availability fence. */
export function createVercelLeaderboardTransport(
  available: LeaderboardTransportDependencies["available"] = usagePublicReadAvailable,
) {
  return createLeaderboardTransport({ available,
    registerLifetime: terminal => { after(terminal); },
    fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
}
