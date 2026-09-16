import "server-only";

import { createSuiteAccountsClientConfiguration } from "@hraness/suite-accounts/client-configuration";
import {
  createSuiteOidcRelyingParty,
  type SuiteOidcRelyingParty,
  type SuiteOidcRelyingPartyOptions,
} from "@hraness/suite-accounts/oidc-rp";
import { createPairingAuthentication, type UsagePairingIntent } from "./pairing-auth";
import { pairingCookieName, pairingSetCookie } from "./pairing-custody";

const binding = Object.freeze({
  authMode: "oidc-rp",
  callbackUrl: "https://aicharts.io/api/suite-auth/callback",
  clientId: "hraness:aicharts:production:v1",
  consumer: "aicharts",
  environment: "production",
  origin: "https://aicharts.io",
} as const);

export type UsageAuthEnvironment = Readonly<{
  AICHARTS_USAGE_AUTH_ENABLED?: unknown;
  AICHARTS_USAGE_PAIRING_ENABLED?: unknown;
  AICHARTS_USAGE_PRIVATE_READ_ENABLED?: unknown;
  AICHARTS_USAGE_PUBLIC_READ_ENABLED?: unknown;
  VERCEL?: unknown;
  VERCEL_ENV?: unknown;
  VERCEL_TARGET_ENV?: unknown;
  NEXT_PUBLIC_SITE_URL?: unknown;
  NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN?: unknown;
  NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN?: unknown;
  NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN?: unknown;
  SUITE_OIDC_COOKIE_SECRET?: unknown;
}>;

export type UsageAccountSession = Readonly<{
  suiteAccountId: string;
  expiresAtMs: number;
}>;
export type UsageAccountSessionRead = Readonly<{ kind: "authenticated"; value: UsageAccountSession }>
  | Readonly<{ kind: "authentication_required" }> | Readonly<{ kind: "unavailable" }>;

/** One request's live read and authority checks; contains no browser credentials. */
export type UsageAccountSessionScope = Readonly<{
  read(): Promise<UsageAccountSession | null>;
  readOutcome(): Promise<UsageAccountSessionRead>;
  current(): boolean;
  finish(): void;
}>;

type UsageAuthOptions = Readonly<{
  environment?: () => UsageAuthEnvironment;
  fetch?: SuiteOidcRelyingPartyOptions["fetch"];
  now?: SuiteOidcRelyingPartyOptions["now"];
  randomBytes?: SuiteOidcRelyingPartyOptions["randomBytes"];
  /** Trusted server transport. The current fence must survive lazy binding. */
  pairingIntent?: (intentId: string, current: () => boolean) => UsagePairingIntent;
}>;

function processEnvironment(): UsageAuthEnvironment {
  // Indirection is intentional: Next must not freeze these NEXT_PUBLIC_ checks
  // into build-time constants when this server boundary runs after promotion.
  const environment = process.env;
  return {
    AICHARTS_USAGE_AUTH_ENABLED: environment.AICHARTS_USAGE_AUTH_ENABLED,
    AICHARTS_USAGE_PAIRING_ENABLED: environment.AICHARTS_USAGE_PAIRING_ENABLED,
    AICHARTS_USAGE_PRIVATE_READ_ENABLED: environment.AICHARTS_USAGE_PRIVATE_READ_ENABLED,
    AICHARTS_USAGE_PUBLIC_READ_ENABLED: environment.AICHARTS_USAGE_PUBLIC_READ_ENABLED,
    VERCEL: environment.VERCEL,
    VERCEL_ENV: environment.VERCEL_ENV,
    VERCEL_TARGET_ENV: environment.VERCEL_TARGET_ENV,
    NEXT_PUBLIC_SITE_URL: environment.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN: environment.NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN,
    NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN: environment.NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN,
    NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN: environment.NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN,
    SUITE_OIDC_COOKIE_SECRET: environment.SUITE_OIDC_COOKIE_SECRET,
  };
}

