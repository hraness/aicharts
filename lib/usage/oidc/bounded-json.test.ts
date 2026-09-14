import { expect, test } from "bun:test";
import { boundedJson, byteView, decodeBase64Url, encodeBase64Url } from "./bounded-json";
const bytes = (input: string) => new TextEncoder().encode(input);

test("JSON allows issuer whitespace/order and primitive lexemes but rejects malformed syntax", () => {
  expect(boundedJson(bytes(' { "z": [true, false, null, -12.5e2], "a":"\\u0061" }\r\n'))).toEqual({ z: [true, false, null, -1250], a: "a" });
  for (const input of ["", " ", "{}x", "{}{}", "01", "1.", "+1", "1e", "[1,]", "{\"a\":1,}", "{a:1}", '"bad\n"', '"\\x01"', '"unterminated', "undefined", "NaN"]) {
    expect(() => boundedJson(bytes(input))).toThrow();
  }
});
test("duplicate names are rejected after JSON escape decoding at every object depth", () => {
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[{"x":{"a":1,"a":2}}]', '{"__proto__":1,"__proto__":2}']) expect(() => boundedJson(bytes(input))).toThrow();
  const parsed = boundedJson(bytes('{"__proto__":{"x":1}}')) as object;
  expect(Object.getPrototypeOf(parsed)).toBe(null); expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
});
test("strict UTF8 and BOM rejection do not silently replace input", () => {
  for (const input of [new Uint8Array([0xff]), new Uint8Array([0xc0, 0xaf]), new Uint8Array([0xed, 0xa0, 0x80]), bytes("\ufeff{}")]) expect(() => boundedJson(input)).toThrow();
});
test("JSON depth, own-member, total-unit and byte caps have exact boundaries", () => {
  expect(() => boundedJson(bytes("[".repeat(7) + "0" + "]".repeat(7)))).not.toThrow();
  expect(() => boundedJson(bytes("[".repeat(8) + "0" + "]".repeat(8)))).toThrow();
  const record = (n: number) => JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, 0])));
  expect(() => boundedJson(bytes(record(32)))).not.toThrow(); expect(() => boundedJson(bytes(record(33)))).toThrow();
  expect(() => boundedJson(bytes(JSON.stringify(Array(255).fill(0))))).not.toThrow();
  expect(() => boundedJson(bytes(JSON.stringify(Array(256).fill(0))))).toThrow();
  expect(() => boundedJson(bytes("{}" + " ".repeat(16382)))).not.toThrow();
  expect(() => boundedJson(bytes("{}" + " ".repeat(16383)))).toThrow();
});
test("canonical base64url rejects padding aliases and every invalid alphabet", () => {
  for (const input of ["", "=", "Zg=", "Zg==", "Zh", "A", "ab+c", "ab/c", "Zg\n", "Zg ", "é"]) expect(() => decodeBase64Url(input, 512)).toThrow();
  for (let length = 1; length <= 512; length++) {
    const input = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256);
    expect(decodeBase64Url(encodeBase64Url(input), length)).toEqual(input);
    expect(() => decodeBase64Url(encodeBase64Url(input), length - 1)).toThrow();
  }
});
test("intrinsic chunk views refuse unsafe storage without evaluating view overrides", () => {
  const original = new Uint8Array([1, 2, 3, 4]); const input = original.subarray(1, 3);
  Object.defineProperty(input, "buffer", { get() { throw new Error("view getter executed"); } });
  Object.defineProperty(input, "byteLength", { get() { throw new Error("length getter executed"); } });
  expect([...byteView(input)]).toEqual([2, 3]);
  for (const bad of [null, {}, new DataView(new ArrayBuffer(1)), new Int8Array(1), new Proxy(original, {}), new Uint8Array(new SharedArrayBuffer(1)), new Uint8Array(new ArrayBuffer(1, { maxByteLength: 2 }))]) expect(() => byteView(bad)).toThrow();
  const detached = new Uint8Array(2); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  expect(() => byteView(detached)).toThrow();
});
test("seeded bounded JSON corpus preserves meaning and truncation never becomes an object", () => {
  let seed = 0x517aa993;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let i = 0; i < 500; i++) {
    const input = { [`k${next()}`]: [next(), next() % 2 === 0, null, String.fromCodePoint(32 + next() % 90)], nested: { n: next() } };
    const text = JSON.stringify(input);
    expect(boundedJson(bytes(text))).toEqual(input);
    for (let end = 0; end < text.length; end++) expect(() => boundedJson(bytes(text.slice(0, end)))).toThrow();
  }
});
