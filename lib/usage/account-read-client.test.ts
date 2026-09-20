import { expect, test } from "bun:test";
import { readAccountConsent, readAccountDays, readAccountStats, readAccountSummary, signOutUsageAccount } from "./account-read-client";
import { subscribeUsageAccountSignOut } from "./account-session-events";
import type { UsageAccountReply } from "./account-public";
import { setUsageConsent } from "./consent-client";
import type { PrivateDaysPublicReply } from "./private-days-public";
import type { StatsPublicReply } from "./stats-public";
import type { UsageConsentPublicReply } from "./consent-public";

const signedIn = { kind: "signed_in", session: { suiteAccountId: "PRIVATE_SESSION_CANARY" } };
const missing = { schemaVersion: 1, error: { code: "authentication_required" } } satisfies PrivateDaysPublicReply & UsageConsentPublicReply;
const absent = { schemaVersion: 1, state: "not_enrolled" } satisfies PrivateDaysPublicReply & UsageConsentPublicReply;
const statsMissing = { schemaVersion: 2, ok: false, error: "authentication_required" } satisfies StatsPublicReply;
const statsAbsent = { schemaVersion: 2, ok: false, error: "not_enrolled" } satisfies StatsPublicReply;
const accountReady = { schemaVersion: 1, state: "ready", account: { accountId: `acct_${"1".repeat(32)}` } } satisfies UsageAccountReply;
type Options = NonNullable<Parameters<typeof readAccountConsent>[1]>;
const clients = [
  { name: "daily", path: "/api/usage/days?firstUtcDay=10&dayCount=1", missing, absent,
    read: (signal: AbortSignal, options: Options) => readAccountDays({ firstUtcDay: 10, dayCount: 1 }, signal, options) },
  { name: "stats", path: "/api/usage/stats?firstUtcDay=10&dayCount=1", missing: statsMissing, absent: statsAbsent,
    read: (signal: AbortSignal, options: Options) => readAccountStats(10, 1, signal, options) },
  { name: "consent", path: "/api/usage/consent", missing, absent,
    read: (signal: AbortSignal, options: Options) => readAccountConsent(signal, options) },
  { name: "account", path: "/api/usage/account", missing, absent: accountReady,
    read: (signal: AbortSignal, options: Options) => readAccountSummary(signal, options) },
] as const;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const port = (run: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) => run as typeof fetch;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function serialLock() {
  let tail = Promise.resolve();
  return async (name: string, task: () => Promise<unknown>) => {
    expect(name).toBe("jungle-suite-accounts:oidc-refresh:v1");
    const before = tail, done = deferred<void>(); tail = done.promise;
    await before;
    try { return await task(); } finally { done.resolve(); }
  };
}

