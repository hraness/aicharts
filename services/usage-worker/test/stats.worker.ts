import { AccountEnrollment } from "../src/enrollment";
import { LEGACY_STATS_WRITERS_SQL, MAX_STATS_IMMUTABLE_BYTES, RETIRED_STATS_SCHEMA, STATS_SCHEMA, StatsState, statsHash, statsUploadText } from "../src/stats-state";
import { parseStatsTotals } from "../../../lib/usage/stats-totals-contract";
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
import { RESTORE_FENCE_LEASE_TTL_MS, restoreFenceName } from "../src/restore-fence";

const NOW = Math.ceil(Date.now() / DAY_MS) * DAY_MS + DAY_MS / 2, DAY = Math.floor(NOW / DAY_MS);
let serial = 0, account = "", intent = 0;
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic fixture: ${result.error}`);
  expect(result).toMatchObject({ ok: true });
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

async function activate(prepare = true) {
  await runInDurableObject(stub(), async (instance, state) => {
    const owner = instance as unknown as { env: Env }, updated = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1" };
    new AccountEnrollment(state, updated);
    owner.env = updated;
    if (prepare) success(await instance.maintainAccount({ schemaVersion: 1, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" }));
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
const totalsQuery = () => ({ schemaVersion: 2, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS });
async function totals() {
  const value = success(await stub().readUsageTotals(totalsQuery()));
  expect(parseStatsTotals(value)).toEqual(value); return value;
}
/** Rewrite a partitioned store into the retired (client, day) ownership shape
 * so the fenced migration can be exercised against a genuine old layout. */
async function retireStorage(dropSources = false) {
  await runInDurableObject(stub(), (_instance, state) => {
    const sql = state.storage.sql;
    const days = sql.exec("SELECT * FROM usage_stats_days ORDER BY client, utc_day").toArray();
    const pending = sql.exec("SELECT * FROM usage_stats_pending").toArray();
    for (const table of ["usage_stats_day_rows", "usage_stats_day_meta", "usage_stats_day_totals", "usage_stats_retired", "usage_stats_days", "usage_stats_pending"]) sql.exec(`DROP TABLE ${table}`);
    for (const table of ["usage_stats_writers", "usage_stats_day_sources", "usage_stats_pending", "usage_stats_days", "usage_stats_day_meta", "usage_stats_day_rows"] as const) sql.exec(RETIRED_STATS_SCHEMA[table]);
    const writers = new Map<string, string>();
    for (const day of days) {
      sql.exec("INSERT INTO usage_stats_days (client, utc_day, revision, body_hash, projection_hash, row_count, byte_count, projection) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        day.client, day.utc_day, day.revision, day.body_hash, day.projection_hash, day.row_count, day.byte_count, day.projection);
      if (!dropSources) sql.exec("INSERT INTO usage_stats_day_sources VALUES (?, ?, ?, ?)", day.client, day.utc_day, day.device_id, day.revision);
      if (!writers.has(String(day.client))) writers.set(String(day.client), String(day.device_id));
    }
    for (const [client, device] of writers) sql.exec("INSERT INTO usage_stats_writers VALUES (?, ?, ?)", client, device, 1);
    for (const row of pending) sql.exec("INSERT INTO usage_stats_pending (id, body_hash, device_id, sequence, expected_revision, receipt) VALUES (1, ?, ?, ?, ?, ?)",
      row.body_hash, row.device_id, row.sequence, row.expected_revision, row.receipt);
    if (dropSources) sql.exec("DROP TABLE usage_stats_day_sources");
  });
}
async function statsStatus(device: Device, request = statsRequest(device)) {
  return success(await stub().readStatsStatus({ uploadSecret: device.proof.uploadSecret, request: {
    schemaVersion: 2, accountId: account, deviceId: request.deviceId, generation: env.USAGE_ENROLLMENT_GENERATION,
    client: request.report.sources[0].client, firstUtcDay: request.report.firstUtcDay, dayCount: request.report.dayCount,
  } }));
}

describe("v2 account snapshots", () => {
  test("a real timed-out immutable put can only finish as a charged orphan after restore publication", async () => {
    const device = await enroll(); await activate(); const request = statsRequest(device);
    const authority = { accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, epoch: 0, workerVersion: env.USAGE_WORKER_VERSION };
    await runInDurableObject(stub(), async (instance, state) => {
      const fence = env.RESTORE_FENCES.getByName(restoreFenceName(account));
      const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>();
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(original.STAGING, async (method, _args, invoke) => {
        if (method !== "put") return invoke();
        started.resolve(); await release.promise;
        try { return await invoke(); } finally { finished.resolve(); }
      }) }));
      const tables = ["account_enrollment", "usage_admission_control", ...Object.keys(STATS_SCHEMA)];
      const snapshot = () => Object.fromEntries(tables.map(name => [name, state.storage.sql.exec(`SELECT * FROM ${name}`).toArray()]));
      const pending = instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request });
      try {
        await started.promise;
        // Date is fixed, but the real five-second outward deadline elapses
        // while the actual put promise remains unresolved.
        expect(await pending).toEqual({ ok: false, error: "storage_unavailable" });
        expect((await env.STAGING.list()).objects).toEqual([]);
        expect(state.storage.sql.exec("SELECT revision, immutable_bytes FROM usage_stats_control").one())
          .toMatchObject({ revision: 0, immutable_bytes: expect.any(Number) });
        expect(state.storage.sql.exec("SELECT immutable_bytes FROM usage_stats_control").one().immutable_bytes).toBeGreaterThan(0);
        expect(state.storage.sql.exec("SELECT body_hash FROM usage_stats_pending").one().body_hash).toBe(statsHash(statsUploadText(request)));
        const terminal = snapshot();
        expect(success(await fence.close(authority)).inFlight).toBe(0);
        success(await fence.publish({ ...authority, epoch: 1 }));
        release.resolve(); await finished.promise;
        const objects = (await env.STAGING.list()).objects;
        expect(objects.map(object => object.key)).toEqual([
          `usage-stats/v2/${account}/${authority.generation}/snapshots/${statsHash(statsUploadText(request))}.json`,
        ]);
        expect(await (await env.STAGING.get(objects[0].key))?.text()).toBe(statsUploadText(request));
        expect(snapshot()).toEqual(terminal);
        expect(state.storage.sql.exec("SELECT * FROM usage_stats_days").toArray()).toEqual([]);
      } finally { release.resolve(); await pending; await finished.promise; restore(); }
    });
  }, 20_000);
  test("restore cannot drain a real delayed stats continuation after its diagnostic deadline", async () => {
    const device = await enroll(); await activate(); const request = statsRequest(device);
    const authority = { accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, epoch: 0, workerVersion: env.USAGE_WORKER_VERSION };
    await runInDurableObject(stub(), async instance => {
      const fence = env.RESTORE_FENCES.getByName(restoreFenceName(account));
      const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(original.STAGING, async (method, _args, invoke) => {
        if (method === "put") { started.resolve(); await release.promise; }
        return invoke();
      }) }));
      const pending = instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request });
      try {
        await started.promise;
        vi.setSystemTime(NOW + RESTORE_FENCE_LEASE_TTL_MS + 1);
        expect(success(await fence.close(authority)).inFlight).toBe(1);
        expect(await fence.publish({ ...authority, epoch: 1 })).toEqual({ ok: false, error: "recovery_required" });
        expect(await instance.readUsageStats(statsQuery())).toEqual({ ok: false, error: "recovery_required" });
        release.resolve();
        success(await pending);
        expect(success(await fence.read({ accountId: account, generation: authority.generation })).inFlight).toBe(0);
        success(await fence.publish({ ...authority, epoch: 1 }));
        expect(await instance.readUsageStats(statsQuery())).toEqual({ ok: false, error: "recovery_required" });
        expect(await instance.maintainAccount({ schemaVersion: 1, accountId: account, generation: authority.generation, operation: "scrub" }))
          .toEqual({ ok: false, error: "recovery_required" });
      } finally { release.resolve(); await pending; restore(); }
    });
  });
  test("devices publish the same client independently; reads sum their days and a revoked device keeps its history", async () => {
    const first = await enroll(), second = await enroll(); await activate();
    const original = statsRequest(first); success(await statsUpload(first, original));
    // The second device neither owns nor contends for the client, and a stale
    // expected revision from before the first device's commit still publishes.
    const replacement = statsRequest(second, { expectedRevision: 0 });
    const receipt = success(await statsUpload(second, replacement));
    expect(receipt.revision).toBe(1);
    expect((await statsStatus(second)).revision).toBe(2);
    const report = success(await stub().readUsageStats(statsQuery()));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ client: "codex", records: 2, tokens: { input: "20", cacheRead: "4", cacheWrite: "6", output: "8", reasoning: "2" } });
    success(await stub().revokeEnrollment(first.proof));
    expect(await statsUpload(first, { ...original, sequence: 2, expectedRevision: 2 })).toEqual({ ok: false, error: "revoked" });
    expect(success(await stub().readUsageStats(statsQuery())).rows[0].records).toBe(2);
    const previousDay = { ...replacement.report, firstUtcDay: DAY - 1, sources: [{ ...replacement.report.sources[0], latestAtMs: (DAY - 1) * DAY_MS + 1 }],
      rows: [{ ...replacement.report.rows[0], utcDay: DAY - 1 }] };
    success(await statsUpload(second, { ...replacement, operationId: hex(70100), sequence: 2, expectedRevision: 2, report: previousDay }));
    expect(success(await stub().readUsageStats(statsQuery())).rows.map(row => [row.utcDay, row.records])).toEqual([[DAY - 1, 1], [DAY, 2]]);
    const partitions = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec(
      "SELECT device_id, utc_day FROM usage_stats_days WHERE client = 'codex' ORDER BY utc_day, device_id").toArray());
    const sorted = (rows: { device_id: unknown; utc_day: unknown }[]) => [...rows].sort((a, b) => `${a.utc_day}${a.device_id}` < `${b.utc_day}${b.device_id}` ? -1 : 1);
    expect(sorted(partitions as { device_id: unknown; utc_day: unknown }[])).toEqual(sorted([{ device_id: replacement.deviceId, utc_day: DAY - 1 }, { device_id: original.deviceId, utc_day: DAY }, { device_id: replacement.deviceId, utc_day: DAY }]));
  });

  test("partition migration attributes retained days to their recorded source device", async () => {
    const first = await enroll(), second = await enroll(); await activate();
    success(await statsUpload(first, statsRequest(first)));
    const cursor = statsRequest(second, { expectedRevision: 1, report: { ...statsRequest(second).report,
      sources: [{ ...statsRequest(second).report.sources[0], client: "cursor" }], rows: [{ ...statsRequest(second).report.rows[0], client: "cursor" }] } });
    success(await statsUpload(second, cursor));
    const before = success(await stub().readUsageStats(statsQuery()));
    await retireStorage();
    await abortAllDurableObjects(); await activate();
    const after = success(await stub().readUsageStats(statsQuery()));
    expect(after.rows).toEqual(before.rows);
    expect(await runInDurableObject(stub(), (_instance, state) => ({
      days: state.storage.sql.exec("SELECT client, device_id FROM usage_stats_days ORDER BY client").toArray(),
      totals: state.storage.sql.exec("SELECT client, device_id, records FROM usage_stats_day_totals ORDER BY client").toArray(),
      retired: state.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name IN ('usage_stats_writers', 'usage_stats_day_sources')").toArray(),
    }))).toEqual({ days: [{ client: "codex", device_id: statsRequest(first).deviceId }, { client: "cursor", device_id: cursor.deviceId }],
      totals: [{ client: "codex", device_id: statsRequest(first).deviceId, records: 1 }, { client: "cursor", device_id: cursor.deviceId, records: 1 }], retired: [] });
    // The old single-writer table alone (a schema-seven store) attributes every
    // retained day of a client to that writer.
    success(await statsUpload(second, statsRequest(second, { operationId: hex(70200), sequence: 2, expectedRevision: 2 })));
    expect((await totals()).devices.map(device => device.records)).toEqual([1, 2]);
  });
  test("partition migration refuses a retained day without a recorded source device", async () => {
    const device = await enroll(); await activate();
    success(await statsUpload(device, statsRequest(device)));
    const retained = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT client, utc_day, projection FROM usage_stats_days").toArray());
    await retireStorage(true);
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("DELETE FROM usage_stats_writers"));
    await abortAllDurableObjects();
    await activate(false);
    expect(await stub().maintainAccount({ schemaVersion: 1, accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" })).toEqual({ ok: false, error: "storage_invalid" });
    expect(await statsUpload(device, statsRequest(device, { operationId: hex(70300), sequence: 2, expectedRevision: 1 }))).toEqual({ ok: false, error: "storage_invalid" });
    expect(await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT client, utc_day, projection FROM usage_stats_days").toArray())).toEqual(retained);
  });

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
    expect(success(await abandon(device, first))).toMatchObject({ outcome: "abandoned", fencedAtRevision: 2 });
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
          expect(new StatsState(state.storage.sql).pending(request.deviceId)).toBeNull();
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
  test("abandonment cannot disturb another device's pending intent or progress", async () => {
    const device = await enroll(), other = await enroll(); await activate(); const first = statsRequest(device);
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, current => ({ ...current, STAGING: bucketProxy(current.STAGING, async (method, _args, invoke) => {
        if (method === "put") throw new Error("synthetic_unavailable"); return invoke();
      }) }));
      try { expect(await instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: first })).toEqual({ ok: false, error: "storage_unavailable" }); }
      finally { restore(); }
    });
    const pendingBefore = await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).pending(first.deviceId));
    expect(pendingBefore).not.toBeNull();
    // Another device abandoning its own never-reserved flight only fences its
    // own bytes; the first device's retained intent is untouched.
    expect(success(await abandon(other, statsRequest(other)))).toMatchObject({ outcome: "abandoned", fencedAtRevision: 1 });
    expect(await stub().abandonStatsSnapshot({ uploadSecret: device.proof.pollSecret, request: abandonRequest(first) })).toEqual({ ok: false, error: "unauthorized" });
    expect(await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).pending(first.deviceId))).toEqual(pendingBefore);
    const receipt = success(await statsUpload(device, first));
    expect(receipt.revision).toBe(1);
    expect(success(await abandon(device, first))).toEqual({ schemaVersion: 2, outcome: "committed", receipt });
    expect(success(await abandon(device, { ...first, operationId: hex(91234) }))).toMatchObject({ outcome: "abandoned", fencedAtRevision: 2 });
    expect(await statsUpload(other, statsRequest(other))).toEqual({ ok: false, error: "conflict" }); // Its abandoned bytes stay retired.
    success(await statsUpload(other, statsRequest(other, { operationId: hex(91235) })));
  });

  test("a device's own retained heads are shadowed by its snapshot for that client and day", async () => {
    const device = await enroll();
    success(await upload(device, batch(device, 1, [{ id: 1, input: 120n, output: 0n }]))); await activate();
    const request = statsRequest(device), status = await statsStatus(device);
    expect(status).toMatchObject({ legacyRecords: 0, takeoverEligible: true, writerDeviceId: null, v1Revision: 1 });
    const before = await read();
    const report = { ...request.report, rows: [{ ...request.report.rows[0], tokens: { input: "15", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } }] };
    success(await statsUpload(device, { ...request, report }));
    // The private v1 read still shows the retained head; the combined report
    // serves the device's snapshot for that client and day instead of it.
    expect(await read()).toEqual(before);
    const combined = success(await stub().readUsageStats(statsQuery()));
    expect(combined.rows).toHaveLength(1);
    expect(combined.rows[0]).toMatchObject({ client: "codex", records: 1, tokens: { input: "15" } });
    expect((await env.STAGING.list({ prefix: "usage-stats/v2/" })).objects).toHaveLength(1);
    expect((await totals()).total).toMatchObject({ records: 1, days: 1, tokens: { input: "15" } });
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
  test("routine sync preserves absent days and keeps the per-row maximum when a fresh scan shrinks", async () => {
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
    const before = success(await stub().readUsageStats(statsQuery()));
    expect(before.rows).toHaveLength(2);
    const shrunk = [
      { tokens: { ...complete.tokens, input: "9" } }, { records: 1, estimatedCostRecords: 0, estimatedCostMicrousd: null },
      { breakdownCoverage: "partial" as const }, { reportedCostMicrousd: "99" }, { estimatedCostMicrousd: null, estimatedCostRecords: 0 },
      { durationMs: "999" }, { timedRecords: 0, durationMs: null, timedTokens: "0" }, { timedTokens: "9" },
    ];
    let sequence = 3;
    for (const change of shrunk) {
      const row = { ...complete, ...change };
      const request = statsRequest(device, { mode: "preserve-history", operationId: hex(70000 + sequence), expectedRevision: sequence - 1, sequence,
        report: { ...base.report, sources: [{ ...base.report.sources[0], records: row.records }], rows: [row] } });
      success(await statsUpload(device, request)); sequence++;
      // A reduced fresh scan never lowers the retained cell.
      expect(success(await stub().readUsageStats(statsQuery())).rows).toEqual(before.rows);
    }
    const grew = { ...complete, tokens: { ...complete.tokens, input: "11" } }, added = { ...complete, model: "gpt-5", records: 1, reportedCostRecords: 0, reportedCostMicrousd: null, estimatedCostRecords: 0, estimatedCostMicrousd: null, timedRecords: 0, timedTokens: "0", durationMs: null };
    success(await statsUpload(device, statsRequest(device, { mode: "preserve-history", operationId: hex(70090), expectedRevision: sequence - 1, sequence,
      report: { ...base.report, sources: [{ ...base.report.sources[0], records: 3 }], rows: [grew, added].sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : 1) } })));
    const after = success(await stub().readUsageStats(statsQuery()));
    expect(after.rows).toHaveLength(3);
    expect(after.rows.find(row => row.utcDay === DAY && row.model === null)?.tokens.input).toBe("11");
    expect(after.rows.find(row => row.model === "gpt-5")?.records).toBe(1);
    expect(after.rows.find(row => row.utcDay === DAY - 1)).toEqual(before.rows[0]);
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
    const status = await statsStatus(device); expect(status).toMatchObject({ revision: 0, nextSequence: 1, legacyRecords: 0, takeoverEligible: true, v1Revision: 1 });
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
  test("explicit empty window removes owned rows while disjoint legacy days remain", async () => {
    const device = await enroll(); success(await upload(device, batch(device, 1, [{ id: 2, day: DAY - 1 }]))); await activate();
    const first = statsRequest(device);
    success(await statsUpload(device, first));
    expect(success(await stub().readUsageStats(statsQuery())).rows).toHaveLength(2);
    const empty = statsRequest(device, { operationId: hex(20001), expectedRevision: 1, sequence: 2, report: { ...first.report,
      sources: [{ ...first.report.sources[0], status: "empty", records: 0, latestAtMs: null }], rows: [] } });
    success(await statsUpload(device, empty));
    const rows = success(await stub().readUsageStats(statsQuery())).rows;
    expect(rows).toHaveLength(1); expect(rows[0].utcDay).toBe(DAY - 1);
    expect((await read()).days[0].codex.usageOccurrences).toBe(1); // Retained original profile remains readable.
  });
  test("a second device publishes the same client while retained heads from another day still project", async () => {
    const device = await enroll(), other = await enroll(); await activate(); const first = statsRequest(device);
    success(await statsUpload(device, first));
    // V1 heads stay retained evidence; the same device's snapshot shadows them
    // for that client and day only.
    success(await upload(device, batch(device)));
    success(await statsUpload(other, statsRequest(other, { expectedRevision: 1 })));
    success(await upload(device, batch(device, 2, [{ id: 2, day: DAY - 1 }])));
    const report = success(await stub().readUsageStats(statsQuery()));
    expect(report.rows.map(row => [row.utcDay, row.records, row.tokens.input])).toEqual([[DAY - 1, 1, "10"], [DAY, 2, "20"]]);
    expect((await read()).days.reduce((sum, day) => sum + day.codex.usageOccurrences, 0)).toBe(2);
  });

  test("wrong secret/account/generation, expired session and incomplete scans refuse", async () => {
    const device = await enroll(); await activate(); const first = statsRequest(device);
    const authority = async () => ({
      fence: await runInDurableObject(env.RESTORE_FENCES.getByName(restoreFenceName(account)), (_instance, state) => ({
        control: state.storage.sql.exec("SELECT * FROM restore_fence").toArray(),
        attempts: state.storage.sql.exec("SELECT * FROM fence_attempt ORDER BY attempt_id").toArray(),
      })),
      account: await runInDurableObject(stub(), (_instance, state) => ({
        owner: state.storage.sql.exec("SELECT * FROM account_enrollment").toArray(),
        audit: state.storage.sql.exec("SELECT * FROM usage_admission_audit").toArray(),
        stats: state.storage.sql.exec("SELECT * FROM usage_stats_control").toArray(),
      })),
    });
    const before = await authority();
    expect(await stub().admitStatsSnapshot({ uploadSecret: device.proof.pollSecret, request: first })).toMatchObject({ ok: false, error: "unauthorized" });
    expect(await stub().abandonStatsSnapshot({ uploadSecret: device.proof.pollSecret, request: abandonRequest(first) })).toMatchObject({ ok: false, error: "unauthorized" });
    expect(await stub().admitBatch({ uploadSecret: device.proof.pollSecret, batch: batch(device).bytes })).toMatchObject({ ok: false, error: "unauthorized" });
    expect(await authority()).toEqual(before);
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
    // A parked stats flight no longer fences v1 admission; heads still land.
    success(await upload(device, batch(device, 1, [{ id: 1, provider: 2 }])));
    success(await statsUpload(device, request)); expect((await statsStatus(device)).revision).toBe(1);
  });
  test("a newer same-device snapshot supersedes its uncertain predecessor, which can never commit or recharge", async () => {
    const device = await enroll(); await activate(); const first = statsRequest(device);
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(original.STAGING, async (method, _args, invoke) => {
        if (method === "put") throw new Error("synthetic_unavailable"); return invoke();
      }) }));
      try { expect(await instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: first })).toMatchObject({ ok: false, error: "storage_unavailable" }); }
      finally { restore(); }
    });
    expect(await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).pending(first.deviceId))).not.toBeNull();
    // Another device is never blocked by this device's retained intent.
    const other = await enroll();
    expect(success(await statsUpload(other, statsRequest(other))).revision).toBe(1);
    const charge = await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).control().immutableBytes);
    const replacement = statsRequest(device, { operationId: hex(90300), report: { ...first.report, rows: [{ ...first.report.rows[0], tokens: { ...first.report.rows[0].tokens, input: "12" } }] } });
    const receipt = success(await statsUpload(device, replacement));
    expect(receipt.revision).toBe(1); // The device's expected revision, not the account's.
    expect((await statsStatus(device)).revision).toBe(2);
    const finalCharge = await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).control().immutableBytes);
    expect(finalCharge).toBeGreaterThan(charge);
    for (let replay = 0; replay < 3; replay++) expect(await statsUpload(device, first)).toEqual({ ok: false, error: "conflict" });
    expect(await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).control().immutableBytes)).toBe(finalCharge);
    expect((await statsStatus(device)).nextSequence).toBe(2);
    expect(success(await abandon(device, first))).toMatchObject({ outcome: "abandoned", fencedAtRevision: 2 });
    const rows = success(await stub().readUsageStats(statsQuery())).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ records: 2, tokens: { input: "22" } });
  });

  test("a foreign 120-token population and a local 15-token snapshot report 135", async () => {
    const device = await enroll(), other = await enroll();
    success(await upload(other, batch(other, 1, [{ id: 1, provider: 2, input: 120n, output: 0n }]))); await activate();
    const base = statsRequest(device);
    const request = statsRequest(device, { report: { ...base.report,
      sources: [{ ...base.report.sources[0], client: "claude" }],
      rows: [{ ...base.report.rows[0], client: "claude", tokens: { input: "15", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" } }] } });
    expect(await statsStatus(device, request)).toMatchObject({ legacyRecords: 0, takeoverEligible: true });
    success(await statsUpload(device, request));
    expect((await read()).days[1].claudeCode.observedAccountedTokens).toBe("120");
    const combined = success(await stub().readUsageStats(statsQuery()));
    expect(combined.rows).toHaveLength(1);
    expect(combined.rows[0]).toMatchObject({ client: "claude", records: 2, tokens: { input: "135" } });
    const lifetime = await totals();
    expect(lifetime.total).toMatchObject({ records: 2, tokens: { input: "135" } });
    expect(lifetime.devices.map(entry => [entry.records, entry.clients[0]?.basis])).toEqual([[1, "snapshots"], [1, "legacy"]]);
  });

  test("reported-only leaderboard sums disjoint source populations and excludes estimates", async () => {
    const device = await enroll(); success(await upload(device, batch(device, 1, [{ id: 1, reasoning: 1n, provider: 2 }]))); await activate();
    const first = statsRequest(device);
    success(await statsUpload(device, first));
    const totals = await runInDurableObject(stub(), (_instance, state) => new StatsState(state.storage.sql).leaderboard({
      accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, observedAtMs: NOW, phase: "active", devices: [{
        deviceId: first.deviceId, enrolledAtMs: NOW, revokedAtMs: null, reservation: { intentId: device.proof.intentId, uploadCommitment: "" },
      }],
    }, { firstUtcDay: DAY, dayCount: 1 }, NOW));
    expect(totals).toEqual({ observedTokens: "35", usageRecords: 2 });
    const estimated = statsRequest(device, { operationId: hex(20002), sequence: 2, expectedRevision: 1, report: { ...first.report,
      sources: [{ ...first.report.sources[0], tokenBasis: "estimated" }], rows: [{ ...first.report.rows[0], tokenBasis: "estimated" }] } });
    success(await statsUpload(device, estimated));
    success(await stub().setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: true, publicHandle: "stats-test" }));
    expect(success(await stub().readLeaderboardProjection({ schemaVersion: 1, accountId: account }))).toMatchObject({ observedTokens: "15", usageRecords: 1 });
  });
  test("tombstoned heads never count and a snapshot for that client and day publishes without a takeover", async () => {
    const device = await enroll(), original = batch(device); success(await upload(device, original));
    success(await upload(device, batch(device, 2, [{ id: 1, tombstone: true, expected: original.operations[0].operationHash }])));
    await activate(); const request = statsRequest(device), status = await statsStatus(device);
    expect(status).toMatchObject({ legacyRecords: 0, takeoverEligible: true, v1Revision: 2 });
    success(await statsUpload(device, request));
    const combined = success(await stub().readUsageStats(statsQuery()));
    expect(combined.rows).toHaveLength(1); expect(combined.rows[0].records).toBe(1);
    expect((await totals()).total.records).toBe(1);
  });
  test("lifetime totals combine snapshot days with unshadowed retained heads and report backfill progress", async () => {
    const device = await enroll(), other = await enroll();
    success(await upload(device, batch(device, 1, [{ id: 1, input: 100n, output: 10n, reasoning: 4n }, { id: 2, day: DAY - 3, provider: 2, input: 7n, cache: 3n, write5m: 1n, write1h: 2n, output: 5n }])));
    success(await upload(other, batch(other, 1, [{ id: 3, day: DAY - 1, provider: 3, input: 1n, output: 1n }])));
    await activate();
    success(await statsUpload(device, statsRequest(device)));
    const lifetime = await totals();
    expect(lifetime).toMatchObject({ legacyRevision: 2, legacyVerifiedRevision: 2, legacyComplete: true, revision: 1 });
    // Own codex head at DAY is shadowed by the snapshot; the claude head and
    // the other device's devin head still count, in disjoint v2 buckets.
    expect(lifetime.total).toMatchObject({ records: 3, days: 3, firstUtcDay: DAY - 3, lastUtcDay: DAY });
    expect(lifetime.total.tokens).toEqual({ input: "18", cacheRead: "5", cacheWrite: "6", output: "10", reasoning: "1" });
    expect(lifetime.clients.map(client => [client.client, client.basis, client.records])).toEqual([["claude", "legacy", 1], ["codex", "snapshots", 1], ["devin-cli", "legacy", 1]]);
    expect(lifetime.devices.map(entry => [entry.deviceId === statsRequest(device).deviceId, entry.records, entry.clients.map(client => client.client)]))
      .toEqual([[true, 2, ["claude", "codex"]], [false, 1, ["devin-cli"]]]);
    // A correction of a counted head subtracts the old frame and counts the new one exactly once.
    success(await upload(device, batch(device, 3, [{ id: 1, expected: batch(device, 1, [{ id: 1, input: 100n, output: 10n, reasoning: 4n }]).operations[0].operationHash, input: 50n, output: 10n, reasoning: 4n }])));
    const corrected = await totals();
    expect(corrected.legacyVerifiedRevision).toBe(3);
    expect(corrected.total.tokens.input).toBe("18"); // Still shadowed for DAY by the snapshot.
    const tombstoned = batch(device, 4, [{ id: 2, tombstone: true, expected: batch(device, 1, [{ id: 1, input: 100n, output: 10n, reasoning: 4n }, { id: 2, day: DAY - 3, provider: 2, input: 7n, cache: 3n, write5m: 1n, write1h: 2n, output: 5n }]).operations[1].operationHash }]);
    success(await upload(device, tombstoned));
    expect((await totals()).total).toMatchObject({ records: 2, tokens: { input: "11", cacheRead: "2", cacheWrite: "3", output: "5", reasoning: "1" } });
    // A store whose totals lag the journal is backfilled one bounded span per fenced mutation.
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM usage_admission_day_totals");
      state.storage.sql.exec("UPDATE usage_admission_day_totals_cursor SET verified_revision = 0");
    });
    expect((await totals()).legacyComplete).toBe(false);
    success(await stub().maintainAccount({ schemaVersion: 1, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" }));
    const rebuilt = await totals();
    expect(rebuilt.legacyComplete).toBe(true);
    expect(rebuilt.total).toMatchObject({ records: 2, tokens: { input: "11", cacheRead: "2", cacheWrite: "3", output: "5", reasoning: "1" } });
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
  test("all-client projections cannot conceal later corrupt legacy evidence", async () => {
    const device = await enroll(); await activate(); const base = statsRequest(device);
    for (const [index, client] of ["codex", "claude", "devin-cli"].entries()) success(await statsUpload(device, statsRequest(device, {
      operationId: hex(40000 + index), sequence: index + 1, expectedRevision: index,
      report: { ...base.report, sources: [{ ...base.report.sources[0], client }], rows: [{ ...base.report.rows[0], client }] } })));
    success(await upload(device, batch(device)));
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_admission_heads SET operation = ?", new Uint8Array(184).buffer));
    expect(await stub().readUsageStats(statsQuery())).toEqual({ ok: false, error: "storage_invalid" });
  });
  test("repeat reads reuse the pinned result while stats or admission revisions recompute", async () => {
    const device = await enroll(); await activate(); const base = statsRequest(device);
    success(await statsUpload(device, base));
    const first = success(await stub().readUsageStats(statsQuery()));
    expect(first.rows).toHaveLength(1);
    // A legacy admission bumps the admission revision: the next read must
    // recompute and surface the new head as a projected row.
    success(await upload(device, batch(device, 1, [{ id: 9, day: DAY - 1, provider: 3 }])));
    const second = success(await stub().readUsageStats(statsQuery()));
    expect(second.rows).toHaveLength(2);
    expect(second.rows.some(row => row.utcDay === DAY - 1 && row.client === "devin-cli")).toBe(true);
    // With both revisions unchanged a repeat read serves the memoized report;
    // the corrupted projection proves no recomputation happened.
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_stats_days SET projection = ?", "x"));
    expect(success(await stub().readUsageStats(statsQuery()))).toEqual(second);
    // A new committed stats revision recomputes; the exploded read model never
    // reopens the projection blob, so the answer stays correct, and it is the
    // derived row store whose digest pins what a recomputed read may serve.
    success(await statsUpload(device, statsRequest(device, { operationId: hex(40020), sequence: 2, expectedRevision: 1,
      report: { ...base.report, sources: [{ ...base.report.sources[0], client: "claude" }], rows: [{ ...base.report.rows[0], client: "claude" }] } })));
    expect(success(await stub().readUsageStats(statsQuery())).rows).toHaveLength(3);
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_stats_day_rows SET output_tokens = ?", "999"));
    // A wider range misses the memo key and recomputes into the corruption.
    expect(await stub().readUsageStats({ ...statsQuery(), dayCount: 3 })).toEqual({ ok: false, error: "storage_invalid" });
  });

  test("a cold read after eviction serves the persisted row model without reopening projections", async () => {
    const device = await enroll(); await activate();
    success(await statsUpload(device, statsRequest(device)));
    expect(success(await stub().readUsageStats(statsQuery())).rows).toHaveLength(1);
    // The memo and the Durable Object instance die here; the projection blob is
    // corrupted to prove the next read neither parses it nor needs it.
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_stats_days SET projection = ?", "x"));
    await abortAllDurableObjects(); await activate(false);
    const report = success(await stub().readUsageStats(statsQuery()));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].tokens.input).toBe("10");
  });

  test("derived row model corruption fails closed across meta, rows and digest", async () => {
    const device = await enroll(); await activate();
    success(await statsUpload(device, statsRequest(device)));
    const read = () => stub().readUsageStats(statsQuery());
    // A tampered row field fails the pinned digest before any row may serve.
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_stats_day_rows SET output_tokens = ?", "999"));
    expect(await read()).toEqual({ ok: false, error: "storage_invalid" });
    // A dropped row mismatches the meta row_count just as surely.
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("UPDATE usage_stats_day_rows SET output_tokens = ?", "4");
      state.storage.sql.exec("DELETE FROM usage_stats_day_rows WHERE ordinal = 0");
    });
    expect(await read()).toEqual({ ok: false, error: "storage_invalid" });
    // Missing metadata permits only a pure projection fallback. Explicit
    // fenced maintenance owns rebuilding the derived rows.
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("DELETE FROM usage_stats_day_meta"));
    expect(success(await read()).rows).toHaveLength(1);
    expect(await runInDurableObject(stub(), (_instance, state) =>
      state.storage.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_day_meta").toArray()[0].count)).toBe(0);
    success(await stub().maintainAccount({ schemaVersion: 1, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" }));
    expect(await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_day_meta").one().count)).toBe(1);
    expect(success(await read()).rows).toHaveLength(1);
  });

  test("schema six accounts migrate and backfill only through explicit fenced maintenance", async () => {
    const device = await enroll(); await activate();
    success(await statsUpload(device, statsRequest(device)));
    // Reconstruct the actual version-six shape: a single legacy writer row,
    // no day sources and no exploded read model.
    await retireStorage(true);
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("DROP TABLE usage_stats_day_meta");
      state.storage.sql.exec("DROP TABLE usage_stats_day_rows");
      const writer = state.storage.sql.exec("SELECT client, device_id FROM usage_stats_writers").one();
      state.storage.sql.exec("DROP TABLE usage_stats_writers");
      state.storage.sql.exec(LEGACY_STATS_WRITERS_SQL);
      state.storage.sql.exec("INSERT INTO usage_stats_writers VALUES (?, ?)", writer.client, writer.device_id);
      state.storage.sql.exec("UPDATE account_enrollment SET schema_version = 6");
    });
    await abortAllDurableObjects(); await activate();
    expect(await runInDurableObject(stub(), (_instance, state) =>
      state.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").toArray()[0].schema_version)).toBe(8);
    const report = success(await stub().readUsageStats(statsQuery()));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].tokens.input).toBe("10");
    // The backfilled model now serves without the projection parse.
    expect(await runInDurableObject(stub(), (_instance, state) => ({
      rows: state.storage.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_day_rows").toArray()[0].count,
      device: state.storage.sql.exec("SELECT device_id FROM usage_stats_days").one().device_id,
    }))).toEqual({ rows: 1, device: statsRequest(device).deviceId });
  });


});
