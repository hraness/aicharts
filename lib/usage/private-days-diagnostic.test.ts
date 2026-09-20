import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { createPrivateDaysDiagnostic, PRIVATE_DAYS_DIAGNOSTIC_BYTES } = await import("./private-days-diagnostic");
const { createPrivateDaysPublicHandler } = await import("./private-days-route");
const { createPrivateDaysTransport } = await import("./private-days-transport");
import { encodePrivateDaysHttpResponse, PRIVATE_DAYS_HTTP_URL } from "./private-days-http-contract";
import type { PrivateDaysSessionScope, PrivateDaysTransportDependencies } from "./private-days-transport";

const CANARY = "PRIVATE_ACCOUNT_COOKIE_TOKEN_URL_BODY_ERROR_CANARY";
const query = { schemaVersion: 1, accountId: `acct_${"0".repeat(32)}`, sessionExpiresAtMs: 100_000, firstUtcDay: 10, dayCount: 1 };
const keys = ["event", "routeStage", "transportStage", "transportFailure", "sessionOutcome", "accountsAttempted", "workerDispatched", "workerStatus", "workerDomain", "publicOutcome"].sort();
function request(signal?: AbortSignal) {
  return new Request("https://aicharts.io/api/usage/days?firstUtcDay=10&dayCount=1", { signal,
    headers: { accept: "application/json", "sec-fetch-site": "same-origin", cookie: CANARY } });
}
function worker(options: { status?: number; headers?: Record<string, string>; body?: BodyInit | null; domain?: string; url?: string } = {}) {
  const bytes = encodePrivateDaysHttpResponse(query, { ok: false, error: options.domain ?? "not_enrolled" })!;
  const response = new Response(options.body === undefined ? bytes : options.body, { status: options.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...options.headers } });
  Object.defineProperty(response, "url", { value: options.url ?? PRIVATE_DAYS_HTTP_URL }); return response;
}
function fixture(options: { context?: () => unknown; register?: () => void; read?: (close: () => void) => Promise<unknown>;
  fetch?: PrivateDaysTransportDependencies["fetch"]; attempted?: boolean | "missing"; sink?: (line: string) => void } = {}) {
  let now = 1_000, timer = 0, fetches = 0;
  const lines: string[] = [], lifetimes: Promise<void>[] = [], timers = new Map<number, { callback: () => void; delay: number }>();
  const transport = createPrivateDaysTransport({ available: () => true, now: () => now,
    setTimeout(callback, delay) { const id = ++timer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id as number); },
    registerLifetime(pending) { lifetimes.push(pending); options.register?.(); },
    getContext: options.context ?? (() => ({ headers: { "x-vercel-oidc-token": "synthetic.token.signature" } })),
    beginSession() {
      let open = true; const close = () => { open = false; };
      const scope: PrivateDaysSessionScope = { current: () => open, finish: close, read: async () => null,
        readOutcome: () => options.read ? options.read(close) : Promise.resolve({ kind: "authenticated", value: { suiteAccountId: query.accountId, expiresAtMs: query.sessionExpiresAtMs } }),
        ...(options.attempted === "missing" ? {} : { providerAttempted: () => options.attempted !== false }) };
      return scope;
    },
    async fetch(input, init) { fetches++; return options.fetch ? options.fetch(input, init) : worker(); },
  });
  const handle = createPrivateDaysPublicHandler({ available: () => true, query: transport,
    diagnostic(line) { lines.push(line); options.sink?.(line); } });
  return { handle, lines, fetches: () => fetches, async drain() { await Promise.all(lifetimes); },
    fire(delay: number) { const selected = [...timers.values()].find(item => item.delay === delay); expect(selected).toBeDefined(); now += delay; selected!.callback(); } };
}
function event(lines: string[]) {
  expect(lines).toHaveLength(1); expect(new TextEncoder().encode(lines[0]!).byteLength).toBeLessThanOrEqual(PRIVATE_DAYS_DIAGNOSTIC_BYTES);
  expect(lines[0]).not.toContain(CANARY); expect(lines[0]).not.toContain(query.accountId);
  const parsed = JSON.parse(lines[0]!); expect(Object.keys(parsed).sort()).toEqual(keys);
  expect(parsed.event).toBe("usage_private_days_read_v1"); return parsed;
}
async function turns() { for (let count = 0; count < 12; count++) await Promise.resolve(); }

