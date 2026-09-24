import { env } from "cloudflare:workers";
import { abortAllDurableObjects, createExecutionContext, reset, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { contributionHash, contributionBodyHash, parseContributionBatch, parseContributionMigrationRequest, CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE } from "../../../lib/usage/contributions";
import { CONTRIBUTION_ACTIVATE_URL, CONTRIBUTION_GRANT_URL, CONTRIBUTION_UPLOAD_URL, CONTRIBUTION_STATUS_URL,
  CONTRIBUTION_ABANDON_URL, CONTRIBUTION_CANCEL_URL, CONTRIBUTION_HTTP_CONTROL_BYTES, CONTRIBUTION_MIGRATE_URL, CONTRIBUTION_CANCEL_MIGRATION_URL,
  CONTRIBUTION_HEAD_QUERY_URL } from "../../../lib/usage/contributions-http-contract";
import { CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES, CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES, parseContributionHeadPage,
  type ContributionHeadPage, type ContributionHeadQuery } from "../../../lib/usage/contribution-head-query";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { createContributionHttpHandler, type ContributionHttpEnvironment } from "../src/contributions-http";
import { createProductionRouter } from "../src/production";
import { CONTRIBUTION_QUERY_URL, type ContributionQuery } from "../../../lib/usage/contribution-query";
import { createContributionQueryHttpHandler, type ContributionQueryHttpEnvironment } from "../src/contribution-query-http";
import { CONTRIBUTION_CANCEL_REQUEST_BYTES } from "../../../lib/usage/contribution-cancel";
import type { PairingHttpVerifier } from "../src/pairing-http";

const hex = (n: number, width = 64) => n.toString(16).padStart(width, "0");
const NOW = Date.UTC(2030, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000), populationId = hex(41);
let serial = 10_000, accountId = "";
const effects = { now: () => Date.now(), setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) };
const verifier: PairingHttpVerifier = { beginRequest() {
  const handle = Object.freeze({}); let open = true;
  return { async verify(token) { return token === "a.b.c" ? { ok: true, value: handle } : { ok: false, error: "unauthorized" }; },
    isCurrent(value) { return open && value === handle; }, finish() { open = false; } };
} };
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic contribution failure: ${result.error}`); return result.value;
};
beforeEach(() => { accountId = `acct_${hex(++serial, 32)}`; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.STAGING, env.CONTROL]) {
    const keys = (await bucket.list()).objects.map(object => object.key); if (keys.length) await bucket.delete(keys);
  }
  await reset();
});
async function enroll() {
  const proof = { intentId: hex(++serial), pollSecret: hex(++serial), uploadSecret: hex(++serial) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(++serial);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, browserNonce, attemptId: attempt.attemptId, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId }));
  success(await pairing.reserveEnrollment(proof));
  const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId));
  await runInDurableObject(stub, instance => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
  });
  const enrolled = success(await stub.enroll(proof));
  return { proof, stub, deviceId: enrolled.receipt.deviceId };
}
const request = (url: string, value: unknown, token = hex(12)) => new Request(url, { method: "POST", body: JSON.stringify(value), headers: {
  "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}`,
} });
async function call(url: string, value: unknown, token: string, target: ContributionHttpEnvironment = env) {
  const context = createExecutionContext();
  try { return await createContributionHttpHandler(effects)(request(url, value, token), target, context); }
  finally { await waitOnExecutionContext(context); }
}
async function queryCall(value: unknown, token = "a.b.c", target: ContributionQueryHttpEnvironment = env) {
  const context = createExecutionContext();
  try { return await createContributionQueryHttpHandler({ ...effects, verifier })(request(CONTRIBUTION_QUERY_URL, value, token), target, context); }
  finally { await waitOnExecutionContext(context); }
}
test("real RPC activation, population, exact upload retry, status and committed abandonment stay bounded and private", async () => {
  const { proof, deviceId, stub } = await enroll(), generation = env.USAGE_ENROLLMENT_GENERATION;
  const identity = { schemaVersion: 3 as const, accountId, generation, deviceId };
  const activation = { ...identity, operationId: hex(++serial), expectedRevision: 0, mode: "fresh-empty" };
  const first = await call(CONTRIBUTION_ACTIVATE_URL, activation, proof.uploadSecret);
  expect(first.status).toBe(200);
  const firstBody = await first.json();
  expect(await (await call(CONTRIBUTION_ACTIVATE_URL, activation, proof.uploadSecret)).json()).toEqual(firstBody);
  const grant = { ...identity, operationId: hex(++serial), populationId, expectedRevision: 1,
    expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null };
  expect((await call(CONTRIBUTION_GRANT_URL, grant, proof.uploadSecret)).status).toBe(200);
  const batch = parseContributionBatch({ ...identity, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY, grain: "observation",
    operationId: hex(++serial), sequence: 1, expectedRevision: 2, populationId, writerRevision: 1, expectedPopulationRevision: 0,
    expectedPopulationHead: "0".repeat(64), replacement: null, mutations: [{ kind: "put", id: hex(99, 32), expectedHeadHash: null,
      row: { utcDay: DAY, client: "codex", provider: null, model: null, tokens: { input: "7", cacheRead: "0", cacheWrite: "0", output: "9", reasoning: "0" },
        records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
        durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" } }] });
  if (!batch) throw new Error("synthetic batch");
  const response = await call(CONTRIBUTION_UPLOAD_URL, batch, proof.uploadSecret);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const bytes = await response.arrayBuffer(); expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
  const accepted = JSON.parse(new TextDecoder().decode(bytes));
  expect(accepted).toMatchObject({ schemaVersion: 3, result: { ok: true, value: { outcome: "committed", receipt: { revision: 3 } } } });
  expect(await (await call(CONTRIBUTION_UPLOAD_URL, batch, proof.uploadSecret)).json()).toEqual(accepted);
  const status = await call(CONTRIBUTION_STATUS_URL, { ...identity, populationId, operationId: batch.operationId }, proof.uploadSecret);
  expect(await status.json()).toMatchObject({ schemaVersion: 3, result: { ok: true, value: { phase: "active", revision: 3,
    nextSequence: 2, population: { memberCount: 1 }, operation: { outcome: "committed" } } } });
  const abandon = await call(CONTRIBUTION_ABANDON_URL, { ...identity, operationId: batch.operationId, bodyHash: contributionBodyHash(batch) }, proof.uploadSecret);
  expect(await abandon.json()).toEqual(accepted);
  expect((await call(CONTRIBUTION_STATUS_URL, { ...identity, populationId, operationId: null }, proof.pollSecret)).status).toBe(401);
  const query: ContributionQuery = { schemaVersion: 3, accountId, sessionExpiresAtMs: NOW + PAIRING_TTL_MS,
    firstUtcDay: DAY, dayCount: 1, limit: 256, cursor: null };
  expect(await (await queryCall(query)).json()).toMatchObject({ result: { ok: true, value: { snapshotRevision: 0, snapshotLag: 3, cells: [] } } });
  expect(await runInDurableObject(stub, (_instance, context) => context.storage.sql.exec(
    "SELECT name FROM sqlite_schema WHERE name='usage_contribution_projection_control'").toArray())).toEqual([{ name: "usage_contribution_projection_control" }]);
  for (let step = 0; step < 4; step++) {
    vi.setSystemTime(NOW + (step + 1) * 16_000);
    success(await stub.advanceContributionProjection({ schemaVersion: 3, accountId, generation }));
  }
  const snapshot = () => runInDurableObject(stub, (_instance, context) => ({
    account: context.storage.sql.exec("SELECT * FROM account_enrollment").toArray(),
    projection: context.storage.sql.exec("SELECT * FROM usage_contribution_projection_control").toArray(),
    publications: context.storage.sql.exec("SELECT * FROM usage_contribution_projection_publications ORDER BY revision").toArray(),
  }));
  const before = await snapshot(), put = vi.spyOn(env.STAGING, "put"), controlPut = vi.spyOn(env.CONTROL, "put");
  const page = await queryCall(query); expect(page.status).toBe(200); expect(page.headers.get("cache-control")).toBe("private, no-store");
  const value = await page.json();
  expect(value).toMatchObject({ schemaVersion: 3, result: { ok: true, value: { sourceRevision: 3, latestPublishedRevision: 3,
    snapshotRevision: 3, snapshotLag: 0, unresolvedLegacyBodies: 0, cells: [{ observations: 1, tokens: { input: "7", output: "9" } }], next: null } } });
  expect(await snapshot()).toEqual(before); expect(before.account[0].schema_version).toBe(11);
  expect(put).not.toHaveBeenCalled(); expect(controlPut).not.toHaveBeenCalled();
});
test("malformed or oversized framing and private labels cannot select an account", async () => {
  let selected = 0;
  const target: ContributionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error("unexpected account selection"); } } };
  const valid = { schemaVersion: 3, accountId, generation: hex(1), deviceId: hex(2), populationId, operationId: null };
  const heads = { schemaVersion: 3, accountId, generation: hex(1), deviceId: hex(2), populationId,
    writerRevision: 1, expectedRevision: null, mode: "heads", ids: [hex(1, 32)] };
  const invalid = [new Request(CONTRIBUTION_STATUS_URL), request(`${CONTRIBUTION_STATUS_URL}?x=private`, valid),
    request(CONTRIBUTION_STATUS_URL, { ...valid, privatePath: "/private/canary" }), request(CONTRIBUTION_STATUS_URL, valid, "0".repeat(64)),
    request(CONTRIBUTION_STATUS_URL, { ...valid, populationId: "x".repeat(CONTRIBUTION_HTTP_CONTROL_BYTES) }),
    request(`${CONTRIBUTION_HEAD_QUERY_URL}?account=private`, heads), request(CONTRIBUTION_HEAD_QUERY_URL, heads, "a.b.c"),
    request(CONTRIBUTION_HEAD_QUERY_URL, { ...heads, sourcePath: "/private/canary" }),
    request(CONTRIBUTION_HEAD_QUERY_URL, { ...heads, ids: [hex(1, 32), hex(1, 32)] }),
    request(CONTRIBUTION_HEAD_QUERY_URL, { ...heads, ids: Array.from({ length: 257 }, (_, index) => hex(index + 1, 32)) }),
    request(CONTRIBUTION_HEAD_QUERY_URL, { ...heads, ids: ["x".repeat(CONTRIBUTION_HEAD_QUERY_REQUEST_BYTES)] })];
  const cookie = request(CONTRIBUTION_STATUS_URL, valid); cookie.headers.set("cookie", "private-canary=1"); invalid.push(cookie);
  const length = request(CONTRIBUTION_STATUS_URL, valid); length.headers.set("content-length", "1"); invalid.push(length);
  for (const input of invalid) {
    const context = createExecutionContext();
    try { expect([400, 401]).toContain((await createContributionHttpHandler(effects)(input, target, context)).status); }
    finally { await waitOnExecutionContext(context); }
  }
  expect(selected).toBe(0);
});

test("full-batch cancellation fences an absent delayed upload with one metadata charge and schema12", async () => {
  const { proof, deviceId, stub } = await enroll(), generation = env.USAGE_ENROLLMENT_GENERATION;
  const identity = { schemaVersion: 3 as const, accountId, generation, deviceId };
  success(await stub.activateContributions({ uploadSecret: proof.uploadSecret, request: {
    ...identity, operationId: hex(++serial), expectedRevision: 0, mode: "fresh-empty" } }));
  success(await stub.grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: {
    ...identity, operationId: hex(++serial), populationId, expectedRevision: 1, expectedWriterRevision: 0,
    previousDeviceId: null, abandonOperationId: null } }));
  const batch = parseContributionBatch({ ...identity, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY, grain: "observation",
    operationId: hex(++serial), sequence: 1, expectedRevision: 2, populationId, writerRevision: 1, expectedPopulationRevision: 0,
    expectedPopulationHead: "0".repeat(64), replacement: null, mutations: [{ kind: "put", id: hex(1, 32), expectedHeadHash: null,
      row: { utcDay: DAY, client: "claude", provider: null, model: null, records: 1,
        tokens: { input: "120", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" },
        reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
        durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" } }] });
  if (!batch) throw new Error("invalid cancellation fixture");
  success(await stub.grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: {
    ...identity, operationId: hex(++serial), populationId: hex(99), expectedRevision: 2, expectedWriterRevision: 0,
    previousDeviceId: null, abandonOperationId: null } }));
  const currentStub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId));
  const snapshot = () => runInDurableObject(currentStub(), (_instance, ctx) => ({
    version: ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id=1").one().schema_version,
    control: ctx.storage.sql.exec("SELECT * FROM usage_contribution_control").one(),
  }));
  const before = await snapshot(); expect(before.version).toBe(11);
  expect((await call(CONTRIBUTION_CANCEL_URL, { ...identity, expectedRevision: 3, batch }, proof.pollSecret)).status).toBe(401);
  expect((await call(CONTRIBUTION_CANCEL_URL, { ...identity, expectedRevision: 2, batch }, proof.uploadSecret)).status).toBe(409);
  expect(await snapshot()).toEqual(before);
  const put = vi.spyOn(env.STAGING, "put"), del = vi.spyOn(env.STAGING, "delete");
  const response = await call(CONTRIBUTION_CANCEL_URL, { ...identity, expectedRevision: 3, batch }, proof.uploadSecret);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const accepted = await response.json();
  expect(accepted).toEqual({ schemaVersion: 3, result: { ok: true, value: {
    outcome: "abandoned", operationId: batch.operationId, bodyHash: contributionBodyHash(batch), revision: 4 } } });
  const after = await snapshot(); expect(after.version).toBe(12);
  expect(after.control).toMatchObject({ revision: 4, head_count: 0, membership_count: 0, operation_count: Number(before.control.operation_count) + 1,
    immutable_bytes: before.control.immutable_bytes, metadata_bytes: Number(before.control.metadata_bytes) + 8_192, pending_operation: null });
  expect(await (await call(CONTRIBUTION_UPLOAD_URL, batch, proof.uploadSecret)).json()).toEqual(accepted);
  expect(await (await call(CONTRIBUTION_CANCEL_URL, { ...identity, expectedRevision: 0, batch }, proof.uploadSecret)).json()).toEqual(accepted);
  expect(await snapshot()).toEqual(after); expect(put).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
  const unavailable = async () => { throw new Error("wrong operation"); }; let disposed = 0;
  const uncorrelated: ContributionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { return {
    activateContributions: unavailable, grantContributionPopulation: unavailable, admitContributions: unavailable,
    abandonContributions: unavailable, readContributionStatus: unavailable, readContributionHeads: unavailable,
    migrateContributions: unavailable, cancelContributionMigration: unavailable,
    cancelContributions: async () => ({ ok: true, value: { outcome: "abandoned", operationId: batch.operationId, bodyHash: hex(999), revision: 4 },
      [Symbol.dispose]() { disposed++; } }),
  }; } } };
  expect((await call(CONTRIBUTION_CANCEL_URL, { ...identity, expectedRevision: 3, batch }, proof.uploadSecret, uncorrelated)).status).toBe(503);
  expect(disposed).toBe(1);
  put.mockRestore(); del.mockRestore();
  await abortAllDurableObjects();
  await runInDurableObject(currentStub(), instance => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
  });
  const status = await call(CONTRIBUTION_STATUS_URL, { ...identity, populationId, operationId: batch.operationId }, proof.uploadSecret);
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({ result: { ok: true, value: { revision: 4, nextSequence: 2,
    operation: { operationId: batch.operationId, outcome: "abandoned" } } } });
  expect(await snapshot()).toEqual(after);
});

