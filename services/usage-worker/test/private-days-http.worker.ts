import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { encodeAdmissionBatch, encodeAdmissionOperation } from "../../../lib/usage/admission";
import { decodePrivateDaysHttpResponse, encodePrivateDaysHttpRequest, PRIVATE_DAYS_HTTP_URL } from "../../../lib/usage/private-days-http-contract";
import { PAIRING_HTTP_MEDIA } from "../../../lib/usage/pairing-http-contract";
import { USAGE_FAILURE_HEADER, USAGE_FAILURE_STAGES } from "../../../lib/usage/usage-failure-contract";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { createPrivateDaysCoordinator } from "../src/private-days-coordinator";
import { createPrivateDaysHttpHandler, type PrivateDaysHttpEnvironment } from "../src/private-days-http";
import type { PairingHttpVerifier } from "../src/pairing-http";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import worker from "../src/index";

const NOW = Date.UTC(2026, 8, 11, 12), DAY = Math.floor(NOW / DAY_MS);
let serial = 0, account = "", finished = 0;
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("synthetic_fixture_failed"); return result.value;
};
const query = (dayCount = 3) => ({ schemaVersion: 1 as const, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS,
  firstUtcDay: DAY - 1, dayCount });
const totals = (usageOccurrences = 0, observedAccountedTokens = "0", observedOutputTokens = "0") =>
  ({ usageOccurrences, observedAccountedTokens, observedOutputTokens });

// Synthetic workload authority qualifies the runtime/RPC boundary, not provider JWTs.
const verifier: PairingHttpVerifier = { beginRequest() {
  const handle = Object.freeze({}); let open = true;
  return {
    async verify(token) { return token === "a.b.c" ? { ok: true, value: handle } : { ok: false, error: "unauthorized" }; },
    isCurrent(value) { return open && value === handle; },
    finish() { expect(open).toBe(true); open = false; finished++; },
  };
} };
const handler = () => createPrivateDaysHttpHandler({ verifier, now: Date.now,
  setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
const request = (input = query(), token = "a.b.c") => new Request(PRIVATE_DAYS_HTTP_URL, {
  method: "POST", body: encodePrivateDaysHttpRequest(input),
  headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
});
async function call(input = query()) {
  // Compile-time proof against the actual generated namespace, with no cast.
  const actual: PrivateDaysHttpEnvironment = env, ctx = createExecutionContext();
  try {
    const response = await handler()(request(input), actual, ctx);
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe(PAIRING_HTTP_MEDIA);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBeLessThanOrEqual(16_384);
    const decoded = decodePrivateDaysHttpResponse(bytes, input);
    expect(decoded).not.toBeNull(); return decoded!;
  } finally { await waitOnExecutionContext(ctx); }
}
async function enroll() {
  const proof = { intentId: hex(serial), pollSecret: hex(serial + 1_000), uploadSecret: hex(serial + 2_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(serial + 3_000);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, browserNonce, attemptId: attempt.attemptId, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof));
  const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
  const enrolled = success(await stub.enroll(proof));
  return { proof, stub, deviceId: admissionIdBytes(enrolled.receipt.deviceId) };
}
beforeEach(() => {
  account = `acct_${hex(++serial, 16)}`; finished = 0;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
});
afterEach(async () => {
  vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(item => item.key);
    if (keys.length > 0) await bucket.delete(keys);
  }
  await reset();
});

test("actual coordinator stays dormant and the default Worker remains unavailable", async () => {
  expect(typeof createPrivateDaysCoordinator()).toBe("function");
  const ctx = createExecutionContext();
  try {
    const response = await worker.fetch(new Request("https://usage.aicharts.io/"), env, ctx);
    expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"usage_service_unavailable"}');
  } finally { await waitOnExecutionContext(ctx); }
});

test("accepted Codex, Claude and Devin numeric heads cross real RPC disposal into a private daily response", async () => {
  const device = await enroll();
  const operations = ([1, 2, 3] as const).map(provider => {
    const occurrenceId = admissionIdBytes(hex(provider, 16));
    const frame = success(encodeUsageBatch({ utcDay: DAY, registryRevision: 1,
      usage: [{ id: occurrenceId, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1,
        provider, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
        tokens: { inputUncached: 10n, cacheRead: 2n, cacheWrite5m: provider === 2 ? 3n : 0n,
          cacheWrite1h: provider === 2 ? 7n : 0n, output: 5n, reasoningOutput: 2n } }], prompts: [], intervals: [],
    }, ADMISSION_POLICY_V1));
    return success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: device.deviceId,
      generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: 1, sequence: provider,
      occurrenceId, expectedHeadHash: new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  });
  success(await device.stub.admitBatch({ uploadSecret: device.proof.uploadSecret,
    batch: success(encodeAdmissionBatch(operations, ADMISSION_POLICY_V1)) }));
  const expected = { ok: true, value: { schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
    journalRevision: 1, journalCommittedAtMs: NOW, firstUtcDay: DAY - 1,
    days: [{ utcDay: DAY - 1, codex: totals(), claudeCode: totals(), devin: totals() },
      { utcDay: DAY, codex: totals(1, "17", "5"), claudeCode: totals(1, "27", "5"), devin: totals(1, "17", "5") },
      { utcDay: DAY + 1, codex: totals(), claudeCode: totals(), devin: totals() }] } };
  expect(await call()).toEqual(expected);
  success(await device.stub.revokeEnrollment(device.proof));
  expect(await call()).toEqual(expected); expect(finished).toBe(2);
});

test("actual absent and empty-account RPC results retain their exact bounded contracts", async () => {
  expect(await call()).toEqual({ ok: false, error: "not_enrolled" });
  await enroll();
  const result = success(await call(query(31)));
  expect(result.days).toHaveLength(31); expect(result.journalRevision).toBe(0); expect(result.journalCommittedAtMs).toBeNull();
  expect(result.days.every(day => day.codex.usageOccurrences === 0 && day.claudeCode.usageOccurrences === 0 && day.devin.usageOccurrences === 0)).toBe(true);
  expect(finished).toBe(2);
});

test("workload and session failures refuse before real namespace selection", async () => {
  let selected = 0;
  const actual: PrivateDaysHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName(name) {
    selected++; return env.ACCOUNT_ENROLLMENTS.getByName(name);
  } } };
  for (const [input, token, status] of [[query(), "wrong.token.value", 401], [{ ...query(), sessionExpiresAtMs: NOW }, "a.b.c", 503]] as const) {
    const ctx = createExecutionContext();
    try {
      const response = await handler()(request(input, token), actual, ctx);
      expect(response.status).toBe(status);
      if (status === 503) expect(USAGE_FAILURE_STAGES).toContain(response.headers.get(USAGE_FAILURE_HEADER));
      else expect(response.headers.has(USAGE_FAILURE_HEADER)).toBe(false);
    }
    finally { await waitOnExecutionContext(ctx); }
  }
  expect(selected).toBe(0); expect(finished).toBe(2);
});
