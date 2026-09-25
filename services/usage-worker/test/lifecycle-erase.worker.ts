import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LIFECYCLE_ERASE_REQUEST_TTL_MS, LIFECYCLE_ERASE_STEPS, parseReclamationLedger } from "../../../lib/usage/lifecycle-contract";
import { ADMISSION_SCHEMA } from "../src/admission-schema";
import { NOW, activateStats, admitUsage, afterEachLifecycle, beforeEachLifecycle, enroll, enrollmentRow, fence, fenceRecord, fixture, grant, hex,
  index, indexState, initializeIndex, lifecycle, lifecycleValue, replaceEnvironment, session, statsRequest, statsUpload, stub, tables } from "./lifecycle-fixture";

beforeEach(beforeEachLifecycle);
afterEach(afterEachLifecycle);

const ADMISSION_TABLES = ["account_enrollment", ...Object.keys(ADMISSION_SCHEMA)].sort();

async function populate() {
  const first = await enroll(), second = await enroll();
  expect(await admitUsage(second)).toMatchObject({ ok: true });
  await activateStats();
  expect(await statsUpload(first, statsRequest(first))).toMatchObject({ ok: true });
  expect(await initializeIndex()).toMatchObject({ ok: true });
  expect(await stub().setLeaderboardConsent(grant("erase-me"))).toMatchObject({ ok: true });
  expect((await indexState())[0].payload.members.map(member => member.accountId)).toEqual([fixture.account]);
  return { first, second };
}

test("a two-step erase withdraws the public index first, revokes devices, records the reclamation ledger, scrubs SQL and seals the fence", async () => {
  const { first, second } = await populate();
  const objectsBefore = [...(await env.STAGING.list()).objects, ...(await env.CONTROL.list()).objects].map(object => object.key).sort();
  expect(objectsBefore.length).toBeGreaterThan(2);
  const requested = await lifecycleValue({ operation: "erase_request" }, "erase_request");
  expect(requested).toMatchObject({ requestedAtMs: Date.now(), requestExpiresAtMs: Date.now() + LIFECYCLE_ERASE_REQUEST_TTL_MS });
  // The request is durable intent, not an effect: nothing else changed yet.
  expect(await lifecycleValue({ operation: "status" }, "status")).toMatchObject({ phase: "active", devices: { active: 2, revoked: 0 },
    erasure: { phase: "requested", step: 0 }, publishing: { consent: true, publicHandle: "erase-me", member: true, waitlistKnown: true } });
  expect(await lifecycleValue({ operation: "erase_request" }, "erase_request")).toEqual(requested);
  expect(await lifecycle({ operation: "erase_confirm", token: hex(1) })).toEqual({ ok: false, error: "unauthorized" });
  // Confirming inside the consent decision's own millisecond is refused as a
  // clock regression: the withdrawal must be strictly later than the grant.
  expect(await lifecycle({ operation: "erase_confirm", token: requested.token })).toEqual({ ok: false, error: "clock_regressed" });
  vi.setSystemTime(NOW + 1);
  const erased = await lifecycleValue({ operation: "erase_confirm", token: requested.token }, "erase_progress");
  expect(erased.erasure).toEqual({ phase: "erased", step: LIFECYCLE_ERASE_STEPS, stepCount: LIFECYCLE_ERASE_STEPS, requestedAtMs: requested.requestedAtMs,
    requestExpiresAtMs: requested.requestExpiresAtMs, confirmedAtMs: Date.now(), completedAtMs: Date.now(), sealed: true });
  // Public index: membership gone, tombstone retained at the withdrawal event.
  const [{ payload }] = await indexState();
  expect(payload.members).toEqual([]);
  expect(payload.tombstones.map(tombstone => tombstone.accountId)).toContain(fixture.account);
  expect(await index().readMembership({ schemaVersion: 1, accountId: fixture.account })).toEqual({ ok: true, value: { schemaVersion: 1, member: false, waitlist: null } });
  // Devices revoked, optional tables dropped, enrollment row kept as the tombstone.
  expect(await tables()).toEqual(ADMISSION_TABLES);
  const row = await enrollmentRow();
  expect(row.schemaVersion).toBe(5);
  const lifecycleState = row.payload.lifecycle as { erasure: { ledger: unknown; token: string } };
  const ledger = parseReclamationLedger(lifecycleState.erasure.ledger);
  expect(ledger).not.toBeNull();
  expect(ledger).toMatchObject({ contract: "reclamation-ledger-v1", accountId: fixture.account, generation: env.USAGE_ENROLLMENT_GENERATION });
  const prefixes = ledger!.entries.map(entry => `${entry.bucket}:${entry.prefix}`);
  expect(prefixes).toContain(`CONTROL:account-control/v1/${fixture.account.slice(5)}/namespace.aicn`);
  expect(prefixes).toContain(`STAGING:usage-stats/v2/${fixture.account}/${env.USAGE_ENROLLMENT_GENERATION}/snapshots/`);
  expect(prefixes).toContain(`STAGING:usage-admission/v1/${fixture.account.slice(5)}/${env.USAGE_ENROLLMENT_GENERATION}/batches/`);
  // Every retained object is covered by a ledger prefix and none was deleted here.
  const objectsAfter = [...(await env.STAGING.list()).objects, ...(await env.CONTROL.list()).objects].map(object => object.key).sort();
  expect(objectsAfter).toEqual(objectsBefore);
  for (const key of objectsAfter) expect(ledger!.entries.some(entry => key.startsWith(entry.prefix))).toBe(true);
  expect(await fenceRecord()).toMatchObject({ phase: "erased" });
  // Status and export keep answering for the erased account; everything else refuses.
  expect(await lifecycleValue({ operation: "status" }, "status")).toMatchObject({ phase: "erased", devices: { active: 0, revoked: 2 },
    erasure: { phase: "erased", step: LIFECYCLE_ERASE_STEPS }, publishing: { consent: false, publicHandle: null, member: false } });
  expect((await lifecycleValue({ operation: "export", cursor: null }, "export")).section).toBe("account_enrollment");
  expect(await lifecycleValue({ operation: "erase_confirm", token: requested.token }, "erase_progress")).toEqual(erased);
  for (const refused of [
    lifecycle({ operation: "erase_request" }), lifecycle({ operation: "revoke_device", deviceId: first.deviceId }),
    stub().setLeaderboardConsent(grant("revive")), stub().readLeaderboardConsent({ ...session(), operation: "status" }),
    statsUpload(first, statsRequest(first, { expectedRevision: 1, sequence: 2 })), admitUsage(second, 10n, fixture.account, 2),
  ]) expect(await refused).toEqual({ ok: false, error: "account_erased" });
  // Another account's proof fails identity before the erasure state is read,
  // so a foreign credential learns nothing about this account.
  expect(await stub().enroll((await enroll(`acct_${hex(5_000_000 + fixture.serial, 16)}`)).proof)).toEqual({ ok: false, error: "unauthorized" });
  expect(await stub().readLeaderboardDelivery({ schemaVersion: 1, accountId: fixture.account })).toMatchObject({ ok: true, value: { projection: { consent: false } } });
});

