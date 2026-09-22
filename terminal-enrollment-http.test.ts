import { expect, test } from "bun:test";
import fixture from "./fixtures/usage/terminal-enrollment-v1.json";
import { TERMINAL_ENROLLMENT_ERRORS, TERMINAL_ENROLLMENT_URL } from "./lib/usage/terminal-enrollment-contract";
import { createTerminalEnrollmentHttpHandler, type TerminalEnrollmentHttpEnvironment } from "./services/usage-worker/src/terminal-enrollment-http";

type Operation = keyof typeof TERMINAL_ENROLLMENT_ERRORS;
type Method = Operation | "readEnrollmentReservation";
const NOW = fixture.times.enrolledAtMs, GENERATION = fixture.identity.recoveryGeneration;
const vector = (operation: Operation) => fixture.vectors.find(value => value.name === `${operation}-success`)!;
const reservation = vector("reserveEnrollment").result.value!;
const tick = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };
function clock() {
  let value = NOW, serial = 0; const timers = new Map<number, { at: number; callback: () => void }>();
  return { now: () => value,
    setTimeout(callback: () => void, ms: number) { const id = ++serial; timers.set(id, { at: value + ms, callback }); return id; },
    clearTimeout(id: unknown) { timers.delete(id as number); }, count: () => timers.size,
    move(next: number, fire = true) { value = next; if (fire) for (const [id, timer] of [...timers]) {
      if (timer.at <= value) { timers.delete(id); timer.callback(); }
    } },
  };
}
function lifetime() {
  const tasks: Promise<void>[] = [];
  return { tasks, waitUntil(task: Promise<void>) { tasks.push(task); }, async drain() { await Promise.all(tasks); } };
}
function reply(value: unknown, dispose: () => void = () => {}) {
  return Object.defineProperty({ ...(value as object) }, Symbol.dispose, { value: dispose });
}
function request(operation: Operation = "initialize", options: { url?: string; method?: string; body?: BodyInit; signal?: AbortSignal;
  headers?: Record<string, string | undefined> } = {}) {
  const bytes = new TextEncoder().encode(vector(operation).requestAscii), headers = new Headers({
    "content-type": "application/json", accept: "application/json", "content-length": String(bytes.byteLength),
  });
  for (const [key, value] of Object.entries(options.headers ?? {})) { if (value === undefined) headers.delete(key); else headers.set(key, value); }
  const method = options.method ?? "POST";
  return new Request(options.url ?? TERMINAL_ENROLLMENT_URL, { method, headers, signal: options.signal,
    ...(method === "GET" || method === "HEAD" ? {} : { body: options.body ?? bytes }) });
}
function worker(options: { rpc?: (method: Method, input: unknown) => Promise<unknown>; registerThrows?: boolean; generation?: unknown } = {}) {
  const time = clock(), ctx = lifetime(), calls: { method: Method; input: unknown }[] = [], pairings: string[] = [], accounts: string[] = [];
  let disposed = 0;
  const call = (method: Method, input: unknown) => {
    expect(ctx.tasks.length).toBeGreaterThan(0); expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Object.isFrozen(input)).toBe(true); calls.push({ method, input });
    if (options.rpc) return options.rpc(method, input);
    const value = method === "readEnrollmentReservation" ? vector("reserveEnrollment").result
      : method === "enroll" ? { ok: true, value: vector("enroll").result.value!.enrollment }
      : method === "namespaceForEnrollment" ? { ok: true, value: vector("namespaceForEnrollment").result.value!.namespace }
      : vector(method).result;
    return Promise.resolve(reply(value, () => { disposed++; }));
  };
  const env = { USAGE_ENROLLMENT_GENERATION: options.generation ?? GENERATION,
    PAIRINGS: { getByName(name: string) { pairings.push(name); return {
      initialize: (input: unknown) => call("initialize", input), poll: (input: unknown) => call("poll", input),
      confirm: (input: unknown) => call("confirm", input), readEnrollmentReservation: (input: unknown) => call("readEnrollmentReservation", input),
      reserveEnrollment: (input: unknown) => call("reserveEnrollment", input),
    }; } },
    ACCOUNT_ENROLLMENTS: { getByName(name: string) { accounts.push(name); return {
      enroll: (input: unknown) => call("enroll", input), namespaceForEnrollment: (input: unknown) => call("namespaceForEnrollment", input),
    }; } },
  } satisfies TerminalEnrollmentHttpEnvironment;
  const handler = createTerminalEnrollmentHttpHandler(time);
  return { time, ctx, env, calls, pairings, accounts, disposed: () => disposed,
    handle: (input: Request) => handler(input, env, { waitUntil(task) { ctx.waitUntil(task); if (options.registerThrows) throw new Error("PRIVATE_CANARY"); } }),
  };
}
async function checkedFailure(response: Response, status: 400 | 503) {
  expect(response.status).toBe(status);
  const body = await response.text();
  expect(body).toBe(`{"schemaVersion":1,"error":{"code":"${status === 400 ? "invalid_request" : "enrollment_unavailable"}"}}`);
  expect(response.headers.get("content-length")).toBe(String(body.length));
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
}

