import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE } from "../../../lib/usage/contributions";
import { RECLAMATION_REPLAY_HORIZON_MS, type ReclamationLedgerEntry, type ReclamationRequest } from "../../../lib/usage/reclamation-contract";
import { ContributionProjectionState } from "../src/contribution-projection-state";
import type { AccountEnrollment } from "../src/enrollment";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { ReclamationState } from "../src/reclamation-state";

/** Reclamation through the real enrollment RPC on an enrolled, activated and
 * projected account. The step must hold the account's projection and rebuild
 * flight markers from its verification transaction through the provider
 * delete, so no stage can re-reference a node it is about to delete. */
const hex = (n: number, width = 64) => n.toString(16).padStart(width, "0");
const NOW = Date.UTC(2032, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000), POPULATION = hex(5);
let serial = 960_000, accountId = "", deviceId = "", now = NOW;
let proof: { intentId: string; pollSecret: string; uploadSecret: string };
const scope = () => ({ accountId, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic reclamation refusal: ${result.error}`); return result.value;
};
const nodeKey = (hash: string) => `usage-projections/v3/${accountId}/${env.USAGE_ENROLLMENT_GENERATION}/nodes/${hash}.json`;
const request = (action: ReclamationRequest["action"], entries?: readonly ReclamationLedgerEntry[]): ReclamationRequest =>
  ({ schemaVersion: 1, ...scope(), action, ...(entries ? { entries } : {}) });
const candidate = (): ReclamationLedgerEntry => ({ account: accountId, surface: "derived-index-node", key: nodeKey(hex(0xabc)),
  reason: "superseded-root", recordedAt: now - RECLAMATION_REPLAY_HORIZON_MS - 1, referencedBy: [] });
const row = (input: string) => ({ utcDay: DAY, client: "codex", provider: null, model: null, records: 1,
  tokens: { input, cacheRead: "0", cacheWrite: "0", output: "9", reasoning: "0" },
  reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
  durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported" as const, breakdownCoverage: "complete" as const });
async function projectAll(): Promise<void> {
  for (let step = 0; step < 12; step++) {
    now += 16_000; vi.setSystemTime(now);
    const result = success(await stub().advanceContributionProjection({ schemaVersion: 3, ...scope() }));
    if (result.appliedLag === 0 && result.publishedLag === 0) break;
  }
  await runInDurableObject(stub(), async (_instance, ctx) => { await ctx.storage.deleteAlarm(); });
}
type Held = { entered: Promise<void>; release: () => void };
/** Waits for the held provider call, failing fast with the operation's own
 * result when it settles without ever reaching that call. */
const reached = (held: Held, operation: Promise<unknown>) => Promise.race([held.entered,
  operation.then(result => { throw new Error(`settled before the held provider call: ${JSON.stringify(result)}`); })]);
/** Runs one concurrent scenario inside the account object's own I/O context
 * (workerd refuses cross-object promise resolution) with the first `method`
 * call on the STAGING bucket held until `release`. */
async function withHeld<T>(method: "head" | "put", scenario: (instance: AccountEnrollment, held: Held) => Promise<T>): Promise<T> {
  return runInDurableObject(stub(), async instance => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    let released = false;
    owner.env = { ...original, STAGING: new Proxy(original.STAGING, { get: (target, property) => {
      if (property === method) return async (...args: unknown[]) => {
        if (!released) { entered.resolve(); await gate.promise; }
        return (Reflect.get(target, property, target) as (...input: unknown[]) => Promise<unknown>).apply(target, args);
      };
      const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    } }) } as Env;
    const release = () => { released = true; gate.resolve(); };
    try { return await scenario(instance, { entered: entered.promise, release }); }
    finally { release(); owner.env = original; }
  });
}

beforeEach(async () => {
  now = NOW; accountId = `acct_${hex(++serial, 32)}`;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  proof = { intentId: hex(++serial), pollSecret: hex(++serial), uploadSecret: hex(++serial) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(++serial);
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret,
    uploadCommitment: success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret)) }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, browserNonce, attemptId: attempt.attemptId, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId, authTimeMs: now, sessionExpiresAtMs: now + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId, liveSessionExpiresAtMs: now + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId }));
  success(await pairing.reserveEnrollment(proof));
  await runInDurableObject(stub(), instance => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1", AICHARTS_USAGE_RECLAMATION_ENABLED: "1" } as Env;
  });
  deviceId = success(await stub().enroll(proof)).receipt.deviceId;
  success(await stub().activateContributions({ uploadSecret: proof.uploadSecret, request: {
    schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), expectedRevision: 0, mode: "fresh-empty" } }));
  success(await stub().grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: {
    schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), populationId: POPULATION, expectedRevision: 1,
    expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
  success(await stub().admitContributions({ uploadSecret: proof.uploadSecret, request: {
    schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
    grain: "observation", sequence: 1, expectedRevision: 2, populationId: POPULATION, writerRevision: 1,
    expectedPopulationRevision: 0, expectedPopulationHead: "0".repeat(64), replacement: null,
    mutations: [{ kind: "put", id: hex(1, 32), expectedHeadHash: null, row: row("7") }] } }));
  await projectAll();
  await runInDurableObject(stub(), (_instance, ctx) => {
    expect(new ContributionProjectionState(ctx.storage).status(now).publishedRevision).toBe(3);
  });
  // The ledger is admitted only beside the schema-13 rebuild tables, which a
  // real rebuild begin creates; aborting it leaves no pending job.
  const job = hex(++serial);
  success(await stub().executeContributionRebuild({ schemaVersion: 3, ...scope(), jobId: job, action: "begin", expectedVersion: 0, expectedRevision: 3 }));
  success(await stub().executeContributionRebuild({ schemaVersion: 3, ...scope(), jobId: job, action: "abort", expectedVersion: 1 }));
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers(); await abortAllDurableObjects();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const objects = (await bucket.list()).objects; if (objects.length) await bucket.delete(objects.map(object => object.key));
  }
  await reset();
});

test("an in-flight reclamation step holds the projection and rebuild flights until its delete settles", async () => {
  expect(await stub().executeReclamation(request("status"))).toEqual({ ok: false, error: "not_started" });
  const recorded = success(await stub().executeReclamation(request("record", [candidate()])));
  expect(recorded).toMatchObject({ enabled: true, entries: 1, recorded: 1, deletes: 0 });
  expect(await runInDurableObject(stub(), (_instance, ctx) => ReclamationState.present(ctx.storage))).toBe(true);
  // An unreferenced orphan node, so the step issues a real provider delete.
  await env.STAGING.put(candidate().key, "{}");
  const receipt = await withHeld("head", async (instance, held) => {
    const step = instance.executeReclamation(request("step"));
    await reached(held, step);
    expect(await instance.advanceContributionProjection({ schemaVersion: 3, ...scope() })).toEqual({ ok: false, error: "conflict", status: null });
    expect(await instance.executeContributionRebuild({ schemaVersion: 3, ...scope(), jobId: hex(99), action: "begin", expectedVersion: 0, expectedRevision: 3 }))
      .toEqual({ ok: false, error: "conflict" });
    expect(await instance.executeReclamation(request("status"))).toEqual({ ok: false, error: "conflict" });
    held.release();
    return success(await step);
  });
  expect(receipt).toMatchObject({ reclaimed: 1, deletes: 1, visited: [expect.objectContaining({ key: candidate().key, state: "reclaimed" })] });
  expect(await env.STAGING.head(candidate().key)).toBeNull();
  // Both flights are released: an ordinary projection advance and a status read succeed again.
  expect(success(await stub().advanceContributionProjection({ schemaVersion: 3, ...scope() }))).toMatchObject({ appliedLag: 0, publishedLag: 0 });
  expect(success(await stub().executeReclamation(request("status")))).toMatchObject({ reclaimed: 1, deletes: 0 });
});

test("an in-flight projection stage refuses the reclamation RPC before it touches any storage", async () => {
  const head = await runInDurableObject(stub(), (_instance, ctx) =>
    String(ctx.storage.sql.exec("SELECT head_hash FROM usage_contribution_populations WHERE id = ? LIMIT 1", POPULATION).one().head_hash));
  success(await stub().admitContributions({ uploadSecret: proof.uploadSecret, request: {
    schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
    grain: "observation", sequence: 2, expectedRevision: 3, populationId: POPULATION, writerRevision: 1,
    expectedPopulationRevision: 1, expectedPopulationHead: head, replacement: null,
    mutations: [{ kind: "put", id: hex(2, 32), expectedHeadHash: null, row: row("11") }] } }));
  // The first advance only plans the stage; the next one writes its nodes.
  now += 16_000; vi.setSystemTime(now);
  expect(success(await stub().advanceContributionProjection({ schemaVersion: 3, ...scope() }))).toMatchObject({ staged: { revision: 4, phase: "add" } });
  now += 16_000; vi.setSystemTime(now);
  await withHeld("put", async (instance, held) => {
    const advance = instance.advanceContributionProjection({ schemaVersion: 3, ...scope() });
    await reached(held, advance);
    expect(await instance.executeReclamation(request("status"))).toEqual({ ok: false, error: "conflict" });
    expect(await instance.executeReclamation(request("record", [candidate()]))).toEqual({ ok: false, error: "conflict" });
    held.release();
    success(await advance);
  });
  expect(await runInDurableObject(stub(), (_instance, ctx) => ReclamationState.present(ctx.storage))).toBe(false);
  await projectAll();
  expect(await stub().executeReclamation(request("status"))).toEqual({ ok: false, error: "not_started" });
});
