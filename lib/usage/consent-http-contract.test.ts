import { expect, test } from "bun:test";
import {
  decodeUsageConsentHttpRequest, decodeUsageConsentHttpResponse,
  encodeUsageConsentHttpRequest, encodeUsageConsentHttpResponse,
  USAGE_CONSENT_HTTP_REQUEST_BYTES, USAGE_CONSENT_HTTP_RESPONSE_BYTES,
} from "./consent-http-contract";
import type { UsageConsentRequestV1, UsageConsentResult } from "./consent-contract";
import type { LeaderboardConsentViewV1 } from "./leaderboard-contract";

const account = `acct_${"ab".repeat(16)}`;
const status: UsageConsentRequestV1 = { schemaVersion: 1, accountId: account, sessionExpiresAtMs: 1_800_000_000_000, operation: "status" };
const set: UsageConsentRequestV1 = { schemaVersion: 1, accountId: account, sessionExpiresAtMs: 1_800_000_000_000,
  operation: "set", consent: true, publicHandle: "alpha-coder" };
const view: LeaderboardConsentViewV1 = { schemaVersion: 1, consent: true, consentedAtMs: 1_800_000_000_000, publicHandle: "alpha-coder" };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("requests round-trip canonically with exact keys and bounded size", () => {
  for (const input of [status, set, { ...set, consent: false, publicHandle: null }]) {
    const encoded = encodeUsageConsentHttpRequest(input);
    expect(encoded).not.toBeNull(); expect(encoded!.byteLength).toBeLessThanOrEqual(USAGE_CONSENT_HTTP_REQUEST_BYTES);
    expect(text(encoded!)).toBe(JSON.stringify(input));
    expect(decodeUsageConsentHttpRequest(encoded!)).toEqual(input);
  }
  for (const bad of [
    { ...status, extra: 1 }, { ...status, accountId: "acct_bad" }, { ...status, sessionExpiresAtMs: -1 },
    { ...set, publicHandle: "Bad" }, { ...set, consent: false }, { ...status, operation: "delete" }, null, "x",
    { schemaVersion: 1, accountId: account, sessionExpiresAtMs: 1, operation: "status", trailing: undefined },
  ]) {
    expect(encodeUsageConsentHttpRequest(bad)).toBeNull();
  }
  for (const bad of [
    new Uint8Array(), new Uint8Array(USAGE_CONSENT_HTTP_REQUEST_BYTES + 1), new Uint8Array([0x80, 0x80]),
    new TextEncoder().encode("{}"), new TextEncoder().encode('{"schemaVersion":1}'),
    new TextEncoder().encode(JSON.stringify({ ...status, unexpected: 1 })),
    new TextEncoder().encode(` ${JSON.stringify(status)}`),
    new TextEncoder().encode(JSON.stringify(status).slice(0, -1) + "} "),
  ]) expect(decodeUsageConsentHttpRequest(bad)).toBeNull();
  expect(decodeUsageConsentHttpRequest("not-bytes")).toBeNull();
  expect(decodeUsageConsentHttpRequest(new Uint8Array(new ArrayBuffer(4)))).toBeNull();
});

test("responses round-trip results inside the pinned envelope", () => {
  for (const result of [{ ok: true, value: view }, { ok: false, error: "not_enrolled" }, { ok: false, error: "expired" }] as UsageConsentResult[]) {
    const encoded = encodeUsageConsentHttpResponse(result);
    expect(encoded).not.toBeNull(); expect(encoded!.byteLength).toBeLessThanOrEqual(USAGE_CONSENT_HTTP_RESPONSE_BYTES);
    expect(text(encoded!)).toBe(JSON.stringify({ schemaVersion: 1, result }));
    expect(decodeUsageConsentHttpResponse(encoded!)).toEqual(result);
  }
  for (const bad of [
    { ok: false, error: "authentication_required" }, { ok: true, value: { ...view, accountId: account } },
    { ok: false, error: "PRIVATE_CANARY" }, null,
  ]) expect(encodeUsageConsentHttpResponse(bad)).toBeNull();
  for (const bad of [
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, result: { ok: false, error: "authentication_required" } })),
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, result: { ok: true, value: view }, extra: 1 })),
    new TextEncoder().encode(JSON.stringify({ result: { ok: false, error: "expired" }, schemaVersion: 1 })),
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 2, result: { ok: false, error: "expired" } })),
    new Uint8Array([0xff]), "x", null,
  ]) expect(decodeUsageConsentHttpResponse(bad)).toBeNull();
});
