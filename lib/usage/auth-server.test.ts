import { describe, expect, mock, test } from "bun:test";
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

/** Synthetic provider transport; the real SDK verifies these ES256 tokens. */
async function fixture() {
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
  const calls: string[] = [];
  const tokenBodies: URLSearchParams[] = [];

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
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
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
        });
        refreshToken = `synthetic-refresh-token-${tokenCount + 1}`;
        return Response.json({
          access_token: accessToken,
          id_token: await sign({ aud: clientId, nonce }),
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

  async function start() {
    const response = await server.handle(request("/api/suite-auth/start?return_to=%2F", { headers: { "sec-fetch-site": "same-origin" } }));
    expect(response.status).toBe(302);
    const authorization = new URL(response.headers.get("location")!);
    nonce = authorization.searchParams.get("nonce")!;
    challenge = authorization.searchParams.get("code_challenge")!;
    return { response, authorization };
  }

  async function login() {
    const started = await start();
    const callback = request(`/api/suite-auth/callback?code=synthetic-code&state=${started.authorization.searchParams.get("state")}`, {
      headers: {
        cookie: cookieFrom(started.response, "transaction"),
        "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document",
      },
    });
    const response = await server.handle(callback);
    expect(response.status).toBe(200);
    return { response, cookie: cookieFrom(response, "session") };
  }

  return {
    server, calls, tokenBodies, start, login,
    secrets: () => [secret, accessToken, refreshToken, providerSubject, "synthetic-reader@example.com"],
    environment: (value: UsageAuthEnvironment) => { environment = value; },
    time: (value: number) => { clockMs = value; },
    fail: (url: string | null) => { failAt = url; },
    userInfo: (value: Record<string, unknown>) => { userInfoOverrides = value; },
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
