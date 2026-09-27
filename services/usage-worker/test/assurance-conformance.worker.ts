import { env } from "cloudflare:workers";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONFORMANCE_SEEDS, ConformanceTrace, scheduleRandom, scheduleShuffle } from "../../../verify/conformance/contracts";
import { restoreFenceName } from "../src/restore-fence";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { admissionHex, decodeAdmissionBatch, decodeAdmissionJournal, decodeAdmissionOperation, encodeAdmissionBatch, encodeAdmissionOperation, type AdmissionBatch } from "../../../lib/usage/admission";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { admissionIdBytes } from "../src/admission-state";
import { parseUsageStatsReport } from "../../../lib/usage/stats-contract";
import { parseStatsUpload, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import { statsHash } from "../src/stats-state";
import { LEADERBOARD_INDEX_NAME } from "../../../lib/usage/leaderboard-contract";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE } from "../../../lib/usage/contributions";
import type { ContributionRebuildReadRequest, ContributionRebuildReceipt } from "../../../lib/usage/contribution-rebuild-contract";
import { ContributionProjectionState } from "../src/contribution-projection-state";

// Every identity, token and bucket object in this file is synthetic. A fixed
// clock lies in the runtime's future so local alarms do not race the adapter.
const NOW = Math.ceil(Date.now() / 86_400_000) * 86_400_000 + 43_200_000;
const hex = (value: number, bytes = 32) => value.toString(16).padStart(bytes * 2, "0");
let serial = 0;
const accountId = () => `acct_${hex(++serial, 16)}`;
const accountStub = (account: string) => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const DAY = Math.floor(NOW / DAY_MS);
const outcome = (value: { ok: true } | { ok: false; error: string }): string => value.ok ? "ok" : value.error;
const success = <T>(value: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!value.ok) throw new Error(`conformance_fixture:${value.error}`); return value.value;
};
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(item => item.key);
    if (keys.length) await bucket.delete(keys);
  }
  await reset();
});

