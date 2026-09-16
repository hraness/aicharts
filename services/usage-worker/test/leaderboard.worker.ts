import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { encodeAdmissionBatch, encodeAdmissionOperation, decodeAdmissionBatch } from "../../../lib/usage/admission";
import { LEADERBOARD_INDEX_NAME, LEADERBOARD_MAX_MEMBERS,
  type LeaderboardSnapshotV1 } from "../../../lib/usage/leaderboard-contract";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";

const NOW = Date.UTC(2026, 8, 11, 12), DAY = Math.floor(NOW / DAY_MS);
let serial = 0, account = "";
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const index = () => env.PUBLIC_INDEX.getByName(LEADERBOARD_INDEX_NAME);
const stub = (id = account) => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(id));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`synthetic fixture: ${result.error}`);
  return result.value;
};
beforeEach(() => {
  account = `acct_${hex(++serial, 16)}`;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(object => object.key);
    if (keys.length) await bucket.delete(keys);
  }
  await reset();
});

type Device = { proof: EnrollmentProof; deviceId: Uint8Array };
async function enroll(id = account): Promise<Device> {
  const proof = { intentId: hex(serial * 10 + 1), pollSecret: hex(serial * 10 + 2), uploadSecret: hex(serial * 10 + 3) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), nonce = hex(serial * 10 + 4);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: nonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: nonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: id, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: id, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: id }));
  success(await pairing.reserveEnrollment(proof));
  const enrolled = success(await stub(id).enroll(proof));
  return { proof, deviceId: admissionIdBytes(enrolled.receipt.deviceId) };
}
const session = (id = account, sessionExpiresAtMs = NOW + PAIRING_TTL_MS) =>
  ({ schemaVersion: 1 as const, accountId: id, sessionExpiresAtMs });
const grant = (handle: string, id = account, sessionExpiresAtMs?: number) =>
  ({ ...session(id, sessionExpiresAtMs), operation: "set" as const, consent: true, publicHandle: handle });
const withdraw = (id = account, sessionExpiresAtMs?: number) =>
  ({ ...session(id, sessionExpiresAtMs), operation: "set" as const, consent: false, publicHandle: null });
const status = (id = account, sessionExpiresAtMs?: number) => ({ ...session(id, sessionExpiresAtMs), operation: "status" as const });

