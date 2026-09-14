import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import vectors from "../../fixtures/usage/terminal-enrollment-v1.json";
import {
  TERMINAL_ENROLLMENT_ERRORS, TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES, TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES,
  TERMINAL_ENROLLMENT_MAX_TIME_MS, TERMINAL_ENROLLMENT_URL,
  decodeTerminalEnrollmentRequest, decodeTerminalEnrollmentResponse, encodeTerminalEnrollmentRequest, encodeTerminalEnrollmentResponse,
  type TerminalEnrollmentOperation,
} from "./terminal-enrollment-contract";

const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => Buffer.from(value).toString("ascii");
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_terminal_fixture");
  return value as Record<string, unknown>;
};
function change(value: unknown, path: readonly string[], replacement: unknown): unknown {
  const copy = clone(value); let target = record(copy);
  for (const key of path.slice(0, -1)) target = record(target[key]);
  target[path[path.length - 1]] = replacement; return copy;
}
function vector(name: string) {
  const result = vectors.vectors.find(item => item.name === name);
  if (!result) throw new Error("invalid_terminal_fixture"); return result;
}
const request = (operation: TerminalEnrollmentOperation) => vector(operation + "-success").request;
const valid = (operation: TerminalEnrollmentOperation) => vector(operation + "-success");
const invalidResponse = (operation: TerminalEnrollmentOperation, result: unknown, context: unknown = valid(operation).context) => {
  const sample = valid(operation);
  expect(encodeTerminalEnrollmentResponse(sample.request, context, result)).toEqual({ ok: false, error: "invalid_response" });
};

describe("literal independent terminal enrollment vectors", () => {
  test("publishes the frozen schema, bounds and ASCII hash preimages", () => {
    expect(vectors.schemaVersion).toBe(1); expect(vectors.protocol).toBe("aicharts-terminal-enrollment-v1");
    expect(vectors.url).toBe(TERMINAL_ENROLLMENT_URL);
    expect(vectors.requestMaxBytes).toBe(TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES);
    expect(vectors.responseMaxBytes).toBe(TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES);
    expect(vectors.times.initializedAtMs).toBe(Date.UTC(2026, 8, 13, 12));
    expect(vectors.times.expiresAtMs - vectors.times.initializedAtMs).toBe(600_000);
    for (const value of Object.values(vectors.derivations)) expect(createHash("sha256").update(value.ascii, "ascii").digest("hex")).toBe(value.sha256);
    expect(vectors.derivations.pollCommitment.sha256).toBe("3405f21768755d92addb5cc941649473c0498ac6e8072a842e242fded17284c5");
    expect(vectors.derivations.uploadCommitment.sha256).toBe("497cbafd9fe88f7295283d30ec0d8a812545be8a0bf812d879bb31cec40421e0");
    expect(vectors.derivations.deviceId.sha256).toBe("15a89decb584b14c594fdaa317d10aacaf9c1e7d305b8c7375093ea72a6cecca");
  });
  for (const sample of vectors.vectors) test(sample.name, () => {
    expect(text(bytes(sample.requestHex))).toBe(sample.requestAscii);
    expect(text(bytes(sample.responseHex))).toBe(sample.responseAscii);
    expect(sample.requestAscii.length).toBeLessThanOrEqual(1_024); expect(sample.responseAscii.length).toBeLessThanOrEqual(2_048);
    const encodedRequest = encodeTerminalEnrollmentRequest(sample.request), decodedRequest = decodeTerminalEnrollmentRequest(bytes(sample.requestHex));
    expect(encodedRequest.ok).toBe(true); expect(decodedRequest.ok).toBe(true);
    if (!encodedRequest.ok || !decodedRequest.ok) throw new Error("invalid_terminal_fixture");
    expect(text(encodedRequest.value)).toBe(sample.requestAscii); expect(decodedRequest.value as unknown).toEqual(sample.request);
    const encoded = encodeTerminalEnrollmentResponse(sample.request, sample.context, sample.result);
    const decoded = decodeTerminalEnrollmentResponse(bytes(sample.responseHex), sample.request, sample.context);
    if (!sample.acceptResponse) {
      expect(encoded).toEqual({ ok: false, error: "invalid_response" }); expect(decoded).toEqual({ ok: false, error: "invalid_response" }); return;
    }
    expect(encoded.ok).toBe(true); expect(decoded.ok).toBe(true);
    if (!encoded.ok || !decoded.ok) throw new Error("invalid_terminal_fixture");
    expect(text(encoded.value)).toBe(sample.responseAscii); expect(decoded.value as unknown).toEqual(sample.result);
  });
  for (const sample of vectors.invalidRequests) test(sample.name, () => {
    expect(text(bytes(sample.requestHex))).toBe(sample.requestAscii);
    expect(decodeTerminalEnrollmentRequest(bytes(sample.requestHex))).toEqual({ ok: false, error: "invalid_request" });
  });
});