test("an interrupted erase resumes at the same step, and the index is withdrawn before any device or table is touched", async () => {
  await populate();
  const requested = await lifecycleValue({ operation: "erase_request" }, "erase_request");
  const tablesBefore = await tables();
  vi.setSystemTime(NOW + 1);
  await runInDurableObject(stub(), async instance => {
    const restore = replaceEnvironment(instance, original => ({ ...original, PUBLIC_INDEX: { getByName: () => ({ applyConsent: async () => { throw new Error("index_down"); } }) } } as unknown as Env));
    try { expect(await instance.lifecycle({ ...session(), operation: "erase_confirm", token: requested.token })).toEqual({ ok: false, error: "storage_unavailable" }); }
    finally { restore(); }
  });
  // Step 1 committed: source consent withdrawn and the account reads back as
  // withdrawn to the index, while devices and tables are untouched.
  expect(await lifecycleValue({ operation: "status" }, "status")).toMatchObject({ phase: "erasing", devices: { active: 2, revoked: 0 },
    erasure: { phase: "confirmed", step: 1, sealed: false }, publishing: { consent: false, publicHandle: null } });
  expect(await tables()).toEqual(tablesBefore);
  expect(await stub().readLeaderboardDelivery({ schemaVersion: 1, accountId: fixture.account })).toMatchObject({ ok: true, value: { projection: { consent: false } } });
  expect((await indexState())[0].payload.members.map(member => member.accountId)).toEqual([fixture.account]);
  // Interrupt again at the external seal: the local record stays at step 5.
  await runInDurableObject(stub(), async instance => {
    const restore = replaceEnvironment(instance, original => ({ ...original, RESTORE_FENCES: new Proxy(original.RESTORE_FENCES, { get(target, property) {
      if (property !== "getByName") return Reflect.get(target, property, target);
      // RPC stub methods are returned as-is: calling `bind` on one would be
      // dispatched as a remote method named "bind".
      return (name: string) => new Proxy(target.getByName(name), { get(inner, method) {
        if (method === "erase") return async () => { throw new Error("fence_down"); };
        return Reflect.get(inner, method, inner) as unknown;
      } });
    } }) }));
    try { expect(await instance.lifecycle({ ...session(), operation: "erase_confirm", token: requested.token })).toEqual({ ok: false, error: "storage_unavailable" }); }
    finally { restore(); }
  });
  expect(await lifecycleValue({ operation: "status" }, "status")).toMatchObject({ phase: "erasing", devices: { active: 0, revoked: 2 },
    erasure: { phase: "confirmed", step: 5, sealed: false }, publishing: { member: false } });
  expect(await tables()).toEqual(ADMISSION_TABLES);
  expect(await fenceRecord()).toMatchObject({ phase: "open" });
  // Seal externally (as a lost reply would have) and resume: the local seal
  // finalizes from the tombstone without a lease.
  expect(await fence().erase({ accountId: fixture.account, generation: env.USAGE_ENROLLMENT_GENERATION, epoch: 0, workerVersion: env.USAGE_WORKER_VERSION })).toMatchObject({ ok: true });
  expect(await lifecycle({ operation: "erase_request" })).toEqual({ ok: false, error: "account_erased" });
  const sealed = await lifecycleValue({ operation: "erase_confirm", token: requested.token }, "erase_progress");
  expect(sealed.erasure).toMatchObject({ phase: "erased", step: LIFECYCLE_ERASE_STEPS, sealed: true });
  expect(await lifecycleValue({ operation: "erase_confirm", token: requested.token }, "erase_progress")).toEqual(sealed);
});

