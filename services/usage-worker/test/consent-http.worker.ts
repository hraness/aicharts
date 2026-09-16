import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  decodeUsageConsentHttpResponse, encodeUsageConsentHttpRequest, USAGE_CONSENT_HTTP_URL,
} from "../../../lib/usage/consent-http-contract";
import { PAIRING_HTTP_MEDIA } from "../../../lib/usage/pairing-http-contract";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { createConsentHttpHandler, type ConsentHttpEnvironment } from "../src/consent-http";
import type { PairingHttpVerifier } from "../src/pairing-http";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import worker from "../src/index";

const NOW = Date.UTC(2026, 8, 11, 12);
let serial = 0, account = "", finished = 0;
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("synthetic_fixture_failed"); return result.value;
};

// Synthetic workload authority qualifies the runtime/RPC boundary, not provider JWTs.
const verifier: PairingHttpVerifier = { beginRequest() {
  const handle = Object.freeze({}); let open = true;
  return {
    async verify(token) { return token === "a.b.c" ? { ok: true, value: handle } : { ok: false, error: "unauthorized" }; },
    isCurrent(value) { return open && value === handle; },
    finish() { expect(open).toBe(true); open = false; finished++; },
  };
} };
const handler = () => createConsentHttpHandler({ verifier, now: Date.now,
  setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
const session = () => ({ schemaVersion: 1 as const, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS });
const request = (input: unknown = { ...session(), operation: "status" }, token = "a.b.c") => new Request(USAGE_CONSENT_HTTP_URL, {
  method: "POST", body: encodeUsageConsentHttpRequest(input),
  headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
});
async function call(input: unknown) {
  const actual: ConsentHttpEnvironment = env, ctx = createExecutionContext();
  try {
    const response = await handler()(request(input), actual, ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(PAIRING_HTTP_MEDIA);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBeLessThanOrEqual(1_024);
    const decoded = decodeUsageConsentHttpResponse(bytes);
    expect(decoded).not.toBeNull(); return decoded!;
  } finally { await waitOnExecutionContext(ctx); }
}
async function enroll() {
  const proof = { intentId: hex(serial * 10 + 1), pollSecret: hex(serial * 10 + 2), uploadSecret: hex(serial * 10 + 3) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), nonce = hex(serial * 10 + 4);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: nonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: nonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof));
  success(await env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account)).enroll(proof));
}
beforeEach(() => {
  account = `acct_${hex(++serial, 16)}`; finished = 0;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(object => object.key);
    if (keys.length) await bucket.delete(keys);
  }
  await reset();
});

test("the default Worker keeps the consent route unavailable", async () => {
  const ctx = createExecutionContext();
  try {
    const response = await worker.fetch(request({ ...session(), operation: "status" }), env, ctx);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"usage_service_unavailable"}');
  } finally { await waitOnExecutionContext(ctx); }
});

test("status and set cross real RPC disposal into bounded consent replies", async () => {
  await enroll();
  expect(await call({ ...session(), operation: "status" })).toEqual({ ok: true,
    value: { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null } });
  expect(await call({ ...session(), operation: "set", consent: true, publicHandle: "alpha-coder" }))
    .toEqual({ ok: true, value: { schemaVersion: 1, consent: true, consentedAtMs: NOW, publicHandle: "alpha-coder" } });
  expect(await call({ ...session(), operation: "status" })).toEqual({ ok: true,
    value: { schemaVersion: 1, consent: true, consentedAtMs: NOW, publicHandle: "alpha-coder" } });
  expect(await call({ ...session(), operation: "set", consent: false, publicHandle: null }))
    .toEqual({ ok: true, value: { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null } });
  expect(finished).toBe(4);
});

test("absent and wrong accounts keep their exact bounded results", async () => {
  expect(await call({ ...session(), operation: "status" })).toEqual({ ok: false, error: "not_enrolled" });
  await enroll();
  const foreign = { schemaVersion: 1 as const, accountId: `acct_${hex(9_999, 16)}`, sessionExpiresAtMs: NOW + PAIRING_TTL_MS };
  expect(await call({ ...foreign, operation: "status" })).toEqual({ ok: false, error: "not_enrolled" });
  expect(await call({ ...foreign, operation: "set", consent: true, publicHandle: "alpha-coder" }))
    .toEqual({ ok: false, error: "not_enrolled" });
  expect(finished).toBe(3);
});

test("workload failures and malformed frames refuse before namespace selection", async () => {
  let selected = 0;
  const actual: ConsentHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName(name) {
    selected++; return env.ACCOUNT_ENROLLMENTS.getByName(name);
  } } };
  for (const [token, status] of [["wrong.token.value", 401], ["a.b.c", 400]] as const) {
    const ctx = createExecutionContext();
    try {
      const body = status === 400 ? new TextEncoder().encode("not-the-contract") : encodeUsageConsentHttpRequest({ ...session(), operation: "status" });
      const response = await handler()(new Request(USAGE_CONSENT_HTTP_URL, { method: "POST", body,
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` } }), actual, ctx);
      expect(response.status).toBe(status);
    } finally { await waitOnExecutionContext(ctx); }
  }
  expect(selected).toBe(0); expect(finished).toBe(2);
});

test("GET and non-exact URLs refuse before verification", async () => {
  const actual: ConsentHttpEnvironment = env, ctx = createExecutionContext();
  try {
    expect((await handler()(new Request(USAGE_CONSENT_HTTP_URL, { method: "GET",
      headers: { accept: "application/json" } }), actual, ctx)).status).toBe(400);
    expect((await handler()(new Request("https://usage.aicharts.io/v1/consent", { method: "POST", body: "x",
      headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c" } }), actual, ctx)).status).toBe(400);
    expect((await handler()(new Request(USAGE_CONSENT_HTTP_URL, { method: "POST", body: "{}",
      headers: { "content-type": "application/json", accept: "application/json", cookie: "a=b",
        authorization: "Bearer a.b.c" } }), actual, ctx)).status).toBe(400);
  } finally { await waitOnExecutionContext(ctx); }
  expect(finished).toBe(0);
});
