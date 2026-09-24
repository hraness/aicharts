import { env } from "cloudflare:workers";
import { abortAllDurableObjects, createExecutionContext, waitOnExecutionContext, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  decodeTerminalEnrollmentResponse, encodeTerminalEnrollmentRequest, TERMINAL_ENROLLMENT_URL,
  type TerminalEnrollmentContext, type TerminalEnrollmentOperation, type TerminalEnrollmentResults,
} from "../../../lib/usage/terminal-enrollment-contract";
import { createTerminalEnrollmentHttpHandler, type TerminalEnrollmentHttpEnvironment } from "../src/terminal-enrollment-http";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import worker from "../src/index";

const NOW = Date.UTC(2026, 8, 13, 12), POLL = "22".repeat(32), UPLOAD = "33".repeat(32), NONCE = "44".repeat(32);
let serial = 0;
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true }); if (!result.ok) throw new Error("synthetic_fixture_failed"); return result.value;
};
beforeEach(() => { serial++; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => {
  vi.useRealTimers();
  const keys = (await env.CONTROL.list()).objects.map(value => value.key);
  if (keys.length) await env.CONTROL.delete(keys);
  await reset();
});

function terminal() {
  const proof = { intentId: hex(serial), pollSecret: POLL, uploadSecret: UPLOAD }, accountId = `acct_${hex(serial, 16)}`;
  let retained: TerminalEnrollmentContext = { nowMs: NOW, initializedExpiresAtMs: null, confirmedAccountId: null, reservation: null, enrollment: null };
  const calls: string[] = [], selected: string[] = [];
  // Compile-time proof against the actual generated bindings, without casts.
  const actual: TerminalEnrollmentHttpEnvironment = env;
  const bound: TerminalEnrollmentHttpEnvironment = { USAGE_ENROLLMENT_GENERATION: actual.USAGE_ENROLLMENT_GENERATION,
    PAIRINGS: { getByName(name) {
      expect(name).toBe(proof.intentId); const stub = actual.PAIRINGS.getByName(name);
      return {
        initialize(input) { calls.push("initialize"); return stub.initialize(input); },
        poll(input) { calls.push("poll"); return stub.poll(input); },
        confirm(input) { calls.push("confirm"); return stub.confirm(input); },
        readEnrollmentReservation(input) { calls.push("readEnrollmentReservation"); return stub.readEnrollmentReservation(input); },
        reserveEnrollment(input) { calls.push("reserveEnrollment"); return stub.reserveEnrollment(input); },
      };
    } },
    ACCOUNT_ENROLLMENTS: { getByName(name) {
      selected.push(name); expect(name).toBe(enrollmentAccountName(accountId)); const stub = actual.ACCOUNT_ENROLLMENTS.getByName(name);
      return {
        enroll(input) { calls.push("enroll"); return stub.enroll(input); },
        namespaceForEnrollment(input) { calls.push("namespaceForEnrollment"); return stub.namespaceForEnrollment(input); },
      };
    } },
  };
  const handle = createTerminalEnrollmentHttpHandler({ now: Date.now,
    setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  async function raw(operation: TerminalEnrollmentOperation, input: unknown) {
    const request = { schemaVersion: 1, operation, input }, bytes = success(encodeTerminalEnrollmentRequest(request)), ctx = createExecutionContext();
    try {
      const response = await handle(new Request(TERMINAL_ENROLLMENT_URL, { method: "POST", body: new Uint8Array(bytes),
        headers: { "content-type": "application/json", accept: "application/json", "content-length": String(bytes.byteLength) },
      }), bound, ctx);
      const body = new Uint8Array(await response.arrayBuffer()), text = new TextDecoder().decode(body);
      expect(response.headers.get("content-length")).toBe(String(body.byteLength));
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      for (const header of ["set-cookie", "location", "content-encoding", "transfer-encoding", "access-control-allow-origin"]) expect(response.headers.has(header)).toBe(false);
      expect(body.byteLength).toBeLessThanOrEqual(2048);
      for (const secret of [POLL, UPLOAD, "PRIVATE_CANARY"]) expect(text).not.toContain(secret);
      return { request, response, body, text };
    } finally { await waitOnExecutionContext(ctx); }
  }
  async function call<K extends TerminalEnrollmentOperation>(operation: K, input: unknown): Promise<TerminalEnrollmentResults[K]> {
    const result = await raw(operation, input); expect(result.response.status).toBe(200);
    const decoded = success(decodeTerminalEnrollmentResponse(result.body, result.request, { ...retained, nowMs: Date.now() }));
    // The decoder correlates the operation; this narrows that checked union for
    // synthetic fixture callers, without adding fields to the wire or server.
    return decoded as TerminalEnrollmentResults[K];
  }
  async function initialize() {
    const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, UPLOAD));
    const input = { intentId: proof.intentId, pollSecret: POLL, uploadCommitment };
    const result = success(await call("initialize", input));
    retained = { ...retained, initializedExpiresAtMs: result.expiresAtMs }; return input;
  }
  async function approve(sessionExpiresAtMs = NOW + PAIRING_TTL_MS) {
    const pairing = env.PAIRINGS.getByName(proof.intentId);
    const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: NONCE }));
    const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: NONCE, contextToken: attempt.contextToken };
    success(await pairing.recordVerifiedAuthentication({ ...browser, accountId, authTimeMs: Math.floor(Date.now() / 1000) * 1000, sessionExpiresAtMs }));
    success(await pairing.decideBrowser({ ...browser, accountId, liveSessionExpiresAtMs: sessionExpiresAtMs, decision: "approve" }));
  }
  async function confirm() {
    const result = success(await call("confirm", { intentId: proof.intentId, pollSecret: POLL, accountId }));
    retained = { ...retained, confirmedAccountId: accountId }; return result;
  }
  async function reserve() {
    const result = success(await call("reserveEnrollment", proof)); retained = { ...retained, reservation: result }; return result;
  }
  async function enroll() {
    const result = success(await call("enroll", proof)); retained = { ...retained, enrollment: result.enrollment }; return result;
  }
  async function ready() { await initialize(); await approve(); await confirm(); await reserve(); return await enroll(); }
  return { proof, accountId, bound, calls, selected, raw, call, initialize, approve, confirm, reserve, enroll, ready };
}