type Device = { proof: EnrollmentProof; id: Uint8Array };
async function enroll(account: string): Promise<Device> {
  const id = ++serial, proof = { intentId: hex(id), pollSecret: hex(id + 1_000_000), uploadSecret: hex(id + 2_000_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(id + 3_000_000);
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret,
    uploadCommitment: success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret)) }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, contextToken: attempt.contextToken, browserNonce };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof));
  return { proof, id: admissionIdBytes(success(await accountStub(account).enroll(proof)).receipt.deviceId) };
}
function admission(account: string, device: Device, tokens: number, occurrence = 1): AdmissionBatch {
  const id = admissionIdBytes(hex(occurrence, 16));
  const frame = success(encodeUsageBatch({ utcDay: DAY, registryRevision: 1, usage: [{
    id, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1,
    provider: 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
    tokens: { inputUncached: BigInt(tokens), output: 0n, cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, reasoningOutput: 0n },
  }], prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
  const operation = success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: device.id,
    generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: 1, sequence: 1,
    occurrenceId: id, expectedHeadHash: new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  return success(decodeAdmissionBatch(success(encodeAdmissionBatch([operation], ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
}
function bucketFault(bucket: R2Bucket, intercept: (method: "get" | "put", args: unknown[], invoke: () => Promise<unknown>) => Promise<unknown>): R2Bucket {
  return new Proxy(bucket, { get(target, property) {
    const value: unknown = Reflect.get(target, property, target);
    if ((property === "get" || property === "put") && typeof value === "function") return (...args: unknown[]) =>
      intercept(property, args, () => Reflect.apply(value, target, args) as Promise<unknown>);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
function replaceEnvironment(instance: unknown, replace: (current: Env) => Env): () => void {
  const target = instance as { env: Env }, original = target.env;
  target.env = replace(original); return () => { target.env = original; };
}

test.each(CONFORMANCE_SEEDS)("M3 generated lost immutable replies and exact terminal replay seed=%i", async seed => {
  const account = accountId(), devices = [await enroll(account), await enroll(account)], stub = accountStub(account);
  const random = scheduleRandom(seed), firstIndex = random(2), otherIndex = 1 - firstIndex;
  const requests = devices.map((device, index) => admission(account, device, 10 + random(100) + index * 1000));
  const request = requests[firstIndex], device = devices[firstIndex];
  const trace = new ConformanceTrace("M3", seed);
  const model = { revision: 0, pendingPhase: 0, head: null as string | null, sequences: [0, 0], journalStatus: [] as number[], staged: 0, receipts: 0 };
  const observe = async () => {
    const sql = await runInDurableObject(stub, (_instance, state) => ({
      revision: state.storage.sql.exec("SELECT published_revision FROM usage_admission_control").one().published_revision,
      pendingPhase: state.storage.sql.exec("SELECT phase FROM usage_admission_pending").toArray()[0]?.phase ?? 0,
      heads: state.storage.sql.exec("SELECT operation FROM usage_admission_heads").toArray(),
      devices: state.storage.sql.exec("SELECT device_id, settled_sequence FROM usage_admission_devices").toArray(),
      journal: state.storage.sql.exec("SELECT batch, journal FROM usage_admission_journal ORDER BY revision").toArray(),
    }));
    return { revision: sql.revision, pendingPhase: sql.pendingPhase,
      head: sql.heads.length ? admissionHex(success(decodeAdmissionOperation(new Uint8Array(sql.heads[0].operation as ArrayBuffer), ADMISSION_POLICY_V1)).operationHash) : null,
      sequences: devices.map(item => sql.devices.find(row => admissionHex(new Uint8Array(row.device_id as ArrayBuffer)) === admissionHex(item.id))?.settled_sequence ?? 0),
      journalStatus: sql.journal.map(row => success(decodeAdmissionJournal(new Uint8Array(row.journal as ArrayBuffer), new Uint8Array(row.batch as ArrayBuffer), ADMISSION_POLICY_V1)).status),
      staged: (await env.STAGING.list({ prefix: "usage-admission/" })).objects.length,
      receipts: (await env.CONTROL.list({ prefix: "usage-admission/" })).objects.length };
  };
  // Both provider boundaries are required in every seed. Pure random choice
  // previously left the journal-reply branch unvisited by all retained seeds.
  for (const binding of ["STAGING", "CONTROL"] as const) {
    const lost = await runInDurableObject(stub, async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, [binding]: bucketFault(original[binding], async (method, args, invoke) => {
        const result = await invoke();
        if (method === "put" && String(args[0]).startsWith("usage-admission/")) throw new Error("synthetic_lost_reply");
        return result;
      }) }));
      try { return await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: request.bytes }); }
      finally { restore(); }
    });
    model.pendingPhase = binding === "STAGING" ? 1 : 2; model.staged = 1; model.receipts = binding === "CONTROL" ? 1 : 0;
    trace.compare(binding === "STAGING" ? "lose-batch-reply" : "lose-journal-reply", { binding, device: firstIndex }, outcome(lost), "storage_unavailable", await observe(), model);
    await evictDurableObject(stub);
    trace.compare("reopen", { binding }, "ok", "ok", await observe(), model);
  }
  const committed = success(await stub.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: request.bytes }));
  const firstJournal = success(decodeAdmissionJournal(committed, request.bytes, ADMISSION_POLICY_V1));
  expect(firstJournal.status).toBe(1);
  model.revision = 1; model.pendingPhase = 0; model.head = admissionHex(request.operations[0].operationHash);
  model.sequences[firstIndex] = 1; model.journalStatus.push(1); model.receipts = 1;
  trace.compare("resume", { device: firstIndex }, "accepted", "accepted", await observe(), model);
  for (let replay = 0; replay < 1 + random(3); replay++) {
    const retried = success(await stub.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: request.bytes }));
    expect(retried).toEqual(committed);
    trace.compare("terminal-retry", { replay }, "accepted", "accepted", await observe(), model);
  }
  const conflicting = success(await stub.admitBatch({ uploadSecret: devices[otherIndex].proof.uploadSecret, batch: requests[otherIndex].bytes }));
  const rejected = success(decodeAdmissionJournal(conflicting, requests[otherIndex].bytes, ADMISSION_POLICY_V1));
  expect(rejected.receipts.map(item => item.outcome)).toEqual([5]);
  model.revision = 2; model.sequences[otherIndex] = 1; model.journalStatus.push(2); model.staged = 2; model.receipts = 2;
  trace.compare("predecessor-conflict", { device: otherIndex }, String(rejected.status), "2", await observe(), model);
  const wrongSecret = await stub.admitBatch({ uploadSecret: hex(999999), batch: request.bytes });
  trace.compare("invalid-secret", {}, outcome(wrongSecret), "unauthorized", await observe(), model);
  trace.finish(["lose-batch-reply:storage_unavailable", "lose-journal-reply:storage_unavailable", "reopen:ok", "resume:accepted", "terminal-retry:accepted", "predecessor-conflict:2", "invalid-secret:unauthorized"]);
});

async function activateStats(account: string, prepare = true): Promise<void> {
  await runInDurableObject(accountStub(account), async instance => {
    const owner = instance as unknown as { env: Env };
    const enabled = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1" };
    owner.env = enabled;
    if (prepare) success(await instance.maintainAccount({ schemaVersion: 1, accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" }));
  });
}
function statsRequest(account: string, device: Device, amount: number, fields: Partial<StatsUpload> = {}): StatsUpload {
  const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
    firstUtcDay: DAY, dayCount: 1, generatedAtMs: NOW, revision: 0, updatedAtMs: null,
    sources: [{ client: "codex", status: "observed", tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: NOW - 1 }],
    rows: [{ utcDay: DAY, client: "codex", provider: null, model: null,
      tokens: { input: String(amount), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
      records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" }] });
  if (!report) throw new Error("conformance_fixture:report");
  const request = parseStatsUpload({ schemaVersion: 2, operationId: hex(++serial + 10000), accountId: account,
    deviceId: admissionHex(device.id), generation: env.USAGE_ENROLLMENT_GENERATION, sequence: 1,
    expectedRevision: 0, mode: "replace-window", takeover: null, report, ...fields });
  if (!request) throw new Error("conformance_fixture:request"); return request;
}
const statsCharge = (request: StatsUpload) => new TextEncoder().encode(JSON.stringify(request)).byteLength + 1024;
const statsAbandon = (request: StatsUpload) => ({ schemaVersion: 2, accountId: request.accountId, deviceId: request.deviceId,
  generation: request.generation, operationId: request.operationId, sequence: request.sequence,
  expectedRevision: request.expectedRevision, bodyHash: statsHash(JSON.stringify(request)) });
async function statsImage(account: string) {
  return runInDurableObject(accountStub(account), (_instance, state) => ({
    revision: state.storage.sql.exec("SELECT revision FROM usage_stats_control").one().revision,
    charged: state.storage.sql.exec("SELECT immutable_bytes FROM usage_stats_control").one().immutable_bytes,
    pending: state.storage.sql.exec("SELECT body_hash FROM usage_stats_pending ORDER BY device_id").toArray().map(row => row.body_hash),
    days: state.storage.sql.exec("SELECT utc_day AS day, device_id AS device FROM usage_stats_days ORDER BY utc_day, device_id").toArray(),
    retired: state.storage.sql.exec("SELECT body_hash FROM usage_stats_retired ORDER BY body_hash").toArray().map(row => row.body_hash),
    values: state.storage.sql.exec("SELECT input_tokens FROM usage_stats_day_rows ORDER BY utc_day, device_id").toArray().map(row => row.input_tokens),
  }));
}

test.each(CONFORMANCE_SEEDS)("M4 generated A B A supersession retains charges and retires the predecessor seed=%i", async seed => {
  const account = accountId(), device = await enroll(account), stub = accountStub(account);
  await activateStats(account);
  const random = scheduleRandom(seed), first = statsRequest(account, device, 1 + random(100)), second = statsRequest(account, device, 200 + random(100));
  const trace = new ConformanceTrace("M4-abandon", seed);
  const model = { revision: 0, charged: 0, pending: [] as string[], days: [] as { day: number; device: string }[], retired: [] as string[], values: [] as string[] };
  const lost = await runInDurableObject(stub, async instance => {
    const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketFault(original.STAGING, async (method, _args, invoke) => {
      if (method === "put") throw new Error("synthetic_before_put"); return invoke();
    }) }));
    try { return await instance.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: first }); }
    finally { restore(); }
  });
  model.charged = statsCharge(first); model.pending = [statsHash(JSON.stringify(first))];
  trace.compare("reserve-failure", { operation: "A" }, outcome(lost), "storage_unavailable", await statsImage(account), model);
  // A newer body from the same device retires the uncertain predecessor and
  // publishes at the device's own next sequence; the predecessor's charge stays.
  const superseded = await stub.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: second });
  model.revision = 1; model.charged += statsCharge(second); model.pending = []; model.retired = [statsHash(JSON.stringify(first))];
  model.days = [{ day: DAY, device: second.deviceId }]; model.values = [second.report.rows[0].tokens!.input!];
  trace.compare("supersede", { operation: "B" }, outcome(superseded), "ok", await statsImage(account), model);
  const abandoned = await stub.abandonStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: statsAbandon(first) });
  trace.compare("abandon", { operation: "A" }, outcome(abandoned), "ok", await statsImage(account), model);
  const retryAbandon = await stub.abandonStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: statsAbandon(first) });
  trace.compare("abandon-retry", { operation: "A" }, outcome(retryAbandon), "ok", await statsImage(account), model);
  const replacement = { ...second, operationId: hex(++serial + 20000), sequence: 2, expectedRevision: 1 };
  const committed = await stub.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: replacement });
  model.revision = 2; model.charged += statsCharge(replacement);
  trace.compare("commit-replacement", { operation: "C", expectedRevision: 1 }, outcome(committed), "ok", await statsImage(account), model);
  for (const operation of scheduleShuffle(seed, ["A", "C", "A", "C", "A"])) {
    const result = await stub.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request: operation === "A" ? first : replacement });
    trace.compare("replay", { operation }, outcome(result), operation === "A" ? "conflict" : "ok", await statsImage(account), model);
  }
  trace.finish(["reserve-failure:storage_unavailable", "supersede:ok", "abandon:ok", "abandon-retry:ok",
    "commit-replacement:ok", "replay:conflict", "replay:ok"]);
});

