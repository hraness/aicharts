/* Shared synthetic fixture for the Phase 10 lifecycle tests. It is not a
 * test file (no `.worker.ts` suffix); each lifecycle-*.worker.ts imports it. */
import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { expect, vi } from "vitest";
import { AccountEnrollment } from "../src/enrollment";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { restoreFenceName } from "../src/restore-fence";
import { LEADERBOARD_INDEX_NAME } from "../../../lib/usage/leaderboard-contract";
import { parseStatsUpload, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import { parseUsageStatsReport } from "../../../lib/usage/stats-contract";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { decodeAdmissionBatch, encodeAdmissionBatch, encodeAdmissionOperation } from "../../../lib/usage/admission";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { parseUsageLifecycleValue, type UsageLifecycleOperationInput, type UsageLifecycleValue } from "../../../lib/usage/lifecycle-contract";

export const NOW = Math.ceil(Date.now() / DAY_MS) * DAY_MS + DAY_MS / 2, DAY = Math.floor(NOW / DAY_MS);
export const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
export const fixture = { serial: 0, account: "", intent: 0 };
export const account = () => fixture.account;
export const stub = (id = fixture.account) => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(id));
export const fence = (id = fixture.account) => env.RESTORE_FENCES.getByName(restoreFenceName(id));
export const index = () => env.PUBLIC_INDEX.getByName(LEADERBOARD_INDEX_NAME);
export const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic fixture: ${result.error}`);
  expect(result).toMatchObject({ ok: true });
  return result.value;
};
export function beforeEachLifecycle(): void {
  fixture.account = `acct_${hex(++fixture.serial, 16)}`; fixture.intent = fixture.serial * 100;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
}
export async function afterEachLifecycle(): Promise<void> {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(object => object.key);
    if (keys.length) await bucket.delete(keys);
  }
  await reset();
}
export type Device = { proof: EnrollmentProof; id: Uint8Array; deviceId: string };
async function prepare(id: string): Promise<EnrollmentProof> {
  const intent = ++fixture.intent;
  const proof = { intentId: hex(intent), pollSecret: hex(intent + 1_000_000), uploadSecret: hex(intent + 2_000_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), nonce = hex(intent + 3_000_000);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: nonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: nonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: id, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: id, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: id }));
  success(await pairing.reserveEnrollment(proof)); return proof;
}
export async function enroll(id = fixture.account): Promise<Device> {
  const proof = await prepare(id);
  const deviceId = success(await stub(id).enroll(proof)).receipt.deviceId;
  return { proof, id: admissionIdBytes(deviceId), deviceId };
}
/** Enable the stats feature for this account object and prepare its tables. */
export async function activateStats(id = fixture.account) {
  await runInDurableObject(stub(id), async (instance, state) => {
    const owner = instance as unknown as { env: Env }, updated = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1" };
    new AccountEnrollment(state, updated);
    owner.env = updated;
    success(await instance.maintainAccount({ schemaVersion: 1, accountId: id, generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" }));
  });
}
export function statsRequest(device: Device, fields: Partial<StatsUpload> = {}, id = fixture.account): StatsUpload {
  const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
    firstUtcDay: DAY, dayCount: 1, generatedAtMs: NOW, revision: 0, updatedAtMs: null,
    sources: [{ client: "codex", status: "observed", tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: NOW - 1 }],
    rows: [{ utcDay: DAY, client: "codex", provider: null, model: null, tokens: { input: "10", cacheRead: "2", cacheWrite: "3", output: "4", reasoning: "1" },
      records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" }] });
  if (!report) throw new Error("fixture_report");
  const parsed = parseStatsUpload({ schemaVersion: 2, operationId: hex(10000 + ++fixture.intent), accountId: id,
    deviceId: device.deviceId, generation: env.USAGE_ENROLLMENT_GENERATION,
    sequence: 1, expectedRevision: 0, mode: "replace-window", takeover: null, report, ...fields });
  if (!parsed) throw new Error("fixture_upload"); return parsed;
}
export const statsUpload = (device: Device, request: StatsUpload, id = fixture.account) =>
  stub(id).admitStatsSnapshot({ uploadSecret: device.proof.uploadSecret, request });
export const session = (id = fixture.account, sessionExpiresAtMs = NOW + PAIRING_TTL_MS) =>
  ({ schemaVersion: 1 as const, accountId: id, sessionExpiresAtMs });
export const grant = (handle: string, id = fixture.account) =>
  ({ ...session(id), operation: "set" as const, consent: true, publicHandle: handle });
export const initializeIndex = (id = fixture.account) => index().applyConsent({ schemaVersion: 1, accountId: id, consent: false,
  publicHandle: null, consentedAtMs: null, eventAtMs: 0 });
export const indexState = () => runInDurableObject(index(), (_instance, state) =>
  state.storage.sql.exec("SELECT revision, payload FROM leaderboard_index").toArray().map(row => ({ revision: row.revision, payload: JSON.parse(String(row.payload)) as { members: { accountId: string }[]; tombstones: { accountId: string; eventAtMs: number }[] } })));
/** Drive one lifecycle operation and check the reply against the frozen contract. */
export async function lifecycle(operation: UsageLifecycleOperationInput, scope = session()) {
  const result = await stub(scope.accountId).lifecycle({ ...scope, ...operation });
  if (result.ok) expect(parseUsageLifecycleValue(result.value)).toEqual(result.value);
  return result;
}
export async function lifecycleValue<K extends UsageLifecycleValue["kind"]>(operation: UsageLifecycleOperationInput, kind: K, scope = session()): Promise<Extract<UsageLifecycleValue, { kind: K }>> {
  const value = success(await lifecycle(operation, scope));
  expect(value.kind).toBe(kind);
  return value as Extract<UsageLifecycleValue, { kind: K }>;
}
export const tables = (id = fixture.account) => runInDurableObject(stub(id), (_instance, state) =>
  state.storage.sql.exec("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' ORDER BY name").toArray().map(row => String(row.name)));
export const enrollmentRow = (id = fixture.account) => runInDurableObject(stub(id), (_instance, state) => {
  const row = state.storage.sql.exec("SELECT schema_version, revision, payload FROM account_enrollment WHERE id = 1").one();
  return { schemaVersion: row.schema_version as number, revision: row.revision as number, payload: JSON.parse(String(row.payload)) as Record<string, unknown> };
});
export const fenceRecord = async (id = fixture.account) => success(await fence(id).read({ accountId: id, generation: env.USAGE_ENROLLMENT_GENERATION })).record;
/** Admit one numeric usage batch from `device` so the admission tables and
 * R2 batch/journal objects hold account-owned content. */
export async function admitUsage(device: Device, tokens = 10n, id = fixture.account, sequence = 1, utcDay = DAY - 1) {
  const occurrenceId = admissionIdBytes(hex(sequence, 16));
  const frame = success(encodeUsageBatch({ utcDay, registryRevision: 1,
    usage: [{ id: occurrenceId, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1,
      provider: 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
      tokens: { inputUncached: tokens, cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, output: 5n, reasoningOutput: 0n } }],
    prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
  const operation = success(encodeAdmissionOperation({ accountId: admissionIdBytes(id.slice(5)),
    deviceId: device.id, generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: 1, sequence,
    occurrenceId, expectedHeadHash: new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  const batch = success(decodeAdmissionBatch(success(encodeAdmissionBatch([operation], ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
  return stub(id).admitBatch({ uploadSecret: device.proof.uploadSecret, batch: batch.bytes });
}
export function replaceEnvironment(instance: unknown, change: (original: Env) => Env): () => void {
  const object = instance as { env: Env }, original = object.env;
  object.env = change(original); return () => { object.env = original; };
}
