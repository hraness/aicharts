import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { metricBenchmarkFixture } from "../lib/usage/metric-explorer.bench";
import { createMetricSnapshot, disposeMetricSnapshot, evaluateMetricQuery, parseMetricQuery, type MetricQuery } from "../lib/usage/metric-explorer";
import { SUPPORTED_METRIC_IDS } from "../lib/usage/metric-explorer-values";
import { decodeMetricPresentation, encodeMetricPresentation, metricPresentation } from "../components/usage/stats-metric-presentation";
import { parseUsageStatsReport, type UsageStatsReport } from "../lib/usage/stats-contract";
import { USAGE_ACCOUNT_HEADER, USAGE_ACCOUNT_MEDIA } from "../lib/usage/account-public";
import { parseStatsPublicSearch, STATS_PUBLIC_MAX_BYTES, STATS_PUBLIC_MEDIA } from "../lib/usage/stats-public";
import { STATS_HTTP_RESPONSE_ROWS } from "../lib/usage/stats-http-contract";
import type { UsageStatsBrowserRuntime } from "./usage-stats-performance";
import { diagnosticCdp, diagnosticRecord, memoryProcessTotals, metricQueryTrace, MetricTrace, MetricWorkerCdp, ownedMetricTargets, summarizeCpuProfile } from "./usage-stats-cdp";

type WireSpan = { worker: number; id: number; kind: string; started: number; finished?: number; reply?: string; viewBytes?: number };
type Probe = { spans: WireSpan[]; urls: string[]; holdReady: boolean; readyHeld: boolean; releaseReady?: () => void; longTasks: number[]; longTaskStart: number };
type ProbeWindow = Window & { metricWorkerDiagnostic?: Probe };
type Episode = { context: BrowserContext; page: Page; effects: string[]; errors: string[]; workers: () => { created: number; live: number; peak: number }; local: () => void };
function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const exact = (count: bigint) => `${new Intl.NumberFormat("en-US").format(count)} exact`;
const expectedTokens = (rows: number) => BigInt(rows) * BigInt(rows + 1) / 2n + BigInt(rows) * 1030n;
const save = (directory: string, name: string, value: unknown) => writeFile(resolve(directory, name), JSON.stringify(value, null, 2) + "\n");
const frames = (page: Page) => page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
const ready = async (page: Page, total?: bigint) => {
  await page.waitForFunction(expected => document.querySelector(".usage-stats")?.getAttribute("aria-busy") === "false"
    && (expected === null || document.querySelector(".usage-stats__exact")?.textContent === expected), total === undefined ? null : exact(total));
  await frames(page);
};
const sample = (page: Page) => page.evaluate(() => {
  const state = (window as ProbeWindow).metricWorkerDiagnostic!;
  return { spans: state.spans.map(span => ({ ...span, wireMs: span.finished === undefined ? null : span.finished - span.started })), longTasksMs: state.longTasks };
});
const resetSample = (page: Page) => page.evaluate(() => { const state = (window as ProbeWindow).metricWorkerDiagnostic!; state.spans = []; state.longTasks = []; state.longTaskStart = performance.now(); });