function configuredSecret(options: UsageAuthOptions): string | null {
  try {
    // Read the kill switch and deployment identity anew for every request.
    const environment = (options.environment ?? processEnvironment)();
    if (
      environment.AICHARTS_USAGE_AUTH_ENABLED !== "1"
      || environment.VERCEL !== "1"
      || environment.VERCEL_ENV !== "production"
      || (environment.VERCEL_TARGET_ENV !== undefined && environment.VERCEL_TARGET_ENV !== "production")
      || environment.NEXT_PUBLIC_SITE_URL !== binding.origin
      || environment.NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN !== undefined
      || environment.NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN !== undefined
      || environment.NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN !== undefined
      || typeof environment.SUITE_OIDC_COOKIE_SECRET !== "string"
    ) return null;

    const configuration = createSuiteAccountsClientConfiguration(binding);
    if (!configuration.ok) return null;
    return environment.SUITE_OIDC_COOKIE_SECRET;
  } catch {
    return null;
  }
}

function configuredPrivateReadSecret(options: UsageAuthOptions): string | null {
  try {
    const environment = (options.environment ?? processEnvironment)();
    if (environment.AICHARTS_USAGE_PRIVATE_READ_ENABLED !== "1") return null;
    const secret = configuredSecret({ ...options, environment: () => environment });
    if (secret === null || secret.length > 1_024) return null;
    // The pinned SDK requires 32–1024 UTF-8 bytes. This effect-free readiness
    // check cannot create its asynchronous cookie key outside a request owner.
    const bytes = new TextEncoder().encode(secret).byteLength;
    return bytes >= 32 && bytes <= 1_024 ? secret : null;
  } catch { return null; }
}

/** The anonymous public-read fence. No session secret or auth flag is involved:
 * the served payload is only the materialized public projection, so the gate is
 * the distinct public flag plus the production deployment identity. */
function configuredPublicRead(options: UsageAuthOptions): boolean {
  try {
    const environment = (options.environment ?? processEnvironment)();
    return environment.AICHARTS_USAGE_PUBLIC_READ_ENABLED === "1"
      && environment.VERCEL === "1"
      && environment.VERCEL_ENV === "production"
      && (environment.VERCEL_TARGET_ENV === undefined || environment.VERCEL_TARGET_ENV === "production")
      && environment.NEXT_PUBLIC_SITE_URL === binding.origin
      && environment.NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN === undefined
      && environment.NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN === undefined
      && environment.NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN === undefined;
  } catch { return false; }
}

function configuredPairingSecret(options: UsageAuthOptions): string | null {
  try {
    const environment = (options.environment ?? processEnvironment)();
    if (environment.AICHARTS_USAGE_PAIRING_ENABLED !== "1") return null;
    const secret = configuredSecret({ ...options, environment: () => environment });
    if (secret === null || secret.length > 1_024) return null;
    const size = new TextEncoder().encode(secret).byteLength;
    return size >= 32 && size <= 1_024 ? secret : null;
  } catch { return null; }
}

function relyingParty(options: UsageAuthOptions, watchConfiguration = false, pairingRequest?: Request): SuiteOidcRelyingParty | null {
  try {
    const cookieSecret = pairingRequest === undefined ? configuredSecret(options) : configuredPairingSecret(options);
    if (cookieSecret === null) return null;
    // The SDK owns secret validation, cookie encryption, PKCE, state, nonce,
    // provider endpoints, token validation, refresh rotation, and CSRF checks.
    return createSuiteOidcRelyingParty({
      consumer: binding.consumer,
      environment: binding.environment,
      cookieSecret,
      receiptKeyVersion: "identity-v1",
      fetch: watchConfiguration ? async (input, init) => {
        // Stop new pairing provider requests when disabled or rotated during a
        // prior await. This does not cancel an already dispatched request.
        if (pairingRequest === undefined ? configuredSecret(options) !== cookieSecret
          : pairingRequest.signal.aborted || configuredPairingSecret(options) !== cookieSecret) throw new Error("Usage authentication unavailable.");
        return (options.fetch ?? globalThis.fetch)(input, init);
      } : options.fetch,
      now: options.now,
      randomBytes: options.randomBytes,
    });
  } catch {
    return null;
  }
}

