import { AccountEnrollment } from "../src/enrollment";
import { MAX_STATS_IMMUTABLE_BYTES, StatsState, statsHash, statsUploadText } from "../src/stats-state";
import { parseStatsUpload, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import registry from "../../../data/usage-registry.json";
import { statsRowKey, parseUsageStatsReport } from "../../../lib/usage/stats-contract";
import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { decodeAdmissionBatch, encodeAdmissionBatch, encodeAdmissionOperation, type AdmissionBatch } from "../../../lib/usage/admission";
import { parsePrivateDaysValue, type PrivateDaysRequestV1 } from "../../../lib/usage/private-days-contract";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";

const NOW = Math.ceil(Date.now() / DAY_MS) * DAY_MS + DAY_MS / 2, DAY = Math.floor(NOW / DAY_MS);
let serial = 0, account = "", intent = 0;
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`synthetic fixture: ${result.error}`);
  return result.value;
};
const query = (fields: Partial<PrivateDaysRequestV1> = {}): PrivateDaysRequestV1 => ({ schemaVersion: 1, accountId: account,
  sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY - 1, dayCount: 3, ...fields });

beforeEach(() => {
  account = `acct_${hex(++serial, 16)}`; intent = serial * 100;
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
type Device = { proof: EnrollmentProof; id: Uint8Array };
async function prepare(): Promise<EnrollmentProof> {
  const proof = { intentId: hex(++intent), pollSecret: hex(intent + 1_000_000), uploadSecret: hex(intent + 2_000_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), nonce = hex(intent + 3_000_000);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: nonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: nonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof)); return proof;
}
async function enroll(): Promise<Device> {
  const proof = await prepare();
  return { proof, id: admissionIdBytes(success(await stub().enroll(proof)).receipt.deviceId) };
}
type Member = { id: number; expected?: Uint8Array; provider?: 1 | 2 | 3; output?: bigint; input?: bigint; cache?: bigint;
  write5m?: bigint; write1h?: bigint; reasoning?: bigint; tombstone?: boolean; day?: number };
function batch(device: Device, sequence = 1, members: Member[] = [{ id: 1 }]): AdmissionBatch {
  const operations = members.map((member, index) => {
    const id = admissionIdBytes(hex(member.id, 16));
    const frame = member.tombstone ? new Uint8Array() : success(encodeUsageBatch({ utcDay: member.day ?? DAY, registryRevision: 1,
      usage: [{ id, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1,
        provider: member.provider ?? 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
        tokens: { inputUncached: member.input ?? 10n, cacheRead: member.cache ?? 0n, cacheWrite5m: member.write5m ?? 0n,
          cacheWrite1h: member.write1h ?? 0n, output: member.output ?? 5n, reasoningOutput: member.reasoning ?? 0n } }],
      prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
    return success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: device.id,
      generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: member.tombstone ? 2 : 1,
      sequence: sequence + index, occurrenceId: id, expectedHeadHash: member.expected ?? new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  });
  return success(decodeAdmissionBatch(success(encodeAdmissionBatch(operations, ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
}
const upload = (device: Device, value: AdmissionBatch) => stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes });
async function read(input = query()) {
  const result = success(await stub().readImportedDays(input));
  expect(parsePrivateDaysValue(input, result)).toEqual(result); return result;
}
function replaceEnvironment(instance: unknown, change: (original: Env) => Env): () => void {
  const object = instance as { env: Env }, original = object.env;
  object.env = change(original); return () => { object.env = original; };
}
function bucketProxy(bucket: R2Bucket, intercept: (method: "get" | "put", args: unknown[], invoke: () => Promise<unknown>) => Promise<unknown>): R2Bucket {
  return new Proxy(bucket, { get(target, property) {
    const original: unknown = Reflect.get(target, property, target);
    if ((property === "get" || property === "put") && typeof original === "function") return (...args: unknown[]) => intercept(property, args, () => Reflect.apply(original, target, args) as Promise<unknown>);
    return typeof original === "function" ? original.bind(target) : original;
  } });
}

async function activate() {
  await runInDurableObject(stub(), (instance, state) => {
    const owner = instance as unknown as { env: Env }, updated = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1" };
    new AccountEnrollment(state, updated);
    owner.env = updated;
  });
}
function statsRequest(device: Device, fields: Partial<StatsUpload> = {}): StatsUpload {
  const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
    firstUtcDay: DAY, dayCount: 1, generatedAtMs: NOW, revision: 0, updatedAtMs: null,
    sources: [{ client: "codex", status: "observed", tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: NOW - 1 }],
    rows: [{ utcDay: DAY, client: "codex", provider: null, model: null, tokens: { input: "10", cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "1" },
      records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" }] });
  if (!report) throw new Error("fixture_report");
  const parsed = parseStatsUpload({ schemaVersion: 2, operationId: hex(10000 + serial), accountId: account,
    deviceId: [...device.id].map(value => value.toString(16).padStart(2, "0")).join(""), generation: env.USAGE_ENROLLMENT_GENERATION,
    sequence: 1, expectedRevision: 0, mode: "replace-window", takeover: null, report, ...fields });
  if (!parsed) throw new Error("fixture_upload"); return parsed;
}
const statsUpload = (device: Device, request: StatsUpload) => stub().admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request });
const abandonRequest = (request: StatsUpload) => ({ schemaVersion: 2, accountId: request.accountId, deviceId: request.deviceId,
  generation: request.generation, operationId: request.operationId, sequence: request.sequence, expectedRevision: request.expectedRevision,
  bodyHash: statsHash(statsUploadText(request)) });
const abandon = (device: Device, request: StatsUpload) => stub().abandonStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: abandonRequest(request) });
const statsQuery = () => ({ schemaVersion: 2, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY - 1, dayCount: 2 });
async function statsStatus(device: Device, request = statsRequest(device)) {
  return success(await stub().readStatsStatus({ uploadSecret: device.proof.uploadSecret, request: {
    schemaVersion: 2, accountId: account, deviceId: request.deviceId, generation: env.USAGE_ENROLLMENT_GENERATION,
    client: request.report.sources[0].client, firstUtcDay: request.report.firstUtcDay, dayCount: request.report.dayCount,
  } }));
}

describe("v2 account snapshots", () => {
  test("explicit abandonment fences an unreserved request idempotently and reports an already committed result", async () => {
    const device = await enroll(); await activate(); const first = statsRequest(device);
    success(await stub().setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: true, publicHandle: "abandon-test" }));
    const publicBefore = success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }));
    const proof = success(await abandon(device, first)); expect(proof).toMatchObject({ outcome: "abandoned", fencedAtRevision: 1 });
    expect(success(await abandon(device, first))).toEqual(proof);
    expect(await statsUpload(device, first)).toEqual({ ok: false, error: "conflict" });
    expect(await statsStatus(device)).toMatchObject({ revision: 1, nextSequence: 1, writerDeviceId: null });
    expect(await stub().readUsageStats(statsQuery())).toEqual({ ok: false, error: "not_started" });
    expect(success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))).toEqual(publicBefore);
    expect(await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).hasCommittedSnapshot())).toBe(false);
    expect((await env.STAGING.list({ prefix: "usage-stats/v2/" })).objects).toHaveLength(0);
    const retry = statsRequest(device, { expectedRevision: 1, operationId: hex(90101) });
    const receipt = success(await statsUpload(device, retry));
    expect(success(await abandon(device, retry))).toEqual({ schemaVersion: 2, outcome: "committed", receipt });
    expect(await abandon(device, first)).toEqual({ ok: false, error: "conflict" });
    expect(success(await stub().readUsageStats(statsQuery())).rows[0].tokens.input).toBe("10");
  });
  test("maintenance-only revisions retain legacy fallback while an empty committed snapshot starts v2", async () => {
    const device = await enroll(); success(await upload(device, batch(device))); await activate();
    success(await stub().setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: true, publicHandle: "legacy-fence" }));
    const before = await read(), publicBefore = success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }));
    expect(publicBefore).toMatchObject({ observedTokens: "15", usageRecords: 1 });
    success(await abandon(device, statsRequest(device)));
    expect(await stub().readUsageStats(statsQuery())).toEqual({ ok: false, error: "not_started" });
    expect(await read()).toEqual(before);
    expect(success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))).toEqual(publicBefore);
    const base = statsRequest(device);
    const empty = statsRequest(device, { expectedRevision: 1, mode: "preserve-history", operationId: hex(90909), report: {
      ...base.report, sources: [{ ...base.report.sources[0], client: "cursor", status: "empty", records: 0, latestAtMs: null }], rows: [],
    } });
    success(await statsUpload(device, empty));
    expect(await runInDurableObject(stub(), (_instance, state) => ({
      started: new StatsState(state.storage.sql).hasCommittedSnapshot(),
      days: state.storage.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_days").toArray()[0].count,
    }))).toEqual({ started: true, days: 0 });
    expect(success(await stub().readUsageStats(statsQuery()))).toMatchObject({ revision: 2, rows: [{ client: "codex", records: 1 }] });
    expect(success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))).toEqual(publicBefore);
  });
  test("abandonment during a delayed immutable write preserves its evidence and fences late publication", async () => {
    const device = await enroll(); await activate(); const request = statsRequest(device);
    await runInDurableObject(stub(), async (instance, state) => {
      let abandoned = false;
      const restore = replaceEnvironment(instance, current => ({ ...current, STAGING: bucketProxy(current.STAGING, async (method, _args, invoke) => {
        const result = await invoke();
        if (!abandoned && method === "put") {
          abandoned = true;
          const before = new StatsState(state.storage.sql).control().immutableBytes;
          expect(success(await instance.abandonStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: abandonRequest(request) }))).toMatchObject({ outcome: "abandoned", fencedAtRevision: 1 });
          expect(new StatsState(state.storage.sql).control().immutableBytes).toBe(before);
          expect(new StatsState(state.storage.sql).pending()).toBeNull();
        }
        return result;
      }) }));
      try { expect(await instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request })).toEqual({ ok: false, error: "conflict" }); }
      finally { restore(); }
      expect(abandoned).toBe(true);
    });
    expect((await env.STAGING.list({ prefix: "usage-stats/v2/" })).objects).toHaveLength(1);
    expect(success(await abandon(device, request))).toMatchObject({ outcome: "abandoned", fencedAtRevision: 1 });
    expect(await stub().readUsageStats(statsQuery())).toEqual({ ok: false, error: "not_started" });
    await abortAllDurableObjects(); await activate();
    expect(await statsUpload(device, request)).toEqual({ ok: false, error: "conflict" });
    success(await statsUpload(device, statsRequest(device, { expectedRevision: 1, operationId: hex(90102) })));
  });
  test("abandonment cannot disturb another pending intent or authenticated device progress", async () => {
    const device = await enroll(), other = await enroll(); await activate(); const first = statsRequest(device);
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, current => ({ ...current, STAGING: bucketProxy(current.STAGING, async (method, _args, invoke) => {
        if (method === "put") throw new Error("synthetic_unavailable"); return invoke();
      }) }));
      try { expect(await instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: first })).toEqual({ ok: false, error: "storage_unavailable" }); }
      finally { restore(); }
    });
    const before = await runInDurableObject(stub(), (_instance, state) => ({ control: new StatsState(state.storage.sql).control(), pending: new StatsState(state.storage.sql).pending() }));
    expect(await abandon(other, statsRequest(other))).toEqual({ ok: false, error: "conflict" });
    expect(await stub().abandonStatsSnapshot({ uploadSecret: device.proof.pollSecret, request: abandonRequest(first) })).toEqual({ ok: false, error: "unauthorized" });
    expect(await runInDurableObject(stub(), (_instance, state) => ({ control: new StatsState(state.storage.sql).control(), pending: new StatsState(state.storage.sql).pending() }))).toEqual(before);
    const receipt = success(await statsUpload(device, first));
    expect(success(await abandon(device, first))).toEqual({ schemaVersion: 2, outcome: "committed", receipt });
    expect(await abandon(device, { ...first, operationId: hex(91234) })).toEqual({ ok: false, error: "conflict" });
  });
  test("legacy takeover proves every retained day, reported bucket and record before reserving objects", async () => {
    const device = await enroll(), other = await enroll();
    const values = { provider: 2 as const, input: 10n, cache: 2n, write5m: 3n, output: 5n, reasoning: 1n };
    success(await upload(device, batch(device, 1, [{ id: 1, day: DAY - 1, ...values }, { id: 2, ...values }, { id: 3, ...values }, { id: 4, day: DAY - 2, ...values }])));
    await activate();
    const base = statsRequest(device, { mode: "preserve-history" });
    const single = { ...base.report.rows[0], client: "claude", model: "gpt-5", tokens: { input: "10", cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "1" } };
    const doubled = { ...single, records: 2, tokens: { input: "20", cacheRead: "4", cacheWrite: "6", output: "8", reasoning: "2" } };
    const report = { ...base.report, firstUtcDay: DAY - 1, dayCount: 2, sources: [{ ...base.report.sources[0], client: "claude", records: 3 }], rows: [{ ...single, utcDay: DAY - 1 }, doubled] };
    const request = statsRequest(device, { mode: "preserve-history", report });
    const status = await statsStatus(device, request);
    expect(status).toMatchObject({ legacyRecords: 3, takeoverEligible: true });
    const takeover = { expectedV1Revision: status.v1Revision, headDigest: status.headDigest };
    const counters = () => runInDurableObject(stub(), (_instance, state) => ({
      control: state.storage.sql.exec("SELECT * FROM usage_stats_control").toArray(),
      pending: state.storage.sql.exec("SELECT * FROM usage_stats_pending").toArray(),
    }));
    const before = await counters();
    const reductions = [
      { ...report, sources: [{ ...report.sources[0], records: 2 }], rows: [doubled] },
      { ...report, sources: [{ ...report.sources[0], tokenBasis: "mixed" as const }], rows: [report.rows[0], { ...doubled, tokenBasis: "estimated" as const }] },
      { ...report, sources: [{ ...report.sources[0], records: 2 }], rows: [report.rows[0], { ...doubled, records: 1 }] },
      ...Object.keys(doubled.tokens).map(key => ({ ...report, rows: [report.rows[0], { ...doubled, tokens: { ...doubled.tokens, [key]: (BigInt(doubled.tokens[key as keyof typeof doubled.tokens]) - 1n).toString() } }] })),
    ];
    for (const report of reductions) {
      const input = parseStatsUpload({ ...request, takeover, report }); expect(input).not.toBeNull();
      expect(await statsUpload(device, input!)).toEqual({ ok: false, error: "replacement_required" });
      expect(await counters()).toEqual(before);
    }
    expect(await statsUpload(device, { ...request, takeover: { ...takeover, headDigest: hex(9999999) } })).toEqual({ ok: false, error: "conflict" });
    expect(await statsUpload(other, statsRequest(other, { report, mode: "preserve-history", takeover }))).toEqual({ ok: false, error: "takeover_required" });
    expect(await counters()).toEqual(before);
    // A real legacy commit after status invalidates the frozen predecessor,
    // even when it happens outside this report's selected day window.
    success(await upload(device, batch(device, 5, [{ id: 5, day: DAY - 3, ...values }])));
    expect(await statsUpload(device, { ...request, takeover })).toEqual({ ok: false, error: "conflict" });
    expect(await counters()).toEqual(before);
    const currentStatus = await statsStatus(device, request);
    const originalV1 = await read(query({ firstUtcDay: DAY - 2, dayCount: 3 }));
    success(await statsUpload(device, { ...request, takeover: { expectedV1Revision: currentStatus.v1Revision, headDigest: currentStatus.headDigest } }));
    const current = success(await stub().readUsageStats({ ...statsQuery(), firstUtcDay: DAY - 2, dayCount: 3 }));
    expect(current.rows).toHaveLength(3);
    expect(current.rows.reduce((sum, row) => sum + row.records, 0)).toBe(4);
    expect(current.rows.reduce((sum, row) => sum + Object.values(row.tokens).reduce((amount, count) => amount + BigInt(count), 0n), 0n)).toBe(80n);
    expect(await read(query({ firstUtcDay: DAY - 2, dayCount: 3 }))).toEqual(originalV1);
  });
  test("Warp refresh replaces its prior counter snapshot while preserving immutable evidence", async () => {
    const device = await enroll(); await activate();
    const base = statsRequest(device);
    const warp = (day: number, records: number, cost: string, revision: number): StatsUpload => statsRequest(device, {
      mode: "replace-snapshot", sequence: revision + 1, expectedRevision: revision, operationId: hex(80000 + revision),
      report: { ...base.report, firstUtcDay: day, dayCount: 1,
        sources: [{ ...base.report.sources[0], client: "warp", tokenBasis: "unavailable", records, latestAtMs: day * DAY_MS + 1 }],
        rows: [{ ...base.report.rows[0], utcDay: day, client: "warp", tokenBasis: "unavailable", records,
          tokens: { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, reportedCostMicrousd: cost, reportedCostRecords: records }] },
    });
    const first = warp(DAY - 1, 10, "100", 0); success(await statsUpload(device, first));
    const next = warp(DAY, 12, "250", 1); success(await statsUpload(device, next));
    const report = success(await stub().readUsageStats(statsQuery()));
    expect(report.rows).toHaveLength(1); expect(report.rows[0]).toMatchObject({ utcDay: DAY, records: 12, reportedCostMicrousd: "250" });
    expect((await env.STAGING.list()).objects.filter(object => object.key.includes("/snapshots/"))).toHaveLength(2);
    expect((await env.CONTROL.list()).objects.filter(object => object.key.includes("/receipts/"))).toHaveLength(2);
    expect(await statsUpload(device, warp(DAY - 1, 10, "100", 2))).toEqual({ ok: false, error: "clock_regressed" });
    success(await statsUpload(device, statsRequest(device, { sequence: 3, expectedRevision: 2, operationId: hex(80003) })));
    success(await stub().setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: true, publicHandle: "warp-test" }));
    expect(success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))).toMatchObject({ observedTokens: "20", usageRecords: 1 });
    expect(success(await stub().readUsageStats(statsQuery())).rows).toHaveLength(2);
    // A later billing reset may reduce the current aggregate; it still leaves
    // historical authoritative objects intact and never enters token ranking.
    success(await statsUpload(device, warp(DAY, 2, "0", 3)));
    expect(success(await stub().readUsageStats(statsQuery())).rows.find(row => row.client === "warp")).toMatchObject({ records: 2, reportedCostMicrousd: "0" });
  });
  test("routine sync preserves absent days and refuses loss within an observed day", async () => {
    const device = await enroll(); await activate();
    const base = statsRequest(device, { mode: "preserve-history" });
    const original = base.report.rows[0];
    const complete = { ...original, breakdownCoverage: "complete" as const, records: 2,
      reportedCostMicrousd: "100", reportedCostRecords: 1, estimatedCostMicrousd: "200", estimatedCostRecords: 1,
      durationMs: "1000", timedRecords: 1, timedTokens: "10" };
    const first = statsRequest(device, { mode: "preserve-history", report: { ...base.report, firstUtcDay: DAY - 1, dayCount: 2,
      sources: [{ ...base.report.sources[0], records: 4 }], rows: [{ ...complete, utcDay: DAY - 1 }, complete] } });
    success(await statsUpload(device, first));
    const next = statsRequest(device, { mode: "preserve-history", operationId: hex(70001), expectedRevision: 1, sequence: 2,
      report: { ...first.report, sources: [{ ...first.report.sources[0], records: 2 }], rows: [complete] } });
    success(await statsUpload(device, next));
    expect(success(await stub().readUsageStats(statsQuery())).rows).toHaveLength(2);
    const before = success(await stub().readUsageStats(statsQuery()));
    const changes = [
      { tokens: { ...complete.tokens, input: "9" } }, { records: 1, estimatedCostRecords: 0, estimatedCostMicrousd: null },
      { model: "gpt-5" }, { breakdownCoverage: "partial" as const },
      { reportedCostMicrousd: "99" }, { estimatedCostMicrousd: null, estimatedCostRecords: 0 },
      { durationMs: "999" }, { timedRecords: 0, durationMs: null, timedTokens: "0" }, { timedTokens: "9" },
    ];
    for (const change of changes) {
      const row = { ...complete, ...change };
      const request = statsRequest(device, { mode: "preserve-history", operationId: hex(70002), expectedRevision: 2, sequence: 3,
        report: { ...base.report, sources: [{ ...base.report.sources[0], records: row.records }], rows: [row] } });
      expect(await statsUpload(device, request)).toEqual({ ok: false, error: "replacement_required" });
      expect(success(await stub().readUsageStats(statsQuery()))).toEqual(before);
    }
    const grew = { ...complete, tokens: { ...complete.tokens, input: "11" } };
    success(await statsUpload(device, statsRequest(device, { mode: "preserve-history", operationId: hex(70003), expectedRevision: 2, sequence: 3,
      report: { ...base.report, sources: [{ ...base.report.sources[0], records: 2 }], rows: [grew] } })));
    expect(success(await stub().readUsageStats(statsQuery())).rows[1].tokens.input).toBe("11");
  });
  test("default closed; additive activation preserves v1 and read/status cause no writes", async () => {
    const device = await enroll(), v1 = batch(device); success(await upload(device, v1));
    expect(await statsUpload(device, statsRequest(device))).toEqual({ ok: false, error: "storage_unavailable" });
    const before = await read(); await activate(); expect(await read()).toEqual(before);
    const snapshot = () => runInDurableObject(stub(), (_instance, state) => ({
      account: state.storage.sql.exec("SELECT * FROM account_enrollment").toArray(), stats: state.storage.sql.exec("SELECT * FROM usage_stats_control").toArray(),
      v1: state.storage.sql.exec("SELECT * FROM usage_admission_control").toArray(),
    }));
    const stored = await snapshot();
    const status = await statsStatus(device); expect(status).toMatchObject({ revision: 0, nextSequence: 1, legacyRecords: 1, takeoverEligible: true });
    expect(await stub().readUsageStats(statsQuery())).toMatchObject({ ok: false, error: "not_started" });
    expect(await snapshot()).toEqual(stored);
  });
  test("snapshot commits once, retries exactly, corrects downward, and survives restart", async () => {
    const device = await enroll(); await activate(); const first = statsRequest(device);
    const receipt = success(await statsUpload(device, first)); expect(receipt.revision).toBe(1);
    expect(success(await statsUpload(device, first))).toEqual(receipt);
    expect((await statsStatus(device)).nextSequence).toBe(2);
    const report = success(await stub().readUsageStats(statsQuery())); expect(report.rows[0].tokens.input).toBe("10");
    const correction = statsRequest(device, { operationId: hex(20000), expectedRevision: 1, sequence: 2,
      report: { ...first.report, rows: [{ ...first.report.rows[0], tokens: { input: "1", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } }] } });
    success(await statsUpload(device, correction));
    expect(success(await stub().readUsageStats(statsQuery())).rows[0].tokens.input).toBe("1");
    expect(await statsUpload(device, first)).toMatchObject({ ok: false, error: "conflict" });
    await abortAllDurableObjects(); await activate();
    expect(success(await stub().readUsageStats(statsQuery())).revision).toBe(2);
  });
  test("explicit empty window removes owned rows without reviving v1; other days remain", async () => {
    const device = await enroll(); success(await upload(device, batch(device, 1, [{ id: 1, reasoning: 1n }, { id: 2, day: DAY - 1 }]))); await activate();
    const first = statsRequest(device), status = await statsStatus(device);
    expect(await statsUpload(device, first)).toMatchObject({ ok: false, error: "takeover_required" });
    success(await statsUpload(device, { ...first, takeover: { expectedV1Revision: status.v1Revision, headDigest: status.headDigest } }));
    expect(success(await stub().readUsageStats(statsQuery())).rows).toHaveLength(2);
    const empty = statsRequest(device, { operationId: hex(20001), expectedRevision: 1, sequence: 2, report: { ...first.report,
      sources: [{ ...first.report.sources[0], status: "empty", records: 0, latestAtMs: null }], rows: [] } });
    success(await statsUpload(device, empty));
    const rows = success(await stub().readUsageStats(statsQuery())).rows;
    expect(rows).toHaveLength(1); expect(rows[0].utcDay).toBe(DAY - 1);
    expect((await read()).days[1].codex.usageOccurrences).toBe(1); // Retained original profile remains readable.
  });
  test("ownership excludes overlapping v1 writes and refuses another installation", async () => {
    const device = await enroll(), other = await enroll(); await activate(); const first = statsRequest(device);
    success(await statsUpload(device, first));
    expect(await upload(device, batch(device))).toMatchObject({ ok: false, error: "profile_superseded" });
    expect(await statsUpload(other, statsRequest(other, { expectedRevision: 1 }))).toMatchObject({ ok: false, error: "writer_conflict" });
    success(await upload(device, batch(device, 1, [{ id: 2, day: DAY - 1 }])));
    expect(success(await stub().readUsageStats(statsQuery())).rows).toHaveLength(2);
  });
  test("wrong secret/account/generation, expired session and incomplete scans refuse", async () => {
    const device = await enroll(); await activate(); const first = statsRequest(device);
    expect(await stub().admitStatsSnapshot({ uploadSecret: device.proof.pollSecret, request: first })).toMatchObject({ ok: false, error: "unauthorized" });
    expect(await statsUpload(device, { ...first, generation: hex(987654) })).toMatchObject({ ok: false, error: "recovery_required" });
    expect(await statsUpload(device, { ...first, report: { ...first.report, sources: [{ ...first.report.sources[0], status: "incomplete", warnings: 1 }] } })).toMatchObject({ ok: false, error: "invalid_input" });
    success(await statsUpload(device, first));
    expect(await stub().readUsageStats({ ...statsQuery(), sessionExpiresAtMs: NOW })).toMatchObject({ ok: false, error: "expired" });
    expect(await stub().readUsageStats({ ...statsQuery(), accountId: `acct_${hex(9999, 16)}` })).toMatchObject({ ok: false, error: "unauthorized" });
  });
  test("lost immutable object reply retains exact intent and retries without double publication", async () => {
    const device = await enroll(); await activate(); const request = statsRequest(device);
    await runInDurableObject(stub(), async instance => {
      let failed = false;
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(original.STAGING, async (method, _args, invoke) => {
        const result = await invoke(); if (method === "put" && !failed) { failed = true; throw new Error("uncertain"); } return result;
      }) }));
      try { expect(await instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request })).toMatchObject({ ok: false, error: "storage_unavailable" }); }
      finally { restore(); }
    });
    expect(await stub().readUsageStats(statsQuery())).toMatchObject({ ok: false, error: "not_started" });
    expect(await upload(device, batch(device))).toMatchObject({ ok: false, error: "conflict" });
    success(await statsUpload(device, request)); expect((await statsStatus(device)).revision).toBe(1);
  });
  test("reported-only leaderboard uses disjoint totals and never adds replaced legacy", async () => {
    const device = await enroll(); success(await upload(device, batch(device, 1, [{ id: 1, reasoning: 1n }]))); await activate();
    const first = statsRequest(device), status = await statsStatus(device);
    success(await statsUpload(device, { ...first, takeover: { expectedV1Revision: status.v1Revision, headDigest: status.headDigest } }));
    const totals = await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).leaderboard({
      accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, observedAtMs: NOW, phase: "active", devices: [{
        deviceId: first.deviceId, enrolledAtMs: NOW, revokedAtMs: null, reservation: { intentId: device.proof.intentId, uploadCommitment: "" },
      }],
    }, { firstUtcDay: DAY, dayCount: 1 }, NOW));
    expect(totals).toEqual({ observedTokens: "20", usageRecords: 1 });
    const estimated = statsRequest(device, { operationId: hex(20002), sequence: 2, expectedRevision: 1, report: { ...first.report,
      sources: [{ ...first.report.sources[0], tokenBasis: "estimated" }], rows: [{ ...first.report.rows[0], tokenBasis: "estimated" }] } });
    success(await statsUpload(device, estimated));
    success(await stub().setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: true, publicHandle: "stats-test" }));
    expect(success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))).toMatchObject({ observedTokens: "0", usageRecords: 0 });
  });
  test("legacy tombstones cannot be resurrected by a snapshot takeover", async () => {
    const device = await enroll(), original = batch(device); success(await upload(device, original));
    success(await upload(device, batch(device, 2, [{ id: 1, tombstone: true, expected: original.operations[0].operationHash }])));
    await activate(); const request = statsRequest(device), status = await statsStatus(device);
    expect(status).toMatchObject({ legacyRecords: 0, takeoverEligible: false });
    expect(await statsUpload(device, { ...request, takeover: { expectedV1Revision: status.v1Revision, headDigest: status.headDigest } }))
      .toMatchObject({ ok: false, error: "takeover_required" });
  });
  test("revoking a pending device fences its delayed result and releases unrelated clients", async () => {
    const device = await enroll(), other = await enroll(); await activate(); const request = statsRequest(device);
    await runInDurableObject(stub(), async instance => {
      let revoked = false;
      const restore = replaceEnvironment(instance, current => ({ ...current, CONTROL: bucketProxy(current.CONTROL, async (method, args, invoke) => {
        const result = await invoke();
        if (!revoked && method === "put" && String(args[0]).startsWith("usage-stats/v2/")) {
          revoked = true; success(await instance.revokeEnrollment(device.proof));
        }
        return result;
      }) }));
      try { expect(await instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request })).toMatchObject({ ok: false, error: "revoked" }); }
      finally { restore(); }
      expect(revoked).toBe(true);
    });
    const next = statsRequest(other, { operationId: hex(25000), report: { ...request.report,
      sources: [{ ...request.report.sources[0], client: "cursor" }], rows: [{ ...request.report.rows[0], client: "cursor" }] } });
    expect(success(await statsUpload(other, next)).revision).toBe(1);
    expect(success(await stub().readUsageStats(statsQuery())).rows.map(row => row.client)).toEqual(["cursor"]);
  });
  test("hosted reads refuse an oversized combined range without truncating either snapshot", async () => {
    const device = await enroll(); await activate(); const template = statsRequest(device);
    const models = registry.models.slice(0, 2_250);
    expect(models).toHaveLength(2_250);
    const make = (day: number, sequence: number): StatsUpload => {
      const rows = models.flatMap(model => [null, registry.providers[0]].map(provider => ({ ...template.report.rows[0], utcDay: day, client: "cursor", provider, model })));
      rows.sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : 1);
      return statsRequest(device, { operationId: hex(30000 + sequence), sequence, expectedRevision: sequence - 1,
        report: { ...template.report, firstUtcDay: day, sources: [{ ...template.report.sources[0], client: "cursor", records: rows.length }], rows } });
    };
    success(await statsUpload(device, make(DAY - 1, 1))); success(await statsUpload(device, make(DAY, 2)));
    for (const day of [DAY - 1, DAY]) expect(success(await stub().readUsageStats({ ...statsQuery(), firstUtcDay: day, dayCount: 1 })).rows).toHaveLength(4_500);
    expect(await stub().readUsageStats(statsQuery())).toEqual({ ok: false, error: "limit" });
    success(await stub().setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: true, publicHandle: "dense-stats" }));
    expect(success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))).toMatchObject({ observedTokens: "180000", usageRecords: 9000 });
  }, 30_000);

  test("immutable storage budget reserves before writes, never recharges retry, and refuses growth", async () => {
    const device = await enroll(); await activate(); const request = statsRequest(device);
    const charge = new TextEncoder().encode(JSON.stringify(request)).length + 1024;
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_stats_control SET immutable_bytes = ?", MAX_STATS_IMMUTABLE_BYTES - charge).toArray());
    const receipt = success(await statsUpload(device, request)); expect(success(await statsUpload(device, request))).toEqual(receipt);
    const bytes = await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).control().immutableBytes);
    expect(bytes).toBe(MAX_STATS_IMMUTABLE_BYTES);
    const correction = statsRequest(device, { operationId: hex(34000), sequence: 2, expectedRevision: 1 });
    expect(await statsUpload(device, correction)).toEqual({ ok: false, error: "limit" });
    expect((await env.STAGING.list({ prefix: "usage-stats/v2/" })).objects).toHaveLength(1);
    expect(success(await stub().readUsageStats(statsQuery())).revision).toBe(1);
  });

});
