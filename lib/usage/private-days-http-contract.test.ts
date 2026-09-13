import { expect, test } from "bun:test";
import { type PrivateDaysRequestV1, type PrivateDaysV1 } from "./private-days-contract";
import { decodePrivateDaysHttpRequest, decodePrivateDaysHttpResponse, encodePrivateDaysHttpRequest, encodePrivateDaysHttpResponse,
  parsePrivateDaysRange, privateDaysHttpLength, PRIVATE_DAYS_HTTP_REQUEST_BYTES, PRIVATE_DAYS_HTTP_RESPONSE_BYTES } from "./private-days-http-contract";

const query: PrivateDaysRequestV1 = { schemaVersion: 1, accountId: `acct_${"a".repeat(32)}`, sessionExpiresAtMs: 100_000, firstUtcDay: 0, dayCount: 1 };
const empty = () => ({ usageOccurrences: 0, observedAccountedTokens: "0", observedOutputTokens: "0" });
const value: PrivateDaysV1 = { schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial", journalRevision: 0,
  journalCommittedAtMs: null, firstUtcDay: 0, days: [{ utcDay: 0, codex: empty(), claudeCode: empty() }] };
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array | null) => new TextDecoder().decode(value!);

test("canonical request and result bytes preserve the frozen query contract", () => {
  const encoded = encodePrivateDaysHttpRequest(query);
  expect(text(encoded)).toBe(JSON.stringify(query)); expect(decodePrivateDaysHttpRequest(encoded)).toEqual(query);
  expect(encoded!.byteLength).toBeLessThan(PRIVATE_DAYS_HTTP_REQUEST_BYTES);
  const result = { ok: true as const, value };
  const reply = encodePrivateDaysHttpResponse(query, result);
  expect(text(reply)).toBe(JSON.stringify({ schemaVersion: 1, result }));
  expect(decodePrivateDaysHttpResponse(reply, query)).toEqual(result);
  expect(Object.isFrozen(decodePrivateDaysHttpResponse(reply, query))).toBe(true);
});

test("every encoded response field is independent of inherited object and array JSON hooks", () => {
  const source = { ok: true, value }, expected = JSON.stringify({ schemaVersion: 1, result: source });
  for (const prototype of [Object.prototype, Array.prototype]) for (const throwing of [false, true]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    let calls = 0, encoded: Uint8Array | null = null, decoded: unknown;
    try {
      Object.defineProperty(prototype, "toJSON", { configurable: true, value() {
        calls++; if (throwing) throw new Error("SYNTHETIC_PRIVATE_CANARY"); return "SYNTHETIC_PRIVATE_CANARY";
      } });
      encoded = encodePrivateDaysHttpResponse(query, source);
      decoded = decodePrivateDaysHttpResponse(bytes(expected), query);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(prototype, "toJSON");
      else Object.defineProperty(prototype, "toJSON", descriptor);
    }
    expect(calls).toBe(0); expect(text(encoded)).toBe(expected); expect(decoded).toEqual(source);
  }
});

test("all and only query domain errors survive the transport codec", () => {
  for (const error of ["invalid_input", "unauthorized", "not_enrolled", "expired", "recovery_required", "clock_regressed", "storage_invalid", "storage_unavailable"] as const) {
    const result = { ok: false as const, error };
    expect(decodePrivateDaysHttpResponse(encodePrivateDaysHttpResponse(query, result), query)).toEqual(result);
  }
  for (const error of ["revoked", "not_reserved", "limit", "PRIVATE_CANARY", ""]) expect(encodePrivateDaysHttpResponse(query, { ok: false, error })).toBeNull();
});

test("range input has no account, expiry, credential or getter escape hatch", () => {
  expect(parsePrivateDaysRange({ firstUtcDay: 0, dayCount: 31 })).toEqual({ firstUtcDay: 0, dayCount: 31 });
  for (const value of [query, { firstUtcDay: 0, dayCount: 32 }, { firstUtcDay: 0, dayCount: 1, accountId: query.accountId },
    { firstUtcDay: 0, dayCount: 1, sessionExpiresAtMs: 9_000_000 }, { get firstUtcDay() { throw new Error("PRIVATE_CANARY"); }, dayCount: 1 }]) {
    expect(parsePrivateDaysRange(value)).toBeNull();
  }
});

test("noncanonical JSON, duplicate keys and arbitrary fields are refused", () => {
  const source = JSON.stringify(query);
  for (const invalid of [" " + source, source + "\n", source.replace('"dayCount":1', '"dayCount":1,"dayCount":1'),
    source.replace('"schemaVersion":1', '"schemaVersion":1.0'), source.replace('"firstUtcDay":0', '"firstUtcDay":-0'),
    source.replace('"schemaVersion":1,', ''), JSON.stringify({ ...query, extra: "PRIVATE_CANARY" }), "x".repeat(257)]) {
    expect(decodePrivateDaysHttpRequest(bytes(invalid))).toBeNull();
  }
  const reply = text(encodePrivateDaysHttpResponse(query, { ok: true, value }));
  for (const invalid of [" " + reply, reply + "\n", reply.replace('"schemaVersion":1,', '"schemaVersion":1,"schemaVersion":1,'),
    reply.replace('"coverage":"partial"', '"coverage":"complete"'), reply.replace('"observedAccountedTokens":"0"', '"observedAccountedTokens":"00"'),
    reply.replace('"result":', '"email":"PRIVATE_CANARY","result":')]) expect(decodePrivateDaysHttpResponse(bytes(invalid), query)).toBeNull();
  expect(decodePrivateDaysHttpResponse(bytes(reply), { ...query, firstUtcDay: 1 })).toBeNull();
});

test("byte ownership rejects shared/resizable buffers, oversize and non-ASCII", () => {
  const valid = encodePrivateDaysHttpRequest(query)!;
  const shared = new Uint8Array(new SharedArrayBuffer(valid.length)); shared.set(valid);
  const resizable = new Uint8Array(new ArrayBuffer(valid.length, { maxByteLength: valid.length + 1 })); resizable.set(valid);
  for (const invalid of [null, {}, new DataView(valid.buffer), shared, resizable, new Uint8Array(257), Uint8Array.of(255)]) {
    expect(decodePrivateDaysHttpRequest(invalid)).toBeNull();
  }
  expect(decodePrivateDaysHttpResponse(new Uint8Array(PRIVATE_DAYS_HTTP_RESPONSE_BYTES + 1), query)).toBeNull();
});

test("query framing supports five-digit response lengths within its exact cap", () => {
  expect(privateDaysHttpLength(new Headers(), 16_384)).toBeNull();
  expect(privateDaysHttpLength(new Headers({ "content-length": "16384" }), 16_384)).toBe(16_384);
  for (const length of ["0", "01", "16385", "100000", "1.0", "1, 1"]) {
    expect(() => privateDaysHttpLength(new Headers({ "content-length": length }), 16_384)).toThrow("private_days_framing");
  }
});