function beginAccountSession(request: Request, options: UsageAuthOptions, privateRead = false): UsageAccountSessionScope | null {
  try {
    const configuration = () => privateRead ? configuredPrivateReadSecret(options) : configuredSecret(options);
    const cookieSecret = configuration();
    const requestOrigin = new URL(request.url).origin;
    if (cookieSecret === null || requestOrigin !== binding.origin) return null;
    // The SDK reads only request metadata here. Snapshot it without cloning or
    // consuming the product's body; retain the original origin and abort fence.
    const ownedRequest = new Request(request.url, { headers: request.headers });
    const signal = request.signal;
    const now = options.now ?? Date.now;
    const fetcher = options.fetch ?? globalThis.fetch;
    const validTime = (value: number) => Number.isSafeInteger(value) && !Object.is(value, -0)
      && value >= 0 && value <= 8_640_000_000_000_000;
    let open = true, readStarted = false, providerAttempted = false, observed = 0;
    let expiresAtMs: number | null = null;
    const finish = () => { open = false; };
    const current = () => {
      if (!open) return false;
      try {
        const sampled = now();
        if (!validTime(sampled) || sampled < observed || (expiresAtMs !== null && sampled >= expiresAtMs)
          || signal.aborted || new URL(request.url).origin !== requestOrigin
          || configuration() !== cookieSecret) {
          finish(); return false;
        }
        observed = sampled;
        return open;
      } catch { finish(); return false; }
    };
    if (!current()) return null;
    const authority = createSuiteOidcRelyingParty({
      consumer: binding.consumer, environment: binding.environment, cookieSecret,
      receiptKeyVersion: "identity-v1", randomBytes: options.randomBytes,
      now: () => {
        if (!current()) throw new Error("Usage account session unavailable.");
        return observed;
      },
      fetch: async (input, init) => {
        if (!current()) throw new Error("Usage account session unavailable.");
        // Do not reject a response after dispatch: let the SDK consume its body
        // and clean up. The read below fences the eventual session projection.
        providerAttempted = true;
        return fetcher(input, init);
      },
    });
    const unavailable = (): UsageAccountSessionRead => Object.freeze({ kind: "unavailable" });
    const readOutcome = async (): Promise<UsageAccountSessionRead> => {
      if (readStarted || !current()) return unavailable();
      readStarted = true;
      try {
        const session = await authority.serverAccountSession(ownedRequest);
        if (!current()) return unavailable();
        if (session === null) {
          if (providerAttempted) { finish(); return unavailable(); }
          // No valid local session and no provider attempt. Keep the configuration
          // fence current until the request owner delivers this negative outcome.
          return Object.freeze({ kind: "authentication_required" });
        }
        expiresAtMs = session.accessTokenExpiresAtMs;
        if (!validTime(expiresAtMs) || !current()) { finish(); return unavailable(); }
        return Object.freeze({ kind: "authenticated", value: Object.freeze({ suiteAccountId: session.suiteAccountId, expiresAtMs }) });
      } catch { finish(); return unavailable(); }
    };
    return Object.freeze({
      current, finish, readOutcome,
      async read(): Promise<UsageAccountSession | null> {
        // Preserve the original accessor's repeated-read and null-and-close
        // behavior. Both entry points share one attempt, including during awaits.
        if (readStarted || !current()) return null;
        const result = await readOutcome();
        if (result.kind === "authenticated") return result.value;
        finish(); return null;
      },
    });
  } catch { return null; }
}

function errorResponse(code: string, status: number, allow?: string): Response {
  return Response.json({ error: { code }, schemaVersion: 1 }, {
    status,
    headers: allow === undefined ? undefined : { allow },
  });
}

