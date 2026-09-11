import "server-only";

import { createSuiteAccountsClientConfiguration } from "@hraness/suite-accounts/client-configuration";
import {
  createSuiteOidcRelyingParty,
  type SuiteOidcRelyingParty,
  type SuiteOidcRelyingPartyOptions,
} from "@hraness/suite-accounts/oidc-rp";

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

type UsageAuthOptions = Readonly<{
  environment?: () => UsageAuthEnvironment;
  fetch?: SuiteOidcRelyingPartyOptions["fetch"];
  now?: SuiteOidcRelyingPartyOptions["now"];
  randomBytes?: SuiteOidcRelyingPartyOptions["randomBytes"];
}>;

function processEnvironment(): UsageAuthEnvironment {
  // Indirection is intentional: Next must not freeze these NEXT_PUBLIC_ checks
  // into build-time constants when this server boundary runs after promotion.
  const environment = process.env;
  return {
    AICHARTS_USAGE_AUTH_ENABLED: environment.AICHARTS_USAGE_AUTH_ENABLED,
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

function relyingParty(options: UsageAuthOptions): SuiteOidcRelyingParty | null {
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

    // The SDK owns secret validation, cookie encryption, PKCE, state, nonce,
    // provider endpoints, token validation, refresh rotation, and CSRF checks.
    return createSuiteOidcRelyingParty({
      consumer: binding.consumer,
      environment: binding.environment,
      cookieSecret: environment.SUITE_OIDC_COOKIE_SECRET,
      receiptKeyVersion: "identity-v1",
      fetch: options.fetch,
      now: options.now,
      randomBytes: options.randomBytes,
    });
  } catch {
    return null;
  }
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

/** Server-only composition; injected dependencies are for synthetic tests. */
export function createUsageAuthServer(options: UsageAuthOptions = {}) {
  return Object.freeze({
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

const server = createUsageAuthServer();
export const handleUsageAuth = server.handle;
export const usageAccountSession = server.accountSession;
