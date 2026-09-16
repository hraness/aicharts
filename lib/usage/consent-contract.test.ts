import { expect, test } from "bun:test";
import {
  parseLeaderboardConsentApply, parseUsageConsentDecision, parseUsageConsentRequest,
  parseUsageConsentResult,
} from "./consent-contract";
import type { LeaderboardConsentViewV1 } from "./leaderboard-contract";

const account = `acct_${"ab".repeat(16)}`;

test("browser decisions require grant-handle / withdrawal-null coherence", () => {
  expect(parseUsageConsentDecision({ consent: false, publicHandle: null })).toEqual({ consent: false, publicHandle: null });
  expect(parseUsageConsentDecision({ consent: true, publicHandle: "alpha-coder" })).toEqual({ consent: true, publicHandle: "alpha-coder" });
  for (const bad of [
    { consent: false, publicHandle: "x" }, { consent: true, publicHandle: null },
    { consent: true, publicHandle: "Bad" }, { consent: "yes", publicHandle: null },
    { consent: false, publicHandle: null, accountId: account }, null, "x",
  ]) expect(parseUsageConsentDecision(bad)).toBeNull();
});

test("worker requests bind account identity and expiry to each operation shape", () => {
  const status = parseUsageConsentRequest({ schemaVersion: 1, accountId: account,
    sessionExpiresAtMs: 1_800_000_000_000, operation: "status" });
  expect(status).toMatchObject({ operation: "status", accountId: account });
  const set = parseUsageConsentRequest({ schemaVersion: 1, accountId: account,
    sessionExpiresAtMs: 1_800_000_000_000, operation: "set", consent: true, publicHandle: "alpha-coder" });
  expect(set).toMatchObject({ operation: "set", consent: true, publicHandle: "alpha-coder" });
  const withdraw = parseUsageConsentRequest({ schemaVersion: 1, accountId: account,
    sessionExpiresAtMs: 1_800_000_000_000, operation: "set", consent: false, publicHandle: null });
  expect(withdraw).toMatchObject({ operation: "set", consent: false });
  for (const bad of [
    { schemaVersion: 1, accountId: account, sessionExpiresAtMs: 1, operation: "status", extra: 1 },
    { schemaVersion: 1, accountId: "acct_bad", sessionExpiresAtMs: 1, operation: "status" },
    { schemaVersion: 1, accountId: account, sessionExpiresAtMs: -1, operation: "status" },
    { schemaVersion: 1, accountId: account, sessionExpiresAtMs: 1, operation: "delete" },
    { schemaVersion: 1, accountId: account, sessionExpiresAtMs: 1, operation: "set", consent: false, publicHandle: "x" },
    { schemaVersion: 1, accountId: account, sessionExpiresAtMs: 1, operation: "set", consent: true, publicHandle: null },
    { schemaVersion: 2, accountId: account, sessionExpiresAtMs: 1, operation: "status" }, null,
  ]) expect(parseUsageConsentRequest(bad)).toBeNull();
});

test("results admit the fixed consent-domain error set only", () => {
  const view: LeaderboardConsentViewV1 = { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null };
  expect(parseUsageConsentResult({ ok: true, value: view })).toEqual({ ok: true, value: view });
  for (const error of ["invalid_input", "unauthorized", "not_enrolled", "expired", "recovery_required",
    "clock_regressed", "storage_invalid", "storage_unavailable", "limit"] as const) {
    expect(parseUsageConsentResult({ ok: false, error })).toEqual({ ok: false, error });
  }
  for (const bad of [
    { ok: false, error: "authentication_required" }, { ok: false, error: "PRIVATE_CANARY" },
    { ok: true, value: { schemaVersion: 1, consent: false, consentedAtMs: 1, publicHandle: null } },
    { ok: true, value: view, extra: 1 }, { ok: true }, null,
  ]) expect(parseUsageConsentResult(bad)).toBeNull();
});

test("consent applies order replays by decision time and stay internal", () => {
  const grant = parseLeaderboardConsentApply({ schemaVersion: 1, accountId: account, consent: true,
    publicHandle: "alpha-coder", consentedAtMs: 1_800_000_000_000, eventAtMs: 1_800_000_000_000 });
  expect(grant).toMatchObject({ consent: true, publicHandle: "alpha-coder", eventAtMs: 1_800_000_000_000 });
  const withdrawal = parseLeaderboardConsentApply({ schemaVersion: 1, accountId: account, consent: false,
    publicHandle: null, consentedAtMs: null, eventAtMs: 1_800_000_000_000 });
  expect(withdrawal).toMatchObject({ consent: false, eventAtMs: 1_800_000_000_000 });
  for (const bad of [
    { schemaVersion: 1, accountId: account, consent: false, publicHandle: "x", consentedAtMs: null, eventAtMs: 1 },
    { schemaVersion: 1, accountId: account, consent: true, publicHandle: "x", consentedAtMs: null, eventAtMs: 1 },
    { schemaVersion: 1, accountId: account, consent: true, publicHandle: "x", consentedAtMs: 2, eventAtMs: 1 },
    { schemaVersion: 1, accountId: account, consent: true, publicHandle: "x", consentedAtMs: 1, eventAtMs: -1 },
    { schemaVersion: 1, accountId: "acct_zzz", consent: false, publicHandle: null, consentedAtMs: null, eventAtMs: 1 },
    { schemaVersion: 1, accountId: account, consent: false, publicHandle: null, consentedAtMs: null, eventAtMs: 1, sessionSecret: "PRIVATE_CANARY" },
    null,
  ]) expect(parseLeaderboardConsentApply(bad)).toBeNull();
});
