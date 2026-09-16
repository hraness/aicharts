import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { createPrivateDaysTransport } = await import("./lib/usage/private-days-transport");
import { createPrivateDaysHttpHandler, type PrivateDaysHttpDependencies } from "./services/usage-worker/src/private-days-http";
import type { createUsageOidcVerifier } from "./lib/usage/oidc/usage-oidc-verifier";
import { encodePrivateDaysHttpRequest, encodePrivateDaysHttpResponse, PRIVATE_DAYS_HTTP_URL } from "./lib/usage/private-days-http-contract";
import type { PrivateDaysRequestV1, PrivateDaysV1 } from "./lib/usage/private-days-contract";
import { PAIRING_HTTP_MEDIA } from "./lib/usage/pairing-http-contract";

const ACCOUNT = `acct_${"a".repeat(32)}`, query: PrivateDaysRequestV1 = { schemaVersion: 1, accountId: ACCOUNT, sessionExpiresAtMs: 50_000, firstUtcDay: 5, dayCount: 1 };
const range = { firstUtcDay: 5, dayCount: 1 };
const empty = { usageOccurrences: 0, observedAccountedTokens: "0", observedOutputTokens: "0" };
const value: PrivateDaysV1 = { schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial", journalRevision: 0,
  journalCommittedAtMs: null, firstUtcDay: 5, days: [{ utcDay: 5, codex: empty, claudeCode: empty, devin: empty }] };
