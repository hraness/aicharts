import "server-only";

import type { SuiteOidcRelyingParty } from "@hraness/suite-accounts/oidc-rp";
import {
  openPairingCustody, pairingHex as hex, pairingSetCookie, pairingTime as time,
  randomPairingToken, sealPairingCustody, type PairingCustody, type PairingProof as Proof,
} from "./pairing-custody";

/** Trusted server transport only. No production resolver is installed yet. */
export type UsagePairingIntent = Readonly<{
  beginBrowserAttempt(input: unknown): Promise<unknown>;
  recordVerifiedAuthentication(input: unknown): Promise<unknown>;
  browserStatus(input: unknown): Promise<unknown>;
  decideBrowser(input: unknown): Promise<unknown>;
}>;

type Options = Readonly<{
  authority: () => Readonly<{ party: SuiteOidcRelyingParty; current: () => boolean; cookieSecret: string }> | null;
  resolve?: (intentId: string) => UsagePairingIntent;
  now: () => number;
  randomBytes: (length: number) => Uint8Array;
}>;

const origin = "https://aicharts.io";
const contextPrefix = "aicharts_pairing_v1_";
const fields = ["intentId", "attemptId", "browserNonce", "contextToken"] as const;
const ttlMs = 600_000;
const account = (value: unknown): value is string => typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value);
type BrowserView = Readonly<{
  state: "pending" | "browser-approved" | "terminal-confirmed" | "denied" | "expired";
  expiresAtMs: number;
  accountId: string | null;
  authenticationExpiresAtMs: number | null;
}>;

/** Copy data descriptors before any await; never invoke input getters. */
function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return null;
    result[key] = descriptor.value as unknown;
  }
  return result;
}

function valueOf(result: unknown): unknown {
  const envelope = snapshot(result, ["ok", "value"]);
  return envelope?.ok === true ? envelope.value : null;
}

function proofOf(custody: PairingCustody): Proof {
  return Object.freeze({ intentId: custody.intentId, attemptId: custody.attemptId,
    browserNonce: custody.browserNonce, contextToken: custody.contextToken });
}

function parseView(result: unknown): BrowserView | null {
  const value = snapshot(valueOf(result), ["state", "expiresAtMs", "accountId", "authenticationExpiresAtMs"]);
  if (value === null || typeof value.state !== "string"
    || !["pending", "browser-approved", "terminal-confirmed", "denied", "expired"].includes(value.state) || !time(value.expiresAtMs)
    || !(value.accountId === null || account(value.accountId))
    || !(value.authenticationExpiresAtMs === null || time(value.authenticationExpiresAtMs))
    || (value.accountId === null) !== (value.authenticationExpiresAtMs === null)
    || (["browser-approved", "terminal-confirmed"].includes(value.state) && value.accountId === null)) return null;
  return Object.freeze(value) as BrowserView;
}

function exactApprovalRequest(request: Request, method: "GET" | "POST"): boolean {
  const url = new URL(request.url);
  const claimedOrigin = request.headers.get("origin");
  return request.method === method && url.origin === origin && url.pathname === "/api/usage/pairing"
    && url.search === "" && url.hash === "" && url.username === "" && url.password === ""
    && request.headers.get("sec-fetch-site") === "same-origin"
    && (method === "POST" ? claimedOrigin === origin : claimedOrigin === null || claimedOrigin === origin);
}

