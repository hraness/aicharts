import "server-only";
import { usagePrivateReadAvailable } from "./auth-server";
import { usageAccountId, USAGE_ACCOUNT_HEADER } from "./account-public";
import { privateDaysSnapshot, type PrivateDaysRange } from "./private-days-http-contract";
import { createVercelPrivateDaysTransport } from "./private-days-vercel";
import { createPrivateDaysDiagnostic, emitPrivateDaysDiagnostic, type PrivateDaysDiagnostic, type PrivateDaysDiagnosticSink } from "./private-days-diagnostic";
import { encodePrivateDaysPublicResponse, parsePrivateDaysPublicReply, parsePrivateDaysPublicSearch, privateDaysPublicStatus,
  PRIVATE_DAYS_PUBLIC_MEDIA, PRIVATE_DAYS_PUBLIC_URL, type PrivateDaysPublicReply, type PrivateDaysPublicError } from "./private-days-public";

export { usagePrivateReadAvailable } from "./auth-server";
export interface PrivateDaysPublicDependencies {
  available(): boolean;
  query(request: Request, range: PrivateDaysRange, diagnostic?: PrivateDaysDiagnostic): Promise<unknown>;
  diagnostic?: PrivateDaysDiagnosticSink;
}
function send(request: Request, bytes: Uint8Array<ArrayBuffer>, status: number, accountId?: string): Response {
  return new Response(request.method === "HEAD" ? null : bytes, { status, headers: {
    "content-type": PRIVATE_DAYS_PUBLIC_MEDIA, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(status === 405 ? { allow: "GET" } : {}),
    ...(accountId !== undefined ? { [USAGE_ACCOUNT_HEADER]: accountId } : {}),
  } });
}
function response(request: Request, body: unknown, range?: PrivateDaysRange, accountId?: string): Response {
  const checked = parsePrivateDaysPublicReply(body, range);
  if (checked === null) return failure(request, "unavailable");
  const bytes = encodePrivateDaysPublicResponse(checked, range);
  return bytes === null ? failure(request, "unavailable") : send(request, bytes, privateDaysPublicStatus(checked), accountId);
}
function failure(request: Request, code: PrivateDaysPublicError): Response {
  const body: PrivateDaysPublicReply = { schemaVersion: 1, error: { code } };
  return send(request, new TextEncoder().encode(`{"schemaVersion":1,"error":{"code":"${code}"}}`), privateDaysPublicStatus(body));
}

/** Product-facing read boundary; caller identity comes only from the transport's
 * request-owned Accounts scope. Explicit method handling performs no auth work. */
export function createPrivateDaysPublicHandler(dependencies: PrivateDaysPublicDependencies) {
  return async (request: Request): Promise<Response> => {
    const diagnostic = createPrivateDaysDiagnostic(dependencies.diagnostic);
    const finish = (reply: Response, outcome: Parameters<PrivateDaysDiagnostic["finish"]>[0]) => {
      diagnostic.finish(outcome); return reply;
    };
    const deny = (code: PrivateDaysPublicError) => finish(failure(request, code), code);
    try {
      if (request.method !== "GET") return deny("method_not_allowed");
      diagnostic.route("aborted");
      if (request.signal.aborted) return deny("unavailable");
      diagnostic.route("configuration");
      if (dependencies.available() !== true) return deny("unavailable");
      diagnostic.route("url");
      if (request.url.length > 256) return deny("invalid_request");
      const url = new URL(request.url), origin = request.headers.get("origin");
      diagnostic.route("origin");
      if (url.origin !== "https://aicharts.io" || request.headers.get("sec-fetch-site") !== "same-origin"
        || (origin !== null && origin !== "https://aicharts.io")) return deny("request_rejected");
      diagnostic.route("framing");
      if (request.url !== `${PRIVATE_DAYS_PUBLIC_URL}${url.search}` || request.headers.get("accept") !== "application/json"
        || request.body !== null || request.headers.has("content-type") || request.headers.has("content-encoding")
        || request.headers.has("transfer-encoding") || request.headers.has("authorization")
        || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) return deny("invalid_request");
      diagnostic.route("range");
      const range = parsePrivateDaysPublicSearch(url.search);
      if (range === null) return deny("invalid_request");
      diagnostic.route("aborted");
      if (request.signal.aborted) return deny("unavailable");
      diagnostic.route("configuration");
      if (dependencies.available() !== true) return deny("unavailable");
      diagnostic.route("query");
      const raw = await dependencies.query(request, range, diagnostic);
      diagnostic.closeTransport(); diagnostic.route("post_query");
      if (request.signal.aborted || dependencies.available() !== true) return deny("unavailable");
      const negative = privateDaysSnapshot(raw, ["kind"]);
      if (negative?.kind === "authentication_required") return deny("authentication_required");
      const query = privateDaysSnapshot(raw, ["kind", "accountId", "result"]);
      if (query?.kind !== "query" || !usageAccountId(query.accountId)) return deny("unavailable");
      diagnostic.route("projection");
      const success = privateDaysSnapshot(query.result, ["ok", "value"]);
      if (success?.ok === true) {
        const reply = response(request, { schemaVersion: 1, state: "ready", value: success.value }, range, query.accountId);
        return finish(reply, reply.status === 200 ? "ready" : "unavailable");
      }
      const absent = privateDaysSnapshot(query.result, ["ok", "error"]);
      return absent?.ok === false && absent.error === "not_enrolled"
        ? finish(response(request, { schemaVersion: 1, state: "not_enrolled" }, undefined, query.accountId), "not_enrolled") : deny("unavailable");
    } catch { diagnostic.route("exception"); return deny("unavailable"); }
  };
}

// Construction is effect-free; flags are read anew for each actual request.
export const handleUsagePrivateDays = createPrivateDaysPublicHandler({ available: usagePrivateReadAvailable,
  query: createVercelPrivateDaysTransport(), diagnostic: emitPrivateDaysDiagnostic });