const result = { ok: true as const, value };
const tick = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
function clock() {
  let time = 10_000, serial = 0; const timers = new Map<number, { at: number; callback: () => void }>();
  return { now: () => time,
    setTimeout(callback: () => void, ms: number) { const id = ++serial; timers.set(id, { at: time + ms, callback }); return id; },
    clearTimeout(id: unknown) { timers.delete(id as number); },
    move(value: number, fire = true) { time = value; if (fire) for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    count: () => timers.size };
}
function lifetime() {
  const tasks: Promise<void>[] = [];
  return { tasks, waitUntil(task: Promise<void>) { tasks.push(task); }, async drain() { await Promise.all(tasks); } };
}
function rpc(value: unknown, dispose: () => void = () => {}) { return Object.defineProperty({ ...(value as object) }, Symbol.dispose, { value: dispose }); }
function request(options: { url?: string; headers?: Record<string, string>; body?: BodyInit; signal?: AbortSignal } = {}) {
  return new Request(options.url ?? PRIVATE_DAYS_HTTP_URL, { method: "POST", signal: options.signal,
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c", ...options.headers },
    body: options.body ?? encodePrivateDaysHttpRequest(query)! });
}
function response(options: { body?: BodyInit; status?: number; headers?: Record<string, string>; url?: string } = {}) {
  const reply = new Response(options.body ?? encodePrivateDaysHttpResponse(query, result)!, { status: options.status ?? 200,
    headers: { "content-type": PAIRING_HTTP_MEDIA, ...options.headers } });
  Object.defineProperty(reply, "url", { value: options.url ?? PRIVATE_DAYS_HTTP_URL }); return reply;
}
function worker(options: { current?: () => boolean; verifyError?: "unauthorized" | "unavailable"; reply?: (input: unknown) => Promise<unknown> } = {}) {
  const time = clock(), ctx = lifetime(); let selected = 0, verified = 0, finished = 0, disposed = 0;
  const verifier: PrivateDaysHttpDependencies["verifier"] = { beginRequest(actual) {
    expect(actual).toBe(ctx); let open = true; const handle = Object.freeze({});
    return { async verify() { verified++; return options.verifyError ? { ok: false, error: options.verifyError } : { ok: true, value: handle }; },
      isCurrent(value) { return open && value === handle && (options.current?.() ?? true); },
      finish() { expect(open).toBe(true); open = false; finished++; } };
  } };
  const handle = createPrivateDaysHttpHandler({ ...time, verifier });
  const env = { ACCOUNT_ENROLLMENTS: { getByName(name: string) {
    selected++; expect(name).toBe(`account-v1:${ACCOUNT}`);
    return { readImportedDays(input: unknown) {
      expect(input).toEqual(query); expect(Object.getPrototypeOf(input)).toBe(Object.prototype); expect(Object.isFrozen(input)).toBe(true);
      return options.reply?.(input) ?? Promise.resolve(rpc(result, () => { disposed++; }));
    } };
  } } };
  return { time, ctx, handle: (request: Request) => handle(request, env, ctx), counts: () => ({ selected, verified, finished, disposed }) };
}
function client(options: { available?: () => boolean; context?: () => unknown; read?: () => Promise<unknown>; outcome?: () => Promise<unknown>; current?: () => boolean;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>; register?: (task: Promise<void>) => void } = {}) {
  const time = clock(), ctx = lifetime(), calls: RequestInit[] = []; let contexts = 0, sessions = 0, reads = 0, finished = 0;
  const browser = new Request("https://aicharts.io/usage/me");
  const queryDays = createPrivateDaysTransport({ ...time, available: options.available ?? (() => true),
    getContext() { contexts++; return options.context ? options.context() : { headers: { "x-vercel-oidc-token": "a.b.c" } }; },
    registerLifetime: options.register ?? (task => { ctx.waitUntil(task); }),
    beginSession(actual) {
      expect(actual).toBe(browser); expect(ctx.tasks.length > 0 || options.register !== undefined).toBe(true); sessions++;
      let open = true;
      return { current: () => open && (options.current?.() ?? true), finish() { expect(open).toBe(true); open = false; finished++; },
        read() { throw new Error("Legacy accessor must not be called by transport."); },
        async readOutcome() { reads++; return options.outcome ? options.outcome() : { kind: "authenticated", value: await (options.read?.() ?? Promise.resolve({ suiteAccountId: ACCOUNT, expiresAtMs: 50_000 })) }; } };
    },
    async fetch(input, init) { calls.push(init!); return options.fetch ? options.fetch(input, init) : response(); },
  });
  return { time, ctx, calls, run: (input: unknown = range) => queryDays(browser, input), counts: () => ({ contexts, sessions, reads, finished }) };
}

test("actual accepted verifier is assignable and dormant factories acquire no authority", () => {
  const accepts = (verifier: ReturnType<typeof createUsageOidcVerifier>): PrivateDaysHttpDependencies["verifier"] => verifier;
  expect(typeof accepts).toBe("function");
  let calls = 0; const forbidden = () => { calls++; throw new Error("PRIVATE_CANARY"); };
  expect(typeof createPrivateDaysTransport({ available: forbidden, now: Date.now, setTimeout, clearTimeout, getContext: forbidden, fetch: forbidden, registerLifetime: forbidden, beginSession: forbidden })).toBe("function");
  expect(typeof createPrivateDaysHttpHandler({ now: Date.now, setTimeout, clearTimeout, verifier: { beginRequest: forbidden } })).toBe("function");
  expect(calls).toBe(0);
});

test("client derives fresh account/expiry and crosses the exact Worker boundary", async () => {
  const w = worker(), c = client({ fetch: async (url, init) => {
    expect(url).toBe(PRIVATE_DAYS_HTTP_URL); expect(JSON.parse(new TextDecoder().decode(init!.body as Uint8Array))).toEqual(query);
    const reply = await w.handle(new Request(url, init)); Object.defineProperty(reply, "url", { value: url }); return reply;
  } });
  expect(await c.run()).toEqual({ kind: "query", result }); await Promise.all([c.ctx.drain(), w.ctx.drain()]);
  expect(c.calls[0]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "manual",
    headers: { authorization: "Bearer a.b.c", "content-type": "application/json", accept: "application/json" } });
  expect(c.counts()).toEqual({ contexts: 1, sessions: 1, reads: 1, finished: 1 });
  expect(w.counts()).toEqual({ selected: 1, verified: 1, finished: 1, disposed: 1 });
});

test("invalid product fields fail before request context or live session lookup", async () => {
  const c = client();
  for (const input of [{ ...range, accountId: ACCOUNT }, { ...range, sessionExpiresAtMs: 100_000 }, { ...range, uploadSecret: "PRIVATE_CANARY" },
    { firstUtcDay: 0, dayCount: 32 }, { get firstUtcDay() { throw new Error("PRIVATE_CANARY"); }, dayCount: 1 }]) {
    await expect(c.run(input)).resolves.toEqual({ kind: "unavailable" });
  }
  expect(c.counts()).toEqual({ contexts: 0, sessions: 0, reads: 0, finished: 0 }); expect(c.calls).toHaveLength(0);
});

test("disabled private reads never acquire context, lifetime or a live session", async () => {
  for (const available of [() => false, () => { throw new Error("PRIVATE_CANARY"); }]) {
    const c = client({ available }); expect(await c.run()).toEqual({ kind: "unavailable" });
    expect(c.counts()).toEqual({ contexts: 0, sessions: 0, reads: 0, finished: 0 }); expect(c.calls).toHaveLength(0);
    expect(c.ctx.tasks).toHaveLength(0); expect(c.time.count()).toBe(0);
  }
});

