import { expect, test } from "bun:test";
import { fc } from "../property-test";
import type { PrivateDaysV1 } from "./private-days-contract";
import { decodePrivateDaysPublicResponse, encodePrivateDaysPublicResponse, parsePrivateDaysPublicReply,
  parsePrivateDaysPublicSearch, privateDaysPublicPath, privateDaysPublicStatus, PRIVATE_DAYS_PUBLIC_MAX_BYTES,
  type PrivateDaysPublicReply } from "./private-days-public";

const range = { firstUtcDay: 10, dayCount: 2 };
const totals = () => ({ usageOccurrences: 0, observedAccountedTokens: "0", observedOutputTokens: "0" });
const value = (query = range) => ({ schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
  journalRevision: 0, journalCommittedAtMs: null, firstUtcDay: query.firstUtcDay,
  days: Array.from({ length: query.dayCount }, (_, index) => ({ utcDay: query.firstUtcDay + index, codex: totals(), claudeCode: totals() })) } satisfies PrivateDaysV1);
const ready = (): PrivateDaysPublicReply => ({ schemaVersion: 1, state: "ready", value: value() });
const bytes = (text: string) => new TextEncoder().encode(text);

test("public range paths preserve exact UTC bounds and canonical query order", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_970 }), fc.integer({ min: 1, max: 31 }), (firstUtcDay, dayCount) => {
    const range = { firstUtcDay, dayCount }, path = privateDaysPublicPath(range)!;
    expect(parsePrivateDaysPublicSearch(path.slice(path.indexOf("?")))).toEqual(range);
  }), { numRuns: 100 });
  expect(parsePrivateDaysPublicSearch("?firstUtcDay=100000000&dayCount=1")).toEqual({ firstUtcDay: 100_000_000, dayCount: 1 });
  for (const text of ["", "?dayCount=2&firstUtcDay=10", "?firstUtcDay=01&dayCount=2", "?firstUtcDay=-0&dayCount=2",
    "?firstUtcDay=1e1&dayCount=2", "?firstUtcDay=%31&dayCount=2", "?firstUtcDay=100000000&dayCount=2",
    "?firstUtcDay=100000001&dayCount=1", "?firstUtcDay=0&dayCount=0", "?firstUtcDay=0&dayCount=32", "?firstUtcDay=0&dayCount=01",
    "?firstUtcDay=0&dayCount=1&dayCount=1", "?firstUtcDay=0&dayCount=1&accountId=PRIVATE_CANARY", "?firstUtcDay=0&dayCount=1\n"]) {
    expect(parsePrivateDaysPublicSearch(text)).toBeNull();
  }
  expect(privateDaysPublicPath({ ...range, accountId: "PRIVATE_CANARY" })).toBeNull();
});

test("ready, not-enrolled and finite errors have distinct exact public shapes and statuses", () => {
  const bodies: PrivateDaysPublicReply[] = [ready(), { schemaVersion: 1, state: "not_enrolled" }];
  for (const code of ["invalid_request", "authentication_required", "request_rejected", "method_not_allowed", "unavailable"] as const) bodies.push({ schemaVersion: 1, error: { code } });
  for (const [index, body] of bodies.entries()) {
    const encoded = encodePrivateDaysPublicResponse(body, range)!;
    expect(new TextDecoder().decode(encoded)).toBe(JSON.stringify(body));
    expect(decodePrivateDaysPublicResponse(encoded, range)).toEqual(body);
    expect(privateDaysPublicStatus(body)).toBe(([200, 200, 400, 401, 403, 405, 503] as const)[index]);
  }
  const source = value();
  const owned = parsePrivateDaysPublicReply({ schemaVersion: 1, state: "ready", value: source }, range);
  source.days[0].codex = totals();
  if (owned === null || !("value" in owned)) throw new Error("Missing checked fixture.");
  for (const part of [owned, owned.value, owned.value.days, owned.value.days[0], owned.value.days[0].codex]) expect(Object.isFrozen(part)).toBe(true);
});

test("public ownership rejects added identity, wrong coverage and range substitution", () => {
  for (const body of [{ ...ready(), accountId: "PRIVATE_CANARY" }, { schemaVersion: 1, state: "not_enrolled", days: [] },
    { schemaVersion: 1, error: { code: "storage_invalid" } }, { schemaVersion: 1, error: { code: "unavailable", message: "PRIVATE_CANARY" } },
    { schemaVersion: 1, state: "ready", value: { ...value(), coverage: "complete" } },
    { schemaVersion: 1, state: "ready", value: { ...value(), sessionExpiresAtMs: 100_000 } }]) expect(encodePrivateDaysPublicResponse(body, range)).toBeNull();
  const encoded = encodePrivateDaysPublicResponse(ready(), range)!;
  expect(decodePrivateDaysPublicResponse(encoded, { ...range, firstUtcDay: 11 })).toBeNull();
  expect(decodePrivateDaysPublicResponse(encoded, { ...range, dayCount: 1 })).toBeNull();
  let called = 0;
  expect(encodePrivateDaysPublicResponse({ schemaVersion: 1, state: "ready", get value() { called++; return value(); } }, range)).toBeNull();
  expect(called).toBe(0);
});

test("bounded canonical bytes reject alternate JSON, malformed buffers and oversized payloads", () => {
  const encoded = encodePrivateDaysPublicResponse(ready(), range)!, text = new TextDecoder().decode(encoded);
  for (const changed of [" " + text, text + "\n", text.replace('"schemaVersion":1,', '"schemaVersion":1,"schemaVersion":1,'),
    text.replace('"utcDay":10', '"utcDay":10.0'), text.replace('"state":"ready"', '"state":"re\\u0061dy"')]) {
    expect(decodePrivateDaysPublicResponse(bytes(changed), range)).toBeNull();
  }
  const shared = new Uint8Array(new SharedArrayBuffer(encoded.length)); shared.set(encoded);
  const growing = new Uint8Array(new ArrayBuffer(encoded.length, { maxByteLength: encoded.length + 1 })); growing.set(encoded);
  for (const input of [null, {}, new DataView(encoded.buffer), shared, growing, new Uint8Array(PRIVATE_DAYS_PUBLIC_MAX_BYTES + 1), Uint8Array.of(255)]) {
    expect(decodePrivateDaysPublicResponse(input, range)).toBeNull();
  }
  const largeRange = { firstUtcDay: 99_999_970, dayCount: 31 };
  expect(encodePrivateDaysPublicResponse({ schemaVersion: 1, state: "ready", value: value(largeRange) }, largeRange)!.length).toBeLessThan(PRIVATE_DAYS_PUBLIC_MAX_BYTES);
});

test("public serialization and decoding execute no inherited object or array JSON hooks", () => {
  const source = ready(), expected = JSON.stringify(source);
  for (const prototype of [Object.prototype, Array.prototype]) for (const throwing of [false, true]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    let calls = 0, encoded: Uint8Array | null = null, decoded: unknown;
    try {
      Object.defineProperty(prototype, "toJSON", { configurable: true, value() {
        calls++; if (throwing) throw new Error("PRIVATE_CANARY"); return "PRIVATE_CANARY";
      } });
      encoded = encodePrivateDaysPublicResponse(source, range); decoded = decodePrivateDaysPublicResponse(bytes(expected), range);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(prototype, "toJSON"); else Object.defineProperty(prototype, "toJSON", descriptor);
    }
    expect(calls).toBe(0); expect(new TextDecoder().decode(encoded!)).toBe(expected); expect(decoded).toEqual(source);
  }
});
