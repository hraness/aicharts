import { expect, test } from "bun:test";
import { decodePairingPublicReply, encodePairingDecision, encodePairingPublicReply, parsePairingFragment,
  parsePairingDecision, parsePairingPublicReply, parsePairingStartForm, type PairingApproval } from "./pairing-public";

const id = "11".repeat(32), token = "22".repeat(32);
const reply: PairingApproval = { schemaVersion: 1, state: "pending", accountId: `acct_${"33".repeat(16)}`, expiresAtMs: 1_800_000_300_000, csrfToken: token };
const canonical = `{"schemaVersion":1,"state":"pending","accountId":"acct_${"33".repeat(16)}","expiresAtMs":1800000300000,"csrfToken":"${token}"}`;
const bytes = (value: string) => new TextEncoder().encode(value);

test("independent literal reply and form bytes round-trip without accepting extra authority", () => {
  expect(encodePairingPublicReply(reply)).toEqual(bytes(canonical));
  expect(decodePairingPublicReply(bytes(canonical), 200)).toEqual(reply);
  expect(parsePairingStartForm(bytes(`intentId=${id}`))).toBe(id);
  expect(parsePairingFragment(`#intentId=${id}`)).toBe(id);
  expect(encodePairingDecision("approve", token)).toBe(`{"decision":"approve","csrfToken":"${token}"}`);
  expect(parsePairingDecision(bytes(`{"decision":"approve","csrfToken":"${token}"}`))).toEqual({ decision: "approve", csrfToken: token });
  expect(parsePairingPublicReply({ ...reply, intentId: id })).toBeNull();
});
test("fragment and form grammar refuse duplicates, aliases, zero IDs and secret fields", () => {
  for (const invalid of ["", id, "0".repeat(64), id.toUpperCase().replace("11", "AA"), `${id}&uploadSecret=PRIVATE_CANARY`, `${id}#tail`, `%31${id.slice(1)}`]) {
    if (invalid === id) continue;
    expect(parsePairingFragment(`#intentId=${invalid}`)).toBeNull();
    expect(parsePairingStartForm(bytes(`intentId=${invalid}`))).toBeNull();
  }
  for (const value of [`intentId=${id}&intentId=${id}`, `intentId=${id}&`, `intentId=${id}\n`, `IntentId=${id}`, ` intentId=${id}`, `intent%49d=${id}`, `\ufeffintentId=${id}`]) {
    expect(parsePairingStartForm(bytes(value))).toBeNull();
  }
  for (const value of [`#${id}`, `#intentId=${id}&intentId=${id}`, `?intentId=${id}`, null, {}, 1]) expect(parsePairingFragment(value)).toBeNull();
});
test("public outcomes are correlated with their fixed HTTP status", () => {
  for (const state of ["pending", "browser-approved", "terminal-confirmed", "denied"] as const) {
    const encoded = encodePairingPublicReply({ ...reply, state })!;
    expect(decodePairingPublicReply(encoded, 200)).toEqual({ ...reply, state });
    expect(decodePairingPublicReply(encoded, 403)).toBeNull();
  }
  for (const code of ["USAGE_PAIRING_AUTH_UNAVAILABLE", "USAGE_PAIRING_AUTH_FAILED", "USAGE_PAIRING_AUTH_REJECTED"] as const) {
    const encoded = encodePairingPublicReply({ error: { code }, schemaVersion: 1 })!;
    expect(new TextDecoder().decode(encoded)).toBe(`{"error":{"code":"${code}"},"schemaVersion":1}`);
    expect(decodePairingPublicReply(encoded, code === "USAGE_PAIRING_AUTH_REJECTED" ? 403 : 503)).not.toBeNull();
    expect(decodePairingPublicReply(encoded, 200)).toBeNull();
  }
  expect(encodePairingPublicReply({ error: { code: "PRIVATE_CANARY" }, schemaVersion: 1 })).toBeNull();
});
test("canonical response decoding rejects collapsed keys, alternate JSON and oversized input", () => {
  for (const invalid of [` ${canonical}`, `${canonical}\n`, `\ufeff${canonical}`, canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    canonical.replace("1800000300000", "1.8000003e12"), canonical.replace('"pending"', '"\\u0070ending"'), canonical.replace('"schemaVersion":1,"state":"pending"', '"state":"pending","schemaVersion":1'),
    "x".repeat(513), "", "{}", "[]"]) expect(decodePairingPublicReply(bytes(invalid), 200)).toBeNull();
});
test("bad account, time, state and CSRF facts cannot become a checked reply", () => {
  for (const change of [{ accountId: "PRIVATE_CANARY" }, { accountId: `${reply.accountId}0` }, { expiresAtMs: 0 }, { expiresAtMs: -0 }, { expiresAtMs: Infinity },
    { expiresAtMs: 8_640_000_000_000_001 }, { expiresAtMs: 1.5 }, { schemaVersion: 2 }, { state: "expired" }, { state: "enrolled" },
    { csrfToken: "0".repeat(64) }, { csrfToken: token.toUpperCase().replace("22", "AA") }, { error: "PRIVATE_CANARY" }]) {
    expect(parsePairingPublicReply({ ...reply, ...change })).toBeNull();
  }
});
test("own data projections never invoke DTO getters or inherited JSON hooks", () => {
  let calls = 0;
  const hooked = { ...reply }; Object.defineProperty(hooked, "accountId", { get() { calls++; throw new Error("PRIVATE_CANARY"); } });
  expect(encodePairingPublicReply(hooked)).toBeNull(); expect(calls).toBe(0);
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  try {
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value() { calls++; throw new Error("PRIVATE_CANARY"); } });
    expect(encodePairingPublicReply(reply)).toEqual(bytes(canonical));
    expect(decodePairingPublicReply(bytes(canonical), 200)).toEqual(reply);
    expect(calls).toBe(0);
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, "toJSON", descriptor); else Reflect.deleteProperty(Object.prototype, "toJSON");
  }
});
test("byte caps use actual backing facts and reject unsupported views", () => {
  const oversized = new Uint8Array(513); Object.defineProperty(oversized, "byteLength", { value: 1 });
  expect(decodePairingPublicReply(oversized, 200)).toBeNull();
  const original = bytes(canonical); Object.defineProperty(original, "byteLength", { get() { throw new Error("PRIVATE_CANARY"); } });
  expect(decodePairingPublicReply(original, 200)).toEqual(reply);
  const shared = new Uint8Array(new SharedArrayBuffer(100));
  expect(decodePairingPublicReply(shared, 200)).toBeNull();
  const proxy = new Proxy(original, {}); expect(decodePairingPublicReply(proxy, 200)).toBeNull();
});
