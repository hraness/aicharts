import { STATS_HTTP_URL, STATS_UPLOAD_URL, STATS_STATUS_URL, STATS_ABANDON_URL } from "../../../lib/usage/stats-http-contract";
import { STATS_TOTALS_URL } from "../../../lib/usage/stats-totals-contract";
import { createStatsHttpHandler, createStatsTotalsHttpHandler, createStatsUploadHttpHandler, type StatsHttpEnvironment, type StatsUploadHttpEnvironment } from "./stats-http";
import { contributionHttpCap } from "../../../lib/usage/contributions-http-contract";
import { createContributionHttpHandler, type ContributionHttpEnvironment } from "./contributions-http";
import { CONTRIBUTION_QUERY_URL } from "../../../lib/usage/contribution-query";
import { createContributionQueryHttpHandler, type ContributionQueryHttpEnvironment } from "./contribution-query-http";
import { createUsageOidcVerifier, type VerifierDependencies } from "../../../lib/usage/oidc/usage-oidc-verifier";
import { PAIRING_HTTP_URL } from "../../../lib/usage/pairing-http-contract";
import { PRIVATE_DAYS_HTTP_URL } from "../../../lib/usage/private-days-http-contract";
import { USAGE_CONSENT_HTTP_URL } from "../../../lib/usage/consent-http-contract";
import { LEADERBOARD_HTTP_URL } from "../../../lib/usage/leaderboard-http-contract";
import { TERMINAL_ENROLLMENT_URL } from "../../../lib/usage/terminal-enrollment-contract";
import { createPairingHttpHandler, type PairingHttpEnvironment, type PairingHttpRequestLifetime } from "./pairing-http";
import { createTerminalEnrollmentHttpHandler, type TerminalEnrollmentHttpEnvironment } from "./terminal-enrollment-http";
import { ADMISSION_HTTP_URL, createAdmissionHttpHandler, type AdmissionHttpEnvironment } from "./admission-http";
import { createPrivateDaysHttpHandler, type PrivateDaysHttpEnvironment } from "./private-days-http";
import { createConsentHttpHandler, type ConsentHttpEnvironment } from "./consent-http";
import { createLeaderboardHttpHandler, type LeaderboardHttpEnvironment } from "./leaderboard-http";
import type { PairingHttpVerifier } from "./pairing-http";
import { usageFailure } from "./usage-failure";

export type ProductionEnvironment = Env & {
  readonly AICHARTS_USAGE_WORKER_ENABLED?: unknown;
  readonly AICHARTS_USAGE_ENROLLMENT_ENABLED?: unknown;
  readonly AICHARTS_USAGE_ADMISSION_ENABLED?: unknown;
  readonly AICHARTS_USAGE_AUTH_ENABLED?: unknown;
  readonly AICHARTS_USAGE_PAIRING_ENABLED?: unknown;
  readonly AICHARTS_USAGE_PRIVATE_READ_ENABLED?: unknown;
  readonly AICHARTS_USAGE_PUBLIC_READ_ENABLED?: unknown;
  readonly AICHARTS_USAGE_STATS_ENABLED?: unknown;
  readonly AICHARTS_USAGE_CONTRIBUTIONS_ENABLED?: unknown;
};
type Lifetime = PairingHttpRequestLifetime;
type Handler<E> = (request: Request, env: E, ctx: Lifetime) => Promise<Response>;
export interface ProductionRouterOptions {
  readonly effects?: VerifierDependencies;
  readonly verifier?: PairingHttpVerifier;
  readonly handlers?: Partial<{
    pairing: Handler<PairingHttpEnvironment>;
    terminal: Handler<TerminalEnrollmentHttpEnvironment>;
    admission: Handler<AdmissionHttpEnvironment>;
    privateDays: Handler<PrivateDaysHttpEnvironment>;
    consent: Handler<ConsentHttpEnvironment>;
    leaderboard: Handler<LeaderboardHttpEnvironment>;
    stats: Handler<StatsHttpEnvironment>;
    statsUpload: Handler<StatsUploadHttpEnvironment>;
    statsTotals: Handler<StatsHttpEnvironment>;
    contributions: Handler<ContributionHttpEnvironment>;
    contributionQuery: Handler<ContributionQueryHttpEnvironment>;
  }>;
}

