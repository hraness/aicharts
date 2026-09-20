import "server-only";
import { usagePrivateReadAvailable } from "./auth-server";

/** Additive v2 reads require their own qualification as well as private auth. */
export function privateStatsEnabled(): boolean {
  return usagePrivateReadAvailable() && process.env.AICHARTS_USAGE_STATS_ENABLED === "1";
}
