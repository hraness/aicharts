import { beforeEach, expect, spyOn, test } from "bun:test";
import { readPrivateStats, disposeStatsReadReply, MAX_STATS_READ_MS, MAX_STATS_READ_CHUNKS, StatsReadDeadline } from "./stats-client";
import { readAccountStats } from "./account-read-client";
import { readInUsageAccountGeneration } from "./account-generation-read";
import { acceptUsageAccountReply, captureUsageAccountRead, currentUsageAccountScope, invalidateUsageAccountGeneration, subscribeUsageAccountInvalidation } from "./account-generation";
import { createUsageStatsExample } from "./stats-example";
import { STATS_ACCOUNT_HEADER, STATS_PUBLIC_MAX_BYTES, STATS_PUBLIC_MEDIA } from "./stats-public";
import { MetricReportSession } from "./metric-explorer-session";
import type { MetricWorkerReply } from "./metric-explorer-worker-core";
import { TestMetricWorker } from "./metric-explorer-test-worker";
import { createMetricSnapshot, disposeMetricSnapshot, evaluateMetricQuery, type MetricQuery } from "./metric-explorer";
import { metricPresentation } from "../../components/usage/stats-metric-presentation";

const A = `acct_${"a".repeat(32)}`, B = `acct_${"b".repeat(32)}`;
const example = createUsageStatsExample(20_700);
const report = { ...example, revision: 1, updatedAtMs: example.generatedAtMs };
const range = { firstUtcDay: report.firstUtcDay, dayCount: report.dayCount };
const good = { schemaVersion: 2, ok: true, value: report } as const;
const failed = { schemaVersion: 2, ok: false, error: "unavailable" } as const;
const query: MetricQuery = { schemaVersion: 1, ...range, filters: { client: "*", provider: "*", model: "*" },
  basis: "reported", costKind: "reported", groupBy: ["client"], metricIds: ["accounted-tokens"], topK: 3, sortBy: "accounted-tokens", sortDirection: "desc" };
const json = (body: unknown, status = 200, accountId = A) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": STATS_PUBLIC_MEDIA, [STATS_ACCOUNT_HEADER]: accountId } });
const port = (run: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) => run as typeof fetch;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class HeldInputWorker extends TestMetricWorker {
  readonly arrived = deferred<void>();
  held: unknown;
  override postMessage(value: unknown) {
    if (typeof value === "object" && value !== null && "kind" in value && value.kind === "open-hosted") { this.held = structuredClone(value); this.arrived.resolve(); }
    else super.postMessage(value);
  }
  release() { if (this.held !== undefined) { super.postMessage(this.held); this.held = undefined; } }
}
beforeEach(() => invalidateUsageAccountGeneration("lifecycle"));

test("hosted acquisition crosses the port only as bounded bytes and returns an exact session without raw rows or identity metadata", async () => {
  const worker = new HeldInputWorker(), pending = readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal,
    port(() => json(good)), { workerFactory: () => worker });
  await worker.arrived.promise;
  const message = worker.held as { kind: string; payload: { body: Blob; range: unknown; status: number; accountId: string } };
  expect(message.kind).toBe("open-hosted"); expect(Object.keys(message.payload).sort()).toEqual(["accountId", "body", "range", "status"]);
  expect(message.payload.body).toBeInstanceOf(Blob); expect(message.payload.body.size).toBeLessThan(STATS_PUBLIC_MAX_BYTES);
  expect(message.payload.range).toEqual(range); expect(message.payload.status).toBe(200); expect(message.payload.accountId).toBe(A);
  worker.release(); const reply = await pending;
  expect(reply.ok).toBe(true); if (!reply.ok) throw new Error(reply.error);
  expect(Object.keys(reply).sort()).toEqual(["accountId", "ok", "schemaVersion", "session"]);
  expect(Object.hasOwn(reply.session.metadata, "rows")).toBe(false); expect(JSON.stringify(reply.session.metadata)).not.toContain(A);
  const view = await reply.session.query(query), snapshot = createMetricSnapshot(report)!, expected = evaluateMetricQuery(snapshot, query);
  if (!expected.ok) throw new Error(expected.code);
  expect(view).toEqual(metricPresentation(expected.value));
  expect(await (await reply.session.export(view, "json")).text()).not.toContain(A);
  disposeMetricSnapshot(snapshot); reply.session.close(); expect(worker.stopped).toBe(1);
});

