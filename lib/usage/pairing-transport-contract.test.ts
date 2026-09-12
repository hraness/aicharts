import { expect, test } from "bun:test";
import {
  decodePairingTransportRequest, decodePairingTransportResponse,
  encodePairingTransportRequest, encodePairingTransportResponse,
  PAIRING_TRANSPORT_MAX_REQUEST_BYTES, PAIRING_TRANSPORT_MAX_RESPONSE_BYTES, PAIRING_TRANSPORT_MAX_TIME_MS,
  type Result, type PairingTransportOperation,
} from "./pairing-transport-contract";

const hex = (digit: string) => digit.repeat(64);
const account = `acct_${"a".repeat(32)}`;
const proof = { intentId: hex("1"), attemptId: hex("2"), browserNonce: hex("3"), contextToken: hex("4") };
const inputs = {
  beginBrowserAttempt: { intentId: proof.intentId, browserNonce: proof.browserNonce },
  recordVerifiedAuthentication: { ...proof, accountId: account, authTimeMs: 1_000, sessionExpiresAtMs: 20_000 },
  browserStatus: { ...proof },
  decideBrowser: { ...proof, accountId: account, liveSessionExpiresAtMs: 30_000, decision: "approve" },
};
const values = {
  beginBrowserAttempt: { attemptId: proof.attemptId, contextToken: proof.contextToken, startedAtMs: 1_234, expiresAtMs: 20_000 },
  recordVerifiedAuthentication: { recorded: true },
  browserStatus: { state: "pending", expiresAtMs: 20_000, accountId: null, authenticationExpiresAtMs: null },
  decideBrowser: { state: "browser-approved", expiresAtMs: 20_000, accountId: account, authenticationExpiresAtMs: 40_000 },
};
const bytes = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const operations = Object.keys(inputs) as PairingTransportOperation[];
const requestFor = (operation: PairingTransportOperation) => ({ schemaVersion: 1, operation, input: structuredClone(inputs[operation]) });
const resultFor = (operation: PairingTransportOperation) => ({ ok: true, value: structuredClone(values[operation]) });
function unwrap<T, E extends string>(result: Result<T, E>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const invalidRequest = (input: unknown) => expect(encodePairingTransportRequest(input)).toEqual({ ok: false, error: "invalid_request" });
const invalidResponse = (request: unknown, result: unknown) => expect(encodePairingTransportResponse(request, result)).toEqual({ ok: false, error: "invalid_response" });
function invalidRequestText(value: string) {
  expect(decodePairingTransportRequest(bytes(value))).toEqual({ ok: false, error: "invalid_request" });
}
function invalidResponseText(value: string, request = requestFor("browserStatus")) {
  expect(decodePairingTransportResponse(bytes(value), request)).toEqual({ ok: false, error: "invalid_response" });
}

test("frozen caps and malformed-input controls", () => {
  expect(PAIRING_TRANSPORT_MAX_REQUEST_BYTES).toBe(1_024);
  expect(PAIRING_TRANSPORT_MAX_RESPONSE_BYTES).toBe(512);
  expect(encodePairingTransportRequest(null)).toEqual({ ok: false, error: "invalid_request" });
  expect(decodePairingTransportResponse(bytes("{}"), null)).toEqual({ ok: false, error: "invalid_response" });
});

for (const operation of operations) {
  test(`${operation} has exact canonical request and domain response bytes`, () => {
    const request = { schemaVersion: 1, operation, input: inputs[operation] };
    const canonicalRequest = JSON.stringify(request);
    const encoded = encodePairingTransportRequest(request);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(text(encoded.value)).toBe(canonicalRequest);
    expect<unknown>(decodePairingTransportRequest(bytes(canonicalRequest))).toEqual({ ok: true, value: request });
    const result = { ok: true, value: values[operation] };
    const canonicalResponse = JSON.stringify({ schemaVersion: 1, operation, result });
    const response = encodePairingTransportResponse(request, result);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(text(response.value)).toBe(canonicalResponse);
    expect<unknown>(decodePairingTransportResponse(bytes(canonicalResponse), request)).toEqual({ ok: true, value: result });
  });
}

test("per-operation domain errors are exact and remain domain failures inside transport success", () => {
  const common = ["invalid_input", "not_initialized", "unauthorized", "storage_invalid", "clock_regressed"];
  const extra = {
    beginBrowserAttempt: ["expired", "invalid_transition", "attempt_limit"],
    recordVerifiedAuthentication: ["expired", "invalid_transition", "authentication_not_fresh", "conflict"],
    browserStatus: [],
    decideBrowser: ["expired", "invalid_transition", "authentication_not_fresh"],
  };
  const all = [...new Set([...common, ...Object.values(extra).flat(), "throttled", "not_reserved", "recovery_required", "internal_detail"] )];
  for (const operation of operations) for (const error of all) {
    const request = requestFor(operation), result = { ok: false, error };
    if ([...common, ...extra[operation]].includes(error)) {
      const encoded = unwrap(encodePairingTransportResponse(request, result));
      expect(text(encoded)).toBe(JSON.stringify({ schemaVersion: 1, operation, result }));
      expect<unknown>(unwrap(decodePairingTransportResponse(encoded, request))).toEqual(result);
    } else invalidResponse(request, result);
  }
});

test("maximum canonical bodies fit caps, including the 513-byte record request", () => {
  const max = PAIRING_TRANSPORT_MAX_TIME_MS;
  const maximumInputs = {
    beginBrowserAttempt: inputs.beginBrowserAttempt,
    recordVerifiedAuthentication: { ...inputs.recordVerifiedAuthentication, authTimeMs: max, sessionExpiresAtMs: max },
    browserStatus: inputs.browserStatus,
    decideBrowser: { ...inputs.decideBrowser, liveSessionExpiresAtMs: max },
  };
  const maximumValues = {
    beginBrowserAttempt: { ...values.beginBrowserAttempt, startedAtMs: max - 600_000, expiresAtMs: max },
    recordVerifiedAuthentication: values.recordVerifiedAuthentication,
    browserStatus: { state: "terminal-confirmed", expiresAtMs: max, accountId: account, authenticationExpiresAtMs: max },
    decideBrowser: { state: "terminal-confirmed", expiresAtMs: max, accountId: account, authenticationExpiresAtMs: max },
  };
  const requestLengths = [223, 513, 378, 493], responseLengths = [307, 109, 235, 235];
  operations.forEach((operation, index) => {
    const request = { schemaVersion: 1, operation, input: maximumInputs[operation] };
    const encoded = unwrap(encodePairingTransportRequest(request));
    expect(encoded.length).toBe(requestLengths[index]);
    expect<unknown>(unwrap(decodePairingTransportRequest(encoded))).toEqual(request);
    const response = unwrap(encodePairingTransportResponse(request, { ok: true, value: maximumValues[operation] }));
    expect(response.length).toBe(responseLengths[index]);
    expect(decodePairingTransportResponse(response, request).ok).toBe(true);
  });
});

test("zero is allowed but negative zero, unsafe times and fractional auth seconds are refused", () => {
  const template = inputs.recordVerifiedAuthentication;
  for (const value of [0, 1_000, PAIRING_TRANSPORT_MAX_TIME_MS]) {
    expect(encodePairingTransportRequest({ schemaVersion: 1, operation: "recordVerifiedAuthentication", input: { ...template, authTimeMs: value, sessionExpiresAtMs: value } }).ok).toBe(true);
  }
  for (const value of [-0, -1, 0.5, NaN, Infinity, -Infinity, PAIRING_TRANSPORT_MAX_TIME_MS + 1, Number.MAX_SAFE_INTEGER + 1, "1000", null, true, 1n]) {
    for (const field of ["authTimeMs", "sessionExpiresAtMs"]) invalidRequest({ schemaVersion: 1, operation: "recordVerifiedAuthentication", input: { ...template, [field]: value } });
    invalidRequest({ schemaVersion: 1, operation: "decideBrowser", input: { ...inputs.decideBrowser, liveSessionExpiresAtMs: value } });
  }
  for (const authTimeMs of [1, 999, 1_001]) invalidRequest({ schemaVersion: 1, operation: "recordVerifiedAuthentication", input: { ...template, authTimeMs } });
});

test("begin lifetime and fixed tokens refuse malformed values at either boundary", () => {
  const request = requestFor("beginBrowserAttempt");
  for (const length of [1, 600_000]) {
    expect(encodePairingTransportResponse(request, { ok: true, value: { ...values.beginBrowserAttempt, startedAtMs: 0, expiresAtMs: length } }).ok).toBe(true);
  }
  for (const [startedAtMs, expiresAtMs] of [[0, 0], [1, 0], [0, 600_001], [-0, 1], [0, PAIRING_TRANSPORT_MAX_TIME_MS + 1], [0.5, 1]]) {
    invalidResponse(request, { ok: true, value: { ...values.beginBrowserAttempt, startedAtMs, expiresAtMs } });
  }
  const malformed = ["", "0".repeat(64), "1".repeat(63), "1".repeat(65), "A".repeat(64), `${hex("1")}\n`, null, 1, true, {}];
  for (const token of malformed) {
    for (const field of Object.keys(proof)) invalidRequest({ schemaVersion: 1, operation: "browserStatus", input: { ...proof, [field]: token } });
    for (const field of ["attemptId", "contextToken"]) invalidResponse(request, { ok: true, value: { ...values.beginBrowserAttempt, [field]: token } });
  }
});

test("account grammar permits the opaque zero suffix but not case, suffix or type changes", () => {
  for (const accountId of [`acct_${"0".repeat(32)}`, account]) {
    expect(encodePairingTransportRequest({ schemaVersion: 1, operation: "decideBrowser", input: { ...inputs.decideBrowser, accountId } }).ok).toBe(true);
  }
  for (const accountId of ["", "acct_", "ACCT_" + "a".repeat(32), "acct_" + "A".repeat(32), account + "\n", account + "0", account.slice(1), null, {}, 5]) {
    invalidRequest({ schemaVersion: 1, operation: "decideBrowser", input: { ...inputs.decideBrowser, accountId } });
    invalidResponse(requestFor("browserStatus"), { ok: true, value: { ...values.browserStatus, accountId, authenticationExpiresAtMs: 1 } });
  }
});

test("status keeps expired evidence and independent deadlines without manufacturing freshness", () => {
  for (const state of ["pending", "denied", "expired", "browser-approved", "terminal-confirmed"]) {
    const request = requestFor("browserStatus");
    const value = { state, expiresAtMs: 0, accountId: account, authenticationExpiresAtMs: PAIRING_TRANSPORT_MAX_TIME_MS };
    const encoded = unwrap(encodePairingTransportResponse(request, { ok: true, value }));
    expect<unknown>(unwrap(decodePairingTransportResponse(encoded, request))).toEqual({ ok: true, value });
    if (["pending", "denied", "expired"].includes(state)) {
      expect(encodePairingTransportResponse(request, { ok: true, value: { ...value, accountId: null, authenticationExpiresAtMs: null } }).ok).toBe(true);
    } else invalidResponse(request, { ok: true, value: { ...value, accountId: null, authenticationExpiresAtMs: null } });
  }
  for (const change of [{ accountId: account }, { authenticationExpiresAtMs: 1 }, { state: "approved" }, { expiresAtMs: -0 }, { expiresAtMs: -1 }]) {
    invalidResponse(requestFor("browserStatus"), { ok: true, value: { ...values.browserStatus, ...change } });
  }
});

test("decision response matches the full checked request's account and decision", () => {
  for (const decision of ["approve", "deny"]) for (const state of ["pending", "browser-approved", "terminal-confirmed", "denied", "expired"]) {
    const request = { schemaVersion: 1, operation: "decideBrowser", input: { ...inputs.decideBrowser, decision } };
    const result = { ok: true, value: { ...values.decideBrowser, state } };
    expect(encodePairingTransportResponse(request, result).ok).toBe(decision === "deny" ? state === "denied" : ["browser-approved", "terminal-confirmed"].includes(state));
  }
  const request = requestFor("decideBrowser"), result = resultFor("decideBrowser");
  const encoded = unwrap(encodePairingTransportResponse(request, result));
  const mismatched = { ...request, input: { ...request.input, accountId: `acct_${"b".repeat(32)}` } };
  invalidResponse(mismatched, result);
  expect(decodePairingTransportResponse(encoded, mismatched)).toEqual({ ok: false, error: "invalid_response" });
  for (const invalid of [null, {}, { ...request, extra: true }, { ...request, input: { ...request.input, intentId: "bad" } }, { ...request, input: { ...request.input, liveSessionExpiresAtMs: -1 } }]) {
    invalidResponse(invalid, result);
    expect(decodePairingTransportResponse(encoded, invalid)).toEqual({ ok: false, error: "invalid_response" });
  }
  expect(decodePairingTransportResponse(encoded, requestFor("browserStatus"))).toEqual({ ok: false, error: "invalid_response" });
});

test("all request and response record levels reject missing or additional fields", () => {
  for (const operation of operations) {
    const request = requestFor(operation), result = resultFor(operation);
    const mutate = (object: Record<string, unknown>) => [
      ...Object.keys(object).map(key => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key))),
      { ...object, extra: "PRIVATE_BODY_CANARY" }, { ...object, [Symbol("extra")]: 1 },
    ];
    for (const candidate of mutate(request)) invalidRequest(candidate);
    for (const input of mutate(request.input)) invalidRequest({ ...request, input });
    for (const candidate of mutate(result)) invalidResponse(request, candidate);
    for (const value of mutate(result.value)) invalidResponse(request, { ok: true, value });
    for (const candidate of [
      { ok: true, value: result.value, error: "invalid_input" }, { ok: false, value: result.value },
      { ok: 1, value: result.value }, { ok: "true", value: result.value },
      { ok: false, error: "invalid_input", extra: true },
    ]) invalidResponse(request, candidate);
  }
});

