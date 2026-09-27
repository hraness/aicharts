import { expect, test } from "bun:test";
import { fc } from "../property-test";
import { readUsageDashboard } from "./dashboard-client";
import { encodeUsageDashboardFrame, USAGE_DASHBOARD_MEDIA, type UsageDashboardFramePart, type UsageDashboardQuery } from "./dashboard-public";

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`;
const range = { firstUtcDay: 20_700, dayCount: 30 };
const all: UsageDashboardQuery = { parts: ["account", "totals", "consent", "stats"], range };
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const tokens = { input: "18", cacheRead: "5", cacheWrite: "6", output: "10", reasoning: "1" };
const cell = { records: 3, days: 3, firstUtcDay: 20_000, lastUtcDay: 20_003, tokens };
const totals = { schemaVersion: 2, generatedAtMs: 1_000, revision: 4, updatedAtMs: 900, legacyRevision: 2, legacyVerifiedRevision: 2, legacyComplete: true,
  total: cell, clients: [{ client: "codex", basis: "snapshots", ...cell }],
  devices: [{ deviceId: "1".repeat(64), enrolledAtMs: 10, revokedAtMs: null, ...cell, clients: [{ client: "codex", basis: "snapshots", ...cell }] }] };
const parts = (overrides: Partial<Record<UsageDashboardFramePart["part"], Omit<UsageDashboardFramePart, "part">>> = {}, account = A): UsageDashboardFramePart[] => [
  { part: "account", status: 200, bytes: bytes({ schemaVersion: 1, state: "ready", account: { accountId: account } }), ...overrides.account },
  { part: "totals", status: 200, bytes: bytes({ schemaVersion: 2, ok: true, value: totals }), ...overrides.totals },
  { part: "consent", status: 200, bytes: bytes({ schemaVersion: 1, state: "not_enrolled" }), ...overrides.consent },
  { part: "stats", status: 200, bytes: bytes({ schemaVersion: 2, ok: false, error: "not_started" }), ...overrides.stats },
];
const frame = (value: Parameters<typeof encodeUsageDashboardFrame>[0]) => encodeUsageDashboardFrame(value)!;
const ready = (list = parts(), accountId = A) => frame({ kind: "ready", accountId, sessionRefreshInMs: 60_000, parts: list });
const serve = (body: BodyInit | null, init: ResponseInit & { headers?: Record<string, string> } = {}) => {
  const seen: RequestInit[] = [];
  const fetcher = (async (_input: RequestInfo | URL, request?: RequestInit) => {
    seen.push(request ?? {});
    return new Response(body, { status: 200, ...init, headers: { "content-type": USAGE_DASHBOARD_MEDIA, ...init.headers } });
  }) as typeof fetch;
  return { fetcher, seen };
};
const read = (fetcher: typeof fetch, query = all, signal = new AbortController().signal) => readUsageDashboard(query, signal, fetcher);

test("one same-origin read admits every part with its standalone decoder and binds each to the frame's account", async () => {
  const { fetcher, seen } = serve(ready());
  const result = await read(fetcher);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { accept: USAGE_DASHBOARD_MEDIA } });
  if (result.kind !== "ready") throw new Error("expected a ready read");
  expect(result.accountId).toBe(A); expect(result.sessionRefreshInMs).toBe(60_000);
  expect(result.account).toEqual({ schemaVersion: 1, state: "ready", account: { accountId: A } });
  expect(result.totals).toMatchObject({ ok: true, accountId: A });
  expect(result.consent).toEqual({ schemaVersion: 1, state: "not_enrolled", accountId: A });
  expect(result.stats).toMatchObject({ status: 200, accountId: A, range });
  expect(await result.stats!.body.text()).toBe('{"schemaVersion":2,"ok":false,"error":"not_started"}');
});

test("an unavailable part stays unbound on its own, exactly as its standalone endpoint answers it", async () => {
  const down = parts({ totals: { status: 503, bytes: bytes({ schemaVersion: 2, ok: false, error: "unavailable" }) },
    consent: { status: 503, bytes: bytes({ schemaVersion: 1, error: { code: "unavailable" } }) },
    stats: { status: 503, bytes: bytes({ schemaVersion: 2, ok: false, error: "unavailable" }) } });
  const result = await read(serve(ready(down)).fetcher);
  if (result.kind !== "ready") throw new Error("expected a ready read");
  expect(result.totals).toEqual({ schemaVersion: 2, ok: false, error: "unavailable", accountId: null });
  expect(result.consent).toEqual({ schemaVersion: 1, error: { code: "unavailable" } });
  expect(result.stats).toMatchObject({ status: 503, accountId: null });
});

test("a whole-read refusal is reported with its own status; a mismatched status is not", async () => {
  expect(await read(serve(frame({ kind: "error", error: "authentication_required" }), { status: 401 }).fetcher)).toEqual({ kind: "error", error: "authentication_required" });
  expect(await read(serve(frame({ kind: "error", error: "unavailable" }), { status: 503 }).fetcher)).toEqual({ kind: "error", error: "unavailable" });
  await expect(read(serve(frame({ kind: "error", error: "authentication_required" }), { status: 503 }).fetcher)).rejects.toThrow("usage_unavailable");
  await expect(read(serve(ready(), { status: 503 }).fetcher)).rejects.toThrow("usage_unavailable");
});

test("framing, binding and correlation failures are refused whole", async () => {
  const cases: [string, ReturnType<typeof serve>][] = [
    ["wrong media", serve(ready(), { headers: { "content-type": "application/json" } })],
    ["unexpected status", serve(ready(), { status: 500 })],
    ["declared oversize", serve(ready(), { headers: { "content-length": "999999999" } })],
    ["declared mismatch", serve(ready(), { headers: { "content-length": "7" } })],
    ["empty body", serve(null)],
    ["account part names another account", serve(ready(parts({}, B)))],
    ["part status disagrees with its body", serve(ready(parts({ totals: { status: 503, bytes: bytes({ schemaVersion: 2, ok: true, value: totals }) } })))],
    ["consent body fails its decoder", serve(ready(parts({ consent: { status: 200, bytes: bytes({ schemaVersion: 1, state: "ready" }) } })))],
    ["truncated frame", serve(ready().slice(0, -1))],
  ];
  for (const [name, { fetcher }] of cases) await expect(read(fetcher), name).rejects.toThrow("usage_unavailable");
  // The frame must answer exactly the parts that were asked for, in order.
  await expect(read(serve(ready()).fetcher, { parts: ["account", "totals"], range: null })).rejects.toThrow("usage_unavailable");
  await expect(read(serve(ready(parts().slice(0, 2))).fetcher)).rejects.toThrow("usage_unavailable");
  // An invalid query never reaches the network.
  const idle = serve(ready());
  await expect(read(idle.fetcher, { parts: ["stats"], range: null })).rejects.toThrow("usage_unavailable");
  expect(idle.seen).toHaveLength(0);
});

test("an aborted read never reports a result, and a read aborted before dispatch never reaches the network", async () => {
  const controller = new AbortController();
  // Like Fetch, aborting the request errors its body stream mid-read.
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({ start(stream) {
    stream.enqueue(ready().slice(0, 8));
    init?.signal?.addEventListener("abort", () => stream.error(new DOMException("aborted", "AbortError")), { once: true });
  } }), { status: 200, headers: { "content-type": USAGE_DASHBOARD_MEDIA } })) as typeof fetch;
  const pending = read(fetcher, all, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  await expect(pending).rejects.toThrow("usage_unavailable");
  const idle = serve(ready()), aborted = new AbortController(); aborted.abort();
  await expect(read(idle.fetcher, all, aborted.signal)).rejects.toThrow("usage_unavailable");
  expect(idle.seen).toHaveLength(0);
});

test("arbitrary response bytes either decode to a ready or error read or are refused, never throw anything else", async () => {
  await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 256 }), fc.constantFrom(200, 401, 503), async (body, status) => {
    try {
      const result = await read(serve(body, { status }).fetcher);
      expect(["ready", "error"]).toContain(result.kind);
    } catch (error) { expect(String(error)).toContain("usage_unavailable"); }
  }), { numRuns: 200 });
});
