import { expect, test } from "bun:test";
import fc from "fast-check";
import fixture from "../../fixtures/usage/terminal-enrollment-v1.json";
import { decodeTerminalEnrollmentResponse, TERMINAL_ENROLLMENT_ERRORS, TERMINAL_ENROLLMENT_MAX_TIME_MS } from "./terminal-enrollment-contract";
import { encodeTerminalEnrollmentServerResponse as encode, ownTerminalEnrollmentServerResponse as ownResponse,
  ownTerminalReservationRead as read } from "./terminal-enrollment-server-contract";

const vector = (name: string) => fixture.vectors.find(value => value.name === name)!;
const reserve = vector("reserveEnrollment-success"), enroll = vector("enroll-success"), namespace = vector("namespaceForEnrollment-success");
const reservation = reserve.result.value!;
const observation = (nowMs = fixture.times.enrolledAtMs) => ({ nowMs, recoveryGeneration: fixture.identity.recoveryGeneration });
const text = (bytes: Uint8Array | null) => bytes === null ? null : new TextDecoder().decode(bytes);
const clone = <T>(value: T): T => structuredClone(value);

test("all accepted independent vectors retain literal bytes without client context", () => {
  for (const item of fixture.vectors.filter(value => value.acceptResponse)) {
    expect(text(encode(item.request, observation(item.context.nowMs), item.result))).toBe(item.responseAscii);
  }
});

test("server observations do not invent client receipt or revocation history", () => {
  for (const name of ["namespace-revoked-refused", "enroll-reactivation-refused"]) {
    const item = vector(name), bytes = encode(item.request, observation(item.context.nowMs), item.result);
    expect(text(bytes)).toBe(item.responseAscii);
    expect(decodeTerminalEnrollmentResponse(bytes, item.request, item.context)).toEqual({ ok: false, error: "invalid_response" });
  }
  for (const name of ["confirm-expired-refused", "namespace-expired-refused"]) {
    const item = vector(name);
    expect(encode(item.request, observation(item.context.nowMs), item.result)).toBeNull();
  }
});

test("only checked confirm and namespace successes carry an owned final acceptance expiry", () => {
  for (const item of fixture.vectors.filter(value => value.acceptResponse)) {
    const response = ownResponse(item.request, observation(item.context.nowMs), item.result);
    expect(response).not.toBeNull();
    const expected = !item.result.ok ? null : item.request.operation === "confirm" ? item.result.value!.expiresAtMs!
      : item.request.operation === "namespaceForEnrollment" ? item.result.value!.reservation!.expiresAtMs : null;
    expect(response!.acceptBeforeMs).toBe(expected);
    expect(Object.getPrototypeOf(response)).toBeNull(); expect(Object.isFrozen(response)).toBe(true);
    expect(text(response!.bytes)).toBe(item.responseAscii);
  }
});

test("auth-truncated reservation expiry remains independent from the original pairing expiry", () => {
  const truncated = { ...reservation, expiresAtMs: fixture.times.enrolledAtMs + 1 };
  const result = { ok: true, value: truncated };
  const bytes = encode(reserve.request, observation(), result);
  expect(bytes).not.toBeNull();
  const decoded = decodeTerminalEnrollmentResponse(bytes, reserve.request, { ...reserve.context, nowMs: fixture.times.enrolledAtMs });
  expect(decoded.ok).toBe(true);
  expect<unknown>(read(reserve.request, observation(truncated.expiresAtMs + 1), result)).toEqual(result);
  expect(encode(namespace.request, observation(truncated.expiresAtMs), { ok: true, value: {
    ...namespace.result.value, reservation: truncated,
  } })).toBeNull();
});

test("existing reservation reads recognize only reachable errors and never synthesize absence", () => {
  for (const error of ["invalid_input", "not_initialized", "unauthorized", "storage_invalid", "clock_regressed", "not_reserved", "recovery_required"] as const) {
    expect(read(reserve.request, observation(), { ok: false, error })).toEqual({ ok: false, error });
  }
  for (const error of ["expired", "invalid_transition", "conflict", "throttled", "attempt_limit", "authentication_not_fresh", "PRIVATE_CANARY", ""]) {
    expect(read(reserve.request, observation(), { ok: false, error })).toBeNull();
  }
  for (const result of [null, {}, { ok: false, error: "not_reserved", retry: true }, { ok: true, value: null }]) {
    expect(read(reserve.request, observation(), result)).toBeNull();
  }
});