test("a finite missing-session outcome stays fenced and cannot dispatch a Worker query", async () => {
  for (const changed of [false, true]) {
    let enabled = true;
    const c = client({ available: () => enabled, outcome: async () => { if (changed) enabled = false; return { kind: "authentication_required" }; } });
    expect(await c.run()).toEqual({ kind: changed ? "unavailable" : "authentication_required" });
    await c.ctx.drain(); expect(c.calls).toHaveLength(0); expect(c.counts().reads).toBe(1); expect(c.counts().finished).toBe(1);
  }
  for (const value of [null, { kind: "authentication_required", accountId: ACCOUNT }, { kind: "unavailable" }, { kind: "signed_out" }]) {
    const c = client({ outcome: async () => value }); expect(await c.run()).toEqual({ kind: "unavailable" });
    await c.ctx.drain(); expect(c.calls).toHaveLength(0);
  }
});

test("the private-read fence closes after session or Worker await", async () => {
  for (const stage of ["session", "worker"] as const) {
    let enabled = true;
    const c = client({ available: () => enabled,
      read: async () => { if (stage === "session") enabled = false; return { suiteAccountId: ACCOUNT, expiresAtMs: 50_000 }; },
      fetch: async () => { enabled = false; return response(); },
    });
    expect(await c.run()).toEqual({ kind: "unavailable" }); await c.ctx.drain();
    expect(c.calls).toHaveLength(stage === "session" ? 0 : 1);
  }
});

for (const context of [null, {}, { headers: {} }, { headers: { "x-vercel-oidc-token": "a..c" } },
  Object.create({ headers: { "x-vercel-oidc-token": "a.b.c" } }), { headers: { get "x-vercel-oidc-token"() { throw new Error("PRIVATE_CANARY"); } } }]) {
  test("missing or inherited platform context has no credential fallback", async () => {
    const c = client({ context: () => context }); await expect(c.run()).resolves.toEqual({ kind: "unavailable" });
    expect(c.counts().sessions).toBe(0); expect(c.calls).toHaveLength(0);
  });
}

test("lifetime registration precedes session I/O and its refusal is effect-free", async () => {
  const tasks: Promise<void>[] = [], c = client({ register: task => { tasks.push(task); throw new Error("PRIVATE_CANARY"); } });
  await expect(c.run()).resolves.toEqual({ kind: "unavailable" }); await Promise.all(tasks);
  expect(c.counts().sessions).toBe(0); expect(c.calls).toHaveLength(0);
});

for (const session of [null, { suiteAccountId: ACCOUNT, expiresAtMs: 10_000 }, { suiteAccountId: ACCOUNT, expiresAtMs: 50_000, email: "PRIVATE_CANARY" },
  { get suiteAccountId() { throw new Error("PRIVATE_CANARY"); }, expiresAtMs: 50_000 }]) {
  test("absent, expired or malformed live sessions never dispatch", async () => {
    const c = client({ read: async () => session }); await expect(c.run()).resolves.toEqual({ kind: "unavailable" });
    await c.ctx.drain(); expect(c.calls).toHaveLength(0); expect(c.counts().finished).toBe(1);
  });
}

test("authority changes after live session lookup prevent dispatch", async () => {
  let current = true; const c = client({ current: () => current, read: async () => { current = false; return { suiteAccountId: ACCOUNT, expiresAtMs: 50_000 }; } });
  await expect(c.run()).resolves.toEqual({ kind: "unavailable" }); await c.ctx.drain(); expect(c.calls).toHaveLength(0);
});

for (const change of ["fence", "expiry", "clock"] as const) test(`${change} after fetch invalidates the private result`, async () => {
  let current = true; const c = client({ current: () => current, fetch: async () => {
    if (change === "fence") current = false;
    else c.time.move(change === "expiry" ? 50_000 : 9_999, false);
    return response();
  } });
  await expect(c.run()).resolves.toEqual({ kind: "unavailable" }); await c.ctx.drain();
});