test("hosted negative replies dispose their worker and retain only the response-bound authenticated absence identity", async () => {
  for (const [error, status, authenticated] of [["not_enrolled", 200, true], ["not_started", 200, true], ["range_too_large", 413, true],
    ["authentication_required", 401, false], ["request_rejected", 403, false]] as const) {
    const worker = new TestMetricWorker(), body = { schemaVersion: 2, ok: false, error } as const;
    const reply = await readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal, port(() => json(body, status)), { workerFactory: () => worker });
    expect(reply).toEqual(authenticated ? { ...body, accountId: A } : body); expect(worker.stopped).toBe(1);
  }
});

test("fatal UTF-8 and malformed hosted envelopes cannot become a session", async () => {
  for (const body of [new Blob([new Uint8Array([0xc3, 0x28])]), new Blob([JSON.stringify({ ...good, privateField: "SECRET" })]),
    new Blob([JSON.stringify({ ...good, value: { ...report, firstUtcDay: range.firstUtcDay + 1 } })])]) {
    const worker = new TestMetricWorker();
    const reply = await readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal,
      port(() => new Response(body, { headers: { "content-type": STATS_PUBLIC_MEDIA, [STATS_ACCOUNT_HEADER]: A } })), { workerFactory: () => worker });
    expect(reply).toEqual(failed); expect(worker.stopped).toBe(1);
  }
});

test("stream byte and chunk ceilings refuse before allocating a worker", async () => {
  for (const kind of ["bytes", "empty", "chunks"] as const) {
    let workers = 0, cancelled = 0, reads = 0;
    const body = new ReadableStream<Uint8Array>({ pull(control) {
      reads++; control.enqueue(new Uint8Array(kind === "bytes" ? STATS_PUBLIC_MAX_BYTES + 1 : kind === "empty" ? 0 : 1));
    }, cancel() { cancelled++; } });
    const reply = await readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal,
      port(() => new Response(body, { headers: { "content-type": STATS_PUBLIC_MEDIA, [STATS_ACCOUNT_HEADER]: A } })), { workerFactory: () => { workers++; return new TestMetricWorker(); } });
    expect(reply).toEqual(failed); expect(workers).toBe(0); expect(cancelled).toBe(1);
    expect(reads).toBeLessThanOrEqual(MAX_STATS_READ_CHUNKS + 2);
  }
});

test("aborting a fetch that ignores its signal settles promptly and cancels its eventual body without waiting for disposal", async () => {
  const controller = new AbortController(), response = deferred<Response>(); let cancelled = 0, workers = 0;
  const pending = readPrivateStats(range.firstUtcDay, range.dayCount, controller.signal, port(() => response.promise),
    { workerFactory: () => { workers++; return new TestMetricWorker(); } });
  controller.abort(); expect(await pending).toEqual(failed);
  response.resolve(new Response(new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }), { headers: { "content-type": STATS_PUBLIC_MEDIA } }));
  await Promise.resolve(); await Promise.resolve();
  expect(cancelled).toBe(1); expect(workers).toBe(0);
});

test("aborting a stalled body read does not await a stalled cancellation or admit later bytes", async () => {
  const controller = new AbortController(), entered = deferred<void>(); let cancelled = 0, workers = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull() { entered.resolve(); }, cancel() { cancelled++; return new Promise(() => {}); } }),
    { headers: { "content-type": STATS_PUBLIC_MEDIA, [STATS_ACCOUNT_HEADER]: A } });
  const pending = readPrivateStats(range.firstUtcDay, range.dayCount, controller.signal, port(() => response),
    { workerFactory: () => { workers++; return new TestMetricWorker(); } });
  await entered.promise; controller.abort(); expect(await pending).toEqual(failed); expect(cancelled).toBe(1); expect(workers).toBe(0);
});