async function episode(browser: Browser, baseUrl: string, fixture: string, hosted?: { body: string; firstUtcDay: number; dayCount: number }): Promise<Episode> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript(() => {
    const state: Probe = { spans: [], urls: [], holdReady: false, readyHeld: false, longTasks: [], longTaskStart: 0 };
    (window as ProbeWindow).metricWorkerDiagnostic = state;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.startTime >= state.longTaskStart && state.longTasks.length < 256) state.longTasks.push(entry.duration); }).observe({ type: "longtask", buffered: false });
    const NativeWorker = window.Worker; let sequence = 0;
    window.Worker = class extends NativeWorker {
      readonly diagnosticId: number;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.diagnosticId = ++sequence;
        if (state.urls.length < 16) state.urls.push(new URL(String(url), location.href).href);
        this.addEventListener("message", event => {
          const reply = event.data as { kind?: unknown; id?: unknown; viewBytes?: unknown };
          const span = state.spans.find(span => span.worker === this.diagnosticId && span.id === reply.id);
          if (span) {
            span.finished = performance.now(); span.reply = String(reply.kind); if (typeof reply.viewBytes === "number") span.viewBytes = reply.viewBytes;
            if (span.kind === "query" && reply.kind === "result") performance.mark(`metric-query-reply:${this.diagnosticId}-${span.id}`);
          }
          if (state.holdReady && reply.kind === "ready") {
            state.holdReady = false; state.readyHeld = true; event.stopImmediatePropagation();
            state.releaseReady = () => { state.readyHeld = false; delete state.releaseReady; this.dispatchEvent(new MessageEvent("message", { data: event.data })); };
          }
        });
      }
      override postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
        const value = message as { id?: unknown; kind?: unknown };
        if (typeof value?.id === "number" && typeof value.kind === "string" && state.spans.length < 128) {
          state.spans.push({ worker: this.diagnosticId, id: value.id, kind: value.kind, started: performance.now() });
          if (value.kind === "query") performance.mark(`metric-query-post:${this.diagnosticId}-${value.id}`);
        }
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
    };
  });
  const page = await context.newPage(), errors: string[] = [], effects: string[] = [];
  let created = 0, live = 0, peak = 0, local = false;
  page.on("worker", worker => { created++; peak = Math.max(peak, ++live); worker.on("close", () => live--); });
  page.on("pageerror", error => errors.push(error.message.slice(0, 500)));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://account.hraness.com" && request.method() === "GET" && url.pathname === "/api/consent/region") {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"region":null,"required":false}' }); return;
    }
    if (url.origin === "https://account.hraness.com" && request.method() === "POST" && url.pathname === "/api/mailing/experiment") { await route.fulfill({ status: 204 }); return; }
    if (local && (request.method() !== "GET" || url.pathname.startsWith("/api/usage/"))) effects.push(`${request.method()} ${url.pathname}`);
    if (url.origin !== baseUrl) { effects.push(`blocked ${url.origin}${url.pathname}`); await route.abort(); return; }
    if (url.pathname === "/__synthetic-metric-report") { await route.fulfill({ status: 200, contentType: "application/json", body: fixture }); return; }
    if (url.pathname === "/api/suite-auth/session") { await route.fulfill({ status: 200, contentType: "application/json", body: '{"kind":"signed_out"}' }); return; }
    if (url.pathname === "/api/usage/account") {
      await route.fulfill({ status: hosted ? 200 : 401, contentType: USAGE_ACCOUNT_MEDIA, body: JSON.stringify(hosted
        ? { schemaVersion: 1, state: "ready", account: { accountId: `acct_${"c".repeat(32)}` } }
        : { schemaVersion: 1, error: { code: "authentication_required" } }) }); return;
    }
    if (url.pathname === "/api/usage/stats" && hosted?.body) {
      const range = parseStatsPublicSearch(url.search);
      invariant(range && range.firstUtcDay === hosted.firstUtcDay && range.dayCount === hosted.dayCount, "Hosted diagnostic must bind the exact requested range.");
      await route.fulfill({ status: 200, headers: { "content-type": STATS_PUBLIC_MEDIA, [USAGE_ACCOUNT_HEADER]: `acct_${"c".repeat(32)}` }, body: hosted.body }); return;
    }
    if (url.pathname.startsWith("/api/")) { await route.fulfill({ status: 401, contentType: "application/json", body: '{"schemaVersion":1,"error":{"code":"authentication_required"}}' }); return; }
    await route.continue();
  });
  try {
    await page.goto(`${baseUrl}/usage/details`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Your usage", exact: true }).waitFor();
    await page.locator(".usage-account__status").getByText(hosted ? "Verified with Hraness" : "Sign-in required", { exact: true }).waitFor(); await frames(page);
    return { context, page, errors, effects, workers: () => ({ created, live, peak }), local: () => { local = true; } };
  } catch (error) { await context.close(); throw error; }
}

