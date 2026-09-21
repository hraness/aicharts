import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { encodeAdmissionBatch, encodeAdmissionOperation } from "../../../lib/usage/admission";
import { decodePrivateDaysHttpResponse, encodePrivateDaysHttpRequest, PRIVATE_DAYS_HTTP_URL } from "../../../lib/usage/private-days-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_MEDIA, PAIRING_HTTP_STAGE_MS } from "../../../lib/usage/pairing-http-contract";
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

test.each(["success", "storage_failure"] as const)("delayed anchor returns rpc_pending before real RPC completes with %s", async outcome => {
  const device = await enroll();
  // Keep injected streams, timer-created Responses and their cleanup in one
  // actor I/O scope. Nothing carrying I/O ownership leaves this callback.
  await runInDurableObject(device.stub, async instance => {
    let releaseBody!: () => void, enterBody!: () => void;
    const bodyGate = new Promise<void>(resolve => { releaseBody = resolve; });
    const bodyEntered = new Promise<void>(resolve => { enterBody = resolve; });
    let restore = () => {}, reads = 0, stageTimeouts = 0;
    // Date remains fixed for the synthetic enrollment. Timers are real. Delay
    // the get for 3s, then hold its body until the outer 5s stage has expired.
    // Each storage phase remains within its own 5s budget when we release it.
    const object = instance as unknown as { env: Env }, original = object.env;
    const control = new Proxy(original.CONTROL, { get(target, property) {
      if (property === "get") return async (key: string) => {
        reads++;
        const anchor = await target.get(key);
        if (anchor === null) throw new Error("synthetic_anchor_missing");
        const bytes = new Uint8Array(await anchor.arrayBuffer());
        await new Promise<void>(resolve => setTimeout(resolve, 3_000));
        const body = new ReadableStream<Uint8Array>({ async pull(controller) {
          enterBody(); await bodyGate;
          if (outcome === "storage_failure") controller.error(new Error("SYNTHETIC_ANCHOR_BODY_FAILURE"));
          else { controller.enqueue(bytes); controller.close(); }
        } });
        return new Proxy(anchor, { get(target, property) {
          if (property === "body") return body;
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    object.env = { ...original, CONTROL: control };
    restore = () => { object.env = original; };
    let observe!: (result: { ok: boolean; error: string | null }) => void, remoteSettled = false;
    const observed = new Promise<{ ok: boolean; error: string | null }>(resolve => { observe = resolve; });
    const actual: PrivateDaysHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName(name) {
      const stub = env.ACCOUNT_ENROLLMENTS.getByName(name);
      return { readImportedDays(input) {
        const rpc = stub.readImportedDays(input);
        // Observe the real transport without replacing its thenable or keeping
        // the returned object: the HTTP handler remains its disposal owner.
        void rpc.then(raw => { remoteSettled = true; observe({ ok: raw.ok, error: raw.ok ? null : raw.error }); },
          () => { remoteSettled = true; observe({ ok: false, error: "rpc_rejected" }); });
        return rpc;
      } };
    } } };
    const retained = createPrivateDaysHttpHandler({ verifier, now: Date.now,
      setTimeout: (callback, ms) => setTimeout(() => { if (ms === PAIRING_HTTP_STAGE_MS) stageTimeouts++; callback(); }, ms),
      clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) });
    const ctx = createExecutionContext();
    let joined = false;
    const outward = retained(request(), actual, ctx);
    const terminal = waitOnExecutionContext(ctx).then(() => { joined = true; });
    try {
      await bodyEntered;
      const response = await outward;
      expect(response.status).toBe(503); expect(response.headers.get(USAGE_FAILURE_HEADER)).toBe("rpc_pending");
      expect(await response.text()).toBe('{"schemaVersion":1,"error":{"code":"coordinator_unavailable"}}');
      expect(stageTimeouts).toBe(1); expect(reads).toBe(1);
      expect(remoteSettled).toBe(false); expect(joined).toBe(false); expect(finished).toBe(1);
      releaseBody();
      expect(await observed).toEqual(outcome === "success" ? { ok: true, error: null } : { ok: false, error: "storage_unavailable" });
      await terminal;
      expect(joined).toBe(true); expect(response.headers.get(USAGE_FAILURE_HEADER)).toBe("rpc_pending");
      restore();
      // Eight simultaneous healthy reads require every capacity slot, including
      // the timed-out call's slot. Reuse the same factory to expose a leaked slot.
      const followups = Array.from({ length: PAIRING_HTTP_CAPACITY }, async () => {
        const next = createExecutionContext();
        try {
          const response = await retained(request(), env, next);
          expect(response.status).toBe(200);
          expect(decodePrivateDaysHttpResponse(new Uint8Array(await response.arrayBuffer()), query())?.ok).toBe(true);
        } finally { await waitOnExecutionContext(next); }
      });
      await Promise.all(followups);
      expect(finished).toBe(PAIRING_HTTP_CAPACITY + 1);
    } finally { releaseBody(); await outward; await terminal; restore(); }
  });
});