test("diagnostic shape rejects arbitrary values, bounds bytes, and seals before a throwing sink", () => {
  const lines: string[] = [];
  const d = createPrivateDaysDiagnostic(line => { lines.push(line); d.finish("ready"); throw new Error(CANARY); });
  d.route(CANARY as never); d.step(CANARY as never); d.fail(CANARY as never); d.session(CANARY, CANARY);
  d.status(CANARY); d.status(Number.MAX_SAFE_INTEGER); d.domain(CANARY); d.finish("unavailable");
  const captured = event(lines); expect(captured.accountsAttempted).toBeNull(); expect(captured.workerStatus).toBeNull();
  expect(captured.sessionOutcome).toBe("malformed"); expect(captured.workerDomain).toBe("malformed");
  d.dispatched(); d.status(200); d.domain("success"); d.finish("ready"); expect(event(lines)).toEqual(captured);
});

test("early route failures emit once without query or personal input", async () => {
  for (const kind of ["configuration", "aborted", "origin", "range", "method"] as const) {
    const lines: string[] = []; let calls = 0; const controller = new AbortController();
    const handle = createPrivateDaysPublicHandler({ available: () => kind !== "configuration", query: async () => { calls++; throw new Error(CANARY); }, diagnostic: line => { lines.push(line); } });
    if (kind === "aborted") controller.abort();
    let incoming = request(controller.signal);
    if (kind === "origin") incoming.headers.set("origin", "https://private.example/" + CANARY);
    if (kind === "range") incoming = new Request("https://aicharts.io/api/usage/days?private=" + CANARY, { headers: incoming.headers });
    if (kind === "method") incoming = new Request(incoming.url, { method: "POST", headers: incoming.headers });
    await handle(incoming); expect(calls).toBe(0); expect(event(lines).routeStage).toBe(kind);
  }
});

test("missing and malformed context are distinct from capacity without Worker dispatch", async () => {
  for (const [context, reason] of [[{}, "context_missing"], [{ headers: { "x-vercel-oidc-token": CANARY } }, "context_invalid"]] as const) {
    const f = fixture({ context: () => context }); expect((await f.handle(request())).status).toBe(503); await f.drain();
    expect(event(f.lines).transportFailure).toBe(reason); expect(f.fetches()).toBe(0);
  }
  const resolves: ((value: unknown) => void)[] = [];
  const f = fixture({ read: () => new Promise(resolve => { resolves.push(resolve); }) });
  const pending = Array.from({ length: 8 }, () => f.handle(request())); await turns();
  expect((await f.handle(request())).status).toBe(503); expect(event(f.lines).transportFailure).toBe("capacity");
  for (const resolve of resolves) resolve({ kind: "authentication_required" });
  await Promise.all(pending); await f.drain(); expect(f.lines).toHaveLength(9); expect(f.fetches()).toBe(0);
});

test("Accounts unavailable is recorded before its closed-scope guard", async () => {
  const f = fixture({ read: async close => { close(); return { kind: "unavailable" }; } });
  expect((await f.handle(request())).status).toBe(503); await f.drain();
  const row = event(f.lines); expect(row.sessionOutcome).toBe("unavailable"); expect(row.accountsAttempted).toBe(true);
  expect(row.transportFailure).toBe("guard"); expect(row.workerDispatched).toBe(false);
});