test("recorded is exactly true and no other operation or schema is an RPC escape", () => {
  for (const recorded of [false, 1, "true", null, {}]) invalidResponse(requestFor("recordVerifiedAuthentication"), { ok: true, value: { recorded } });
  for (const operation of ["initialize", "poll", "confirm", "reserveEnrollment", "enroll", "admitBatch", "fetch", "constructor", "toString", "__proto__", "", 1, null]) invalidRequest({ ...requestFor("browserStatus"), operation });
  for (const schemaVersion of [0, 2, "1", true, null, NaN]) invalidRequest({ ...requestFor("browserStatus"), schemaVersion });
});

test("plain or null data records are copied; foreign prototypes and field getters are refused", () => {
  const request = requestFor("browserStatus"), result = resultFor("browserStatus");
  const nullRecord = (value: object) => Object.assign(Object.create(null), value);
  expect(encodePairingTransportRequest(nullRecord({ ...request, input: nullRecord(request.input) })).ok).toBe(true);
  expect(encodePairingTransportResponse(request, nullRecord({ ...result, value: nullRecord(result.value) })).ok).toBe(true);
  let getterCalls = 0;
  const getter = (value: object, key: string) => Object.defineProperty({ ...value }, key, { get() { getterCalls++; throw new Error("PRIVATE_GETTER"); }, enumerable: true });
  invalidRequest(getter(request, "input"));
  invalidRequest({ ...request, input: getter(request.input, "intentId") });
  invalidResponse(request, getter(result, "value"));
  invalidResponse(request, { ...result, value: getter(result.value, "state") });
  expect(getterCalls).toBe(0);
  for (const value of [[], new Date(0), new (class Example {})(), Object.create({}), new Uint8Array(1)]) {
    invalidRequest(value);
    invalidRequest({ ...request, input: value });
    invalidResponse(request, value);
  }
  const revocable = Proxy.revocable(request, {});
  revocable.revoke();
  invalidRequest(revocable.proxy);
  invalidResponse(revocable.proxy, result);
});