test("new factory and real binding types remain dormant beside the unchanged default 503", async () => {
  const t = terminal(); expect(t.calls).toHaveLength(0); expect(t.selected).toHaveLength(0);
  const ctx = createExecutionContext();
  try {
    const response = await worker.fetch(new Request("https://usage.aicharts.io/"), env, ctx);
    expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"usage_service_unavailable"}');
  } finally { await waitOnExecutionContext(ctx); }
});

test("six operations cross real RPC disposal with auth-truncated reservation and no auxiliary poll", async () => {
  const t = terminal(), initial = await t.initialize();
  expect(success(await t.call("poll", { intentId: t.proof.intentId, pollSecret: POLL }))).toMatchObject({ state: "pending", pollAfterMs: 5000 });
  await t.approve(NOW + 90_000); vi.setSystemTime(NOW + 1000);
  expect(await t.confirm()).toEqual({ state: "terminal-confirmed", expiresAtMs: NOW + PAIRING_TTL_MS, pollAfterMs: 4000, approvedAccountId: t.accountId });
  vi.setSystemTime(NOW + 2000); const reservation = await t.reserve();
  expect(reservation.expiresAtMs).toBe(NOW + 90_000); expect(reservation.reservedAtMs).toBe(NOW + 2000);
  vi.setSystemTime(NOW + 3000); const enrolled = await t.enroll();
  const namespace = success(await t.call("namespaceForEnrollment", t.proof));
  expect(namespace.namespace.receipt).toEqual(enrolled.enrollment.receipt);
  expect(t.calls).toEqual(["initialize", "poll", "confirm", "readEnrollmentReservation", "reserveEnrollment",
    "readEnrollmentReservation", "enroll", "readEnrollmentReservation", "namespaceForEnrollment"]);
  const stored = await runInDurableObject(env.PAIRINGS.getByName(t.proof.intentId), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one());
  expect(JSON.parse(stored.payload as string).nextPollAtMs).toBe(NOW + 5000);
  const objects = (await env.CONTROL.list()).objects; expect(objects).toHaveLength(1);
  const version = objects[0].version;
  vi.setSystemTime(NOW + PAIRING_TTL_MS + 1);
  expect(success(await t.call("initialize", initial))).toEqual({ expiresAtMs: NOW + PAIRING_TTL_MS });
  expect(await t.reserve()).toEqual(reservation); expect(await t.enroll()).toEqual(enrolled);
  expect(await t.call("namespaceForEnrollment", t.proof)).toEqual({ ok: false, error: "expired" });
  expect((await env.CONTROL.list()).objects[0].version).toBe(version);
});

