import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { activateStats, afterEachLifecycle, beforeEachLifecycle, enroll, fixture, hex, lifecycle, lifecycleValue, session, statsRequest, statsUpload, stub } from "./lifecycle-fixture";

beforeEach(beforeEachLifecycle);
afterEach(afterEachLifecycle);

test("an account session lists every enrolled device and revokes any of them, keeping the historical enrollment fact", async () => {
  const first = await enroll(), second = await enroll();
  const listed = await lifecycleValue({ operation: "devices" }, "devices");
  expect(listed.devices.map(device => [device.deviceId, device.state])).toEqual([[first.deviceId, "active"], [second.deviceId, "active"]]);
  const revoked = await lifecycleValue({ operation: "revoke_device", deviceId: first.deviceId }, "device");
  expect(revoked.device).toEqual({ deviceId: first.deviceId, enrolledAtMs: expect.any(Number), revokedAtMs: Date.now(), state: "revoked" });
  // Idempotent: a retry reports the same historical revocation time.
  expect((await lifecycleValue({ operation: "revoke_device", deviceId: first.deviceId }, "device")).device).toEqual(revoked.device);
  const after = await lifecycleValue({ operation: "devices" }, "devices");
  expect(after.devices.map(device => device.state)).toEqual(["revoked", "active"]);
  const status = await lifecycleValue({ operation: "status" }, "status");
  expect(status).toMatchObject({ phase: "active", devices: { active: 1, revoked: 1 }, erasure: null, transfers: [] });
  expect(status.stateRevision).toBeGreaterThan(0);
});

test("a revoked device's later stats upload refuses with the explicit revoked code while the survivor still writes", async () => {
  const revokedDevice = await enroll(), survivor = await enroll(); await activateStats();
  await lifecycleValue({ operation: "revoke_device", deviceId: revokedDevice.deviceId }, "device");
  expect(await statsUpload(revokedDevice, statsRequest(revokedDevice))).toEqual({ ok: false, error: "revoked" });
  expect(await statsUpload(survivor, statsRequest(survivor))).toMatchObject({ ok: true });
});

test("device operations refuse foreign accounts, unknown devices, expired sessions and pending accounts without writing", async () => {
  const device = await enroll();
  const revision = () => runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT revision FROM account_enrollment WHERE id = 1").one().revision);
  const before = await revision();
  expect(await lifecycle({ operation: "revoke_device", deviceId: hex(7777) })).toEqual({ ok: false, error: "not_enrolled" });
  expect(await lifecycle({ operation: "revoke_device", deviceId: device.deviceId }, session(fixture.account, Date.now()))).toEqual({ ok: false, error: "expired" });
  expect(await lifecycle({ operation: "devices" }, session(fixture.account, Date.now() - 1))).toEqual({ ok: false, error: "expired" });
  const foreign = `acct_${hex(9_000_000 + fixture.serial, 16)}`;
  expect(await stub().lifecycle({ ...session(foreign), operation: "devices" })).toEqual({ ok: false, error: "unauthorized" });
  expect(await stub(foreign).lifecycle({ ...session(foreign), operation: "devices" })).toEqual({ ok: false, error: "not_enrolled" });
  expect(await stub().lifecycle({ ...session(), operation: "nope" })).toEqual({ ok: false, error: "invalid_input" });
  expect(await lifecycle({ operation: "devices" })).toMatchObject({ ok: true });
  expect(await revision()).toBe(before);
});