test("factory construction has no clock, context, network or namespace effect", () => {
  let calls = 0; const forbidden = () => { calls++; throw new Error("PRIVATE_CANARY"); };
  expect(typeof createTerminalEnrollmentHttpHandler({ now: forbidden, setTimeout: forbidden, clearTimeout: forbidden })).toBe("function");
  expect(calls).toBe(0);
});

for (const operation of Object.keys(TERMINAL_ENROLLMENT_ERRORS) as Operation[]) test(`${operation} has the exact wire and source-derived RPC sequence`, async () => {
  const w = worker(), response = await w.handle(request(operation));
  expect(response.status).toBe(200); expect(await response.text()).toBe(vector(operation).responseAscii);
  expect(response.headers.get("content-length")).toBe(String(vector(operation).responseAscii.length));
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  for (const header of ["set-cookie", "location", "content-encoding", "transfer-encoding", "trailer", "access-control-allow-origin"]) expect(response.headers.has(header)).toBe(false);
  const expected: Method[] = operation === "enroll" || operation === "namespaceForEnrollment" ? ["readEnrollmentReservation", operation]
    : operation === "reserveEnrollment" ? ["readEnrollmentReservation"] : [operation];
  expect(w.calls.map(value => value.method)).toEqual(expected);
  expect(w.calls.every(value => JSON.stringify(value.input) === JSON.stringify(vector(operation).request.input))).toBe(true);
  expect(w.pairings).toEqual([fixture.identity.intentId]);
  expect(w.accounts).toEqual(expected.length === 2 ? [`account-v1:${fixture.identity.accountId}`] : []);
  await w.ctx.drain(); expect(w.disposed()).toBe(expected.length); expect(w.time.count()).toBe(0);
});

test("only a checked not_reserved read performs one reserve, retaining original fields", async () => {
  let disposals = 0;
  const w = worker({ rpc: async method => reply(method === "readEnrollmentReservation" ? { ok: false, error: "not_reserved" }
    : vector("reserveEnrollment").result, () => { disposals++; }) });
  const response = await w.handle(request("reserveEnrollment"));
  expect(await response.text()).toBe(vector("reserveEnrollment").responseAscii);
  expect(w.calls.map(value => value.method)).toEqual(["readEnrollmentReservation", "reserveEnrollment"]);
  expect(w.calls[0].input).toBe(w.calls[1].input); expect(w.accounts).toHaveLength(0);
  await w.ctx.drain(); expect(disposals).toBe(2);
});

