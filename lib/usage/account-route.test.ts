import { expect, mock, test } from "bun:test";
import { decodeUsageAccountReply, parseUsageAccountReply, USAGE_ACCOUNT_URL, USAGE_ACCOUNT_MEDIA, type UsageAccountReply } from "./account-public";
mock.module("server-only", () => ({}));
const { createUsageAccountHandler } = await import("./account-route");
const { createUsageAccountTransport } = await import("./account-transport");
const accountId = `acct_${"a".repeat(32)}`;
const ready = { schemaVersion: 1, state: "ready", account: { accountId } } satisfies UsageAccountReply;
const incoming = (options: RequestInit = {}, url = USAGE_ACCOUNT_URL) => new Request(url, {
  ...options, headers: { accept: "application/json", "sec-fetch-site": "same-origin", ...options.headers },
});
async function reply(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe(USAGE_ACCOUNT_MEDIA);
  expect(response.headers.get("pragma")).toBe("no-cache"); expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  for (const name of ["set-cookie", "location", "etag", "access-control-allow-origin"]) expect(response.headers.has(name)).toBe(false);
  const bytes = new Uint8Array(await response.arrayBuffer()); expect(bytes.length).toBeLessThanOrEqual(512);
  const value = decodeUsageAccountReply(bytes); expect(value).not.toBeNull(); return value;
}

test("account projection is exact, canonical, getter-free and identifier-bounded", () => {
  expect(parseUsageAccountReply(ready)).toEqual(ready);
  for (const id of ["acct_" + "a".repeat(31), "acct_" + "A".repeat(32), "acct_" + "a".repeat(33), accountId + "\n", "PRIVATE_CANARY"]) {
    expect(parseUsageAccountReply({ ...ready, account: { accountId: id } })).toBeNull();
  }
  for (const value of [{ ...ready, session: "PRIVATE_CANARY" }, { ...ready, account: { accountId, entitlementReceipt: "PRIVATE_CANARY" } },
    { schemaVersion: 1, state: "ready", get account() { throw new Error("PRIVATE_CANARY"); } },
    { schemaVersion: 1, error: { code: "toString" } }]) expect(parseUsageAccountReply(value)).toBeNull();
  for (const text of [JSON.stringify(ready) + " ", '{"schemaVersion":1,"schemaVersion":1,"state":"ready","account":{"accountId":"' + accountId + '"}}', " ".repeat(513)]) {
    expect(decodeUsageAccountReply(new TextEncoder().encode(text))).toBeNull();
  }
});

test("GET exposes only the verified account ID with private headers and distinct refusal states", async () => {
  const outcomes: UsageAccountReply[] = [ready, { schemaVersion: 1, error: { code: "authentication_required" } }, { schemaVersion: 1, error: { code: "unavailable" } }];
  for (const result of outcomes) {
    let reads = 0;
    const handle = createUsageAccountHandler({ available: () => true, read: async () => { reads++; return result; } });
    const response = await handle(incoming({ headers: { cookie: "PRIVATE_CANARY" } }));
    expect(response.status).toBe("account" in result ? 200 : result.error.code === "authentication_required" ? 401 : 503);
    const body = await reply(response); expect(body).toEqual(result); expect(JSON.stringify(body)).not.toContain("PRIVATE_CANARY"); expect(reads).toBe(1);
  }
});