function privateResponse(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex, nofollow");
  const vary = headers.get("vary");
  if (vary === null) headers.set("vary", "Cookie");
  else if (!vary.split(",").some(value => ["cookie", "*"].includes(value.trim().toLowerCase()))) {
    headers.set("vary", `${vary}, Cookie`);
  }
  return new Response(request.method === "HEAD" ? null : response.body, {
    headers, status: response.status, statusText: response.statusText,
  });
}

function routeMethod(pathname: string): "GET" | "POST" | null {
  switch (pathname) {
    case "/api/suite-auth/start":
    case "/api/suite-auth/callback":
    case "/api/suite-auth/session":
      return "GET";
    case "/api/suite-auth/refresh":
    case "/api/suite-auth/sign-out":
      return "POST";
    default:
      return null;
  }
}

function callbackMode(request: Request): "ordinary" | "pairing" | "rejected" {
  const header = request.headers.get("cookie");
  if (header === null) return "ordinary";
  if (header.length > 16_384) return "rejected";
  let pairing = false;
  for (const part of header.split(";")) {
    const equals = part.indexOf("=");
    const name = (equals < 0 ? part : part.slice(0, equals)).trim();
    if (name !== pairingCookieName) continue;
    if (pairing || equals < 0) return "rejected";
    pairing = true;
  }
  // Presence selects a path, not authority. The pairing coordinator validates
  // custody before exchange; each SDK completion rejects the other transaction
  // version before provider work. Missing or invalid custody cannot fall back.
  return pairing ? "pairing" : "ordinary";
}

/** Server-only composition; injected dependencies are for synthetic tests. */
export function createUsageAuthServer(options: UsageAuthOptions = {}) {
  const pairing = createPairingAuthentication({
    authority: request => {
      const cookieSecret = configuredPairingSecret(options);
      if (request.signal.aborted || cookieSecret === null) return null;
      const party = relyingParty(options, true, request);
      return cookieSecret === null || party === null ? null : {
        party, cookieSecret, current: () => !request.signal.aborted && configuredPairingSecret(options) === cookieSecret,
      };
    },
    resolve: options.pairingIntent,
    now: options.now ?? Date.now,
    randomBytes: options.randomBytes ?? (length => crypto.getRandomValues(new Uint8Array(length))),
  });
  return Object.freeze({
    pairingAvailable(): boolean { return configuredPairingSecret(options) !== null; },
    beginPairingRequest(request: Request): (() => boolean) | null {
      const secret = configuredPairingSecret(options);
      if (secret === null || request.signal.aborted) return null;
      let previous = 0, open = true;
      const current = () => {
        try {
          const now = (options.now ?? Date.now)();
          if (!open || request.signal.aborted || configuredPairingSecret(options) !== secret
            || !Number.isSafeInteger(now) || Object.is(now, -0) || now < previous || now > 8_640_000_000_000_000) return open = false;
          previous = now; return true;
        } catch { return open = false; }
      };
      return current() ? current : null;
    },
    beginAccountSession(request: Request): UsageAccountSessionScope | null {
      return beginAccountSession(request, options);
    },

    privateReadAvailable(): boolean { return configuredPrivateReadSecret(options) !== null; },
    beginPrivateReadSession(request: Request): UsageAccountSessionScope | null {
      return beginAccountSession(request, options, true);
    },

    publicReadAvailable(): boolean { return configuredPublicRead(options); },

    async startPairingAuthentication(request: Request, input: unknown): Promise<Response> {
      return privateResponse(await pairing.start(request, input), request);
    },

    async completePairingAuthentication(request: Request): Promise<Response> {
      return privateResponse(await pairing.complete(request), request);
    },

    async readPairingApproval(request: Request): Promise<Response> {
      return privateResponse(await pairing.read(request), request);
    },

    async decidePairingApproval(request: Request): Promise<Response> {
      return privateResponse(await pairing.decide(request), request);
    },

    async handle(request: Request): Promise<Response> {
      let response: Response;
      try {
        const authority = relyingParty(options);
        if (authority === null) {
          response = errorResponse("USAGE_AUTH_UNAVAILABLE", 503);
        } else {
          const url = new URL(request.url);
          const method = routeMethod(url.pathname);
          if (url.origin !== binding.origin) {
            response = errorResponse("USAGE_AUTH_REQUEST_REJECTED", 403);
          } else if (method === null) {
            response = errorResponse("USAGE_AUTH_ROUTE_NOT_FOUND", 404);
          } else if (request.method !== method) {
            response = errorResponse("USAGE_AUTH_METHOD_NOT_ALLOWED", 405, method);
          } else if (url.pathname === "/api/suite-auth/callback") {
            const mode = callbackMode(request);
            response = mode === "pairing" ? await pairing.complete(request)
              : mode === "ordinary" ? await authority.callback(request)
                : errorResponse("USAGE_AUTH_REQUEST_REJECTED", 403);
          } else if (url.pathname === "/api/suite-auth/start") {
            response = await authority.start(request);
            // Both modes replace the same SDK transaction cookie. Only an
            // admitted ordinary start cancels the browser's pairing custody.
            if (response.status === 302) response.headers.append("set-cookie", pairingSetCookie("", 0));
          } else {
            response = await authority.handle(request);
          }
        }
      } catch {
        // Do not reflect URLs, provider failures, credentials, or cookie data.
        response = errorResponse("USAGE_AUTH_FAILED", 503);
      }
      return privateResponse(response, request);
    },

    async accountSession(request: Request): Promise<UsageAccountSession | null> {
      try {
        const authority = relyingParty(options);
        if (authority === null) return null;
        // This accessor checks the live Accounts session, including revocation.
        // Do not replace it with the browser's optimistic session view.
        const session = await authority.serverAccountSession(request);
        return session === null ? null : Object.freeze({
          suiteAccountId: session.suiteAccountId,
          expiresAtMs: session.accessTokenExpiresAtMs,
        });
      } catch {
        return null;
      }
    },
  });
}

