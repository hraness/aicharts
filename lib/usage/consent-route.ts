import "server-only";
import { after } from "next/server";
import { usagePrivateReadAvailable } from "./auth-server";
import { privateDaysSnapshot, privateDaysHttpLength } from "./private-days-http-contract";
import { pairingHttpBody, PAIRING_HTTP_CLIENT_MS } from "./pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";
import { createVercelUsageConsentTransport } from "./consent-vercel";
import { decodeUsageConsentDecision, encodeUsageConsentPublicReply, parseUsageConsentPublicReply,
  USAGE_CONSENT_PUBLIC_MEDIA, USAGE_CONSENT_PUBLIC_REQUEST_BYTES, USAGE_CONSENT_PUBLIC_URL,
  type UsageConsentPublicError, type UsageConsentPublicReply } from "./consent-public";
import type { UsageConsentOperationInput } from "./consent-transport";

export { usagePrivateReadAvailable } from "./auth-server";
export interface UsageConsentRouteDependencies extends PairingHttpEffects {
  available(): boolean;
  query(request: Request, input: UsageConsentOperationInput): Promise<unknown>;
  registerLifetime(terminal: Promise<void>): void;
}
const status = Object.freeze({ invalid_request: 400, authentication_required: 401, request_rejected: 403,
  method_not_allowed: 405, unavailable: 503 } as const);
function send(request: Request, bytes: Uint8Array<ArrayBuffer>, code?: UsageConsentPublicError): Response {
  return new Response(request.method === "HEAD" ? null : bytes, { status: code === undefined ? 200 : status[code], headers: {
    "content-type": USAGE_CONSENT_PUBLIC_MEDIA, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(code === "method_not_allowed" ? { allow: "GET, POST" } : {}),
  } });
}
function failure(request: Request, code: UsageConsentPublicError): Response {
  return send(request, new TextEncoder().encode(`{"schemaVersion":1,"error":{"code":"${code}"}}`), code);
}

/** Authenticated private consent boundary. The request body only carries the
 * consent decision; account identity and session expiry are derived inside the
 * transport from the live request-owned session. */
export function createUsageConsentHandler(dependencies: UsageConsentRouteDependencies) {
  const { available, query, registerLifetime, now, setTimeout, clearTimeout } = dependencies;
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET" && request.method !== "POST") return failure(request, "method_not_allowed");
      if (request.signal.aborted || available() !== true) return failure(request, "unavailable");
      if (request.url.length > 256) return failure(request, "invalid_request");
      const url = new URL(request.url), origin = request.headers.get("origin");
      if (url.origin !== "https://aicharts.io" || request.headers.get("sec-fetch-site") !== "same-origin"
        || (request.method === "POST" ? origin !== "https://aicharts.io" : origin !== null && origin !== "https://aicharts.io")) {
        return failure(request, "request_rejected");
      }
      if (request.url !== USAGE_CONSENT_PUBLIC_URL || request.headers.get("accept") !== "application/json"
        || request.headers.has("content-encoding") || request.headers.has("transfer-encoding")
        || request.headers.has("authorization")) return failure(request, "invalid_request");
      let expected: number | null;
      try { expected = privateDaysHttpLength(request.headers, USAGE_CONSENT_PUBLIC_REQUEST_BYTES); }
      catch { return failure(request, "invalid_request"); }
      if (request.method === "GET") {
        if (request.body !== null || request.headers.has("content-type") || expected !== null) return failure(request, "invalid_request");
      } else if (request.body === null || request.headers.get("content-type") !== "application/json") {
        return failure(request, "invalid_request");
      }
      let input: UsageConsentOperationInput;
      if (request.method === "GET") {
        input = Object.freeze({ operation: "status" });
      } else {
        const effects = { setTimeout, clearTimeout, now() {
          if (request.signal.aborted || available() !== true) throw new Error("usage_consent_route_unavailable");
          return now();
        } };
        const bytes = await pairingHttpWork<Uint8Array<ArrayBuffer> | null>(effects, PAIRING_HTTP_CLIENT_MS,
          registerLifetime, () => null, () => {},
          work => pairingHttpBody(request.body, USAGE_CONSENT_PUBLIC_REQUEST_BYTES, expected, work));
        if (bytes === null) return failure(request, "invalid_request");
        const decision = decodeUsageConsentDecision(bytes);
        if (decision === null) return failure(request, "invalid_request");
        input = Object.freeze({ operation: "set", consent: decision.consent, publicHandle: decision.publicHandle });
      }
      if (request.signal.aborted || available() !== true) return failure(request, "unavailable");
      const raw = await query(request, input);
      if (request.signal.aborted || available() !== true) return failure(request, "unavailable");
      const negative = privateDaysSnapshot(raw, ["kind"]);
      if (negative?.kind === "authentication_required") return failure(request, "authentication_required");
      const outcome = privateDaysSnapshot(raw, ["kind", "result"]);
      if (outcome?.kind !== "query") return failure(request, "unavailable");
      const success = privateDaysSnapshot(outcome.result, ["ok", "value"]);
      let reply: UsageConsentPublicReply;
      if (success?.ok === true) {
        reply = { schemaVersion: 1, state: "ready", value: success.value as never };
      } else {
        const absent = privateDaysSnapshot(outcome.result, ["ok", "error"]);
        if (absent?.ok === false && absent.error === "not_enrolled") {
          reply = { schemaVersion: 1, state: "not_enrolled" };
        } else return failure(request, "unavailable");
      }
      const checked = parseUsageConsentPublicReply(reply);
      if (checked === null) return failure(request, "unavailable");
      const bytes = encodeUsageConsentPublicReply(checked);
      return bytes === null ? failure(request, "unavailable") : send(request, bytes);
    } catch { return failure(request, "unavailable"); }
  };
}

// Construction is effect-free; flags are read anew for each actual request.
export const handleUsageConsent = createUsageConsentHandler({
  available: usagePrivateReadAvailable, query: createVercelUsageConsentTransport(),
  registerLifetime: terminal => { after(terminal); },
  now: () => Date.now(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