test("operation-specific domain failures remain finite and never absorb unknown operational errors", () => {
  const all = new Set(Object.values(TERMINAL_ENROLLMENT_ERRORS).flat());
  for (const operation of Object.keys(TERMINAL_ENROLLMENT_ERRORS) as TerminalEnrollmentOperation[]) {
    const sample = valid(operation);
    for (const error of all) {
      const encoded = encodeTerminalEnrollmentResponse(sample.request, sample.context, { ok: false, error });
      if (!TERMINAL_ENROLLMENT_ERRORS[operation].includes(error)) { expect(encoded.ok).toBe(false); continue; }
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) throw new Error("invalid_terminal_fixture");
      expect(decodeTerminalEnrollmentResponse(encoded.value, sample.request, sample.context) as unknown).toEqual({ ok: true, value: { ok: false, error } });
    }
    for (const result of [{ ok: false, error: "network_timeout" }, { ok: false, error: "PRIVATE_CANARY" }, { ok: false, error: "revoked", details: "PRIVATE_CANARY" }, { ok: true, error: "expired" }])
      invalidResponse(operation, result);
  }
  expect(TERMINAL_ENROLLMENT_ERRORS.reserveEnrollment).not.toContain("not_reserved");
  expect(TERMINAL_ENROLLMENT_ERRORS.initialize).not.toContain("expired");
});

test("credentials, account spelling and initialize commitment separation are exact", () => {
  for (const operation of Object.keys(TERMINAL_ENROLLMENT_ERRORS) as TerminalEnrollmentOperation[]) {
    for (const value of ["0".repeat(64), "A".repeat(64), "1".repeat(63), "1".repeat(65), null, 1]) {
      expect(encodeTerminalEnrollmentRequest(change(request(operation), ["input", "intentId"], value)).ok).toBe(false);
      expect(encodeTerminalEnrollmentRequest(change(request(operation), ["input", "pollSecret"], value)).ok).toBe(false);
    }
    expect(encodeTerminalEnrollmentRequest({ ...request(operation), transcript: "PRIVATE_CANARY" }).ok).toBe(false);
  }
  for (const account of ["acct_" + "0".repeat(32), "acct_" + "A".repeat(32), "acct_" + "1".repeat(31), "other"]) {
    expect(encodeTerminalEnrollmentRequest(change(request("confirm"), ["input", "accountId"], account)).ok).toBe(false);
  }
  for (const operation of ["reserveEnrollment", "enroll", "namespaceForEnrollment"] as const)
    expect(encodeTerminalEnrollmentRequest(change(request(operation), ["input", "uploadSecret"], vectors.identity.pollSecret)).ok).toBe(false);
  const reused = createHash("sha256").update(["aicharts:pairing:v1", "upload", vectors.identity.intentId, vectors.identity.pollSecret].join("\0"), "ascii").digest("hex");
  for (const commitment of [vectors.derivations.pollCommitment.sha256, reused])
    expect(encodeTerminalEnrollmentRequest(change(request("initialize"), ["input", "uploadCommitment"], commitment)).ok).toBe(false);
});