test.each(CONFORMANCE_SEEDS)("M4 generated device partitions sum concurrent publishers and survive revocation seed=%i", async seed => {
  const account = accountId(), first = await enroll(account), second = await enroll(account), stub = accountStub(account);
  await activateStats(account);
  const random = scheduleRandom(seed), original = statsRequest(account, first, 10 + random(100));
  const stale = statsRequest(account, second, 200 + random(100), { expectedRevision: 0 });
  const trace = new ConformanceTrace("M4-devices", seed);
  const model = { revision: 1, charged: statsCharge(original), pending: [] as string[],
    days: [{ day: DAY, device: original.deviceId }], retired: [] as string[], values: [original.report.rows[0].tokens!.input!] };
  const committed = await stub.admitStatsSnapshot({ uploadSecret: first.proof.uploadSecret, request: original });
  trace.compare("commit", { device: "A" }, outcome(committed), "ok", await statsImage(account), model);
  // B publishes with the revision it saw before A committed; its receipt keeps
  // that expectation while the account revision still advances.
  const concurrent = await stub.admitStatsSnapshot({ uploadSecret: second.proof.uploadSecret, request: stale });
  model.revision = 2; model.charged += statsCharge(stale);
  model.days = [{ day: DAY, device: original.deviceId }, { day: DAY, device: stale.deviceId }].sort((a, b) => a.device < b.device ? -1 : 1);
  model.values = model.days.map(day => day.device === original.deviceId ? original.report.rows[0].tokens!.input! : stale.report.rows[0].tokens!.input!);
  trace.compare("stale-revision", { device: "B", expectedRevision: 0 }, outcome(concurrent), "ok", await statsImage(account), model);
  const earlier = statsRequest(account, second, 300 + random(100), { sequence: 2, expectedRevision: 2, report: { ...stale.report, firstUtcDay: DAY - 1,
    sources: [{ ...stale.report.sources[0], latestAtMs: (DAY - 1) * DAY_MS + 1 }], rows: [{ ...stale.report.rows[0], utcDay: DAY - 1 }] } });
  const next = await stub.admitStatsSnapshot({ uploadSecret: second.proof.uploadSecret, request: earlier });
  model.revision = 3; model.charged += statsCharge(earlier);
  model.days = [{ day: DAY - 1, device: earlier.deviceId }, ...model.days]; model.values = [earlier.report.rows[0].tokens!.input!, ...model.values];
  trace.compare("second-device", { device: "B", sequence: 2 }, outcome(next), "ok", await statsImage(account), model);
  const query = { schemaVersion: 2, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY, dayCount: 1 };
  const read = await stub.readUsageStats(query);
  const summed = String(BigInt(original.report.rows[0].tokens!.input!) + BigInt(stale.report.rows[0].tokens!.input!));
  expect(success(read).rows).toHaveLength(1); expect(success(read).rows[0].tokens.input).toBe(summed);
  trace.compare("read", { summed }, outcome(read), "ok", await statsImage(account), model);
  const revoked = await stub.revokeEnrollment(first.proof);
  trace.compare("revoke", { device: "A" }, outcome(revoked), "ok", await statsImage(account), model);
  const late = await stub.admitStatsSnapshot({ uploadSecret: first.proof.uploadSecret, request: { ...original, sequence: 2, expectedRevision: 3 } });
  trace.compare("old-device", { device: "A" }, outcome(late), "revoked", await statsImage(account), model);
  trace.finish(["commit:ok", "stale-revision:ok", "second-device:ok", "read:ok", "revoke:ok", "old-device:revoked"]);
});

