import { describe, expect, mock, test } from "bun:test";
import { createSuiteOidcRelyingParty } from "@hraness/suite-accounts/oidc-rp";
import { fc } from "../property-test";
import type { UsageAuthEnvironment } from "./auth-server";

// Next enforces this import boundary in the application build. Bun tests run
// server code directly, without replacing the SDK or its cryptographic checks.
mock.module("server-only", () => ({}));
const { createUsageAuthServer, handleUsageAuth } = await import("./auth-server");
const { sealPairingCustody } = await import("./pairing-custody");

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
const pairingInput = { intentId };
const pairingAttempt = { attemptId, contextToken, startedAtMs: nowMs, expiresAtMs: nowMs + 300_000 };
const pairingStartRequest = () => request("/api/suite-auth/start", { headers: { "sec-fetch-site": "same-origin" } });
const pairingCookieName = "__Host-aicharts-usage-pairing";
// These tests run sequentially. Each fixture resets its synthetic cookie
// canaries so every shared view/error assertion checks current browser custody.
const cookieCanaries = new Set<string>();
type BrowserView = {
  state: "pending" | "browser-approved" | "terminal-confirmed" | "denied" | "expired";
  expiresAtMs: number;
  accountId: string | null;
  authenticationExpiresAtMs: number | null;
};
const verifiedBrowserView: BrowserView = {
  state: "pending", expiresAtMs: pairingAttempt.expiresAtMs,
  accountId, authenticationExpiresAtMs: pairingAttempt.expiresAtMs,
};

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

function cookieFrom(response: Response, name: "session" | "transaction" | "pairing"): string {
  const prefix = name === "pairing" ? pairingCookieName : `__Host-hraness-suite-oidc-${name}`;
  const value = response.headers.getSetCookie().find(cookie =>
    cookie.startsWith(`${prefix}=`),
  );
  if (value === undefined) throw new Error(`Missing synthetic ${name} cookie.`);
  const cookie = value.split(";", 1)[0];
  cookieCanaries.add(cookie.slice(cookie.indexOf("=") + 1));
  return cookie;
}

function approvalRequest(cookie: string, body?: unknown): Request {
  return request("/api/usage/pairing", body === undefined
    ? { headers: { cookie, "sec-fetch-site": "same-origin" } }
    : { method: "POST", headers: { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body) });
}

function withCookie(original: Request, cookie: string): Request {
  const headers = new Headers(original.headers);
  headers.set("cookie", cookie);
  return new Request(original, { headers });
}

async function approvalProjection(response: Response) {
  expect(response.status).toBe(200);
  assertPrivate(response);
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("location")).toBe(false);
  const value: unknown = await response.json();
  const visible = `${JSON.stringify(value)} ${JSON.stringify([...response.headers])}`;
  for (const canary of cookieCanaries) expect(visible).not.toContain(canary);
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || !("schemaVersion" in value) || value.schemaVersion !== 1
    || !("state" in value) || typeof value.state !== "string"
    || !("accountId" in value) || typeof value.accountId !== "string"
    || !("expiresAtMs" in value) || typeof value.expiresAtMs !== "number"
    || !("csrfToken" in value) || typeof value.csrfToken !== "string") throw new Error("Expected a bounded approval projection.");
  expect(Object.keys(value).sort()).toEqual(["schemaVersion", "state", "accountId", "expiresAtMs", "csrfToken"].sort());
  expect(["pending", "browser-approved", "terminal-confirmed", "denied"]).toContain(value.state);
  expect(value.accountId).toMatch(/^acct_[0-9a-f]{32}$/u);
  expect(Number.isSafeInteger(value.expiresAtMs) && value.expiresAtMs > 0).toBe(true);
  expect(value.csrfToken).toMatch(/^[0-9a-f]{64}$/u);
  expect(value.csrfToken).not.toBe("0".repeat(64));
  return {
    value: { schemaVersion: value.schemaVersion, state: value.state, accountId: value.accountId, expiresAtMs: value.expiresAtMs, csrfToken: value.csrfToken },
    csrfToken: value.csrfToken,
  };
}

