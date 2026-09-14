import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { createPairingTransport } = await import("./lib/usage/pairing-transport");
import { createPairingHttpHandler, type PairingHttpVerifier } from "./services/usage-worker/src/pairing-http";
import type { createUsageOidcVerifier } from "./lib/usage/oidc/usage-oidc-verifier";
import { encodePairingTransportRequest, encodePairingTransportResponse, type PairingTransportOperation } from "./lib/usage/pairing-transport-contract";
import { PAIRING_HTTP_URL, PAIRING_HTTP_MEDIA, pairingHttpFailureBytes, pairingHttpBody } from "./lib/usage/pairing-http-contract";
import { pairingHttpWork } from "./lib/usage/pairing-http-work";

const ID = "11".repeat(32), ACCOUNT = `acct_${"aa".repeat(16)}`;
const proof = { intentId: ID, attemptId: "22".repeat(32), browserNonce: "33".repeat(32), contextToken: "44".repeat(32) };
const inputs = {
  beginBrowserAttempt: { intentId: ID, browserNonce: proof.browserNonce },
  recordVerifiedAuthentication: { ...proof, accountId: ACCOUNT, authTimeMs: 10_000, sessionExpiresAtMs: 50_000 },
  browserStatus: proof,
  decideBrowser: { ...proof, accountId: ACCOUNT, liveSessionExpiresAtMs: 50_000, decision: "approve" as const },
};
const results = {
  beginBrowserAttempt: { ok: true, value: { attemptId: proof.attemptId, contextToken: proof.contextToken, startedAtMs: 10_000, expiresAtMs: 50_000 } },
  recordVerifiedAuthentication: { ok: true, value: { recorded: true } },
  browserStatus: { ok: true, value: { state: "pending", expiresAtMs: 50_000, accountId: null, authenticationExpiresAtMs: null } },
  decideBrowser: { ok: true, value: { state: "browser-approved", expiresAtMs: 50_000, accountId: ACCOUNT, authenticationExpiresAtMs: 50_000 } },
};
const operations = Object.keys(inputs) as PairingTransportOperation[];
const tick = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function clock() {
  let time = 10_000, serial = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => time,
    setTimeout(callback: () => void, ms: number) { const id = ++serial; timers.set(id, { at: time + ms, callback }); return id; },
    clearTimeout(id: unknown) { timers.delete(id as number); },
    move(value: number) { time = value; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    count: () => timers.size,
    sampleOnly(value: number) { time = value; },
  };
}
function lifetime() {
  const tasks: Promise<void>[] = [];
  return { tasks, waitUntil(task: Promise<void>) { tasks.push(task); }, async drain() { await Promise.all(tasks); } };
}
function bytes(operation: PairingTransportOperation, input: unknown = inputs[operation]) {
  const result = encodePairingTransportRequest({ schemaVersion: 1, operation, input });
  if (!result.ok) throw new Error("bad_fixture");
  return new Uint8Array(result.value);
}
function request(operation: PairingTransportOperation = "browserStatus", options: { body?: BodyInit; headers?: Record<string, string>; url?: string; method?: string } = {}) {
  return new Request(options.url ?? PAIRING_HTTP_URL, {
    method: options.method ?? "POST", body: options.body ?? bytes(operation),
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c", ...options.headers },
  });
}
function rpc(value: unknown, disposed: () => void = () => {}) {
  const result = { ...(value as object) };
  Object.defineProperty(result, Symbol.dispose, { value: disposed });
  return result;
}
function worker(options: { current?: () => boolean; verifyError?: "unauthorized" | "unavailable"; reply?: (op: PairingTransportOperation, input: unknown) => Promise<unknown> } = {}) {
  const time = clock(), ctx = lifetime();
  const calls: { operation: PairingTransportOperation; input: unknown }[] = [];
  let selected = 0, verified = 0, finished = 0, disposed = 0;
  const verifier = { beginRequest(actual: unknown) {
    expect(actual).toBe(ctx);
    let open = true;
    const handle = Object.freeze({});
    return {
      async verify(token: unknown) { verified++; expect(token).toBe("a.b.c"); return options.verifyError ? { ok: false, error: options.verifyError } : { ok: true, value: handle }; },
      isCurrent(value: unknown) { return open && value === handle && (options.current?.() ?? true); },
      finish() { expect(open).toBe(true); open = false; finished++; },
    };
  } };
  const env = { PAIRINGS: { getByName(id: string) {
    selected++; expect(id).toBe(ID);
    return Object.fromEntries(operations.map(operation => [operation, (input: unknown) => {
      calls.push({ operation, input });
      return options.reply?.(operation, input) ?? Promise.resolve(rpc(results[operation], () => { disposed++; }));
    }]));
  } } };
  const handle = createPairingHttpHandler({ ...time, verifier } as Parameters<typeof createPairingHttpHandler>[0]);
  return { time, ctx, calls, handle: (input: Request) => handle(input, env as never, ctx),
    counts: () => ({ selected, verified, finished, disposed }) };
}
function response(operation: PairingTransportOperation, value: unknown = results[operation], options: { status?: number; headers?: Record<string, string>; body?: BodyInit; url?: string; redirected?: boolean } = {}) {
  const encoded = encodePairingTransportResponse({ schemaVersion: 1, operation, input: inputs[operation] }, value);
  if (!encoded.ok && options.body === undefined) throw new Error("bad_fixture");
  const result = new Response(options.body ?? (encoded.ok ? new Uint8Array(encoded.value) : new Uint8Array()), { status: options.status ?? 200,
    headers: { "content-type": PAIRING_HTTP_MEDIA, ...options.headers } });
  Object.defineProperty(result, "url", { value: options.url ?? PAIRING_HTTP_URL });
  Object.defineProperty(result, "redirected", { value: options.redirected ?? false });
  return result;
}
function client(options: { context?: () => unknown; fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>; register?: (p: Promise<void>) => void } = {}) {
  const time = clock(), ctx = lifetime();
  const calls: RequestInit[] = [];
  let contexts = 0;
  const transport = createPairingTransport({ ...time,
    getContext: () => { contexts++; return options.context !== undefined ? options.context() : { headers: { "x-vercel-oidc-token": "a.b.c" } }; },
    registerLifetime: options.register ?? (p => { ctx.waitUntil(p); }),
    fetch: async (input, init) => {
      expect(ctx.tasks.length > 0 || options.register !== undefined).toBe(true);
      calls.push(init!); expect(input).toBe(PAIRING_HTTP_URL);
      if (options.fetch) return options.fetch(input, init);
      const request = JSON.parse(new TextDecoder().decode(init!.body as Uint8Array));
      return response(request.operation);
    },
  });
  return { time, ctx, transport, port: transport(ID), calls, contexts: () => contexts };
}

