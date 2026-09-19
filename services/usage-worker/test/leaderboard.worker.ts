import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { encodeAdmissionBatch, encodeAdmissionOperation, decodeAdmissionBatch } from "../../../lib/usage/admission";
import { LEADERBOARD_INDEX_NAME, LEADERBOARD_MAX_MEMBERS,
  type LeaderboardSnapshotV1 } from "../../../lib/usage/leaderboard-contract";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { LEADERBOARD_REFRESH_MS, LEADERBOARD_RECHECK_MS, LEADERBOARD_RETRY_MS } from "../src/leaderboard-index";

// Storage alarms use the runtime clock even when JavaScript Date is mocked.
// Keep fixture timestamps in its future so setAlarm does not clamp them to now.
const NOW = Math.ceil(Date.now() / DAY_MS) * DAY_MS + DAY_MS / 2, DAY = Math.floor(NOW / DAY_MS);
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
const alarm = () => runInDurableObject(index(), async (instance, state) => {
  await state.storage.deleteAlarm();
  await instance.alarm();
  return state.storage.getAlarm();
});
const indexState = () => runInDurableObject(index(), async (_instance, state) => ({
  rows: state.storage.sql.exec("SELECT * FROM leaderboard_index").toArray(),
  alarm: await state.storage.getAlarm(),
}));

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
  // The consent mutation verifies the member before the read-only snapshot.
  const first = success(await index().read({ schemaVersion: 1 }));
  expect(first.entries).toHaveLength(1);
  expect(first.entries[0]).toMatchObject({ rank: 1, publicHandle: "alpha-coder",
    observedTokens: "0", usageRecords: 0, consentedAtMs: NOW, refreshedAtMs: NOW });
  // Admit usage; the next bounded refresh picks up the imported totals.
  await admit(device);
  vi.setSystemTime(NOW + 21_600_001);
  await alarm();
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
  await enroll();
  await runInDurableObject(index(), (_instance, state) => {
    const members = Array.from({ length: LEADERBOARD_MAX_MEMBERS }, (_, member) => ({
      accountId: `acct_${hex(2000 + member, 16)}`, publicHandle: `member-${member.toString(16)}`,
      consentedAtMs: NOW, eventAtMs: NOW, refreshedAtMs: 0, projection: null,
    }));
    state.storage.sql.exec("UPDATE leaderboard_index SET revision = 1, payload = ? WHERE id = 1",
      JSON.stringify({ schemaVersion: 1, members, tombstones: [] }));
  });
  expect(await index().applyConsent({ schemaVersion: 1, accountId: `acct_${hex(9999, 16)}`,
    consent: true, publicHandle: "overflow-member", consentedAtMs: NOW, eventAtMs: NOW }))
    .toEqual({ ok: false, error: "limit" });
  expect(await stub().setLeaderboardConsent(grant("overflow-member"))).toEqual({ ok: false, error: "publishing_full" });
  expect(success(await stub().readLeaderboardConsent(status())).consent).toBe(false);
  await runInDurableObject(stub(), async (instance, state) => {
    await state.storage.deleteAlarm();
    await instance.alarm();
    expect(await state.storage.getAlarm()).toBeNull();
  });
});

test("reads never write or refresh accounts; scheduled verification remains armed without a backlog", async () => {
  const device = await enroll();
  success(await stub().setLeaderboardConsent(grant("alpha-coder")));
  await admit(device);
  vi.setSystemTime(NOW + LEADERBOARD_REFRESH_MS + 1);
  const before = await indexState();
  // A failed or delayed alarm must not leave indefinitely published consent.
  expect(success(await index().read({ schemaVersion: 1 })).entries).toEqual([]);
  expect(await indexState()).toEqual(before);
  expect(await alarm()).toBe(NOW + LEADERBOARD_REFRESH_MS + LEADERBOARD_RECHECK_MS + 1);
  expect(success(await index().read({ schemaVersion: 1 })).entries[0]).toMatchObject({ observedTokens: "15" });
  vi.setSystemTime(NOW + 2 * LEADERBOARD_REFRESH_MS + 1);
  expect(await alarm()).toBe(NOW + 2 * LEADERBOARD_REFRESH_MS + LEADERBOARD_RECHECK_MS + 1);
});

test("distinct consent decisions cannot silently collide in the same millisecond", async () => {
  await enroll();
  success(await stub().setLeaderboardConsent(grant("alpha-coder")));
  expect(await stub().setLeaderboardConsent(withdraw())).toEqual({ ok: false, error: "clock_regressed" });
  success(await stub().setLeaderboardConsent(grant("alpha-coder")));
  vi.setSystemTime(NOW + 1);
  success(await stub().setLeaderboardConsent(withdraw()));
  expect(success(await index().read({ schemaVersion: 1 })).entries).toEqual([]);
});

