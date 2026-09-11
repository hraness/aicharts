import { describe, expect, mock, test } from "bun:test";
import { createSuiteOidcRelyingParty } from "@hraness/suite-accounts/oidc-rp";
import { fc } from "../property-test";
import type { UsageAuthEnvironment } from "./auth-server";

// Next enforces this import boundary in the application build. Bun tests run
// server code directly, without replacing the SDK or its cryptographic checks.
mock.module("server-only", () => ({}));
const { createUsageAuthServer, handleUsageAuth } = await import("./auth-server");

const origin = "https://aicharts.io";
const issuer = "https://account.hraness.com";
const clientId = "hraness:aicharts:production:v1";
const accountId = "acct_018f1f7a7a367ccdbd5d706d4dc5c018";
const providerSubject = "synthetic-provider-subject-17";
const nowMs = 1_800_000_300_000;
const secret = "synthetic-cookie-secret-not-for-deployment-0001";
const ready: UsageAuthEnvironment = {
  AICHARTS_USAGE_AUTH_ENABLED: "1",
  VERCEL: "1",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SITE_URL: origin,
  SUITE_OIDC_COOKIE_SECRET: secret,
};
const endpoints = {
  discovery: `${issuer}/.well-known/openid-configuration`,
  authorize: `${issuer}/api/auth/oauth2/authorize`,
  jwks: `${issuer}/api/auth/jwks`,
  token: `${issuer}/api/auth/oauth2/token`,
  revoke: `${issuer}/api/auth/oauth2/revoke`,
  userInfo: `${issuer}/api/auth/oauth2/userinfo`,
};
const unavailable = { error: { code: "USAGE_AUTH_UNAVAILABLE" }, schemaVersion: 1 };
const intentId = "1a".repeat(32);
const browserNonce = "2b".repeat(32);
const attemptId = "3c".repeat(32);
const contextToken = "4d".repeat(32);
const pairingInput = { intentId, browserNonce };
const pairingAttempt = { attemptId, contextToken, startedAtMs: nowMs, expiresAtMs: nowMs + 300_000 };
const pairingStartRequest = () => request("/api/suite-auth/start", { headers: { "sec-fetch-site": "same-origin" } });

function request(path: string, init: RequestInit = {}): Request {
  return new Request(new URL(path, origin), init);
}

function assertPrivate(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")?.toLowerCase().split(",").map(value => value.trim())).toContain("cookie");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
}

function base64url(value: string | ArrayBuffer): string {
  return Buffer.from(typeof value === "string" ? value : new Uint8Array(value)).toString("base64url");
}

function cookieFrom(response: Response, name: "session" | "transaction"): string {
  const value = response.headers.getSetCookie().find(cookie =>
    cookie.startsWith(`__Host-hraness-suite-oidc-${name}=`),
  );
  if (value === undefined) throw new Error(`Missing synthetic ${name} cookie.`);
  return value.split(";", 1)[0];
}