async function admit(device: Device, tokens = 10n) {
  const occurrenceId = admissionIdBytes(hex(1, 16));
  const frame = success(encodeUsageBatch({ utcDay: DAY, registryRevision: 1,
    usage: [{ id: occurrenceId, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1,
      provider: 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
      tokens: { inputUncached: tokens, cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, output: 5n, reasoningOutput: 0n } }],
    prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
  const operation = success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)),
    deviceId: device.deviceId, generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: 1, sequence: 1,
    occurrenceId, expectedHeadHash: new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  const batch = success(decodeAdmissionBatch(success(encodeAdmissionBatch([operation], ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
  const uploaded = await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: batch.bytes });
  expect(uploaded).toMatchObject({ ok: true });
}

test("consent starts unpublished, grants durably, ranks imported totals, and withdrawal removes", async () => {
  const device = await enroll();
  // Status before any decision: the account is enrolled but unpublished.
  expect(await stub().readLeaderboardConsent(status())).toEqual({ ok: true,
    value: { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null } });
  // The index serves an honest empty snapshot before any consent.
  const empty = success(await index().read({ schemaVersion: 1 }));
  expect(empty).toMatchObject({ schemaVersion: 1, ranking: "observed-tokens-30d-v1", entries: [] });
  // Grant consent; the committed decision publishes to the materialized index.
  expect(await stub().setLeaderboardConsent(grant("alpha-coder"))).toEqual({ ok: true,
    value: { schemaVersion: 1, consent: true, consentedAtMs: NOW, publicHandle: "alpha-coder" } });
  // The first materialized read re-verifies the member at the account object.
  const first = success(await index().read({ schemaVersion: 1 }));
  expect(first.entries).toHaveLength(1);
  expect(first.entries[0]).toMatchObject({ rank: 1, publicHandle: "alpha-coder",
    observedTokens: "0", usageRecords: 0, consentedAtMs: NOW, refreshedAtMs: NOW });
  // Admit usage; the next bounded refresh picks up the imported totals.
  await admit(device);
  vi.setSystemTime(NOW + 21_600_001);
  const second = success(await index().read({ schemaVersion: 1 }));
  expect(second.entries[0]).toMatchObject({ rank: 1, publicHandle: "alpha-coder",
    observedTokens: "15", usageRecords: 1 });
  // Withdraw; the durable removal propagates to the index and the entry drops.
  const later = NOW + 21_600_001 + PAIRING_TTL_MS;
  expect(await stub().setLeaderboardConsent(withdraw(account, later))).toEqual({ ok: true,
    value: { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null } });
  const gone = success(await index().read({ schemaVersion: 1 }));
  expect(gone.entries).toEqual([]);
  // Status confirms the durable withdrawal, and the projection declines consent.
  expect(await stub().readLeaderboardConsent(status(account, later))).toEqual({ ok: true,
    value: { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null } });
  expect(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))
    .toEqual({ ok: true, value: { schemaVersion: 1, accountId: account, consent: false } });
});

test("index applies order replays; a tombstone blocks republish until a newer decision", async () => {
  await enroll();
  success(await stub().setLeaderboardConsent(grant("alpha-coder")));
  // A stale replay of the same decision is a no-op at the index.
  success(await index().applyConsent({ schemaVersion: 1, accountId: account, consent: true,
    publicHandle: "imposter-handle", consentedAtMs: NOW, eventAtMs: NOW }));
  // A delayed duplicate withdrawal tombstones the member at a newer event time.
  success(await index().applyConsent({ schemaVersion: 1, accountId: account, consent: false,
    publicHandle: null, consentedAtMs: null, eventAtMs: NOW + 1 }));
  const gone = success(await index().read({ schemaVersion: 1 }));
  expect(gone.entries).toEqual([]);
  // Republishing the older committed grant cannot resurrect the member.
  success(await index().applyConsent({ schemaVersion: 1, accountId: account, consent: true,
    publicHandle: "alpha-coder", consentedAtMs: NOW, eventAtMs: NOW }));
  // A newer decision heals: the account's next committed consent republishes.
  vi.setSystemTime(NOW + 2);
  success(await stub().setLeaderboardConsent(grant("beta-agent")));
  const healed = success(await index().read({ schemaVersion: 1 }));
  expect(healed.entries.map(entry => entry.publicHandle)).toEqual(["beta-agent"]);
});

test("malformed applies and reads are refused without state change", async () => {
  for (const bad of [
    null, { schemaVersion: 2 }, { schemaVersion: 1, accountId: "acct_bad" },
    { schemaVersion: 1, accountId: account, consent: false, publicHandle: "x", consentedAtMs: null, eventAtMs: 1 },
    { schemaVersion: 1, accountId: account, consent: true, publicHandle: "Bad", consentedAtMs: 1, eventAtMs: 1 },
  ]) {
    expect(await index().applyConsent(bad)).toEqual({ ok: false, error: "invalid_input" });
  }
  for (const bad of [null, { schemaVersion: 2 }, { schemaVersion: 1, extra: 1 }]) {
    expect(await index().read(bad)).toEqual({ ok: false, error: "invalid_input" });
  }
});

test("the members bound refuses the 129th publisher", async () => {
  for (let member = 0; member < LEADERBOARD_MAX_MEMBERS; member++) {
    const id = `acct_${hex(2000 + member, 16)}`;
    success(await index().applyConsent({ schemaVersion: 1, accountId: id, consent: true,
      publicHandle: `member-${member.toString(16)}`, consentedAtMs: NOW, eventAtMs: NOW }));
  }
  expect(await index().applyConsent({ schemaVersion: 1, accountId: `acct_${hex(9999, 16)}`,
    consent: true, publicHandle: "overflow-member", consentedAtMs: NOW, eventAtMs: NOW }))
    .toEqual({ ok: false, error: "limit" });
});

test("the public snapshot never contains account or device identifiers", async () => {
  await enroll();
  success(await stub().setLeaderboardConsent(grant("alpha-coder")));
  const board: LeaderboardSnapshotV1 = success(await index().read({ schemaVersion: 1 }));
  const serialized = JSON.stringify(board);
  for (const marker of [account, "acct_", "device", "email", "session", "cookie"]) {
    expect(serialized.includes(marker)).toBe(false);
  }
});
