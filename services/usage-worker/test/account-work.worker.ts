import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CONTRIBUTION_MAX_TIME } from "../../../lib/usage/contributions";
import { AccountWorkState, accountWorkKey, ACCOUNT_WORK_MAX_ATTEMPTS, type AccountWorkAuthority, type AccountWorkAttempt } from "../src/account-work-state";
import { accountWorkDeadline } from "../src/account-work";

let serial = 0;
let authority: AccountWorkAuthority;
const key = (value: number) => accountWorkKey("projection", [value]);
const run = <T>(action: (state: AccountWorkState, storage: DurableObjectStorage) => T | Promise<T>): Promise<T> =>
  runInDurableObject(env.ACCOUNT_ENROLLMENTS.getByName(`account-work-synthetic-${serial}`), (_instance, ctx) => action(new AccountWorkState(ctx.storage), ctx.storage));
beforeEach(async () => {
  authority = { accountId: `acct_${(++serial).toString(16).padStart(32, "0")}`, generation: "2".repeat(64), observedAtMs: 100_000, active: true };
  await run(state => state.initialize(authority));
});
afterEach(async () => { vi.restoreAllMocks(); await abortAllDurableObjects(); await reset(); });
const tick = (now: number) => { authority = { ...authority, observedAtMs: now }; };

