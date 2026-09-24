import { beforeEach, expect, test } from "bun:test";
import fc from "fast-check";
import {
  acceptUsageAccountReply,
  captureUsageAccountRead,
  currentUsageAccountRead,
  currentUsageAccountScope,
  invalidateUsageAccountGeneration,
  subscribeUsageAccountInvalidation,
  type UsageAccountInvalidationReason,
  type UsageAccountReadTicket,
  type UsageAccountScope,
} from "./account-generation";

const A = `acct_${"a".repeat(32)}`;
const B = `acct_${"b".repeat(32)}`;
const C = `acct_${"c".repeat(32)}`;

beforeEach(() => { invalidateUsageAccountGeneration("lifecycle"); });

function acceptedScope(accountId: string): UsageAccountScope {
  const result = acceptUsageAccountReply(captureUsageAccountRead(), accountId);
  expect(result.kind).toBe("accepted");
  if (result.kind !== "accepted") throw new Error("expected an established account generation");
  return result.scope;
}

function establish(accountId: string): UsageAccountScope {
  expect(acceptUsageAccountReply(captureUsageAccountRead(), accountId)).toEqual({ kind: "identity-changed" });
  return acceptedScope(accountId);
}

test("unknown identity has no accepted scope and first adoption discards the initiating payload", () => {
  const ticket = captureUsageAccountRead();
  expect(currentUsageAccountRead(ticket)).toBe(true);
  expect(currentUsageAccountScope({ accountId: A, generation: ticket.generation })).toBe(false);
  const reasons: UsageAccountInvalidationReason[] = [];
  const readsCurrentDuringNotification: boolean[] = [];
  const unsubscribe = subscribeUsageAccountInvalidation(reason => {
    reasons.push(reason);
    readsCurrentDuringNotification.push(currentUsageAccountRead(ticket));
  });
  try {
    expect(acceptUsageAccountReply(ticket, A)).toEqual({ kind: "identity-changed" });
    expect(reasons).toEqual(["identity-changed"]);
    expect(readsCurrentDuringNotification).toEqual([false]);
    expect(acceptUsageAccountReply(ticket, A)).toEqual({ kind: "stale" });
    expect(currentUsageAccountScope(acceptedScope(A))).toBe(true);
  } finally { unsubscribe(); }
});

test("same-account concurrent replies share the established generation without invalidation", () => {
  const initialScope = establish(A);
  const first = captureUsageAccountRead(), second = captureUsageAccountRead();
  let notifications = 0;
  const unsubscribe = subscribeUsageAccountInvalidation(() => { notifications++; });
  try {
    const one = acceptUsageAccountReply(first, A), two = acceptUsageAccountReply(second, A);
    expect(one.kind).toBe("accepted"); expect(two.kind).toBe("accepted");
    if (one.kind !== "accepted" || two.kind !== "accepted") throw new Error("expected accepted replies");
    expect(one.scope.generation).toBe(initialScope.generation);
    expect(two.scope.generation).toBe(initialScope.generation);
    expect(currentUsageAccountRead(first)).toBe(true);
    expect(currentUsageAccountRead(second)).toBe(true);
    expect(notifications).toBe(0);
  } finally { unsubscribe(); }
});

for (const [firstAccount, lateAccount] of [[A, B], [B, A]] as const) {
  test(`concurrent unknown replies establish only the first observed account ${firstAccount.slice(-1)}`, () => {
    const first = captureUsageAccountRead(), late = captureUsageAccountRead();
    expect(acceptUsageAccountReply(first, firstAccount)).toEqual({ kind: "identity-changed" });
    const scope = acceptedScope(firstAccount);
    expect(acceptUsageAccountReply(late, lateAccount)).toEqual({ kind: "stale" });
    expect(currentUsageAccountScope(scope)).toBe(true);
    expect(acceptedScope(firstAccount).generation).toBe(scope.generation);
  });
}

