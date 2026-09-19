import "server-only";
import { usagePublicReadAvailable } from "./auth-server";
import { privateDaysSnapshot } from "./private-days-http-contract";
import { createVercelLeaderboardTransport } from "./leaderboard-vercel";
import { encodeLeaderboardPublicReply, LEADERBOARD_PUBLIC_MEDIA, LEADERBOARD_PUBLIC_URL,
  type LeaderboardPublicError, type LeaderboardPublicReply } from "./leaderboard-public";

export { usagePublicReadAvailable } from "./auth-server";
export interface LeaderboardPublicDependencies {
  available(): boolean;
  read(request: Request): Promise<unknown>;
}
const status = Object.freeze({ invalid_request: 400, request_rejected: 403, method_not_allowed: 405, unavailable: 503 } as const);
function send(request: Request, bytes: Uint8Array<ArrayBuffer>, code?: LeaderboardPublicError): Response {
  return new Response(request.method === "HEAD" ? null : bytes, { status: code === undefined ? 200 : status[code], headers: {
    "content-type": LEADERBOARD_PUBLIC_MEDIA,
    // Public anonymous data: a short shared cache is correct here, unlike the
    // private usage routes which must stay no-store.
    "cache-control": code === undefined ? "public, max-age=60" : "private, no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(code === "method_not_allowed" ? { allow: "GET" } : {}),
  } });
}
function failure(request: Request, code: LeaderboardPublicError): Response {
  return send(request, new TextEncoder().encode(`{"schemaVersion":1,"error":{"code":"${code}"}}`), code);
}
function ready(request: Request, value: unknown): Response {
  const reply: LeaderboardPublicReply = { schemaVersion: 1, state: "ready", value: value as never };
  const bytes = encodeLeaderboardPublicReply(reply);
  return bytes === null ? failure(request, "unavailable") : send(request, bytes);
}

/** Public read boundary. The route is deliberately unauthenticated; the only
 * body it can ever emit is the materialized snapshot from the public index. */
export function createLeaderboardPublicHandler(dependencies: LeaderboardPublicDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET") return failure(request, "method_not_allowed");
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      if (request.url.length > 256) return failure(request, "invalid_request");
      const url = new URL(request.url);
      if (url.origin !== "https://aicharts.io") return failure(request, "request_rejected");
      if (request.url !== LEADERBOARD_PUBLIC_URL || request.headers.get("accept") !== "application/json"
        || request.body !== null || request.headers.has("content-type") || request.headers.has("content-encoding")
        || request.headers.has("transfer-encoding") || request.headers.has("authorization")
        || request.headers.has("cookie")
        || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) return failure(request, "invalid_request");
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      const raw = await dependencies.read(request);
      if (request.signal.aborted || dependencies.available() !== true) return failure(request, "unavailable");
      const outcome = privateDaysSnapshot(raw, ["kind", "value"]);
      if (outcome?.kind !== "ready") return failure(request, "unavailable");
      return ready(request, outcome.value);
    } catch { return failure(request, "unavailable"); }
  };
}

// Construction is effect-free; flags are read anew for each actual request.
export const handleUsageLeaderboard = createLeaderboardPublicHandler({
  available: usagePublicReadAvailable, read: createVercelLeaderboardTransport() });