test("monotonic expiry refuses a late fetch even before its timeout task can run", async () => {
  let now = 0, workers = 0, cancelled = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  try {
    const response = deferred<Response>(), controller = new AbortController();
    const pending = readPrivateStats(range.firstUtcDay, range.dayCount, controller.signal, port(() => response.promise),
      { workerFactory: () => { workers++; return new TestMetricWorker(); } });
    now = MAX_STATS_READ_MS + 1;
    response.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": STATS_PUBLIC_MEDIA } }));
    expect(await pending).toEqual(failed); expect(workers).toBe(0); expect(cancelled).toBe(1); expect(controller.signal.aborted).toBe(false);
  } finally { clock.mockRestore(); }
});

test("expiry after worker delivery closes its fully admitted candidate instead of returning a stale success", async () => {
  let now = 0; const clock = spyOn(performance, "now").mockImplementation(() => now);
  class ExpiringWorker extends TestMetricWorker {
    override deliver(reply: MetricWorkerReply) { super.deliver(reply); if (reply.kind === "hosted") now = MAX_STATS_READ_MS + 1; }
  }
  const worker = new ExpiringWorker();
  try {
    expect(await readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal, port(() => json(good)), { workerFactory: () => worker })).toEqual(failed);
    expect(worker.stopped).toBe(1);
  } finally { clock.mockRestore(); }
});

test("identity adoption and SDK recovery inherit the original expiry instead of starting a fresh budget", async () => {
  for (const retry of ["identity", "authentication"] as const) {
    let now = 0, reads = 0, sessions = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    const deadline = new StatsReadDeadline(new AbortController().signal), workers: TestMetricWorker[] = [];
    try {
      const pending = readInUsageAccountGeneration(signal => readAccountStats(range.firstUtcDay, range.dayCount, signal!, {
        statsDeadline: deadline, fetch: port(input => {
          if (input === "/api/suite-auth/session") { sessions++; return json({ kind: "signed_in", session: {} }); }
          now = ++reads === 1 ? MAX_STATS_READ_MS - 1 : MAX_STATS_READ_MS + 1;
          return retry === "authentication" && reads === 1 ? json({ schemaVersion: 2, ok: false, error: "authentication_required" }, 401) : json(good);
        }), statsWorkerFactory: () => { const worker = new TestMetricWorker(); workers.push(worker); return worker; },
      }), reply => reply.accountId ?? null, () => deadline.active(), reply => !reply.ok && reply.error === "authentication_required",
      { signal: deadline.signal, dispose: disposeStatsReadReply });
      expect(await pending).toBeNull(); expect(reads).toBe(2); expect(sessions).toBe(retry === "authentication" ? 1 : 0);
      expect(workers).toHaveLength(1); expect(workers.every(worker => worker.stopped === 1)).toBe(true);
    } finally { deadline.finish(); clock.mockRestore(); invalidateUsageAccountGeneration("lifecycle"); }
  }
});

test("the original header identity and requested range cannot be changed by a worker reply", async () => {
  for (const corrupt of ["identity", "range", "extra"] as const) {
    class CorruptWorker extends TestMetricWorker {
      override deliver(message: MetricWorkerReply) {
        if (message.kind === "hosted" && message.reply.ok) {
          const reply = message.reply;
          message = { ...message, reply: corrupt === "identity" ? { ...reply, accountId: B }
            : { ...reply, metadata: corrupt === "range" ? { ...reply.metadata, firstUtcDay: range.firstUtcDay + 1 }
              : Object.assign({ ...reply.metadata }, { accountId: A }) } };
        }
        super.deliver(message);
      }
    }
    const worker = new CorruptWorker();
    expect(await readPrivateStats(range.firstUtcDay, range.dayCount, new AbortController().signal, port(() => json(good)), { workerFactory: () => worker })).toEqual(failed);
    expect(worker.stopped).toBe(1);
  }
});

