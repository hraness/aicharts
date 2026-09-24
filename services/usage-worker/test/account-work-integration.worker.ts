import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE } from "../../../lib/usage/contributions";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { ContributionProjectionState } from "../src/contribution-projection-state";
import { AccountWorkState } from "../src/account-work-state";
import { restoreFenceName } from "../src/restore-fence";
import { ContributionState } from "../src/contributions-state";

const hex = (value: number, width = 64) => value.toString(16).padStart(width, "0");
const NOW = Date.UTC(2031, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000), POPULATION = hex(7);
let serial = 800_000, accountId = "", now = NOW, deviceId = "";
let proof: { intentId: string; pollSecret: string; uploadSecret: string };
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId));
const scope = () => ({ accountId, generation: env.USAGE_ENROLLMENT_GENERATION });
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic background refusal: ${result.error}`); return result.value;
};
const advanceTime = (value: number) => { now = value; vi.setSystemTime(now); };
const state = () => runInDurableObject(stub(), (_instance, ctx) => ({
  work: new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true }),
  projection: new ContributionProjectionState(ctx.storage).status(now),
}));
async function fireAt(value: number) {
  advanceTime(value);
  await runInDurableObject(stub(), async (instance, ctx) => {
    // Manual fixture invocation models the provider consuming this exact wake.
    await ctx.storage.deleteAlarm(); await instance.alarm();
  });
}
const activation = () => ({ schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), expectedRevision: 0, mode: "fresh-empty" });
beforeEach(async () => {
  now = NOW; accountId = `acct_${hex(++serial, 32)}`; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  proof = { intentId: hex(++serial), pollSecret: hex(++serial), uploadSecret: hex(++serial) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(++serial);
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret,
    uploadCommitment: success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret)) }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId, authTimeMs: now, sessionExpiresAtMs: now + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId, liveSessionExpiresAtMs: now + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId }));
  success(await pairing.reserveEnrollment(proof));
  await runInDurableObject(stub(), instance => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
  });
  deviceId = success(await stub().enroll(proof)).receipt.deviceId;
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers(); await abortAllDurableObjects();
  for (const bucket of [env.STAGING, env.CONTROL]) { const objects = (await bucket.list()).objects; if (objects.length) await bucket.delete(objects.map(object => object.key)); }
  await reset();
});
async function activate() { success(await stub().activateContributions({ uploadSecret: proof.uploadSecret, request: activation() })); }
async function preparePut() {
  success(await stub().grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: { schemaVersion: 3, ...scope(), deviceId,
    operationId: hex(++serial), populationId: POPULATION, expectedRevision: 1, expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
  return { schemaVersion: 3, ...scope(), deviceId,
    profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY, grain: "observation", operationId: hex(++serial), sequence: 1,
    expectedRevision: 2, populationId: POPULATION, writerRevision: 1, expectedPopulationRevision: 0,
    expectedPopulationHead: "0".repeat(64), replacement: null,
    mutations: [{ kind: "put", id: hex(1, 32), expectedHeadHash: null, row: { utcDay: DAY, client: "codex", provider: null, model: null,
      records: 1, tokens: { input: "7", cacheRead: "0", cacheWrite: "0", output: "9", reasoning: "0" },
      reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "complete" } }],
  };
}
async function put() { success(await stub().admitContributions({ uploadSecret: proof.uploadSecret, request: await preparePut() })); }
test("a failed alarm arm cannot activate or commit source progress", async () => {
  await runInDurableObject(stub(), async (instance, ctx) => {
    const before = ctx.storage.sql.exec("SELECT * FROM account_enrollment").toArray();
    const alarm = vi.spyOn(ctx.storage, "setAlarm").mockRejectedValueOnce(new Error("synthetic storage unavailable"));
    expect(await instance.activateContributions({ uploadSecret: proof.uploadSecret, request: activation() })).toMatchObject({ ok: false, error: "storage_unavailable" });
    expect(ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='usage_contribution_control'").toArray()).toEqual([]);
    expect(ctx.storage.sql.exec("SELECT payload FROM account_enrollment").one().payload).toBe(before[0].payload);
    alarm.mockRestore();
  });
});
test("source commits durably schedule bounded projection and publication without a maintenance caller", async () => {
  await activate(); await put();
  expect((await state()).projection).toMatchObject({ sourceRevision: 3, appliedRevision: 0, publishedRevision: 0 });
  for (let step = 0; step < 12; step++) {
    const scheduled = await runInDurableObject(stub(), (_instance, ctx) => ctx.storage.getAlarm());
    if (scheduled === null) break;
    await fireAt(Math.max(now + 1, scheduled));
  }
  expect((await state()).projection).toMatchObject({ sourceRevision: 3, appliedRevision: 3, publishedRevision: 3, publishedLag: 0 });
  const page = success(await stub().readContributionPage({ schemaVersion: 3, accountId, sessionExpiresAtMs: now + PAIRING_TTL_MS,
    firstUtcDay: DAY, dayCount: 1, limit: 256, cursor: null }));
  expect(page.cells).toMatchObject([{ observations: 1, tokens: { input: "7", output: "9" } }]);
  const putSpy = vi.spyOn(env.STAGING, "put"); await fireAt(now + 1); await fireAt(now + 1);
  expect(putSpy).not.toHaveBeenCalled(); expect((await state()).work.projection.nextAtMs).toBeNull();
});
test("an unavailable consent delivery cannot prevent one projection step from starting", async () => {
  await activate();
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env };
    const original = owner.env;
    owner.env = { ...original, PUBLIC_INDEX: { getByName: () => ({ async applyConsent() { throw new Error("synthetic unavailable"); } }) } } as unknown as Env;
    expect(await instance.setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId, sessionExpiresAtMs: now + PAIRING_TTL_MS,
      consent: true, publicHandle: "synthetic-person" })).toMatchObject({ ok: false, error: "storage_unavailable" });
    advanceTime(now + 1); await ctx.storage.deleteAlarm(); await instance.alarm();
    expect(new ContributionProjectionState(ctx.storage).status(now).appliedRevision).toBe(1);
    const work = new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true });
    expect(work.consent.attempts).toBe(1); expect(work.consent.nextAtMs).toBeGreaterThan(now);
    owner.env = original;
  });
});
test("restart retains transient retry exhaustion until explicit maintenance or actual position progress", async () => {
  await activate();
  for (let attempt = 1; attempt <= 8; attempt++) {
    await runInDurableObject(stub(), async (instance, ctx) => {
      const owner = instance as unknown as { env: Env }, original = owner.env;
      owner.env = { ...original, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1",
        CONTROL: { ...original.CONTROL, get: async () => { throw new Error("synthetic object unavailable"); } } } as unknown as Env;
      const value = new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true }).projection;
      advanceTime(Math.max(now + 1, value.nextAtMs!)); await ctx.storage.deleteAlarm(); await instance.alarm();
      expect(new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true }).projection.attempts).toBe(attempt);
      owner.env = original;
    });
    await abortAllDurableObjects();
  }
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
    const blocked = new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true }).projection;
    expect(blocked).toMatchObject({ blocked: "retry_exhausted", attempts: 8, nextAtMs: null });
    await ctx.storage.deleteAlarm(); await instance.alarm();
    expect(new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true }).projection).toEqual(blocked);
    success(await instance.advanceContributionProjection({ schemaVersion: 3, ...scope() }));
    expect(new ContributionProjectionState(ctx.storage).status(now).appliedRevision).toBe(1);
  });
});
test("held consent yields to every projection step, consumes one watchdog, and retains restore custody", async () => {
  await activate(); await put();
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const delivery = Promise.withResolvers<{ ok: true; value: null }>();
    const index = vi.fn(async () => {
      if (index.mock.calls.length === 1) throw new Error("synthetic initial refusal");
      return delivery.promise.then(value => ({ ...value, [Symbol.dispose]() {} }));
    });
    const fence = env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    owner.env = { ...original, PUBLIC_INDEX: { getByName: () => ({ applyConsent: index }) } } as unknown as Env;
    try {
      expect(await instance.setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId, sessionExpiresAtMs: now + PAIRING_TTL_MS,
        consent: true, publicHandle: "synthetic-held-person" })).toMatchObject({ ok: false, error: "storage_unavailable" });
      advanceTime(now + 1); await ctx.storage.deleteAlarm();
      await instance.alarm(); // Returns while the second index call is held.
      expect(index).toHaveBeenCalledTimes(2);
      expect(success(await fence.read(scope())).inFlight).toBe(1);
      for (let step = 0; step < 24; step++) {
        const scheduled = await ctx.storage.getAlarm(); if (scheduled === null) break;
        advanceTime(Math.max(now + 1, scheduled)); await ctx.storage.deleteAlarm(); await instance.alarm();
      }
      expect(new ContributionProjectionState(ctx.storage).status(now)).toMatchObject({ sourceRevision: 3, appliedRevision: 3, publishedRevision: 3 });
      expect(index).toHaveBeenCalledTimes(2);
      expect(await ctx.storage.getAlarm()).toBeNull();
      expect(success(await fence.read(scope())).inFlight).toBe(1);
      const exec = vi.spyOn(ctx.storage.sql, "exec"), arm = vi.spyOn(ctx.storage, "setAlarm");
      const status = success(await instance.readContributionWork({ schemaVersion: 3, ...scope() }));
      expect(status.consent.flight).toMatchObject({ status: "awaiting_settlement", watchAtMs: null });
      expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true); expect(arm).not.toHaveBeenCalled();
      exec.mockRestore(); arm.mockRestore();
      const close = success(await fence.close({ ...scope(), epoch: 0, workerVersion: env.USAGE_WORKER_VERSION }));
      expect(close.inFlight).toBe(1);
      expect(await fence.publish({ ...scope(), epoch: 1, workerVersion: env.USAGE_WORKER_VERSION })).toMatchObject({ ok: false, error: "recovery_required" });
      delivery.resolve({ ok: true, value: null });
      await vi.waitFor(async () => { expect(success(await fence.read(scope())).inFlight).toBe(0); });
      const completed = new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: Date.now(), active: true }).consent;
      expect(completed).toMatchObject({ flight: null, attempts: 0, blocked: null, nextAtMs: null });
      expect(completed.acknowledgedKey).toBe(completed.key);
    } finally {
      delivery.resolve({ ok: true, value: null });
      await vi.waitFor(async () => { expect(success(await fence.read(scope())).inFlight).toBe(0); });
      owner.env = original;
    }
  });
});
test("a persisted unresolved dispatch survives eviction without redispatch or empty alarm polling", async () => {
  await activate();
  await runInDurableObject(stub(), (_instance, ctx) => {
    advanceTime(now + 1);
    const work = new AccountWorkState(ctx.storage), authority = { ...scope(), observedAtMs: now, active: true };
    expect(work.claim("projection", authority)).not.toBeNull();
  });
  await abortAllDurableObjects();
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env };
    owner.env = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_CONTRIBUTIONS_ENABLED: "1" } as Env;
    const before = new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true }).projection;
    expect(before.flight?.status).toBe("running");
    advanceTime(before.flight!.watchAtMs!); await ctx.storage.deleteAlarm(); await instance.alarm();
    const current = success(await instance.readContributionWork({ schemaVersion: 3, ...scope() }));
    expect(current.projection.flight).toMatchObject({ status: "awaiting_settlement", watchAtMs: null });
    expect(new ContributionProjectionState(ctx.storage).status(now).appliedRevision).toBe(0);
    expect(await ctx.storage.getAlarm()).toBeNull();
    await instance.alarm(); expect(await ctx.storage.getAlarm()).toBeNull();
    success(await instance.advanceContributionProjection({ schemaVersion: 3, ...scope() }));
    expect(new ContributionProjectionState(ctx.storage).status(now).appliedRevision).toBe(1);
  });
});
test("failed late completion arm retains its visible unresolved flight instead of stranding a retry", async () => {
  await activate();
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const delivery = Promise.withResolvers<never>(), fence = env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    const index = vi.fn(async () => {
      if (index.mock.calls.length === 1) throw new Error("synthetic initial refusal");
      return delivery.promise;
    });
    owner.env = { ...original, PUBLIC_INDEX: { getByName: () => ({ applyConsent: index }) } } as unknown as Env;
    let arm: ReturnType<typeof vi.spyOn> | undefined;
    try {
      expect(await instance.setLeaderboardConsent({ schemaVersion: 1, operation: "set", accountId, sessionExpiresAtMs: now + PAIRING_TTL_MS,
        consent: true, publicHandle: "synthetic-held-refusal" })).toMatchObject({ ok: false, error: "storage_unavailable" });
      advanceTime(now + 1); await ctx.storage.deleteAlarm(); await instance.alarm();
      const flight = new AccountWorkState(ctx.storage).snapshot({ ...scope(), observedAtMs: now, active: true }).consent.flight!;
      advanceTime(flight.watchAtMs!); await ctx.storage.deleteAlarm(); await instance.alarm();
      // Consume any publication/completion wake before releasing the held call.
      for (let step = 0; step < 6; step++) {
        const scheduled = await ctx.storage.getAlarm(); if (scheduled === null) break;
        advanceTime(Math.max(now + 1, scheduled)); await ctx.storage.deleteAlarm(); await instance.alarm();
      }
      expect(await ctx.storage.getAlarm()).toBeNull();
      arm = vi.spyOn(ctx.storage, "setAlarm").mockRejectedValueOnce(new Error("synthetic completion arm unavailable"));
      delivery.reject(new Error("synthetic late index outage"));
      await vi.waitFor(async () => { expect(success(await fence.read(scope())).inFlight).toBe(0); });
      expect(arm).toHaveBeenCalledTimes(1);
      expect(await ctx.storage.getAlarm()).toBeNull();
      const work = success(await instance.readContributionWork({ schemaVersion: 3, ...scope() }));
      expect(work.consent).toMatchObject({ attempts: 1, flight: { status: "awaiting_settlement", watchAtMs: null } });
      arm.mockRestore(); arm = undefined;
      await instance.alarm(); expect(index).toHaveBeenCalledTimes(2); expect(await ctx.storage.getAlarm()).toBeNull();
    } finally {
      delivery.reject(new Error("synthetic fixture completion")); arm?.mockRestore();
      await vi.waitFor(async () => { expect(success(await fence.read(scope())).inFlight).toBe(0); }); owner.env = original;
    }
  });
});
test("failed precommit rearm after held immutable I/O preserves one exact source reservation", async () => {
  await activate(); const request = await preparePut();
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const delayed = new Proxy(original.STAGING, { get(target, property) {
      if (property === "put") return async (...args: Parameters<R2Bucket["put"]>) => {
        entered.resolve(); await release.promise; return target.put(...args);
      };
      const member = Reflect.get(target, property); return typeof member === "function" ? member.bind(target) : member;
    } });
    owner.env = { ...original, STAGING: delayed };
    const pending = instance.admitContributions({ uploadSecret: proof.uploadSecret, request });
    let arm: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await entered.promise;
      const source = new ContributionState(ctx.storage), reserved = source.control();
      expect(reserved).toMatchObject({ revision: 2, pendingOperation: request.operationId });
      expect(source.head(hex(1, 32))).toBeNull();
      advanceTime(now + 1); await ctx.storage.deleteAlarm(); await instance.alarm();
      await ctx.storage.deleteAlarm();
      arm = vi.spyOn(ctx.storage, "setAlarm").mockRejectedValueOnce(new Error("synthetic precommit arm unavailable"));
      release.resolve();
      expect(await pending).toMatchObject({ ok: false, error: "storage_unavailable" });
      expect(arm).toHaveBeenCalled();
      const refused = source.control();
      expect(refused).toMatchObject({ revision: 2, immutableBytes: reserved.immutableBytes, pendingOperation: request.operationId });
      expect(source.head(hex(1, 32))).toBeNull(); expect(source.operation(request.operationId)?.outcome).toBe("pending");
      arm.mockRestore(); arm = undefined;
      const receipt = success(await instance.admitContributions({ uploadSecret: proof.uploadSecret, request }));
      expect(receipt).toMatchObject({ outcome: "committed", receipt: { revision: 3 } });
      expect(source.control()).toMatchObject({ revision: 3, immutableBytes: reserved.immutableBytes, pendingOperation: null });
      expect(source.head(hex(1, 32))?.deleted).toBe(false);
      expect(success(await instance.admitContributions({ uploadSecret: proof.uploadSecret, request }))).toEqual(receipt);
      expect(source.control().revision).toBe(3);
    } finally { release.resolve(); await pending; arm?.mockRestore(); owner.env = original; }
  });
});
test("foreground projection rechecks exclusion after acquisition and shares alarm dispatch custody", async () => {
  await activate();
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const acquireEntered = Promise.withResolvers<void>(), acquireRelease = Promise.withResolvers<void>();
    const objectEntered = Promise.withResolvers<void>(), objectRelease = Promise.withResolvers<void>();
    let acquisitions = 0, reads = 0;
    const actualFence = original.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    const control = new Proxy(original.CONTROL, { get(target, property) {
      if (property === "get") return async (...args: Parameters<R2Bucket["get"]>) => {
        reads++; objectEntered.resolve(); await objectRelease.promise; return target.get(...args);
      };
      const member = Reflect.get(target, property); return typeof member === "function" ? member.bind(target) : member;
    } });
    owner.env = { ...original, CONTROL: control, RESTORE_FENCES: { getByName: () => ({
      async assertOpen(input: unknown) {
        if (++acquisitions === 1) { acquireEntered.resolve(); await acquireRelease.promise; }
        return actualFence.assertOpen(input);
      },
      release: (input: unknown) => actualFence.release(input), cancelAcquire: (input: unknown) => actualFence.cancelAcquire(input),
    }) } } as unknown as Env;
    const foreground = instance.advanceContributionProjection({ schemaVersion: 3, ...scope() });
    try {
      await acquireEntered.promise;
      advanceTime(now + 1); await ctx.storage.deleteAlarm(); const alarm = instance.alarm();
      await objectEntered.promise; await alarm;
      expect(reads).toBe(1); expect(success(await actualFence.read(scope())).inFlight).toBe(1);
      acquireRelease.resolve();
      expect(await foreground).toMatchObject({ ok: false, error: "conflict" });
      expect(reads).toBe(1); expect(success(await actualFence.read(scope())).inFlight).toBe(1);
      expect(await instance.advanceContributionProjection({ schemaVersion: 3, ...scope() })).toMatchObject({ ok: false, error: "conflict" });
      objectRelease.resolve();
      await vi.waitFor(async () => { expect(success(await actualFence.read(scope())).inFlight).toBe(0); });
      expect(new ContributionProjectionState(ctx.storage).status(Date.now()).appliedRevision).toBe(1);
    } finally {
      acquireRelease.resolve(); objectRelease.resolve(); await foreground;
      await vi.waitFor(async () => { expect(success(await actualFence.read(scope())).inFlight).toBe(0); }); owner.env = original;
    }
  });
});