test("all checked preliminary read errors preserve exact mapping without another RPC", async () => {
  const errors = ["invalid_input", "not_initialized", "unauthorized", "storage_invalid", "clock_regressed", "not_reserved", "recovery_required"];
  for (const operation of ["reserveEnrollment", "enroll", "namespaceForEnrollment"] as const) {
    for (const error of errors) {
      if (operation === "reserveEnrollment" && error === "not_reserved") continue;
      const w = worker({ rpc: async () => reply({ ok: false, error }) }), response = await w.handle(request(operation));
      expect(response.status).toBe(200);
      expect((await response.json() as { result: unknown }).result).toEqual({ ok: false,
        error: operation !== "reserveEnrollment" && ["invalid_input", "not_initialized"].includes(error) ? "storage_unavailable" : error });
      expect(w.calls.map(value => value.method)).toEqual(["readEnrollmentReservation"]); expect(w.accounts).toHaveLength(0); await w.ctx.drain();
    }
  }
});

test("every allowed final domain error crosses as correlated 200 without retries", async () => {
  for (const operation of Object.keys(TERMINAL_ENROLLMENT_ERRORS) as Operation[]) {
    for (const error of TERMINAL_ENROLLMENT_ERRORS[operation]) {
      const w = worker({ rpc: async method => reply(method === "readEnrollmentReservation"
        ? operation === "reserveEnrollment" ? { ok: false, error: "not_reserved" } : vector("reserveEnrollment").result
        : { ok: false, error }) });
      const response = await w.handle(request(operation)); expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ schemaVersion: 1, operation, intentId: fixture.identity.intentId, result: { ok: false, error } });
      expect(w.calls.length).toBe(["enroll", "namespaceForEnrollment", "reserveEnrollment"].includes(operation) ? 2 : 1);
      await w.ctx.drain();
    }
  }
});

test("expired reservations and revoked committed receipts stay observational; namespace disclosure closes", async () => {
  const expiresAtMs = NOW + 1, truncated = { ...reservation, expiresAtMs };
  for (const operation of ["reserveEnrollment", "enroll", "namespaceForEnrollment"] as const) {
    const w = worker({ rpc: async method => reply(method === "readEnrollmentReservation" ? { ok: true, value: truncated }
      : method === "enroll" ? { ok: true, value: { ...vector("enroll").result.value!.enrollment, deviceState: "revoked" } }
      : { ok: true, value: vector("namespaceForEnrollment").result.value!.namespace }) });
    w.time.move(expiresAtMs);
    const response = await w.handle(request(operation));
    if (operation === "namespaceForEnrollment") await checkedFailure(response, 503);
    else { expect(response.status).toBe(200); expect((await response.json() as { result: { ok: boolean } }).result.ok).toBe(true); }
    await w.ctx.drain();
  }
});

test("disposal cannot mutate owned reservation routing or serialized receipt fields", async () => {
  const r = structuredClone(vector("reserveEnrollment").result);
  const e = structuredClone(vector("enroll").result.value!.enrollment);
  const w = worker({ rpc: async method => method === "readEnrollmentReservation"
    ? reply(r, () => { r.value!.accountId = `acct_${"99".repeat(16)}`; })
    : reply({ ok: true, value: e }, () => { e!.receipt.deviceId = "99".repeat(32); }) });
  const response = await w.handle(request("enroll")); expect(await response.text()).toBe(vector("enroll").responseAscii);
  expect(w.accounts).toEqual([`account-v1:${fixture.identity.accountId}`]); await w.ctx.drain();
});

test("invalid method, URL, media and framing do not consume bytes or select a namespace", async () => {
  const options: Parameters<typeof request>[1][] = [
    { url: TERMINAL_ENROLLMENT_URL + "?accountId=PRIVATE_CANARY" }, { url: "https://other.invalid/v1/enrollment" },
    ...["GET", "HEAD", "PUT", "OPTIONS"].map(method => ({ method })),
    ...["cookie", "authorization", "content-encoding", "transfer-encoding", "trailer", "origin"].map(header => ({ headers: { [header]: "PRIVATE_CANARY" } })),
    ...[undefined, "", "0", "01", "1025", "10000", "1, 1", "1.0", "-1"].map(length => ({ headers: { "content-length": length } })),
    { headers: { "content-type": "application/json; charset=utf-8" } }, { headers: { accept: "*/*" } },
  ];
  for (const option of options) {
    let pulls = 0; const body = new ReadableStream<Uint8Array>({ pull() { pulls++; } }, { highWaterMark: 0 });
    const w = worker(); await checkedFailure(await w.handle(request("initialize", { body, ...option })), 400);
    expect(pulls).toBe(0); expect(w.calls).toHaveLength(0); expect(w.ctx.tasks).toHaveLength(0);
  }
});