test("an account switch terminates pending byte admission before one fresh bound replacement, within two live workers", async () => {
  acceptUsageAccountReply(captureUsageAccountRead(), A);
  const workers: TestMetricWorker[] = []; let peak = 0, reads = 0;
  const track = (worker: TestMetricWorker) => { workers.push(worker); peak = Math.max(peak, workers.filter(item => item.stopped === 0).length); return worker; };
  const old = await MetricReportSession.open(report, undefined, () => track(new TestMetricWorker()));
  const stop = subscribeUsageAccountInvalidation(() => old.close());
  const held = new HeldInputWorker(), controller = new AbortController();
  try {
    const pending = readInUsageAccountGeneration(signal => readAccountStats(range.firstUtcDay, range.dayCount, signal!, {
      fetch: port(() => json({ ...good, value: { ...report, revision: ++reads } }, 200, reads === 1 ? A : B)),
      statsWorkerFactory: () => track(reads === 1 ? held : new TestMetricWorker()),
    }), reply => reply.accountId ?? null, () => !controller.signal.aborted, reply => !reply.ok && reply.error === "authentication_required",
    { signal: controller.signal, dispose: disposeStatsReadReply });
    await held.arrived.promise; expect(peak).toBe(2);
    acceptUsageAccountReply(captureUsageAccountRead(), B);
    expect(held.stopped).toBe(1); expect(old.closed).toBe(true);
    held.release(); const bound = await pending;
    expect(bound?.reply.ok).toBe(true); expect(reads).toBe(2); expect(peak).toBe(2);
    if (!bound?.reply.ok || bound.scope === null) throw new Error("missing current account");
    expect(bound.reply.accountId).toBe(B); expect(bound.reply.session.metadata.revision).toBe(2); expect(currentUsageAccountScope(bound.scope)).toBe(true);
    bound.reply.session.close(); expect(workers.every(worker => worker.stopped === 1)).toBe(true);
  } finally { stop(); controller.abort(); old.close(); }
});

test("cross-tab signout terminates pending hosted admission and never adopts its late result or retries", async () => {
  acceptUsageAccountReply(captureUsageAccountRead(), A);
  const held = new HeldInputWorker(), controller = new AbortController(); let reads = 0;
  const stop = subscribeUsageAccountInvalidation(reason => { if (reason === "confirmed-signout") controller.abort(); });
  try {
    const pending = readInUsageAccountGeneration(signal => readAccountStats(range.firstUtcDay, range.dayCount, signal!, {
      fetch: port(() => { reads++; return json(good); }), statsWorkerFactory: () => held,
    }), reply => reply.accountId ?? null, () => !controller.signal.aborted, reply => !reply.ok && reply.error === "authentication_required",
    { signal: controller.signal, dispose: disposeStatsReadReply });
    await held.arrived.promise; invalidateUsageAccountGeneration("confirmed-signout");
    expect(held.stopped).toBe(1); expect(await pending).toBeNull();
    held.release(); await Promise.resolve(); expect(reads).toBe(1); expect(held.stopped).toBe(1);
  } finally { stop(); controller.abort(); }
});

test("auth recovery disposes an admitted success cancelled between worker delivery and the recovery continuation", async () => {
  const controller = new AbortController(), workers: TestMetricWorker[] = []; let reads = 0, sessions = 0;
  class CancellingWorker extends TestMetricWorker {
    override deliver(reply: MetricWorkerReply) {
      super.deliver(reply);
      if (reply.kind === "hosted" && reply.reply.ok) queueMicrotask(() => queueMicrotask(() => controller.abort()));
    }
  }
  const pending = readAccountStats(range.firstUtcDay, range.dayCount, controller.signal, {
    fetch: port(input => {
      if (input === "/api/suite-auth/session") { sessions++; return json({ kind: "signed_in", session: {} }); }
      return ++reads === 1 ? json({ schemaVersion: 2, ok: false, error: "authentication_required" }, 401) : json(good);
    }), statsWorkerFactory: () => { expect(workers.every(worker => worker.stopped === 1)).toBe(true); const worker = new CancellingWorker(); workers.push(worker); return worker; },
  });
  await expect(pending).rejects.toThrow("usage_unavailable");
  expect(reads).toBe(2); expect(sessions).toBe(1); expect(workers).toHaveLength(2); expect(workers.every(worker => worker.stopped === 1)).toBe(true);
});