for (const client of clients) {
  test(`${client.name}: expired custody renews once, then only the fresh strict read supplies the result`, async () => {
    const paths: string[] = [], controller = new AbortController();
    let reads = 0, cleared = 0;
    const fetch = port((input, init) => {
      paths.push(`${init?.method} ${input}`);
      expect(init?.signal).toBe(controller.signal);
      expect(init?.credentials).toBe("same-origin"); expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error"); expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      if (input === client.path) return ++reads === 1 ? json(client.missing, 401) : json(client.absent);
      expect(cleared).toBe(1);
      return json(input === "/api/suite-auth/session" ? { kind: "refresh_required" } : signedIn);
    });
    const reply = await client.read(controller.signal, { fetch, withExclusiveLock: serialLock(), onAuthenticationRequired: () => { cleared++; } });
    expect(reply).toEqual(client.absent); expect(JSON.stringify(reply)).not.toContain("PRIVATE_SESSION_CANARY");
    expect(paths).toEqual([`GET ${client.path}`, "GET /api/suite-auth/session", "GET /api/suite-auth/session", "POST /api/suite-auth/refresh", `GET ${client.path}`]);
  });

  test(`${client.name}: signed out and failed renewal preserve the checked sign-in response without looping`, async () => {
    for (const outcome of ["signed_out", "failure", "malformed", "still_required"] as const) {
      const calls: string[] = [];
      const reply = await client.read(new AbortController().signal, { withExclusiveLock: serialLock(), fetch: port(input => {
        calls.push(String(input));
        if (input === client.path) return json(client.missing, 401);
        if (outcome === "failure") throw new Error("PRIVATE_FAILURE_CANARY");
        if (outcome === "malformed") return json({ kind: "signed_in", session: {}, extra: "PRIVATE_CANARY" });
        return json({ kind: outcome === "still_required" ? "refresh_required" : "signed_out" });
      }) });
      expect(reply).toEqual(client.missing);
      expect(calls.filter(path => path === client.path)).toHaveLength(1);
      expect(calls.filter(path => path === "/api/suite-auth/refresh")).toHaveLength(outcome === "still_required" ? 1 : 0);
      expect(calls.length).toBeLessThanOrEqual(4);
    }
  });

  test(`${client.name}: a second authentication failure never renews recursively`, async () => {
    let reads = 0, sessions = 0;
    const reply = await client.read(new AbortController().signal, { fetch: port(input => {
      if (input === client.path) { reads++; return json(client.missing, 401); }
      sessions++; return json(signedIn);
    }) });
    expect(reply).toEqual(client.missing); expect(reads).toBe(2); expect(sessions).toBe(1);
  });
}

test("ordinary replies and unvalidated authentication bodies never enter session recovery", async () => {
  for (const client of clients) {
    let calls = 0, cleared = 0;
    expect(await client.read(new AbortController().signal, { fetch: port(input => {
      expect(input).toBe(client.path); calls++; return json(client.absent);
    }), onAuthenticationRequired: () => { cleared++; } })).toEqual(client.absent);
    expect(calls).toBe(1); expect(cleared).toBe(0);
    const malformed = () => client.read(new AbortController().signal, { fetch: port(input => {
      expect(input).toBe(client.path); return json({ ...client.missing, extra: "PRIVATE_CANARY" }, 401);
    }), onAuthenticationRequired: () => { cleared++; } });
    if (client.name === "stats") expect(await malformed()).toEqual({ schemaVersion: 2, ok: false, error: "unavailable" });
    else await expect(malformed()).rejects.toThrow("usage_unavailable");
    expect(cleared).toBe(0);
  }
});

test("a superseded initial response cannot clear the newer report or begin renewal", async () => {
  const controller = new AbortController(), response = deferred<Response>(), arrived = deferred<void>();
  let cleared = 0, calls = 0;
  const pending = readAccountStats(10, 1, controller.signal, { fetch: port(() => { calls++; arrived.resolve(); return response.promise; }),
    onAuthenticationRequired: () => { cleared++; } });
  const refused = pending.then(() => null, (error: unknown) => error);
  await arrived.promise; controller.abort(); response.resolve(json(statsMissing, 401)); expect(await refused).toEqual(new Error("usage_unavailable"));
  expect(calls).toBe(1); expect(cleared).toBe(0);
});

test("an aborted lock waiter settles promptly and cannot dispatch after late admission", async () => {
  const controller = new AbortController(), entered = deferred<void>(), release = deferred<void>(), done = deferred<void>();
  const calls: string[] = [];
  const pending = readAccountConsent(controller.signal, { fetch: port(input => {
    calls.push(String(input)); return json(input === "/api/usage/consent" ? missing : { kind: "refresh_required" }, input === "/api/usage/consent" ? 401 : 200);
  }), withExclusiveLock: async (_name, task) => {
    entered.resolve(); await release.promise;
    try { return await task(); } finally { done.resolve(); }
  } });
  const refused = pending.then(() => null, (error: unknown) => error);
  await entered.promise; controller.abort(); expect(await refused).toEqual(new Error("usage_unavailable"));
  release.resolve(); await done.promise;
  expect(calls).toEqual(["/api/usage/consent", "/api/suite-auth/session"]);
});