test("bounded canonical bytes are required before any namespace work", async () => {
  const ascii = vector("initialize").requestAscii;
  for (const body of ["", " " + ascii, ascii + "\n", "\ufeff" + ascii,
    ascii.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    JSON.stringify({ ...vector("initialize").request, context: vector("initialize").context }),
    "x".repeat(1025)]) {
    const w = worker(), length = new TextEncoder().encode(body).length;
    await checkedFailure(await w.handle(request("initialize", { body, headers: { "content-length": String(Math.max(1, Math.min(length, 1024))) } })), 400);
    expect(w.calls).toHaveLength(0); await w.ctx.drain();
  }
  for (const length of [1, 1024]) {
    const w = worker(); await checkedFailure(await w.handle(request("initialize", { headers: { "content-length": String(length) } })), 400);
    expect(w.calls).toHaveLength(0); await w.ctx.drain();
  }
});

test("invalid generation, abort and refused lifetime register perform no body or RPC work", async () => {
  for (const generation of ["", "0".repeat(64), {}, 1]) {
    const w = worker({ generation }); await checkedFailure(await w.handle(request()), 503); expect(w.ctx.tasks).toHaveLength(0); expect(w.calls).toHaveLength(0);
  }
  const w = worker({ registerThrows: true }); let pulls = 0;
  await checkedFailure(await w.handle(request("initialize", { body: new ReadableStream({ pull() { pulls++; } }, { highWaterMark: 0 }) })), 503);
  await w.ctx.drain(); expect(w.calls).toHaveLength(0); expect(pulls).toBe(0); expect(w.time.count()).toBe(0);
  const aborted = worker(), controller = new AbortController(); controller.abort();
  await checkedFailure(await aborted.handle(request("initialize", { signal: controller.signal })), 503); expect(aborted.calls).toHaveLength(0);
});

test("malformed, mismatched and undisposable reservation replies never route or reserve", async () => {
  let disposed = 0, hooks = 0;
  const malformed = [null, {}, { ok: true, value: reservation }, reply({ ok: false, error: "PRIVATE_CANARY" }),
    reply({ ok: false, error: "not_reserved", extra: true }), reply({ ok: false, error: "expired" }),
    reply({ ok: true, value: { ...reservation, accountId: `acct_${"0".repeat(32)}` } }),
    reply({ ok: true, value: { ...reservation, recoveryGeneration: "99".repeat(32) } }),
    reply({ ok: true, value: { ...reservation, pollCommitment: "99".repeat(32) } }),
    Object.defineProperty(reply({ ok: true, value: reservation }, () => { disposed++; }), "ok", { get() { hooks++; return true; } }),
  ];
  for (const raw of malformed) for (const operation of ["reserveEnrollment", "enroll", "namespaceForEnrollment"] as const) {
    const w = worker({ rpc: async () => raw }); await checkedFailure(await w.handle(request(operation)), 503);
    expect(w.calls).toHaveLength(1); expect(w.accounts).toHaveLength(0); await w.ctx.drain();
  }
  expect(disposed).toBe(3); expect(hooks).toBe(0);
});

test("raw then accessors are not assimilated, and throwing disposal cannot succeed", async () => {
  let hooks = 0, disposals = 0;
  const raw = Object.defineProperty(reply(vector("initialize").result, () => { disposals++; }), "then", { get() { hooks++; throw new Error("PRIVATE_CANARY"); } });
  const w = worker({ rpc: () => ({ then(resolve: (value: unknown) => void) { resolve(raw); return Promise.resolve(); } }) as Promise<unknown> });
  await checkedFailure(await w.handle(request()), 503); await w.ctx.drain(); expect(hooks).toBe(0); expect(disposals).toBe(1);
  const throwing = worker({ rpc: async () => reply(vector("initialize").result, () => { disposals++; throw new Error("PRIVATE_CANARY"); }) });
  await checkedFailure(await throwing.handle(request()), 503); await throwing.ctx.drain(); expect(disposals).toBe(2);
});