async function importMaximum(page: Page, text: string, report: UsageStatsReport) {
  await page.getByLabel("Open numeric usage report", { exact: true }).setInputFiles({ name: "synthetic-maximum.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await page.getByText("Local report loaded.", { exact: true }).waitFor(); await ready(page);
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  const date = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("From", { exact: true }).fill(date(report.firstUtcDay)); await page.getByLabel("Through", { exact: true }).fill(date(report.firstUtcDay + report.dayCount - 1));
  await page.getByRole("button", { name: "Apply dates", exact: true }).click(); await ready(page, expectedTokens(report.rows.length));
}
async function maximumGrouping(page: Page, rows: number) {
  await page.getByRole("group", { name: "Group usage by", exact: true }).getByRole("button", { name: "Models", exact: true }).click(); await ready(page);
  await page.getByRole("region", { name: "Metric explorer", exact: true }).getByLabel("Second grouping").selectOption("utc-day"); await ready(page, expectedTokens(rows));
}
async function closeReport(run: Episode) {
  await run.page.locator(".usage-stats-source__menu > summary").click(); await run.page.getByRole("button", { name: "Close report", exact: true }).click();
  await run.page.locator(".usage-stats").waitFor({ state: "detached" }); await frames(run.page);
  for (let attempt = 0; attempt < 20 && run.workers().live !== 0; attempt++) await run.page.waitForTimeout(50);
  invariant(run.workers().live === 0, "Closing a report retained its worker.");
}
function assertEpisode(run: Episode, maximum: number) {
  invariant(run.workers().peak <= maximum && run.workers().live === 0 && run.errors.length === 0 && run.effects.length === 0,
    `Synthetic worker episode failed privacy/runtime/lifetime: ${JSON.stringify({ workers: run.workers(), errors: run.errors, effects: run.effects })}`);
}
async function singleWorker(root: CDPSession, baseUrl: string) {
  const targets = await ownedMetricTargets(root, baseUrl); invariant(targets.length === 1, "Expected one exact owned worker target.");
  return { ...targets[0], session: await MetricWorkerCdp.attach(root, targets[0].id) };
}

async function cpuEpisode(browser: Browser, root: CDPSession, baseUrl: string, directory: string, report: UsageStatsReport, json: string) {
  const run = await episode(browser, baseUrl, json); run.local();
  let worker: Awaited<ReturnType<typeof singleWorker>> | null = null, trace: MetricTrace | null = null;
  const pageCdp = await run.context.newCDPSession(run.page); let workerProfiling = false, mainProfiling = false;
  try {
    await importMaximum(run.page, json, report); await maximumGrouping(run.page, report.rows.length);
    worker = await singleWorker(root, baseUrl);
    const workerPath = new URL(worker.url).pathname;
    const bundle = await readFile(resolve(".next", workerPath.slice("/_next/".length)));
    const filtered = async () => {
      await run.page.getByLabel("Model", { exact: true }).selectOption(report.rows[0].model!);
      await run.page.waitForFunction(expected => document.querySelector(".usage-stats__exact")?.textContent !== expected
        && document.querySelector(".usage-stats")?.getAttribute("aria-busy") === "false", exact(expectedTokens(report.rows.length)));
    };
    const query = async () => {
      await resetSample(run.page); const started = performance.now(); await run.page.getByLabel("Model", { exact: true }).selectOption("*");
      await ready(run.page, expectedTokens(report.rows.length)); return { wallMs: performance.now() - started, ...await sample(run.page) };
    };
    const unprofiled = [];
    for (let index = 0; index < 5; index++) { await filtered(); unprofiled.push(await query()); }
    await filtered();
    await worker.session.send("Profiler.enable"); await diagnosticCdp(pageCdp, "Profiler.enable");
    await worker.session.send("Profiler.setSamplingInterval", { interval: 1000 }); await diagnosticCdp(pageCdp, "Profiler.setSamplingInterval", { interval: 1000 });
    trace = await MetricTrace.start(root, resolve(directory, "query-trace.json"), false);
    await worker.session.send("Profiler.start"); workerProfiling = true;
    await diagnosticCdp(pageCdp, "Profiler.start"); mainProfiling = true;
    const instrumented = await query();
    const workerProfile = (await worker.session.send("Profiler.stop")).profile; workerProfiling = false;
    const mainProfile = (await diagnosticCdp(pageCdp, "Profiler.stop")).profile; mainProfiling = false;
    await save(directory, "worker.cpuprofile", workerProfile); await save(directory, "main.cpuprofile", mainProfile);
    const traceResult = await trace.finish(); trace = null;
    invariant(Array.isArray(traceResult.traceEvents), "CPU trace did not contain events.");
    const heap = { page: await diagnosticCdp(pageCdp, "Runtime.getHeapUsage"), worker: await worker.session.send("Runtime.getHeapUsage") };
    await save(directory, "cpu-samples.json", { target: { id: worker.id, url: worker.url, bundleSha256: createHash("sha256").update(bundle).digest("hex") }, unprofiled, instrumented, heap });
    const queryTrace = metricQueryTrace(traceResult);
    invariant(queryTrace.matched, `Query trace did not bind the measured worker interval: ${queryTrace.reason}`);
    const window = queryTrace.window;
    const value = { target: { id: worker.id, url: worker.url, bundleSha256: createHash("sha256").update(bundle).digest("hex") }, unprofiled, instrumented,
      workerCpu: summarizeCpuProfile(workerProfile, window), mainCpu: summarizeCpuProfile(mainProfile, window), queryTrace, heap, traceEvents: traceResult.traceEvents.length,
      limitations: "Five warm samples on declared hardware are not population p95 or modest-hardware evidence. Instrumented timings are separate. Main Long Tasks and worker wire completion are distinct. Profile idle time alone is not measured handoff delay." };
    await worker.session.close(); worker = null; await closeReport(run); assertEpisode(run, 1); return value;
  } finally {
    if (workerProfiling) await worker?.session.send("Profiler.stop").catch(() => undefined);
    if (mainProfiling) await diagnosticCdp(pageCdp, "Profiler.stop").catch(() => undefined);
    await worker?.session.close(); if (trace) await trace.finish().catch(() => undefined);
    await pageCdp.detach(); await run.context.close();
  }
}

async function memoryEpisode(browser: Browser, root: CDPSession, baseUrl: string, directory: string, report: UsageStatsReport, json: string) {
  const run = await episode(browser, baseUrl, json); run.local(); const pageCdp = await run.context.newCDPSession(run.page);
  let trace: MetricTrace | null = null;
  const sessions = new Map<string, MetricWorkerCdp>(), ownedIds = new Set<number>(), points: unknown[] = [];
  const point = async (name: string) => {
    const targets = await ownedMetricTargets(root, baseUrl); invariant(targets.length <= 2, "Memory episode exceeded two workers.");
    for (const target of targets) if (!sessions.has(target.id)) sessions.set(target.id, await MetricWorkerCdp.attach(root, target.id));
    for (const [id, session] of sessions) if (!targets.some(target => target.id === id)) { await session.close(); sessions.delete(id); }
    const processes = await diagnosticCdp(root, "SystemInfo.getProcessInfo"); invariant(Array.isArray(processes.processInfo) && processes.processInfo.length <= 64, "Owned process inventory exceeded its bound.");
    for (const value of processes.processInfo) { const process = diagnosticRecord(value); invariant(typeof process.id === "number", "Owned process identity missing."); ownedIds.add(process.id); }
    const dump = await diagnosticCdp(root, "Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" }); invariant(dump.success === true, "Physical memory dump failed.");
    points.push({ name, elapsedAtMs: performance.now(), processes: processes.processInfo, dump,
      pageHeap: await diagnosticCdp(pageCdp, "Runtime.getHeapUsage"), workerHeap: await Promise.all([...sessions].map(async ([id, session]) => ({ id, ...await session.send("Runtime.getHeapUsage") }))) });
    await save(directory, "memory-points.json", { points, limitation: "Named diagnostic samples; physical trace admission is a separate gate." });
  };
  try {
    trace = await MetricTrace.start(root, resolve(directory, "memory-trace.json"), true); await point("no-report");
    await importMaximum(run.page, json, report); await point("one-captured-report");
    let queryFinished = false;
    const pendingQuery = maximumGrouping(run.page, report.rows.length).finally(() => { queryFinished = true; });
    void pendingQuery.catch(() => undefined);
    try { for (let index = 0; index < 3 && !queryFinished; index++) { await run.page.waitForTimeout(100); if (!queryFinished) await point(`maximum-query-sample-${index}`); } }
    finally { await pendingQuery; }
    await point("maximum-groups-settled");
    await run.page.evaluate(() => { (window as ProbeWindow).metricWorkerDiagnostic!.holdReady = true; });
    await run.page.getByLabel("Open numeric usage report", { exact: true }).setInputFiles({ name: "second-maximum.json", mimeType: "application/json", buffer: Buffer.from(json) });
    await run.page.waitForFunction(() => (window as ProbeWindow).metricWorkerDiagnostic!.readyHeld);
    invariant(run.workers().live === 2, "Held replacement must contain two complete report workers."); await point("two-fully-captured-reports");
    await run.page.evaluate(() => { const release = (window as ProbeWindow).metricWorkerDiagnostic!.releaseReady; if (!release) throw new Error("Missing held candidate reply."); release(); });
    await ready(run.page); await point("replacement-adopted");
    await closeReport(run); await point("closed-before-forced-gc");
    await diagnosticCdp(pageCdp, "HeapProfiler.collectGarbage"); await point("closed-after-page-gc");
    const raw = await trace.finish(); trace = null; assertEpisode(run, 2);
    const processMemory = memoryProcessTotals(raw, ownedIds); invariant(processMemory.samples.length > 0, "Memory trace had no owned process totals; physical memory remains unqualified.");
    return { points, workers: run.workers(), processMemory,
      limitations: "Detailed memory dumps perturb allocation and are not latency samples. They capture process footprint and per-target V8 usage at named boundaries, not an exclusive physical-worker peak. Two snapshots are fully captured before replacement. Playwright file construction remains outside native-picker qualification." };
  } finally { for (const session of sessions.values()) await session.close(); if (trace) await trace.finish().catch(() => undefined); await pageCdp.detach(); await run.context.close(); }
}

export function workerProfileQuery(report: UsageStatsReport): MetricQuery {
  const query = parseMetricQuery({ schemaVersion: 1, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount,
    filters: { client: "*", provider: "*", model: "*" }, basis: "reported", costKind: "estimated", groupBy: ["model", "utc-day"],
    metricIds: [...SUPPORTED_METRIC_IDS].filter(id => !["cache-write-unknown-tokens", "cache-write-volume-unknown", "model-consumed-tokens", "utc-day-tokens",
      "utc-week-tokens", "utc-month-tokens", "weekday-token-heatmap", "cumulative-tokens", "cache-read-token-share", "cache-write-token-share"].includes(id)),
    topK: 50, sortBy: "accounted-tokens", sortDirection: "desc" });
  invariant(query && query.metricIds.length === 32, "Protocol fixture must select exactly 32 admitted metrics.");
  return query;
}
async function protocolEpisode(browser: Browser, root: CDPSession, baseUrl: string, report: UsageStatsReport, json: string) {
  const query = workerProfileQuery(report);
  const run = await episode(browser, baseUrl, json); run.local();
  try {
    // Discover through the built application independently of the CPU episode.
    await run.page.getByRole("button", { name: "Explore example", exact: true }).click(); await ready(run.page);
    const targets = await ownedMetricTargets(root, baseUrl); invariant(targets.length === 1, "Protocol worker discovery did not bind one built target.");
    const workerUrl = targets[0].url, workerPath = new URL(workerUrl).pathname;
    const workerSha256 = createHash("sha256").update(await readFile(resolve(".next", workerPath.slice("/_next/".length)))).digest("hex");
    await closeReport(run);
    const result = await run.page.evaluate(async ({ url, query }: { url: string; query: MetricQuery }) => {
      const body = await (await fetch("/__synthetic-metric-report", { signal: AbortSignal.timeout(30_000) })).blob(), worker = new Worker(url); let sequence = 0;
      const request = (kind: string, payload: unknown) => new Promise<{ [key: string]: unknown }>((resolve, reject) => {
        const id = ++sequence, timer = setTimeout(() => { worker.removeEventListener("message", receive); worker.terminate(); reject(new Error("Direct production worker timed out.")); }, 30_000);
        const receive = (event: MessageEvent) => {
          if (event.data?.id !== id) return; clearTimeout(timer); worker.removeEventListener("message", receive);
          if (event.data.kind === "error") reject(new Error(`Direct production worker refused ${event.data.code}`)); else resolve(event.data);
        };
        worker.addEventListener("message", receive); worker.postMessage({ kind, id, payload });
      });
      try {
        const opened = await request("open", body); if (opened.kind !== "ready") throw new Error("Direct worker did not capture the fixture.");
        const started = performance.now(), value = await request("query", { slot: "main", parent: null, query }), wireMs = performance.now() - started;
        if (value.kind !== "result" || value.slot !== "main" || !(value.view instanceof ArrayBuffer) || value.view.byteLength !== value.viewBytes || value.view.byteLength > 2_097_152) throw new Error("Direct worker result boundary invalid.");
        const bytes = new Uint8Array(value.view), pieces: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 4096) pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 4096)));
        const exported = await request("export", { resultId: value.id, format: "json" });
        if (exported.kind !== "export" || exported.resultId !== value.id || !(exported.blob instanceof Blob) || exported.blob.size > 2_097_152) throw new Error("Direct export binding invalid.");
        return { wireMs, encoded: btoa(pieces.join("")), json: await exported.blob.text() };
      } finally { worker.terminate(); }
    }, { url: workerUrl, query });
    const bytes = Uint8Array.from(Buffer.from(result.encoded, "base64")), view = decodeMetricPresentation(bytes.buffer);
    invariant(JSON.stringify(view.query) === JSON.stringify(query) && view.rowCount === report.rows.length && view.totalGroups === report.rows.length
      && view.projection.totals.tokens === expectedTokens(report.rows.length), "32-metric production output lost exact query/count/total binding.");
    const snapshot = createMetricSnapshot(report); invariant(snapshot, "32-metric shared-engine comparison fixture was refused.");
    try {
      const reference = evaluateMetricQuery(snapshot, query); invariant(reference.ok, "32-metric reference query failed.");
      invariant(reference.value.groups.reduce((total, group) => total + group.fold.total, 0n) === expectedTokens(report.rows.length), "Independent fixture total must equal top-K plus Other.");
      invariant(Buffer.compare(Buffer.from(encodeMetricPresentation(metricPresentation(reference.value))), Buffer.from(bytes)) === 0, "32-metric complete presentation differed from the shared synchronous engine.");
    } finally { disposeMetricSnapshot(snapshot); }
    const exported = diagnosticRecord(JSON.parse(result.json) as unknown), identity = diagnosticRecord(exported.snapshot);
    invariant(identity.sha256 === createHash("sha256").update(json).digest("hex") && JSON.stringify(exported.query) === JSON.stringify(query), "32-metric export lost report/query identity.");
    await frames(run.page); for (let attempt = 0; attempt < 20 && run.workers().live !== 0; attempt++) await run.page.waitForTimeout(50); assertEpisode(run, 1);
    return { metricIds: query.metricIds, workerUrl, workerSha256, wireMs: result.wireMs, viewBytes: bytes.length, exportBytes: Buffer.byteLength(result.json), workers: run.workers(),
      exactTotal: expectedTokens(report.rows.length).toString(), presentationSha256: createHash("sha256").update(bytes).digest("hex"),
      limitations: "Driver-owned protocol exercise of the exact built worker, not a 32-metric UI feature. Analytic fixture conservation is independently expected; synchronous comparison shares engine implementation and is not an independent proof." };
  } finally { await run.context.close(); }
}