test("a restored pre-erasure snapshot cannot revive an erased account and late writers refuse", async () => {
  const first = await enroll();
  expect(await admitUsage(first)).toMatchObject({ ok: true });
  const snapshot = await enrollmentRow();
  const second = await enroll();
  const requested = await lifecycleValue({ operation: "erase_request" }, "erase_request");
  expect((await lifecycleValue({ operation: "erase_confirm", token: requested.token }, "erase_progress")).erasure.phase).toBe("erased");
  // Operator restores the older enrollment payload (no erasure record).
  await runInDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec("UPDATE account_enrollment SET schema_version = ?, revision = ?, payload = ? WHERE id = 1", snapshot.schemaVersion, snapshot.revision, JSON.stringify(snapshot.payload));
  });
  expect(await lifecycle({ operation: "revoke_device", deviceId: first.deviceId })).toEqual({ ok: false, error: "account_erased" });
  expect(await lifecycle({ operation: "erase_request" })).toEqual({ ok: false, error: "account_erased" });
  expect(await lifecycle({ operation: "devices" })).toEqual({ ok: false, error: "account_erased" });
  expect(await admitUsage(first, 10n, fixture.account, 2)).toEqual({ ok: false, error: "account_erased" });
  expect(await stub().enroll(second.proof)).toEqual({ ok: false, error: "account_erased" });
  expect(await stub().setLeaderboardConsent(grant("revived"))).toEqual({ ok: false, error: "account_erased" });
  expect(await stub().readLeaderboardDelivery({ schemaVersion: 1, accountId: fixture.account })).toMatchObject({ ok: true, value: { projection: { consent: false } } });
  expect(await fence().assertOpen({ accountId: fixture.account, generation: env.USAGE_ENROLLMENT_GENERATION, epoch: 0,
    workerVersion: env.USAGE_WORKER_VERSION, leaseMs: 1_000, attemptId: hex(4242) })).toEqual({ ok: false, error: "account_erased" });
});

test("erase requests expire, wrong tokens refuse, and confirmation needs a live session", async () => {
  await enroll();
  const requested = await lifecycleValue({ operation: "erase_request" }, "erase_request");
  expect(await lifecycle({ operation: "erase_confirm", token: requested.token }, session(fixture.account, Date.now()))).toEqual({ ok: false, error: "expired" });
  expect(await lifecycle({ operation: "erase_confirm", token: hex(99) })).toEqual({ ok: false, error: "unauthorized" });
  const later = Date.now() + LIFECYCLE_ERASE_REQUEST_TTL_MS;
  vi.setSystemTime(later);
  expect(await lifecycle({ operation: "erase_confirm", token: requested.token }, session(fixture.account, later + 1_000))).toEqual({ ok: false, error: "expired" });
  const replaced = await lifecycleValue({ operation: "erase_request" }, "erase_request", session(fixture.account, later + 1_000));
  expect(replaced.token).not.toBe(requested.token);
  expect(await lifecycleValue({ operation: "status" }, "status", session(fixture.account, later + 1_000))).toMatchObject({ phase: "active", erasure: { phase: "requested", requestedAtMs: later } });
  expect(await lifecycle({ operation: "erase_confirm", token: requested.token }, session(fixture.account, later + 1_000))).toEqual({ ok: false, error: "unauthorized" });
});
