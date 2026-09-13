import "server-only";
import { usagePrivateReadAvailable } from "./auth-server";
import { privateDaysSnapshot, type PrivateDaysRange } from "./private-days-http-contract";
import { createVercelPrivateDaysTransport } from "./private-days-vercel";
import { encodePrivateDaysPublicResponse, parsePrivateDaysPublicReply, parsePrivateDaysPublicSearch, privateDaysPublicStatus,
  PRIVATE_DAYS_PUBLIC_MEDIA, PRIVATE_DAYS_PUBLIC_URL, type PrivateDaysPublicReply, type PrivateDaysPublicError } from "./private-days-public";

export { usagePrivateReadAvailable } from "./auth-server";
export interface PrivateDaysPublicDependencies {
  available(): boolean;
  query(request: Request, range: PrivateDaysRange): Promise<unknown>;
}
function send(request: Request, bytes: Uint8Array<ArrayBuffer>, status: number): Response {
  return new Response(request.method === "HEAD" ? null : bytes, { status, headers: {
    "content-type": PRIVATE_DAYS_PUBLIC_MEDIA, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(status === 405 ? { allow: "GET" } : {}),
  } });
}
function response(request: Request, body: unknown, range?: PrivateDaysRange): Response {
  const checked = parsePrivateDaysPublicReply(body, range);
  if (checked === null) return failure(request, "unavailable");
  const bytes = encodePrivateDaysPublicResponse(checked, range);
  return bytes === null ? failure(request, "unavailable") : send(request, bytes, privateDaysPublicStatus(checked));
}
function failure(request: Request, code: PrivateDaysPublicError): Response {
  const body: PrivateDaysPublicReply = { schemaVersion: 1, error: { code } };
  return send(request, new TextEncoder().encode(`{"schemaVersion":1,"error":{"code":"${code}"}}`), privateDaysPublicStatus(body));
}

/** Product-facing read boundary; caller identity comes only from the transport's
 * request-owned Accounts scope. Explicit method handling performs no auth work. */
export function createPrivateDaysPublicHandler(dependencies: PrivateDaysPublicDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET") return failure(request, "method_not_allowed");
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      if (request.url.length > 256) return failure(request, "invalid_request");
      const url = new URL(request.url), origin = request.headers.get("origin");
      if (url.origin !== "https://aicharts.io" || request.headers.get("sec-fetch-site") !== "same-origin"
        || (origin !== null && origin !== "https://aicharts.io")) return failure(request, "request_rejected");
      if (request.url !== `${PRIVATE_DAYS_PUBLIC_URL}${url.search}` || request.headers.get("accept") !== "application/json"
        || request.body !== null || request.headers.has("content-type") || request.headers.has("content-encoding")
        || request.headers.has("transfer-encoding") || request.headers.has("authorization")
        || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) return failure(request, "invalid_request");
      const range = parsePrivateDaysPublicSearch(url.search);
      if (range === null) return failure(request, "invalid_request");
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      const raw = await dependencies.query(request, range);
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      const negative = privateDaysSnapshot(raw, ["kind"]);
      if (negative?.kind === "authentication_required") return failure(request, "authentication_required");
      const query = privateDaysSnapshot(raw, ["kind", "result"]);
      if (query?.kind !== "query") return failure(request, "unavailable");
      const success = privateDaysSnapshot(query.result, ["ok", "value"]);
      if (success?.ok === true) return response(request, { schemaVersion: 1, state: "ready", value: success.value }, range);
      const absent = privateDaysSnapshot(query.result, ["ok", "error"]);
      return absent?.ok === false && absent.error === "not_enrolled"
        ? response(request, { schemaVersion: 1, state: "not_enrolled" }) : failure(request, "unavailable");
    } catch { return failure(request, "unavailable"); }
  };
}

// Construction is effect-free; flags are read anew for each actual request.
export const handleUsagePrivateDays = createPrivateDaysPublicHandler({ available: usagePrivateReadAvailable, query: createVercelPrivateDaysTransport() });
