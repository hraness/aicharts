import "server-only";
import { privateDaysSnapshot } from "./private-days-http-contract";
import { usageAccountId } from "./account-public";
import type { StatsRange } from "./stats-http-contract";
import { privateStatsEnabled } from "./stats-page";
import { createVercelStatsTransport } from "./stats-vercel";
import { parseStatsPublicReply, parseStatsPublicSearch, statsPublicStatus, STATS_ACCOUNT_HEADER, STATS_PUBLIC_MEDIA, STATS_PUBLIC_URL, type StatsPublicError, type StatsPublicReply } from "./stats-public";

export interface StatsPublicDependencies {
  available(): boolean;
  query(request: Request, range: StatsRange): Promise<unknown>;
}
function send(request: Request, reply: StatsPublicReply, accountId?: string): Response {
  const status = statsPublicStatus(reply);
  return new Response(request.method === "HEAD" ? null : JSON.stringify(reply), { status, headers: {
    "content-type": STATS_PUBLIC_MEDIA, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(status === 405 ? { allow: "GET" } : {}),
    ...(accountId !== undefined ? { [STATS_ACCOUNT_HEADER]: accountId } : {}),
  } });
}
const failure = (request: Request, error: StatsPublicError, accountId?: string) => send(request, { schemaVersion: 2, ok: false, error }, accountId);

/** The one mapping from a transport outcome to the public reply and its bound account. */
export function statsPublicReplyFromOutcome(raw: unknown, range: StatsRange): Readonly<{ reply: StatsPublicReply; accountId?: string }> {
  const fail = (error: StatsPublicError, accountId?: string) => Object.freeze({ reply: Object.freeze({ schemaVersion: 2, ok: false, error } as const),
    ...(accountId === undefined ? {} : { accountId }) });
  const negative = privateDaysSnapshot(raw, ["kind"]);
  if (negative?.kind === "authentication_required") return fail("authentication_required");
  const query = privateDaysSnapshot(raw, ["kind", "accountId", "result"]);
  if (query?.kind !== "query" || !usageAccountId(query.accountId)) return fail("unavailable");
  const success = privateDaysSnapshot(query.result, ["ok", "value"]);
  if (success?.ok === true) {
    const reply = parseStatsPublicReply({ schemaVersion: 2, ok: true, value: success.value }, range);
    return reply === null ? fail("unavailable") : Object.freeze({ reply, accountId: query.accountId });
  }
  const absent = privateDaysSnapshot(query.result, ["ok", "error"]);
  if (absent?.ok === false && absent.error === "limit") return fail("range_too_large", query.accountId);
  return absent?.ok === false && (absent.error === "not_enrolled" || absent.error === "not_started")
    ? fail(absent.error, query.accountId) : fail("unavailable");
}

export function createStatsPublicHandler(dependencies: StatsPublicDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET") return failure(request, "method_not_allowed");
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      if (request.url.length > 256) return failure(request, "invalid_request");
      const url = new URL(request.url), origin = request.headers.get("origin");
      if (url.origin !== "https://aicharts.io" || request.headers.get("sec-fetch-site") !== "same-origin"
        || (origin !== null && origin !== "https://aicharts.io")) return failure(request, "request_rejected");
      if (request.url !== `${STATS_PUBLIC_URL}${url.search}` || request.headers.get("accept") !== "application/json"
        || request.body !== null || request.headers.has("content-type") || request.headers.has("content-encoding")
        || request.headers.has("transfer-encoding") || request.headers.has("authorization")
        || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) return failure(request, "invalid_request");
      const range = parseStatsPublicSearch(url.search);
      if (range === null) return failure(request, "invalid_request");
      const raw = await dependencies.query(request, range);
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      const mapped = statsPublicReplyFromOutcome(raw, range);
      return send(request, mapped.reply, mapped.accountId);
    } catch { return failure(request, "unavailable"); }
  };
}
export const handleUsageStats = createStatsPublicHandler({ available: privateStatsEnabled, query: createVercelStatsTransport() });