test("generation, clock and abort changes across RPC settlement suppress all subsequent work", async () => {
  for (const change of ["generation", "clock", "abort", "dispose-generation"] as const) {
    const controller = new AbortController(); let disposals = 0;
    const w = worker({ rpc: async () => {
      if (change === "generation") w.env.USAGE_ENROLLMENT_GENERATION = "99".repeat(32);
      if (change === "clock") w.time.move(NOW - 1, false);
      if (change === "abort") controller.abort();
      return reply(vector("reserveEnrollment").result, () => { disposals++; if (change === "dispose-generation") w.env.USAGE_ENROLLMENT_GENERATION = "99".repeat(32); });
    } });
    await checkedFailure(await w.handle(request("enroll", { signal: controller.signal })), 503); await w.ctx.drain();
    expect(w.calls).toHaveLength(1); expect(w.accounts).toHaveLength(0); expect(disposals).toBe(1);
  }
});

test("generation changes during body reading close before namespace access", async () => {
  const w = worker(); let pulls = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    pulls++; w.env.USAGE_ENROLLMENT_GENERATION = "99".repeat(32); controller.enqueue(new TextEncoder().encode(vector("initialize").requestAscii)); controller.close();
  } }, { highWaterMark: 0 });
  await checkedFailure(await w.handle(request("initialize", { body })), 503); await w.ctx.drain();
  expect(pulls).toBe(1); expect(w.calls).toHaveLength(0);
});

test("late RPCs retain all eight permits, dispose once, and never trigger reserve fallback", async () => {
  const pending: ((value: unknown) => void)[] = []; let disposals = 0;
  const w = worker({ rpc: () => new Promise(resolve => { pending.push(resolve); }) });
  const requests = Array.from({ length: 8 }, () => w.handle(request("reserveEnrollment"))); await tick(); expect(pending).toHaveLength(8);
  w.time.move(NOW + 5000); for (const response of await Promise.all(requests)) await checkedFailure(response, 503);
  await checkedFailure(await w.handle(request()), 503); expect(w.calls).toHaveLength(8);
  for (const resolve of pending) resolve(reply({ ok: false, error: "not_reserved" }, () => { disposals++; }));
  await w.ctx.drain(); expect(disposals).toBe(8); expect(w.calls.every(value => value.method === "readEnrollmentReservation")).toBe(true);
  expect(w.time.count()).toBe(0);
  const next = w.handle(request()); await tick(); expect(pending).toHaveLength(9);
  pending[8](reply(vector("initialize").result, () => { disposals++; })); expect((await next).status).toBe(200); await w.ctx.drain(); expect(disposals).toBe(9);
});

test("absolute stage deadline rejects late acceptance even when timers have not fired", async () => {
  let resolve!: (value: unknown) => void, disposed = 0;
  const w = worker({ rpc: () => new Promise(done => { resolve = done; }) }), pending = w.handle(request());
  await tick(); w.time.move(NOW + 5000, false); resolve(reply(vector("initialize").result, () => { disposed++; }));
  await checkedFailure(await pending, 503); await w.ctx.drain(); expect(disposed).toBe(1); expect(w.calls).toHaveLength(1);
});

test("confirm and namespace expiry equality during RPC disposal suppresses only successful replies", async () => {
  const expiresAtMs = NOW + 1;
  for (const operation of ["confirm", "namespaceForEnrollment"] as const) for (const ok of [true, false]) {
    const w = worker({ rpc: async method => {
      if (method === "readEnrollmentReservation") return reply({ ok: true, value: { ...reservation, expiresAtMs } });
      return reply(ok ? { ok: true, value: operation === "confirm" ? { ...vector("confirm").result.value, expiresAtMs }
        : vector("namespaceForEnrollment").result.value!.namespace } : { ok: false, error: "expired" }, () => { w.time.move(expiresAtMs, false); });
    } });
    const response = await w.handle(request(operation));
    if (ok) await checkedFailure(response, 503);
    else { expect(response.status).toBe(200); expect((await response.json() as { result: unknown }).result).toEqual({ ok: false, error: "expired" }); }
    await w.ctx.drain(); expect(w.time.count()).toBe(0);
  }
});