test("non-enumerable own fields are refused rather than normalized into wire members", () => {
  const hide = (value: object, key: string) => Object.defineProperty({ ...value }, key, { enumerable: false });
  for (const operation of operations) {
    const request = requestFor(operation), result = resultFor(operation);
    for (const key of Object.keys(request)) invalidRequest(hide(request, key));
    for (const key of Object.keys(request.input)) invalidRequest({ ...request, input: hide(request.input, key) });
    for (const key of Object.keys(result)) invalidResponse(request, hide(result, key));
    for (const key of Object.keys(result.value)) invalidResponse(request, { ...result, value: hide(result.value, key) });
    invalidResponse(request, hide({ ok: false, error: "invalid_input" }, "error"));
    const encoded = unwrap(encodePairingTransportResponse(request, result));
    expect(decodePairingTransportResponse(encoded, hide(request, "input"))).toEqual({ ok: false, error: "invalid_response" });
  }
});

test("inherited toJSON is neither invoked nor allowed to replace canonical bytes", () => {
  const request = requestFor("decideBrowser"), result = resultFor("decideBrowser");
  const expectedRequest = JSON.stringify(request), expectedResponse = JSON.stringify({ schemaVersion: 1, operation: request.operation, result });
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  let calls = 0, encoded: ReturnType<typeof encodePairingTransportRequest> | undefined, response: ReturnType<typeof encodePairingTransportResponse> | undefined;
  let decoded: ReturnType<typeof decodePairingTransportRequest> | undefined, decodedResponse: ReturnType<typeof decodePairingTransportResponse> | undefined;
  try {
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value() { calls++; return "PRIVATE_SERIALIZER"; } });
    encoded = encodePairingTransportRequest(request);
    response = encodePairingTransportResponse(request, result);
    decoded = decodePairingTransportRequest(bytes(expectedRequest));
    decodedResponse = decodePairingTransportResponse(bytes(expectedResponse), request);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "toJSON", original);
    else Reflect.deleteProperty(Object.prototype, "toJSON");
  }
  expect(calls).toBe(0);
  expect(text(unwrap(encoded!))).toBe(expectedRequest);
  expect(text(unwrap(response!))).toBe(expectedResponse);
  expect<unknown>(unwrap(decoded!)).toEqual(request);
  expect<unknown>(unwrap(decodedResponse!)).toEqual(result);
});