test("constructors and status read no persistent DML or alarms", async () => {
  await run((state, storage) => {
    const exec = vi.spyOn(storage.sql, "exec"), alarm = vi.spyOn(storage, "setAlarm");
    new AccountWorkState(storage);
    expect(state.snapshot(authority).projection.key).toBeNull();
    expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true); expect(alarm).not.toHaveBeenCalled();
  });
});
test("retry identity survives restart and appends never renew the current failed position", async () => {
  await run(state => state.reconcile("projection", key(1), 100_000, authority));
  let now = authority.observedAtMs;
  for (let attempt = 1; attempt <= ACCOUNT_WORK_MAX_ATTEMPTS; attempt++) {
    tick(now);
    const deadline = await run((state, storage) => {
      const claimed = state.claim("projection", authority)!; expect(claimed.attempt).toBe(attempt);
      expect(state.claim("projection", authority)).toBeNull();
      state.complete(claimed, { kind: "refuse", reason: null }, authority);
      // Unrelated appends retain this exact current-position key.
      const recreated = new AccountWorkState(storage);
      expect(recreated.reconcile("projection", key(1), authority.observedAtMs, authority).attempts).toBe(attempt);
      return claimed.retryAtMs!;
    });
    now = deadline;
  }
  tick(now);
  await run(state => {
    expect(state.claim("projection", authority)).toBeNull();
    expect(state.snapshot(authority).projection).toMatchObject({ attempts: 8, nextAtMs: null, blocked: "retry_exhausted" });
    state.reconcile("projection", key(1), now, authority, true);
    expect(state.claim("projection", authority)?.attempt).toBe(1);
  });
});
test("lost eighth callback retains unresolved custody and cannot dispatch a ninth attempt", async () => {
  let now = authority.observedAtMs;
  await run(state => state.reconcile("projection", key(1), now, authority));
  for (let index = 0; index < 8; index++) {
    tick(now); now = await run(state => {
      const attempt = state.claim("projection", authority)!;
      if (index < 7) state.complete(attempt, { kind: "refuse", reason: null }, authority);
      return attempt.retryAtMs!;
    });
  }
  tick(now);
  await run(state => {
    state.watch("projection", authority);
    expect(state.claim("projection", authority)).toBeNull();
    expect(state.snapshot(authority).projection).toMatchObject({ attempts: 8, flight: { status: "awaiting_settlement", watchAtMs: null } });
    expect(accountWorkDeadline(state.snapshot(authority))).toBeNull();
  });
});
test("independent work classes and old consent acknowledgments preserve the newer decision", async () => {
  await run(state => {
    state.reconcile("consent", key(10), 100_000, authority); state.reconcile("projection", key(1), 100_000, authority);
    const consent = state.claim("consent", authority)!, projection = state.claim("projection", authority)!;
    state.reconcile("consent", key(11), 100_000, authority);
    expect(state.complete(consent, { kind: "acknowledge" }, authority)).toBe(true);
    expect(state.snapshot(authority).consent.acknowledgedKey).toBeNull();
    expect(state.complete(projection, { kind: "refuse", reason: "capacity" }, authority)).toBe(true);
    expect(state.complete(state.claim("consent", authority)!, { kind: "acknowledge" }, authority)).toBe(true);
    expect(state.snapshot(authority).consent.acknowledgedKey).toBe(key(11));
    expect(state.snapshot(authority).projection.blocked).toBe("capacity");
    expect(state.reconcile("projection", key(1), 100_000, authority).blocked).toBe("capacity");
    expect(state.reconcile("projection", key(2), 100_000, authority).blocked).toBeNull();
  });
});
test("explicit same-position resume and foreign accounts invalidate old attempt capabilities", async () => {
  await run(state => {
    state.reconcile("projection", key(1), 100_000, authority);
    const old = state.claim("projection", authority)!;
    state.reconcile("projection", key(1), 100_000, authority, true);
    const replacement = state.claim("projection", authority)!;
    expect(replacement.attempt).toBe(old.attempt); expect(replacement.version).toBeGreaterThan(old.version);
    expect(state.complete(old, { kind: "acknowledge" }, authority)).toBe(false);
    expect(() => state.complete(replacement, { kind: "acknowledge" }, { ...authority, accountId: `acct_${"3".repeat(32)}` })).toThrow("unauthorized");
    expect(state.complete(replacement, { kind: "acknowledge" }, authority)).toBe(true);
  });
});
test("publication deferral and completed work are inert until their exact next authority", async () => {
  await run(state => {
    state.reconcile("projection", key(1), 100_000, authority);
    expect(state.complete(state.claim("projection", authority)!, { kind: "defer", readyAtMs: 116_000 }, authority)).toBe(true);
    expect(state.snapshot(authority).projection).toMatchObject({ attempts: 0, nextAtMs: 116_000, blocked: null });
    expect(state.claim("projection", authority)).toBeNull();
  });
  tick(116_000);
  await run(state => {
    state.complete(state.claim("projection", authority)!, { kind: "acknowledge" }, authority);
    expect(state.reconcile("projection", key(1), 116_000, authority).nextAtMs).toBeNull();
    expect(state.claim("projection", authority)).toBeNull();
    state.reconcile("projection", null, null, authority);
    expect(state.snapshot(authority).projection.key).toBeNull();
  });
});
test("copied attempts, foreign owners, regressing time and corrupted controls refuse", async () => {
  await run((state, storage) => {
    state.reconcile("projection", key(1), 100_000, authority);
    const attempt = state.claim("projection", authority)!;
    expect(() => state.complete({ ...attempt } as AccountWorkAttempt, { kind: "acknowledge" }, authority)).toThrow("invalid_input");
    expect(() => state.snapshot({ ...authority, generation: "3".repeat(64) })).toThrow("storage_invalid");
    expect(() => state.snapshot({ ...authority, observedAtMs: 99_999 })).toThrow("clock_regressed");
    expect(() => state.snapshot({ ...authority, active: false })).toThrow("unauthorized");
    const payload = storage.sql.exec("SELECT payload FROM account_work").one().payload as string;
    const broken = JSON.parse(payload); broken.projection.attempts = 9;
    storage.sql.exec("UPDATE account_work SET payload=?", JSON.stringify(broken));
    expect(() => state.snapshot(authority)).toThrow("storage_invalid");
  });
});
test("an unrepresentable retry deadline becomes a visible terminal clock refusal", async () => {
  tick(CONTRIBUTION_MAX_TIME);
  await run(state => {
    state.reconcile("projection", key(1), authority.observedAtMs, authority);
    const attempt = state.claim("projection", authority)!;
    expect(attempt.retryAtMs).toBeNull(); expect(state.snapshot(authority).projection.blocked).toBe("clock_limit");
    expect(state.claim("projection", authority)).toBeNull();
  });
});
test("a held dispatch consumes one watchdog and remains blocked across helper restart", async () => {
  const attempt = await run(state => {
    state.reconcile("projection", key(1), 100_000, authority);
    const attempt = state.claim("projection", authority)!;
    expect(accountWorkDeadline(state.snapshot(authority))).toBe(130_000);
    return attempt;
  });
  tick(130_000);
  await run((state, storage) => {
    state.watch("projection", authority);
    const snapshot = state.snapshot(authority);
    expect(snapshot.projection.flight).toMatchObject({ version: attempt.version, status: "awaiting_settlement", watchAtMs: null });
    expect(accountWorkDeadline(snapshot)).toBeNull();
    const restarted = new AccountWorkState(storage);
    expect(restarted.claim("projection", authority)).toBeNull();
    const exec = vi.spyOn(storage.sql, "exec");
    restarted.watch("projection", authority); expect(exec.mock.calls.every(([sql]) => /^SELECT /u.test(sql))).toBe(true);
    exec.mockRestore();
    expect(state.complete(attempt, { kind: "acknowledge" }, authority)).toBe(true);
    expect(state.snapshot(authority).projection).toMatchObject({ flight: null, acknowledgedKey: key(1), attempts: 0, blocked: null });
    expect(state.complete(attempt, { kind: "refuse", reason: "authority" }, authority)).toBe(false);
  });
});
test("watchdog identity survives a newer work position but never acknowledges that position", async () => {
  await run(state => {
    state.reconcile("projection", key(1), 100_000, authority);
    const attempt = state.claim("projection", authority)!;
    state.reconcile("projection", key(2), 100_000, authority);
    tick(130_000); state.watch("projection", authority);
    expect(state.snapshot(authority).projection.flight?.version).toBe(attempt.version);
    expect(state.claim("projection", authority)).toBeNull();
    expect(state.complete(attempt, { kind: "acknowledge" }, authority)).toBe(true);
    expect(state.snapshot(authority).projection).toMatchObject({ key: key(2), flight: null, acknowledgedKey: null, attempts: 0 });
    expect(state.claim("projection", authority)?.key).toBe(key(2));
  });
});
test("same-position explicit resume invalidates late success and failure capabilities", async () => {
  await run(state => {
    state.reconcile("projection", key(1), 100_000, authority);
    const old = state.claim("projection", authority)!;
    tick(130_000); state.watch("projection", authority);
    state.reconcile("projection", key(1), authority.observedAtMs, authority, true);
    const replacement = state.claim("projection", authority)!;
    expect(replacement.attempt).toBe(old.attempt);
    expect(state.complete(old, { kind: "acknowledge" }, authority)).toBe(false);
    expect(state.complete(old, { kind: "refuse", reason: "authority" }, authority)).toBe(false);
    expect(() => state.complete({ ...replacement }, { kind: "acknowledge" }, authority)).toThrow("invalid_input");
    expect(state.complete(replacement, { kind: "acknowledge" }, authority)).toBe(true);
  });
});
test("late failure of the eighth tracked attempt exhausts its persisted budget", async () => {
  await run(state => {
    state.reconcile("projection", key(1), authority.observedAtMs, authority);
    for (let index = 1; index <= 8; index++) {
      const attempt = state.claim("projection", authority)!;
      tick(authority.observedAtMs + 30_000); state.watch("projection", authority);
      expect(state.complete(attempt, { kind: "refuse", reason: null }, authority)).toBe(true);
      if (index < 8) tick(Math.max(authority.observedAtMs, state.snapshot(authority).projection.nextAtMs!));
    }
    expect(state.snapshot(authority).projection).toMatchObject({ attempts: 8, blocked: "retry_exhausted", nextAtMs: null, flight: null });
    expect(state.claim("projection", authority)).toBeNull();
  });
});