export function workerProfileHostedFixture(todayUtcDay: number): UsageStatsReport {
  const source = metricBenchmarkFixture(STATS_HTTP_RESPONSE_ROWS), firstUtcDay = todayUtcDay - 29, generatedAtMs = (todayUtcDay + 1) * 86_400_000;
  const report = parseUsageStatsReport({ ...source, firstUtcDay, dayCount: 30, generatedAtMs, revision: 1, updatedAtMs: generatedAtMs,
    rows: source.rows.map(row => ({ ...row, utcDay: firstUtcDay + row.utcDay - source.firstUtcDay })),
    sources: source.sources.map(source => ({ ...source, latestAtMs: generatedAtMs - 1 })) });
  invariant(report, "Hosted maximum-row fixture did not admit."); return report;
}
async function hostedEpisode(browser: Browser, root: CDPSession, baseUrl: string) {
  const report = workerProfileHostedFixture(Math.floor(Date.now() / 86_400_000)), body = JSON.stringify({ schemaVersion: 2, ok: true, value: report }), bytes = Buffer.byteLength(body);
  invariant(bytes < STATS_PUBLIC_MAX_BYTES, "Hosted fixture does not leave room to exercise the byte cap.");
  const fixture = { body, firstUtcDay: report.firstUtcDay, dayCount: report.dayCount }, run = await episode(browser, baseUrl, "{}", fixture), samples = [];
  const pageCdp = await run.context.newCDPSession(run.page);
  try {
    for (const padded of [false, true]) {
      fixture.body = padded ? body + " ".repeat(STATS_PUBLIC_MAX_BYTES - bytes) : body;
      await resetSample(run.page); await run.page.evaluate(() => performance.clearResourceTimings()); const start = performance.now();
      await run.page.getByRole("button", { name: "Load account", exact: true }).click(); await run.page.getByText("Private to your account", { exact: true }).waitFor();
      await ready(run.page, expectedTokens(report.rows.length)); const wallMs = performance.now() - start;
      const target = await singleWorker(root, baseUrl);
      try {
        samples.push({ padded, actualRows: report.rows.length, jsonBytes: bytes, acquiredBytes: Buffer.byteLength(fixture.body), whitespaceBytes: padded ? STATS_PUBLIC_MAX_BYTES - bytes : 0,
          wallMs, ...await sample(run.page), heap: { page: await diagnosticCdp(pageCdp, "Runtime.getHeapUsage"), worker: await target.session.send("Runtime.getHeapUsage") },
          transfer: await run.page.evaluate(() => performance.getEntriesByType("resource").filter(entry => new URL(entry.name).pathname === "/api/usage/stats")
            .map(entry => { const value = entry as PerformanceResourceTiming; return { durationMs: value.duration, startMs: value.startTime, responseStartMs: value.responseStart, responseEndMs: value.responseEnd, encodedBodySize: value.encodedBodySize, decodedBodySize: value.decodedBodySize }; })) });
      } finally { await target.session.close(); }
      await closeReport(run);
    }
    assertEpisode(run, 1); return { samples, workers: run.workers(), limitations: "Synthetic same-origin responses with exact account/range binding. The padded case qualifies acquired byte count, not extra observations. These two samples are not hosted provider latency or p95. Heap is per-target V8 usage, not physical peak." };
  } finally { await pageCdp.detach(); await run.context.close(); }
}