test("native SDK lock acquisition receives cancellation so timed-out waiters do not accumulate", async () => {
  const controller = new AbortController(), entered = deferred<void>();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let cancelled = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: (name: string, options: LockOptions) => {
    expect(name).toBe("jungle-suite-accounts:oidc-refresh:v1"); expect(options.mode).toBe("exclusive"); expect(options.signal).toBe(controller.signal);
    entered.resolve(); return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => { cancelled++; reject(new Error("PRIVATE_CANARY")); }, { once: true }));
  } } } });
  try {
    const pending = readAccountConsent(controller.signal, { fetch: port(input => json(input === "/api/usage/consent" ? missing : { kind: "refresh_required" }, input === "/api/usage/consent" ? 401 : 200)) });
    const refused = pending.then(() => null, (error: unknown) => error);
    await entered.promise; controller.abort(); expect(await refused).toEqual(new Error("usage_unavailable")); expect(cancelled).toBe(1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("aborting a follower does not cancel the SDK local singleflight owner's refresh", async () => {
  const owner = new AbortController(), follower = new AbortController();
  const entered = deferred<void>(), followerWaiting = deferred<void>(), refreshed = deferred<Response>();
  let posts = 0, renewed = false, followerSessions = 0;
  const fetch = port((input, init) => {
    if (input === "/api/usage/consent") return json(renewed ? absent : missing, renewed ? 200 : 401);
    if (input === "/api/suite-auth/session") {
      if (init?.signal === follower.signal && ++followerSessions === 1) followerWaiting.resolve();
      return json({ kind: "refresh_required" });
    }
    posts++; expect(init?.signal).toBe(owner.signal); entered.resolve(); return refreshed.promise;
  });
  const first = readAccountConsent(owner.signal, { fetch, withExclusiveLock: null });
  await entered.promise;
  const second = readAccountConsent(follower.signal, { fetch, withExclusiveLock: null });
  const refused = second.then(() => null, (error: unknown) => error);
  await followerWaiting.promise; follower.abort(); expect(await refused).toEqual(new Error("usage_unavailable"));
  renewed = true; refreshed.resolve(json(signedIn));
  expect(await first).toEqual(absent); expect(owner.signal.aborted).toBe(false); expect(posts).toBe(1);
});

test("concurrent dashboard readers use the SDK lock and rotate only once", async () => {
  const withExclusiveLock = serialLock(); let renewed = false, posts = 0, reads = 0;
  const fetch = port(input => {
    if (input === "/api/usage/consent") { reads++; return json(renewed ? absent : missing, renewed ? 200 : 401); }
    if (input === "/api/suite-auth/session") return json(renewed ? signedIn : { kind: "refresh_required" });
    expect(input).toBe("/api/suite-auth/refresh"); posts++; renewed = true; return json(signedIn);
  });
  const replies = await Promise.all([0, 1].map(() => readAccountConsent(new AbortController().signal, { fetch, withExclusiveLock })));
  expect(replies).toEqual([absent, absent]); expect(posts).toBe(1); expect(reads).toBe(4);
});

test("late renewed reads are suppressed when the caller replaces or cancels them", async () => {
  const controller = new AbortController(), retry = deferred<Response>(), arrived = deferred<void>();
  let reads = 0;
  const pending = readAccountStats(10, 1, controller.signal, { fetch: port(input => {
    if (input === "/api/suite-auth/session") return json(signedIn);
    if (++reads === 1) return json(statsMissing, 401);
    arrived.resolve(); return retry.promise;
  }) });
  const refused = pending.then(() => null, (error: unknown) => error);
  await arrived.promise; controller.abort(); retry.resolve(json(statsAbsent)); expect(await refused).toEqual(new Error("usage_unavailable"));
  expect(reads).toBe(2);
});

test("session response preparation bounds decoded bytes, empty reads, redirects and abort cleanup", async () => {
  for (const kind of ["oversized", "empty", "redirected", "aborted"] as const) {
    const controller = new AbortController(), reading = deferred<void>();
    let pulls = 0, cancels = 0, calls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(control) {
      pulls++; reading.resolve();
      if (kind === "oversized") control.enqueue(new Uint8Array(32_769));
      else if (kind !== "aborted") control.enqueue(new Uint8Array());
    }, cancel() { cancels++; } }, { highWaterMark: 0 });
    const response = new Response(body, { headers: { "content-type": "application/json" } });
    if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
    const pending = readAccountConsent(controller.signal, { fetch: port(input => {
      calls++; return input === "/api/usage/consent" ? json(missing, 401) : response;
    }) });
    if (kind === "aborted") {
      const refused = pending.then(() => null, (error: unknown) => error);
      await reading.promise; controller.abort(); expect(await refused).toEqual(new Error("usage_unavailable"));
    } else expect(await pending).toEqual(missing);
    expect(pulls).toBeLessThanOrEqual(1); expect(calls).toBe(2);
    // Cancellation completes independently of the outward abort promise.
    await new Promise<void>(resolve => setTimeout(resolve, 0)); expect(cancels).toBe(1);
  }
});