test("wire decoding refuses alternate encodings, correlation substitutions and every framing excess", () => {
  for (const sample of vectors.vectors.filter(item => item.acceptResponse)) {
    for (const body of [" " + sample.responseAscii, sample.responseAscii + "\n", sample.responseAscii.replace('"schemaVersion":1', '"schemaVersion":1e0'),
      sample.responseAscii.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
      sample.responseAscii.replace('"schemaVersion":1', '"schemaVersion":-0'),
      sample.responseAscii.replace('"schemaVersion":1', '"schemaVersion":1.0')]) {
      expect(decodeTerminalEnrollmentResponse(utf8(body), sample.request, sample.context).ok).toBe(false);
    }
    const response = record(JSON.parse(sample.responseAscii));
    for (const body of [JSON.stringify({ operation: response.operation, schemaVersion: 1, intentId: response.intentId, result: response.result }),
      JSON.stringify({ ...response, intentId: "8".repeat(64) }), JSON.stringify({ ...response, operation: "revokeEnrollment" }),
      JSON.stringify({ ...response, auth: "PRIVATE_CANARY" })]) {
      expect(decodeTerminalEnrollmentResponse(utf8(body), sample.request, sample.context).ok).toBe(false);
    }
    expect(decodeTerminalEnrollmentResponse(bytes(sample.responseHex), change(sample.request, ["input", "intentId"], "8".repeat(64)), sample.context).ok).toBe(false);
  }
  for (const body of [new Uint8Array(), new Uint8Array(1_025), Uint8Array.of(0xef, 0xbb, 0xbf, 123, 125), Uint8Array.of(0xff), utf8("[]"), utf8("null")])
    expect(decodeTerminalEnrollmentRequest(body).ok).toBe(false);
  for (const body of [new Uint8Array(), new Uint8Array(2_049), Uint8Array.of(0xef, 0xbb, 0xbf, 123, 125), Uint8Array.of(0xff)])
    expect(decodeTerminalEnrollmentResponse(body, request("poll"), valid("poll").context).ok).toBe(false);
});

test("reservation identity, ASCII commitments, original lifetime and pinned generation are correlated", () => {
  const sample = valid("reserveEnrollment");
  for (const [key, replacement] of [["schemaVersion", 2], ["intentId", "8".repeat(64)], ["accountId", "acct_" + "88".repeat(16)],
    ["reservationId", "0".repeat(64)], ["pollCommitment", "8".repeat(64)], ["uploadCommitment", vectors.derivations.pollCommitment.sha256],
    ["recoveryGeneration", "0".repeat(64)], ["reservedAtMs", vectors.times.initializedAtMs - 1], ["reservedAtMs", vectors.times.expiresAtMs],
    ["reservedAtMs", sample.context.nowMs + 1], ["expiresAtMs", vectors.times.expiresAtMs + 1], ["expiresAtMs", vectors.times.reservedAtMs]] as const)
    invalidResponse("reserveEnrollment", change(sample.result, ["value", key], replacement));
  const binaryCommitment = createHash("sha256").update("aicharts:pairing:v1\0poll\0").update(Buffer.from(vectors.identity.intentId, "hex"))
    .update("\0").update(Buffer.from(vectors.identity.pollSecret, "hex")).digest("hex");
  invalidResponse("reserveEnrollment", change(sample.result, ["value", "pollCommitment"], binaryCommitment));
  const retained = vector("reserve-expired-readback");
  for (const [key, replacement] of [["reservationId", "8".repeat(64)], ["recoveryGeneration", "8".repeat(64)],
    ["reservedAtMs", vectors.times.reservedAtMs + 1], ["expiresAtMs", vectors.times.expiresAtMs - 1]] as const)
    invalidResponse("reserveEnrollment", change(retained.result, ["value", key], replacement), retained.context);
});

test("receipt identity, device derivation, exact replay and permanent revocation are checked", () => {
  const sample = valid("enroll");
  for (const [key, replacement] of [["schemaVersion", 2], ["namespaceVersion", 2], ["accountId", "acct_" + "88".repeat(16)],
    ["intentId", "8".repeat(64)], ["reservationId", "8".repeat(64)], ["deviceId", "8".repeat(64)],
    ["enrolledAtMs", vectors.times.reservedAtMs - 1], ["enrolledAtMs", vectors.times.expiresAtMs], ["enrolledAtMs", sample.context.nowMs + 1]] as const)
    invalidResponse("enroll", change(sample.result, ["value", "enrollment", "receipt", key], replacement));
  invalidResponse("enroll", change(sample.result, ["value", "enrollment", "deviceState"], "reactivated"));
  const retained = vector("enroll-expired-readback");
  invalidResponse("enroll", change(retained.result, ["value", "enrollment", "receipt", "enrolledAtMs"], vectors.times.enrolledAtMs + 1), retained.context);
  for (const operation of ["enroll", "namespaceForEnrollment"] as const)
    invalidResponse(operation, change(valid(operation).result, ["value", "reservation", "recoveryGeneration"], "8".repeat(64)));
});

