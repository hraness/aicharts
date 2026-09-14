import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { enrollmentRandom } from "../src/enrollment-contract";
import { restoreFenceName, type RestoreFence, type RestoreFenceResult, type RestoreFenceLease, type RestoreFenceView } from "../src/restore-fence";

const account = () => `acct_${enrollmentRandom().slice(0, 32)}`;
const VERSION = env.USAGE_WORKER_VERSION;
const OTHER_VERSION = "3333333333333333333333333333333333333333333333333333333333333333";

const stub = (accountId: string) => env.RESTORE_FENCES.getByName(restoreFenceName(accountId)) as unknown as {
  read(input: unknown): Promise<RestoreFenceResult<RestoreFenceView>>;
  assertOpen(input: unknown): Promise<RestoreFenceResult<RestoreFenceLease>>;
  release(input: unknown): Promise<RestoreFenceResult<null>>;
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
    const grant = lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    expect(grant.epoch).toBe(0);
    expect(grant.established).toBe(false);
    expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(1);
    expect((await stub(accountId).release({ accountId, token: grant.token, committed: true })).ok).toBe(true);
    expect(view(await stub(accountId).read({ accountId, generation })).inFlight).toBe(0);
  });

  it("records establishment on the first committed release", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const grant = lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    await stub(accountId).release({ accountId, token: grant.token, committed: true });
    const next = lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    expect(next.established).toBe(true);
    await stub(accountId).release({ accountId, token: next.token, committed: false });
  });

  it("refuses a stale epoch after publish", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const grant = lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    await stub(accountId).release({ accountId, token: grant.token, committed: true });
    view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    expect(fail(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }))).toBe("recovery_required");
    expect(lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 1, workerVersion: VERSION, leaseMs: 5000 })).epoch).toBe(1);
  });

  it("refuses a deployment version mismatch", async () => {
    const accountId = account(), generation = enrollmentRandom();
    expect(fail(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: OTHER_VERSION, leaseMs: 5000 }))).toBe("recovery_required");
  });

  it("refuses a generation mismatch against an existing record", async () => {
    const accountId = account(), generation = enrollmentRandom();
    lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    expect(fail(await stub(accountId).assertOpen({ accountId, generation: enrollmentRandom(), epoch: 0, workerVersion: VERSION, leaseMs: 5000 }))).toBe("recovery_required");
  });

  it("blocks new operations while closed and drains in-flight leases before publish", async () => {
    const accountId = account(), generation = enrollmentRandom();
    const inFlight = lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    const closed = view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    expect(closed.record?.phase).toBe("closed");
    expect(closed.inFlight).toBe(1);
    // The barrier refuses new operations during close.
    expect(fail(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }))).toBe("recovery_required");
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
    const grant = lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 5000 }));
    await stub(accountId).release({ accountId, token: grant.token, committed: true });
    view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    expect(fail(await stub(accountId).publish({ accountId, generation, epoch: 0, workerVersion: VERSION }))).toBe("recovery_required");
    view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    // A lost reply retries publish and reconciles on the identical open record.
    const again = view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    expect(again.record?.epoch).toBe(1);
  });

  it("keeps the epoch closed against a regression even after a lease expires", async () => {
    const accountId = account(), generation = enrollmentRandom();
    lease(await stub(accountId).assertOpen({ accountId, generation, epoch: 0, workerVersion: VERSION, leaseMs: 1 }));
    await new Promise(resolve => setTimeout(resolve, 20));
    view(await stub(accountId).close({ accountId, generation, epoch: 0, workerVersion: VERSION }));
    // The expired lease no longer counts against the drain.
    const reopened = view(await stub(accountId).publish({ accountId, generation, epoch: 1, workerVersion: VERSION }));
    expect(reopened.record?.epoch).toBe(1);
  });
});