test("dormant factories construct without acquiring context or dispatching I/O", () => {
  let called = 0;
  const forbidden = () => { called++; throw new Error("effect_before_call"); };
  const effects = { now: Date.now, setTimeout, clearTimeout };
  expect(typeof createPairingTransport({ ...effects, fetch: forbidden, getContext: forbidden, registerLifetime: forbidden })).toBe("function");
  expect(typeof createPairingHttpHandler({ ...effects, verifier: { beginRequest: forbidden } })).toBe("function");
  expect(called).toBe(0);
});

for (const operation of operations) test(`client and Worker preserve ${operation} exact codec domain`, async () => {
  const w = worker(); const r = await w.handle(request(operation));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe(PAIRING_HTTP_MEDIA);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  const decoded: unknown = await r.json();
  expect(decoded).toEqual({ schemaVersion: 1, operation, result: results[operation] });
  await w.ctx.drain(); expect(w.counts()).toEqual({ selected: 1, verified: 1, finished: 1, disposed: 1 });
  expect(w.calls[0]).toEqual({ operation, input: inputs[operation] });
  expect(Object.isFrozen(w.calls[0].input)).toBe(true);
  // workerd rejects the codec's null-prototype records as RPC arguments.
  expect(Object.getPrototypeOf(w.calls[0].input)).toBe(Object.prototype);
  const c = client(); const value = await c.port[operation](inputs[operation]);
  expect(value).toEqual(results[operation]); expect(Object.isFrozen(value)).toBe(true);
  await c.ctx.drain(); expect(c.calls).toHaveLength(1);
  expect(c.calls[0]).toMatchObject({ method: "POST", redirect: "manual", cache: "no-store", credentials: "omit",
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c" } });
  expect(c.time.count()).toBe(0);
});

test("client copies intent/account before awaits and acquires request context synchronously per invocation", async () => {
  let token = "a.b.c";
  const c = client({ context: () => ({ headers: { "x-vercel-oidc-token": token } }) });
  const input = { ...inputs.decideBrowser };
  const promise = c.port.decideBrowser(input);
  expect(c.contexts()).toBe(1); expect(c.calls).toHaveLength(0);
  input.accountId = `acct_${"bb".repeat(16)}`; input.intentId = "55".repeat(32); token = "d.e.f";
  expect(await promise).toEqual(results.decideBrowser);
  expect(JSON.parse(new TextDecoder().decode(c.calls[0].body as Uint8Array)).input).toEqual(inputs.decideBrowser);
  await c.port.browserStatus(proof);
  expect(c.calls[1].headers).toMatchObject({ authorization: "Bearer d.e.f" }); await c.ctx.drain();
});

test("client rejects wrong intent/getters before context and exposes no cause/input", async () => {
  const c = client(); let reads = 0;
  for (const input of [{ ...proof, intentId: "55".repeat(32) }, { ...proof, get contextToken() { reads++; throw new Error("SECRET"); } }]) {
    let error: unknown; try { await c.port.browserStatus(input); } catch (caught) { error = caught; }
    expect((error as Error).message).toBe("pairing_transport_unavailable"); expect(Object.hasOwn(error as object, "cause")).toBe(false);
  }
  expect(reads).toBe(0); expect(c.contexts()).toBe(0); expect(c.calls).toHaveLength(0);
});

for (const context of [null, {}, { headers: {} }, { headers: { "x-vercel-oidc-token": "a.b.c, d.e.f" } },
  Object.create({ headers: { "x-vercel-oidc-token": "a.b.c" } }), { headers: Object.create({ "x-vercel-oidc-token": "a.b.c" }) },
  { headers: { get "x-vercel-oidc-token"() { throw new Error("SECRET"); } } }]) {
  test("missing/inherited/accessor context cannot acquire a bearer", async () => {
    const c = client({ context: () => context });
    await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable"); expect(c.calls).toHaveLength(0);
  });
}

test("missing lifetime registration is zero I/O and produces a nonrejecting terminal task", async () => {
  const tasks: Promise<void>[] = [];
  const c = client({ register: p => { tasks.push(p); throw new Error("SECRET"); } });
  await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable"); await Promise.all(tasks);
  expect(c.calls).toHaveLength(0); expect(c.time.count()).toBe(0);
});

for (const options of [ { url: PAIRING_HTTP_URL + "?intentId=SECRET" }, { method: "PUT" },
  { headers: { "content-type": "application/json; charset=utf-8" } }, { headers: { accept: "*/*" } },
  { headers: { "content-encoding": "gzip" } }, { headers: { cookie: "SECRET" } },
  { headers: { "content-length": "1025" } }, { headers: { "content-length": "01" } } ] as NonNullable<Parameters<typeof request>[1]>[]) {
  test("Worker framing rejection precedes verification and DO selection", async () => {
    const w = worker(); const r = await w.handle(request("browserStatus", options)); expect(r.status).toBe(400);
    expect(await r.text()).toBe(new TextDecoder().decode(pairingHttpFailureBytes(400)));
    expect(w.counts()).toEqual({ selected: 0, verified: 0, finished: 0, disposed: 0 }); expect(w.ctx.tasks).toHaveLength(0);
  });
}

for (const authorization of ["", "bearer a.b.c", "Bearer a.b.c, Bearer d.e.f", "Bearer a..c", "Bearer " + "a".repeat(8193)]) {
  test("Worker malformed bearer never selects a DO", async () => {
    const w = worker(); expect((await w.handle(request("browserStatus", { headers: { authorization } }))).status).toBe(401);
    expect(w.counts().selected).toBe(0); expect(w.counts().verified).toBe(0);
  });
}

for (const verifyError of ["unauthorized", "unavailable"] as const) test(`verifier ${verifyError} has fixed mapping without body reads`, async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({ pull() { pulls++; } }, { highWaterMark: 0 });
  const w = worker({ verifyError });
  expect((await w.handle(request("browserStatus", { body: stream }))).status).toBe(verifyError === "unauthorized" ? 401 : 503);
  expect(pulls).toBe(0); expect(w.counts().selected).toBe(0); await w.ctx.drain();
});

for (const body of ["{}", new Uint8Array(1025), new Uint8Array(), "{\"schemaVersion\":1}\n"]) test("authenticated invalid body is fixed 400 without selection", async () => {
  const w = worker(); expect((await w.handle(request("browserStatus", { body }))).status).toBe(400);
  await w.ctx.drain(); expect(w.counts().selected).toBe(0); expect(w.counts().finished).toBe(1);
});

for (const status of [301, 302, 303, 307, 308]) for (const location of [PAIRING_HTTP_URL, "https://other.invalid/"]) {
  test(`client ${status} redirect is never followed and response is canceled`, async () => {
    let canceled = 0;
    const c = client({ fetch: async () => response("browserStatus", results.browserStatus, { status, headers: { location },
      body: new ReadableStream({ cancel() { canceled++; } }) }) });
    await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable");
    await c.ctx.drain(); expect(c.calls).toHaveLength(1); expect(canceled).toBe(1);
  });
}

for (const options of [{ headers: { "content-type": "application/json" } }, { headers: { "content-encoding": "gzip" } },
  { headers: { "set-cookie": "SECRET" } }, { url: "https://other.invalid/" }, { redirected: true },
  { headers: { "content-length": "1" } }, { body: "{}" }, { body: new Uint8Array(513) }] as NonNullable<Parameters<typeof response>[2]>[]) {
  test("client refuses invalid media/identity/framing/DTO without a domain fallback", async () => {
    const c = client({ fetch: async () => response("browserStatus", results.browserStatus, options) });
    await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable"); await c.ctx.drain(); expect(c.calls).toHaveLength(1);
  });
}

test("domain errors remain domain errors while fixed non-200 errors stay transport uncertainty", async () => {
  const c = client({ fetch: async () => response("browserStatus", { ok: false, error: "unauthorized" }) });
  expect(await c.port.browserStatus(proof)).toEqual({ ok: false, error: "unauthorized" }); await c.ctx.drain();
  for (const status of [400, 401, 503] as const) {
    const fail = client({ fetch: async () => response("browserStatus", {}, { status, body: pairingHttpFailureBytes(status) }) });
    await expect(fail.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable"); await fail.ctx.drain();
  }
});

test("synthetic workerd-shaped replies copy known fields and dispose malformed/throwing results exactly once", async () => {
  for (const kind of ["extra", "symbol", "accessor", "prototype", "disposal_throw", "nested_wrong_account", "missing"] as const) {
    let disposed = 0, read = 0;
    const raw = rpc(kind === "nested_wrong_account" ? { ...results.decideBrowser, value: { ...results.decideBrowser.value, accountId: `acct_${"bb".repeat(16)}` } } : results.decideBrowser,
      () => { disposed++; if (kind === "disposal_throw") throw new Error("SECRET"); });
    if (kind === "extra") Object.assign(raw, { secret: "SECRET" });
    if (kind === "symbol") Object.defineProperty(raw, Symbol("SECRET"), { value: true });
    if (kind === "accessor") Object.defineProperty(raw, "extra", { enumerable: true, get() { read++; return "SECRET"; } });
    if (kind === "prototype") Object.setPrototypeOf(raw, null);
    const w = worker({ reply: async () => kind === "missing" ? results.decideBrowser : raw });
    const r = await w.handle(request("decideBrowser")); expect(r.status).toBe(503); expect((await r.text()).includes("SECRET")).toBe(false);
    await w.ctx.drain(); expect(disposed).toBe(kind === "missing" ? 0 : 1); expect(read).toBe(0);
  }
});

test("raw RPC then accessor is never assimilated and malformed owned reply is disposed", async () => {
  let read = 0, disposed = 0;
  const raw = rpc(results.browserStatus, () => { disposed++; });
  Object.defineProperty(raw, "then", { enumerable: true, get() { read++; throw new Error("SECRET"); } });
  const thenable = { then(resolve: (value: unknown) => void) { resolve(raw); } } as unknown as Promise<unknown>;
  const w = worker({ reply: () => thenable });
  expect((await w.handle(request())).status).toBe(503); await w.ctx.drain(); expect(read).toBe(0); expect(disposed).toBe(1);
});

test("stale handle before selection and after commit never returns authority", async () => {
  const before = worker({ current: () => false }); expect((await before.handle(request())).status).toBe(503);
  await before.ctx.drain(); expect(before.counts().selected).toBe(0);
  let current = true, disposed = 0;
  const after = worker({ current: () => current, reply: async () => { current = false; return rpc(results.browserStatus, () => { disposed++; }); } });
  expect((await after.handle(request())).status).toBe(503); await after.ctx.drain(); expect(after.calls).toHaveLength(1); expect(disposed).toBe(1);
});

test("late committed RPC holds all eight permits until actual reply disposal, with no retry", async () => {
  const pending: ((value: unknown) => void)[] = []; let disposed = 0;
  const w = worker({ reply: () => new Promise(resolve => { pending.push(resolve); }) });
  const answers = Array.from({ length: 8 }, () => w.handle(request())); await tick(); expect(pending).toHaveLength(8);
  expect((await w.handle(request())).status).toBe(503); expect(w.calls).toHaveLength(8);
  w.time.move(15_000); expect((await Promise.all(answers)).every(r => r.status === 503)).toBe(true);
  expect((await w.handle(request())).status).toBe(503); expect(w.counts().finished).toBe(8);
  for (const resolve of pending) resolve(rpc(results.browserStatus, () => { disposed++; }));
  await w.ctx.drain(); expect(disposed).toBe(8); expect(w.calls).toHaveLength(8);
  const next = w.handle(request()); await tick(); expect(pending).toHaveLength(9);
  pending[8](rpc(results.browserStatus)); expect((await next).status).toBe(200); await w.ctx.drain();
});

test("late client fetch holds permits and cancels late response before releasing", async () => {
  const pending: ((response: Response) => void)[] = []; let canceled = 0;
  const c = client({ fetch: () => new Promise(resolve => { pending.push(resolve); }) });
  const answers = Array.from({ length: 8 }, () => c.port.browserStatus(proof).catch(error => error.message));
  await tick(); expect(pending).toHaveLength(8);
  await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable");
  c.time.move(25_000); expect(await Promise.all(answers)).toEqual(Array(8).fill("pairing_transport_unavailable"));
  expect(c.calls.every(call => call.signal?.aborted)).toBe(true);
  await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable");
  for (const resolve of pending) resolve(response("browserStatus", results.browserStatus, { body: new ReadableStream({ cancel() { canceled++; } }) }));
  await c.ctx.drain(); expect(canceled).toBe(8); expect(c.calls).toHaveLength(8);
});

test("body exact caps use fixed copies; zero chunks, overflow and wrong declared length refuse", async () => {
  for (const cap of [512, 1024]) {
    const time = clock(), ctx = lifetime(); let released = 0;
    const exact = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < cap; i++) controller.enqueue(Uint8Array.of(65)); controller.close(); } });
    const result = await pairingHttpWork<Uint8Array | null>(time, 10_000, p => { ctx.waitUntil(p); }, () => null, () => { released++; }, work => pairingHttpBody(exact, cap, cap, work));
    expect(result).toEqual(new Uint8Array(cap).fill(65)); await ctx.drain(); expect(released).toBe(1);
    for (const chunks of [[new Uint8Array()], [new Uint8Array(cap + 1)], [Uint8Array.of(1)]]) {
      const stream = new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } });
      const bad = await pairingHttpWork(time, 10_000, p => { ctx.waitUntil(p); }, () => null, () => {}, work => pairingHttpBody(stream, cap, cap, work));
      expect(bad).toBeNull(); await ctx.drain();
    }
  }
});