test("B changes the generation before notification so a delayed A reply cannot erase B", () => {
  const scopeA = establish(A);
  const lateA = captureUsageAccountRead(), replyB = captureUsageAccountRead();
  let notifications = 0;
  const oldScopesCurrent: boolean[] = [], lateKinds: string[] = [];
  const unsubscribe = subscribeUsageAccountInvalidation(() => {
    notifications++;
    oldScopesCurrent.push(currentUsageAccountScope(scopeA));
    lateKinds.push(acceptUsageAccountReply(lateA, A).kind);
  });
  try {
    expect(acceptUsageAccountReply(replyB, B)).toEqual({ kind: "identity-changed" });
    expect(notifications).toBe(1);
    expect(oldScopesCurrent).toEqual([false]); expect(lateKinds).toEqual(["stale"]);
    const scopeB = acceptedScope(B);
    expect(scopeB.generation).not.toBe(scopeA.generation);
    expect(currentUsageAccountScope(scopeB)).toBe(true);
    expect(acceptUsageAccountReply(lateA, A)).toEqual({ kind: "stale" });
    expect(notifications).toBe(1);
    expect(currentUsageAccountScope(scopeB)).toBe(true);
  } finally { unsubscribe(); }
});

test("an A response accepted before a later B reply becomes unusable at the B boundary", () => {
  const scopeA = establish(A);
  const replyA = captureUsageAccountRead(), replyB = captureUsageAccountRead();
  const acceptedA = acceptUsageAccountReply(replyA, A);
  expect(acceptedA.kind).toBe("accepted");
  if (acceptedA.kind !== "accepted") throw new Error("expected accepted A reply");
  expect(acceptUsageAccountReply(replyB, B)).toEqual({ kind: "identity-changed" });
  expect(currentUsageAccountScope(scopeA)).toBe(false);
  expect(currentUsageAccountScope(acceptedA.scope)).toBe(false);
  expect(currentUsageAccountRead(replyA)).toBe(false);
  expect(currentUsageAccountScope(acceptedScope(B))).toBe(true);
});

test("account IDs are validated without coercion and invalid replies preserve the current generation", () => {
  const scope = establish(A), ticket = captureUsageAccountRead();
  let notifications = 0, coerced = false;
  const unsubscribe = subscribeUsageAccountInvalidation(() => { notifications++; });
  try {
    const invalid: unknown[] = [null, undefined, "", "A", "acct_", `acct_${"A".repeat(32)}`, ` ${A}`, `${A} `,
      `${A}, ${B}`, { accountId: A }, 0, true, { toString() { coerced = true; throw new Error("private canary"); } }];
    for (const value of invalid) {
      expect(acceptUsageAccountReply(ticket, value)).toEqual({ kind: "stale" });
      expect(currentUsageAccountRead(ticket)).toBe(true);
      expect(currentUsageAccountScope(scope)).toBe(true);
    }
    expect(notifications).toBe(0); expect(coerced).toBe(false);
    expect(acceptedScope(A).generation).toBe(scope.generation);
  } finally { unsubscribe(); }
});

test("tickets, scopes and opaque generations are immutable and a scope pins both identity and generation", () => {
  const scope = establish(A), ticket = captureUsageAccountRead();
  expect(Object.isFrozen(ticket)).toBe(true);
  expect(Object.isFrozen(scope)).toBe(true);
  expect(Object.isFrozen(scope.generation)).toBe(true);
  expect(Reflect.set(ticket, "generation", {})).toBe(false);
  expect(Reflect.set(scope, "accountId", B)).toBe(false);
  expect(currentUsageAccountScope({ accountId: B, generation: scope.generation })).toBe(false);
  expect(currentUsageAccountScope(scope)).toBe(true);
  invalidateUsageAccountGeneration("lifecycle");
  const next = establish(A);
  expect(next.generation).not.toBe(scope.generation);
  expect(currentUsageAccountScope(scope)).toBe(false);
  expect(currentUsageAccountRead(ticket)).toBe(false);
});

test("every invalidation reason clears identity and invalidates reads before synchronous notification", () => {
  for (const reason of ["confirmed-signout", "authentication-required", "identity-changed", "lifecycle"] as const) {
    const scope = establish(A), ticket = captureUsageAccountRead();
    const reasons: UsageAccountInvalidationReason[] = [];
    const currentDuringNotification: boolean[][] = [];
    const unsubscribe = subscribeUsageAccountInvalidation(observed => {
      reasons.push(observed);
      const fresh = captureUsageAccountRead();
      currentDuringNotification.push([currentUsageAccountScope(scope), currentUsageAccountRead(ticket),
        currentUsageAccountScope({ accountId: A, generation: fresh.generation })]);
    });
    try {
      invalidateUsageAccountGeneration(reason);
      expect(reasons).toEqual([reason]);
      expect(currentDuringNotification).toEqual([[false, false, false]]);
      expect(acceptUsageAccountReply(ticket, A)).toEqual({ kind: "stale" });
    } finally { unsubscribe(); }
  }
});

