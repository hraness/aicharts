import { expect, test } from "bun:test";
import { assertProperty, fc } from "../property-test";
import {
  decodeUsageDashboardFrame, encodeUsageDashboardFrame, parseUsageDashboardQuery, parseUsageDashboardSearch,
  usageDashboardPath, USAGE_DASHBOARD_MAX_BYTES, USAGE_DASHBOARD_PARTS, USAGE_DASHBOARD_REFRESH_MAX_MS,
  type UsageDashboardFrame, type UsageDashboardFramePart, type UsageDashboardPart,
} from "./dashboard-public";

const A = `acct_${"a".repeat(32)}`;
const bytes = (text: string) => new TextEncoder().encode(text);

test("queries keep canonical part order, require a range exactly when stats is named, and round-trip through the path", () => {
  const all = { parts: ["account", "totals", "consent", "stats"], range: { firstUtcDay: 20_700, dayCount: 30 } };
  expect(usageDashboardPath(all)).toBe("/api/usage/dashboard?parts=account,totals,consent,stats&firstUtcDay=20700&dayCount=30");
  expect(usageDashboardPath({ parts: ["account", "consent"], range: null })).toBe("/api/usage/dashboard?parts=account,consent");
  for (const refused of [
    { parts: [], range: null }, { parts: ["stats"], range: null }, { parts: ["account"], range: { firstUtcDay: 1, dayCount: 1 } },
    { parts: ["totals", "account"], range: null }, { parts: ["account", "account"], range: null }, { parts: ["days"], range: null },
    { parts: ["stats"], range: { firstUtcDay: -1, dayCount: 1 } }, { parts: ["stats"], range: { firstUtcDay: 1, dayCount: 0 } },
    { parts: "account", range: null }, null, "account",
  ]) expect(parseUsageDashboardQuery(refused)).toBeNull();
  for (const search of ["?parts=account", "?parts=account,totals,consent,stats&firstUtcDay=0&dayCount=1", "?parts=stats&firstUtcDay=20700&dayCount=90"]) {
    const query = parseUsageDashboardSearch(search);
    expect(query).not.toBeNull(); expect(usageDashboardPath(query)).toBe(`/api/usage/dashboard${search}`);
  }
  for (const search of ["", "?", "?parts=", "?parts=totals,account", "?parts=account&firstUtcDay=1&dayCount=1", "?parts=stats",
    "?parts=stats&dayCount=1&firstUtcDay=1", "?parts=stats&firstUtcDay=01&dayCount=1", "?parts=account&extra=1", "?parts=account,",
    "?parts=Account", "?parts=account%2Ctotals", "?parts=account#x"]) expect(parseUsageDashboardSearch(search)).toBeNull();
});

const partArbitrary = (part: UsageDashboardPart) => fc.record({
  part: fc.constant(part),
  status: fc.constantFrom(...({ account: [200], totals: [200, 503], consent: [200, 503], stats: [200, 413, 503] } as const)[part]),
  bytes: fc.uint8Array({ minLength: 1, maxLength: 64 }),
});
const frameArbitrary: fc.Arbitrary<UsageDashboardFrame> = fc.oneof(
  fc.record({ kind: fc.constant("error" as const), error: fc.constantFrom("invalid_request", "request_rejected", "authentication_required", "method_not_allowed", "unavailable" as const) }),
  fc.subarray([...USAGE_DASHBOARD_PARTS], { minLength: 1 }).chain(parts => fc.record({
    kind: fc.constant("ready" as const),
    accountId: fc.stringMatching(/^[a-f0-9]{32}$/u).map(hex => `acct_${hex}`),
    sessionRefreshInMs: fc.integer({ min: 0, max: USAGE_DASHBOARD_REFRESH_MAX_MS }),
    parts: fc.tuple(...parts.map(partArbitrary)) as fc.Arbitrary<UsageDashboardFramePart[]>,
  })),
);

test("property: every valid frame round-trips byte for byte with owned part copies", () => {
  assertProperty(fc.property(frameArbitrary, frame => {
    const encoded = encodeUsageDashboardFrame(frame);
    expect(encoded).not.toBeNull();
    const decoded = decodeUsageDashboardFrame(encoded!);
    expect(decoded).toEqual(frame);
    expect(encodeUsageDashboardFrame(decoded!)).toEqual(encoded);
    if (decoded?.kind === "ready" && frame.kind === "ready") {
      for (const [index, part] of decoded.parts.entries()) expect(part.bytes.buffer).not.toBe(frame.parts[index]!.bytes.buffer);
    }
  }));
});