export const workerProfileEpisodes = ["cpu", "memory", "protocol32", "hosted"] as const;
export type WorkerProfileEpisode = typeof workerProfileEpisodes[number];
export function parseWorkerProfileEpisodes(value: string | undefined): readonly WorkerProfileEpisode[] {
  if (value === undefined) return workerProfileEpisodes;
  const values = value.split(",");
  invariant(values.length > 0 && values.length <= workerProfileEpisodes.length && new Set(values).size === values.length
    && values.every(value => workerProfileEpisodes.includes(value as WorkerProfileEpisode)), "Invalid diagnostic episode selection.");
  return values as WorkerProfileEpisode[];
}

/** Only harness code may differ when continuing a diagnostic against a
 * captured build. This does not admit reuse for a final qualification gate. */
export function admitWorkerDiagnosticBuildReuse(value: unknown, sources: Readonly<Record<string, string>>, artifacts: Readonly<Record<string, string>>,
  environment: Readonly<Record<string, string | undefined>>, nowMs = Date.now()): NonNullable<UsageStatsBrowserRuntime["build"]> {
  const receipt = diagnosticRecord(value), runtime = diagnosticRecord(receipt.runtime), build = diagnosticRecord(runtime.build);
  invariant(receipt.schemaVersion === 1 && (receipt.status === "passed" || (receipt.status === "failed" && receipt.sourceStillMatches === true))
    && runtime.mode === "production" && receipt.bun === Bun.version, "Diagnostic reuse requires captured production identity and matching Bun.");
  invariant(typeof build.startedAtMs === "number" && typeof build.finishedAtMs === "number" && Number.isSafeInteger(build.startedAtMs)
    && Number.isSafeInteger(build.finishedAtMs) && build.startedAtMs > 0 && build.finishedAtMs >= build.startedAtMs
    && build.finishedAtMs <= nowMs && nowMs - build.finishedAtMs <= 6 * 60 * 60 * 1000, "Diagnostic build age or timestamp invalid.");
  invariant(typeof build.buildId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(build.buildId)
    && Array.isArray(build.command) && JSON.stringify(build.command) === JSON.stringify([process.execPath, "run", "build"]), "Diagnostic build command or ID invalid.");
  const capturedSources = diagnosticRecord(receipt.sourceSha256), capturedArtifacts = diagnosticRecord(build.artifactSha256), capturedEnvironment = diagnosticRecord(build.environment);
  const harness = new Set(["scripts/usage-stats-browser.ts", "scripts/usage-stats-cdp.ts", "scripts/usage-stats-worker-profile.ts"]);
  invariant(Object.keys(sources).length <= 64 && Object.keys(sources).length === Object.keys(capturedSources).length
    && Object.entries(sources).every(([path, hash]) => typeof capturedSources[path] === "string" && /^[0-9a-f]{64}$/u.test(String(capturedSources[path]))
      && (harness.has(path) || capturedSources[path] === hash)), "Production product, fixture or build inputs changed before diagnostic reuse.");
  invariant(Object.keys(artifacts).length === 4 && Object.keys(capturedArtifacts).length === 4
    && Object.entries(artifacts).every(([path, hash]) => capturedArtifacts[path] === hash && /^[0-9a-f]{64}$/u.test(hash)), "Production artifact hashes changed before diagnostic reuse.");
  invariant(Object.keys(environment).length === Object.keys(capturedEnvironment).length
    && Object.entries(environment).every(([key, value]) => typeof value === "string" && capturedEnvironment[key] === value), "Build/start diagnostic environment changed.");
  return { command: [process.execPath, "run", "build"], startedAtMs: build.startedAtMs, finishedAtMs: build.finishedAtMs, buildId: build.buildId,
    artifactSha256: artifacts, environment };
}