async function assertPairingFailure(response: Response, code?: "UNAVAILABLE" | "REJECTED" | "FAILED", status?: number): Promise<void> {
  expect(response.status).toBeGreaterThanOrEqual(400);
  if (status !== undefined) expect(response.status).toBe(status);
  expect(response.headers.has("location")).toBe(false);
  for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain("Max-Age=0");
  const body = await response.text();
  if (code !== undefined) expect(JSON.parse(body)).toEqual({ error: { code: `USAGE_PAIRING_AUTH_${code}` }, schemaVersion: 1 });
  for (const canary of [secret, intentId, browserNonce, attemptId, contextToken, providerSubject, accountId,
    "synthetic-code", "synthetic-private-provider-failure", "private-durable-reply", "synthetic-reader@example.com"]) {
    expect(body).not.toContain(canary);
  }
  assertPrivate(response);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Synthetic provider transport; the real SDK verifies these ES256 tokens. */
async function fixture(options: { pairing?: boolean } = {}) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const kid = "synthetic-accounts-key-1";
  const profile = { profile_complete: false, profile_revision: "username-v1", username: null };
  let nonce = "";
  let challenge = "";
  let accessToken = "";
  let refreshToken = "synthetic-refresh-token-0001";
  let tokenCount = 0;
  let clockMs = nowMs;
  let environment = ready;
  let failAt: string | null = null;
  let userInfoOverrides: Record<string, unknown> = {};
  let idTokenOverrides: Record<string, unknown> = {};
  let accessTokenOverrides: Record<string, unknown> = {};
  let providerEffect: (url: string) => void | Promise<void> = () => {};
  let randomEffect: (length: number) => void = () => {};
  let beginEffect: (input: unknown) => unknown | Promise<unknown> = () => ({ ok: true, value: { ...pairingAttempt } });
  let recordEffect: (input: unknown) => unknown | Promise<unknown> = () => ({ ok: true, value: { recorded: true } });
  const calls: string[] = [];
  const tokenBodies: URLSearchParams[] = [];
  const resolvedIntents: string[] = [];
  const begun: unknown[] = [];
  const recorded: unknown[] = [];

  async function sign(payload: Record<string, unknown>): Promise<string> {
    const input = `${base64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }))}.${base64url(JSON.stringify({
      iss: issuer, sub: providerSubject, iat: Math.floor(nowMs / 1_000),
      exp: Math.floor(nowMs / 1_000) + 600, suite_account_id: accountId,
      ...profile, ...payload,
    }))}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(input));
    return `${input}.${base64url(signature)}`;
  }

  const server = createUsageAuthServer({
    environment: () => environment,
    now: () => clockMs,
    randomBytes: length => { randomEffect(length); return crypto.getRandomValues(new Uint8Array(length)); },
    ...(options.pairing ? { pairingIntent: (id: string) => {
      resolvedIntents.push(id);
      return {
        beginBrowserAttempt: async (input: unknown) => { begun.push(input); return beginEffect(input); },
        recordVerifiedAuthentication: async (input: unknown) => { recorded.push(input); return recordEffect(input); },
      };
    } } : {}),
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      await providerEffect(url);
      if (url === failAt) throw new Error("synthetic-private-provider-failure");
      if (url === endpoints.discovery) return Response.json({
        authorization_endpoint: endpoints.authorize,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        id_token_signing_alg_values_supported: ["ES256"],
        issuer,
        jwks_uri: endpoints.jwks,
        response_types_supported: ["code"],
        revocation_endpoint: endpoints.revoke,
        token_endpoint: endpoints.token,
        token_endpoint_auth_methods_supported: ["none"],
      });
      if (url === endpoints.jwks) return Response.json({ keys: [{ ...publicKey, alg: "ES256", kid }] });
      if (url === endpoints.token) {
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(String(init?.body));
        tokenBodies.push(body);
        expect(body.get("client_id")).toBe(clientId);
        if (body.get("grant_type") === "authorization_code") {
          expect(body.get("redirect_uri")).toBe(`${origin}/api/suite-auth/callback`);
          expect(body.get("resource")).toBe("https://hraness.com/suite");
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier")!));
          expect(base64url(digest)).toBe(challenge);
        } else {
          expect(body.get("grant_type")).toBe("refresh_token");
          expect(body.get("refresh_token")).toBe(refreshToken);
        }
        tokenCount += 1;
        accessToken = await sign({
          aud: ["https://hraness.com/suite", endpoints.userInfo],
          azp: clientId, suite_client_id: clientId,
          nbf: Math.floor(nowMs / 1_000), jti: `synthetic-token-${tokenCount}`,
          ...accessTokenOverrides,
        });
        refreshToken = `synthetic-refresh-token-${tokenCount + 1}`;
        return Response.json({
          access_token: accessToken,
          id_token: await sign({ aud: clientId, nonce, auth_time: Math.floor(nowMs / 1_000), ...idTokenOverrides }),
          refresh_token: refreshToken,
          token_type: "Bearer",
        });
      }
      if (url === endpoints.userInfo) {
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${accessToken}`);
        return Response.json({
          email: "synthetic-reader@example.com", email_verified: true,
          sub: providerSubject, suite_account_id: accountId, suite_client_id: clientId,
          ...profile, ...userInfoOverrides,
        });
      }
      if (url === endpoints.revoke) {
        expect(new URLSearchParams(String(init?.body)).get("token")).toBe(refreshToken);
        return new Response(null, { status: 200 });
      }
      throw new Error("Unexpected synthetic provider endpoint.");
    },
  });

  function captureStart(response: Response) {
    expect(response.status).toBe(302);
    const authorization = new URL(response.headers.get("location")!);
    nonce = authorization.searchParams.get("nonce")!;
    challenge = authorization.searchParams.get("code_challenge")!;
    return { response, authorization };
  }

  async function start() {
    return captureStart(await server.handle(request("/api/suite-auth/start?return_to=%2F", { headers: { "sec-fetch-site": "same-origin" } })));
  }

  async function startPairing(input: unknown = pairingInput) {
    return captureStart(await server.startPairingAuthentication(pairingStartRequest(), input));
  }

  async function startUnrelatedContext(context: string) {
    const authority = createSuiteOidcRelyingParty({
      consumer: "aicharts", environment: "production", cookieSecret: secret,
      receiptKeyVersion: "identity-v1", now: () => clockMs,
      fetch: async () => { throw new Error("Fresh start must not contact a provider."); },
    });
    return captureStart(await authority.startFreshAuthentication(pairingStartRequest(), { context, expiresAtMs: nowMs + 300_000 }));
  }

  function callback(started: { response: Response; authorization: URL }) {
    return request(`/api/suite-auth/callback?code=synthetic-code&state=${started.authorization.searchParams.get("state")}`, {
      headers: {
        cookie: cookieFrom(started.response, "transaction"),
        "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document",
      },
    });
  }

  async function login() {
    const response = await server.handle(callback(await start()));
    expect(response.status).toBe(200);
    return { response, cookie: cookieFrom(response, "session") };
  }

  return {
    server, calls, tokenBodies, start, login, startPairing, startUnrelatedContext, callback,
    resolvedIntents, begun, recorded,
    secrets: () => [secret, accessToken, refreshToken, providerSubject, "synthetic-reader@example.com"],
    environment: (value: UsageAuthEnvironment) => { environment = value; },
    time: (value: number) => { clockMs = value; },
    fail: (url: string | null) => { failAt = url; },
    userInfo: (value: Record<string, unknown>) => { userInfoOverrides = value; },
    idToken: (value: Record<string, unknown>) => { idTokenOverrides = value; },
    accessToken: (value: Record<string, unknown>) => { accessTokenOverrides = value; },
    providerEffect: (effect: typeof providerEffect) => { providerEffect = effect; },
    randomEffect: (effect: typeof randomEffect) => { randomEffect = effect; },
    beginEffect: (effect: typeof beginEffect) => { beginEffect = effect; },
    recordEffect: (effect: typeof recordEffect) => { recordEffect = effect; },
  };
}