test("the full SDK byte boundary fits even as one-byte chunks; one extra byte cannot authorize a read", async () => {
  const prefix = '{"kind":"signed_in","session":{"padding":"', suffix = '"}}';
  for (const size of [32_768, 32_769]) {
    const bytes = new TextEncoder().encode(prefix + "x".repeat(size - prefix.length - suffix.length) + suffix);
    let reads = 0, pulls = 0, cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulls === bytes.length) controller.close(); else controller.enqueue(bytes.subarray(pulls, pulls + 1));
      pulls++;
    }, cancel() { cancelled++; } }, { highWaterMark: 0 });
    const reply = await readAccountConsent(new AbortController().signal, { fetch: port(input => {
      if (input === "/api/usage/consent") return ++reads === 1 ? json(missing, 401) : json(absent);
      return new Response(body, { headers: { "content-type": "application/json" } });
    }) });
    expect(reply).toEqual(size === 32_768 ? absent : missing);
    expect(reads).toBe(size === 32_768 ? 2 : 1); expect(pulls).toBeLessThanOrEqual(32_769);
    expect(cancelled).toBe(size === 32_768 ? 0 : 1);
  }
});

test("an aborted in-flight refresh cannot trigger a read when its response arrives late", async () => {
  const controller = new AbortController(), entered = deferred<void>(), refresh = deferred<Response>();
  let reads = 0, cancelled = 0;
  const pending = readAccountConsent(controller.signal, { withExclusiveLock: serialLock(), fetch: port((input, init) => {
    if (input === "/api/usage/consent") { reads++; return json(missing, 401); }
    if (input === "/api/suite-auth/session") return json({ kind: "refresh_required" });
    expect(init?.signal).toBe(controller.signal); entered.resolve(); return refresh.promise;
  }) });
  const refused = pending.then(() => null, (error: unknown) => error);
  await entered.promise; controller.abort(); expect(await refused).toEqual(new Error("usage_unavailable"));
  refresh.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": "application/json" } }));
  await new Promise<void>(resolve => setTimeout(resolve, 0)); expect(reads).toBe(1); expect(cancelled).toBe(1);
});

test("failed consent POST is never renewed or replayed", async () => {
  const calls: string[] = [];
  const result = await setUsageConsent({ consent: false, publicHandle: null }, new AbortController().signal, port((input, init) => {
    calls.push(`${init?.method} ${input}`); expect(init?.body).toBeInstanceOf(Uint8Array); return json(missing, 401);
  }));
  expect(result).toEqual(missing); expect(calls).toEqual(["POST /api/usage/consent"]);
});