test("final delivery guard retains successful expiry across the handler's last await", async () => {
  const expiresAtMs = NOW + 1;
  for (const operation of ["confirm", "namespaceForEnrollment"] as const) for (const ok of [true, false]) {
    const time = clock(), ctx = lifetime(); let afterDisposalSamples = 0, disposed = false;
    const sample = () => {
      // After disposal: RPC stage guard, handler's final guard, then the
      // work owner's delivery guard. Only that last observation reaches expiry.
      if (disposed && ++afterDisposalSamples === 3) time.move(expiresAtMs, false);
      return time.now();
    };
    const handle = createTerminalEnrollmentHttpHandler({ ...time, now: sample });
    const forbidden = () => { throw new Error("unexpected_synthetic_rpc"); };
    const final = () => Promise.resolve(reply(ok ? { ok: true, value: operation === "confirm"
      ? { ...vector("confirm").result.value, expiresAtMs } : vector("namespaceForEnrollment").result.value!.namespace }
      : { ok: false, error: "expired" }, () => { disposed = true; }));
    const env: TerminalEnrollmentHttpEnvironment = { USAGE_ENROLLMENT_GENERATION: GENERATION,
      PAIRINGS: { getByName() { return { initialize: forbidden, poll: forbidden, confirm: final, reserveEnrollment: forbidden,
        readEnrollmentReservation: () => Promise.resolve(reply({ ok: true, value: { ...reservation, expiresAtMs } })),
      }; } }, ACCOUNT_ENROLLMENTS: { getByName() { return { enroll: forbidden, namespaceForEnrollment: final }; } },
    };
    const response = await handle(request(operation), env, ctx);
    expect(afterDisposalSamples).toBe(3);
    if (ok) await checkedFailure(response, 503);
    else { expect(response.status).toBe(200); expect((await response.json() as { result: unknown }).result).toEqual({ ok: false, error: "expired" }); }
    await ctx.drain(); expect(time.count()).toBe(0);
  }
});

test("body plus two RPC stages share one original thirty-second deadline", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>; const pending: ((value: unknown) => void)[] = [];
  const w = worker({ rpc: () => new Promise(resolve => { pending.push(resolve); }) });
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } }, { highWaterMark: 0 });
  const operation = w.handle(request("reserveEnrollment", { body })); await tick();
  w.time.move(NOW + 4000, false); controller.enqueue(new TextEncoder().encode(vector("reserveEnrollment").requestAscii)); controller.close(); await tick();
  expect(pending).toHaveLength(1); w.time.move(NOW + 8000, false); pending[0](reply({ ok: false, error: "not_reserved" })); await tick();
  expect(pending).toHaveLength(2); w.time.move(NOW + 30000, false); pending[1](reply(vector("reserveEnrollment").result));
  await checkedFailure(await operation, 503); await w.ctx.drain(); expect(w.calls).toHaveLength(2); expect(w.time.count()).toBe(0);
});

test("pending body cancellation holds capacity until actual cleanup completes", async () => {
  const releases: (() => void)[] = [], w = worker();
  const requests = Array.from({ length: 8 }, () => w.handle(request("initialize", { body: new ReadableStream<Uint8Array>({
    cancel() { return new Promise<void>(resolve => { releases.push(resolve); }); },
  }, { highWaterMark: 0 }) })));
  await tick(); w.time.move(NOW + 5000); for (const response of await Promise.all(requests)) await checkedFailure(response, 503);
  expect(releases).toHaveLength(8); await checkedFailure(await w.handle(request()), 503); expect(w.calls).toHaveLength(0);
  for (const release of releases) release(); await w.ctx.drain();
  expect((await w.handle(request())).status).toBe(200); await w.ctx.drain(); expect(w.calls).toHaveLength(1);
});
