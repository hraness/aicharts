import "server-only";
import { after } from "next/server";
import { beginUsagePairingRequest, decideUsagePairingApproval, readUsagePairingApproval, startUsagePairingAuthentication } from "./auth-server";
import { pairingHttpBody, pairingHttpDiscard, pairingHttpLength, PAIRING_HTTP_CAPACITY, PAIRING_HTTP_CLIENT_MS } from "./pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "./pairing-http-work";
import { decodePairingPublicReply, encodePairingPublicReply, parsePairingDecision, parsePairingStartForm, PAIRING_FORM_BYTES, PAIRING_FORM_MEDIA,
  PAIRING_PUBLIC_MAX_BYTES, PAIRING_PUBLIC_MEDIA, PAIRING_PUBLIC_URL, PAIRING_START_URL } from "./pairing-public";

export { usagePairingAvailable } from "./auth-server";
export interface PairingRouteDependencies extends PairingHttpEffects {
  begin(request: Request): (() => boolean) | null;
  registerLifetime(terminal: Promise<void>): void;
  start(request: Request, input: unknown): Promise<Response>;
  read(request: Request): Promise<Response>;
  decide(request: Request): Promise<Response>;
}
function headers(media: string, allow?: string): HeadersInit {
  return { "content-type": media, "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    ...(allow === undefined ? {} : { allow }) };
}
function failure(request: Request, status: 400 | 403 | 405 | 503, start: boolean): Response {
  const code = status === 503 ? "USAGE_PAIRING_AUTH_UNAVAILABLE" : "USAGE_PAIRING_AUTH_REJECTED";
  // A start is a document navigation. Its fixed error page never echoes the
  // submitted intent or an upstream response and never restarts authentication.
  const body = start ? '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Collector connection unavailable | AI Charts</title><main><h1>Collector connection unavailable</h1><p>Return to your terminal to check the original pairing attempt. Nothing was approved by this page.</p><p><a href="/usage/pairing">Return to collector connection</a></p></main></html>'
    : encodePairingPublicReply({ error: { code }, schemaVersion: 1 });
  return new Response(request.method === "HEAD" ? null : body, { status,
    headers: headers(start ? "text/html; charset=utf-8" : PAIRING_PUBLIC_MEDIA, status === 405 ? start ? "POST" : "GET, POST" : undefined) });
}

/** One source-owned browser route group. Only the coordinator derives account
 * and attempt authority; the start form supplies an untrusted intent locator. */
export function createPairingRoutes(dependencies: PairingRouteDependencies) {
  const { begin, registerLifetime, start: startAuthentication, read, decide, now, setTimeout, clearTimeout } = dependencies;
  let outstanding = 0;
  async function handle(request: Request, starting: boolean): Promise<Response> {
    const refused = (status: 400 | 403 | 405 | 503) => failure(request, status, starting);
    if (starting ? request.method !== "POST" : request.method !== "GET" && request.method !== "POST") return refused(405);
    let current: (() => boolean) | null, expected: number | null;
    try {
      current = begin(request);
      if (current === null || !current() || outstanding >= PAIRING_HTTP_CAPACITY) return refused(503);
    } catch { return refused(503); }
    try {
      if (request.url !== (starting ? PAIRING_START_URL : PAIRING_PUBLIC_URL)) return refused(403);
      const origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") !== "same-origin" || (request.method === "POST" ? origin !== "https://aicharts.io" : origin !== null && origin !== "https://aicharts.io")) return refused(403);
      if (request.headers.has("authorization") || request.headers.has("content-encoding") || request.headers.has("transfer-encoding")) return refused(400);
      expected = pairingHttpLength(request.headers, starting ? PAIRING_FORM_BYTES : PAIRING_PUBLIC_MAX_BYTES);
      if (request.method === "GET") {
        if (request.body !== null || request.headers.has("content-type") || expected !== null) return refused(400);
      } else if (request.body === null || request.headers.get("content-type") !== (starting ? PAIRING_FORM_MEDIA : "application/json")
        || (starting && expected !== null && expected !== PAIRING_FORM_BYTES)) return refused(400);
    } catch { return refused(400); }
    const fence = current;
    let validUntil: number | null = null;
    const effects: PairingHttpEffects = { setTimeout, clearTimeout, now() {
      if (request.signal.aborted || !fence()) throw new Error("pairing_route_unavailable");
      const time = now();
      if (validUntil !== null && time >= validUntil) throw new Error("pairing_route_unavailable");
      return time;
    } };
    outstanding++;
    return pairingHttpWork(effects, PAIRING_HTTP_CLIENT_MS, registerLifetime, () => refused(503), () => { outstanding--; }, async work => {
      const controller = new AbortController();
      const abort = () => { controller.abort(); };
      request.signal.addEventListener("abort", abort, { once: true });
      work.onStop(() => { abort(); request.signal.removeEventListener("abort", abort); });
      let response: Response | undefined;
      try {
        work.guard();
        if (starting) {
          let bytes: Uint8Array;
          try { bytes = await pairingHttpBody(request.body, PAIRING_FORM_BYTES, PAIRING_FORM_BYTES, work); }
          catch { work.guard(); return refused(400); }
          const intentId = parsePairingStartForm(bytes);
          if (intentId === null) return refused(400);
          const startHeaders = new Headers({ "sec-fetch-site": "same-origin", origin: "https://aicharts.io" });
          const cookie = request.headers.get("cookie");
          if (cookie !== null) startHeaders.set("cookie", cookie);
          const owned = new Request("https://aicharts.io/api/suite-auth/start", { headers: startHeaders, signal: controller.signal });
          work.guard();
          response = await startAuthentication(owned, Object.freeze({ intentId }));
          work.guard();
          if (response.status !== 302 || response.body !== null) return refused(503);
          const location = response.headers.get("location");
          if (location === null) return refused(503);
          const target = new URL(location);
          if (target.origin !== "https://account.hraness.com" || target.pathname !== "/api/auth/oauth2/authorize" || target.hash !== "" || target.username !== "" || target.password !== "") return refused(503);
          const outgoing = new Headers(headers("text/html; charset=utf-8"));
          outgoing.set("location", location);
          for (const cookie of response.headers.getSetCookie()) outgoing.append("set-cookie", cookie);
          return new Response(null, { status: 302, headers: outgoing });
        }
        let decision: Uint8Array<ArrayBuffer> | undefined;
        if (request.method === "POST") {
          try { decision = await pairingHttpBody(request.body, PAIRING_PUBLIC_MAX_BYTES, expected, work); }
          catch { work.guard(); return refused(400); }
          if (parsePairingDecision(decision) === null) return refused(400);
        }
        const owned = new Request(request.url, { method: request.method, headers: request.headers, signal: controller.signal, body: decision });
        work.guard();
        response = await (request.method === "GET" ? read(owned) : decide(owned));
        work.guard();
        if (response.headers.get("content-type") !== PAIRING_PUBLIC_MEDIA || response.headers.has("content-encoding")
          || response.headers.has("location") || response.headers.has("set-cookie")) return refused(503);
        const bytes = await pairingHttpBody(response.body, PAIRING_PUBLIC_MAX_BYTES, pairingHttpLength(response.headers, PAIRING_PUBLIC_MAX_BYTES), work);
        const reply = decodePairingPublicReply(bytes, response.status);
        if (reply === null) return refused(503);
        if (!("error" in reply)) validUntil = reply.expiresAtMs;
        work.guard();
        return new Response(encodePairingPublicReply(reply), { status: response.status, headers: headers(PAIRING_PUBLIC_MEDIA) });
      } finally { if (response !== undefined) await pairingHttpDiscard(response); }
    });
  }
  return Object.freeze({ start: (request: Request) => handle(request, true), approval: (request: Request) => handle(request, false) });
}
const routes = createPairingRoutes({ begin: beginUsagePairingRequest, start: startUsagePairingAuthentication,
  read: readUsagePairingApproval, decide: decideUsagePairingApproval,
  registerLifetime: terminal => { after(terminal); }, now: () => Date.now(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) });
export const handleUsagePairingStart = routes.start;
export const handleUsagePairingApproval = routes.approval;