async function assertPairingFailure(response: Response, code?: "UNAVAILABLE" | "REJECTED" | "FAILED", status?: number): Promise<void> {
  expect(response.status).toBeGreaterThanOrEqual(400);
  if (status !== undefined) expect(response.status).toBe(status);
  expect(response.headers.has("location")).toBe(false);
  for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain("Max-Age=0");
  const body = await response.text();
  const visible = `${body} ${JSON.stringify([...response.headers])}`;
  for (const canary of cookieCanaries) expect(visible).not.toContain(canary);
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
  cookieCanaries.clear();
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
  let ownedNonce = "";
  let latestCustody = "";
  let browserView: BrowserView = { ...verifiedBrowserView, accountId: null, authenticationExpiresAtMs: null };
  let beginEffect: (input: unknown) => unknown | Promise<unknown> = () => ({ ok: true, value: { ...pairingAttempt } });
  let recordEffect: (input: unknown) => unknown | Promise<unknown> = () => { browserView = { ...verifiedBrowserView }; return { ok: true, value: { recorded: true } }; };
  let statusEffect: (input: unknown) => unknown | Promise<unknown> = () => ({ ok: true, value: { ...browserView } });
  let decisionEffect: (input: unknown) => unknown | Promise<unknown> = input => {
    if (input === null || typeof input !== "object" || !("decision" in input)) throw new Error("Expected an owned decision DTO.");
    browserView = { ...browserView, state: input.decision === "approve" ? "browser-approved" : "denied" };
    return { ok: true, value: { ...browserView } };
  };
  const calls: string[] = [];
  const tokenBodies: URLSearchParams[] = [];
  const resolvedIntents: string[] = [];
  const begun: unknown[] = [];
  const recorded: unknown[] = [];
  const statusReads: unknown[] = [];
  const decisions: unknown[] = [];

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
        beginBrowserAttempt: async (input: unknown) => {
          begun.push(input);
          if (input === null || typeof input !== "object" || !("browserNonce" in input) || typeof input.browserNonce !== "string") throw new Error("Expected the server-generated nonce.");
          ownedNonce = input.browserNonce;
          return beginEffect(input);
        },
        recordVerifiedAuthentication: async (input: unknown) => { recorded.push(input); return recordEffect(input); },
        browserStatus: async (input: unknown) => { statusReads.push(input); return statusEffect(input); },
        decideBrowser: async (input: unknown) => { decisions.push(input); return decisionEffect(input); },
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
    const started = captureStart(await server.startPairingAuthentication(pairingStartRequest(), input));
    latestCustody = cookieFrom(started.response, "pairing");
    return started;
  }

  async function startUnrelatedContext(context: string) {
    const authority = createSuiteOidcRelyingParty({
      consumer: "aicharts", environment: "production", cookieSecret: secret,
      receiptKeyVersion: "identity-v1", now: () => clockMs,
      fetch: async () => { throw new Error("Fresh start must not contact a provider."); },
    });
    const response = await authority.startFreshAuthentication(pairingStartRequest(), { context, expiresAtMs: nowMs + 300_000 });
    if (latestCustody !== "") response.headers.append("set-cookie", latestCustody);
    return captureStart(response);
  }

  function callback(started: { response: Response; authorization: URL }) {
    return request(`/api/suite-auth/callback?code=synthetic-code&state=${started.authorization.searchParams.get("state")}`, {
      headers: {
        cookie: started.response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; "),
        "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document",
      },
    });
  }

  async function login() {
    const response = await server.handle(callback(await start()));
    expect(response.status).toBe(200);
    return { response, cookie: cookieFrom(response, "session") };
  }

  async function pairedLogin() {
    const started = await startPairing();
    const response = await server.completePairingAuthentication(callback(started));
    expect(response.status).toBe(200);
    return { started, response, cookie: `${cookieFrom(response, "session")}; ${cookieFrom(started.response, "pairing")}` };
  }

  function proof() {
    return { intentId, attemptId, browserNonce: ownedNonce, contextToken };
  }

  return {
    server, calls, tokenBodies, start, login, startPairing, startUnrelatedContext, callback, pairedLogin, proof,
    resolvedIntents, begun, recorded, statusReads, decisions,
    browserNonce: () => ownedNonce,
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
    statusEffect: (effect: typeof statusEffect) => { statusEffect = effect; },
    decisionEffect: (effect: typeof decisionEffect) => { decisionEffect = effect; },
    browserView: (value: BrowserView) => { browserView = value; },
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
    expect(f.begun).toEqual([{ ...pairingInput, browserNonce: f.browserNonce() }]);
    expect(f.browserNonce()).toMatch(/^[0-9a-f]{64}$/u);
    expect(f.browserNonce()).not.toBe("0".repeat(64));
    expect(f.resolvedIntents).toEqual([intentId]);
    expect(f.calls).toEqual([]);
    expect(f.recorded).toEqual([]);
    expect(started.authorization.searchParams.get("prompt")).toBe("login");
    expect(started.authorization.searchParams.get("max_age")).toBe("0");
    for (const value of [intentId, f.browserNonce(), attemptId, contextToken]) {
      expect(started.authorization.href).not.toContain(value);
      expect(started.response.headers.get("set-cookie")).not.toContain(value);
    }
    const response = await f.server.completePairingAuthentication(f.callback(started));
    expect(response.status).toBe(200);
    expect(f.resolvedIntents).toEqual([intentId, intentId]);
    expect(f.recorded).toEqual([{
      ...f.proof(), accountId,
      authTimeMs: nowMs, sessionExpiresAtMs: pairingAttempt.expiresAtMs,
    }]);
    expect(Object.isFrozen(f.begun[0])).toBe(true);
    expect(Object.isFrozen(f.recorded[0])).toBe(true);
    const cookie = cookieFrom(response, "session");
    const body = await response.text();
    for (const value of [...f.secrets(), intentId, f.browserNonce(), attemptId, contextToken, accountId]) {
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
    const getter = Object.defineProperty({}, "intentId", { enumerable: true, get: () => { getterCalls++; return intentId; } });
    const invalid: unknown[] = [
      null, undefined, false, 1, "private-durable-reply", [], [pairingInput], {},
      { intentId, browserNonce }, { browserNonce }, { ...pairingInput, accountId },
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
    const malformed = fc.anything().filter(value => value === null || typeof value !== "object" || !Object.hasOwn(value, "intentId"));
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
      Object.assign(mutable, { browserNonce: "6f".repeat(32) });
      return { ok: true, value: { ...pairingAttempt } };
    });
    const response = await f.server.completePairingAuthentication(f.callback(await f.startPairing(mutable)));
    expect(response.status).toBe(200);
    expect(f.begun).toEqual([{ ...pairingInput, browserNonce: f.browserNonce() }]);
    expect(f.recorded).toEqual([{ ...f.proof(), accountId, authTimeMs: nowMs, sessionExpiresAtMs: pairingAttempt.expiresAtMs }]);
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
    await f.startPairing();
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
    expect(f.resolvedIntents).toEqual([intentId]);
    expect(f.begun).toHaveLength(1);
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
      expect(f.recorded).toEqual([{ ...f.proof(), accountId, authTimeMs: nowMs, sessionExpiresAtMs: earliest }]);
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
    const nonces = new Set<string>();
    await fc.assert(fc.asyncProperty(opaque, opaque, opaque, async (intentId, attemptId, contextToken) => {
      f.beginEffect(() => ({ ok: true, value: { ...pairingAttempt, attemptId, contextToken } }));
      const started = await f.startPairing({ intentId });
      const browserNonce = f.browserNonce();
      expect(browserNonce).toMatch(/^[0-9a-f]{64}$/u);
      expect(nonces.has(browserNonce)).toBe(false);
      nonces.add(browserNonce);
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

describe("browser-held pairing custody and explicit approval", () => {
  test("issues a separate bounded encrypted Host cookie with server-owned nonce custody", async () => {
    const f = await fixture({ pairing: true });
    const first = await f.startPairing();
    const firstNonce = f.browserNonce();
    const custody = first.response.headers.getSetCookie().find(value => value.startsWith(`${pairingCookieName}=`))!;
    expect(first.response.headers.getSetCookie()).toHaveLength(2);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(custody).toContain(flag);
    expect(custody).not.toContain("Domain=");
    expect(custody.length).toBeLessThan(4_096);
    for (const value of [secret, intentId, firstNonce, attemptId, contextToken]) expect(custody).not.toContain(value);
    const second = await f.startPairing();
    expect(f.browserNonce()).not.toBe(firstNonce);
    expect(cookieFrom(second.response, "pairing")).not.toBe(cookieFrom(first.response, "pairing"));
    expect(f.calls).toEqual([]);
  });

  test("invalid or repeated generated tokens fail before creating a durable browser attempt", async () => {
    for (const randomBytes of [
      () => new Uint8Array(0),
      (length: number) => new Uint8Array(length),
      (length: number) => new Uint8Array(length).fill(1),
    ]) {
      let resolved = 0;
      const server = createUsageAuthServer({
        environment: () => ready, now: () => nowMs, randomBytes,
        pairingIntent: () => { resolved++; throw new Error("Unexpected durable resolution."); },
        fetch: async () => { throw new Error("Unexpected provider call."); },
      });
      await assertPairingFailure(await server.startPairingAuthentication(pairingStartRequest(), pairingInput), "FAILED", 503);
      expect(resolved).toBe(0);
    }
  });

  test("missing, malformed or duplicate custody cookies fail before exchanging an OAuth code", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    const transaction = cookieFrom(started.response, "transaction");
    const custody = cookieFrom(started.response, "pairing");
    const value = custody.slice(custody.indexOf("=") + 1);
    const changed = `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const noncanonical = `${value.slice(0, -1)}${alphabet[alphabet.indexOf(value.at(-1)!) + 1]}`;
    expect(Buffer.from(noncanonical, "base64url")).toEqual(Buffer.from(value, "base64url"));
    for (const header of [
      transaction,
      `${transaction}; ${pairingCookieName}=`,
      `${transaction}; ${pairingCookieName}=private-durable-reply`,
      `${transaction}; ${pairingCookieName}=${changed}`,
      `${transaction}; ${pairingCookieName}=${value}=`,
      `${transaction}; ${pairingCookieName}=${noncanonical}`,
      `${transaction}; ${custody}; ${custody}`,
      `${transaction}; ${custody}; ${pairingCookieName}=conflicting-value`,
      `${transaction}; ${pairingCookieName}=${"A".repeat(4_097)}`,
    ]) await assertPairingFailure(await f.server.completePairingAuthentication(withCookie(f.callback(started), header)), "REJECTED", 403);
    expect(f.calls).toEqual([]);
    expect(f.recorded).toEqual([]);
    expect(f.resolvedIntents).toEqual([intentId]);
  });

  test("an SDK transaction cannot be relabeled as pairing custody", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    const transaction = cookieFrom(started.response, "transaction");
    const relabeled = `${pairingCookieName}=${transaction.slice(transaction.indexOf("=") + 1)}`;
    await assertPairingFailure(await f.server.completePairingAuthentication(withCookie(f.callback(started), `${transaction}; ${relabeled}`)), "REJECTED", 403);
    expect(f.calls).toEqual([]);
    expect(f.recorded).toEqual([]);
  });

  test("a valid custody cookie from another attempt cannot bind this signed completion", async () => {
    const f = await fixture({ pairing: true });
    const first = await f.startPairing();
    const firstNonce = f.browserNonce();
    const second = await f.startPairing();
    expect(f.browserNonce()).not.toBe(firstNonce);
    const mixed = `${cookieFrom(second.response, "transaction")}; ${cookieFrom(first.response, "pairing")}`;
    await assertPairingFailure(await f.server.completePairingAuthentication(withCookie(f.callback(second), mixed)), "FAILED", 503);
    expect(f.recorded).toEqual([]);
    expect(f.resolvedIntents).toEqual([intentId, intentId]);
  });

  test("the final durable-record await cannot outlive a shorter authenticated custody deadline", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    const custodyExpiresAtMs = nowMs + 60_000;
    // Exercise two independently authenticated lifetimes with the same proof:
    // the SDK transaction remains live after this shorter custody expires.
    const sealed = await sealPairingCustody({
      ...f.proof(), csrfToken: "7e".repeat(32), issuedAtMs: nowMs, expiresAtMs: custodyExpiresAtMs,
    }, secret, length => crypto.getRandomValues(new Uint8Array(length)));
    cookieCanaries.add(sealed);
    f.recordEffect(() => { f.time(custodyExpiresAtMs); return { ok: true, value: { recorded: true } }; });
    const cookie = `${cookieFrom(started.response, "transaction")}; ${pairingCookieName}=${sealed}`;
    await assertPairingFailure(await f.server.completePairingAuthentication(withCookie(f.callback(started), cookie)), "FAILED", 503);
    expect(f.recorded).toEqual([{ ...f.proof(), accountId, authTimeMs: nowMs, sessionExpiresAtMs: pairingAttempt.expiresAtMs }]);
    expect(f.tokenBodies).toHaveLength(1);
  });

  test("callback input cannot override the owned proof and cannot approve the attempt", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    const callback = f.callback(started);
    const url = new URL(callback.url);
    for (const [key, value] of Object.entries({ intentId: "5e".repeat(32), browserNonce, accountId: "acct_018f1f7a7a367ccdbd5d706d4dc5c019", decision: "approve" })) url.searchParams.set(key, value);
    const response = await f.server.completePairingAuthentication(new Request(url, callback));
    expect(response.status).toBe(200);
    expect(f.recorded).toEqual([{ ...f.proof(), accountId, authTimeMs: nowMs, sessionExpiresAtMs: pairingAttempt.expiresAtMs }]);
    expect(f.decisions).toEqual([]);
    expect(response.headers.getSetCookie().some(value => value.startsWith(`${pairingCookieName}=`))).toBe(false);
  });

  test("read exposes only the live account, deadline, state and per-attempt CSRF token", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const result = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
    expect(result.value).toEqual({ schemaVersion: 1, state: "pending", accountId, expiresAtMs: pairingAttempt.expiresAtMs, csrfToken: result.csrfToken });
    expect(result.csrfToken).not.toBe(f.browserNonce());
    expect(f.statusReads).toEqual([f.proof()]);
    expect(Object.isFrozen(f.statusReads[0])).toBe(true);
    expect(f.calls.filter(url => url === endpoints.userInfo)).toHaveLength(1);
    expect(f.decisions).toEqual([]);
    const visible = JSON.stringify(result.value);
    for (const value of [...f.secrets(), intentId, attemptId, contextToken, f.browserNonce()]) expect(visible).not.toContain(value);
  });

  test("a valid explicit approve or deny POST sends only the owned proof and live account facts", async () => {
    for (const decision of ["approve", "deny"] as const) {
      const f = await fixture({ pairing: true });
      const { cookie } = await f.pairedLogin();
      const read = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
      const decided = await approvalProjection(await f.server.decidePairingApproval(approvalRequest(cookie, { decision, csrfToken: read.csrfToken })));
      expect(decided.value).toEqual({ schemaVersion: 1, state: decision === "approve" ? "browser-approved" : "denied", accountId, expiresAtMs: pairingAttempt.expiresAtMs, csrfToken: read.csrfToken });
      expect(f.decisions).toEqual([{ ...f.proof(), accountId, liveSessionExpiresAtMs: nowMs + 600_000, decision }]);
      expect(Object.isFrozen(f.decisions[0])).toBe(true);
      expect(f.recorded).toHaveLength(1);
      expect(f.begun).toHaveLength(1);
      expect(f.calls.filter(url => url === endpoints.userInfo)).toHaveLength(2);
    }
  });

  test("ordinary sign-in without the paired browser cookie cannot read or decide an intent", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.login();
    const before = f.calls.length;
    await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookie)), "REJECTED", 403);
    await assertPairingFailure(await f.server.decidePairingApproval(approvalRequest(cookie, { decision: "approve", csrfToken: browserNonce })), "REJECTED", 403);
    expect(f.calls).toHaveLength(before);
    expect(f.statusReads).toEqual([]);
    expect(f.decisions).toEqual([]);
  });

  test("a pairing cookie without a live signed-in session cannot expose approval state", async () => {
    const f = await fixture({ pairing: true });
    const started = await f.startPairing();
    await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookieFrom(started.response, "pairing"))), "REJECTED", 403);
    expect(f.statusReads).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.decisions).toEqual([]);
  });

  test("approval endpoints enforce exact origins, methods, paths and metadata before any provider work", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const before = f.calls.length;
    const readHeaders = { cookie, "sec-fetch-site": "same-origin" };
    const postHeaders = { ...readHeaders, origin, "content-type": "application/json" };
    const body = JSON.stringify({ decision: "approve", csrfToken: browserNonce });
    const reads = [
      request("/api/usage/pairing", { headers: { cookie } }),
      ...["same-site", "cross-site", "none"].map(site => request("/api/usage/pairing", { headers: { cookie, "sec-fetch-site": site } })),
      request("/api/usage/pairing", { headers: { ...readHeaders, origin: "https://foreign.example" } }),
      ...["pairing/", "%70airing", "pairing?intentId=private", "pairing#private", "other"].map(path => request(`/api/usage/${path}`, { headers: readHeaders })),
      new Request("https://foreign.example/api/usage/pairing", { headers: { ...readHeaders, "x-forwarded-host": "aicharts.io" } }),
      request("/api/usage/pairing", { method: "POST", headers: readHeaders }),
    ];
    const posts = [
      request("/api/usage/pairing", { headers: readHeaders }),
      request("/api/usage/pairing", { method: "PUT", headers: postHeaders, body }),
      request("/api/usage/pairing", { method: "POST", headers: readHeaders, body }),
      request("/api/usage/pairing", { method: "POST", headers: { ...postHeaders, origin: "https://foreign.example" }, body }),
      request("/api/usage/pairing", { method: "POST", headers: { ...postHeaders, "sec-fetch-site": "cross-site" }, body }),
      request("/api/usage/pairing?decision=approve", { method: "POST", headers: postHeaders, body }),
      new Request("https://aicharts-preview.vercel.app/api/usage/pairing", { method: "POST", headers: { ...postHeaders, "x-forwarded-host": "aicharts.io" }, body }),
    ];
    for (const invalid of reads) await assertPairingFailure(await f.server.readPairingApproval(invalid), "REJECTED", 403);
    for (const invalid of posts) await assertPairingFailure(await f.server.decidePairingApproval(invalid), "REJECTED", 403);
    expect(f.calls).toHaveLength(before);
    expect(f.statusReads).toEqual([]);
    expect(f.decisions).toEqual([]);
  });

  test("malformed decision bodies cannot add account facts or reach any provider or durable operation", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
    const before = { provider: f.calls.length, reads: f.statusReads.length };
    for (const body of [
      null, false, 1, [], "approve", {}, { decision: "approve" }, { csrfToken },
      { decision: "confirm", csrfToken }, { decision: "Approve", csrfToken },
      { decision: "approve", csrfToken, accountId }, { decision: "approve", csrfToken, ...f.proof() },
      ...["", "0".repeat(64), "A".repeat(64), "f".repeat(63), "f".repeat(65), 1, null].map(value => ({ decision: "approve", csrfToken: value })),
    ]) await assertPairingFailure(await f.server.decidePairingApproval(approvalRequest(cookie, body)), "REJECTED", 400);
    for (const body of ["", "{", "{\"decision\":\"approve\",\"csrfToken\":\"private\"}", "[\"approve\"]"]) {
      await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", { method: "POST", headers: { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body })), "REJECTED", 400);
    }
    expect(f.calls).toHaveLength(before.provider);
    expect(f.statusReads).toHaveLength(before.reads);
    expect(f.decisions).toEqual([]);
  });

  test("incorrect or stale per-attempt CSRF tokens fail before live account lookup", async () => {
    const f = await fixture({ pairing: true });
    const first = await f.pairedLogin();
    const firstRead = await approvalProjection(await f.server.readPairingApproval(approvalRequest(first.cookie)));
    const second = await f.pairedLogin();
    const secondRead = await approvalProjection(await f.server.readPairingApproval(approvalRequest(second.cookie)));
    expect(firstRead.csrfToken).not.toBe(secondRead.csrfToken);
    const before = { provider: f.calls.length, reads: f.statusReads.length };
    for (const csrfToken of [firstRead.csrfToken, browserNonce]) {
      await assertPairingFailure(await f.server.decidePairingApproval(approvalRequest(second.cookie, { decision: "approve", csrfToken })), "REJECTED", 403);
    }
    expect(f.calls).toHaveLength(before.provider);
    expect(f.statusReads).toHaveLength(before.reads);
    expect(f.decisions).toEqual([]);
  });

  test("rejects oversized, non-JSON and invalid UTF-8 bodies without trusting Content-Length", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
    const headers = { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const before = { provider: f.calls.length, reads: f.statusReads.length };
    const valid = JSON.stringify({ decision: "approve", csrfToken });
    for (const [body, extra] of [
      [valid.padEnd(513, " "), {}],
      [valid.padEnd(513, " "), { "content-length": "1" }],
      [valid, { "content-length": "513" }],
      [valid, { "content-type": "text/plain" }],
      [valid, { "content-type": "application/x-www-form-urlencoded" }],
      [new Uint8Array([0xff, 0xfe, 0xfd]), {}],
    ] as const) {
      await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", { method: "POST", headers: { ...headers, ...extra }, body })), "REJECTED", 400);
    }
    expect(f.calls).toHaveLength(before.provider);
    expect(f.statusReads).toHaveLength(before.reads);
    expect(f.decisions).toEqual([]);
  });

  test("bounded stream reading stops after the body crosses 512 bytes", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    let pulled = 0;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled++; controller.enqueue(new Uint8Array(300).fill(32)); },
      cancel() { cancelled++; },
    });
    await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", {
      method: "POST", headers: { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "content-length": "1" }, body,
    })), "REJECTED", 400);
    expect(pulled).toBeLessThanOrEqual(3);
    expect(cancelled).toBe(1);
    expect(f.statusReads).toEqual([]);
    expect(f.decisions).toEqual([]);
  });

  test("an immediately available empty-chunk stream is refused and cancelled without spinning", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const before = f.calls.length;
    let pulled = 0;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 10) throw new Error("Empty request chunks were not bounded.");
        controller.enqueue(new Uint8Array(0));
      },
      cancel() { cancelled++; },
    });
    await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", {
      method: "POST", headers: { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body,
    })), "REJECTED", 400);
    expect(pulled).toBeLessThanOrEqual(2);
    expect(cancelled).toBe(1);
    expect(f.calls).toHaveLength(before);
    expect(f.statusReads).toEqual([]);
    expect(f.decisions).toEqual([]);
  });

  test("canonical decision parsing rejects duplicate keys, alternate encodings and compressed input", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
    const before = { provider: f.calls.length, reads: f.statusReads.length };
    const headers = { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const canonical = JSON.stringify({ decision: "approve", csrfToken });
    const bodies = [
      ` ${canonical}`, `${canonical}\n`, JSON.stringify({ csrfToken, decision: "approve" }),
      `{"decision":"deny","decision":"approve","csrfToken":"${csrfToken}"}`,
      `{"decision":"approve","csrfToken":"${browserNonce}","csrfToken":"${csrfToken}"}`,
      canonical.replace("decision", "\\u0064ecision"),
    ];
    for (const body of bodies) await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", { method: "POST", headers, body })), "REJECTED", 400);
    const invalidHeaders: readonly Readonly<Record<string, string>>[] = [
      { "content-encoding": "gzip" }, { "content-encoding": "identity" },
      { "content-type": "application/json; charset=utf-8" },
      ...["-1", "+1", "01", "1e2", "Infinity", "513"].map(value => ({ "content-length": value })),
    ];
    for (const extra of invalidHeaders) {
      const invalid = new Headers({ ...headers, ...extra });
      await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", { method: "POST", headers: invalid, body: canonical })), "REJECTED", 400);
    }
    expect(f.calls).toHaveLength(before.provider);
    expect(f.statusReads).toHaveLength(before.reads);
    expect(f.decisions).toEqual([]);
  });

  test("a stalled request body times out and cancels without a provider call or durable mutation", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const before = f.calls.length;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
    await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", {
      method: "POST", headers: { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body,
    })), "REJECTED", 400);
    expect(cancelled).toBe(1);
    expect(f.calls).toHaveLength(before);
    expect(f.statusReads).toEqual([]);
    expect(f.decisions).toEqual([]);
  }, 10_000);

  test("a request-body failure remains private and never triggers live account lookup", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const before = f.calls.length;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private-durable-reply")); } });
    await assertPairingFailure(await f.server.decidePairingApproval(request("/api/usage/pairing", {
      method: "POST", headers: { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body,
    })), "REJECTED", 400);
    expect(f.calls).toHaveLength(before);
    expect(f.statusReads).toEqual([]);
    expect(f.decisions).toEqual([]);
  });

  test("configuration or deadline changes while reading a decision body prevent later provider work", async () => {
    for (const change of [
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(pairingAttempt.expiresAtMs),
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(nowMs + 50),
      (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, AICHARTS_USAGE_AUTH_ENABLED: "0" }),
      (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, SUITE_OIDC_COOKIE_SECRET: "synthetic-rotated-cookie-secret-not-for-deployment-0002" }),
    ]) {
      const f = await fixture({ pairing: true });
      const { cookie } = await f.pairedLogin();
      const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
      f.time(nowMs + 100);
      const before = { provider: f.calls.length, reads: f.statusReads.length };
      const content = new TextEncoder().encode(JSON.stringify({ decision: "approve", csrfToken }));
      const entered = deferred<void>();
      const release = deferred<void>();
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          pulls++;
          if (pulls === 1) controller.enqueue(content.subarray(0, 20));
          else {
            entered.resolve();
            await release.promise;
            controller.enqueue(content.subarray(20));
            controller.close();
          }
        },
      });
      const pending = f.server.decidePairingApproval(request("/api/usage/pairing", {
        method: "POST", headers: { cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body,
      }));
      await entered.promise;
      change(f);
      release.resolve();
      await assertPairingFailure(await pending, "FAILED", 503);
      expect(f.calls).toHaveLength(before.provider);
      expect(f.statusReads).toHaveLength(before.reads);
      expect(f.decisions).toEqual([]);
    }
  });

  test("changed, revoked or unavailable live accounts cannot read or approve recorded authentication", async () => {
    for (const change of [
      (f: Awaited<ReturnType<typeof fixture>>) => f.userInfo({ suite_account_id: "acct_018f1f7a7a367ccdbd5d706d4dc5c019" }),
      (f: Awaited<ReturnType<typeof fixture>>) => f.userInfo({ suite_client_id: "hraness:soundfish:production:v1" }),
      (f: Awaited<ReturnType<typeof fixture>>) => f.userInfo({ sub: "changed-synthetic-subject" }),
      (f: Awaited<ReturnType<typeof fixture>>) => f.fail(endpoints.userInfo),
    ]) {
      const f = await fixture({ pairing: true });
      const { cookie } = await f.pairedLogin();
      const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
      const before = f.statusReads.length;
      change(f);
      await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookie)), "REJECTED", 403);
      await assertPairingFailure(await f.server.decidePairingApproval(approvalRequest(cookie, { decision: "approve", csrfToken })), "REJECTED", 403);
      expect(f.statusReads).toHaveLength(before);
      expect(f.decisions).toEqual([]);
    }
  });

  test("unrecorded, expired or different durable accounts cannot expose approval state", async () => {
    for (const value of [
      { ...verifiedBrowserView, accountId: null, authenticationExpiresAtMs: null },
      { ...verifiedBrowserView, accountId: "acct_018f1f7a7a367ccdbd5d706d4dc5c019" },
      { ...verifiedBrowserView, state: "expired" },
      { ...verifiedBrowserView, authenticationExpiresAtMs: nowMs },
    ]) {
      const f = await fixture({ pairing: true });
      const { cookie } = await f.pairedLogin();
      f.statusEffect(() => ({ ok: true, value }));
      await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookie)));
      expect(f.statusReads).toHaveLength(1);
      expect(f.decisions).toEqual([]);
    }
  });

  test("strict durable status shape rejects extra fields, getters and malformed time or state", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    let getterCalls = 0;
    const malformed: unknown[] = [
      undefined, null, false, {}, { ok: false, error: "private-durable-reply" },
      { ok: true, value: verifiedBrowserView, extra: true },
      { ok: true, value: { ...verifiedBrowserView, csrfToken: browserNonce } },
      { ok: true, value: { ...verifiedBrowserView, state: "enrolled" } },
      { ok: true, value: Object.defineProperty({ ...verifiedBrowserView }, "accountId", { enumerable: true, get: () => { getterCalls++; return accountId; } }) },
      ...[-1, NaN, Infinity, nowMs + 0.5].flatMap(time => [
        { ok: true, value: { ...verifiedBrowserView, expiresAtMs: time } },
        { ok: true, value: { ...verifiedBrowserView, authenticationExpiresAtMs: time } },
      ]),
    ];
    for (const value of malformed) {
      f.statusEffect(() => value);
      await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookie)), "FAILED", 503);
    }
    expect(getterCalls).toBe(0);
    expect(f.decisions).toEqual([]);
  });

  test("readback accepts only recorded lifecycle states without deciding or enrolling", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    for (const state of ["pending", "browser-approved", "terminal-confirmed", "denied"] as const) {
      f.browserView({ ...verifiedBrowserView, state });
      const result = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
      expect(result.value).toMatchObject({ state, accountId });
    }
    expect(f.decisions).toEqual([]);
    expect(f.recorded).toHaveLength(1);
  });

  test("reported approval expiry is the earliest shared intent deadline, live session or authentication expiry", async () => {
    for (const source of ["intent", "session", "authentication"] as const) {
      const f = await fixture({ pairing: true });
      const earlier = nowMs + 60_000;
      if (source === "intent") f.beginEffect(() => ({ ok: true, value: { ...pairingAttempt, expiresAtMs: earlier } }));
      if (source === "session") f.accessToken({ exp: earlier / 1_000 });
      const { cookie } = await f.pairedLogin();
      f.browserView({
        ...verifiedBrowserView,
        expiresAtMs: source === "intent" ? earlier : pairingAttempt.expiresAtMs,
        authenticationExpiresAtMs: source === "authentication" ? earlier : pairingAttempt.expiresAtMs,
      });
      const result = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
      expect(result.value).toMatchObject({ expiresAtMs: earlier });
    }
  });

  test("durable readback cannot shorten or extend the cookie's immutable intent lifetime", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    for (const expiresAtMs of [nowMs + 60_000, pairingAttempt.expiresAtMs + 1]) {
      f.statusEffect(() => ({ ok: true, value: { ...verifiedBrowserView, expiresAtMs } }));
      await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookie)), "FAILED", 503);
    }
    expect(f.decisions).toEqual([]);
  });

  test("disabled or rotated configuration fences approval and leaves no durable decisions", async () => {
    for (const change of [
      { AICHARTS_USAGE_AUTH_ENABLED: "0" }, { VERCEL_ENV: "preview" },
      { NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN: "https://preview.vercel.app" },
      { SUITE_OIDC_COOKIE_SECRET: "synthetic-rotated-cookie-secret-not-for-deployment-0002" },
    ]) {
      const f = await fixture({ pairing: true });
      const { cookie } = await f.pairedLogin();
      const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
      const before = { provider: f.calls.length, reads: f.statusReads.length };
      f.environment({ ...ready, ...change });
      await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookie)));
      await assertPairingFailure(await f.server.decidePairingApproval(approvalRequest(cookie, { decision: "approve", csrfToken })));
      expect(f.calls).toHaveLength(before.provider);
      expect(f.statusReads).toHaveLength(before.reads);
      expect(f.decisions).toEqual([]);
    }
  });

  test("expiry, observed-clock regression and rotation during status read prevent disclosure or decisions", async () => {
    for (const boundary of ["provider", "status"] as const) {
      for (const change of [
        (f: Awaited<ReturnType<typeof fixture>>) => f.time(pairingAttempt.expiresAtMs),
        (f: Awaited<ReturnType<typeof fixture>>) => f.time(nowMs + 50),
        (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, AICHARTS_USAGE_AUTH_ENABLED: "0" }),
        (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, SUITE_OIDC_COOKIE_SECRET: "synthetic-rotated-cookie-secret-not-for-deployment-0002" }),
      ]) {
        const f = await fixture({ pairing: true });
        const { cookie } = await f.pairedLogin();
        f.time(nowMs + 100);
        if (boundary === "provider") f.providerEffect(url => { if (url === endpoints.userInfo) change(f); });
        else f.statusEffect(() => { change(f); return { ok: true, value: { ...verifiedBrowserView } }; });
        await assertPairingFailure(await f.server.readPairingApproval(approvalRequest(cookie)));
        expect(f.statusReads).toHaveLength(boundary === "provider" ? 0 : 1);
        expect(f.decisions).toEqual([]);
      }
    }
  });

  test("uncertain decision replies retain custody for explicit readback and never retry the mutation", async () => {
    const f = await fixture({ pairing: true });
    const { cookie } = await f.pairedLogin();
    const read = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
    f.decisionEffect(() => {
      f.browserView({ ...verifiedBrowserView, state: "browser-approved" });
      throw new Error("private-durable-reply");
    });
    const uncertain = await f.server.decidePairingApproval(approvalRequest(cookie, { decision: "approve", csrfToken: read.csrfToken }));
    expect(uncertain.headers.has("set-cookie")).toBe(false);
    await assertPairingFailure(uncertain, "FAILED", 503);
    expect(f.decisions).toHaveLength(1);
    const reconciled = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
    expect(reconciled.value).toMatchObject({ state: "browser-approved", csrfToken: read.csrfToken });
    expect(f.decisions).toHaveLength(1);
    expect(f.recorded).toHaveLength(1);
  });

  test("malformed or contradictory decision readback never claims success", async () => {
    for (const decision of ["approve", "deny"] as const) {
      for (const value of [
        undefined,
        { ok: false, error: "private-durable-reply" },
        { ok: true, value: { ...verifiedBrowserView, state: decision === "approve" ? "denied" : "browser-approved" } },
        { ok: true, value: { ...verifiedBrowserView, state: "pending" } },
        { ok: true, value: { ...verifiedBrowserView, state: decision === "approve" ? "browser-approved" : "denied", accountId: "acct_018f1f7a7a367ccdbd5d706d4dc5c019" } },
        { ok: true, value: { ...verifiedBrowserView, state: decision === "approve" ? "browser-approved" : "denied", extra: true } },
      ]) {
        const f = await fixture({ pairing: true });
        const { cookie } = await f.pairedLogin();
        const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
        f.decisionEffect(() => value);
        await assertPairingFailure(await f.server.decidePairingApproval(approvalRequest(cookie, { decision, csrfToken })), "FAILED", 503);
        expect(f.decisions).toHaveLength(1);
      }
    }
  });

  test("deadline, configuration or clock changes after a committed decision suppress its response", async () => {
    for (const change of [
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(pairingAttempt.expiresAtMs),
      (f: Awaited<ReturnType<typeof fixture>>) => f.time(nowMs + 50),
      (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, AICHARTS_USAGE_AUTH_ENABLED: "0" }),
      (f: Awaited<ReturnType<typeof fixture>>) => f.environment({ ...ready, SUITE_OIDC_COOKIE_SECRET: "synthetic-rotated-cookie-secret-not-for-deployment-0002" }),
    ]) {
      const f = await fixture({ pairing: true });
      const { cookie } = await f.pairedLogin();
      const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
      f.time(nowMs + 100);
      f.decisionEffect(() => { change(f); return { ok: true, value: { ...verifiedBrowserView, state: "browser-approved" } }; });
      const response = await f.server.decidePairingApproval(approvalRequest(cookie, { decision: "approve", csrfToken }));
      expect(response.headers.has("set-cookie")).toBe(false);
      await assertPairingFailure(response, "FAILED", 503);
      expect(f.decisions).toHaveLength(1);
    }
  });

  test("arbitrary body fields and custody bytes cannot become an approval", async () => {
    const f = await fixture({ pairing: true });
    const { cookie, started } = await f.pairedLogin();
    const { csrfToken } = await approvalProjection(await f.server.readPairingApproval(approvalRequest(cookie)));
    const before = { provider: f.calls.length, reads: f.statusReads.length };
    await fc.assert(fc.asyncProperty(fc.jsonValue(), fc.uint8Array({ maxLength: 300 }), async (value, bytes) => {
      await assertPairingFailure(await f.server.decidePairingApproval(approvalRequest(cookie, { decision: "approve", csrfToken, unknown: value })), "REJECTED", 400);
      const transaction = cookieFrom(started.response, "transaction");
      const malformed = `${transaction}; ${pairingCookieName}=${Buffer.from(bytes).toString("base64url")}`;
      await assertPairingFailure(await f.server.completePairingAuthentication(withCookie(f.callback(started), malformed)), "REJECTED", 403);
    }), { numRuns: 200 });
    expect(f.calls).toHaveLength(before.provider);
    expect(f.statusReads).toHaveLength(before.reads);
    expect(f.decisions).toEqual([]);
  });

  test("public route dispatch still does not expose pairing read, decision or enrollment", async () => {
    const f = await fixture({ pairing: true });
    for (const path of ["/api/usage/pairing", "/api/usage/enroll", "/api/suite-auth/pairing", "/api/suite-auth/approve"]) {
      for (const method of ["GET", "POST"] as const) {
        const response = await f.server.handle(request(path, { method }));
        expect(response.status).toBe(404);
        assertPrivate(response);
      }
    }
    expect(f.calls).toEqual([]);
    expect(f.resolvedIntents).toEqual([]);
    expect(f.decisions).toEqual([]);
  });
});