test("stalled body deadline cancels owned read without selecting a DO", async () => {
  let canceled = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { canceled++; } }, { highWaterMark: 0 });
  const w = worker(); const result = w.handle(request("browserStatus", { body: stream })); await tick();
  w.time.move(15_000); expect((await result).status).toBe(503); await w.ctx.drain(); expect(canceled).toBe(1); expect(w.calls).toHaveLength(0);
});

test("clock regression and invalid samples fail closed without dispatch", async () => {
  for (const time of [-0, -1, NaN, Infinity, 8_640_000_000_000_000]) {
    const c = client(); c.time.move(time);
    await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable"); await c.ctx.drain(); expect(c.calls).toHaveLength(0);
  }
  const c = client({ fetch: async () => { c.time.move(9999); return response("browserStatus"); } });
  await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable"); await c.ctx.drain(); expect(c.calls).toHaveLength(1);
});

test("client deadline includes synchronous context acquisition, not only fetch time", async () => {
  const c = client({ context: () => { c.time.move(25_000); return { headers: { "x-vercel-oidc-token": "a.b.c" } }; } });
  await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable");
  await c.ctx.drain(); expect(c.calls).toHaveLength(0);
});

test("unsettled body cancellation strands capacity despite outward deadline until cleanup settles", async () => {
  const cancellations: (() => void)[] = [];
  let canceled = 0;
  const c = client({ fetch: async () => response("browserStatus", results.browserStatus, {
    body: new ReadableStream({ cancel() { canceled++; return new Promise<void>(resolve => { cancellations.push(resolve); }); } }, { highWaterMark: 0 }),
  }) });
  const answers = Array.from({ length: 8 }, () => c.port.browserStatus(proof).catch(error => error.message));
  await tick(); c.time.move(15_000);
  expect(await Promise.all(answers)).toEqual(Array(8).fill("pairing_transport_unavailable")); expect(canceled).toBe(8);
  await expect(c.port.browserStatus(proof)).rejects.toThrow("pairing_transport_unavailable");
  expect(c.calls).toHaveLength(8);
  for (const resolve of cancellations) resolve();
  await c.ctx.drain(); expect(c.time.count()).toBe(0);
});

