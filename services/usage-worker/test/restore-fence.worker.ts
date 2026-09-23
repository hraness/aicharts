import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { enrollmentRandom } from "../src/enrollment-contract";
import { RESTORE_FENCE_MAX_ATTEMPTS, restoreFenceName, type RestoreFence, type RestoreFenceResult, type RestoreFenceLease, type RestoreFenceView } from "../src/restore-fence";

const account = () => `acct_${enrollmentRandom().slice(0, 32)}`;
const VERSION = env.USAGE_WORKER_VERSION;
const OTHER_VERSION = "3333333333333333333333333333333333333333333333333333333333333333";

const stub = (accountId: string) => env.RESTORE_FENCES.getByName(restoreFenceName(accountId)) as unknown as {
  read(input: unknown): Promise<RestoreFenceResult<RestoreFenceView>>;
  assertOpen(input: unknown): Promise<RestoreFenceResult<RestoreFenceLease>>;
  release(input: unknown): Promise<RestoreFenceResult<null>>;
  cancelAcquire(input: unknown): Promise<RestoreFenceResult<null>>;
  close(input: unknown): Promise<RestoreFenceResult<RestoreFenceView>>;
  publish(input: unknown): Promise<RestoreFenceResult<RestoreFenceView>>;
};
const view = (r: RestoreFenceResult<RestoreFenceView>) => { if (!r.ok) throw new Error(r.error); return r.value; };
const lease = (r: RestoreFenceResult<RestoreFenceLease>) => { if (!r.ok) throw new Error(r.error); return r.value; };
const fail = <T>(r: RestoreFenceResult<T>) => { if (r.ok) throw new Error("expected refusal"); return r.error; };

