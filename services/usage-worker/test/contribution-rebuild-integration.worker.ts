import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE } from "../../../lib/usage/contributions";
import { CONTRIBUTION_REBUILD_DEADLINE_MS, type ContributionRebuildReadRequest } from "../../../lib/usage/contribution-rebuild-contract";
import { ContributionProjectionState } from "../src/contribution-projection-state";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { restoreFenceName } from "../src/restore-fence";

const hex = (n: number, width = 64) => n.toString(16).padStart(width, "0");
const NOW = Date.UTC(2032, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000), POPULATION = hex(5);
let serial = 950_000, accountId = "", deviceId = "", now = NOW;
let proof: { intentId: string; pollSecret: string; uploadSecret: string };
const scope = () => ({ accountId, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic rebuild refusal: ${result.error}`); return result.value;
};
const JOB = hex(99);
const request = (): ContributionRebuildReadRequest => ({ schemaVersion: 3, ...scope(), jobId: JOB });
const begin = () => ({ ...request(), action: "begin" as const, expectedVersion: 0 as const, expectedRevision: 3 });
const advance = (expectedVersion: number) => ({ ...request(), action: "advance" as const, expectedVersion });
const enable = async () => runInDurableObject(stub(), instance => {
  const owner = instance as unknown as { env: Env };
  owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
});

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
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
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
    mutations: [{ kind: "put", id: hex(1, 32), expectedHeadHash: null, row: {
      utcDay: DAY, client: "codex", provider: null, model: null, records: 1,
      tokens: { input: "7", cacheRead: "0", cacheWrite: "0", output: "9", reasoning: "0" },
      reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" } }],
  } }));
  for (let step = 0; step < 12; step++) {
    now += 16_000; vi.setSystemTime(now);
    const result = success(await stub().advanceContributionProjection({ schemaVersion: 3, ...scope() }));
    if (result.publishedRevision === 3) break;
  }
  await runInDurableObject(stub(), async (_instance, ctx) => {
    expect(new ContributionProjectionState(ctx.storage).status(now).publishedRevision).toBe(3);
    await ctx.storage.deleteAlarm();
  });
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers(); await abortAllDurableObjects();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const objects = (await bucket.list()).objects; if (objects.length) await bucket.delete(objects.map(object => object.key));
  }
  await reset();
});

test("missing rebuild status is SELECT-only and never initializes the job schema", async () => {
  await runInDurableObject(stub(), async (instance, ctx) => {
    const exec = vi.spyOn(ctx.storage.sql, "exec"), arm = vi.spyOn(ctx.storage, "setAlarm");
    const put = vi.spyOn(env.STAGING, "put"), get = vi.spyOn(env.STAGING, "get");
    expect(await instance.readContributionRebuild(request())).toEqual({ ok: true, value: null });
    expect(exec.mock.calls.length).toBeGreaterThan(0); expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    expect(arm).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    expect(ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id=1").one().schema_version).toBe(11);
    expect(ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='usage_contribution_rebuild_jobs'").toArray()).toEqual([]);
  });
});

test("schema13 rebuild survives restart, retains exact step replies and never publishes its scratch root", async () => {
  const initial = success(await stub().executeContributionRebuild(begin()));
  expect(initial).toMatchObject({ version: 1, phase: "building", sourceRevision: 3, processedHeads: 0 });
  const first = success(await stub().executeContributionRebuild(advance(1)));
  expect(first).toMatchObject({ version: 2, phase: "comparing", processedHeads: 1, liveHeads: 1 });
  expect(first.chargedBytes).toBeGreaterThan(0);
  await abortAllDurableObjects(); await enable();
  expect(success(await stub().executeContributionRebuild(advance(1)))).toEqual(first);
  const matched = success(await stub().executeContributionRebuild(advance(2)));
  expect(matched).toMatchObject({ version: 3, phase: "match", checkedCells: 1, sourceRevision: 3, chargedBytes: first.chargedBytes });
  expect(success(await stub().executeContributionRebuild(begin()))).toEqual(initial);
  await runInDurableObject(stub(), async (instance, ctx) => {
    expect(ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id=1").one().schema_version).toBe(13);
    const projection = new ContributionProjectionState(ctx.storage).control();
    expect(projection.publishedRevision).toBe(3); expect(projection.publishedRoot).toEqual(initial.publishedRoot);
    const exec = vi.spyOn(ctx.storage.sql, "exec"), arm = vi.spyOn(ctx.storage, "setAlarm"), put = vi.spyOn(env.STAGING, "put");
    expect(success(await instance.readContributionRebuild(request()))).toEqual({ receipt: matched, pending: false, chargedBytes: first.chargedBytes });
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    expect(arm).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
});

test("canonical progress during final authority awaits refuses fresh output while preserving its exact retained retry", async () => {
  success(await stub().executeContributionRebuild(begin()));
  await runInDurableObject(stub(), async instance => {
    const owner = instance as unknown as { env: Env }, original = owner.env; let calls = 0;
    owner.env = { ...original, CONTROL: { get: async (...args: Parameters<R2Bucket["get"]>) => {
      if (++calls === 2) success(await instance.grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: {
        schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), populationId: hex(6), expectedRevision: 3,
        expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
      return original.CONTROL.get(...args);
    } } } as unknown as Env;
    try { expect(await instance.executeContributionRebuild(advance(1))).toEqual({ ok: false, error: "conflict" }); }
    finally { owner.env = original; }
  });
  const retained = success(await stub().executeContributionRebuild(advance(1)));
  expect(retained).toMatchObject({ version: 2, phase: "comparing", sourceRevision: 3 });
  expect(await stub().executeContributionRebuild(advance(2))).toEqual({ ok: false, error: "conflict" });
  expect(success(await stub().executeContributionRebuild({ ...request(), action: "abort", expectedVersion: 2 })))
    .toMatchObject({ phase: "aborted", version: 3, sourceRevision: 3 });
});

test("a changed full publication reference invalidates fresh output even when the content hash stays equal", async () => {
  success(await stub().executeContributionRebuild(begin()));
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env; let calls = 0;
    owner.env = { ...original, CONTROL: { get: async (...args: Parameters<R2Bucket["get"]>) => {
      if (++calls === 2) {
        const root = new ContributionProjectionState(ctx.storage).control().publishedRoot!;
        const changed = JSON.stringify({ ...root, byteLength: root.byteLength + 1 });
        ctx.storage.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=?,published_root=? WHERE id=1", changed, changed);
        ctx.storage.sql.exec("UPDATE usage_contribution_projection_publications SET root=? WHERE revision=3", changed);
      }
      return original.CONTROL.get(...args);
    } } } as unknown as Env;
    try { expect(await instance.executeContributionRebuild(advance(1))).toEqual({ ok: false, error: "conflict" }); }
    finally { owner.env = original; }
  });
});

test("a late fence acquisition settles its grant after the deadline without touching canonical storage", async () => {
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const held = Promise.withResolvers<unknown>(), entered = Promise.withResolvers<{ attemptId: string; epoch: number }>();
    const assertOpen = vi.fn((input: { attemptId: string; epoch: number }) => { entered.resolve(input); return held.promise; });
    const release = vi.fn(async () => ({ ok: true, value: null, [Symbol.dispose]() {} })), get = vi.fn(original.CONTROL.get.bind(original.CONTROL));
    owner.env = { ...original, RESTORE_FENCES: { getByName: () => ({ assertOpen, release }) }, CONTROL: { get } } as unknown as Env;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] }); vi.setSystemTime(now);
    try {
      const pending = instance.executeContributionRebuild(begin()), attempt = await entered.promise;
      await vi.advanceTimersByTimeAsync(CONTRIBUTION_REBUILD_DEADLINE_MS);
      expect(await pending).toEqual({ ok: false, error: "deadline" });
      const exec = vi.spyOn(ctx.storage.sql, "exec"), disposed = vi.fn();
      held.resolve({ ok: true, value: { token: attempt.attemptId, epoch: attempt.epoch, established: true, deadlineMs: now + 60_000 }, [Symbol.dispose]: disposed });
      for (let step = 0; step < 12; step++) await Promise.resolve();
      expect(exec).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(assertOpen).toHaveBeenCalledTimes(1);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledExactlyOnceWith({ accountId, token: attempt.attemptId, committed: true });
    } finally { owner.env = original; vi.useRealTimers(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); }
  });
});

test("a storage timeout preserves pending charge and restore custody until the actual put settles", async () => {
  success(await stub().executeContributionRebuild(begin()));
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    let allow = false;
    const put = vi.fn(async (...args: Parameters<R2Bucket["put"]>) => {
      if (!allow) { entered.resolve(); await held.promise; }
      return original.STAGING.put(...args);
    });
    owner.env = { ...original, STAGING: new Proxy(original.STAGING, { get: (target, property) => {
      if (property === "put") return put;
      const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    } }) } as Env;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] }); vi.setSystemTime(now);
    try {
      const pending = instance.executeContributionRebuild(advance(1)); await entered.promise;
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await pending).toEqual({ ok: false, error: "storage_unavailable" });
      const status = success(await instance.readContributionRebuild(request()))!;
      expect(status).toMatchObject({ pending: true, receipt: { version: 1, processedHeads: 0 } });
      expect(status.chargedBytes).toBeGreaterThan(0);
      const fence = env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
      expect(success(await fence.read(scope())).inFlight).toBe(1);
      const charge = new ContributionProjectionState(ctx.storage).control().immutableBytes;
      const puts = put.mock.calls.length;
      allow = true; held.resolve();
      // Wait on the real provider call, then its custody-release continuation.
      await Promise.all(put.mock.results.map(item => item.value));
      for (let step = 0; step < 20; step++) await Promise.resolve();
      expect(put).toHaveBeenCalledTimes(puts);
      expect(success(await fence.read(scope())).inFlight).toBe(0);
      const recovered = success(await instance.executeContributionRebuild(advance(1)));
      expect(recovered).toMatchObject({ version: 2, phase: "comparing", chargedBytes: status.chargedBytes });
      expect(new ContributionProjectionState(ctx.storage).control().immutableBytes).toBe(charge);
    } finally { allow = true; held.resolve(); owner.env = original; vi.useRealTimers(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); }
  });
});