test("context cannot replace missing retained facts or turn time observations into fresh authority", () => {
  for (const operation of Object.keys(TERMINAL_ENROLLMENT_ERRORS) as TerminalEnrollmentOperation[]) {
    const sample = valid(operation);
    for (const nowMs of [-0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, TERMINAL_ENROLLMENT_MAX_TIME_MS + 1])
      invalidResponse(operation, sample.result, { ...sample.context, nowMs });
    invalidResponse(operation, sample.result, { ...sample.context, cookie: "PRIVATE_CANARY" });
    if (operation !== "initialize") invalidResponse(operation, sample.result, { ...sample.context, initializedExpiresAtMs: null });
  }
  for (const operation of ["reserveEnrollment", "enroll", "namespaceForEnrollment"] as const)
    invalidResponse(operation, valid(operation).result, { ...valid(operation).context, confirmedAccountId: null });
  for (const operation of ["enroll", "namespaceForEnrollment"] as const)
    invalidResponse(operation, valid(operation).result, { ...valid(operation).context, reservation: null });
  invalidResponse("namespaceForEnrollment", valid("namespaceForEnrollment").result, { ...valid("namespaceForEnrollment").context, enrollment: null });
  invalidResponse("namespaceForEnrollment", change(valid("namespaceForEnrollment").result, ["value", "namespace", "namespaceKey"], "0".repeat(64)));
  invalidResponse("initialize", { ok: true, value: { expiresAtMs: vectors.times.expiresAtMs + 1 } }, vector("initialize-expired-readback").context);
  invalidResponse("poll", change(valid("poll").result, ["value", "pollAfterMs"], 4_999));
  invalidResponse("poll", change(valid("poll").result, ["value", "approvedAccountId"], vectors.identity.accountId));
  invalidResponse("confirm", change(valid("confirm").result, ["value", "state"], "browser-approved"));
  invalidResponse("confirm", change(valid("confirm").result, ["value", "pollAfterMs"], 5_001));
});

test("parsers never invoke input accessors or inherited JSON hooks and retain independent owned fields", () => {
  let calls = 0;
  const accessor = { ...request("initialize") };
  Object.defineProperty(accessor, "input", { enumerable: true, get() { calls++; throw new Error("PRIVATE_CANARY"); } });
  expect(encodeTerminalEnrollmentRequest(accessor).ok).toBe(false);
  const result = { ok: true };
  Object.defineProperty(result, "value", { enumerable: true, get() { calls++; throw new Error("PRIVATE_CANARY"); } });
  invalidResponse("initialize", result); expect(calls).toBe(0);
  for (const input of [Object.create(request("poll")) as unknown, Object.assign(Object.create({ extra: true }), request("poll")) as unknown,
    { ...request("poll"), [Symbol("private")]: true }, { ...request("poll"), toJSON() { calls++; return {}; } }]) expect(encodeTerminalEnrollmentRequest(input).ok).toBe(false);
  const sample = valid("namespaceForEnrollment"), original = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON"), originalArray = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  try {
    for (const prototype of [Object.prototype, Array.prototype]) Object.defineProperty(prototype, "toJSON", { configurable: true, value() { calls++; throw new Error("PRIVATE_CANARY"); } });
    const encoded = encodeTerminalEnrollmentResponse(sample.request, sample.context, sample.result);
    expect(encoded.ok).toBe(true); if (encoded.ok) expect(text(encoded.value)).toBe(sample.responseAscii);
    expect(decodeTerminalEnrollmentResponse(bytes(sample.responseHex), sample.request, sample.context).ok).toBe(true);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "toJSON", original); else Reflect.deleteProperty(Object.prototype, "toJSON");
    if (originalArray) Object.defineProperty(Array.prototype, "toJSON", originalArray); else Reflect.deleteProperty(Array.prototype, "toJSON");
  }
  expect(calls).toBe(0);
  const source = bytes(sample.requestHex), decoded = decodeTerminalEnrollmentRequest(source); source.fill(0);
  expect(decoded.ok).toBe(true); if (decoded.ok) { expect(decoded.value as unknown).toEqual(sample.request); expect(Object.isFrozen(decoded.value.input)).toBe(true); }
});