test.each(CONFORMANCE_SEEDS)("M4 generated foreign legacy history is preserved beside a local snapshot seed=%i", async seed => {
  const account = accountId(), predecessor = await enroll(account), successor = await enroll(account), stub = accountStub(account);
  const random = scheduleRandom(seed), legacyTokens = 120 + random(100), replacementTokens = 1 + random(15), ownTokens = 200 + random(50);
  const batch = admission(account, predecessor, legacyTokens);
  success(await stub.admitBatch({ uploadSecret: predecessor.proof.uploadSecret, batch: batch.bytes }));
  await activateStats(account);
  const request = statsRequest(account, successor, replacementTokens), trace = new ConformanceTrace("M4-overlap", seed);
  const query = { schemaVersion: 2, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY, dayCount: 1 };
  const observe = async () => {
    const legacy = success(await stub.readImportedDays({ schemaVersion: 1, accountId: account,
      sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY, dayCount: 1 }));
    const stats = await statsImage(account), combined = await stub.readUsageStats(query);
    return { legacyTokens: legacy.days[0].codex.observedAccountedTokens, combined: combined.ok ? combined.value.rows[0]?.tokens.input ?? null : combined.error,
      revision: stats.revision, pending: stats.pending, days: stats.days, snapshots: (await env.STAGING.list({ prefix: "usage-stats/v2/" })).objects.length };
  };
  const model = { legacyTokens: String(legacyTokens), combined: "not_started" as string, revision: 0, pending: [] as string[], days: [] as { day: number; device: string }[], snapshots: 0 };
  trace.compare("legacy-commit", { legacyTokens }, "ok", "ok", await observe(), model);
  // A different device's snapshot adds to the retained foreign heads: 120 and
  // 15 report 135, and nothing is hidden.
  const foreign = await stub.admitStatsSnapshot({ uploadSecret: successor.proof.uploadSecret, request });
  model.revision = 1; model.days = [{ day: DAY, device: request.deviceId }]; model.snapshots = 1; model.combined = String(legacyTokens + replacementTokens);
  trace.compare("foreign-snapshot", { replacementTokens }, outcome(foreign), "ok", await observe(), model);
  // The head's own device publishing a snapshot for that client and day
  // shadows exactly its own heads; the foreign snapshot still counts.
  const own = statsRequest(account, predecessor, ownTokens, { expectedRevision: 1 });
  const shadowed = await stub.admitStatsSnapshot({ uploadSecret: predecessor.proof.uploadSecret, request: own });
  model.revision = 2; model.days = [{ day: DAY, device: own.deviceId }, { day: DAY, device: request.deviceId }].sort((a, b) => a.device < b.device ? -1 : 1);
  model.snapshots = 2; model.combined = String(ownTokens + replacementTokens);
  trace.compare("own-snapshot", { ownTokens }, outcome(shadowed), "ok", await observe(), model);
  trace.compare("legacy-read", {}, "ok", "ok", await observe(), model);
  trace.finish(["legacy-commit:ok", "foreign-snapshot:ok", "own-snapshot:ok", "legacy-read:ok"]);
});

test.each(CONFORMANCE_SEEDS)("M7 generated pure reads and fenced derived rebuild seed=%i", async seed => {
  const account = accountId(), device = await enroll(account), stub = accountStub(account);
  await activateStats(account);
  const amount = 10 + scheduleRandom(seed)(100), request = statsRequest(account, device, amount);
  success(await stub.admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request }));
  const trace = new ConformanceTrace("M7", seed);
  const image = async () => runInDurableObject(stub, (_instance, state) => ({
    schema: state.storage.sql.exec("SELECT schema_version FROM account_enrollment").one().schema_version,
    revision: state.storage.sql.exec("SELECT revision FROM usage_stats_control").one().revision,
    canonical: state.storage.sql.exec("SELECT projection FROM usage_stats_days").one().projection,
    metadata: state.storage.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_day_meta").one().count,
    rows: state.storage.sql.exec("SELECT input_tokens FROM usage_stats_day_rows").toArray().map(row => row.input_tokens),
    totals: state.storage.sql.exec("SELECT client, utc_day, device_id, records FROM usage_stats_day_totals").toArray(),
  }));
  const baseline = await image(), model = structuredClone(baseline);
  const query = { schemaVersion: 2, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY, dayCount: 1 };
  for (let read = 0; read < 1 + scheduleRandom(seed)(3); read++) {
    const result = await stub.readUsageStats(query); expect(success(result).rows[0].tokens?.input).toBe(String(amount));
    trace.compare("read", { read }, outcome(result), "ok", await image(), model);
  }
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("DELETE FROM usage_stats_day_rows"); state.storage.sql.exec("DELETE FROM usage_stats_day_meta");
  });
  model.metadata = 0; model.rows = [];
  trace.compare("drop-derived-fixture", {}, "ok", "ok", await image(), model);
  await evictDurableObject(stub); await activateStats(account, false);
  trace.compare("reopen", {}, "ok", "ok", await image(), model);
  const fallback = await stub.readUsageStats(query); expect(success(fallback).rows[0].tokens?.input).toBe(String(amount));
  trace.compare("read-fallback", {}, outcome(fallback), "ok", await image(), model);
  const maintain = { schemaVersion: 1, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" };
  const rebuilt = await stub.maintainAccount(maintain); model.metadata = baseline.metadata; model.rows = baseline.rows;
  trace.compare("prepare", {}, outcome(rebuilt), "ok", await image(), model);
  success(await env.RESTORE_FENCES.getByName(restoreFenceName(account)).close({ accountId: account,
    generation: env.USAGE_ENROLLMENT_GENERATION, epoch: 0, workerVersion: env.USAGE_WORKER_VERSION }));
  const closed = await stub.maintainAccount(maintain);
  trace.compare("closed-maintenance", {}, outcome(closed), "recovery_required", await image(), model);
  trace.finish(["read:ok", "drop-derived-fixture:ok", "reopen:ok", "read-fallback:ok", "prepare:ok", "closed-maintenance:recovery_required"]);
});

