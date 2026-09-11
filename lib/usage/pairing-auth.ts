import "server-only";

import type { SuiteOidcRelyingParty } from "@hraness/suite-accounts/oidc-rp";

/** Trusted server transport only. No production resolver is installed yet. */
export type UsagePairingIntent = Readonly<{
  beginBrowserAttempt(input: unknown): Promise<unknown>;
  recordVerifiedAuthentication(input: unknown): Promise<unknown>;
}>;

type Proof = Readonly<{
  intentId: string;
  attemptId: string;
  browserNonce: string;
  contextToken: string;
}>;

type Options = Readonly<{
  authority: () => Readonly<{ party: SuiteOidcRelyingParty; current: () => boolean }> | null;
  resolve?: (intentId: string) => UsagePairingIntent;
  now: () => number;
}>;

const origin = "https://aicharts.io";
const contextPrefix = "aicharts_pairing_v1_";
const fields = ["intentId", "attemptId", "browserNonce", "contextToken"] as const;
const ttlMs = 600_000;
const maxTime = 8_640_000_000_000_000;
const hex = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
const time = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= 0 && value <= maxTime;

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
 * Server-only coordination, not a route or an approval. The future caller must
 * generate/custody browserNonce and qualify its authenticated Worker transport.
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
        const { party: authority, current } = operation;
        if (!validStartRequest(request)) return failure("REJECTED", 403);
        const parsed = snapshot(input, ["intentId", "browserNonce"]);
        if (parsed === null || !hex(parsed.intentId) || !hex(parsed.browserNonce)) return failure("REJECTED", 400);
        const { intentId, browserNonce } = parsed;
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
        // Cookie encryption can finish after expiry or a kill-switch change.
        return liveTime(afterBegin, attempt.expiresAtMs, current) !== null ? response : failure("FAILED", 503);
      } catch {
        // A lost reply may already have replaced the attempt. No automatic retry.
        return failure("FAILED", 503);
      }
    },

    async complete(request: Request): Promise<Response> {
      try {
        const operation = options.authority();
        if (operation === null || options.resolve === undefined) return failure("UNAVAILABLE", 503);
        const { party: authority, current } = operation;
        const before = options.now();
        if (!time(before)) return failure("FAILED", 503);
        const result = await authority.completeFreshAuthentication(request);
        if (result.kind === "rejected") return result.response;
        const authentication = result.authentication;
        const proof = decode(authentication.context);
        const beforeRecord = liveTime(Math.max(before, authentication.startedAtMs), authentication.expiresAtMs, current);
        if (proof === null || beforeRecord === null) return failure("FAILED", 503);
        // Signed authentication alone does not consume the durable attempt. Its
        // owner rechecks commitments, supersession, expiry and exact-fact retry.
        const intent = options.resolve(proof.intentId);
        const recorded = await intent.recordVerifiedAuthentication(Object.freeze({
          ...proof, accountId: authentication.suiteAccountId,
          authTimeMs: authentication.authenticatedAtMs,
          sessionExpiresAtMs: authentication.expiresAtMs,
        }));
        const value = snapshot(valueOf(recorded), ["recorded"]);
        if (value?.recorded !== true || liveTime(beforeRecord, authentication.expiresAtMs, current) === null) return failure("FAILED", 503);
        return result.response;
      } catch {
        // A committed write with a lost reply is uncertain, not approval. Never
        // return the session cookie/continuation or replay the OAuth code here.
        return failure("FAILED", 503);
      }
    },
  });
}
