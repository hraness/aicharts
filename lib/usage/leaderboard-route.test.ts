import { expect, mock, test } from "bun:test";
import { decodeLeaderboardPublicReply, LEADERBOARD_PUBLIC_MEDIA, LEADERBOARD_PUBLIC_URL } from "./leaderboard-public";
import type { LeaderboardSnapshotV1 } from "./leaderboard-contract";
mock.module("server-only", () => ({}));
const { createLeaderboardPublicHandler } = await import("./leaderboard-route");

const entry = { rank: 1, publicHandle: "alpha-coder", observedTokens: "9007199254740993", usageRecords: 4,
  consentedAtMs: 1_799_000_000_000, refreshedAtMs: 1_800_000_000_000, windowFirstUtcDay: 20_900, windowUtcDays: 30 };
const value: LeaderboardSnapshotV1 = { schemaVersion: 1, ranking: "observed-tokens-30d-v1",
  computedAtMs: 1_800_000_000_000, entries: [entry] };
const ready = { kind: "ready", value };
function incoming(options: { method?: string; url?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  return new Request(options.url ?? LEADERBOARD_PUBLIC_URL, { method: options.method ?? "GET", signal: options.signal,
    headers: { accept: "application/json", ...options.headers } });
}
function fixture(options: { available?: () => boolean; read?: () => Promise<unknown> } = {}) {
  let calls = 0, checks = 0;
  const handle = createLeaderboardPublicHandler({ available() { checks++; return options.available?.() ?? true; },
    async read(request) {
      calls++; expect(request instanceof Request).toBe(true);
      return options.read ? options.read() : ready;
    } });
  return { handle, counts: () => ({ calls, checks }) };
}
function privacy(response: Response) {
  expect(response.headers.get("content-type")).toBe(LEADERBOARD_PUBLIC_MEDIA);
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  for (const header of ["set-cookie", "location", "etag", "last-modified",
    "access-control-allow-origin", "access-control-allow-credentials"]) expect(response.headers.has(header)).toBe(false);
}
async function result(response: Response) {
  privacy(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.byteLength).toBeLessThanOrEqual(49_152);
  const body = decodeLeaderboardPublicReply(bytes); expect(body).not.toBeNull(); return body;
}

test("a ready materialized snapshot is served without any account identity", async () => {
  const f = fixture();
  const response = await f.handle(incoming({ headers: { "if-none-match": "ignored" } }));
  expect(response.status).toBe(200);
  expect(await result(response)).toEqual({ schemaVersion: 1, state: "ready", value });
  const text = JSON.stringify(value);
  expect(text).not.toContain("acct_"); expect(text).not.toContain("email"); expect(text).not.toContain("device");
  expect(f.counts().calls).toBe(1);
});

test("unsupported methods perform no availability or read work", async () => {
  const f = fixture({ available() { throw new Error("PUBLIC_CANARY"); }, read: async () => { throw new Error("PUBLIC_CANARY"); } });
  for (const method of ["POST", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
    const response = await f.handle(incoming({ method }));
    expect(response.status).toBe(405); privacy(response);
    expect(response.headers.get("allow")).toBe("GET");
    if (method === "HEAD") expect(await response.text()).toBe("");
    else expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "method_not_allowed" } });
  }
  expect(f.counts()).toEqual({ calls: 0, checks: 0 });
});

test("a closed public flag returns fixed 503 for GET without reading request data", async () => {
  const f = fixture({ available: () => false });
  const request = incoming();
  Object.defineProperty(request, "url", { get() { throw new Error("PUBLIC_CANARY"); } });
  const response = await f.handle(request);
  expect(response.status).toBe(503);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  expect(f.counts().calls).toBe(0);
});

test("only the canonical origin and exact URL are served", async () => {
  const f = fixture();
  for (const options of [
    { url: "https://www.aicharts.io/api/leaderboard" },
    { url: "https://foreign.example/api/leaderboard" },
    { url: `${LEADERBOARD_PUBLIC_URL}/` },
    { url: `${LEADERBOARD_PUBLIC_URL}?accountId=PUBLIC_CANARY` },
    { url: `${LEADERBOARD_PUBLIC_URL}#fragment` },
    { url: `https://aicharts.io/api/leaderboard?${"x".repeat(300)}` },
    { headers: { authorization: "Bearer PUBLIC_CANARY" } },
    { headers: { cookie: "session=PUBLIC_CANARY" } },
    { headers: { "content-type": "application/json" } },
    { headers: { "content-encoding": "gzip" } },
    { headers: { "transfer-encoding": "chunked" } },
    { headers: { "content-length": "1" } },
    { headers: { accept: "*/*" } },
  ] as Parameters<typeof incoming>[0][]) {
    const response = await f.handle(incoming(options));
    const body = await result(response);
    expect([400, 403]).toContain(response.status);
    expect((body as { error: { code: string } }).error.code === "invalid_request"
      || (body as { error: { code: string } }).error.code === "request_rejected").toBe(true);
  }
  expect(f.counts().calls).toBe(0);
});

test("only a checked ready outcome is served; every other outcome is fixed 503", async () => {
  for (const raw of [null, { kind: "unavailable" }, { kind: "ready", value: { ...value, ranking: "other" } },
    { kind: "ready", value: { ...value, entries: [{ ...entry, accountId: "acct_x" }] } },
    { kind: "query", result: { ok: true, value } }, { kind: "ready", value, extra: "PUBLIC_CANARY" }]) {
    const g = fixture({ read: async () => raw });
    const reply = await g.handle(incoming());
    expect(reply.status).toBe(503);
    expect(await result(reply)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  }
});

test("feature closure, abort and thrown reads suppress every late outcome", async () => {
  for (const raw of [ready, { kind: "unavailable" }]) {
    let available = true;
    const f = fixture({ available: () => available, read: async () => { available = false; return raw; } });
    expect((await f.handle(incoming())).status).toBe(503);
  }
  const controller = new AbortController();
  const aborted = fixture({ read: async () => { controller.abort(); return ready; } });
  expect((await aborted.handle(incoming({ signal: controller.signal }))).status).toBe(503);
  const thrown = fixture({ read: async () => { throw new Error("PUBLIC_CANARY"); } });
  const response = await thrown.handle(incoming());
  expect(response.status).toBe(503);
  expect(await result(response)).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
});