test("listener failures are isolated and duplicate subscriptions have independent idempotent disposal", () => {
  const events: UsageAccountInvalidationReason[] = [];
  const failing = subscribeUsageAccountInvalidation(() => { throw new Error("private cleanup failure"); });
  const listener = (reason: UsageAccountInvalidationReason) => { events.push(reason); };
  const first = subscribeUsageAccountInvalidation(listener), second = subscribeUsageAccountInvalidation(listener);
  try {
    expect(() => invalidateUsageAccountGeneration("confirmed-signout")).not.toThrow();
    expect(events).toEqual(["confirmed-signout", "confirmed-signout"]);
    first(); first();
    invalidateUsageAccountGeneration("lifecycle");
    expect(events).toEqual(["confirmed-signout", "confirmed-signout", "lifecycle"]);
    second(); invalidateUsageAccountGeneration("lifecycle");
    expect(events).toHaveLength(3);
  } finally { failing(); first(); second(); }
});

test("subscriptions added while clearing join only the next invalidation", () => {
  let later = 0;
  let unsubscribeLater = () => {};
  const first = subscribeUsageAccountInvalidation(() => {
    unsubscribeLater();
    unsubscribeLater = subscribeUsageAccountInvalidation(() => { later++; });
  });
  try {
    invalidateUsageAccountGeneration("lifecycle"); expect(later).toBe(0);
    invalidateUsageAccountGeneration("lifecycle"); expect(later).toBe(1);
  } finally { first(); unsubscribeLater(); }
});

test("reentrant lifecycle invalidation cannot return an accepted scope from the identity-changing reply", () => {
  const ticket = captureUsageAccountRead();
  const reasons: UsageAccountInvalidationReason[] = [];
  const unsubscribe = subscribeUsageAccountInvalidation(reason => {
    reasons.push(reason);
    if (reason === "identity-changed") invalidateUsageAccountGeneration("lifecycle");
  });
  try {
    expect(acceptUsageAccountReply(ticket, A)).toEqual({ kind: "identity-changed" });
    expect(reasons).toEqual(["identity-changed", "lifecycle"]);
    expect(currentUsageAccountRead(ticket)).toBe(false);
    const fresh = captureUsageAccountRead();
    expect(currentUsageAccountScope({ accountId: A, generation: fresh.generation })).toBe(false);
  } finally { unsubscribe(); }
  expect(currentUsageAccountScope(establish(B))).toBe(true);
});

test("retired generations never become current again across arbitrary signout, lifecycle and account ABA sequences", () => {
  fc.assert(fc.property(fc.array(fc.record({
    reason: fc.constantFrom<UsageAccountInvalidationReason>("confirmed-signout", "authentication-required", "identity-changed", "lifecycle"),
    accountId: fc.constantFrom(A, B, C),
  }), { minLength: 1, maxLength: 16 }), steps => {
    invalidateUsageAccountGeneration("lifecycle");
    const retiredReads: UsageAccountReadTicket[] = [], retiredScopes: UsageAccountScope[] = [];
    let scope = establish(A);
    let notifications = 0;
    const unsubscribe = subscribeUsageAccountInvalidation(() => { notifications++; });
    try {
      for (const step of steps) {
        retiredReads.push(captureUsageAccountRead()); retiredScopes.push(scope);
        invalidateUsageAccountGeneration(step.reason);
        scope = establish(step.accountId);
        const count = notifications;
        for (const retired of retiredReads) {
          expect(currentUsageAccountRead(retired)).toBe(false);
          expect(acceptUsageAccountReply(retired, step.accountId === A ? B : A)).toEqual({ kind: "stale" });
        }
        for (const retired of retiredScopes) expect(currentUsageAccountScope(retired)).toBe(false);
        expect(notifications).toBe(count);
        expect(currentUsageAccountScope(scope)).toBe(true);
      }
    } finally { unsubscribe(); }
  }), { numRuns: 100, seed: 23092026 });
});