test("namespace before enrollment does not call enroll or manufacture a receipt", async () => {
  const t = terminal(); await t.initialize(); await t.approve(); await t.confirm(); await t.reserve();
  const before = t.calls.length, result = await t.raw("namespaceForEnrollment", t.proof);
  expect(result.response.status).toBe(200); expect(JSON.parse(result.text).result).toEqual({ ok: false, error: "not_enrolled" });
  expect(t.calls.slice(before)).toEqual(["readEnrollmentReservation", "namespaceForEnrollment"]);
  expect((await env.CONTROL.list()).objects).toHaveLength(0);
});

test("revoked readback cannot reactivate a device or disclose its namespace", async () => {
  const t = terminal(), enrolled = await t.ready();
  const namespace = success(await t.call("namespaceForEnrollment", t.proof)).namespace.namespaceKey;
  const revoked = success(await env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(t.accountId)).revokeEnrollment(t.proof));
  expect(revoked.receipt).toEqual(enrolled.enrollment.receipt);
  expect((await t.enroll()).enrollment).toEqual(revoked);
  expect((await t.enroll()).enrollment.deviceState).toBe("revoked");
  const result = await t.raw("namespaceForEnrollment", t.proof);
  expect(JSON.parse(result.text).result).toEqual({ ok: false, error: "revoked" }); expect(result.text).not.toContain(namespace);
});

test("exact reservation, receipt and namespace survive local object restart", async () => {
  const t = terminal(), enrolled = await t.ready(), namespace = success(await t.call("namespaceForEnrollment", t.proof));
  await abortAllDurableObjects();
  expect(await t.reserve()).toEqual(enrolled.reservation); expect(await t.enroll()).toEqual(enrolled);
  expect(success(await t.call("namespaceForEnrollment", t.proof))).toEqual(namespace);
  expect((await env.CONTROL.list()).objects).toHaveLength(1);
});

test("account-owned status exposes durable control metadata without namespace material", async () => {
  const t = terminal(); const enrolled = await t.ready();
  const status = success(await env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(t.accountId)).readEnrollmentStatus(t.proof));
  expect(status).toMatchObject({ schemaVersion: 1, accountId: t.accountId, phase: "active",
    admissionRevision: 0, admissionCommittedAtMs: null, headCount: 0, liveCount: 0, quarantined: false });
  expect(status.stateRevision).toBeGreaterThan(0);
  expect(status.devices).toHaveLength(1);
  expect(status.devices[0]).toEqual({ receipt: enrolled.enrollment.receipt, deviceState: "active" });
  expect(JSON.stringify(status)).not.toContain("namespaceKey");
  await abortAllDurableObjects();
  const reopened = success(await env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(t.accountId)).readEnrollmentStatus(t.proof));
  expect(reopened).toMatchObject({ accountId: status.accountId, generation: status.generation, phase: status.phase,
    admissionRevision: status.admissionRevision, admissionCommittedAtMs: status.admissionCommittedAtMs,
    admissionObservedAtMs: status.admissionObservedAtMs, headCount: status.headCount, liveCount: status.liveCount,
    quarantined: false });
  expect(reopened.stateRevision).toBe(status.stateRevision);
  success(await env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(t.accountId)).revokeEnrollment(t.proof));
  const revoked = success(await env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(t.accountId)).readEnrollmentStatus(t.proof));
  expect(revoked.devices[0].deviceState).toBe("revoked");
});

test("wrong proof cannot select an account, and unknown intents preserve read error mapping", async () => {
  const t = terminal(); await t.ready(); const selected = t.selected.length;
  const wrong = { ...t.proof, uploadSecret: "99".repeat(32) };
  const result = await t.raw("enroll", wrong); expect(result.response.status).toBe(200);
  expect(JSON.parse(result.text).result).toEqual({ ok: false, error: "unauthorized" }); expect(t.selected).toHaveLength(selected);
  serial++; const absent = terminal();
  const reserve = await absent.raw("reserveEnrollment", absent.proof);
  expect(JSON.parse(reserve.text).result).toEqual({ ok: false, error: "not_initialized" });
  const enroll = await absent.raw("enroll", absent.proof);
  expect(JSON.parse(enroll.text).result).toEqual({ ok: false, error: "storage_unavailable" });
  expect(absent.selected).toHaveLength(0);
});

test("a captured adapter generation cannot route a reservation from another generation", async () => {
  const t = terminal(); await t.ready(); const selected = t.selected.length;
  // Synthetic environment substitution qualifies only this adapter fence.
  Object.defineProperty(t.bound, "USAGE_ENROLLMENT_GENERATION", { value: "99".repeat(32) });
  const result = await t.raw("enroll", t.proof); expect(result.response.status).toBe(503);
  expect(result.text).toBe('{"schemaVersion":1,"error":{"code":"enrollment_unavailable"}}'); expect(t.selected).toHaveLength(selected);
});