test("Worker lifetime registration failure never enters verifier/body/RPC and terminal does not reject", async () => {
  const w = worker(); const tasks: Promise<void>[] = [];
  w.ctx.waitUntil = task => { tasks.push(task); throw new Error("SECRET"); };
  expect((await w.handle(request())).status).toBe(503); await Promise.all(tasks);
  expect(w.counts()).toEqual({ selected: 0, verified: 0, finished: 0, disposed: 0 }); expect(w.time.count()).toBe(0);
});

test("caller input mutation after client invocation cannot retarget its frozen authority", async () => {
  const c = client(); const input = { ...inputs.recordVerifiedAuthentication };
  const result = c.port.recordVerifiedAuthentication(input);
  Object.defineProperty(input, "accountId", { get() { throw new Error("SECRET"); } });
  expect(await result).toEqual(results.recordVerifiedAuthentication); await c.ctx.drain();
  expect(JSON.parse(new TextDecoder().decode(c.calls[0].body as Uint8Array)).input.accountId).toBe(ACCOUNT);
});

test("late RPC settlement cannot evade an absolute stage deadline when its timer callback is delayed", async () => {
  let complete!: (raw: unknown) => void, disposed = 0;
  const w = worker({ reply: () => new Promise(resolve => { complete = resolve; }) });
  const answer = w.handle(request()); await tick();
  w.time.sampleOnly(15_001);
  complete(rpc(results.browserStatus, () => { disposed++; }));
  expect((await answer).status).toBe(503); await w.ctx.drain(); expect(disposed).toBe(1); expect(w.calls).toHaveLength(1);
});

test("accepted actual verifier is compile-time assignable without importing it into Worker ambient", () => {
  const accepts = (actual: ReturnType<typeof createUsageOidcVerifier>): PairingHttpVerifier => actual;
  expect(typeof accepts).toBe("function");
});

test("body progress after a stage deadline is refused even before delayed timer delivery", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, canceled = 0;
  const w = worker();
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { canceled++; } }, { highWaterMark: 0 });
  const answer = w.handle(request("browserStatus", { body: stream })); await tick();
  w.time.sampleOnly(15_000); controller.enqueue(bytes("browserStatus"));
  expect((await answer).status).toBe(503); await w.ctx.drain(); expect(canceled).toBe(1); expect(w.calls).toHaveLength(0);
});