test("every frozen operation error remains exact and unknown outcomes are operational failures", () => {
  for (const item of fixture.vectors.slice(0, 6)) {
    for (const error of TERMINAL_ENROLLMENT_ERRORS[item.request.operation as keyof typeof TERMINAL_ENROLLMENT_ERRORS]) {
      const bytes = encode(item.request, observation(), { ok: false, error });
      expect(bytes).not.toBeNull();
      expect(JSON.parse(text(bytes)!).result).toEqual({ ok: false, error });
    }
    for (const error of ["PRIVATE_CANARY", "then", "toJSON", "attempt_limit"]) expect(encode(item.request, observation(), { ok: false, error })).toBeNull();
  }
  expect(encode(reserve.request, observation(), { ok: false, error: "not_reserved" })).toBeNull();
});

test("observation shape, time and generation are independent server constraints", () => {
  for (const value of [null, {}, { ...observation(), nowMs: -0 }, { ...observation(), nowMs: Infinity },
    { ...observation(), nowMs: TERMINAL_ENROLLMENT_MAX_TIME_MS + 1 }, { ...observation(), nowMs: 0.5 },
    { ...observation(), recoveryGeneration: "0".repeat(64) }, { ...observation(), context: reserve.context },
    { get nowMs() { throw new Error("PRIVATE_CANARY"); }, recoveryGeneration: fixture.identity.recoveryGeneration }]) {
    expect(read(reserve.request, value, reserve.result)).toBeNull();
    expect(encode(reserve.request, value, reserve.result)).toBeNull();
  }
  expect(read(reserve.request, { ...observation(), recoveryGeneration: "88".repeat(32) }, reserve.result)).toBeNull();
  expect(read(vector("initialize-success").request, observation(), reserve.result)).toBeNull();
});

test("reservation routing rejects mismatched proofs, identity, intervals and hidden fields", () => {
  for (const replacement of [
    { intentId: "99".repeat(32) }, { accountId: `acct_${"0".repeat(32)}` }, { reservationId: "0".repeat(64) },
    { pollCommitment: fixture.derivations.uploadCommitment.sha256 }, { uploadCommitment: fixture.derivations.pollCommitment.sha256 },
    { recoveryGeneration: "99".repeat(32) }, { reservedAtMs: fixture.times.enrolledAtMs + 1 }, { reservedAtMs: -0 },
    { expiresAtMs: fixture.times.reservedAtMs }, { expiresAtMs: fixture.times.reservedAtMs + 600_001 }, { extra: "PRIVATE_CANARY" },
  ]) {
    const result = { ok: true, value: { ...reservation, ...replacement } };
    expect(read(reserve.request, observation(), result)).toBeNull();
    expect(encode(reserve.request, observation(), result)).toBeNull();
  }
  const input = { ...reserve.request, input: { ...reserve.request.input, uploadSecret: "99".repeat(32) } };
  expect(read(input, observation(), reserve.result)).toBeNull();
});

test("receipt and namespace output must correlate to the checked authoritative reservation", () => {
  const value = enroll.result.value!, receipt = value.enrollment!.receipt;
  for (const replacement of [{ accountId: `acct_${"99".repeat(16)}` }, { intentId: "99".repeat(32) },
    { reservationId: "99".repeat(32) }, { deviceId: "99".repeat(32) }, { namespaceVersion: 2 },
    { enrolledAtMs: fixture.times.reservedAtMs - 1 }, { enrolledAtMs: fixture.times.expiresAtMs }, { enrolledAtMs: fixture.times.enrolledAtMs + 1 },
    { enrolledAtMs: -0 }, { extra: "PRIVATE_CANARY" }]) {
    const changed = { ...receipt, ...replacement };
    expect(encode(enroll.request, observation(), { ok: true, value: { ...value, enrollment: { receipt: changed, deviceState: "active" } } })).toBeNull();
    expect(encode(namespace.request, observation(), { ok: true, value: { ...namespace.result.value,
      namespace: { ...namespace.result.value!.namespace, receipt: changed } } })).toBeNull();
  }
  for (const deviceState of ["pending", "ACTIVE", null]) expect(encode(enroll.request, observation(), { ok: true,
    value: { ...value, enrollment: { receipt, deviceState } } })).toBeNull();
  for (const replacement of [{ namespaceKey: "0".repeat(64) }, { namespaceVersion: 2 }, { schemaVersion: 2 }, { extra: "PRIVATE_CANARY" }]) {
    expect(encode(namespace.request, observation(), { ok: true, value: { ...namespace.result.value,
      namespace: { ...namespace.result.value!.namespace, ...replacement } } })).toBeNull();
  }
});