test("a timed-out live session retains capacity until its actual work settles", async () => {
  const resolve: ((value: unknown) => void)[] = [], c = client({ read: () => new Promise(done => { resolve.push(done); }) });
  const pending = Array.from({ length: 8 }, () => c.run()); await tick();
  c.time.move(15_000); expect((await Promise.all(pending)).every(outcome => outcome.kind === "unavailable")).toBe(true);
  await expect(c.run()).resolves.toEqual({ kind: "unavailable" }); expect(c.counts().reads).toBe(8);
  for (const done of resolve) done({ suiteAccountId: ACCOUNT, expiresAtMs: 50_000 });
  await c.ctx.drain(); expect(c.calls).toHaveLength(0); expect(c.counts().finished).toBe(8);
});

for (const options of [{ url: PRIVATE_DAYS_HTTP_URL + "?accountId=PRIVATE_CANARY" }, { headers: { cookie: "PRIVATE_CANARY" } },
  { headers: { "content-encoding": "gzip" } }, { headers: { accept: "*/*" } }, { headers: { "content-length": "257" } },
  { headers: { "content-type": "application/json; charset=utf-8" } }] as Parameters<typeof request>[0][]) {
  test("Worker rejects framing before workload verification or DO lookup", async () => {
    const w = worker(); expect((await w.handle(request(options))).status).toBe(400);
    expect(w.counts()).toEqual({ selected: 0, verified: 0, finished: 0, disposed: 0 });
  });
}

for (const verifyError of ["unauthorized", "unavailable"] as const) test(`workload ${verifyError} never consumes body bytes`, async () => {
  let pulls = 0; const stream = new ReadableStream<Uint8Array>({ pull() { pulls++; } }, { highWaterMark: 0 }), w = worker({ verifyError });
  expect((await w.handle(request({ body: stream }))).status).toBe(verifyError === "unauthorized" ? 401 : 503);
  expect(pulls).toBe(0); expect(w.counts().selected).toBe(0); await w.ctx.drain();
});

test("expired coordinator session and invalid workload handles cannot select accounts", async () => {
  const w = worker(); w.time.move(50_000);
  expect((await w.handle(request())).status).toBe(503); expect(w.counts().selected).toBe(0); await w.ctx.drain();
  const stale = worker({ current: () => false }); expect((await stale.handle(request())).status).toBe(503);
  expect(stale.counts().selected).toBe(0); await stale.ctx.drain();
});

for (const raw of [{ ok: true, value }, rpc({ ok: true, value: { ...value, firstUtcDay: 6 } }), rpc({ ok: true, value, extra: "PRIVATE_CANARY" }),
  rpc({ ok: false, error: "PRIVATE_CANARY" }), Object.defineProperty(rpc(result), "ok", { get() { throw new Error("PRIVATE_CANARY"); } })]) {
  test("malformed or undisposable RPC values cannot become private responses", async () => {
    const w = worker({ reply: async () => raw }); const reply = await w.handle(request());
    expect(reply.status).toBe(503); expect(await reply.text()).not.toContain("PRIVATE_CANARY"); await w.ctx.drain();
  });
}

test("late RPC replies are disposed and do not release capacity before settlement", async () => {
  const resolve: ((value: unknown) => void)[] = []; let disposed = 0;
  const w = worker({ reply: () => new Promise(done => { resolve.push(done); }) });
  const pending = Array.from({ length: 8 }, () => w.handle(request())); await tick(); w.time.move(15_000);
  expect((await Promise.all(pending)).every(reply => reply.status === 503)).toBe(true);
  expect((await w.handle(request())).status).toBe(503); expect(w.counts().selected).toBe(8);
  for (const done of resolve) done(rpc(result, () => { disposed++; })); await w.ctx.drain(); expect(disposed).toBe(8);
});

test("workload invalidation during RPC still disposes the result", async () => {
  let current = true, disposed = 0; const w = worker({ current: () => current, reply: async () => { current = false; return rpc(result, () => { disposed++; }); } });
  expect((await w.handle(request())).status).toBe(503); await w.ctx.drain(); expect(disposed).toBe(1);
});

for (const options of [{ status: 302 }, { url: PRIVATE_DAYS_HTTP_URL + "/other" }, { headers: { "content-encoding": "gzip" } },
  { headers: { "set-cookie": "PRIVATE_CANARY" } }, { headers: { location: "https://private.invalid" } }, { headers: { "content-length": "16385" } },
  { body: new Uint8Array(16_385) }, { body: '{"PRIVATE_CANARY":true}' }] as Parameters<typeof response>[0][]) {
  test("client refuses substituted, malformed or oversized HTTP replies with a fixed error", async () => {
    const c = client({ fetch: async () => response(options) });
    expect(await c.run()).toEqual({ kind: "unavailable" });
    await c.ctx.drain();
  });
}