async function decisionBody(request: Request): Promise<Readonly<{ decision: "approve" | "deny"; csrfToken: string }> | null> {
  if (request.headers.get("content-type") !== "application/json" || request.headers.has("content-encoding")
    || request.body === null) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^(0|[1-9][0-9]{0,3})$/u.test(declared) || Number(declared) > 512)) return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(512);
  let size = 0;
  let complete = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Pairing body timed out.")), 5_000); });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), limit]);
      if (next.done) { complete = true; break; }
      if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0 || size + next.value.byteLength > bytes.length) return null;
      bytes.set(next.value, size);
      size += next.value.byteLength;
    }
    if (declared !== null && size !== Number(declared)) return null;
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    const parsed = snapshot(value, ["decision", "csrfToken"]);
    // A canonical body also rejects duplicate or escaped member names that a
    // generic JSON parser would silently collapse into the last value.
    if (parsed === null || (parsed.decision !== "approve" && parsed.decision !== "deny") || !hex(parsed.csrfToken)) return null;
    const canonical = JSON.stringify({ decision: parsed.decision, csrfToken: parsed.csrfToken });
    if (Buffer.from(bytes.subarray(0, size)).toString("utf8") !== canonical) return null;
    return Object.freeze({ decision: parsed.decision, csrfToken: parsed.csrfToken });
  } catch { return null; }
  finally {
    clearTimeout(timer);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function equalToken(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function encode(proof: Proof): string {
  // 128 bytes produce 171 canonical base64url characters. The versioned domain
  // leaves room under the SDK's 256-character bound without a second token/key.
  return contextPrefix + Buffer.from(fields.map(key => proof[key]).join(""), "hex").toString("base64url");
}

function decode(context: string): Proof | null {
  if (!context.startsWith(contextPrefix) || context.length !== contextPrefix.length + 171) return null;
  const encoded = context.slice(contextPrefix.length);
  if (!/^[A-Za-z0-9_-]{171}$/u.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length !== 128 || bytes.toString("base64url") !== encoded) return null;
  const joined = bytes.toString("hex");
  const proof = Object.freeze({
    intentId: joined.slice(0, 64), attemptId: joined.slice(64, 128),
    browserNonce: joined.slice(128, 192), contextToken: joined.slice(192, 256),
  });
  return fields.every(key => hex(proof[key])) ? proof : null;
}

function failure(code: "UNAVAILABLE" | "REJECTED" | "FAILED", status: number): Response {
  return Response.json({ error: { code: `USAGE_PAIRING_AUTH_${code}` }, schemaVersion: 1 }, { status });
}

function validStartRequest(request: Request): boolean {
  const url = new URL(request.url);
  const requestOrigin = request.headers.get("origin");
  return request.method === "GET" && url.origin === origin && url.pathname === "/api/suite-auth/start"
    && url.search === "" && url.hash === "" && url.username === "" && url.password === ""
    && request.headers.get("sec-fetch-site") === "same-origin"
    && (requestOrigin === null || requestOrigin === origin);
}

/**
 * Server-only coordination, not a public route. Transport and public callback
 * dispatch still require qualification. One active browser attempt is supported.
 * Completion evidence never leaves this coordinator as a caller-supplied DTO.
 */
export function createPairingAuthentication(options: Options) {
  const liveTime = (startedAtMs: number, expiresAtMs: number, current: () => boolean): number | null => {
    const now = options.now();
    return time(now) && now >= startedAtMs && now < expiresAtMs && current() ? now : null;
  };
  return Object.freeze({
    async start(request: Request, input: unknown): Promise<Response> {
      try {
        const operation = options.authority();
        if (operation === null || options.resolve === undefined) return failure("UNAVAILABLE", 503);
        const { party: authority, current, cookieSecret } = operation;
        if (!validStartRequest(request)) return failure("REJECTED", 403);
        const parsed = snapshot(input, ["intentId"]);
        if (parsed === null || !hex(parsed.intentId)) return failure("REJECTED", 400);
        const { intentId } = parsed;
        const browserNonce = randomPairingToken(options.randomBytes);
        const csrfToken = randomPairingToken(options.randomBytes);
        if (browserNonce === csrfToken) return failure("FAILED", 503);
        const before = options.now();
        if (!time(before)) return failure("FAILED", 503);
        const intent = options.resolve(intentId);
        const result = await intent.beginBrowserAttempt(Object.freeze({ intentId, browserNonce }));
        const attempt = snapshot(valueOf(result), ["attemptId", "contextToken", "startedAtMs", "expiresAtMs"]);
        if (attempt === null || !hex(attempt.attemptId) || !hex(attempt.contextToken)
          || !time(attempt.startedAtMs) || !time(attempt.expiresAtMs)
          || attempt.expiresAtMs <= attempt.startedAtMs || attempt.expiresAtMs - attempt.startedAtMs > ttlMs) return failure("FAILED", 503);
        const afterBegin = liveTime(Math.max(before, attempt.startedAtMs), attempt.expiresAtMs, current);
        if (afterBegin === null) return failure("FAILED", 503);
        const proof = Object.freeze({ intentId, browserNonce, attemptId: attempt.attemptId, contextToken: attempt.contextToken });
        const response = await authority.startFreshAuthentication(request, {
          context: encode(proof), expiresAtMs: attempt.expiresAtMs,
        });
        if (response.status !== 302) return response;
        const custody = Object.freeze({ ...proof, csrfToken, issuedAtMs: afterBegin, expiresAtMs: attempt.expiresAtMs });
        const sealed = await sealPairingCustody(custody, cookieSecret, options.randomBytes);
        // Cookie encryption can finish after expiry or a kill-switch change.
        const afterSeal = liveTime(afterBegin, attempt.expiresAtMs, current);
        if (afterSeal === null) return failure("FAILED", 503);
        const headers = new Headers(response.headers);
        headers.append("set-cookie", pairingSetCookie(sealed, attempt.expiresAtMs - afterSeal));
        return new Response(response.body, { status: response.status, headers });
      } catch {
        // A lost reply may already have replaced the attempt. No automatic retry.
        return failure("FAILED", 503);
      }
    },

    async complete(request: Request): Promise<Response> {
      try {
        const operation = options.authority();
        if (operation === null || options.resolve === undefined) return failure("UNAVAILABLE", 503);
        const { party: authority, current, cookieSecret } = operation;
        const before = options.now();
        if (!time(before)) return failure("FAILED", 503);
        const custody = await openPairingCustody(request, cookieSecret, before);
        if (custody === null) return failure("REJECTED", 403);
        const afterOpen = liveTime(Math.max(before, custody.issuedAtMs), custody.expiresAtMs, current);
        if (afterOpen === null) return failure("FAILED", 503);
        const result = await authority.completeFreshAuthentication(request);
        if (result.kind === "rejected") return result.response;
        const authentication = result.authentication;
        const proof = decode(authentication.context);
        const deadline = Math.min(custody.expiresAtMs, authentication.expiresAtMs);
        const beforeRecord = liveTime(Math.max(afterOpen, authentication.startedAtMs), deadline, current);
        if (proof === null || fields.some(field => proof[field] !== custody[field]) || beforeRecord === null) return failure("FAILED", 503);
        // Signed authentication alone does not consume the durable attempt. Its
        // owner rechecks commitments, supersession, expiry and exact-fact retry.
        const intent = options.resolve(proof.intentId);
        const recorded = await intent.recordVerifiedAuthentication(Object.freeze({
          ...proof, accountId: authentication.suiteAccountId,
          authTimeMs: authentication.authenticatedAtMs,
          sessionExpiresAtMs: authentication.expiresAtMs,
        }));
        const value = snapshot(valueOf(recorded), ["recorded"]);
        if (value?.recorded !== true || liveTime(beforeRecord, deadline, current) === null) return failure("FAILED", 503);
        return result.response;
      } catch {
        // A committed write with a lost reply is uncertain, not approval. Never
        // return the session cookie/continuation or replay the OAuth code here.
        return failure("FAILED", 503);
      }
    },

    async read(request: Request): Promise<Response> { return approval(request, false); },
    async decide(request: Request): Promise<Response> { return approval(request, true); },
  });

  async function approval(request: Request, deciding: boolean): Promise<Response> {
    try {
      const operation = options.authority();
      if (operation === null || options.resolve === undefined) return failure("UNAVAILABLE", 503);
      const { party: authority, current, cookieSecret } = operation;
      if (!exactApprovalRequest(request, deciding ? "POST" : "GET")) return failure("REJECTED", 403);
      const before = options.now();
      if (!time(before)) return failure("FAILED", 503);
      const custody = await openPairingCustody(request, cookieSecret, before);
      if (custody === null) return failure("REJECTED", 403);
      let observed = liveTime(Math.max(before, custody.issuedAtMs), custody.expiresAtMs, current);
      if (observed === null) return failure("FAILED", 503);
      const decision = deciding ? await decisionBody(request) : null;
      if (deciding && decision === null) return failure("REJECTED", 400);
      if (decision !== null && !equalToken(decision.csrfToken, custody.csrfToken)) return failure("REJECTED", 403);
      observed = liveTime(observed, custody.expiresAtMs, current);
      if (observed === null) return failure("FAILED", 503);
      const session = await authority.serverAccountSession(request);
      if (session === null) return failure("REJECTED", 403);
      let deadline = Math.min(custody.expiresAtMs, session.accessTokenExpiresAtMs);
      observed = liveTime(observed, deadline, current);
      if (observed === null) return failure("FAILED", 503);
      const proof = proofOf(custody);
      const intent = options.resolve(proof.intentId);
      let view = parseView(await intent.browserStatus(proof));
      observed = liveTime(observed, deadline, current);
      if (observed === null || view === null || view.expiresAtMs !== custody.expiresAtMs) return failure("FAILED", 503);
      if (view.accountId !== session.suiteAccountId || view.authenticationExpiresAtMs === null || view.state === "expired") return failure("REJECTED", 403);
      deadline = Math.min(deadline, view.authenticationExpiresAtMs);
      observed = liveTime(observed, deadline, current);
      if (observed === null) return failure("FAILED", 503);
      if (decision !== null) {
        view = parseView(await intent.decideBrowser(Object.freeze({
          ...proof, accountId: session.suiteAccountId,
          liveSessionExpiresAtMs: session.accessTokenExpiresAtMs, decision: decision.decision,
        })));
        observed = liveTime(observed, deadline, current);
        if (observed === null || view === null || view.expiresAtMs !== custody.expiresAtMs
          || view.accountId !== session.suiteAccountId || view.authenticationExpiresAtMs === null
          || (decision.decision === "deny" ? view.state !== "denied" : !["browser-approved", "terminal-confirmed"].includes(view.state))) return failure("FAILED", 503);
        deadline = Math.min(deadline, view.authenticationExpiresAtMs);
        if (liveTime(observed, deadline, current) === null) return failure("FAILED", 503);
      }
      // Keep encrypted custody until its original expiry so explicit readback
      // can reconcile a committed decision whose response was lost.
      return Response.json({ schemaVersion: 1, state: view.state, accountId: view.accountId,
        expiresAtMs: deadline, csrfToken: custody.csrfToken });
    } catch { return failure("FAILED", 503); }
  }
}