test("byte ownership handles offset views without trusting overrides and refuses shared or resizable storage", () => {
  const sample = valid("initialize"), source = bytes(sample.requestHex), padded = new Uint8Array(source.length + 10); padded.set(source, 5);
  expect(decodeTerminalEnrollmentRequest(padded.subarray(5, 5 + source.length)).ok).toBe(true);
  let calls = 0;
  for (const key of ["buffer", "byteLength", Symbol.iterator]) Object.defineProperty(source, key, { get() { calls++; throw new Error("PRIVATE_CANARY"); } });
  expect(decodeTerminalEnrollmentRequest(source).ok).toBe(true); expect(calls).toBe(0);
  const shared = new Uint8Array(new SharedArrayBuffer(padded.length)); shared.set(padded);
  expect(decodeTerminalEnrollmentRequest(shared.subarray(5, 5 + sample.requestAscii.length)).ok).toBe(false);
  const resizable = new Uint8Array(new ArrayBuffer(sample.requestAscii.length, { maxByteLength: sample.requestAscii.length + 1 })); resizable.set(bytes(sample.requestHex));
  expect(decodeTerminalEnrollmentRequest(resizable).ok).toBe(false);
  const detached = bytes(sample.requestHex); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  expect(decodeTerminalEnrollmentRequest(detached).ok).toBe(false);
});

test("every distinct valid generation is refused after the reservation has been pinned", () => {
  fc.assert(fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), value => {
    const generation = Buffer.from(value).toString("hex");
    if (generation === vectors.identity.recoveryGeneration || generation === "0".repeat(64)) return;
    for (const operation of ["enroll", "namespaceForEnrollment"] as const)
      invalidResponse(operation, change(valid(operation).result, ["value", "reservation", "recoveryGeneration"], generation));
  }), { numRuns: 128 });
});

test("receipt times outside the retained reservation can never validate", () => {
  const outside = fc.oneof(fc.bigInt({ min: 0n, max: BigInt(vectors.times.reservedAtMs - 1) }),
    fc.bigInt({ min: BigInt(vectors.times.expiresAtMs), max: BigInt(TERMINAL_ENROLLMENT_MAX_TIME_MS) }));
  fc.assert(fc.property(outside, value => {
    invalidResponse("enroll", change(valid("enroll").result, ["value", "enrollment", "receipt", "enrolledAtMs"], Number(value)));
  }), { numRuns: 128 });
});

test("the largest exact decimal timestamps stay within the fixed response cap", () => {
  const sample = valid("namespaceForEnrollment"), max = TERMINAL_ENROLLMENT_MAX_TIME_MS;
  let result: unknown = clone(sample.result), context: unknown = clone(sample.context);
  for (const target of ["result", "context"] as const) {
    const prefix = target === "result" ? ["value"] : [];
    let current = target === "result" ? result : context;
    current = change(current, [...prefix, "reservation", "reservedAtMs"], max - 2);
    current = change(current, [...prefix, "reservation", "expiresAtMs"], max);
    current = change(current, [...prefix, target === "result" ? "namespace" : "enrollment", "receipt", "enrolledAtMs"], max - 1);
    if (target === "result") result = current; else context = current;
  }
  context = change(context, ["nowMs"], max - 1); context = change(context, ["initializedExpiresAtMs"], max);
  const encoded = encodeTerminalEnrollmentResponse(sample.request, context, result);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error("invalid_terminal_fixture");
  expect(encoded.value.length).toBeLessThanOrEqual(TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES);
  expect(text(encoded.value)).toContain("8640000000000000");
  expect(decodeTerminalEnrollmentResponse(encoded.value, sample.request, context).ok).toBe(true);
});