describe("RestoreFence", () => {
  beforeEach(() => reset());

  it("initializes a fresh account at the genesis epoch and grants a lease", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const first = view(await stub(accountId).read({ accountId, generation }));
    expect(first.record).toBeNull();
    expect(first.inFlight).toBe(0);
    const grant = lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    expect(grant.epoch).toBe(0);
    expect(grant.established).toBe(false);
    expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(1);
    expect((await stub(accountId).release({ accountId, token: grant.token, committed: true })).ok).toBe(true);
    expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(0);
  });

  it("records establishment on the first committed release", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const grant = lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    await stub(accountId).release({ accountId, token: grant.token, committed: true });
    const next = lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    expect(next.established).toBe(true);
    await stub(accountId).release({ accountId, token: next.token, committed: false });
  });

  it("refuses a stale epoch after publish", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const grant = lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    await stub(accountId).release({ accountId, token: grant.token, committed: true });
    view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    expect(fail(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }))).toBe("recovery_required");
    expect(lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 1, workerVersion: VERSION, leaseMs: 5000 })).epoch).toBe(1);
  });

  it("refuses a deployment version mismatch", async () => {
    const accountId = account(), generation = enrollmentRandom();
    expect(fail(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: OTHER_VERSION, leaseMs: 5000 }))).toBe("recovery_required");
  });

  it("refuses a generation mismatch against an existing record", async () => {
    const accountId = account(), generation = enrollmentRandom();
    lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    expect(fail(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation: enrollmentRandom(), epoch: 0, workerVersion: VERSION, leaseMs: 5000 }))).toBe("recovery_required");
  });

  it("blocks new operations while closed and drains in-flight leases before publish", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const inFlight = lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    const closed = view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    expect(closed.record?.phase).toBe("closed");
    expect(closed.inFlight).toBe(1);
    // The barrier refuses new operations during close.
    expect(fail(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }))).toBe("recovery_required");
    // Publish cannot proceed while a lease is still outstanding.
    expect(fail(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }))).toBe("recovery_required");
    // The in-flight operation settles; the drain completes and publish opens epoch 1.
    await stub(accountId).release({ accountId, token: inFlight.token, committed: true });
    const reopened = view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    expect(reopened.record?.epoch).toBe(1);
    expect(reopened.record?.phase).toBe("open");
  });

  it("rejects publish that does not strictly advance the epoch, and reconciles an uncertain publish", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const grant = lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    await stub(accountId).release({ accountId, token: grant.token, committed: true });
    view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    expect(fail(await stub(accountId).publish({ accountId, generation, epoch: 0, workerVersion: VERSION }))).toBe("recovery_required");
    view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    // A lost reply retries publish and reconciles on the identical open record.
    const again = view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    expect(again.record?.epoch).toBe(1);
  });

  it("a diagnostic deadline never releases a live holder or permits epoch publication", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const grant = lease(await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 1 }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION })).inFlight).toBe(1);
    expect(fail(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }))).toBe("recovery_required");
    await stub(accountId).release({ accountId, token: grant.token, committed: true });
    const reopened = view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    expect(reopened.record?.epoch).toBe(1);
  });

  it("fresh reads do not create schemas and ordinary reads do not expire registrations", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const binding = env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    view(await stub(accountId).read({ accountId, generation }));
    const names = await runInDurableObject(binding, (_instance: RestoreFence, state) =>
      state.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv'").toArray());
    expect(names).toEqual([]);
  });

  it("lost grant replies reconcile the exact attempt, including after close", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const request = { accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000, attemptId: enrollmentRandom() };
    const first = lease(await stub(accountId).assertOpen(request));
    view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    const readback = lease(await stub(accountId).assertOpen(request));
    expect(readback).toEqual(first);
    expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(1);
    expect((await stub(accountId).release({ accountId, token: first.token, committed: false })).ok).toBe(true);
    expect((await stub(accountId).release({ accountId, token: first.token, committed: false })).ok).toBe(true);
    expect(fail(await stub(accountId).assertOpen(request))).toBe("conflict");
  });

  it("terminal cancellation fences both reordered future grants and granted-but-lost replies", async () => {
    for (const granted of [false, true]) {
      const accountId = account(), generation = enrollmentRandom();
      const cancellation = { accountId, generation, epoch: 0, workerVersion: VERSION, attemptId: enrollmentRandom() };
      const request = { ...cancellation, leaseMs: 5000 };
      if (granted) lease(await stub(accountId).assertOpen(request));
      expect((await stub(accountId).cancelAcquire(cancellation)).ok).toBe(true);
      expect((await stub(accountId).cancelAcquire(cancellation)).ok).toBe(true);
      expect(fail(await stub(accountId).assertOpen(request))).toBe("conflict");
      expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(0);
      expect(fail(await stub(accountId).release({ accountId, token: cancellation.attemptId, committed: true }))).toBe("conflict");
      expect(view(await stub(accountId).read({ accountId, generation })).record?.established).toBe(false);
    }
  });

  it("independent executions cannot settle each other's outstanding continuation", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const request = { accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 };
    const first = lease(await stub(accountId).assertOpen({ ...request, attemptId: enrollmentRandom() }));
    const second = lease(await stub(accountId).assertOpen({ ...request, attemptId: enrollmentRandom() }));
    expect(view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION })).inFlight).toBe(2);
    await stub(accountId).release({ accountId, token: first.token, committed: false });
    expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(1);
    expect(fail(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }))).toBe("recovery_required");
    await stub(accountId).release({ accountId, token: second.token, committed: false });
    expect(view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION })).inFlight).toBe(0);
    expect(fail(await stub(accountId).release({ accountId, token: first.token, committed: true }))).toBe("conflict");
    expect(fail(await stub(accountId).release({ accountId, token: enrollmentRandom(), committed: true }))).toBe("not_found");
    expect(view(await stub(accountId).read({ accountId, generation })).record?.established).toBe(false);
  });

  it("capacity refuses new attempts while existing unknown grants still reconcile and cancel", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const cancellation = { accountId, generation, epoch: 0, workerVersion: VERSION, attemptId: enrollmentRandom() };
    const request = { ...cancellation, leaseMs: 5000 };
    const grant = lease(await stub(accountId).assertOpen(request));
    const binding = env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    await runInDurableObject(binding, (_instance: RestoreFence, state) => {
      state.storage.sql.exec("UPDATE restore_fence SET revision = ? WHERE id = 1", RESTORE_FENCE_MAX_ATTEMPTS);
    });
    expect(lease(await stub(accountId).assertOpen(request))).toEqual(grant);
    expect(fail(await stub(accountId).assertOpen({ ...request, attemptId: enrollmentRandom() }))).toBe("limit");
    expect((await stub(accountId).cancelAcquire(cancellation)).ok).toBe(true);
    expect((await stub(accountId).cancelAcquire(cancellation)).ok).toBe(true);
    expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(0);
  });
});