test("request and result metadata are deeply frozen, owned and independent of later input mutation", () => {
  const request = requestFor("browserStatus");
  const encoded = unwrap(encodePairingTransportRequest(request));
  const decoded = unwrap(decodePairingTransportRequest(encoded));
  request.input.intentId = hex("5");
  encoded.fill(0);
  expect(decoded.input.intentId).toBe(proof.intentId);
  for (const value of [decoded, decoded.input]) {
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.getPrototypeOf(value)).toBeNull();
  }
  const view = { ...values.browserStatus, accountId: account, authenticationExpiresAtMs: 1 };
  const response = unwrap(encodePairingTransportResponse(request, { ok: true, value: view }));
  const outer = decodePairingTransportResponse(response, request);
  const domain = unwrap(outer);
  view.accountId = `acct_${"b".repeat(32)}`;
  response.fill(0);
  expect(Object.isFrozen(outer)).toBe(true);
  expect(Object.isFrozen(domain)).toBe(true);
  expect(domain.ok).toBe(true);
  if (domain.ok) {
    expect(Object.isFrozen(domain.value)).toBe(true);
    expect<unknown>(domain.value).toEqual({ ...values.browserStatus, accountId: account, authenticationExpiresAtMs: 1 });
  }
});

test("each encoded value owns exactly its backing bytes across calls and buffer views", () => {
  const request = requestFor("browserStatus"), canonical = JSON.stringify(request);
  const first = unwrap(encodePairingTransportRequest(request)), second = unwrap(encodePairingTransportRequest(request));
  expect(first.byteOffset).toBe(0);
  expect(first.buffer.byteLength).toBe(first.byteLength);
  expect(second.buffer).not.toBe(first.buffer);
  new Uint8Array(first.buffer).fill(0);
  expect(text(second)).toBe(canonical);
  const backing = new Uint8Array(second.length + 20);
  backing.fill(0xff); backing.set(second, 10);
  const view = backing.subarray(10, 10 + second.length);
  expect<unknown>(unwrap(decodePairingTransportRequest(view))).toEqual(request);
  const response1 = unwrap(encodePairingTransportResponse(request, resultFor("browserStatus")));
  const response2 = unwrap(encodePairingTransportResponse(request, resultFor("browserStatus")));
  expect(response1.buffer.byteLength).toBe(response1.byteLength);
  expect(response1.byteOffset).toBe(0);
  expect(response1.buffer).not.toBe(response2.buffer);
  new Uint8Array(response1.buffer).fill(0);
  expect(decodePairingTransportResponse(response2, request).ok).toBe(true);
});

