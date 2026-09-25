import "server-only";
import { getContext } from "@vercel/oidc";
import { after } from "next/server";
import { beginUsagePrivateReadSession } from "./auth-server";
import { privateStatsEnabled } from "./stats-page";
import type { StatsTransportDependencies } from "./stats-transport";
import { createStatsTotalsTransport } from "./stats-totals-transport";

/** Same platform binding as the windowed report: request-owned workload
 * token, live Accounts scope, closed while stats or private reads are off. */
export function createVercelStatsTotalsTransport(
  beginSession: StatsTransportDependencies["beginSession"] = beginUsagePrivateReadSession,
  available: StatsTransportDependencies["available"] = privateStatsEnabled,
) {
  return createStatsTotalsTransport({ beginSession, available, getContext,
    registerLifetime: terminal => { after(terminal); },
    fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
}