// The request-context transport is loaded only after pairing admission. Its one
// module-owned factory keeps capacity accounting shared across requests; it
// retains no account, token, request or pending operation in this binding.
let productionPairingTransport: ((intentId: string, current?: () => boolean) => UsagePairingIntent) | undefined;
function productionPairingIntent(intentId: string, current: () => boolean): UsagePairingIntent {
  async function invoke(method: keyof UsagePairingIntent, input: unknown): Promise<unknown> {
    if (!current() || configuredPairingSecret({}) === null) throw new Error("pairing_transport_unavailable");
    const binding = await import("./pairing-vercel");
    if (!current() || configuredPairingSecret({}) === null) throw new Error("pairing_transport_unavailable");
    productionPairingTransport ??= binding.createVercelPairingTransport();
    return productionPairingTransport(intentId, current)[method](input);
  }
  return Object.freeze({
    beginBrowserAttempt: (input: unknown) => invoke("beginBrowserAttempt", input),
    recordVerifiedAuthentication: (input: unknown) => invoke("recordVerifiedAuthentication", input),
    browserStatus: (input: unknown) => invoke("browserStatus", input),
    decideBrowser: (input: unknown) => invoke("decideBrowser", input),
  });
}
const server = createUsageAuthServer({ pairingIntent: productionPairingIntent });
export const handleUsageAuth = server.handle;
export const usagePairingAvailable = server.pairingAvailable;
export const beginUsagePairingRequest = server.beginPairingRequest;
export const startUsagePairingAuthentication = server.startPairingAuthentication;
export const readUsagePairingApproval = server.readPairingApproval;
export const decideUsagePairingApproval = server.decidePairingApproval;
export const usageAccountSession = server.accountSession;
export const beginUsageAccountSession = server.beginAccountSession;
export const usagePrivateReadAvailable = server.privateReadAvailable;
export const beginUsagePrivateReadSession = server.beginPrivateReadSession;
export const usagePublicReadAvailable = server.publicReadAvailable;