test("quarantined usage cannot hide a withdrawal after a failed index apply", async () => {
  await enroll();
  success(await stub().setLeaderboardConsent(grant("alpha-coder")));
  vi.setSystemTime(NOW + 1);
  await runInDurableObject(stub(), async (instance, state) => {
    const object = instance as unknown as { env: Env }, original = object.env;
    object.env = { ...original, PUBLIC_INDEX: { getByName() { throw new Error("synthetic_unavailable"); } } as unknown as Env["PUBLIC_INDEX"] };
    try {
      expect(await instance.setLeaderboardConsent(withdraw())).toEqual({ ok: false, error: "storage_unavailable" });
      state.storage.sql.exec("UPDATE usage_admission_control SET quarantined = 1 WHERE id = 1");
    } finally { object.env = original; }
  });
  expect(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))
    .toEqual({ ok: true, value: { schemaVersion: 1, accountId: account, consent: false } });
  vi.setSystemTime(NOW + LEADERBOARD_REFRESH_MS + 1);
  await alarm();
  expect(success(await index().read({ schemaVersion: 1 })).entries).toEqual([]);
});

test("bounded alarm batches drain promptly and unavailable sources cannot starve later members", async () => {
  await runInDurableObject(index(), async (instance, state) => {
    const members = Array.from({ length: 16 }, (_, member) => ({
      accountId: `acct_${hex(2000 + member, 16)}`, publicHandle: `member-${member.toString(16)}`,
      consentedAtMs: NOW, eventAtMs: NOW, refreshedAtMs: 0, projection: null,
    }));
    state.storage.sql.exec("UPDATE leaderboard_index SET revision = 1, payload = ? WHERE id = 1",
      JSON.stringify({ schemaVersion: 1, members, tombstones: [] }));
    const object = instance as unknown as { env: Env }, original = object.env;
    const visited: string[] = [];
    object.env = { ...original, ACCOUNT_ENROLLMENTS: { getByName() { return {
      async readLeaderboardProjection(input: { accountId: string }) {
        visited.push(input.accountId);
        throw new Error("synthetic_unavailable");
      },
    }; } } as unknown as Env["ACCOUNT_ENROLLMENTS"] };
    try {
      await instance.alarm();
      expect(visited).toHaveLength(8);
      expect(await state.storage.getAlarm()).toBe(NOW + LEADERBOARD_RETRY_MS);
      vi.setSystemTime(NOW + LEADERBOARD_RETRY_MS);
      await state.storage.deleteAlarm();
      await instance.alarm();
      expect(visited).toHaveLength(16);
      expect(new Set(visited).size).toBe(16);
      expect(await state.storage.getAlarm()).toBe(NOW + 2 * LEADERBOARD_RETRY_MS);
      const stored = JSON.parse(state.storage.sql.exec("SELECT payload FROM leaderboard_index WHERE id = 1").one().payload as string) as { members: Record<string, unknown>[] };
      // The previous deployment's validator requires exactly these keys.
      // Fair retry scheduling must preserve its ability to read every member.
      for (const member of stored.members) expect(Object.keys(member).sort()).toEqual([
        "accountId", "consentedAtMs", "eventAtMs", "projection", "publicHandle", "refreshedAtMs",
      ]);
    } finally { object.env = original; }
  });
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

test("concurrent handle claims preserve one publisher and restore the rejected account to unpublished", async () => {
  const first = account;
  await enroll(first);
  const second = `acct_${hex(++serial, 16)}`;
  await enroll(second);
  const results = await Promise.all([first, second].map(id => stub(id).setLeaderboardConsent(grant("shared-handle", id))));
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(results.filter(result => !result.ok)).toEqual([{ ok: false, error: "handle_unavailable" }]);
  for (const [position, id] of [first, second].entries()) {
    expect(success(await stub(id).readLeaderboardConsent(status(id))).consent).toBe(results[position].ok);
  }
  expect(success(await index().read({ schemaVersion: 1 })).entries.map(entry => entry.publicHandle)).toEqual(["shared-handle"]);
});

test("an occupied rename restores the existing handle without displacing either publisher", async () => {
  const first = account;
  await enroll(first);
  const second = `acct_${hex(++serial, 16)}`;
  await enroll(second);
  success(await stub(first).setLeaderboardConsent(grant("first-handle", first)));
  success(await stub(second).setLeaderboardConsent(grant("second-handle", second)));
  vi.setSystemTime(NOW + 1);
  expect(await stub(second).setLeaderboardConsent(grant("first-handle", second)))
    .toEqual({ ok: false, error: "handle_unavailable" });
  expect(success(await stub(second).readLeaderboardConsent(status(second))))
    .toMatchObject({ consent: true, publicHandle: "second-handle", consentedAtMs: NOW });
  expect(success(await index().read({ schemaVersion: 1 })).entries.map(entry => entry.publicHandle))
    .toEqual(["first-handle", "second-handle"]);
});

test("a delayed conflicting publish cannot restore consent after a newer withdrawal", async () => {
  const first = account;
  await enroll(first);
  const second = `acct_${hex(++serial, 16)}`;
  await enroll(second);
  success(await stub(first).setLeaderboardConsent(grant("first-handle", first)));
  success(await stub(second).setLeaderboardConsent(grant("second-handle", second)));
  vi.setSystemTime(NOW + 1);
  await runInDurableObject(stub(second), async instance => {
    const object = instance as unknown as { env: Env }, original = object.env;
    let resume!: () => void, reached!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const blocked = new Promise<void>(resolve => { reached = resolve; });
    object.env = { ...original, PUBLIC_INDEX: { getByName(name: string) { return {
      async applyConsent(input: { consent: boolean; publicHandle: string | null }) {
        const reply = await original.PUBLIC_INDEX.getByName(name).applyConsent(input);
        if (input.consent && input.publicHandle === "first-handle") { reached(); await paused; }
        return reply;
      },
    }; } } as unknown as Env["PUBLIC_INDEX"] };
    try {
      const pending = instance.setLeaderboardConsent(grant("first-handle", second));
      await blocked;
      vi.setSystemTime(NOW + 2);
      success(await instance.setLeaderboardConsent(withdraw(second)));
      resume();
      expect(await pending).toEqual({ ok: false, error: "handle_unavailable" });
    } finally { resume(); object.env = original; }
  });
  expect(success(await stub(second).readLeaderboardConsent(status(second))).consent).toBe(false);
  expect(success(await index().read({ schemaVersion: 1 })).entries.map(entry => entry.publicHandle)).toEqual(["first-handle"]);
});

test("an initial publish outage is retried durably without a read repairing it", async () => {
  await enroll();
  await runInDurableObject(stub(), async (instance, state) => {
    const object = instance as unknown as { env: Env }, original = object.env;
    object.env = { ...original, PUBLIC_INDEX: { getByName() { throw new Error("synthetic_unavailable"); } } as unknown as Env["PUBLIC_INDEX"] };
    try {
      expect(await instance.setLeaderboardConsent(grant("alpha-coder")))
        .toEqual({ ok: false, error: "storage_unavailable" });
      expect(await state.storage.getAlarm()).toBe(NOW + 60_000);
    } finally { object.env = original; }
  });
  expect(success(await index().read({ schemaVersion: 1 })).entries).toEqual([]);
  expect(success(await stub().readLeaderboardConsent(status())).consent).toBe(true);
  await runInDurableObject(stub(), async (instance, state) => {
    vi.setSystemTime(NOW + 60_000);
    await state.storage.deleteAlarm();
    await instance.alarm();
    expect(await state.storage.getAlarm()).toBeNull();
  });
  expect(success(await index().read({ schemaVersion: 1 })).entries.map(entry => entry.publicHandle)).toEqual(["alpha-coder"]);
});

test.each([false, true])("lost grant delivery preserves the handle owner and a later withdrawal (%s)", async (laterWithdrawal) => {
  const first = account;
  await enroll(first);
  success(await stub(first).setLeaderboardConsent(grant("occupied-handle", first)));
  const second = `acct_${hex(++serial, 16)}`;
  await enroll(second);
  await runInDurableObject(stub(second), async (instance, state) => {
    const object = instance as unknown as { env: Env }, original = object.env;
    object.env = { ...original, PUBLIC_INDEX: { getByName() { throw new Error("synthetic_unavailable"); } } as unknown as Env["PUBLIC_INDEX"] };
    try {
      expect(await instance.setLeaderboardConsent(grant("occupied-handle", second)))
        .toEqual({ ok: false, error: "storage_unavailable" });
      if (laterWithdrawal) {
        vi.setSystemTime(NOW + 1);
        expect(await instance.setLeaderboardConsent(withdraw(second))).toEqual({ ok: false, error: "storage_unavailable" });
      }
    } finally { object.env = original; }
    vi.setSystemTime(NOW + 60_001);
    await state.storage.deleteAlarm();
    await instance.alarm();
  });
  expect(success(await stub(second).readLeaderboardConsent(status(second))).consent).toBe(false);
  expect(success(await index().read({ schemaVersion: 1 })).entries.map(entry => entry.publicHandle)).toEqual(["occupied-handle"]);
});

test.each(["{", "{}"])("invalid authoritative storage requires recovery instead of repeated delivery (%s)", async payload => {
  await enroll();
  success(await stub().setLeaderboardConsent(grant("alpha-coder")));
  await runInDurableObject(stub(), async (instance, state) => {
    state.storage.sql.exec("UPDATE account_enrollment SET payload = ? WHERE id = 1", payload);
    await state.storage.deleteAlarm();
    await instance.alarm();
    expect(await state.storage.getAlarm()).toBeNull();
    expect(state.storage.sql.exec("SELECT payload FROM account_enrollment WHERE id = 1").one().payload).toBe(payload);
  });
});