test("method, origin, framing and exact path reject before any live account read", async () => {
  let reads = 0, availability = 0;
  const handle = createUsageAccountHandler({ available: () => { availability++; return true; }, read: async () => { reads++; return ready; } });
  for (const method of ["HEAD", "POST", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
    const response = await handle(incoming({ method })); expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
    if (method === "HEAD") expect(await response.text()).toBe(""); else await reply(response);
  }
  expect(availability).toBe(0);
  for (const url of [USAGE_ACCOUNT_URL + "?accountId=" + accountId, USAGE_ACCOUNT_URL + "/", USAGE_ACCOUNT_URL + "#x", USAGE_ACCOUNT_URL + "?" + "x".repeat(300)]) {
    expect((await handle(incoming({}, url))).status).toBe(400);
  }
  const invalid: Record<string, string>[] = [{ authorization: "Bearer PRIVATE_CANARY" }, { "content-type": "application/json" }, { "content-encoding": "gzip" },
    { "content-length": "1" }, { "transfer-encoding": "chunked" }, { accept: "*/*" }];
  for (const headers of invalid) expect((await handle(incoming({ headers }))).status).toBe(400);
  const rejected: Record<string, string>[] = [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
  for (const headers of rejected) {
    expect((await handle(incoming({ headers }))).status).toBe(403);
  }
  expect((await handle(incoming({}, "https://other.invalid/api/usage/account"))).status).toBe(403);
  expect(reads).toBe(0);
});

test("kill switch, aborted and malformed provider outcomes never expose private inputs", async () => {
  let available = true;
  const controller = new AbortController();
  const handle = createUsageAccountHandler({ available: () => available, read: async () => { available = false; return ready; } });
  expect((await handle(incoming())).status).toBe(503);
  controller.abort(); expect((await handle(incoming({ signal: controller.signal }))).status).toBe(503);
  for (const read of [async () => ({ ...ready, accessToken: "PRIVATE_CANARY" }), async () => { throw new Error("PRIVATE_CANARY"); }]) {
    const response = await createUsageAccountHandler({ available: () => true, read })(incoming());
    expect(response.status).toBe(503); expect(await reply(response)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  }
});

function transportFixture() {
  let now = 100, open = true, available = true, reads = 0, finishes = 0;
  let outcome: unknown = { kind: "authenticated", value: { suiteAccountId: accountId, expiresAtMs: 1_000 } };
  let held: Promise<unknown> | null = null;
  const lifetimes: Promise<void>[] = [], timers = new Map<number, () => void>(); let next = 0;
  const read = createUsageAccountTransport({ available: () => available, now: () => now,
    setTimeout: callback => { const id = ++next; timers.set(id, callback); return id; }, clearTimeout: id => { timers.delete(id as number); },
    registerLifetime: promise => { lifetimes.push(promise); },
    beginSession: () => ({ current: () => open, finish: () => { finishes++; }, read: async () => null,
      async readOutcome() { expect(lifetimes.length).toBeGreaterThan(0); reads++; return JSON.parse(JSON.stringify(await (held ?? Promise.resolve(outcome)))); } }),
  });
  return { read, lifetimes, timers, counts: () => ({ reads, finishes }), setOutcome: (value: unknown) => { outcome = value; },
    expire: () => { now = 1_000; }, close: () => { open = false; }, disable: () => { available = false; }, hold: (promise: Promise<unknown>) => { held = promise; } };
}

test("live scope projection stays exact, request-owned, registered and always closed", async () => {
  const unavailable: UsageAccountReply = { schemaVersion: 1, error: { code: "unavailable" } };
  const cases: { outcome: unknown; expected: UsageAccountReply }[] = [
    { outcome: { kind: "authenticated", value: { suiteAccountId: accountId, expiresAtMs: 1_000 } }, expected: ready },
    { outcome: { kind: "authentication_required" }, expected: { schemaVersion: 1, error: { code: "authentication_required" } } },
    { outcome: { kind: "unavailable" }, expected: unavailable },
    { outcome: { kind: "authenticated", value: { suiteAccountId: accountId, expiresAtMs: 1_000, username: "PRIVATE_CANARY" } }, expected: unavailable },
    { outcome: { kind: "authenticated", value: { suiteAccountId: accountId + "\n", expiresAtMs: 1_000 } }, expected: unavailable },
    { outcome: { kind: "authenticated", value: { suiteAccountId: accountId, expiresAtMs: 100 } }, expected: unavailable },
  ];
  for (const { outcome, expected } of cases) {
    const f = transportFixture(); f.setOutcome(outcome);
    const result = await f.read(incoming()); await Promise.all(f.lifetimes);
    expect(result).toEqual(expected);
    expect(f.counts()).toEqual({ reads: 1, finishes: 1 }); expect(f.timers.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
  }
});

test("late authority changes and deadline suppress identity, retaining capacity until terminal cleanup", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>(done => { resolve = done; });
  const f = transportFixture(); f.hold(pending);
  const requests = Array.from({ length: 8 }, () => f.read(incoming()));
  await Promise.resolve(); await Promise.resolve();
  expect(f.counts().reads).toBe(8);
  expect(await f.read(incoming())).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  for (const timer of [...f.timers.values()]) timer();
  expect((await Promise.all(requests)).every(value => "error" in value && value.error.code === "unavailable")).toBe(true);
  expect(f.counts().finishes).toBe(8);
  expect(await f.read(incoming())).toEqual({ schemaVersion: 1, error: { code: "unavailable" } }); expect(f.counts().reads).toBe(8);
  resolve({ kind: "authenticated", value: { suiteAccountId: accountId, expiresAtMs: 1_000 } });
  await Promise.all(f.lifetimes);
  expect(await f.read(incoming())).toEqual(ready); await Promise.all(f.lifetimes); expect(f.counts().reads).toBe(9);
  for (const mutate of ["expire", "close", "disable"] as const) {
    const changed = transportFixture(); let done!: (value: unknown) => void;
    changed.hold(new Promise(resolve => { done = resolve; })); const result = changed.read(incoming());
    await Promise.resolve(); changed[mutate](); done({ kind: "authenticated", value: { suiteAccountId: accountId, expiresAtMs: 1_000 } });
    expect(await result).toEqual({ schemaVersion: 1, error: { code: "unavailable" } }); await Promise.all(changed.lifetimes);
  }
});
