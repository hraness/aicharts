import { expect, test } from "vitest";
import { AccountAlarm, ACCOUNT_ALARM_MAX_ARMS } from "../src/account-alarm";

const deferred = () => { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; };
test("a held older armer cannot overwrite the earlier deadline of newer work", async () => {
  let current: number | null = null;
  const entered = deferred(), held = deferred(), writes: number[] = [];
  const alarms = new AccountAlarm({ async getAlarm() { return current; }, async setAlarm(value) {
    if (value === 9_000) { entered.resolve(); await held.promise; }
    current = Number(value); writes.push(current);
  } });
  const old = alarms.arm(9_000, () => {}); await entered.promise;
  const newer = alarms.arm(1_000, () => {}); held.resolve(); await Promise.all([old, newer]);
  expect(current).toBe(1_000); expect(writes).toEqual([9_000, 1_000]);
  await alarms.arm(20_000, () => {}); expect(writes).toEqual([9_000, 1_000]);
});
test("closed authority after an alarm read has no later write and a rejected owner does not poison the queue", async () => {
  let active = true, writes = 0;
  const alarms = new AccountAlarm({ async getAlarm() { active = false; return null; }, async setAlarm() { writes++; } });
  await expect(alarms.arm(100, () => { if (!active) throw new Error("closed"); })).rejects.toThrow("closed");
  expect(writes).toBe(0);
  await alarms.arm(10, () => {}); expect(writes).toBe(1);
});
test("queued arming is bounded and failed storage releases its capacity", async () => {
  const held = deferred(), entered = deferred(); let first = true;
  const alarms = new AccountAlarm({ async getAlarm() { if (first) { first = false; entered.resolve(); await held.promise; throw new Error("unavailable"); } return 1; }, async setAlarm() {} });
  const firstResult = alarms.arm(2, () => {}).catch(error => error.message); await entered.promise;
  const queued = Array.from({ length: ACCOUNT_ALARM_MAX_ARMS - 1 }, () => alarms.arm(2, () => {}));
  await expect(alarms.arm(2, () => {})).rejects.toThrow("limit");
  held.resolve(); expect(await firstResult).toBe("unavailable"); await Promise.all(queued);
  await alarms.arm(2, () => {});
});