test("intrinsic byte views ignore overridable accessors and reject nonfixed backing", () => {
  const canonical = bytes(JSON.stringify(requestFor("browserStatus")));
  const poisoned = canonical.slice();
  let calls = 0;
  for (const name of ["buffer", "byteLength", "byteOffset", "length"]) Object.defineProperty(poisoned, name, { get() { calls++; throw new Error("PRIVATE_VIEW"); } });
  Object.defineProperty(poisoned, Symbol.iterator, { value() { calls++; throw new Error("PRIVATE_ITERATOR"); } });
  expect(decodePairingTransportRequest(poisoned).ok).toBe(true);
  expect(calls).toBe(0);
  const shared = new Uint8Array(new SharedArrayBuffer(canonical.length)); shared.set(canonical);
  const resizable = new Uint8Array(new ArrayBuffer(canonical.length, { maxByteLength: canonical.length + 1 })); resizable.set(canonical);
  const detached = canonical.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const value of [shared, resizable, detached, new Uint8ClampedArray(canonical), new DataView(canonical.buffer), [...canonical], new Proxy(canonical, {})]) {
    expect(decodePairingTransportRequest(value as Uint8Array)).toEqual({ ok: false, error: "invalid_request" });
  }
});

test("strict request bytes reject every truncation and noncanonical syntax mutation", () => {
  for (const operation of operations) {
    const request = requestFor(operation), canonical = JSON.stringify(request);
    for (let length = 0; length < canonical.length; length++) invalidRequestText(canonical.slice(0, length));
    for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029", " ", "{}", "\0"]) invalidRequestText(canonical + suffix);
    for (const malformed of [
      ` ${canonical}`, `\ufeff${canonical}`, canonical.replace('"schemaVersion":1', '"schemaVersion":1.0'),
      canonical.replace('"schemaVersion":1', '"schemaVersion":1e0'), canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
      canonical.replace('"schemaVersion"', '"schema\\u0056ersion"'), JSON.stringify({ operation, schemaVersion: 1, input: request.input }),
      JSON.stringify({ ...request, input: Object.fromEntries(Object.entries(request.input).reverse()) }),
    ]) invalidRequestText(malformed);
  }
  const zero = JSON.stringify({ schemaVersion: 1, operation: "decideBrowser", input: { ...inputs.decideBrowser, liveSessionExpiresAtMs: 0 } });
  invalidRequestText(zero.replace('"liveSessionExpiresAtMs":0', '"liveSessionExpiresAtMs":-0'));
  for (const value of [new Uint8Array(1_025), Uint8Array.of(0xc0, 0xaf), Uint8Array.of(0xff), Uint8Array.of(0xef, 0xbb, 0xbf)]) {
    expect(decodePairingTransportRequest(value)).toEqual({ ok: false, error: "invalid_request" });
  }
});

