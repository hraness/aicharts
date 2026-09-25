import "server-only";
import { privateDaysSnapshot } from "./private-days-http-contract";
import { usageAccountId } from "./account-public";
import { privateStatsEnabled } from "./stats-page";
import { createVercelStatsTotalsTransport } from "./stats-totals-vercel";
import { parseStatsTotalsPublicReply, statsTotalsPublicStatus, STATS_TOTALS_ACCOUNT_HEADER, STATS_TOTALS_PUBLIC_MEDIA, STATS_TOTALS_PUBLIC_URL,
  type StatsTotalsPublicError, type StatsTotalsPublicReply } from "./stats-totals-public";

export interface StatsTotalsPublicDependencies {
  available(): boolean;
  query(request: Request): Promise<unknown>;
}
function send(request: Request, reply: StatsTotalsPublicReply, accountId?: string): Response {
  const status = statsTotalsPublicStatus(reply);
  return new Response(request.method === "HEAD" ? null : JSON.stringify(reply), { status, headers: {
    "content-type": STATS_TOTALS_PUBLIC_MEDIA, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(status === 405 ? { allow: "GET" } : {}),
    ...(accountId !== undefined ? { [STATS_TOTALS_ACCOUNT_HEADER]: accountId } : {}),
  } });
}
const failure = (request: Request, error: StatsTotalsPublicError, accountId?: string) => send(request, { schemaVersion: 2, ok: false, error }, accountId);

/** GET only, same origin only, no product input: the account comes from the
 * live session on the server, never from the browser. */
export function createStatsTotalsPublicHandler(dependencies: StatsTotalsPublicDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET") return failure(request, "method_not_allowed");
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      if (request.url.length > 256) return failure(request, "invalid_request");
      const url = new URL(request.url), origin = request.headers.get("origin");
      if (url.origin !== "https://aicharts.io" || request.headers.get("sec-fetch-site") !== "same-origin"
        || (origin !== null && origin !== "https://aicharts.io")) return failure(request, "request_rejected");
      if (request.url !== STATS_TOTALS_PUBLIC_URL || request.headers.get("accept") !== "application/json"
        || request.body !== null || request.headers.has("content-type") || request.headers.has("content-encoding")
        || request.headers.has("transfer-encoding") || request.headers.has("authorization")
        || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) return failure(request, "invalid_request");
      const raw = await dependencies.query(request);
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      const negative = privateDaysSnapshot(raw, ["kind"]);
      if (negative?.kind === "authentication_required") return failure(request, "authentication_required");
      const query = privateDaysSnapshot(raw, ["kind", "accountId", "result"]);
      if (query?.kind !== "query" || !usageAccountId(query.accountId)) return failure(request, "unavailable");
      const success = privateDaysSnapshot(query.result, ["ok", "value"]);
      if (success?.ok === true) {
        const reply = parseStatsTotalsPublicReply({ schemaVersion: 2, ok: true, value: success.value });
        return reply === null ? failure(request, "unavailable") : send(request, reply, query.accountId);
      }
      const absent = privateDaysSnapshot(query.result, ["ok", "error"]);
      return absent?.ok === false && absent.error === "not_enrolled" ? failure(request, "not_enrolled", query.accountId) : failure(request, "unavailable");
    } catch { return failure(request, "unavailable"); }
  };
}
export const handleUsageTotals = createStatsTotalsPublicHandler({ available: privateStatsEnabled, query: createVercelStatsTotalsTransport() });
