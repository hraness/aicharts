import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  decodeLeaderboardHttpResponse, LEADERBOARD_HTTP_URL,
} from "../../../lib/usage/leaderboard-http-contract";
import { PAIRING_HTTP_MEDIA } from "../../../lib/usage/pairing-http-contract";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { createLeaderboardHttpHandler, type LeaderboardHttpEnvironment } from "../src/leaderboard-http";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import worker from "../src/index";

const NOW = Date.UTC(2026, 8, 11, 12);
let serial = 0, account = "";
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("synthetic_fixture_failed"); return result.value;
};
const handler = () => createLeaderboardHttpHandler({ now: Date.now,
  setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
const request = (headers: Record<string, string> = {}) => new Request(LEADERBOARD_HTTP_URL, {
  method: "GET", headers: { accept: "application/json", ...headers },
});
async function call(headers: Record<string, string> = {}) {
  const actual: LeaderboardHttpEnvironment = env, ctx = createExecutionContext();
  try {
    const response = await handler()(request(headers), actual, ctx);
    return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
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
  const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
  success(await stub.enroll(proof));
  return stub;
}
beforeEach(() => {
  account = `acct_${hex(++serial, 16)}`;
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

test("the default Worker keeps the public leaderboard route unavailable", async () => {
  const ctx = createExecutionContext();
  try {
    const response = await worker.fetch(request(), env, ctx);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"usage_service_unavailable"}');
  } finally { await waitOnExecutionContext(ctx); }
});

test("the anonymous read serves only the materialized snapshot", async () => {
  // No consent anywhere: an honest empty ranked snapshot.
  const first = await call();
  expect(first.response.status).toBe(200);
  expect(first.response.headers.get("content-type")).toBe(PAIRING_HTTP_MEDIA);
  expect(first.response.headers.get("cache-control")).toBe("public, max-age=60");
  expect(decodeLeaderboardHttpResponse(first.bytes)).toEqual({ ok: true, value: {
    schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs: NOW, entries: [] } });
  // Enroll and consent at the account; the next read materializes the member.
  const stub = await enroll();
  success(await stub.setLeaderboardConsent({ schemaVersion: 1, accountId: account,
    sessionExpiresAtMs: NOW + PAIRING_TTL_MS, operation: "set", consent: true, publicHandle: "alpha-coder" }));
  const second = await call();
  expect(second.response.status).toBe(200);
  const decoded = decodeLeaderboardHttpResponse(second.bytes);
  expect(decoded).toMatchObject({ ok: true, value: { entries: [{ rank: 1, publicHandle: "alpha-coder" }] } });
  expect(new TextDecoder().decode(second.bytes)).not.toContain(account);
});

test("the public boundary refuses identity, bodies, cookies and wrong shapes", async () => {
  const actual: LeaderboardHttpEnvironment = env;
  for (const init of [
    { method: "POST" }, { method: "HEAD" },
    { headers: { accept: "application/json", authorization: "Bearer x" } },
    { headers: { accept: "application/json", cookie: "a=b" } },
    { headers: { accept: "application/json", "content-type": "application/json" } },
    { headers: { accept: "application/json", "content-encoding": "gzip" } },
    { headers: { accept: "*/*" } },
    { method: "POST", headers: { accept: "application/json" }, body: "{}" },
  ] as const) {
    const ctx = createExecutionContext();
    try {
      const response = await handler()(new Request(LEADERBOARD_HTTP_URL, init as RequestInit), actual, ctx);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe('{"schemaVersion":1,"error":{"code":"invalid_request"}}');
    } finally { await waitOnExecutionContext(ctx); }
  }
  const ctx = createExecutionContext();
  try {
    const wrong = await handler()(new Request("https://usage.aicharts.io/v1/leaderboard/x",
      { headers: { accept: "application/json" } }), actual, ctx);
    expect(wrong.status).toBe(400);
  } finally { await waitOnExecutionContext(ctx); }
});

test("an unreachable index produces the fixed unavailable body", async () => {
  const actual: LeaderboardHttpEnvironment = { PUBLIC_INDEX: { getByName() {
    return { read() { throw new Error("INDEX_CANARY"); } };
  } } };
  const ctx = createExecutionContext();
  try {
    const response = await handler()(request(), actual, ctx);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"schemaVersion":1,"error":{"code":"leaderboard_unavailable"}}');
  } finally { await waitOnExecutionContext(ctx); }
});