test("missing diagnostic accessor is unknown and an anonymous session remains401", async () => {
  const f = fixture({ attempted: "missing", read: async () => ({ kind: "authentication_required" }) });
  const response = await f.handle(request()); expect(response.status).toBe(401); await f.drain();
  const row = event(f.lines); expect(row.accountsAttempted).toBeNull(); expect(row.sessionOutcome).toBe("authentication_required");
  expect(row.publicOutcome).toBe("authentication_required"); expect(f.fetches()).toBe(0);
});

test("Worker refusal and framing reasons contain no response header values", async () => {
  const cases: [NonNullable<Parameters<typeof worker>[0]>, string][] = [
    [{ status: 401 }, "status"], [{ status: 503 }, "status"], [{ url: "https://private.example/" + CANARY }, "url"],
    [{ headers: { "content-type": CANARY } }, "media"], [{ headers: { "content-encoding": CANARY } }, "encoding"],
    [{ headers: { location: CANARY } }, "location"], [{ headers: { "set-cookie": CANARY } }, "cookie"],
    [{ headers: { "content-length": CANARY } }, "length"], [{ headers: { "content-length": "1" } }, "body"],
    [{ body: CANARY }, "decode"],
  ];
  for (const [options, reason] of cases) {
    const f = fixture({ fetch: async () => worker(options) }); expect((await f.handle(request())).status).toBe(503); await f.drain();
    const row = event(f.lines); expect(row.workerDispatched).toBe(true); expect(row.workerStatus).toBe(options.status ?? 200);
    expect(row.transportFailure).toBe(reason); expect(row.publicOutcome).toBe("unavailable");
  }
});

test("HTTP200 domain failures and not-enrolled final projection stay distinct", async () => {
  for (const domain of ["storage_unavailable", "recovery_required", "not_enrolled"] as const) {
    const f = fixture({ fetch: async () => worker({ domain }) }); const response = await f.handle(request()); await f.drain();
    expect(response.status).toBe(domain === "not_enrolled" ? 200 : 503);
    const row = event(f.lines); expect(row.workerDomain).toBe(domain); expect(row.workerStatus).toBe(200);
    expect(row.publicOutcome).toBe(domain === "not_enrolled" ? "not_enrolled" : "unavailable");
  }
});

test("registration failure and thrown sink preserve fixed response and emit once", async () => {
  const f = fixture({ register: () => { throw new Error(CANARY); }, sink: () => { throw new Error(CANARY); } });
  const response = await f.handle(request()); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ schemaVersion: 1, error: { code: "unavailable" } }); await f.drain();
  expect(event(f.lines).transportFailure).toBe("registration"); expect(f.fetches()).toBe(0);
});

test("session timeout seals before a late session result without dispatch or duplicate emission", async () => {
  let resolve!: (value: unknown) => void;
  const f = fixture({ read: () => new Promise(done => { resolve = done; }) });
  const pending = f.handle(request()); await turns(); f.fire(5_000);
  expect((await pending).status).toBe(503); const before = event(f.lines);
  expect(before.transportFailure).toBe("timeout"); expect(before.sessionOutcome).toBe("pending"); expect(before.accountsAttempted).toBe(true);
  resolve({ kind: "authenticated", value: { suiteAccountId: query.accountId, expiresAtMs: query.sessionExpiresAtMs } });
  await f.drain(); expect(event(f.lines)).toEqual(before); expect(f.fetches()).toBe(0);
});

test("late Worker response after request timeout cannot update terminal status or emit again", async () => {
  let resolve!: (value: Response) => void;
  const f = fixture({ fetch: () => new Promise(done => { resolve = done; }) });
  const pending = f.handle(request()); await turns(); expect(f.fetches()).toBe(1); f.fire(15_000);
  expect((await pending).status).toBe(503); const before = event(f.lines); expect(before.workerStatus).toBeNull();
  resolve(worker()); await f.drain(); expect(event(f.lines)).toEqual(before);
});