test("cancel request framing is bounded before account selection", async () => {
  let selected = 0;
  const target: ContributionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error("unexpected account"); } } };
  const handler = createContributionHttpHandler(effects), context = createExecutionContext();
  try {
    const oversized = new Request(CONTRIBUTION_CANCEL_URL, { method: "POST", body: "{}", headers: {
      "content-type": "application/json", accept: "application/json", authorization: `Bearer ${hex(1)}`,
      "content-length": String(CONTRIBUTION_CANCEL_REQUEST_BYTES + 1),
    } });
    expect((await handler(oversized, target, context)).status).toBe(400);
    expect((await call(CONTRIBUTION_CANCEL_URL, { schemaVersion: 3, batch: { privatePrompt: "PRIVATE_CANARY" } }, hex(1), target)).status).toBe(400);
    expect(selected).toBe(0);
  } finally { await waitOnExecutionContext(context); }
});
test("real HTTP named heads and membership recovery bind the writer and revision without read mutations", async () => {
  const { proof, deviceId, stub } = await enroll(), generation = env.USAGE_ENROLLMENT_GENERATION;
  const identity = { schemaVersion: 3 as const, accountId, generation, deviceId };
  expect((await call(CONTRIBUTION_ACTIVATE_URL, { ...identity, operationId: hex(++serial), expectedRevision: 0, mode: "fresh-empty" }, proof.uploadSecret)).status).toBe(200);
  expect((await call(CONTRIBUTION_GRANT_URL, { ...identity, operationId: hex(++serial), populationId, expectedRevision: 1,
    expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, proof.uploadSecret)).status).toBe(200);
  const mutations = [10, 20, 30].map(id => ({ kind: "put", id: hex(id, 32), expectedHeadHash: null,
    row: { utcDay: DAY, client: "codex", provider: null, model: null, records: 1,
      tokens: { input: String(id), cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" }, reportedCostMicrousd: null,
      reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0, durationMs: null, timedRecords: 0,
      timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" } }));
  const batch = parseContributionBatch({ ...identity, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
    grain: "observation", operationId: hex(++serial), sequence: 1, expectedRevision: 2, populationId, writerRevision: 1,
    expectedPopulationRevision: 0, expectedPopulationHead: "0".repeat(64), replacement: null, mutations });
  if (!batch) throw new Error("invalid synthetic multi-head batch");
  expect((await call(CONTRIBUTION_UPLOAD_URL, batch, proof.uploadSecret)).status).toBe(200);
  const binding = { ...identity, populationId, writerRevision: 1, expectedRevision: 3 };
  const lookup: ContributionHeadQuery = { ...binding, mode: "heads", ids: [hex(10, 32), hex(11, 32)] };
  const memberQuery: ContributionHeadQuery = { ...binding, mode: "members", limit: 2, cursor: null };
  async function read(input: ContributionHeadQuery): Promise<ContributionHeadPage> {
    const response = await call(CONTRIBUTION_HEAD_QUERY_URL, input, proof.uploadSecret);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = await response.arrayBuffer(); expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(bytes.byteLength).toBeLessThanOrEqual(CONTRIBUTION_HEAD_QUERY_RESPONSE_BYTES);
    const body = JSON.parse(new TextDecoder().decode(bytes)); expect(body).toMatchObject({ schemaVersion: 3, result: { ok: true } });
    const page = parseContributionHeadPage(input, body.result.value);
    if (!page) throw new Error("uncorrelated synthetic HTTP head result"); return page;
  }
  const first = await runInDurableObject(stub, async (_instance, context) => {
    const sql = context.storage.sql, tables = ["account_enrollment", "usage_contribution_control", "usage_contribution_heads",
      "usage_contribution_populations", "usage_contribution_memberships", "usage_contribution_operations", "account_work"];
    const snapshot = () => tables.map(table => sql.exec(`SELECT * FROM ${table}`).toArray());
    const before = snapshot(), alarmBefore = await context.storage.getAlarm();
    const exec = vi.spyOn(sql, "exec"), alarm = vi.spyOn(context.storage, "setAlarm"), stagingPut = vi.spyOn(env.STAGING, "put");
    try {
      const named = await read(lookup);
      expect(named.entries[0]).toMatchObject({ id: hex(10, 32), head: { deleted: false, members: 1, reference: { kind: "batch-v3", index: 0 } } });
      expect(named.entries[0].membershipHeadHash).toBe(named.entries[0].head!.headHash);
      expect(named.entries[1]).toEqual({ id: hex(11, 32), head: null, membershipHeadHash: null });
      const first = await read(memberQuery); expect(first.entries.map(entry => entry.id)).toEqual([hex(10, 32), hex(20, 32)]);
      expect(first.next?.afterId).toBe(hex(20, 32));
      const final = await read({ ...memberQuery, expectedRevision: first.revision, cursor: first.next });
      expect(final.entries.map(entry => entry.id)).toEqual([hex(30, 32)]); expect(final.next).toBeNull();
      const maxQuery: ContributionHeadQuery = { ...lookup, ids: Array.from({ length: 256 }, (_, index) => hex(index + 1, 32)) };
      expect(new TextEncoder().encode(JSON.stringify(maxQuery)).byteLength).toBeGreaterThan(CONTRIBUTION_HTTP_CONTROL_BYTES);
      const maximum = await read(maxQuery); expect(maximum.entries).toHaveLength(256);
      expect(maximum.entries.filter(entry => entry.head !== null)).toHaveLength(3);
      expect(new TextEncoder().encode(JSON.stringify(maximum)).byteLength).toBeGreaterThan(4_096);
      expect(snapshot()).toEqual(before); expect(await context.storage.getAlarm()).toBe(alarmBefore);
      expect(exec.mock.calls.every(([query]) => /^SELECT /u.test(query))).toBe(true);
      expect(alarm).not.toHaveBeenCalled(); expect(stagingPut).not.toHaveBeenCalled(); return first;
    } finally { exec.mockRestore(); alarm.mockRestore(); stagingPut.mockRestore(); }
  });
  for (const [input, token, status, error] of [
    [lookup, proof.pollSecret, 401, "unauthorized"], [{ ...lookup, writerRevision: 2 }, proof.uploadSecret, 409, "writer_conflict"],
    [{ ...lookup, expectedRevision: 2 }, proof.uploadSecret, 409, "conflict"],
    [{ ...lookup, generation: hex(900) }, proof.uploadSecret, 503, "recovery_required"],
  ] as const) {
    const response = await call(CONTRIBUTION_HEAD_QUERY_URL, input, token);
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ schemaVersion: 3, result: { ok: false, error } });
  }
  expect((await call(CONTRIBUTION_GRANT_URL, { ...identity, operationId: hex(++serial), populationId: hex(42), expectedRevision: 3,
    expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null }, proof.uploadSecret)).status).toBe(200);
  const stale = await call(CONTRIBUTION_HEAD_QUERY_URL, { ...memberQuery, cursor: first.next }, proof.uploadSecret);
  expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ schemaVersion: 3, result: { ok: false, error: "conflict" } });
  expect((await read({ ...memberQuery, expectedRevision: null, limit: 3 })).entries).toHaveLength(3);
  success(await stub.revokeEnrollment(proof));
  const revoked = await call(CONTRIBUTION_HEAD_QUERY_URL, { ...lookup, expectedRevision: null }, proof.uploadSecret);
  expect(revoked.status).toBe(409); expect(await revoked.json()).toEqual({ schemaVersion: 3, result: { ok: false, error: "revoked" } });
});
test("head HTTP refuses uncorrelated acceptance and disposes every owned RPC response", async () => {
  const input: ContributionHeadQuery = { schemaVersion: 3, accountId, generation: hex(1), deviceId: hex(2), populationId,
    writerRevision: 1, expectedRevision: 3, mode: "heads", ids: [hex(1, 32), hex(2, 32)] };
  const page: ContributionHeadPage = { schemaVersion: 3, profile: "contribution-heads-v3", mode: "heads", accountId, generation: hex(1),
    deviceId: hex(2), revision: 3, observedAtMs: NOW, population: { id: populationId, generation: hex(1), deviceId: hex(2),
      writerRevision: 1, revision: 0, headHash: "0".repeat(64), memberCount: 0 },
    entries: input.ids.map(id => ({ id, head: null, membershipHeadHash: null })), next: null };
  let disposed = 0, selected = 0;
  const changes: readonly Record<string, unknown>[] = [{}, { accountId: `acct_${hex(91, 32)}` }, { generation: hex(91) }, { deviceId: hex(91) },
    { revision: 4 }, { population: { ...page.population, writerRevision: 2 } }, { population: { ...page.population, id: hex(91) } },
    { entries: page.entries.slice(0, 1) }, { entries: [...page.entries].reverse() }, { entries: [page.entries[0], page.entries[0]] },
    { mode: "members" }, { privatePrompt: "PRIVATE_CANARY" }];
  for (const [index, change] of changes.entries()) {
    const unavailable = async () => { throw new Error("wrong operation"); };
    const target: ContributionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName(name) { selected++;
      expect(name).toBe(enrollmentAccountName(accountId)); return {
        activateContributions: unavailable, grantContributionPopulation: unavailable, admitContributions: unavailable,
        abandonContributions: unavailable, cancelContributions: unavailable, readContributionStatus: unavailable, migrateContributions: unavailable, cancelContributionMigration: unavailable,
        async readContributionHeads(dto) { expect(dto).toEqual({ uploadSecret: hex(12), request: input });
          return { ok: true, value: { ...page, ...change }, [Symbol.dispose]() { disposed++; } }; },
      }; } } };
    const response = await call(CONTRIBUTION_HEAD_QUERY_URL, input, hex(12), target);
    expect(response.status).toBe(index === 0 ? 200 : 503);
  }
  expect(disposed).toBe(changes.length); expect(selected).toBe(changes.length);
});
test("migration HTTP binds its exact request and manifest before accepting an account transition", async () => {
  const parsed = parseContributionMigrationRequest({ schemaVersion: 3, accountId, generation: hex(1), deviceId: hex(2),
    operationId: hex(3), expectedRevision: 0, expectedV1Revision: 1, expectedV2Revision: 0 });
  if (!parsed) throw new Error("synthetic migration request");
  const manifestHash = hex(4), receipt = { ...parsed, manifestHash, deltaManifestHash: hex(5), revision: 1, deltaCount: 1,
    headCount: 1, suppressedV1Heads: 0, unresolvedV2Bodies: 0,
    bodyHash: contributionHash(`aicharts:contribution-migration:v3\0${JSON.stringify(parsed)}\0${manifestHash}`) };
  let disposed = 0;
  for (const [change, status] of [[{}, 200], [{ accountId: `acct_${hex(8, 32)}` }, 503], [{ expectedV1Revision: 2 }, 503],
    [{ expectedV2Revision: 1 }, 503], [{ manifestHash: hex(9) }, 503], [{ bodyHash: hex(10) }, 503], [{ deviceId: hex(11) }, 503]] as const) {
    const unavailable = async () => { throw new Error("wrong operation"); };
    const target: ContributionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { return {
      activateContributions: unavailable, grantContributionPopulation: unavailable, admitContributions: unavailable,
      abandonContributions: unavailable, cancelContributions: unavailable, readContributionStatus: unavailable, readContributionHeads: unavailable, cancelContributionMigration: unavailable,
      async migrateContributions() { return { ok: true, value: { ...receipt, ...change }, [Symbol.dispose]() { disposed++; } }; },
    }; } } };
    expect((await call(CONTRIBUTION_MIGRATE_URL, parsed, hex(12), target)).status).toBe(status);
  }
  expect(disposed).toBe(7);
});
test("real RPC migration retries its sealed transition and committed migration cannot be canceled", async () => {
  const { proof, deviceId, stub } = await enroll();
  const migration = { schemaVersion: 3, accountId, generation: env.USAGE_ENROLLMENT_GENERATION, deviceId,
    operationId: hex(++serial), expectedRevision: 0, expectedV1Revision: 0, expectedV2Revision: 0 };
  const response = await call(CONTRIBUTION_MIGRATE_URL, migration, proof.uploadSecret);
  expect(response.status).toBe(200);
  const accepted = await response.json();
  expect(accepted).toMatchObject({ schemaVersion: 3, result: { ok: true, value: { revision: 1, headCount: 0, deltaCount: 0, unresolvedV2Bodies: 0 } } });
  expect(await (await call(CONTRIBUTION_MIGRATE_URL, migration, proof.uploadSecret)).json()).toEqual(accepted);
  success(await stub.advanceContributionProjection({ schemaVersion: 3, accountId, generation: env.USAGE_ENROLLMENT_GENERATION }));
  expect(await (await call(CONTRIBUTION_MIGRATE_URL, migration, proof.uploadSecret)).json()).toEqual(accepted);
  const cancel = await call(CONTRIBUTION_CANCEL_MIGRATION_URL, migration, proof.uploadSecret);
  expect(cancel.status).toBe(409);
});
test("well-shaped foreign or mutated acceptance is refused and RPC resources are disposed", async () => {
  const input = { schemaVersion: 3 as const, accountId, generation: hex(1), deviceId: hex(2), operationId: hex(3), expectedRevision: 0, mode: "fresh-empty" as const };
  let disposed = 0;
  for (const change of [{ accountId: `acct_${hex(4, 32)}` }, { operationId: hex(5) }, { bodyHash: hex(6) }]) {
    const reply = { ok: true, value: { ...input, bodyHash: contributionHash(`aicharts:contribution-activation:v3\0${JSON.stringify(input)}`), revision: 1, ...change },
      [Symbol.dispose]() { disposed++; } };
    const unavailable = async () => { throw new Error("wrong operation"); };
    const target: ContributionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { return {
      activateContributions: async () => reply, grantContributionPopulation: unavailable, admitContributions: unavailable,
      abandonContributions: unavailable, cancelContributions: unavailable, readContributionStatus: unavailable, readContributionHeads: unavailable, migrateContributions: unavailable, cancelContributionMigration: unavailable,
    }; } } };
    expect((await call(CONTRIBUTION_ACTIVATE_URL, input, hex(10), target)).status).toBe(503);
  }
  expect(disposed).toBe(3);
});
test("a timed-out RPC retains terminal ownership and disposes its late result without returning acceptance", async () => {
  const input = { schemaVersion: 3 as const, accountId, generation: hex(1), deviceId: hex(2), populationId, operationId: null };
  let resolve!: (value: unknown) => void, entered!: () => void, disposed = 0;
  const began = new Promise<void>(done => { entered = done; }), held = new Promise<unknown>(done => { resolve = done; });
  const unavailable = async () => { throw new Error("wrong operation"); };
  const target: ContributionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { return {
    activateContributions: unavailable, grantContributionPopulation: unavailable, admitContributions: unavailable, abandonContributions: unavailable, cancelContributions: unavailable,
    migrateContributions: unavailable, cancelContributionMigration: unavailable, readContributionHeads: unavailable,
    readContributionStatus() { entered(); return held; },
  }; } } };
  const timers = new Set<() => void>(), terminal: Promise<void>[] = [];
  const handler = createContributionHttpHandler({ now: () => NOW, setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(timer) { timers.delete(timer as () => void); } });
  const response = handler(request(CONTRIBUTION_STATUS_URL, input), target, { waitUntil(value) { terminal.push(value); } });
  await began; for (const timer of timers) timer();
  expect((await response).status).toBe(503); expect(disposed).toBe(0); expect(terminal).toHaveLength(1);
  resolve({ ok: false, error: "not_started", [Symbol.dispose]() { disposed++; } });
  await Promise.all(terminal); expect(disposed).toBe(1);
});
test("all v3 production routes require their distinct explicit activation flag", async () => {
  let calls = 0;
  const route = createProductionRouter({ handlers: { contributions: async () => { calls++; return new Response("synthetic"); } } });
  const flags = { ...env, AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_ADMISSION_ENABLED: "1", AICHARTS_USAGE_STATS_ENABLED: "1",
    AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" };
  for (const url of [CONTRIBUTION_ACTIVATE_URL, CONTRIBUTION_GRANT_URL, CONTRIBUTION_UPLOAD_URL, CONTRIBUTION_STATUS_URL, CONTRIBUTION_ABANDON_URL,
    CONTRIBUTION_MIGRATE_URL, CONTRIBUTION_CANCEL_MIGRATION_URL, CONTRIBUTION_CANCEL_URL, CONTRIBUTION_HEAD_QUERY_URL]) {
    for (const name of ["AICHARTS_USAGE_WORKER_ENABLED", "AICHARTS_USAGE_ADMISSION_ENABLED", "AICHARTS_USAGE_STATS_ENABLED", "AICHARTS_USAGE_CONTRIBUTIONS_ENABLED"])
      for (const flag of [undefined, true, "true", "0"])
        expect((await route(new Request(url), { ...flags, [name]: flag }, { waitUntil() {} })).status).toBe(503);
    expect((await route(new Request(url), flags, { waitUntil() {} })).status).toBe(200);
  }
  for (const name of ["ACCOUNT_ENROLLMENTS", "STAGING", "CONTROL"])
    expect((await route(new Request(CONTRIBUTION_HEAD_QUERY_URL), { ...flags, [name]: undefined }, { waitUntil() {} })).status).toBe(503);
  expect((await route(new Request(`${CONTRIBUTION_HEAD_QUERY_URL}?unexpected=1`), flags, { waitUntil() {} })).status).toBe(503);
  expect(calls).toBe(9);
});
test("private indexed query verifies workload before account selection and disposes uncorrelated replies", async () => {
  const query: ContributionQuery = { schemaVersion: 3, accountId, sessionExpiresAtMs: NOW + PAIRING_TTL_MS,
    firstUtcDay: DAY, dayCount: 1, limit: 2, cursor: null };
  let selected = 0, disposed = 0;
  const page = { schemaVersion: 3, profile: "contribution-cells-v3", coverage: "observed-only", accountId,
    generation: env.USAGE_ENROLLMENT_GENERATION, observedAtMs: NOW, sourceRevision: 1, latestAppliedRevision: 1,
    latestPublishedRevision: 1, appliedLag: 0, publishedLag: 0, snapshotRevision: 1,
    snapshotLag: 0, rootHash: null, unresolvedLegacyBodies: 0, firstUtcDay: DAY, dayCount: 1, cells: [], next: null };
  let change: Record<string, unknown> = {};
  const target: ContributionQueryHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() {
    selected++; return { async readContributionPage() { return { ok: true, value: { ...page, ...change }, [Symbol.dispose]() { disposed++; } }; } };
  } } };
  expect((await queryCall(query, hex(3), target)).status).toBe(401); expect(selected).toBe(0);
  expect((await queryCall({ ...query, privatePrompt: "PRIVATE_CANARY" }, "a.b.c", target)).status).toBe(400); expect(selected).toBe(0);
  for (const [alteration, status] of [[{}, 200], [{ accountId: `acct_${hex(987, 32)}` }, 503], [{ snapshotLag: 1 }, 503],
    [{ firstUtcDay: DAY + 1 }, 503], [{ coverage: "complete" }, 503], [{ observedAtMs: query.sessionExpiresAtMs }, 503]] as const) {
    change = alteration; expect((await queryCall(query, "a.b.c", target)).status).toBe(status);
  }
  expect(selected).toBe(6); expect(disposed).toBe(6);
});
test("private indexed production query requires stats, canonical, auth and private-read flags independently", async () => {
  let calls = 0;
  const router = createProductionRouter({ handlers: { contributionQuery: async () => { calls++; return new Response("synthetic"); } } });
  const flags = { ...env, AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1",
    AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1" };
  for (const key of ["AICHARTS_USAGE_WORKER_ENABLED", "AICHARTS_USAGE_STATS_ENABLED", "AICHARTS_USAGE_CONTRIBUTIONS_ENABLED",
    "AICHARTS_USAGE_AUTH_ENABLED", "AICHARTS_USAGE_PRIVATE_READ_ENABLED"] as const)
    for (const value of [undefined, true, "true", "0"]) expect((await router(new Request(CONTRIBUTION_QUERY_URL), { ...flags, [key]: value }, { waitUntil() {} })).status).toBe(503);
  expect((await router(new Request(CONTRIBUTION_QUERY_URL), flags, { waitUntil() {} })).status).toBe(200); expect(calls).toBe(1);
});
