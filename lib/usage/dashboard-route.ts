import "server-only";
import { getContext } from "@vercel/oidc";
import { after } from "next/server";
import { parseUsageAccountReply, usageAccountId } from "./account-public";
import { beginUsagePrivateReadSession, usagePrivateReadAvailable } from "./auth-server";
import { usageConsentPublicReplyFromOutcome } from "./consent-route";
import { encodeUsageConsentPublicReply } from "./consent-public";
import {
  encodeUsageDashboardFrame, parseUsageDashboardSearch, usageDashboardErrorStatus, USAGE_DASHBOARD_MEDIA, USAGE_DASHBOARD_REFRESH_MAX_MS,
  USAGE_DASHBOARD_URL, type UsageDashboardError, type UsageDashboardFramePart, type UsageDashboardQuery,
} from "./dashboard-public";
import { createUsageDashboardTransport } from "./dashboard-transport";
import { privateDaysSnapshot } from "./private-days-http-contract";
import { privateStatsEnabled } from "./stats-page";
import { statsPublicStatus } from "./stats-public";
import { statsPublicReplyFromOutcome } from "./stats-route";
import { statsTotalsPublicStatus } from "./stats-totals-public";
import { statsTotalsPublicReplyFromOutcome } from "./stats-totals-route";

/** Renew this long before the access token expires: inside the SDK's early
 * refresh window, so the browser's session check is answered with a renewal. */
export const USAGE_DASHBOARD_REFRESH_LEAD_MS = 20_000;
const encoder = new TextEncoder();
const consentStatus = { invalid_request: 400, authentication_required: 401, request_rejected: 403,
  method_not_allowed: 405, handle_unavailable: 409, publishing_full: 409, unavailable: 503 } as const;

export interface UsageDashboardRouteDependencies {
  available(): boolean;
  query(request: Request, query: UsageDashboardQuery): Promise<unknown>;
}

function send(request: Request, bytes: Uint8Array<ArrayBuffer>, status: number): Response {
  return new Response(request.method === "HEAD" ? null : bytes, { status, headers: {
    "content-type": USAGE_DASHBOARD_MEDIA, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(status === 405 ? { allow: "GET" } : {}),
  } });
}
function failure(request: Request, error: UsageDashboardError): Response {
  return send(request, encodeUsageDashboardFrame({ kind: "error", error })!, usageDashboardErrorStatus(error));
}
const time = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
  && value > 0 && value <= 8_640_000_000_000_000;

/** Map one verified outcome to framed parts. Every part must be bound to the
 * session's account; any unbound or unknown part fails the whole reply closed. */
export function usageDashboardParts(raw: unknown, query: UsageDashboardQuery): Readonly<{
  accountId: string; sessionRefreshInMs: number; parts: readonly UsageDashboardFramePart[] }> | null {
  // Exactly the requested Worker parts, no more: the account part needs no Worker read.
  const outcome = privateDaysSnapshot(raw, ["kind", "accountId", "expiresAtMs", "observedAtMs", ...query.parts.filter(part => part !== "account")]);
  if (outcome?.kind !== "query" || !usageAccountId(outcome.accountId) || !time(outcome.expiresAtMs) || !time(outcome.observedAtMs)
    || outcome.expiresAtMs <= outcome.observedAtMs) return null;
  const accountId = outcome.accountId;
  const bound = (partAccount: string | undefined) => partAccount === undefined || partAccount === accountId;
  const parts: UsageDashboardFramePart[] = [];
  for (const part of query.parts) {
    if (part === "account") {
      const reply = parseUsageAccountReply({ schemaVersion: 1, state: "ready", account: { accountId } });
      if (reply === null) return null;
      parts.push({ part, status: 200, bytes: encoder.encode(JSON.stringify(reply)) });
    } else if (part === "totals") {
      const mapped = statsTotalsPublicReplyFromOutcome(outcome.totals);
      if (!bound(mapped.accountId)) return null;
      parts.push({ part, status: statsTotalsPublicStatus(mapped.reply), bytes: encoder.encode(JSON.stringify(mapped.reply)) });
    } else if (part === "consent") {
      const mapped = usageConsentPublicReplyFromOutcome(outcome.consent);
      const bytes = encodeUsageConsentPublicReply(mapped.reply);
      if (!bound(mapped.accountId) || bytes === null) return null;
      parts.push({ part, status: "error" in mapped.reply ? consentStatus[mapped.reply.error.code] : 200, bytes });
    } else {
      if (query.range === null) return null;
      const mapped = statsPublicReplyFromOutcome(outcome.stats, query.range);
      if (!bound(mapped.accountId)) return null;
      parts.push({ part, status: statsPublicStatus(mapped.reply), bytes: encoder.encode(JSON.stringify(mapped.reply)) });
    }
  }
  const sessionRefreshInMs = Math.min(USAGE_DASHBOARD_REFRESH_MAX_MS,
    Math.max(0, outcome.expiresAtMs - outcome.observedAtMs - USAGE_DASHBOARD_REFRESH_LEAD_MS));
  return Object.freeze({ accountId, sessionRefreshInMs, parts: Object.freeze(parts) });
}

/** GET only, same origin only. The browser names parts and a range; account,
 * expiry and every Worker authority come from the one live session read. */
export function createUsageDashboardHandler(dependencies: UsageDashboardRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET") return failure(request, "method_not_allowed");
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      if (request.url.length > 256) return failure(request, "invalid_request");
      const url = new URL(request.url), origin = request.headers.get("origin");
      if (url.origin !== "https://aicharts.io" || request.headers.get("sec-fetch-site") !== "same-origin"
        || (origin !== null && origin !== "https://aicharts.io")) return failure(request, "request_rejected");
      if (request.url !== `${USAGE_DASHBOARD_URL}${url.search}` || request.headers.get("accept") !== USAGE_DASHBOARD_MEDIA
        || request.body !== null || request.headers.has("content-type") || request.headers.has("content-encoding")
        || request.headers.has("transfer-encoding") || request.headers.has("authorization")
        || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) return failure(request, "invalid_request");
      const query = parseUsageDashboardSearch(url.search);
      if (query === null) return failure(request, "invalid_request");
      const raw = await dependencies.query(request, query);
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      if (privateDaysSnapshot(raw, ["kind"])?.kind === "authentication_required") return failure(request, "authentication_required");
      const mapped = usageDashboardParts(raw, query);
      const bytes = mapped === null ? null : encodeUsageDashboardFrame({ kind: "ready", ...mapped });
      return bytes === null ? failure(request, "unavailable") : send(request, bytes, 200);
    } catch { return failure(request, "unavailable"); }
  };
}

// Construction is effect-free; flags are read anew for each actual request.
export const handleUsageDashboard = createUsageDashboardHandler({ available: usagePrivateReadAvailable,
  query: createUsageDashboardTransport({ beginSession: beginUsagePrivateReadSession, available: usagePrivateReadAvailable,
    statsAvailable: privateStatsEnabled, getContext, registerLifetime: terminal => { after(terminal); },
    fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }) });