test("property: truncation and extension are refused, and any accepted mutation is its own canonical encoding", () => {
  assertProperty(fc.property(frameArbitrary, fc.nat(), fc.integer({ min: 1, max: 255 }), (frame, at, delta) => {
    const encoded = encodeUsageDashboardFrame(frame)!;
    for (let length = 0; length < encoded.byteLength; length++) expect(decodeUsageDashboardFrame(encoded.subarray(0, length))).toBeNull();
    expect(decodeUsageDashboardFrame(new Uint8Array([...encoded, 0]))).toBeNull();
    const changed = new Uint8Array(encoded); const index = at % changed.byteLength;
    changed[index] = (changed[index]! + delta) % 256;
    // The frame carries no integrity code (TLS does); a changed digit can name
    // another valid frame. It must never decode to anything but its exact bytes.
    const decoded = decodeUsageDashboardFrame(changed);
    if (decoded !== null) expect(encodeUsageDashboardFrame(decoded)).toEqual(changed);
  }));
});

test("property: arbitrary bytes either fail or decode to a frame that re-encodes to exactly those bytes", () => {
  assertProperty(fc.property(fc.uint8Array({ maxLength: 300 }), input => {
    const decoded = decodeUsageDashboardFrame(input);
    if (decoded !== null) expect(encodeUsageDashboardFrame(decoded)).toEqual(input);
  }));
});

test("encoding refuses unknown statuses, empty or oversized parts, reordered parts and unbound accounts", () => {
  const ready = (parts: UsageDashboardFramePart[], accountId = A, sessionRefreshInMs = 0): UsageDashboardFrame => ({ kind: "ready", accountId, sessionRefreshInMs, parts });
  const account = { part: "account" as const, status: 200, bytes: bytes("{}") };
  expect(encodeUsageDashboardFrame(ready([account]))).not.toBeNull();
  for (const refused of [
    ready([{ ...account, status: 503 }]), ready([{ ...account, bytes: new Uint8Array() }]), ready([{ ...account, bytes: new Uint8Array(513) }]),
    ready([{ part: "consent", status: 401, bytes: bytes("{}") }]), ready([{ part: "stats", status: 200, bytes: bytes("{}") }, account]),
    ready([account, account]), ready([]), ready([account], "acct_x"), ready([account], A, -1), ready([account], A, USAGE_DASHBOARD_REFRESH_MAX_MS + 1),
    ready([account], A, 1.5), { kind: "error", error: "teapot" } as never,
  ]) expect(encodeUsageDashboardFrame(refused)).toBeNull();
  expect(USAGE_DASHBOARD_MAX_BYTES).toBeGreaterThan(4 * 1024 * 1024);
});

test("decoding refuses non-canonical headers, trailing bytes and mismatched lengths", () => {
  const header = (text: string, ...parts: Uint8Array[]) => {
    const head = bytes(text), total = new Uint8Array(4 + head.byteLength + parts.reduce((sum, part) => sum + part.byteLength, 0));
    new DataView(total.buffer).setUint32(0, head.byteLength); total.set(head, 4);
    let offset = 4 + head.byteLength; for (const part of parts) { total.set(part, offset); offset += part.byteLength; }
    return total;
  };
  const body = bytes("{}");
  expect(decodeUsageDashboardFrame(header(`{"schemaVersion":1,"accountId":"${A}","sessionRefreshInMs":5,"parts":[["account",200,2]]}`, body))).not.toBeNull();
  for (const refused of [
    header(`{"accountId":"${A}","schemaVersion":1,"sessionRefreshInMs":5,"parts":[["account",200,2]]}`, body),
    header(`{"schemaVersion":1,"accountId":"${A}","sessionRefreshInMs":5,"parts":[["account",200,2]]} `, body),
    header(`{"schemaVersion":1,"accountId":"${A}","sessionRefreshInMs":5,"parts":[["account",200,3]]}`, body),
    header(`{"schemaVersion":1,"accountId":"${A}","sessionRefreshInMs":5,"parts":[["account",200,1]]}`, body),
    header(`{"schemaVersion":1,"accountId":"${A}","sessionRefreshInMs":5,"parts":[["account",200,2]],"extra":1}`, body),
    header(`{"schemaVersion":2,"accountId":"${A}","sessionRefreshInMs":5,"parts":[["account",200,2]]}`, body),
    header(`{"schemaVersion":1,"error":"unavailable"}`, body), header(`{"error":"unavailable","schemaVersion":1}`),
    header(`{"schemaVersion":1,"accountId":"${A}","sessionRefreshInMs":5,"parts":[["account",200,2]]}\n`, body),
  ]) expect(decodeUsageDashboardFrame(refused)).toBeNull();
  expect(decodeUsageDashboardFrame(header(`{"schemaVersion":1,"error":"unavailable"}`))).toEqual({ kind: "error", error: "unavailable" });
  expect(decodeUsageDashboardFrame(new Uint8Array(USAGE_DASHBOARD_MAX_BYTES + 1))).toBeNull();
  expect(decodeUsageDashboardFrame("frame" as never)).toBeNull();
});