test.each(CONFORMANCE_SEEDS)("M7 full scrub ignores a cached audit stamp seed=%i", async seed => {
  const account = accountId(), devices = [await enroll(account), await enroll(account)], stub = accountStub(account);
  for (const index of scheduleShuffle(seed, [0, 1])) success(await stub.admitBatch({ uploadSecret: devices[index].proof.uploadSecret,
    batch: admission(account, devices[index], 10 + index, index + 1).bytes }));
  const maintain = { schemaVersion: 1, accountId: account, generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" };
  success(await stub.maintainAccount(maintain));
  const image = async () => runInDurableObject(stub, (_instance, state) => ({
    revision: state.storage.sql.exec("SELECT published_revision FROM usage_admission_control").one().published_revision,
    audit: state.storage.sql.exec("SELECT revision FROM usage_admission_audit").one().revision,
    heads: state.storage.sql.exec("SELECT COUNT(*) AS count FROM usage_admission_heads").one().count,
    oldJournalValid: state.storage.sql.exec("SELECT batch, journal FROM usage_admission_journal WHERE revision = 1").toArray()
      .every(row => decodeAdmissionJournal(new Uint8Array(row.journal as ArrayBuffer), new Uint8Array(row.batch as ArrayBuffer), ADMISSION_POLICY_V1).ok),
  }));
  const trace = new ConformanceTrace("M7-scrub", seed), model = { revision: 2, audit: 2, heads: 2, oldJournalValid: true };
  trace.compare("prepare", {}, "ok", "ok", await image(), model);
  await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec(
    "UPDATE usage_admission_journal SET journal = zeroblob(length(journal)) WHERE revision = 1"));
  model.oldJournalValid = false;
  trace.compare("corrupt-old-authority-fixture", {}, "ok", "ok", await image(), model);
  const cached = await stub.maintainAccount(maintain);
  trace.compare("checkpoint-extension", {}, outcome(cached), "ok", await image(), model);
  const scrub = await stub.maintainAccount({ ...maintain, operation: "scrub" });
  trace.compare("full-scrub", {}, outcome(scrub), "storage_invalid", await image(), model);
  trace.finish(["prepare:ok", "corrupt-old-authority-fixture:ok", "checkpoint-extension:ok", "full-scrub:storage_invalid"]);
});