describe("dormant AI Charts browser authentication", () => {
  test("fails closed without configuration, cookies, or provider calls", async () => {
    let calls = 0;
    const server = createUsageAuthServer({ environment: () => ({}), fetch: async () => { calls += 1; throw new Error("must not fetch"); } });
    for (const path of ["start", "callback?code=private&state=private", "session", "refresh", "sign-out", "link-receipt"]) {
      const response = await server.handle(request(`/api/suite-auth/${path}`));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(unavailable);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(response.headers.has("location")).toBe(false);
      assertPrivate(response);
    }
    expect(await server.accountSession(request("/private", { headers: { cookie: "private-user-cookie" } }))).toBeNull();
    expect(calls).toBe(0);
  });

  test("any arbitrary mutation of a required deployment coordinate remains disabled", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("AICHARTS_USAGE_AUTH_ENABLED", "VERCEL", "VERCEL_ENV", "NEXT_PUBLIC_SITE_URL"),
      fc.anything(),
      async (key, value) => {
        if (value === ready[key]) return;
        let calls = 0;
        const server = createUsageAuthServer({ environment: () => ({ ...ready, [key]: value }), fetch: async () => { calls += 1; throw new Error("must not fetch"); } });
        const response = await server.handle(request("/api/suite-auth/start"));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual(unavailable);
        expect(response.headers.has("set-cookie")).toBe(false);
        expect(await server.accountSession(request("/private"))).toBeNull();
        expect(calls).toBe(0);
      },
    ), { numRuns: 200 });
  });

  test("rejects all Preview markers, non-production targets, and invalid secrets", async () => {
    const invalid: UsageAuthEnvironment[] = [
      { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" },
      { VERCEL_TARGET_ENV: "preview" }, { VERCEL_TARGET_ENV: "" }, { VERCEL_TARGET_ENV: null },
      { NEXT_PUBLIC_SITE_URL: "https://aicharts.io/" },
      ...["NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN"].flatMap(key =>
        ["https://aicharts-change.vercel.app", "", null, false].map(value => ({ [key]: value })),
      ),
      ...[undefined, null, false, "", "x".repeat(31), "x".repeat(1_025), "🙂".repeat(257)].map(value => ({ SUITE_OIDC_COOKIE_SECRET: value })),
    ];
    for (const environment of invalid) {
      const server = createUsageAuthServer({ environment: () => ({ ...ready, ...environment }) });
      const response = await server.handle(request("/api/suite-auth/start"));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(unavailable);
      expect(response.headers.has("set-cookie")).toBe(false);
      assertPrivate(response);
    }
  });

  test("starts only the exact browser PKCE client with secure encrypted cookies", async () => {
    const f = await fixture();
    const { response, authorization } = await f.start();
    expect(f.calls).toEqual([]);
    expect(authorization.origin + authorization.pathname).toBe(endpoints.authorize);
    expect(authorization.searchParams.get("client_id")).toBe(clientId);
    expect(authorization.searchParams.get("redirect_uri")).toBe(`${origin}/api/suite-auth/callback`);
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("prompt")).toBe("login");
    expect(authorization.searchParams.get("scope")).toBe("openid profile email offline_access");
    const cookie = response.headers.getSetCookie()[0];
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(flag);
    expect(cookie).not.toContain(secret);
    expect(cookie).not.toContain(authorization.searchParams.get("nonce")!);
    assertPrivate(response);
  });

  test("does not trust lookalike URLs or forwarded canonical host headers", async () => {
    const f = await fixture();
    for (const host of ["http://localhost:3000", "https://aicharts-change.vercel.app", "https://www.aicharts.io", "https://aicharts.io.evil.example", "http://aicharts.io"]) {
      const req = new Request(`${host}/api/suite-auth/start`, { headers: { host: "aicharts.io", "x-forwarded-host": "aicharts.io", "x-forwarded-proto": "https" } });
      const response = await f.server.handle(req);
      expect(response.status).toBe(403);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(await f.server.accountSession(req)).toBeNull();
      assertPrivate(response);
    }
    expect(f.calls).toEqual([]);
  });

  test("exposes only five exact paths and methods, with no native or receipt routes", async () => {
    const f = await fixture();
    for (const path of ["link-receipt", "entitlements/ack", "device", "server-session", "start/", "%73tart", "session/extra"]) {
      const response = await f.server.handle(request(`/api/suite-auth/${path}`, { method: "POST" }));
      expect(response.status).toBe(404);
      expect(response.headers.has("set-cookie")).toBe(false);
      assertPrivate(response);
    }
    for (const [path, allowed] of [["start", "GET"], ["callback", "GET"], ["session", "GET"], ["refresh", "POST"], ["sign-out", "POST"]]) {
      for (const method of ["GET", "POST", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"].filter(value => value !== allowed)) {
        const response = await f.server.handle(request(`/api/suite-auth/${path}`, { method }));
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe(allowed);
        expect(response.headers.has("set-cookie")).toBe(false);
        if (method === "HEAD") expect(await response.text()).toBe("");
        assertPrivate(response);
      }
    }
    expect(f.calls).toEqual([]);
  });

  test("retains SDK CSRF, return-path and callback state checks", async () => {
    const f = await fixture();
    const rejectedHeaders: readonly Record<string, string>[] = [
      {}, { origin: "https://foreign.example" }, { origin, "sec-fetch-site": "cross-site" },
    ];
    for (const path of ["refresh", "sign-out"]) {
      for (const headers of rejectedHeaders) {
        const response = await f.server.handle(request(`/api/suite-auth/${path}`, { method: "POST", headers }));
        expect(response.status).toBe(403);
        assertPrivate(response);
      }
    }
    for (const returnTo of ["https://foreign.example/private", "//foreign.example", "/api/suite-auth/start", "/\\foreign.example"]) {
      const response = await f.server.handle(request(`/api/suite-auth/start?return_to=${encodeURIComponent(returnTo)}`));
      expect(response.status).toBe(400);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(await response.text()).not.toContain(returnTo);
    }
    const { response: started } = await f.start();
    const rejected = await f.server.handle(request("/api/suite-auth/callback?code=private-code&state=invalid-state", {
      headers: { cookie: cookieFrom(started, "transaction"), "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    }));
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).not.toContain("private-code");
    expect(f.calls).toEqual([]);
    assertPrivate(rejected);
  });

  test("projects only a live verified account and expiry, never provider credentials", async () => {
    const f = await fixture();
    const { response, cookie } = await f.login();
    expect(response.headers.getSetCookie()).toHaveLength(2);
    assertPrivate(response);
    const accountRequest = request("/private", { headers: { cookie, "sec-fetch-site": "same-origin" } });
    const session = await f.server.accountSession(accountRequest);
    expect(session).toEqual({ suiteAccountId: accountId, expiresAtMs: nowMs + 600_000 });
    expect(Object.isFrozen(session)).toBe(true);
    const browser = await f.server.handle(request("/api/suite-auth/session", { headers: { cookie } }));
    expect(browser.status).toBe(200);
    const browserText = await browser.text();
    expect(JSON.parse(browserText)).toMatchObject({ kind: "signed_in", session: { suiteAccountId: accountId, profileComplete: false } });
    const returned = `${await response.text()} ${JSON.stringify(response.headers.getSetCookie())} ${browserText} ${JSON.stringify(session)}`;
    for (const value of f.secrets()) expect(returned).not.toContain(value);
    expect(f.calls).toEqual([endpoints.discovery, endpoints.token, endpoints.jwks, endpoints.userInfo]);
    assertPrivate(browser);

    f.userInfo({ suite_account_id: "acct_018f1f7a7a367ccdbd5d706d4dc5c019" });
    expect(await f.server.accountSession(accountRequest)).toBeNull();
    f.userInfo({ suite_client_id: "hraness:soundfish:production:v1" });
    expect(await f.server.accountSession(accountRequest)).toBeNull();
    f.userInfo({ sub: "another-synthetic-subject" });
    expect(await f.server.accountSession(accountRequest)).toBeNull();
    f.userInfo({});
    f.fail(endpoints.userInfo);
    expect(await f.server.accountSession(accountRequest)).toBeNull();
    f.fail(null);
    f.time(nowMs + 600_000);
    const calls = f.calls.length;
    expect(await f.server.accountSession(accountRequest)).toBeNull();
    expect(f.calls).toHaveLength(calls);
  });

  test("rotates refresh custody and clears both browser cookies on sign-out", async () => {
    const f = await fixture();
    const { cookie } = await f.login();
    const refreshed = await f.server.handle(request("/api/suite-auth/refresh", { method: "POST", headers: { cookie, origin } }));
    expect(refreshed.status).toBe(200);
    const refreshedCookie = cookieFrom(refreshed, "session");
    expect(refreshedCookie).not.toBe(cookie);
    const refreshBody = await refreshed.text();
    for (const value of f.secrets()) expect(refreshBody).not.toContain(value);
    expect(f.tokenBodies.map(body => body.get("grant_type"))).toEqual(["authorization_code", "refresh_token"]);
    const signedOut = await f.server.handle(request("/api/suite-auth/sign-out", { method: "POST", headers: { cookie: refreshedCookie, origin } }));
    expect(signedOut.status).toBe(200);
    expect(await signedOut.json()).toEqual({ kind: "signed_out" });
    expect(signedOut.headers.getSetCookie()).toHaveLength(2);
    for (const cleared of signedOut.headers.getSetCookie()) expect(cleared).toContain("Max-Age=0");
    expect(f.calls).toContain(endpoints.revoke);
    assertPrivate(refreshed);
    assertPrivate(signedOut);
  });

  test("arbitrary cookies never establish an account or reach the provider", async () => {
    let calls = 0;
    const server = createUsageAuthServer({ environment: () => ready, fetch: async () => { calls += 1; throw new Error("must not fetch"); } });
    await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async bytes => {
      const cookie = `__Host-hraness-suite-oidc-session=${Buffer.from(bytes).toString("base64url")}`;
      const response = await server.handle(request("/api/suite-auth/session", { headers: { cookie } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ kind: "signed_out" });
      expect(await server.accountSession(request("/private", { headers: { cookie } }))).toBeNull();
      assertPrivate(response);
    }), { numRuns: 200 });
    expect(calls).toBe(0);
  });

  test("provider failure clears the transaction without leaking upstream details", async () => {
    const f = await fixture();
    const { response: started, authorization } = await f.start();
    f.fail(endpoints.discovery);
    const response = await f.server.handle(request(`/api/suite-auth/callback?code=private-code&state=${authorization.searchParams.get("state")}`, {
      headers: { cookie: cookieFrom(started, "transaction"), "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    }));
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("synthetic-private-provider-failure");
    expect(text).not.toContain("private-code");
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain("Max-Age=0");
    expect(response.headers.getSetCookie()[0]).toStartWith("__Host-hraness-suite-oidc-transaction=");
    expect(f.calls).toEqual([endpoints.discovery]);
    assertPrivate(response);
  });

  test("rechecks deployment configuration for every request, including established sessions", async () => {
    const f = await fixture();
    const { cookie } = await f.login();
    const calls = f.calls.length;
    f.environment({ ...ready, AICHARTS_USAGE_AUTH_ENABLED: "0" });
    const response = await f.server.handle(request("/api/suite-auth/session", { headers: { cookie } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(unavailable);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await f.server.accountSession(request("/private", { headers: { cookie } }))).toBeNull();
    expect(f.calls).toHaveLength(calls);
    f.environment({ ...ready, VERCEL_TARGET_ENV: "production" });
    expect(await f.server.accountSession(request("/private", { headers: { cookie } }))).not.toBeNull();
  });

  test("keeps unexpected failures fixed and secret-free", async () => {
    const failure = "private-secret-and-provider-response";
    const invalidEnvironment = createUsageAuthServer({ environment: () => { throw new Error(failure); } });
    expect(await (await invalidEnvironment.handle(request("/api/suite-auth/start"))).json()).toEqual(unavailable);
    const invalidRandom = createUsageAuthServer({ environment: () => ready, randomBytes: () => { throw new Error(failure); } });
    const response = await invalidRandom.handle(request("/api/suite-auth/start?return_to=%2F"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "USAGE_AUTH_FAILED" }, schemaVersion: 1 });
    expect(response.headers.has("set-cookie")).toBe(false);
    assertPrivate(response);
  });

  test("routes every Next-supported verb through the same private boundary", async () => {
    const route = await import("../../app/api/suite-auth/[...path]/route");
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    for (const method of ["GET", "POST", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"] as const) {
      expect(route[method]).toBe(handleUsageAuth);
    }
  });
});

describe("dormant intent-bound pairing authentication", () => {
  test("records only the sealed attempt and signed account facts before returning the SDK continuation", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    expect(f.begun).toEqual([pairingInput]);
    expect(f.resolvedIntents).toEqual([intentId]);
    expect(f.calls).toEqual([]);
    expect(f.recorded).toEqual([]);
    expect(started.authorization.searchParams.get("prompt")).toBe("login");
    expect(started.authorization.searchParams.get("max_age")).toBe("0");
    for (const value of [intentId, browserNonce, attemptId, contextToken]) {
      expect(started.authorization.href).not.toContain(value);
      expect(started.response.headers.get("set-cookie")).not.toContain(value);
    }
    const response = await f.server.completePairingAuthentication(f.callback(started));
    expect(response.status).toBe(200);
    expect(f.resolvedIntents).toEqual([intentId, intentId]);
    expect(f.recorded).toEqual([{
      ...pairingInput, attemptId, contextToken, accountId,
      authTimeMs: nowMs, sessionExpiresAtMs: pairingAttempt.expiresAtMs,
    }]);
    expect(Object.isFrozen(f.begun[0])).toBe(true);
    expect(Object.isFrozen(f.recorded[0])).toBe(true);
    const cookie = cookieFrom(response, "session");
    const body = await response.text();
    for (const value of [...f.secrets(), intentId, browserNonce, attemptId, contextToken, accountId]) {
      expect(body).not.toContain(value);
      expect(response.headers.get("set-cookie")).not.toContain(value);
    }
    expect(f.calls).toEqual([endpoints.discovery, endpoints.token, endpoints.jwks]);
    assertPrivate(response);
    const session = await f.server.handle(request("/api/suite-auth/session", { headers: { cookie } }));
    expect(await session.json()).toMatchObject({ kind: "signed_in", session: { suiteAccountId: accountId } });
    expect(f.recorded).toHaveLength(1);
  });

  test("missing durable transport keeps both coordinator methods unavailable", async () => {
    const f = await fixture();
    await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "UNAVAILABLE", 503);
    await assertPairingFailure(await f.server.completePairingAuthentication(request("/api/suite-auth/callback?code=synthetic-code&state=private")), "UNAVAILABLE", 503);
    expect(f.calls).toEqual([]);
  });

  test("all disabled or Preview coordinates fence durable and provider calls", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    for (const changed of [
      { AICHARTS_USAGE_AUTH_ENABLED: "0" }, { AICHARTS_USAGE_AUTH_ENABLED: undefined },
      { VERCEL: "0" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" },
      { VERCEL_TARGET_ENV: "preview" }, { NEXT_PUBLIC_SITE_URL: "https://aicharts.io/" },
      { NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN: "https://preview.vercel.app" },
      { NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN: "" },
      { NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN: null }, { SUITE_OIDC_COOKIE_SECRET: "invalid" },
    ]) {
      f.environment({ ...ready, ...changed });
      await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "UNAVAILABLE", 503);
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(started)), "UNAVAILABLE", 503);
    }
    expect(f.begun).toHaveLength(1);
    expect(f.resolvedIntents).toEqual([intentId]);
    expect(f.recorded).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("requires exact same-origin GET initiation before resolving the durable intent", async () => {
    const f = await fixture({ pairing: true });
    const invalidRequests = [
      request("/api/suite-auth/start"),
      ...["cross-site", "same-site", "none"].map(site => request("/api/suite-auth/start", { headers: { "sec-fetch-site": site } })),
      request("/api/suite-auth/start", { headers: { "sec-fetch-site": "same-origin", origin: "https://foreign.example" } }),
      ...["POST", "PUT", "OPTIONS", "DELETE"].map(method => request("/api/suite-auth/start", { method, headers: { "sec-fetch-site": "same-origin" } })),
      ...["start/", "%73tart", "session", "callback", "start?return_to=%2F", "start?intentId=private", "start#private"].map(path =>
        request(`/api/suite-auth/${path}`, { headers: { "sec-fetch-site": "same-origin" } })),
      ...["http://localhost:3000", "https://preview.vercel.app", "https://www.aicharts.io", "https://aicharts.io.foreign.example", "http://aicharts.io"].map(host =>
        new Request(`${host}/api/suite-auth/start`, { headers: { "sec-fetch-site": "same-origin", host: "aicharts.io", "x-forwarded-host": "aicharts.io", "x-forwarded-proto": "https" } })),
    ];
    for (const invalid of invalidRequests) await assertPairingFailure(await f.server.startPairingAuthentication(invalid, pairingInput), "REJECTED", 403);
    expect(f.resolvedIntents).toEqual([]);
    expect(f.begun).toEqual([]);
    expect(f.calls).toEqual([]);
    const allowed = await f.server.startPairingAuthentication(request("/api/suite-auth/start", { headers: { "sec-fetch-site": "same-origin", origin } }), pairingInput);
    expect(allowed.status).toBe(302);
  });

  test("invalid start DTOs cannot invoke getters, select an intent or reflect input", async () => {
    const f = await fixture({ pairing: true });
    let getterCalls = 0;
    const getter = Object.defineProperty({ browserNonce }, "intentId", { enumerable: true, get: () => { getterCalls++; return intentId; } });
    const invalid: unknown[] = [
      null, undefined, false, 1, "private-durable-reply", [], [pairingInput], {},
      { intentId }, { browserNonce }, { ...pairingInput, accountId },
      { ...pairingInput, [Symbol("private")]: "private-durable-reply" },
      Object.create(pairingInput), new Date(nowMs), getter,
      ...["", "0".repeat(64), "A".repeat(64), "f".repeat(63), "f".repeat(65), "g".repeat(64), null, 17].flatMap(value =>
        [{ ...pairingInput, intentId: value }, { ...pairingInput, browserNonce: value }]),
    ];
    for (const input of invalid) await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), input), "REJECTED", 400);
    expect(getterCalls).toBe(0);
    expect(f.resolvedIntents).toEqual([]);
    expect(f.begun).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("arbitrary untrusted start values remain total and cannot reach the durable port", async () => {
    const f = await fixture({ pairing: true });
    const malformed = fc.anything().filter(value => value === null || typeof value !== "object"
      || !Object.hasOwn(value, "intentId") || !Object.hasOwn(value, "browserNonce"));
    await fc.assert(fc.asyncProperty(malformed, async value => {
      await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), { ...pairingInput, unexpected: value }), "REJECTED", 400);
      await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), value), "REJECTED", 400);
    }), { numRuns: 200 });
    expect(f.begun).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("revoked proxies and throwing durable resolution produce fixed failures", async () => {
    const f = await fixture({ pairing: true });
    const revoked = Proxy.revocable(pairingInput, {});
    revoked.revoke();
    await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), revoked.proxy), "FAILED", 503);
    const server = createUsageAuthServer({
      environment: () => ready, now: () => nowMs,
      pairingIntent: () => { throw new Error("private-durable-reply"); },
      fetch: async () => { throw new Error("Provider must remain untouched."); },
    });
    await assertPairingFailure(await server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
  });

  test("snapshots caller-owned IDs before an asynchronous durable reply", async () => {
    const f = await fixture({ pairing: true });
    const mutable = { ...pairingInput };
    f.beginEffect(() => {
      mutable.intentId = "5e".repeat(32);
      mutable.browserNonce = "6f".repeat(32);
      return { ok: true, value: { ...pairingAttempt } };
    });
    const response = await f.server.completePairingAuthentication(f.callback(await f.startPairing(mutable)));
    expect(response.status).toBe(200);
    expect(f.begun).toEqual([pairingInput]);
    expect(f.recorded).toEqual([{ ...pairingInput, attemptId, contextToken, accountId, authTimeMs: nowMs, sessionExpiresAtMs: pairingAttempt.expiresAtMs }]);
  });

  test("waits for a single durable start reply before issuing a transaction cookie", async () => {
    const f = await fixture({ pairing: true });
    const entered = deferred<void>();
    const reply = deferred<unknown>();
    f.beginEffect(() => { entered.resolve(); return reply.promise; });
    const pending = f.server.startPairingAuthentication(pairingStartRequest(), pairingInput);
    await entered.promise;
    expect(f.begun).toHaveLength(1);
    expect(f.recorded).toEqual([]);
    expect(f.calls).toEqual([]);
    reply.resolve({ ok: true, value: { ...pairingAttempt } });
    expect((await pending).status).toBe(302);
    expect(f.begun).toHaveLength(1);
  });

  test("rejects malformed, oversized or expired durable start results without creating a cookie", async () => {
    const f = await fixture({ pairing: true });
    const malformed: unknown[] = [
      undefined, null, false, {}, { ok: false, error: "private-durable-reply" },
      { ok: true, value: pairingAttempt, extra: "private-durable-reply" },
      { ok: 1, value: pairingAttempt }, { ok: true, value: { ...pairingAttempt, extra: true } },
      ...["attemptId", "contextToken"].flatMap(key => ["0".repeat(64), "A".repeat(64), "private-durable-reply"].map(value =>
        ({ ok: true, value: { ...pairingAttempt, [key]: value } }))),
      ...[-1, NaN, Infinity, nowMs + 1, nowMs - 0.5].map(startedAtMs => ({ ok: true, value: { ...pairingAttempt, startedAtMs } })),
      ...[-1, NaN, Infinity, nowMs, nowMs + 600_001, nowMs + 0.5].map(expiresAtMs => ({ ok: true, value: { ...pairingAttempt, expiresAtMs } })),
    ];
    for (const value of malformed) {
      f.beginEffect(() => value);
      await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
    }
    expect(f.begun).toHaveLength(malformed.length);
    expect(f.recorded).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("does not evaluate getters on durable envelopes or attempt values", async () => {
    const f = await fixture({ pairing: true });
    let getterCalls = 0;
    const get = () => { getterCalls++; return pairingAttempt; };
    for (const value of [
      Object.defineProperty({ ok: true }, "value", { enumerable: true, get }),
      { ok: true, value: Object.defineProperty({ ...pairingAttempt }, "attemptId", { enumerable: true, get }) },
    ]) {
      f.beginEffect(() => value);
      await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
    }
    expect(getterCalls).toBe(0);
  });

  test("a failed or lost start reply is not retried or converted to ordinary login", async () => {
    const f = await fixture({ pairing: true });
    f.beginEffect(() => { throw new Error("private-durable-reply"); });
    await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
    expect(f.begun).toHaveLength(1);
    expect(f.calls).toEqual([]);
    expect(f.recorded).toEqual([]);
  });

  test("fence changes, expiry or clock regression while awaiting start suppress the cookie", async () => {
    for (const effect of [
      (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, AICHARTS_USAGE_AUTH_ENABLED: "0" }),
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(pairingAttempt.expiresAtMs),
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(nowMs - 1),
    ]) {
      const f = await fixture({ pairing: true });
      f.beginEffect(() => { effect(f); return { ok: true, value: { ...pairingAttempt } }; });
      await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
      expect(f.begun).toHaveLength(1);
      expect(f.recorded).toEqual([]);
      expect(f.calls).toEqual([]);
    }
  });

  test("ordinary login, refresh and account sessions cannot become pairing authentication", async () => {
    const f = await fixture({ pairing: true });
    const ordinary = await f.start();
    await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(ordinary)));
    expect(f.calls).toEqual([]);
    expect(f.resolvedIntents).toEqual([]);
    const { cookie } = await f.login();
    const requestWithSession = request("/api/suite-auth/callback?code=synthetic-code&state=private", { headers: { cookie } });
    await assertPairingFailure(await f.server.completePairingAuthentication(requestWithSession));
    expect(await f.server.accountSession(request("/private", { headers: { cookie } }))).not.toBeNull();
    const refreshed = await f.server.handle(request("/api/suite-auth/refresh", { method: "POST", headers: { cookie, origin } }));
    expect(refreshed.status).toBe(200);
    expect(f.begun).toEqual([]);
    expect(f.recorded).toEqual([]);
  });

  test("generic callback refuses a fresh transaction before contacting the provider", async () => {
    const f = await fixture({ pairing: true });
    await assertPairingFailure(await f.server.handle(f.callback(await f.startPairing())));
    expect(f.calls).toEqual([]);
    expect(f.recorded).toEqual([]);
    for (const path of ["pairing", "pairing/start", "pairing/callback", "approve", "confirm", "enroll"]) {
      const response = await f.server.handle(request(`/api/suite-auth/${path}`, { method: "POST" }));
      expect(response.status).toBe(404);
      expect(response.headers.has("set-cookie")).toBe(false);
    }
    expect(f.begun).toHaveLength(1);
  });

  test("state, callback origin and transaction tampering fail before any durable record", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    const valid = f.callback(started);
    const wrongState = new URL(valid.url);
    wrongState.searchParams.set("state", "private-invalid-state");
    const encrypted = cookieFrom(started.response, "transaction");
    const equals = encrypted.indexOf("=");
    const tampered = `${encrypted.slice(0, equals + 1)}${encrypted[equals + 1] === "A" ? "B" : "A"}${encrypted.slice(equals + 2)}`;
    for (const invalid of [
      new Request(wrongState, valid),
      new Request(valid.url.replace(origin, "https://foreign.example"), valid),
      new Request(valid.url, { headers: { ...Object.fromEntries(valid.headers), cookie: tampered } }),
      new Request(valid.url, { method: "POST", headers: valid.headers }),
    ]) await assertPairingFailure(await f.server.completePairingAuthentication(invalid));
    expect(f.recorded).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("a valid signature on unrelated or malformed action context cannot select a durable intent", async () => {
    const f = await fixture({ pairing: true });
    const contexts = [
      "another_product_context_" + "A".repeat(100),
      "aicharts_pairing_v2_" + "A".repeat(171),
      "aicharts_pairing_v1_" + "A".repeat(170),
      "aicharts_pairing_v1_" + "A".repeat(171),
      "aicharts_pairing_v1_" + "A".repeat(170) + "B",
    ];
    for (const context of contexts) {
      const started = await f.startUnrelatedContext(context);
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(started)), "FAILED", 503);
    }
    expect(f.calls).toHaveLength(contexts.length * 3);
    expect(f.resolvedIntents).toEqual([]);
    expect(f.begun).toEqual([]);
    expect(f.recorded).toEqual([]);
  });

  test("missing, stale, future or malformed signed authentication time cannot record an attempt", async () => {
    for (const auth_time of [undefined, null, "1800000300", nowMs, nowMs / 1_000 - 1, nowMs / 1_000 + 1, nowMs / 1_000 + 0.5]) {
      const f = await fixture({ pairing: true });
      f.idToken({ auth_time });
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(await f.startPairing())));
      expect(f.tokenBodies).toHaveLength(1);
      expect(f.recorded).toEqual([]);
    }
  });

  test("wrong signed audience, nonce or account cannot cross the durable record boundary", async () => {
    for (const claim of [
      { aud: "hraness:soundfish:production:v1" }, { aud: [clientId] },
      { azp: "hraness:soundfish:production:v1" }, { nonce: "private-invalid-nonce" },
      { suite_account_id: "acct_018f1f7a7a367ccdbd5d706d4dc5c019" },
      { nbf: nowMs / 1_000 + 1 }, { iat: nowMs / 1_000 + 1 }, { exp: nowMs / 1_000 },
    ]) {
      const f = await fixture({ pairing: true });
      f.idToken(claim);
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(await f.startPairing())));
      expect(f.recorded).toEqual([]);
    }
  });

  test("records the earliest transaction, ID-token or access-token expiry", async () => {
    for (const source of ["transaction", "id-token", "access-token"] as const) {
      const f = await fixture({ pairing: true });
      const earliest = nowMs + 60_000;
      if (source === "transaction") f.beginEffect(() => ({ ok: true, value: { ...pairingAttempt, expiresAtMs: earliest } }));
      if (source === "id-token") f.idToken({ exp: earliest / 1_000 });
      if (source === "access-token") f.accessToken({ exp: earliest / 1_000 });
      const response = await f.server.completePairingAuthentication(f.callback(await f.startPairing()));
      expect(response.status).toBe(200);
      expect(f.recorded).toEqual([{ ...pairingInput, attemptId, contextToken, accountId, authTimeMs: nowMs, sessionExpiresAtMs: earliest }]);
    }
  });

  test("provider failure, delayed expiry or regression does not record authentication", async () => {
    for (const effect of [
      (f: Awaited<ReturnType<typeof fixture>>) => f.fail(endpoints.jwks),
      (f: Awaited<ReturnType<typeof fixture>>) => f.providerEffect(url => { if (url === endpoints.jwks) f.time(pairingAttempt.expiresAtMs); }),
      (f: Awaited<ReturnType<typeof fixture>>) => f.providerEffect(url => { if (url === endpoints.jwks) f.time(nowMs - 1); }),
    ]) {
      const f = await fixture({ pairing: true });
      const started = await f.startPairing();
      effect(f);
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(started)));
      expect(f.recorded).toEqual([]);
      expect(f.resolvedIntents).toEqual([intentId]);
    }
  });

  test("a deployment fence change during provider verification prevents durable recording", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    f.providerEffect(url => { if (url === endpoints.jwks) f.environment({ ...ready, VERCEL_ENV: "preview" }); });
    await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(started)), "FAILED", 503);
    expect(f.recorded).toEqual([]);
    expect(f.resolvedIntents).toEqual([intentId]);
  });

  test("a disabled or rotated deployment stops the next provider dispatch", async () => {
    for (const change of [
      { AICHARTS_USAGE_AUTH_ENABLED: "0" },
      { SUITE_OIDC_COOKIE_SECRET: "synthetic-rotated-cookie-secret-not-for-deployment-0002" },
    ]) {
      const f = await fixture({ pairing: true });
      const started = await f.startPairing();
      f.providerEffect(url => { if (url === endpoints.discovery) f.environment({ ...ready, ...change }); });
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(started)));
      expect(f.calls).toEqual([endpoints.discovery]);
      expect(f.tokenBodies).toEqual([]);
      expect(f.recorded).toEqual([]);
    }
  });

  test("cookie-secret rotation while starting or recording cannot return a success cookie", async () => {
    const rotated = { ...ready, SUITE_OIDC_COOKIE_SECRET: "synthetic-rotated-cookie-secret-not-for-deployment-0002" };
    for (const phase of ["begin", "transaction-seal", "session-seal", "record"] as const) {
      const f = await fixture({ pairing: true });
      if (phase === "begin") f.beginEffect(() => { f.environment(rotated); return { ok: true, value: { ...pairingAttempt } }; });
      if (phase === "transaction-seal") f.randomEffect(length => { if (length === 12) f.environment(rotated); });
      if (phase === "begin" || phase === "transaction-seal") {
        await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
        expect(f.calls).toEqual([]);
        expect(f.recorded).toEqual([]);
      } else {
        const started = await f.startPairing();
        if (phase === "session-seal") f.randomEffect(length => { if (length === 12) f.environment(rotated); });
        if (phase === "record") f.recordEffect(() => { f.environment(rotated); return { ok: true, value: { recorded: true } }; });
        await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(started)), "FAILED", 503);
        expect(f.recorded).toHaveLength(phase === "record" ? 1 : 0);
      }
      expect(f.begun).toHaveLength(1);
    }
  });

  test("clock regression from a later observation fails even when the original transaction is still live", async () => {
    for (const phase of ["transaction-seal", "provider", "record"] as const) {
      const f = await fixture({ pairing: true });
      if (phase === "transaction-seal") {
        f.beginEffect(() => { f.time(nowMs + 100); return { ok: true, value: { ...pairingAttempt } }; });
        f.randomEffect(length => { if (length === 12) f.time(nowMs + 50); });
        await assertPairingFailure(await f.server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
        expect(f.recorded).toEqual([]);
      } else {
        const started = await f.startPairing();
        if (phase === "provider") {
          f.time(nowMs + 100);
          f.providerEffect(url => { if (url === endpoints.jwks) f.time(nowMs + 50); });
        } else {
          f.providerEffect(url => { if (url === endpoints.jwks) f.time(nowMs + 100); });
          f.recordEffect(() => { f.time(nowMs + 50); return { ok: true, value: { recorded: true } }; });
        }
        await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(started)), "FAILED", 503);
        expect(f.recorded).toHaveLength(phase === "record" ? 1 : 0);
      }
    }
  });

  test("awaits durable recording before exposing the success cookie or continuation", async () => {
    const f = await fixture({ pairing: true });
    const entered = deferred<void>();
    const reply = deferred<unknown>();
    let completed = false;
    f.recordEffect(() => { entered.resolve(); return reply.promise; });
    const pending = f.server.completePairingAuthentication(f.callback(await f.startPairing())).then(response => { completed = true; return response; });
    await entered.promise;
    expect(completed).toBe(false);
    expect(f.recorded).toHaveLength(1);
    reply.resolve({ ok: true, value: { recorded: true } });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(cookieFrom(response, "session")).toBeTruthy();
    expect(f.recorded).toHaveLength(1);
    expect(f.tokenBodies).toHaveLength(1);
  });

  test("a failed, conflicting or malformed durable record reply suppresses the already-created SDK response", async () => {
    const malformed: unknown[] = [
      undefined, null, false, {}, { ok: false, error: "conflict" }, { ok: false, error: "expired" },
      { ok: false, error: "private-durable-reply" }, { ok: true, value: { recorded: false } },
      { ok: true, value: { recorded: 1 } }, { ok: true, value: { recorded: true, accountId } },
      { ok: true, value: { recorded: true }, extra: "private-durable-reply" },
    ];
    for (const result of malformed) {
      const f = await fixture({ pairing: true });
      f.recordEffect(() => result);
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(await f.startPairing())), "FAILED", 503);
      expect(f.recorded).toHaveLength(1);
      expect(f.tokenBodies).toHaveLength(1);
    }
  });

  test("a committed record with a lost reply remains uncertain and is never retried automatically", async () => {
    const f = await fixture({ pairing: true });
    let durableCommits = 0;
    f.recordEffect(() => { durableCommits++; throw new Error("private-durable-reply"); });
    await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(await f.startPairing())), "FAILED", 503);
    expect(durableCommits).toBe(1);
    expect(f.recorded).toHaveLength(1);
    expect(f.begun).toHaveLength(1);
    expect(f.tokenBodies).toHaveLength(1);
  });

  test("record-result getters cannot manufacture a successful durable acknowledgment", async () => {
    const f = await fixture({ pairing: true });
    let getterCalls = 0;
    f.recordEffect(() => ({ ok: true, value: Object.defineProperty({}, "recorded", { enumerable: true, get: () => { getterCalls++; return true; } }) }));
    await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(await f.startPairing())), "FAILED", 503);
    expect(getterCalls).toBe(0);
    expect(f.recorded).toHaveLength(1);
  });

  test("expiry, clock regression or a disabled deployment after durable recording suppresses continuation", async () => {
    for (const effect of [
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(pairingAttempt.expiresAtMs),
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(nowMs - 1),
      (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, AICHARTS_USAGE_AUTH_ENABLED: "0" }),
    ]) {
      const f = await fixture({ pairing: true });
      f.recordEffect(() => { effect(f); return { ok: true, value: { recorded: true } }; });
      await assertPairingFailure(await f.server.completePairingAuthentication(f.callback(await f.startPairing())), "FAILED", 503);
      expect(f.recorded).toHaveLength(1);
      expect(f.tokenBodies).toHaveLength(1);
    }
  });

  test("arbitrary valid opaque identifiers survive the sealed SDK round trip without text disclosure", async () => {
    const f = await fixture({ pairing: true });
    const opaque = fc.uint8Array({ minLength: 32, maxLength: 32 }).filter(bytes => bytes.some(value => value !== 0)).map(bytes => Buffer.from(bytes).toString("hex"));
    await fc.assert(fc.asyncProperty(opaque, opaque, opaque, opaque, async (intentId, browserNonce, attemptId, contextToken) => {
      f.beginEffect(() => ({ ok: true, value: { ...pairingAttempt, attemptId, contextToken } }));
      const started = await f.startPairing({ intentId, browserNonce });
      const response = await f.server.completePairingAuthentication(f.callback(started));
      expect(response.status).toBe(200);
      expect(f.recorded.at(-1)).toEqual({ intentId, browserNonce, attemptId, contextToken, accountId, authTimeMs: nowMs, sessionExpiresAtMs: pairingAttempt.expiresAtMs });
      expect(f.resolvedIntents.at(-1)).toBe(intentId);
      const body = await response.text();
      for (const value of [intentId, browserNonce, attemptId, contextToken]) {
        expect(started.authorization.href).not.toContain(value);
        expect(body).not.toContain(value);
      }
    }), { numRuns: 200 });
    expect(f.begun).toHaveLength(200);
    expect(f.recorded).toHaveLength(200);
    expect(f.tokenBodies).toHaveLength(200);
  });
});
