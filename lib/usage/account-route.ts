import "server-only";
import { after } from "next/server";
import { beginUsagePrivateReadSession, usagePrivateReadAvailable } from "./auth-server";
import { createUsageAccountTransport } from "./account-transport";
import { parseUsageAccountReply, usageAccountStatus, USAGE_ACCOUNT_MEDIA, USAGE_ACCOUNT_URL, type UsageAccountError, type UsageAccountReply } from "./account-public";

export function createUsageAccountHandler(dependencies: { available(): boolean; read(request: Request): Promise<unknown> }) {
  return async (request: Request): Promise<Response> => {
    const send = (reply: UsageAccountReply) => {
      const status = usageAccountStatus(reply);
      return new Response(request.method === "HEAD" ? null : JSON.stringify(reply), { status, headers: {
        "content-type": USAGE_ACCOUNT_MEDIA, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
        "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
        ...(status === 405 ? { allow: "GET" } : {}),
      } });
    };
    const fail = (code: UsageAccountError) => send({ schemaVersion: 1, error: { code } });
    try {
      if (request.method !== "GET") return fail("method_not_allowed");
      if (request.signal.aborted || !dependencies.available()) return fail("unavailable");
      if (request.url.length > 256) return fail("invalid_request");
      const url = new URL(request.url), origin = request.headers.get("origin");
      if (url.origin !== "https://aicharts.io" || request.headers.get("sec-fetch-site") !== "same-origin"
        || (origin !== null && origin !== "https://aicharts.io")) return fail("request_rejected");
      if (request.url !== USAGE_ACCOUNT_URL || request.headers.get("accept") !== "application/json"
        || request.body !== null || request.headers.has("content-type") || request.headers.has("content-encoding")
        || request.headers.has("transfer-encoding") || request.headers.has("authorization")
        || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) return fail("invalid_request");
      const result = await dependencies.read(request);
      if (request.signal.aborted || !dependencies.available()) return fail("unavailable");
      const checked = parseUsageAccountReply(result);
      return checked === null ? fail("unavailable") : send(checked);
    } catch { return fail("unavailable"); }
  };
}
const read = createUsageAccountTransport({ available: usagePrivateReadAvailable, beginSession: beginUsagePrivateReadSession,
  registerLifetime: terminal => { after(terminal); }, now: Date.now,
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
export const handleUsageAccount = createUsageAccountHandler({ available: usagePrivateReadAvailable, read });
