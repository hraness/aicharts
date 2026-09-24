import type { Browser, Page } from "playwright-core";
import { createHash } from "node:crypto";
import { cpus, platform, arch } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { metricBenchmarkFixture } from "../lib/usage/metric-explorer.bench";
import { parseUsageStatsReport } from "../lib/usage/stats-contract";
import { USAGE_ACCOUNT_MEDIA } from "../lib/usage/account-public";

type Probe = { started: number; active: boolean; longTasks: number[]; frames: number[]; inputFrames: number[] };
type ProbeWindow = Window & { metricPerformanceProbe?: Probe };
export type UsageStatsBrowserRuntime = Readonly<{ mode: "development" | "production"; build: null | Readonly<{
  command: readonly string[]; startedAtMs: number; finishedAtMs: number; buildId: string;
  artifactSha256: Readonly<Record<string, string>>; environment: Readonly<Record<string, string | undefined>>;
}> }>;
function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const settled = (page: Page) => page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
});

/** Real application admission/filter/export diagnostic at the existing row
 * ceiling. Every source is synthetic, and external routes are blocked. */
export async function verifyUsageStatsMaximum(browser: Browser, baseUrl: string, directory: string, runtime: UsageStatsBrowserRuntime) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage(), errors: string[] = [], effects: string[] = [];
  let liveWorkers = 0, peakWorkers = 0, createdWorkers = 0;
  page.on("worker", worker => { createdWorkers++; peakWorkers = Math.max(peakWorkers, ++liveWorkers); worker.on("close", () => { liveWorkers--; }); });
  let importing = false;
  page.on("pageerror", error => errors.push(error.message.slice(0, 500)));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://account.hraness.com" && request.method() === "GET" && url.pathname === "/api/consent/region") {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"region":null,"required":false}' }); return;
    }
    if (url.origin === "https://account.hraness.com" && request.method() === "POST" && url.pathname === "/api/mailing/experiment") {
      await route.fulfill({ status: 204 }); return;
    }
    if (importing && (request.method() !== "GET" || url.pathname.startsWith("/api/usage/"))) effects.push(`${request.method()} ${url.pathname}`);
    if (url.origin !== baseUrl) { await route.abort(); return; }
    if (url.pathname === "/api/suite-auth/session") {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"kind":"signed_out"}' }); return;
    }
    if (url.pathname === "/api/usage/account") {
      invariant(request.method() === "GET" && url.search === "" && request.postData() === null, "Account identity must use its fixed read contract.");
      await route.fulfill({ status: 401, contentType: USAGE_ACCOUNT_MEDIA, body: '{"schemaVersion":1,"error":{"code":"authentication_required"}}' }); return;
    }
    if (url.pathname.startsWith("/api/usage/")) {
      await route.fulfill({ status: 401, contentType: "application/json", body: '{"schemaVersion":1,"error":{"code":"authentication_required"}}' }); return;
    }
    await route.continue();
  });
  const report = parseUsageStatsReport(metricBenchmarkFixture(65_536)); invariant(report, "Maximum synthetic fixture failed admission.");
  const reportJson = JSON.stringify(report), expected = 65_536n * 65_537n / 2n + 65_536n * 1030n;
  const expectedText = `${new Intl.NumberFormat("en-US").format(expected)} exact`;
  const sources = ["scripts/usage-stats-performance.ts", "scripts/usage-stats-browser.ts", "lib/usage/metric-explorer.bench.ts", "lib/usage/metric-explorer.ts",
    "lib/usage/metric-explorer-fold.ts", "lib/usage/metric-explorer-values.ts", "lib/usage/stats-contract.ts", "components/usage/stats-dashboard.tsx", "components/usage/stats-report-file.ts",
    "lib/usage/metric-explorer-session.ts", "lib/usage/metric-explorer-worker.ts", "lib/usage/metric-explorer-worker-core.ts", "components/usage/stats-metric-presentation.ts", "components/usage/stats-metric-query.ts",
    "components/usage/stats-metric-daily-table.tsx",
    "components/usage/stats-report-view.tsx", "components/usage/stats-metric-explorer.tsx", "components/usage/stats-metric-projection.ts", "components/usage/stats-export.ts", "package.json", "bun.lock"];
  const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  const sourceSha256 = await hashes(), samples: unknown[] = [];
  const begin = () => page.evaluate(() => { const state = (window as ProbeWindow).metricPerformanceProbe!;
    state.started = performance.now(); state.active = true; state.longTasks = []; state.frames = []; state.inputFrames = [];
  });
  const finish = async (name: string) => {
    await settled(page);
    samples.push(await page.evaluate(name => { const state = (window as ProbeWindow).metricPerformanceProbe!; state.active = false;
      return { name, wallMs: performance.now() - state.started, longTasksMs: state.longTasks, frameGapsMs: state.frames,
        inputToFirstFrameMs: state.inputFrames, maxLongTaskMs: Math.max(0, ...state.longTasks), maxInputToFrameMs: Math.max(0, ...state.inputFrames) };
    }, name));
  };
  try {
    await page.goto(`${baseUrl}/usage/details`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Your usage", exact: true }).waitFor(); await settled(page);
    // Settle the real initial account-control read before local-only actions.
    // A malformed refusal media type previously manufactured a delayed retry.
    await page.locator(".usage-account__status").getByText("Sign-in required", { exact: true }).waitFor();
    await page.evaluate(() => {
      const state: Probe = { started: 0, active: false, longTasks: [], frames: [], inputFrames: [] };
      (window as ProbeWindow).metricPerformanceProbe = state;
      new PerformanceObserver(list => { if (state.active) for (const entry of list.getEntries()) if (entry.startTime >= state.started && state.longTasks.length < 4_096) state.longTasks.push(entry.duration); })
        .observe({ type: "longtask", buffered: false });
      let previous = performance.now();
      const frame = (now: number) => { if (state.active && previous >= state.started && state.frames.length < 4_096) state.frames.push(now - previous); previous = now; requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
      for (const name of ["click", "change"] as const) document.addEventListener(name, event => {
        if (!state.active || !(event.target instanceof Element) || !event.target.closest(".usage-stats, .usage-stats-source")) return;
        const start = performance.now(); requestAnimationFrame(() => { if (state.active && state.inputFrames.length < 256) state.inputFrames.push(performance.now() - start); });
      }, true);
    });
    const cdp = await context.newCDPSession(page); await cdp.send("HeapProfiler.collectGarbage");
    const baselineHeap = await cdp.send("Runtime.getHeapUsage");
    importing = true;
    await begin();
    await page.getByLabel("Open numeric usage report", { exact: true }).setInputFiles({ name: "synthetic-maximum.json", mimeType: "application/json", buffer: Buffer.from(reportJson) });
    await page.getByText("Local report loaded.", { exact: true }).waitFor();
    await page.locator(".usage-stats").waitFor(); await finish("maximum-file-admission");
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    const date = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("From", { exact: true }).fill(date(report.firstUtcDay));
    await page.getByLabel("Through", { exact: true }).fill(date(report.firstUtcDay + report.dayCount - 1));
    await begin(); await page.getByRole("button", { name: "Apply dates", exact: true }).click();
    await page.getByText(expectedText, { exact: true }).waitFor(); await finish("full-range-client-query");
    await page.getByRole("group", { name: "Group usage by", exact: true }).getByRole("button", { name: "Models", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".usage-stats")?.getAttribute("aria-busy") !== "true");
    const explorer = page.getByRole("region", { name: "Metric explorer", exact: true });
    const profiled = process.argv.includes("--profile-main");
    if (profiled) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    await begin(); await explorer.getByLabel("Second grouping").selectOption("utc-day");
    await page.getByText(expectedText, { exact: true }).waitFor(); await settled(page);
    await page.waitForFunction(() => document.querySelector(".usage-stats")?.getAttribute("aria-busy") !== "true");
    await finish("maximum-group-query");
    if (profiled) {
      const { profile } = await cdp.send("Profiler.stop");
      await writeFile(resolve(directory, "main-thread.cpuprofile"), JSON.stringify(profile));
      await cdp.send("Profiler.disable");
    }
    invariant(await explorer.locator("tbody tr").count() <= 51, "The maximum query must keep bounded top-K output.");
    for (let iteration = 0; iteration < 5; iteration++) {
      await begin(); await page.getByLabel("Model", { exact: true }).selectOption(report.rows[0].model!);
      await page.waitForFunction(expected => document.querySelector(".usage-stats__exact")?.textContent !== expected
        && document.querySelector(".usage-stats")?.getAttribute("aria-busy") !== "true", expectedText);
      await finish(`model-filter-${iteration}`);
      await begin(); await page.getByLabel("Model", { exact: true }).selectOption("*");
      await page.getByText(expectedText, { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector(".usage-stats")?.getAttribute("aria-busy") !== "true");
      await finish(`maximum-query-${iteration}`);
    }
    await begin(); const csvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download numeric CSV", exact: true }).click();
    const csvPath = await (await csvDownload).path(); invariant(csvPath, "CSV did not download.");
    const csv = await readFile(csvPath, "utf8"); invariant(csv.split("\r\n").length === 65_538, "CSV must retain every source row without truncation.");
    await finish("maximum-row-csv");
    await begin(); const jsonDownload = page.waitForEvent("download");
    await explorer.getByRole("button", { name: "Export metric snapshot", exact: true }).click();
    const jsonPath = await (await jsonDownload).path(); invariant(jsonPath, "Metric JSON did not download.");
    const json = JSON.parse(await readFile(jsonPath, "utf8")) as { snapshot: { sha256: string }; measures: { id: string; value: { amount: string } }[]; totalGroups: number };
    const expectedDigest = createHash("sha256").update(reportJson).digest("hex"), actualTotal = json.measures.find(measure => measure.id === "accounted-tokens")?.value?.amount;
    invariant(json.snapshot.sha256 === expectedDigest && json.totalGroups === 65_536 && actualTotal === expected.toString(),
      `Maximum export must bind exact captured bytes, group count and total: ${JSON.stringify({ expectedDigest, actualDigest: json.snapshot.sha256, totalGroups: json.totalGroups, expectedTotal: expected.toString(), actualTotal })}.`);
    await finish("maximum-metric-json");
    const daily = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^Daily data/ }) });
    invariant(await daily.locator("tbody tr").count() === 0, "Closed daily disclosure must allocate no hidden rows.");
    await begin(); await daily.locator("summary").click();
    await daily.getByRole("button", { name: "Next days", exact: true }).waitFor(); await finish("daily-table-open");
    invariant(await daily.locator("tbody tr").count() === 31, "Daily disclosure must retain only its bounded current page.");
    await begin(); await daily.getByRole("button", { name: "Next days", exact: true }).click();
    await daily.getByRole("status").getByText("Page 2 of 12", { exact: true }).waitFor(); await finish("daily-table-next");
    invariant(await daily.locator("tbody tr").count() === 31, "Changing daily pages must preserve the row ceiling.");
    await cdp.send("HeapProfiler.collectGarbage"); const loadedHeap = await cdp.send("Runtime.getHeapUsage");
    await page.locator(".usage-stats-source__menu > summary").click();
    await page.getByRole("button", { name: "Close report", exact: true }).click();
    await page.locator(".usage-stats").waitFor({ state: "detached" }); await settled(page);
    for (let attempt = 0; attempt < 20 && liveWorkers > 0; attempt++) await page.waitForTimeout(50);
    await cdp.send("HeapProfiler.collectGarbage"); const closedHeap = await cdp.send("Runtime.getHeapUsage");
    invariant(createdWorkers === 1 && peakWorkers === 1 && liveWorkers === 0, "One captured report must own exactly one worker and release it on close.");
    invariant(errors.length === 0 && effects.length === 0, `Maximum local report must stay private and free of runtime errors: ${JSON.stringify({ errors, effects })}.`);
    invariant(JSON.stringify(sourceSha256) === JSON.stringify(await hashes()), "Performance-bound sources changed during the run.");
    const receipt = { schemaVersion: 1, claim: "synthetic-maximum-browser-diagnostic", runtime, cpu: cpus()[0]?.model, platform: platform(), architecture: arch(), browser: browser.version(),
      viewport: { width: 1440, height: 900 }, rows: report.rows.length, groups: 65_536, inputBytes: Buffer.byteLength(reportJson), sourceSha256,
      samples, profiled, workers: { created: createdWorkers, peak: peakWorkers, afterClose: liveWorkers }, heap: { baseline: baselineHeap, loaded: loadedHeap, closed: closedHeap },
      limitations: `Warm ${runtime.mode} runtime on declared hardware${runtime.build === null ? "; no production build evidence" : "; fresh build command, matched environment and artifact identities recorded"}. Browser wall times include automation delivery; input-to-next-frame, Long Tasks and heap measure the page, not its worker. Worker lifetime is separately checked. Five query samples do not establish population p95. No live provider or modest-hardware claim.` };
    await writeFile(resolve(directory, "maximum-performance.json"), JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify({ rows: receipt.rows, groups: receipt.groups, inputBytes: receipt.inputBytes,
      samples: samples.map(sample => { const value = sample as { name: string; wallMs: number; maxLongTaskMs: number; maxInputToFrameMs: number };
        return { name: value.name, wallMs: value.wallMs, maxLongTaskMs: value.maxLongTaskMs, maxInputToFrameMs: value.maxInputToFrameMs }; }), heap: receipt.heap }, null, 2));
  } catch (error) {
    await writeFile(resolve(directory, "failed-performance.json"), JSON.stringify({ status: "failed", runtime, sourceSha256, samples,
      reason: error instanceof Error ? error.message : String(error) }, null, 2) + "\n");
    throw error;
  } finally { await context.close(); }
}