test("pairing views use their own original expiry and confirmation account", () => {
  const initial = vector("initialize-success"), poll = vector("poll-success"), confirm = vector("confirm-success");
  for (const expiresAtMs of [599_999, -0, Infinity, fixture.times.enrolledAtMs + 600_001]) {
    expect(encode(initial.request, observation(), { ok: true, value: { expiresAtMs } })).toBeNull();
  }
  for (const replacement of [{ state: "unknown" }, { approvedAccountId: fixture.identity.accountId },
    { pollAfterMs: 4999 }, { pollAfterMs: -0 }, { expiresAtMs: 0 }, { extra: "PRIVATE_CANARY" }]) {
    expect(encode(poll.request, observation(), { ok: true, value: { ...poll.result.value, ...replacement } })).toBeNull();
  }
  for (const replacement of [{ state: "browser-approved" }, { approvedAccountId: `acct_${"99".repeat(16)}` },
    { pollAfterMs: 5001 }, { expiresAtMs: fixture.times.enrolledAtMs }]) {
    expect(encode(confirm.request, observation(), { ok: true, value: { ...confirm.result.value, ...replacement } })).toBeNull();
  }
});

test("RPC data ownership refuses hooks and detaches accepted reservation fields", () => {
  let calls = 0;
  for (const value of [Object.create(reservation), Object.defineProperty(clone(reservation), "accountId", { get() { calls++; return fixture.identity.accountId; } }),
    { ...reservation, [Symbol("private")]: true }, Object.defineProperty(clone(reservation), "accountId", { enumerable: false })]) {
    expect(read(reserve.request, observation(), { ok: true, value })).toBeNull();
  }
  const source = clone(reserve.result), copied = read(reserve.request, observation(), source);
  expect(copied?.ok).toBe(true);
  source.value!.accountId = `acct_${"99".repeat(16)}`;
  if (!copied?.ok) throw new Error("synthetic_result");
  expect(copied.value.accountId).toBe(fixture.identity.accountId);
  expect(Object.getPrototypeOf(copied.value)).toBeNull(); expect(Object.isFrozen(copied.value)).toBe(true);
  expect(calls).toBe(0);
});

test("inherited Object and Array toJSON hooks neither substitute nor execute", () => {
  let calls = 0;
  for (const prototype of [Object.prototype, Array.prototype]) {
    const prior = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    try {
      for (const throws of [false, true]) {
        Object.defineProperty(prototype, "toJSON", { configurable: true, value() { calls++; if (throws) throw new Error("PRIVATE_CANARY"); return "PRIVATE_CANARY"; } });
        for (const item of fixture.vectors.filter(value => value.acceptResponse)) {
          expect(text(encode(item.request, observation(item.context.nowMs), item.result))).toBe(item.responseAscii);
        }
      }
    } finally { if (prior) Object.defineProperty(prototype, "toJSON", prior); else Reflect.deleteProperty(prototype, "toJSON"); }
  }
  expect(calls).toBe(0);
});

test("bounded reservation lifetime law includes truncated and expired observations", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 600_000 }), fc.integer({ min: 0, max: 1_200_000 }), (duration, elapsed) => {
    const reservedAtMs = fixture.times.reservedAtMs;
    const value = { ...reservation, reservedAtMs, expiresAtMs: reservedAtMs + duration };
    const observed = observation(reservedAtMs + elapsed), result = { ok: true, value };
    expect<unknown>(read(reserve.request, observed, result)).toEqual(result);
    const bytes = encode(reserve.request, observed, result);
    expect(bytes).not.toBeNull(); expect(bytes!.byteLength).toBeLessThanOrEqual(2048);
  }), { numRuns: 128 });
});