/** Bounded causal diagnostic; each independent episode owns its result and
 * cleanup. A failed memory trace must not suppress hosted/protocol evidence. */
export async function verifyUsageStatsWorkerProfile(browser: Browser, baseUrl: string, directory: string, runtime: UsageStatsBrowserRuntime,
  selected: readonly WorkerProfileEpisode[] = workerProfileEpisodes, sourceSha256?: Readonly<Record<string, string>>) {
  invariant(runtime.mode === "production" && runtime.build !== null, "Worker profiling requires a matched production artifact."); await mkdir(directory, { recursive: true });
  const root = await browser.newBrowserCDPSession(), report = parseUsageStatsReport(metricBenchmarkFixture(65_536)); invariant(report, "Maximum report fixture was refused.");
  const json = JSON.stringify(report), result: Record<string, unknown> = { schemaVersion: 1, claim: "synthetic-production-worker-diagnostic", runtime, cpu: cpus()[0]?.model,
    browser: browser.version(), rows: report.rows.length, inputBytes: Buffer.byteLength(json), selectedEpisodes: selected,
    skippedEpisodes: workerProfileEpisodes.filter(name => !selected.includes(name)) };
  const failures: string[] = [];
  try {
    for (const name of selected) {
      const startedAtMs = Date.now();
      try {
        const value = name === "cpu" ? await cpuEpisode(browser, root, baseUrl, directory, report, json)
          : name === "memory" ? await memoryEpisode(browser, root, baseUrl, directory, report, json)
            : name === "protocol32" ? await protocolEpisode(browser, root, baseUrl, report, json)
              : await hostedEpisode(browser, root, baseUrl);
        result[name] = { status: "passed", startedAtMs, finishedAtMs: Date.now(), value };
      } catch (error) {
        const reason = error instanceof Error ? error.stack : String(error); failures.push(`${name}: ${reason}`);
        result[name] = { status: "failed", startedAtMs, finishedAtMs: Date.now(), reason };
      }
      await save(directory, `episode-${name}.json`, { schemaVersion: 1, runtime, sourceSha256, result: result[name],
        qualification: "Episode result requires the outer receipt's unchanged source/artifact and cleanup checks. Other episodes are independent." });
      await save(directory, "worker-profile-progress.json", result);
      invariant((await ownedMetricTargets(root, baseUrl)).length === 0, `Diagnostic ${name} retained a worker after cleanup; independent episodes halted.`);
    }
    invariant((await ownedMetricTargets(root, baseUrl)).length === 0, "Diagnostic completed with an owned worker target retained.");
    await save(directory, "worker-profile.json", { ...result, status: failures.length === 0 ? "passed" : "failed" });
    invariant(failures.length === 0, failures.join("\n"));
    console.log(`Production worker diagnostic episodes passed: ${selected.join(", ")}.`);
  } catch (error) { await save(directory, "worker-profile-failure.json", { ...result, status: "failed", reason: error instanceof Error ? error.stack : String(error) }); throw error; }
  finally { await root.detach(); }
}