export function unavailable(): Response {
  return new Response('{"error":"usage_service_unavailable"}', { status: 503, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
  } });
}
const enabled = (value: unknown): boolean => value === "1";
const flagReady = (env: ProductionEnvironment, name: keyof ProductionEnvironment): boolean => {
  try { return enabled(env[name]); } catch { return false; }
};
const generationReady = (env: ProductionEnvironment): boolean => {
  try {
    const generation = env.USAGE_ENROLLMENT_GENERATION;
    return typeof generation === "string" && /^[0-9a-f]{64}$/u.test(generation) && !/^0+$/.test(generation);
  } catch { return false; }
};
const bindingReady = (env: ProductionEnvironment, names: readonly string[]): boolean => names.every(name => {
  try {
    const value = env[name as keyof ProductionEnvironment];
    if (value === undefined || value === null) return false;
    if (name === "PAIRINGS" || name === "ACCOUNT_ENROLLMENTS" || name === "PUBLIC_INDEX") {
      return typeof (value as { getByName?: unknown }).getByName === "function";
    }
    return ["list", "head", "get", "put", "delete"].every(method =>
      typeof (value as Record<string, unknown>)[method] === "function");
  } catch { return false; }
});

/**
 * Compose the production-shaped routes once per isolate. The master and
 * per-route fences are intentionally exact string values; every other state
 * remains the fixed private 503. Construction performs no network request.
 */