test("explicit sign-out uses one SDK-serialized POST and clears this tab only after confirmed completion", async () => {
  let clears = 0; const unsubscribe = subscribeUsageAccountSignOut(() => { clears++; });
  const controller = new AbortController(); const calls: string[] = [];
  try {
    await signOutUsageAccount(controller.signal, { withExclusiveLock: serialLock(), fetch: port((input, init) => {
      expect(clears).toBe(0); calls.push(`${init?.method} ${input}`);
      expect(init?.signal).toBe(controller.signal); expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe("same-origin"); expect(init?.redirect).toBe("error"); expect(init?.cache).toBe("no-store");
      return json({ kind: "signed_out" });
    }) });
    expect(calls).toEqual(["POST /api/suite-auth/sign-out"]); expect(clears).toBe(1);
  } finally { unsubscribe(); }
});

test("failed, malformed and aborted sign-out never announces success or retries", async () => {
  let clears = 0; const unsubscribe = subscribeUsageAccountSignOut(() => { clears++; });
  try {
    for (const mode of ["failure", "invalid", "extra", "abort", "oversize"] as const) {
      const controller = new AbortController(); let calls = 0;
      await expect(signOutUsageAccount(controller.signal, { withExclusiveLock: serialLock(), fetch: port(() => {
        calls++;
        if (mode === "failure") throw new Error("PRIVATE_CANARY");
        if (mode === "abort") controller.abort();
        return mode === "oversize" ? new Response("x".repeat(32_769), { headers: { "content-type": "application/json" } })
          : json(mode === "invalid" ? { kind: "signed_in", session: {} } : mode === "extra" ? { kind: "signed_out", private: "PRIVATE_CANARY" } : { kind: "signed_out" });
      }) })).rejects.toEqual(new Error("usage_unavailable"));
      expect(calls).toBe(1); expect(clears).toBe(0);
    }
  } finally { unsubscribe(); }
});

test("late sign-out lock cannot dispatch after cancellation", async () => {
  const controller = new AbortController(); let task!: () => Promise<unknown>, calls = 0;
  const entered = deferred<void>(), lock = deferred<unknown>();
  const operation = signOutUsageAccount(controller.signal, { withExclusiveLock: async (_name, next) => { task = next; entered.resolve(); return lock.promise; },
    fetch: port(() => { calls++; return json({ kind: "signed_out" }); }) });
  const result = operation.then(() => null, (error: unknown) => error);
  await entered.promise; controller.abort(); expect(await result).toEqual(new Error("usage_unavailable"));
  await expect(task()).rejects.toEqual(new Error("usage_unavailable")); lock.resolve(undefined); expect(calls).toBe(0);
});

test("SDK local singleflight cannot mistake a concurrent renewal for a successful sign-out", async () => {
  let clears = 0, signOutCalls = 0, reads = 0;
  const unsubscribe = subscribeUsageAccountSignOut(() => { clears++; });
  const entered = deferred<void>(), refresh = deferred<Response>();
  try {
    const renewal = readAccountConsent(new AbortController().signal, { withExclusiveLock: null, fetch: port(input => {
      if (input === "/api/usage/consent") return json(++reads === 1 ? missing : absent, reads === 1 ? 401 : 200);
      if (input === "/api/suite-auth/session") return json({ kind: "refresh_required" });
      entered.resolve(); return refresh.promise;
    }) });
    await entered.promise;
    const signOut = signOutUsageAccount(new AbortController().signal, { withExclusiveLock: null, fetch: port(() => { signOutCalls++; return json({ kind: "signed_out" }); }) });
    const result = signOut.then(() => null, (error: unknown) => error);
    refresh.resolve(json(signedIn));
    expect(await renewal).toEqual(absent); expect(await result).toEqual(new Error("usage_unavailable"));
    expect(signOutCalls).toBe(0); expect(clears).toBe(0);
  } finally { unsubscribe(); }
});