test.each(CONFORMANCE_SEEDS)("M5 generated browser attempt and account replacement schedules seed=%i", async seed => {
  const random = scheduleRandom(seed), accounts = [accountId(), accountId()], selected = random(2), account = accounts[selected];
  const id = ++serial, intentId = hex(id), pollSecret = hex(id + 1_000_000), uploadSecret = hex(id + 2_000_000), browserNonce = hex(id + 3_000_000);
  const pairing = env.PAIRINGS.getByName(intentId), trace = new ConformanceTrace("M5-pairing", seed);
  success(await pairing.initialize({ intentId, pollSecret, uploadCommitment: success(await uploadSecretCommitment(intentId, uploadSecret)) }));
  const model = { state: "pending", attempts: 0, authenticatedAccount: null as string | null, approved: null as string | null, reserved: false };
  const observe = async () => runInDurableObject(pairing, (_instance, state) => {
    const retained = JSON.parse(String(state.storage.sql.exec("SELECT payload FROM pairing_state").one().payload)) as {
      status: string; browserAttempts: number; attempt: { authentication: { accountId: string } | null } | null;
      approvedAccountId: string | null; enrollment: unknown;
    };
    return { state: retained.status, attempts: retained.browserAttempts, authenticatedAccount: retained.attempt?.authentication?.accountId ?? null,
      approved: retained.approvedAccountId, reserved: retained.enrollment !== null };
  });
  const begin = async () => {
    const result = success(await pairing.beginBrowserAttempt({ intentId, browserNonce })); model.attempts++; model.authenticatedAccount = null;
    trace.compare("new-attempt", {}, "ok", "ok", await observe(), model);
    return { intentId, browserNonce, attemptId: result.attemptId, contextToken: result.contextToken };
  };
  const first = await begin();
  // Replacing an unapproved browser attempt invalidates its sealed capability.
  // Once fresh authentication records, the browser is already approved.
  const second = await begin();
  for (const command of scheduleShuffle(seed, ["stale-attempt", "unverified-attempt"])) {
    const result = await pairing.decideBrowser({ ...(command === "stale-attempt" ? first : second), accountId: account,
      liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" });
    trace.compare(command, {}, outcome(result), command === "stale-attempt" ? "unauthorized" : "invalid_transition", await observe(), model);
  }
  const oldAuthentication = await pairing.recordVerifiedAuthentication({ ...first, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS });
  trace.compare("old-authentication", {}, outcome(oldAuthentication), "unauthorized", await observe(), model);
  const fresh = await pairing.recordVerifiedAuthentication({ ...second, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS });
  model.authenticatedAccount = account; model.state = "browser-approved"; model.approved = account;
  trace.compare("authenticate-approves", { account: selected }, outcome(fresh), "ok", await observe(), model);
  const replaceApproved = await pairing.beginBrowserAttempt({ intentId, browserNonce });
  trace.compare("replace-approved-attempt", {}, outcome(replaceApproved), "invalid_transition", await observe(), model);
  const foreign = await pairing.decideBrowser({ ...second, accountId: accounts[1 - selected], liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" });
  trace.compare("foreign-account", {}, outcome(foreign), "unauthorized", await observe(), model);
  const approved = await pairing.decideBrowser({ ...second, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" });
  trace.compare("approval-readback", { account: selected }, outcome(approved), "ok", await observe(), model);
  const confirmed = await pairing.confirm({ intentId, pollSecret, accountId: account }); model.state = "terminal-confirmed";
  trace.compare("confirm", { account: selected }, outcome(confirmed), "ok", await observe(), model);
  const reserved = await pairing.reserveEnrollment({ intentId, pollSecret, uploadSecret }); model.reserved = true;
  trace.compare("reserve-enrollment", {}, outcome(reserved), "ok", await observe(), model);
  const beforeRead = await observe();
  success(await pairing.browserStatus(second));
  trace.compare("status-read", {}, "ok", "ok", await observe(), beforeRead);
  trace.finish(["new-attempt:ok", "stale-attempt:unauthorized", "unverified-attempt:invalid_transition", "old-authentication:unauthorized",
    "authenticate-approves:ok", "replace-approved-attempt:invalid_transition", "foreign-account:unauthorized", "approval-readback:ok", "confirm:ok", "reserve-enrollment:ok", "status-read:ok"]);
});

test.each(CONFORMANCE_SEEDS)("M6 generated delayed grants cannot resurrect delivered withdrawals seed=%i", async seed => {
  const accounts = [accountId(), accountId()], order = scheduleShuffle(seed, [0, 1]);
  for (const account of accounts) await enroll(account);
  const index = env.PUBLIC_INDEX.getByName(LEADERBOARD_INDEX_NAME), trace = new ConformanceTrace("M6", seed);
  const handles = ["conformance-alpha", "conformance-bravo"], victim = order[0];
  const model = { members: [] as { account: number; event: number; handle: string }[], tombstones: [] as { account: number; event: number }[] };
  const project = (sql: SqlStorage) => {
    const row = sql.exec("SELECT payload FROM leaderboard_index").one();
    const retained = JSON.parse(String(row.payload)) as { members: { accountId: string; eventAtMs: number; publicHandle: string }[];
      tombstones: { accountId: string; eventAtMs: number }[] };
    return { members: retained.members.map(member => ({ account: accounts.indexOf(member.accountId), event: member.eventAtMs - NOW, handle: member.publicHandle })).sort((a, b) => a.account - b.account),
      tombstones: retained.tombstones.map(item => ({ account: accounts.indexOf(item.accountId), event: item.eventAtMs - NOW })).sort((a, b) => a.account - b.account) };
  };
  const observe = () => runInDurableObject(index, (_instance, state) => project(state.storage.sql));
  for (const selected of order) {
    const result = await accountStub(accounts[selected]).setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: accounts[selected],
      sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: true, publicHandle: handles[selected] });
    model.members.push({ account: selected, event: 0, handle: handles[selected] }); model.members.sort((a, b) => a.account - b.account);
    trace.compare("grant", { account: selected }, outcome(result), "ok", await observe(), model);
  }
  const hint = { schemaVersion: 1, accountId: accounts[victim], consent: true, publicHandle: handles[victim], consentedAtMs: NOW, eventAtMs: NOW };
  await runInDurableObject(index, async (instance, state) => {
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>(); let intercepted = false;
    const restore = replaceEnvironment(instance, original => ({ ...original, ACCOUNT_ENROLLMENTS: { getByName(name: string) { return {
      async readLeaderboardDelivery(input: unknown) {
        const result = await original.ACCOUNT_ENROLLMENTS.getByName(name).readLeaderboardDelivery(input);
        if (name === enrollmentAccountName(accounts[victim]) && !intercepted) { intercepted = true; entered.resolve(); await resume.promise; }
        return result;
      },
    }; } } as unknown as Env["ACCOUNT_ENROLLMENTS"] }));
    const pending = instance.applyConsent(hint);
    try {
      await entered.promise;
      trace.compare("source-reply-paused", { account: victim }, "pending", "pending", project(state.storage.sql), model);
      const fence = env.RESTORE_FENCES.getByName(restoreFenceName(accounts[victim]));
      expect(success(await fence.read({ accountId: accounts[victim], generation: env.USAGE_ENROLLMENT_GENERATION })).inFlight).toBe(1);
      vi.setSystemTime(NOW + 1 + scheduleRandom(seed)(10));
      const event = Date.now() - NOW;
      const withdrawn = await accountStub(accounts[victim]).setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId: accounts[victim],
        sessionExpiresAtMs: NOW + PAIRING_TTL_MS, consent: false, publicHandle: null });
      model.members = model.members.filter(item => item.account !== victim); model.tombstones = [{ account: victim, event }];
      trace.compare("withdraw", { account: victim, event }, outcome(withdrawn), "ok", project(state.storage.sql), model);
      resume.resolve(); const stale = await pending;
      trace.compare("resume-old-delivery", { account: victim }, outcome(stale), "storage_unavailable", project(state.storage.sql), model);
      expect(success(await fence.read({ accountId: accounts[victim], generation: env.USAGE_ENROLLMENT_GENERATION })).inFlight).toBe(0);
    } finally { resume.resolve(); await pending; restore(); }
  });
  for (let retry = 0; retry < 1 + scheduleRandom(seed)(3); retry++) {
    const stale = await index.applyConsent(hint);
    trace.compare("old-hint-retry", { retry }, outcome(stale), "recovery_required", await observe(), model);
  }
  const before = await observe(), served = success(await index.read({ schemaVersion: 1 }));
  expect(served.entries.map(item => item.publicHandle)).toEqual([handles[1 - victim]]);
  trace.compare("public-read", {}, "ok", "ok", await observe(), before);
  trace.finish(["grant:ok", "source-reply-paused:pending", "withdraw:ok", "resume-old-delivery:storage_unavailable", "old-hint-retry:recovery_required", "public-read:ok"]);
});

test.each(CONFORMANCE_SEEDS)("M1 generated restore registration schedules seed=%i", async seed => {
  const account = accountId(), generation = hex(seed), fence = env.RESTORE_FENCES.getByName(restoreFenceName(account));
  const authority = { accountId: account, generation, epoch: 0, workerVersion: env.USAGE_WORKER_VERSION };
  const ids = [hex(101), hex(102)], order = scheduleShuffle(seed, [0, 1]), random = scheduleRandom(seed);
  const trace = new ConformanceTrace("M1", seed);
  const model = { epoch: 0, phase: "open", established: false, live: [] as number[], terminal: [] as number[] };
  const observe = async () => {
    const view = success(await fence.read({ accountId: account, generation }));
    const rows = await runInDurableObject(fence, (_instance, state) => state.storage.sql.exec(
      "SELECT lower(hex(attempt_id)) AS id, terminal FROM fence_attempt ORDER BY attempt_id").toArray());
    return { epoch: view.record?.epoch, phase: view.record?.phase, established: view.record?.established,
      live: rows.flatMap(row => row.terminal === 0 ? [ids.indexOf(String(row.id))] : []),
      terminal: rows.flatMap(row => row.terminal === 1 ? [ids.indexOf(String(row.id))] : []) };
  };
  const check = async (command: string, input: unknown, result: { ok: true } | { ok: false; error: string }, expectedOutcome = "ok") =>
    trace.compare(command, input, outcome(result), expectedOutcome, await observe(), model);
  // Persistence succeeds even when the caller discards the first grant reply.
  for (const index of order) {
    const result = await fence.assertOpen({ ...authority, attemptId: ids[index], leaseMs: 1 });
    model.live.push(index); model.live.sort();
    await check("grant-lost-reply", { attempt: index }, result);
  }
  vi.setSystemTime(NOW + 60_000);
  await check("diagnostic-deadline", { advanceMs: 60_000 }, await fence.read({ accountId: account, generation }));
  const closed = await fence.close(authority); model.phase = "closed";
  await check("close", {}, closed);
  await check("publish", { epoch: 1 }, await fence.publish({ ...authority, epoch: 1 }), "recovery_required");
  for (const index of order) {
    await check("grant-readback", { attempt: index }, await fence.assertOpen({ ...authority, attemptId: ids[index], leaseMs: 1 }));
    const committed = random(2) === 1;
    const released = await fence.release({ accountId: account, token: ids[index], committed });
    model.live = model.live.filter(item => item !== index); model.terminal.push(index); model.terminal.sort();
    model.established ||= committed;
    await check("release-lost-reply", { attempt: index, committed }, released);
    await check("release-readback", { attempt: index, committed }, await fence.release({ accountId: account, token: ids[index], committed }));
    await check("terminal-reacquire", { attempt: index }, await fence.assertOpen({ ...authority, attemptId: ids[index], leaseMs: 1 }), "conflict");
    if (model.live.length) await check("publish", { epoch: 1 }, await fence.publish({ ...authority, epoch: 1 }), "recovery_required");
  }
  const published = await fence.publish({ ...authority, epoch: 1 }); model.epoch = 1; model.phase = "open";
  await check("publish", { epoch: 1 }, published);
  await check("publish-readback", { epoch: 1 }, await fence.publish({ ...authority, epoch: 1 }));
  await check("old-epoch-grant", { epoch: 0 }, await fence.assertOpen({ ...authority, attemptId: hex(103), leaseMs: 1 }), "recovery_required");
  trace.finish(["grant-lost-reply:ok", "diagnostic-deadline:ok", "publish:recovery_required", "grant-readback:ok",
    "release-readback:ok", "terminal-reacquire:conflict", "publish:ok", "old-epoch-grant:recovery_required"]);
});

test.each(CONFORMANCE_SEEDS)("M1 reordered cancellation prevents a lost grant from reviving seed=%i", async seed => {
  const account = accountId(), generation = hex(seed), fence = env.RESTORE_FENCES.getByName(restoreFenceName(account));
  const request = { accountId: account, generation, epoch: 0, workerVersion: env.USAGE_WORKER_VERSION, attemptId: hex(9) };
  const trace = new ConformanceTrace("M1-cancel", seed), granted = scheduleRandom(seed)(2) === 1;
  if (granted) success(await fence.assertOpen({ ...request, leaseMs: 1 }));
  const observe = async () => {
    const value = success(await fence.read({ accountId: account, generation }));
    return { inFlight: value.inFlight, established: value.record?.established };
  };
  for (const command of ["cancel", "cancel-retry", "late-grant", "release-conflict"] as const) {
    const result = command === "cancel" || command === "cancel-retry" ? await fence.cancelAcquire(request)
      : command === "late-grant" ? await fence.assertOpen({ ...request, leaseMs: 1 })
        : await fence.release({ accountId: account, token: request.attemptId, committed: true });
    trace.compare(command, { granted }, outcome(result), command.startsWith("cancel") ? "ok" : "conflict",
      await observe(), { inFlight: 0, established: false });
  }
  trace.finish(["cancel:ok", "cancel-retry:ok", "late-grant:conflict", "release-conflict:conflict"]);
});

/** Activates the canonical contribution profile for one synthetic account, admits one seeded observation and
 * publishes projection revision 3, mirroring the rebuild integration fixture. Alarms are removed afterwards so
 * the generated rebuild schedule is the only remaining work. */
async function contributionAccount(account: string, device: Device, tokens: number): Promise<void> {
  const stub = accountStub(account), deviceId = admissionHex(device.id), generation = env.USAGE_ENROLLMENT_GENERATION;
  const population = hex(5), operation = () => hex(++serial);
  await runInDurableObject(stub, instance => { replaceEnvironment(instance, original => ({ ...original, AICHARTS_USAGE_STATS_ENABLED: "1",
    AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env)); });
  success(await stub.activateContributions({ uploadSecret: device.proof.uploadSecret, request: {
    schemaVersion: 3, accountId: account, generation, deviceId, operationId: operation(), expectedRevision: 0, mode: "fresh-empty" } }));
  success(await stub.grantContributionPopulation({ uploadSecret: device.proof.uploadSecret, request: {
    schemaVersion: 3, accountId: account, generation, deviceId, operationId: operation(), populationId: population, expectedRevision: 1,
    expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
  success(await stub.admitContributions({ uploadSecret: device.proof.uploadSecret, request: {
    schemaVersion: 3, accountId: account, generation, deviceId, operationId: operation(), profile: CONTRIBUTION_PROFILE,
    identityScheme: CONTRIBUTION_IDENTITY, grain: "observation", sequence: 1, expectedRevision: 2, populationId: population, writerRevision: 1,
    expectedPopulationRevision: 0, expectedPopulationHead: "0".repeat(64), replacement: null,
    mutations: [{ kind: "put", id: hex(1, 16), expectedHeadHash: null, row: {
      utcDay: DAY, client: "codex", provider: null, model: null, records: 1,
      tokens: { input: String(tokens), cacheRead: "0", cacheWrite: "0", output: "9", reasoning: "0" },
      reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" } }] } }));
  for (let step = 1; step <= 12; step++) {
    vi.setSystemTime(NOW + step * 16_000);
    const result = success(await stub.advanceContributionProjection({ schemaVersion: 3, accountId: account, generation }));
    if (result.publishedRevision === 3) break;
  }
  await runInDurableObject(stub, async (_instance, state) => {
    expect(new ContributionProjectionState(state.storage).status(Date.now()).publishedRevision).toBe(3);
    await state.storage.deleteAlarm();
  });
}

test.each(CONFORMANCE_SEEDS)("M11 generated rebuild step retries replay exact receipts without new charge seed=%i", async seed => {
  const account = accountId(), device = await enroll(account), stub = accountStub(account), random = scheduleRandom(seed);
  await contributionAccount(account, device, 7 + random(100));
  const generation = env.USAGE_ENROLLMENT_GENERATION, jobId = hex(99);
  const read: ContributionRebuildReadRequest = { schemaVersion: 3, accountId: account, generation, jobId };
  const beginRequest = { ...read, action: "begin" as const, expectedVersion: 0 as const, expectedRevision: 3 };
  const advance = (expectedVersion: number) => ({ ...read, action: "advance" as const, expectedVersion });
  const trace = new ConformanceTrace("M11", seed);
  const image = async () => runInDurableObject(stub, async (_instance, state) => {
    const projection = new ContributionProjectionState(state.storage).control();
    // The rebuild job table is created by the first begin (schema 13); before that the image records its absence.
    const present = state.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='usage_contribution_rebuild_jobs'").toArray().length === 1;
    return { schema: state.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id=1").one().schema_version,
      jobs: present ? state.storage.sql.exec("SELECT id, version FROM usage_contribution_rebuild_jobs ORDER BY id").toArray()
        .map(row => ({ id: row.id, version: row.version })) : null,
      publishedRevision: projection.publishedRevision, publishedRoot: projection.publishedRoot, charged: projection.immutableBytes,
      objects: (await env.STAGING.list()).objects.length };
  });
  const baseline = await image(), model = { ...baseline, jobs: null as { id: unknown; version: unknown }[] | null };
  expect(baseline.publishedRevision).toBe(3);
  const receipts: Record<string, ContributionRebuildReceipt> = {};
  const compare = async (command: string, input: unknown, result: { ok: true; value: ContributionRebuildReceipt } | { ok: false; error: string },
    expectedOutcome: string, expectedReceipt?: ContributionRebuildReceipt) => {
    if (expectedReceipt && result.ok) expect(result.value).toEqual(expectedReceipt);
    trace.compare(command, input, outcome(result), expectedOutcome, await image(), model);
    if (result.ok) receipts[command] = result.value;
  };
  // Each state image is taken after the command, so the model moves before the comparison.
  const begun = await stub.executeContributionRebuild(beginRequest);
  model.jobs = [{ id: jobId, version: 1 }]; model.schema = 13;
  await compare("begin", {}, begun, "ok");
  const initial = receipts.begin;
  expect(initial).toMatchObject({ version: 1, phase: "building", sourceRevision: 3, processedHeads: 0, chargedBytes: 0 });
  trace.compare("begin-state", {}, "ok", "ok", await image(), model);
  for (let replay = 0; replay < random(3); replay++) await compare("begin-replay", { replay }, await stub.executeContributionRebuild(beginRequest), "ok", initial);
  const stepped = await stub.executeContributionRebuild(advance(1));
  expect(stepped.ok && stepped.value.chargedBytes).toBeGreaterThan(0);
  // The rebuilt stage is content-addressed and equals the published index, so the object count never moves
  // while the reservation is still charged to the projection.
  model.jobs = [{ id: jobId, version: 2 }];
  if (stepped.ok) model.charged = baseline.charged + stepped.value.chargedBytes;
  await compare("head-step", {}, stepped, "ok");
  const first = receipts["head-step"];
  expect(first).toMatchObject({ version: 2, phase: "comparing", processedHeads: 1, liveHeads: 1 });
  trace.compare("head-step-state", {}, "ok", "ok", await image(), model);
  for (let retry = 0; retry < 1 + random(3); retry++) await compare("head-step-retry", { retry }, await stub.executeContributionRebuild(advance(1)), "ok", first);
  await evictDurableObject(stub);
  await runInDurableObject(stub, instance => { replaceEnvironment(instance, original => ({ ...original, AICHARTS_USAGE_STATS_ENABLED: "1",
    AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env)); });
  await compare("reopen-retry", {}, await stub.executeContributionRebuild(advance(1)), "ok", first);
  // A begin for the same job binds its source revision: any other expected revision conflicts at every version.
  await compare("stale-begin", { expectedRevision: 2 }, await stub.executeContributionRebuild({ ...beginRequest, expectedRevision: 2 }), "conflict");
  const compared = await stub.executeContributionRebuild(advance(2));
  model.jobs = [{ id: jobId, version: 3 }];
  await compare("comparison", {}, compared, "ok");
  const matched = receipts.comparison;
  expect(matched).toMatchObject({ version: 3, phase: "match", checkedCells: 1, sourceRevision: 3, chargedBytes: first.chargedBytes });
  trace.compare("comparison-state", {}, "ok", "ok", await image(), model);
  for (const command of scheduleShuffle(seed, ["comparison-retry", "old-version", "future-version", "begin-replay", "status"])) {
    if (command === "status") {
      const status = await stub.readContributionRebuild(read);
      if (status.ok) expect(status.value).toEqual({ receipt: matched, pending: false, chargedBytes: first.chargedBytes, readiness: "unobserved" });
      trace.compare(command, {}, outcome(status), "ok", await image(), model);
    } else if (command === "comparison-retry") await compare(command, {}, await stub.executeContributionRebuild(advance(2)), "ok", matched);
    else if (command === "old-version") await compare(command, {}, await stub.executeContributionRebuild(advance(1)), "conflict");
    else if (command === "future-version") await compare(command, {}, await stub.executeContributionRebuild(advance(3)), "conflict");
    else await compare(command, {}, await stub.executeContributionRebuild(beginRequest), "ok", initial);
  }
  trace.finish(["begin:ok", "begin-state:ok", "head-step:ok", "head-step-state:ok", "head-step-retry:ok", "reopen-retry:ok", "stale-begin:conflict",
    "comparison:ok", "comparison-state:ok", "comparison-retry:ok", "old-version:conflict", "future-version:conflict", "begin-replay:ok", "status:ok"]);
});