test("strict response bytes reject every truncation, envelope extension and operation mismatch", () => {
  for (const operation of operations) {
    const request = requestFor(operation), result = resultFor(operation);
    const canonical = JSON.stringify({ schemaVersion: 1, operation, result });
    for (let length = 0; length < canonical.length; length++) invalidResponseText(canonical.slice(0, length), request);
    for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029", " ", "{}", "\0"]) invalidResponseText(canonical + suffix, request);
    for (const malformed of [
      ` ${canonical}`, `\ufeff${canonical}`, canonical.replace('"schemaVersion":1', '"schemaVersion":1.0'),
      canonical.replace('"schemaVersion":1', '"schemaVersion":2'), canonical.replace('"schemaVersion"', '"schema\\u0056ersion"'),
      canonical.replace('"ok":true', '"ok":true,"ok":true'), JSON.stringify({ schemaVersion: 1, operation, result, extra: true }),
      JSON.stringify({ operation, schemaVersion: 1, result }), JSON.stringify({ schemaVersion: 1, operation, result: { value: result.value, ok: true } }),
      JSON.stringify({ schemaVersion: 1, operation, result: { ok: true, value: Object.fromEntries(Object.entries(result.value).reverse()) } }),
    ]) {
      // The one-field record value is already canonically ordered.
      if (malformed !== canonical) invalidResponseText(malformed, request);
    }
    const other = operation === "browserStatus" ? "decideBrowser" : "browserStatus";
    invalidResponseText(JSON.stringify({ schemaVersion: 1, operation: other, result }), request);
  }
  expect(decodePairingTransportResponse(new Uint8Array(513), requestFor("browserStatus"))).toEqual({ ok: false, error: "invalid_response" });
  invalidResponseText('{"schemaVersion":1,"error":{"code":"coordinator_unavailable"}}');
});

