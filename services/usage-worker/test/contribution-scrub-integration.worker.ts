import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_IDENTITY, CONTRIBUTION_PROFILE } from "../../../lib/usage/contributions";
import { CONTRIBUTION_SCRUB_DEADLINE_MS, type ContributionScrubRequest } from "../../../lib/usage/contribution-scrub";
import { ContributionProjectionState } from "../src/contribution-projection-state";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { restoreFenceName } from "../src/restore-fence";

const hex = (n: number, width = 64) => n.toString(16).padStart(width, "0");
const NOW = Date.UTC(2032, 8, 23, 12), DAY = Math.floor(NOW / 86_400_000), POPULATION = hex(5);
let serial = 900_000, accountId = "", deviceId = "", now = NOW;
let proof: { intentId: string; pollSecret: string; uploadSecret: string };
const scope = () => ({ accountId, generation: env.USAGE_ENROLLMENT_GENERATION });
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`synthetic scrub refusal: ${result.error}`); return result.value;
};
const request = (): ContributionScrubRequest => ({ schemaVersion: 3, ...scope(), expectedRevision: 3,
  dimensions: { utcDay: DAY, client: "codex", provider: null, model: null,
    tokenBasis: "reported", breakdownCoverage: "complete", costKind: "none", timed: false } });

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

test("the trusted scrub RPC returns a scoped match with SELECT-only local reads and no writes or alarm", async () => {
  await runInDurableObject(stub(), async (instance, ctx) => {
    const exec = vi.spyOn(ctx.storage.sql, "exec"), arm = vi.spyOn(ctx.storage, "setAlarm");
    const put = vi.spyOn(env.STAGING, "put"), del = vi.spyOn(env.STAGING, "delete"), controlPut = vi.spyOn(env.CONTROL, "put");
    const value = success(await instance.scrubContributionCell(request()));
    expect(value).toMatchObject({ scope: "single-cell", verdict: "match", revision: 3, checkedHeads: 1, liveHeads: 1,
      matchingHeads: 1, sourceObjects: 1, indexObjects: 1, expected: { observations: 1, tokens: { input: "7", output: "9" } } });
    expect(value.published).toEqual(value.expected);
    expect(exec.mock.calls.length).toBeGreaterThan(0); expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    expect(arm).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled(); expect(controlPut).not.toHaveBeenCalled();
  });
});

test("a namespace loss during the final external check refuses an otherwise matched cell", async () => {
  await runInDurableObject(stub(), async (instance) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    let calls = 0;
    const get = vi.fn((...args: Parameters<R2Bucket["get"]>) => ++calls === 2 ? Promise.resolve(null) : original.CONTROL.get(...args));
    owner.env = { ...original, CONTROL: { get } } as unknown as Env;
    try {
      expect(await instance.scrubContributionCell(request())).toEqual({ ok: false, error: "recovery_required" });
      expect(calls).toBe(2);
    } finally { owner.env = original; }
  });
});

test("a canonical commit during the final namespace await invalidates the prior receipt", async () => {
  await runInDurableObject(stub(), async instance => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    let calls = 0;
    owner.env = { ...original, CONTROL: { get: async (...args: Parameters<R2Bucket["get"]>) => {
      if (++calls === 2) success(await instance.grantContributionPopulation({ uploadSecret: proof.uploadSecret, request: {
        schemaVersion: 3, ...scope(), deviceId, operationId: hex(++serial), populationId: hex(6), expectedRevision: 3,
        expectedWriterRevision: 0, previousDeviceId: null, abandonOperationId: null } }));
      return original.CONTROL.get(...args);
    } } } as unknown as Env;
    try { expect(await instance.scrubContributionCell(request())).toEqual({ ok: false, error: "conflict" }); }
    finally { owner.env = original; }
  });
});

test("closing the external restore fence during final checks refuses the numeric receipt", async () => {
  await runInDurableObject(stub(), async instance => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    let calls = 0;
    owner.env = { ...original, CONTROL: { get: async (...args: Parameters<R2Bucket["get"]>) => {
      if (++calls === 2) success(await env.RESTORE_FENCES.getByName(restoreFenceName(accountId)).close({ ...scope(), epoch: 0, workerVersion: env.USAGE_WORKER_VERSION }));
      return original.CONTROL.get(...args);
    } } } as unknown as Env;
    try { expect(await instance.scrubContributionCell(request())).toEqual({ ok: false, error: "recovery_required" }); }
    finally { owner.env = original; }
  });
});

test("a changed publication reference with the same object hash invalidates the receipt", async () => {
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    let calls = 0;
    owner.env = { ...original, CONTROL: { get: async (...args: Parameters<R2Bucket["get"]>) => {
      if (++calls === 2) {
        const root = new ContributionProjectionState(ctx.storage).control().publishedRoot!;
        const changed = JSON.stringify({ ...root, byteLength: root.byteLength + 1 });
        ctx.storage.sql.exec("UPDATE usage_contribution_projection_control SET applied_root=?,published_root=? WHERE id=1", changed, changed);
        ctx.storage.sql.exec("UPDATE usage_contribution_projection_publications SET root=? WHERE revision=3", changed);
      }
      return original.CONTROL.get(...args);
    } } } as unknown as Env;
    try { expect(await instance.scrubContributionCell(request())).toEqual({ ok: false, error: "conflict" }); }
    finally { owner.env = original; }
  });
});

test("the whole-invocation deadline retires a held fence response before further private work", async () => {
  await runInDurableObject(stub(), async (instance, ctx) => {
    const owner = instance as unknown as { env: Env }, original = owner.env;
    const held = Promise.withResolvers<{ ok: false; error: "storage_unavailable"; [Symbol.dispose](): void }>();
    const entered = Promise.withResolvers<void>();
    const read = vi.fn(() => { entered.resolve(); return held.promise; });
    const get = vi.fn(original.CONTROL.get.bind(original.CONTROL));
    owner.env = { ...original, RESTORE_FENCES: { getByName: () => ({ read }) }, CONTROL: { get } } as unknown as Env;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] }); vi.setSystemTime(now);
    try {
      const pending = instance.scrubContributionCell(request()); await entered.promise;
      await vi.advanceTimersByTimeAsync(CONTRIBUTION_SCRUB_DEADLINE_MS);
      expect(await pending).toEqual({ ok: false, error: "deadline" });
      const exec = vi.spyOn(ctx.storage.sql, "exec"), disposed = vi.fn();
      held.resolve({ ok: false, error: "storage_unavailable", [Symbol.dispose]: disposed });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(disposed).toHaveBeenCalledTimes(1); expect(exec).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledTimes(1);
    } finally { owner.env = original; vi.useRealTimers(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); }
  });
});
