import { beforeEach, expect, test } from "bun:test";
import { acceptUsageAccountReply, captureUsageAccountRead, currentUsageAccountScope, invalidateUsageAccountGeneration, subscribeUsageAccountInvalidation } from "./account-generation";
import { readInUsageAccountGeneration } from "./account-generation-read";

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`;
beforeEach(() => invalidateUsageAccountGeneration("lifecycle"));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }

test("identity adoption discards the first payload and admits only one fresh bound read", async () => {
  let calls = 0;
  const result = await readInUsageAccountGeneration(async () => ({ accountId: A, payload: ++calls }), reply => reply.accountId, () => true);
  expect(calls).toBe(2); expect(result?.reply.payload).toBe(2);
  expect(result?.scope && currentUsageAccountScope(result.scope)).toBe(true);
});
test("an old A reply cannot relabel B or reuse A data during its fresh retry", async () => {
  const old = deferred<{ accountId: string; payload: string }>(); let calls = 0;
  const pending = readInUsageAccountGeneration(() => ++calls === 1 ? old.promise : Promise.resolve({ accountId: B, payload: "fresh-B" }), reply => reply.accountId, () => true);
  acceptUsageAccountReply(captureUsageAccountRead(), B);
  const accepted = acceptUsageAccountReply(captureUsageAccountRead(), B);
  old.resolve({ accountId: A, payload: "stale-A" });
  const result = await pending;
  expect(result?.reply.payload).toBe("fresh-B"); expect(calls).toBe(2);
  expect(accepted.kind === "accepted" && currentUsageAccountScope(accepted.scope)).toBe(true);
});
test("caller cancellation and supersession prevent retries and identity adoption", async () => {
  const response = deferred<{ accountId: string }>(); let current = true, calls = 0;
  const ticket = captureUsageAccountRead();
  const pending = readInUsageAccountGeneration(() => { calls++; return response.promise; }, reply => reply.accountId, () => current);
  current = false; response.resolve({ accountId: A });
  expect(await pending).toBeNull(); expect(calls).toBe(1);
  expect(captureUsageAccountRead().generation).toBe(ticket.generation);
});
test("changing identities on every reply cannot cause an unbounded retry", async () => {
  let calls = 0;
  const result = await readInUsageAccountGeneration(async () => ({ accountId: ++calls === 1 ? A : B }), reply => reply.accountId, () => true);
  expect(result).toBeNull(); expect(calls).toBe(2);
});
test("unbound negative replies carry no accepted cache scope and do not adopt an identity", async () => {
  const ticket = captureUsageAccountRead();
  const result = await readInUsageAccountGeneration(async () => ({ error: "not_started" }), () => null, () => true);
  expect(result).toEqual({ reply: { error: "not_started" }, scope: null });
  expect(captureUsageAccountRead().generation).toBe(ticket.generation);
});

test("only a current final authentication refusal invalidates sibling private views", async () => {
  acceptUsageAccountReply(captureUsageAccountRead(), A);
  const accepted = acceptUsageAccountReply(captureUsageAccountRead(), A);
  const reasons: string[] = []; const stop = subscribeUsageAccountInvalidation(reason => reasons.push(reason));
  try {
    const result = await readInUsageAccountGeneration(async () => ({ authenticationRequired: true }), () => null, () => true,
      reply => reply.authenticationRequired);
    expect(result).toBeNull(); expect(reasons).toEqual(["authentication-required"]);
    expect(accepted.kind === "accepted" && currentUsageAccountScope(accepted.scope)).toBe(false);
  } finally { stop(); }
});

test("a stale refusal cannot clear a newer identity", async () => {
  const old = deferred<{ authenticationRequired: boolean }>(); let calls = 0;
  const pending = readInUsageAccountGeneration(() => ++calls === 1 ? old.promise : Promise.resolve({ authenticationRequired: false }),
    () => null, () => true, reply => reply.authenticationRequired);
  acceptUsageAccountReply(captureUsageAccountRead(), B);
  const accepted = acceptUsageAccountReply(captureUsageAccountRead(), B);
  old.resolve({ authenticationRequired: true });
  expect(await pending).toEqual({ reply: { authenticationRequired: false }, scope: null });
  expect(accepted.kind === "accepted" && currentUsageAccountScope(accepted.scope)).toBe(true);
});