test("seeded valid DTOs obey roundtrip, deterministic byte identity and owned mutation laws", () => {
  let seed = 0x51ca7d29;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const token = () => Array.from({ length: 8 }, () => random().toString(16).padStart(8, "0")).join("");
  for (let index = 0; index < 800; index++) {
    const operation = operations[index % operations.length];
    const generatedProof = { intentId: token(), attemptId: token(), browserNonce: token(), contextToken: token() };
    const accountId = `acct_${token().slice(0, 32)}`, start = random(), duration = random() % 600_000 + 1;
    let input: object, value: object;
    if (operation === "beginBrowserAttempt") {
      input = { intentId: generatedProof.intentId, browserNonce: generatedProof.browserNonce };
      value = { attemptId: token(), contextToken: token(), startedAtMs: start, expiresAtMs: start + duration };
    } else if (operation === "recordVerifiedAuthentication") {
      input = { ...generatedProof, accountId, authTimeMs: Math.floor(start / 1_000) * 1_000, sessionExpiresAtMs: start + duration };
      value = { recorded: true };
    } else {
      const decision = index % 3 === 0 ? "deny" : "approve";
      input = operation === "browserStatus" ? generatedProof : { ...generatedProof, accountId, liveSessionExpiresAtMs: start + duration, decision };
      const state = operation === "browserStatus" ? ["pending", "denied", "expired", "browser-approved", "terminal-confirmed"][random() % 5]
        : decision === "deny" ? "denied" : index % 3 === 1 ? "browser-approved" : "terminal-confirmed";
      const missing = operation === "browserStatus" && ["pending", "denied", "expired"].includes(state) && random() % 2 === 0;
      value = { state, expiresAtMs: start, accountId: missing ? null : accountId, authenticationExpiresAtMs: missing ? null : start + duration };
    }
    const request = { schemaVersion: 1, operation, input }, result = { ok: true, value };
    const encoded = unwrap(encodePairingTransportRequest(request));
    expect(text(encoded)).toBe(JSON.stringify(request));
    const parsed = unwrap(decodePairingTransportRequest(encoded));
    expect<unknown>(parsed).toEqual(request);
    expect(unwrap(encodePairingTransportRequest(parsed))).toEqual(encoded);
    const response = unwrap(encodePairingTransportResponse(parsed, result));
    expect(text(response)).toBe(JSON.stringify({ schemaVersion: 1, operation, result }));
    expect<unknown>(unwrap(decodePairingTransportResponse(response, request))).toEqual(result);
    encoded.fill(0); response.fill(0);
    expect<unknown>(parsed).toEqual(request);
  }
});

test("seeded arbitrary bytes and JSON shapes either refuse or regenerate exactly", () => {
  let seed = 0xadc024f1;
  const random = () => { seed = Math.imul(seed, 1_664_525) + 1_013_904_223 | 0; return seed >>> 0; };
  const scalar: unknown[] = [null, true, false, 0, 1, -0, -1, "", "approve", account, hex("1"), [], {}];
  for (let index = 0; index < 1_200; index++) {
    const data = Uint8Array.from({ length: random() % 1_050 }, () => random() & 255);
    const decoded = decodePairingTransportRequest(data);
    if (decoded.ok) expect(unwrap(encodePairingTransportRequest(decoded.value))).toEqual(data);
    else expect(decoded.error).toBe("invalid_request");
    const request = requestFor(operations[index % 4]);
    const field = ["schemaVersion", "operation", "input"][random() % 3];
    const shape = { ...request, [field]: scalar[random() % scalar.length] };
    const encoded = encodePairingTransportRequest(shape);
    if (encoded.ok) expect<unknown>(unwrap(decodePairingTransportRequest(encoded.value))).toEqual(shape);
    else expect(encoded.error).toBe("invalid_request");
    const response = decodePairingTransportResponse(data, request);
    if (response.ok) expect(unwrap(encodePairingTransportResponse(request, response.value))).toEqual(data);
    else expect(response.error).toBe("invalid_response");
  }
});