export function createProductionRouter(options: ProductionRouterOptions = {}) {
  const effects = options.effects ?? Object.freeze<VerifierDependencies>({
    fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  const verifier = options.verifier ?? createUsageOidcVerifier(effects);
  const handlers = {
    pairing: options.handlers?.pairing ?? createPairingHttpHandler({ ...effects, verifier }),
    terminal: options.handlers?.terminal ?? createTerminalEnrollmentHttpHandler(effects),
    admission: options.handlers?.admission ?? createAdmissionHttpHandler(effects),
    privateDays: options.handlers?.privateDays ?? createPrivateDaysHttpHandler({ ...effects, verifier }),
    consent: options.handlers?.consent ?? createConsentHttpHandler({ ...effects, verifier }),
    leaderboard: options.handlers?.leaderboard ?? createLeaderboardHttpHandler(effects),
    stats: options.handlers?.stats ?? createStatsHttpHandler({ ...effects, verifier }),
    statsUpload: options.handlers?.statsUpload ?? createStatsUploadHttpHandler(effects),
    statsTotals: options.handlers?.statsTotals ?? createStatsTotalsHttpHandler({ ...effects, verifier }),
    contributions: options.handlers?.contributions ?? createContributionHttpHandler(effects),
    contributionQuery: options.handlers?.contributionQuery ?? createContributionQueryHttpHandler({ ...effects, verifier }),
  };
  return async (request: Request, env: ProductionEnvironment, ctx: Lifetime): Promise<Response> => {
    let path: "pairing" | "terminal" | "admission" | "privateDays" | "consent" | "leaderboard" | "stats" | "statsUpload" | "statsTotals" | "contributions" | "contributionQuery" | null = null;
    if (request.url === STATS_HTTP_URL) path = "stats";
    else if (request.url === STATS_TOTALS_URL) path = "statsTotals";
    else if (request.url === STATS_UPLOAD_URL || request.url === STATS_STATUS_URL || request.url === STATS_ABANDON_URL) path = "statsUpload";
    else if (contributionHttpCap(request.url) !== null) path = "contributions";
    else if (request.url === CONTRIBUTION_QUERY_URL) path = "contributionQuery";
    else if (request.url === PAIRING_HTTP_URL) path = "pairing";
    else if (request.url === PRIVATE_DAYS_HTTP_URL) path = "privateDays";
    else if (request.url === TERMINAL_ENROLLMENT_URL) path = "terminal";
    else if (request.url === ADMISSION_HTTP_URL) path = "admission";
    else if (request.url === USAGE_CONSENT_HTTP_URL) path = "consent";
    else if (request.url === LEADERBOARD_HTTP_URL) path = "leaderboard";
    if (path === null || !flagReady(env, "AICHARTS_USAGE_WORKER_ENABLED") || !generationReady(env)) return unavailable();
    const required = path === "pairing" ? ["PAIRINGS"]
      : path === "terminal" ? ["PAIRINGS", "ACCOUNT_ENROLLMENTS"]
      : path === "admission" || path === "statsUpload" || path === "contributions" || path === "contributionQuery" ? ["ACCOUNT_ENROLLMENTS", "STAGING", "CONTROL"]
      : path === "consent" ? ["ACCOUNT_ENROLLMENTS", "PUBLIC_INDEX"]
      : path === "leaderboard" ? ["PUBLIC_INDEX", "ACCOUNT_ENROLLMENTS"]
      : ["ACCOUNT_ENROLLMENTS", "CONTROL"];
    if (!bindingReady(env, required)) return unavailable();
    if (path === "contributionQuery") {
      if (!flagReady(env, "AICHARTS_USAGE_STATS_ENABLED") || !flagReady(env, "AICHARTS_USAGE_CONTRIBUTIONS_ENABLED")
        || !flagReady(env, "AICHARTS_USAGE_AUTH_ENABLED") || !flagReady(env, "AICHARTS_USAGE_PRIVATE_READ_ENABLED")) return unavailable();
      try { return await handlers.contributionQuery(request, env, ctx); } catch { return unavailable(); }
    }
    if (path === "contributions") {
      if (!flagReady(env, "AICHARTS_USAGE_STATS_ENABLED") || !flagReady(env, "AICHARTS_USAGE_CONTRIBUTIONS_ENABLED")
        || !flagReady(env, "AICHARTS_USAGE_ADMISSION_ENABLED")) return unavailable();
      try { return await handlers.contributions(request, env, ctx); } catch { return unavailable(); }
    }
    if (path === "stats" || path === "statsTotals" || path === "statsUpload") {
      if (!flagReady(env, "AICHARTS_USAGE_STATS_ENABLED") || (path !== "statsUpload"
        ? !flagReady(env, "AICHARTS_USAGE_AUTH_ENABLED") || !flagReady(env, "AICHARTS_USAGE_PRIVATE_READ_ENABLED")
        : !flagReady(env, "AICHARTS_USAGE_ADMISSION_ENABLED"))) return unavailable();
      try {
        return path === "stats" ? await handlers.stats(request, env, ctx)
          : path === "statsTotals" ? await handlers.statsTotals(request, env, ctx) : await handlers.statsUpload(request, env, ctx);
      } catch { return unavailable(); }
    }
    if (path === "pairing") {
      if (!flagReady(env, "AICHARTS_USAGE_AUTH_ENABLED") || !flagReady(env, "AICHARTS_USAGE_PAIRING_ENABLED")) return unavailable();
      try { return await handlers.pairing(request, env, ctx); } catch { return unavailable(); }
    }
    if (path === "privateDays") {
      if (!flagReady(env, "AICHARTS_USAGE_AUTH_ENABLED") || !flagReady(env, "AICHARTS_USAGE_PRIVATE_READ_ENABLED")) return unavailable();
      try { return await handlers.privateDays(request, env, ctx); } catch { return usageFailure("router_exception"); }
    }
    if (path === "consent") {
      // The consent write stays fenced by the private-read qualification:
      // authentication plus private reads must both be enabled.
      if (!flagReady(env, "AICHARTS_USAGE_AUTH_ENABLED") || !flagReady(env, "AICHARTS_USAGE_PRIVATE_READ_ENABLED")) return unavailable();
      try { return await handlers.consent(request, env, ctx); } catch { return usageFailure("router_exception"); }
    }
    if (path === "leaderboard") {
      // The anonymous public read is gated by its own distinct flag; it never
      // inherits activation from private collection or consent writes.
      if (!flagReady(env, "AICHARTS_USAGE_PUBLIC_READ_ENABLED")) return unavailable();
      try { return await handlers.leaderboard(request, env, ctx); } catch { return unavailable(); }
    }
    if (path === "terminal") {
      if (!flagReady(env, "AICHARTS_USAGE_ENROLLMENT_ENABLED")) return unavailable();
      try { return await handlers.terminal(request, env, ctx); } catch { return unavailable(); }
    }
    if (!flagReady(env, "AICHARTS_USAGE_ADMISSION_ENABLED")) return unavailable();
    try { return await handlers.admission(request, env, ctx); } catch { return unavailable(); }
  };
}

export const productionRouter = createProductionRouter();
