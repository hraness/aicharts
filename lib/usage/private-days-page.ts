import "server-only";
import { connection } from "next/server";
import { usagePrivateReadAvailable } from "./auth-server";

/** Request-time display configuration only; this never reads an account session. */
export async function usagePageConfiguration() {
  await connection();
  return { available: usagePrivateReadAvailable(), todayUtcDay: Math.floor(Date.now() / 86_400_000) };
}
