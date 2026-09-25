import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { chromium, type Browser, type Page, type Request, type Route } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardView } from "../components/usage/leaderboard-view";
import { parseLeaderboardSnapshot } from "../lib/usage/leaderboard-contract";
import { createUsageStatsExample } from "../lib/usage/stats-example";
import { SESSION_EXAMPLE } from "../lib/usage/session-example";
import { METRIC_CSV_COLUMNS, parseCsv } from "../lib/usage/metric-export";
import { parseUsageStatsReport, STATS_MAX_TOKENS_PER_RECORD, type UsageStatsReport } from "../lib/usage/stats-contract";
import { parseStatsPublicSearch, statsPublicStatus, STATS_PUBLIC_MEDIA, type StatsPublicReply } from "../lib/usage/stats-public";
import { encodePrivateDaysPublicResponse, parsePrivateDaysPublicSearch, PRIVATE_DAYS_PUBLIC_MEDIA } from "../lib/usage/private-days-public";
import { USAGE_ACCOUNT_HEADER } from "../lib/usage/account-public";
import { encodeUsageConsentPublicReply, USAGE_CONSENT_PUBLIC_MEDIA } from "../lib/usage/consent-public";
import { verifyUsageStatsMaximum, type UsageStatsBrowserRuntime } from "./usage-stats-performance";
import { admitWorkerDiagnosticBuildReuse, parseWorkerProfileEpisodes, verifyUsageStatsWorkerProfile } from "./usage-stats-worker-profile";

function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
  await page.waitForFunction(() => document.querySelector(".usage-stats")?.getAttribute("aria-busy") !== "true");
}

/** Hold the real encoder callback so report changes happen during an actual export. */
async function holdNextImage(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const state = window as Window & { releaseUsageImage?: () => Promise<void> };
    const original = HTMLCanvasElement.prototype.toBlob;
    delete document.documentElement.dataset.usageImageHeld;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      HTMLCanvasElement.prototype.toBlob = original;
      state.releaseUsageImage = () => new Promise<void>(done => {
        original.call(this, blob => { callback(blob); setTimeout(done, 0); }, type, quality);
      });
      document.documentElement.dataset.usageImageHeld = "true";
    };
  });
  return async () => {
    await page.evaluate(async () => {
      const state = window as Window & { releaseUsageImage?: () => Promise<void> };
      if (!state.releaseUsageImage) throw new Error("The image encoder did not reach the held callback.");
      await state.releaseUsageImage(); delete state.releaseUsageImage;
    });
  };
}

/** Hold a real worker export reply across a committed selection change. */
async function holdNextMetricDigest(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const state = window as Window & { holdUsageExport?: boolean };
    delete document.documentElement.dataset.usageDigestHeld;
    state.holdUsageExport = true;
  });
  return async () => page.evaluate(async () => {
    const state = window as Window & { releaseUsageDigest?: () => Promise<void> };
    if (!state.releaseUsageDigest) throw new Error("The metric export did not reach its worker reply boundary.");
    await state.releaseUsageDigest(); delete state.releaseUsageDigest;
  });
}

/** Hold admission after the real hosted worker parsed and captured bytes. */
async function holdNextHostedAdmission(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const state = window as Window & { holdUsageHosted?: boolean };
    delete document.documentElement.dataset.usageHostedHeld; state.holdUsageHosted = true;
  });
  return async () => page.evaluate(async () => {
    const state = window as Window & { releaseUsageHosted?: () => Promise<void> };
    if (!state.releaseUsageHosted) throw new Error("Hosted admission did not reach its worker reply boundary.");
    await state.releaseUsageHosted(); delete state.releaseUsageHosted;
  });
}

function hostedReport(firstUtcDay: number, dayCount: number, accountId: string): UsageStatsReport {
  const example = createUsageStatsExample(firstUtcDay + dayCount - 1);
  const rows = example.rows.filter(row => row.utcDay >= firstUtcDay).map((row, index) => index === 0
    ? { ...row, tokens: { ...row.tokens, input: accountId === `acct_${"a".repeat(32)}` ? "11111" : "22222" } } : row);
  const report = parseUsageStatsReport({ ...example, firstUtcDay, dayCount, revision: 1, updatedAtMs: example.generatedAtMs,
    rows, sources: example.sources.map(source => {
      const records = rows.filter(row => row.client === source.client).reduce((sum, row) => sum + row.records, 0);
      return { ...source, records, status: records > 0 ? "observed" : source.status === "not_found" ? "not_found" : "empty", latestAtMs: records > 0 ? source.latestAtMs : null };
    }) });
  invariant(report, "Synthetic hosted report must pass the production numeric boundary."); return report;
}

/** Synthetic component integration only: no provider or authenticated account is contacted. */
export async function verifyUsageStats(browser: Browser, baseUrl: string, captureDirectory?: string): Promise<void> {
  if (captureDirectory) await mkdir(captureDirectory, { recursive: true });
  const failures: string[] = [];
  for (const [name, width, colorScheme] of [["desktop", 1440, "light"], ["mobile", 390, "dark"]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [], effects: string[] = [];
    const activeRequests = new Map<Request, { method: string; path: string; resource: string; startedAtMs: number }>();
    const requestCounts = new Map<string, number>();
    let droppedRequestDiagnostics = 0, hostedAdmissionSignoutPassed = false;
    page.on("request", request => {
      const url = new URL(request.url()), path = `${url.origin === baseUrl ? "local" : url.origin}${url.pathname}`.slice(0, 512);
      if (activeRequests.size < 256) activeRequests.set(request, { method: request.method(), path, resource: request.resourceType(), startedAtMs: Date.now() });
      else droppedRequestDiagnostics++;
      if (requestCounts.has(path) || requestCounts.size < 256) requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
      else droppedRequestDiagnostics++;
    });
    page.on("requestfinished", request => activeRequests.delete(request));
    page.on("requestfailed", request => activeRequests.delete(request));
    const requestDiagnostics = () => ({ counts: Object.fromEntries(requestCounts), dropped: droppedRequestDiagnostics,
      active: [...activeRequests.values()].map(({ startedAtMs, ...request }) => ({ ...request, ageMs: Date.now() - startedAtMs })) });
    let dailyReadyRequests: ReturnType<typeof requestDiagnostics> | null = null;
    let liveWorkers = 0, peakWorkers = 0;
    page.on("worker", worker => { peakWorkers = Math.max(peakWorkers, ++liveWorkers); worker.on("close", () => { liveWorkers--; }); });
    let localInteraction = false, statsMode: "ready" | "not_started" | "range_too_large" | "authentication_required" = "ready";
    let accountId = `acct_${"a".repeat(32)}`;
    let signOutCalls = 0, signOutFails = true, accountSignedOut = false, holdStats = false, downloads = 0;
    const heldStats: { route: Route; accountId: string }[] = []; let statsArrived: (() => void) | undefined;
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { document.documentElement.dataset.copiedAccount = text; } } });
      const state = window as Window & { holdUsageExport?: boolean; releaseUsageDigest?: () => Promise<void>;
        holdUsageHosted?: boolean; releaseUsageHosted?: () => Promise<void> };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener("message", event => {
            if (state.holdUsageHosted && event.data?.kind === "hosted" && event.data.reply?.ok === true) {
              state.holdUsageHosted = false; event.stopImmediatePropagation();
              state.releaseUsageHosted = async () => {
                this.dispatchEvent(new MessageEvent("message", { data: event.data }));
                await new Promise(done => setTimeout(done, 0));
              };
              document.documentElement.dataset.usageHostedHeld = "true"; return;
            }
            if (!state.holdUsageExport || event.data?.kind !== "export") return;
            state.holdUsageExport = false; event.stopImmediatePropagation();
            state.releaseUsageDigest = async () => {
              this.dispatchEvent(new MessageEvent("message", { data: event.data }));
              await new Promise(done => setTimeout(done, 0));
            };
            document.documentElement.dataset.usageDigestHeld = "true";
          });
        }
      };
    });
    page.on("pageerror", error => errors.push(error.message.slice(0, 500)));
    page.on("download", () => { downloads++; });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      // Existing shared-footer fixture boundary; these calls never reach Accounts.
      if (url.origin === "https://account.hraness.com" && request.method() === "GET" && url.pathname === "/api/consent/region") {
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"region":null,"required":false}' }); return;
      }
      if (url.origin === "https://account.hraness.com" && request.method() === "POST" && url.pathname === "/api/mailing/experiment") {
        await route.fulfill({ status: 204 }); return;
      }
      if (localInteraction && (request.method() !== "GET" || url.pathname.startsWith("/api/"))) effects.push(`${request.method()} ${url.origin}${url.pathname}`);
      if (url.origin !== baseUrl) { await route.abort(); return; }
      if (url.pathname === "/api/suite-auth/session") {
        invariant(request.method() === "GET", "Session recovery must start with a status read.");
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"kind":"signed_out"}' }); return;
      }
      if (url.pathname === "/api/suite-auth/refresh") {
        throw new Error("The signed-out synthetic account must not renew.");
      }
      if (url.pathname === "/api/usage/account") {
        invariant(request.method() === "GET" && url.search === "" && request.postData() === null, "Account identity must use the fixed read-only contract.");
        await route.fulfill({ status: accountSignedOut ? 401 : 200, contentType: PRIVATE_DAYS_PUBLIC_MEDIA,
          body: JSON.stringify(accountSignedOut ? { schemaVersion: 1, error: { code: "authentication_required" } } : { schemaVersion: 1, state: "ready", account: { accountId } }) }); return;
      }
      if (url.pathname === "/api/suite-auth/sign-out") {
        invariant(request.method() === "POST" && request.postData() === null, "SDK sign-out must remain one explicit body-free mutation.");
        signOutCalls++; if (!signOutFails) accountSignedOut = true;
        await route.fulfill({ status: signOutFails ? 503 : 200, contentType: "application/json", body: signOutFails ? '{"error":"unavailable"}' : '{"kind":"signed_out"}' }); return;
      }
      if (url.pathname === "/api/usage/stats") {
        const range = parseStatsPublicSearch(url.search); invariant(range, "Stats request must use the exact numeric GET contract.");
        invariant(request.method() === "GET" && request.postData() === null, "Stats reads must have no mutation body.");
        if (holdStats) { heldStats.push({ route, accountId }); statsArrived?.(); return; }
        const reply: StatsPublicReply = statsMode === "ready" ? { schemaVersion: 2, ok: true, value: hostedReport(range.firstUtcDay, range.dayCount, accountId) }
          : { schemaVersion: 2, ok: false, error: statsMode };
        await route.fulfill({ status: statsPublicStatus(reply), headers: { "content-type": STATS_PUBLIC_MEDIA, "cache-control": "private, no-store", [USAGE_ACCOUNT_HEADER]: accountId }, body: JSON.stringify(reply) }); return;
      }
      if (url.pathname === "/api/usage/days") {
        if (accountSignedOut) {
          await route.fulfill({ status: 401, contentType: PRIVATE_DAYS_PUBLIC_MEDIA, body: '{"schemaVersion":1,"error":{"code":"authentication_required"}}' }); return;
        }
        const range = parsePrivateDaysPublicSearch(url.search); invariant(range, "Fallback range must validate.");
        const total = { usageOccurrences: 5, observedAccountedTokens: "1250000", observedOutputTokens: "75000" };
        const bytes = encodePrivateDaysPublicResponse({ schemaVersion: 1, state: "ready", value: { schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial", journalRevision: 100,
          journalCommittedAtMs: (range.firstUtcDay + range.dayCount - 1) * 86_400_000, firstUtcDay: range.firstUtcDay,
          days: Array.from({ length: range.dayCount }, (_, index) => ({ utcDay: range.firstUtcDay + index, codex: total, claudeCode: total, devin: total })) } }, range);
        invariant(bytes, "Fallback fixture must pass its contract.");
        await route.fulfill({ status: 200, headers: { "content-type": PRIVATE_DAYS_PUBLIC_MEDIA, [USAGE_ACCOUNT_HEADER]: accountId }, body: Buffer.from(bytes) }); return;
      }
      if (url.pathname === "/api/usage/consent") {
        const bytes = encodeUsageConsentPublicReply(accountSignedOut ? { schemaVersion: 1, error: { code: "authentication_required" } } : { schemaVersion: 1, state: "not_enrolled" });
        invariant(bytes, "Consent fixture must validate.");
        await route.fulfill({ status: accountSignedOut ? 401 : 200, headers: { "content-type": USAGE_CONSENT_PUBLIC_MEDIA, [USAGE_ACCOUNT_HEADER]: accountId }, body: Buffer.from(bytes) }); return;
      }
      await route.continue();
    });
    const capture = async (state: string) => {
      await settle(page);
      invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${state}: page must not overflow horizontally.`);
      await page.evaluate(() => scrollTo(0, 0));
      if (captureDirectory) {
        await page.screenshot({ path: resolve(captureDirectory, `${name}-${state}.png`), fullPage: true });
        await page.screenshot({ path: resolve(captureDirectory, `${name}-${state}-viewport.png`) });
      }
    };
    const expandFilters = async () => {
      // A retained last-good report can still expose the old Filters button
      // while its replacement is loading. Join the committed report first.
      await settle(page);
      if (name === "mobile") {
        const toggle = page.getByRole("button", { name: /^Filters/ });
        if (await toggle.getAttribute("aria-expanded") !== "true") { await toggle.focus(); await page.keyboard.press("Enter"); }
      }
    };
    const choosePeriod = async (days: number) => {
      if (name === "mobile") await page.getByLabel("Period", { exact: true }).selectOption(String(days));
      else await page.getByRole("button", { name: `${days} days`, exact: true }).click();
      await settle(page);
    };
    const siblingSignOut = async () => {
      const sibling = await context.newPage();
      try {
        await sibling.goto(`${baseUrl}/usage/sessions`, { waitUntil: "networkidle" });
        await sibling.evaluate(() => {
          const channel = new BroadcastChannel("jungle-suite-accounts:oidc-session:v1");
          channel.postMessage({ kind: "signed_out", version: "suite-oidc-session-event-v1" }); channel.close();
        });
        await page.locator(".usage-account__status").filter({ hasText: "Sign-in required" }).waitFor();
      } finally { await sibling.close(); }
    };
    try {
      await page.goto(`${baseUrl}/usage/details`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Your usage", exact: true }).waitFor();
      const account = page.locator(".usage-account");
      if (await account.count()) {
        await account.getByText("Verified with Hraness", { exact: true }).waitFor();
        await account.locator("summary").focus(); await page.keyboard.press("Enter");
        invariant(await account.getByLabel("Account ID", { exact: true }).inputValue() === accountId, "The full verified account ID must be selectable for collector comparison.");
        await account.getByRole("button", { name: "Copy account ID", exact: true }).click();
        await account.getByRole("status").filter({ hasText: "Copied" }).waitFor();
        invariant(await page.locator("html").getAttribute("data-copied-account") === accountId, "Copy must preserve the full canonical account ID.");
        await capture("account-verified");
        const urlBeforeFailedSignOut = page.url();
        await account.getByRole("button", { name: "Sign out", exact: true }).click();
        await account.getByRole("alert").waitFor();
        invariant(signOutCalls === 1 && page.url() === urlBeforeFailedSignOut && new URL(page.url()).pathname === "/usage/details",
          "A failed sign-out must not claim success or navigate.");
        await capture("account-sign-out-failed");
        await page.reload({ waitUntil: "networkidle" });
      }
      await capture("stats-initial");
      if (await account.count()) {
        await page.getByRole("button", { name: "Load account", exact: true }).click();
        await page.getByText("Private to your account", { exact: true }).waitFor();
        const aTotal = await page.locator(".usage-stats__exact").textContent();
        await expandFilters();
        const arrived = new Promise<void>(done => { statsArrived = done; }); holdStats = true;
        await page.getByRole("button", { name: "Refresh", exact: true }).click(); await arrived;
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        invariant(await page.locator(".usage-stats").count() === 0, "Page suspension must clear private charts before a response can settle.");
        accountId = `acct_${"b".repeat(32)}`; holdStats = false;
        await page.getByRole("button", { name: "Load account", exact: true }).click();
        await page.getByText("Private to your account", { exact: true }).waitFor();
        await account.getByText("Verified with Hraness", { exact: true }).waitFor();
        await account.locator("summary").click();
        invariant(await account.getByLabel("Account ID", { exact: true }).inputValue() === accountId, "A fresh read must establish the switched account.");
        await account.locator("summary").click();
        const bTotal = await page.locator(".usage-stats__exact").textContent();
        invariant(aTotal !== bTotal, "A and B fixtures must carry observably different measurements.");
        for (const { route, accountId: staleAccount } of heldStats.splice(0)) {
          const range = parseStatsPublicSearch(new URL(route.request().url()).search); invariant(range, "Held A range remains exact.");
          await route.fulfill({ status: 200, headers: { "content-type": STATS_PUBLIC_MEDIA, [USAGE_ACCOUNT_HEADER]: staleAccount },
            body: JSON.stringify({ schemaVersion: 2, ok: true, value: hostedReport(range.firstUtcDay, range.dayCount, staleAccount) }) }).catch(() => undefined);
        }
        await settle(page);
        invariant(await page.getByText("Private to your account", { exact: true }).count() === 1, "Late A cannot displace current B.");
        invariant(await page.locator(".usage-stats__exact").textContent() === bTotal, "Late A data must not overwrite the distinct B measurement.");
        for (const boundary of ["bfcache", "visibility", "focus"] as const) {
          await page.evaluate(kind => {
            if (kind === "bfcache") window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
            else if (kind === "visibility") document.dispatchEvent(new Event("visibilitychange"));
            else window.dispatchEvent(new Event("focus"));
          }, boundary);
          invariant(await page.locator(".usage-stats").count() === 0, `${boundary} must require a fresh private read.`);
          await page.getByRole("button", { name: "Load account", exact: true }).click();
          await page.getByText("Private to your account", { exact: true }).waitFor();
        }
        await capture("stats-account-b-revalidated");
        const beforeCloseDownloads = downloads, releaseClosedImage = await holdNextImage(page);
        await page.getByRole("button", { name: "Download image", exact: true }).click();
        await page.waitForFunction(() => document.documentElement.dataset.usageImageHeld === "true");
        await page.locator(".usage-stats-source__menu > summary").click();
        await page.getByRole("button", { name: "Close report", exact: true }).click();
        await releaseClosedImage(); await settle(page);
        invariant(downloads === beforeCloseDownloads, "An image completed after the private report closes must never download.");
      }
      localInteraction = true;
      await page.getByRole("button", { name: "Explore example", exact: true }).click();
      await page.getByRole("heading", { name: "Daily usage", exact: true }).waitFor();
      await capture("stats-example");
      const plot = page.getByRole("group", { name: /^Reported tokens by day/ });
      if (name === "mobile") {
        const bounds = await plot.boundingBox();
        invariant(bounds && bounds.y < 700 && bounds.y + bounds.height < 830, "The full mobile trend, with the compact account control above it, must be visible above the fixed footer in the initial 390×900 viewport.");
      }
      const firstBar = plot.getByRole("button").first();
      await firstBar.focus(); await page.keyboard.press("ArrowRight");
      invariant(await plot.getByRole("button").nth(1).evaluate(el => el === document.activeElement), "ArrowRight must move chart focus.");
      await page.keyboard.press("Enter"); await page.getByRole("region", { name: "Selected period detail", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      invariant(await page.getByRole("region", { name: "Selected period detail", exact: true }).count() === 0, "Escape must clear chart selection.");
      const calendar = page.getByRole("group", { name: /token density by UTC day/ });
      await calendar.getByRole("button").first().focus(); await page.keyboard.press("ArrowRight");
      invariant(await calendar.getByRole("button").nth(1).evaluate(el => el === document.activeElement), "ArrowRight must move calendar focus.");
      await page.keyboard.press("ArrowDown");
      invariant(await calendar.getByRole("button").nth(8).evaluate(el => el === document.activeElement), "ArrowDown must move calendar focus a full week.");
      await page.keyboard.press("Enter"); await page.getByRole("region", { name: "Selected period detail", exact: true }).waitFor();
      invariant(await page.getByRole("region", { name: "Selected period detail", exact: true }).getByText("Cache-read share").count() === 1, "The selected period must carry its cache and timing detail.");
      await page.keyboard.press("Escape");
      invariant(await page.getByText(/Highest activity:/).count() === 1, "The calendar must name the peak observed day.");
      await page.getByRole("group", { name: "Chart metric" }).getByRole("button", { name: "Records", exact: true }).click();
      await page.getByRole("group", { name: /^Usage records by day/ }).waitFor();
      await page.getByRole("group", { name: "Chart metric" }).getByRole("button", { name: "Source tok/s", exact: true }).click();
      await page.getByRole("group", { name: /^Tokens per source-duration second by day/ }).waitFor();
      invariant(await page.getByRole("group", { name: "Stack bars by" }).count() === 0, "A rate must not offer stacked composition.");
      await page.getByRole("group", { name: "Chart metric" }).getByRole("button", { name: "Tokens", exact: true }).click();
      await page.getByRole("group", { name: "Stack bars by" }).getByRole("button", { name: "Clients", exact: true }).click();
      await page.locator(".usage-stats__legend").waitFor();
      invariant(await page.locator(".usage-stats__legend li").count() === 4, "The legend must list the example's four daily clients.");
      invariant(await page.locator(".usage-stats__bar-stack").first().locator("i").count() > 1, "Stacked bars must render per-client segments.");
      await capture("stats-stacked");
      await page.getByRole("group", { name: "Stack bars by" }).getByRole("button", { name: "Total", exact: true }).click();
      invariant(await page.locator(".usage-stats__legend").count() === 0, "Total mode must hide the composition legend.");
      await page.getByRole("button", { name: "Copy summary", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "copied to the clipboard" }).waitFor();
      const copiedSummary = await page.locator("html").getAttribute("data-copied-account");
      invariant(copiedSummary?.includes("reported token basis") && copiedSummary.includes("coverage may be partial"), "The copied summary must state its basis and coverage.");
      invariant(copiedSummary?.includes("synthetic example"), "The copied summary must label the example scope.");
      const explorer = page.getByRole("region", { name: "Metric explorer", exact: true });
      invariant(await page.getByRole("link", { name: "Explore 241 metric definitions", exact: true }).isVisible(), "The overview must keep its explorer jump visible on every viewport.");
      await explorer.getByLabel("Find a metric").fill("cached-input-share");
      invariant((await explorer.getByRole("status").first().textContent())?.includes("1 matching definition · 1 supported"), "Search count and supported count must describe the same filtered matches with singular grammar.");
      await explorer.getByRole("button", { name: /^Cached input share/ }).click();
      await settle(page);
      if (name === "mobile") {
        await settle(page);
        const answer = await explorer.locator(".usage-metrics__detail").evaluate(element => {
          const visible = (target: Element | null) => {
            const bounds = target?.getBoundingClientRect(); return bounds !== undefined && bounds.top >= 0 && bounds.bottom <= innerHeight;
          };
          return { focused: document.activeElement === element, questionVisible: visible(element.querySelector("h3")),
            valueVisible: visible(element.querySelector(".usage-metrics__value")), top: element.getBoundingClientRect().top, width: innerWidth };
        });
        invariant(answer.focused && answer.questionVisible && answer.valueVisible,
          `Selecting a metric on mobile must reveal and focus its answer by the next frame: ${JSON.stringify(answer)}.`);
        if (captureDirectory) await page.screenshot({ path: resolve(captureDirectory, "mobile-metric-selection-answer.png") });
      }
      invariant((await explorer.locator(".usage-metrics__definition").textContent())?.includes("cached-input-share"), "The metric definition must follow the selected catalog entry.");
      invariant((await explorer.textContent())?.includes("complete category observations only"), "Cache share must explain its eligible cohort.");
      await explorer.getByLabel("Second grouping").selectOption("model");
      await explorer.getByRole("button", { name: "Rank by this metric", exact: true }).click();
      await settle(page);
      invariant(await explorer.locator("tbody tr").count() <= 51, "The metric table must respect its global top-K bound.");
      const metricDownloadEvent = page.waitForEvent("download");
      await explorer.getByRole("button", { name: "Export metric snapshot", exact: true }).click();
      const metricDownload = await metricDownloadEvent, metricFile = await metricDownload.path(); invariant(metricFile, "Metric JSON must download.");
      const metricExport = JSON.parse(await Bun.file(metricFile).text()) as { profile: string; snapshot: { sha256: string }; query: { groupBy: string[] }; measures: { id: string; value: { numerator: string; denominator: string } | null }[] };
      invariant(metricExport.profile === "metric-explorer-v1" && /^[0-9a-f]{64}$/u.test(metricExport.snapshot.sha256), "Export must bind the complete captured report.");
      invariant(metricExport.query.groupBy.join("/") === "client/model" && metricExport.measures.some(value => value.id === "cached-input-share" && typeof value.value?.denominator === "string"), "Export must preserve exact metric fractions and selected dimensions.");
      // The per-metric CSV (D4/D12) binds the same selection: identity columns on
      // every row, the same fingerprint as the JSON export, one total row plus
      // the listed groups, and exact decimal values rather than rounded display.
      const metricCsvEvent = page.waitForEvent("download");
      await explorer.getByRole("button", { name: "Export metric CSV", exact: true }).click();
      const metricCsvDownload = await metricCsvEvent, metricCsvFile = await metricCsvDownload.path(); invariant(metricCsvFile, "Metric CSV must download.");
      invariant(metricCsvDownload.suggestedFilename() === "aicharts-metric-cached-input-share.csv", `Metric CSV must be named after its metric: ${metricCsvDownload.suggestedFilename()}.`);
      const metricCsvRows = parseCsv(await Bun.file(metricCsvFile).text());
      invariant(metricCsvRows[0].join(",") === METRIC_CSV_COLUMNS.join(","), "Metric CSV must carry the documented identity columns.");
      const csvTotal = metricCsvRows[1], csvColumn = (name: typeof METRIC_CSV_COLUMNS[number]) => csvTotal[METRIC_CSV_COLUMNS.indexOf(name)];
      const jsonShare = metricExport.measures.find(value => value.id === "cached-input-share")!.value!;
      invariant(csvColumn("metric_id") === "cached-input-share" && csvColumn("metric_version") === "1" && csvColumn("scope") === "total" && csvColumn("group_by") === "client+model"
        && csvColumn("snapshot_sha256") === metricExport.snapshot.sha256 && csvColumn("value") === jsonShare.numerator && csvColumn("denominator") === jsonShare.denominator,
        `Metric CSV total must carry the metric identity, fingerprint and the JSON export's exact fraction: ${JSON.stringify(csvTotal)}.`);
      invariant(metricCsvRows.length - 2 === await explorer.locator("tbody tr").count() && metricCsvRows.slice(2).every(row => row[METRIC_CSV_COLUMNS.indexOf("scope")] === "group" || row[METRIC_CSV_COLUMNS.indexOf("scope")] === "other"),
        "Metric CSV must list exactly the groups shown on screen.");
      await explorer.getByRole("status").filter({ hasText: "Downloaded cached-input-share as CSV" }).waitFor();
      // Session facts join the same explorer: rich metrics evaluate locally once a
      // session-observations-v1 file is opened, and refuse with a stated reason before.
      await explorer.getByLabel("Find a metric").fill("token-size-p95");
      await explorer.getByRole("button", { name: /^Token size p95/ }).click(); await settle(page);
      const richPanel = explorer.getByRole("region", { name: "Session facts", exact: true });
      invariant((await richPanel.textContent())?.includes("Open a session-observations-v1 or rich-facts-v1 file"), "A rich metric without loaded facts must state what to open, not show a zero.");
      invariant(await richPanel.getByRole("button", { name: "Open session facts", exact: true }).count() === 1, "Local mode must offer the session-facts picker inline.");
      await page.locator('input[aria-label="Open session facts"]').setInputFiles({ name: "sessions.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(SESSION_EXAMPLE)) });
      await richPanel.locator(".usage-rich__groups tbody tr").first().waitFor();
      invariant((await explorer.getByRole("status").first().textContent())?.includes("1 by the loaded session facts"), "The catalog count must include metrics served by the loaded session facts.");
      invariant(await richPanel.locator(".usage-rich__groups tbody tr").count() === 2, "Adapted session facts default to one group per session.");
      invariant((await richPanel.locator(".usage-rich__groups").textContent())?.includes("26,900"), "The per-session P95 must match the session page's exact value.");
      invariant(await richPanel.locator('option[value="local-day"][disabled]').count() === 2 && await richPanel.locator('option[value="local-day"]:not([disabled])').count() === 0,
        "A report without a declared time zone must refuse calendar grouping in both grouping controls instead of guessing.");
      await richPanel.getByRole("combobox", { name: /^Group by/u }).selectOption("model");
      invariant(await richPanel.locator(".usage-rich__groups tbody tr").count() >= 2, "Model grouping must partition the same facts.");
      const richCsvEvent = page.waitForEvent("download");
      await richPanel.getByRole("button", { name: "Export CSV", exact: true }).click();
      const richCsvFile = await (await richCsvEvent).path(); invariant(richCsvFile, "Rich metric CSV must download.");
      const richCsv = await Bun.file(richCsvFile).text();
      invariant(richCsv.startsWith("metric_id,metric_version,unit,source_profile,snapshot_revision,") && richCsv.includes("\r\ntoken-size-p95,1,tokens,rich-facts-v1,"), "Rich CSV rows must carry the metric identity, version, unit and facts revision.");
      invariant(richCsv.split("\r\n").filter(line => line.startsWith("token-size-p95,")).every(line => line.includes(",*,*,*,model,")), "Rich CSV rows must carry the filters and grouping that produced them.");
      await page.locator(".usage-stats-source__menu > summary").click();
      await page.getByRole("button", { name: "Close session facts", exact: true }).click();
      await richPanel.getByRole("button", { name: "Open session facts", exact: true }).waitFor();
      await page.locator(".usage-stats-source__menu > summary").click();
      // Leaving the rich metric restores the classic explorer with its grouping intact.
      await explorer.getByLabel("Find a metric").fill("cached-input-share");
      await explorer.getByRole("button", { name: /^Cached input share/ }).click();
      await settle(page);
      invariant(await explorer.getByLabel("Second grouping").inputValue() === "model", "Returning from a rich metric must keep the classic explorer's grouping selection.");
      const beforeDigestDownloads = downloads, releaseDigest = await holdNextMetricDigest(page);
      await explorer.getByRole("button", { name: "Export metric snapshot", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.usageDigestHeld === "true");
      await explorer.getByLabel("Second grouping").selectOption("provider");
      await releaseDigest();
      await explorer.getByRole("status").filter({ hasText: "Download canceled after the report changed" }).waitFor();
      invariant(downloads === beforeDigestDownloads, "A delayed worker export reply cannot download a stale selection.");
      await explorer.getByLabel("Find a metric").fill("compare-periods");
      await explorer.getByRole("button", { name: /^Compare periods/ }).click();
      await settle(page);
      invariant((await explorer.locator(".usage-metrics__value").textContent()) === "Unavailable", "Unavailable comparisons must omit unresolved placeholder units.");
      invariant((await explorer.getByRole("status").first().textContent())?.includes("1 matching definition · 1 supported"), "A supported comparison is counted, even while this range refuses it.");
      invariant((await explorer.textContent())?.includes("matched source populations, versions and exposure"), "A range that includes the current day must not invent matched period evidence.");
      invariant(await explorer.locator(".usage-metrics__comparison[data-matched=\"false\"]").count() === 1 && await explorer.locator("th", { hasText: "Change" }).count() === 0, "An unmatched comparison must not render change columns.");
      invariant(await explorer.getByRole("combobox", { name: "Compare", exact: true }).inputValue() === "compare-periods", "The comparison selector must reflect the selected comparison metric.");
      await capture("metric-explorer-unavailable");
      // Two complete, same-length ranges inside the example (indices 72–77 versus
      // 66–71; the example omits every 13th day) establish a matched comparison.
      const throughInput = page.getByLabel("Through", { exact: true });
      if (name === "mobile") await page.getByLabel("Period", { exact: true }).selectOption("custom");
      else if (await page.getByRole("button", { name: "Custom", exact: true }).getAttribute("aria-expanded") !== "true") await page.getByRole("button", { name: "Custom", exact: true }).click();
      const exampleToday = Date.parse(`${await throughInput.inputValue()}T00:00:00.000Z`) / 86_400_000;
      const isoDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
      await page.getByLabel("From", { exact: true }).fill(isoDay(exampleToday - 17)); await throughInput.fill(isoDay(exampleToday - 12));
      await page.getByRole("button", { name: "Apply dates", exact: true }).click(); await settle(page);
      const signedInteger = (text: string | null) => { invariant(text !== null && /^[+−-]?[0-9,]+$/u.test(text), `Expected a signed integer, got ${text}.`); return BigInt(text.replace(/[+,]/gu, "").replace("−", "-")); };
      const matchedText = await explorer.locator(".usage-metrics__comparison[data-matched=\"true\"]").textContent();
      invariant(matchedText?.includes("matched, so this value is the exact signed change") && matchedText.includes("Both periods observe the same groups"), `A complete matched range must state the matched window: ${matchedText}`);
      const headline = signedInteger(await explorer.locator(".usage-metrics__value strong").textContent());
      const changeCells = await explorer.locator("tbody tr").evaluateAll(rows => rows.map(row => row.querySelectorAll("td")[0]?.textContent ?? ""));
      invariant(changeCells.length > 0 && changeCells.reduce((sum, cell) => sum + signedInteger(cell), 0n) === headline, "Per-group period changes must conserve the total change.");
      await explorer.getByRole("combobox", { name: "Compare", exact: true }).selectOption("compare-clients");
      await settle(page);
      invariant(signedInteger(await explorer.locator(".usage-metrics__value strong").textContent()) === headline, "Compare clients at the client grouping equals the total matched change.");
      invariant((await page.locator(".usage-stats__hint[data-matched=\"true\"]:not(.usage-metrics__comparison)").textContent())?.includes("Matched change:"), "The trend hint must state the matched change on complete periods.");
      await explorer.getByRole("combobox", { name: "Compare", exact: true }).selectOption("none");
      await settle(page);
      invariant(await explorer.getByRole("combobox", { name: "Compare", exact: true }).inputValue() === "none" && await explorer.locator("th", { hasText: "Previous" }).count() === 1 && await explorer.locator("th", { hasText: "Change" }).count() === 1, "A level metric on a matched range exposes previous and change columns per group.");
      const previousAndChange = await explorer.locator("tbody tr").evaluateAll(rows => rows.map(row => [...row.querySelectorAll("td")].slice(0, 3).map(cell => cell.textContent ?? "")));
      invariant(previousAndChange.every(([value, previous, change]) => /^[+−-]?[0-9,]+ \((?:[+−-]?[0-9.]+%|no baseline)\)$/u.test(change) && signedInteger(change.split(" ")[0]) === signedInteger(value) - signedInteger(previous)),
        `Each group's change must equal its value minus its previous value: ${JSON.stringify(previousAndChange)}.`);
      await capture("metric-explorer-matched");
      await choosePeriod(30);
      await explorer.getByLabel("Find a metric").fill("accounted-tokens");
      await explorer.getByRole("button", { name: /^Accounted tokens/ }).click();
      await explorer.getByLabel("Second grouping").selectOption("none");
      await settle(page);
      await explorer.getByLabel("Find a metric").fill("");
      await explorer.getByRole("tab", { name: "All metrics", exact: true }).focus(); await page.keyboard.press("ArrowRight");
      invariant(await explorer.getByRole("tab", { name: "Tokens", exact: true }).getAttribute("aria-selected") === "true", "Metric topics must support roving keyboard focus.");
      await page.keyboard.press("Home");
      invariant(await explorer.getByRole("tab", { name: "All metrics", exact: true }).getAttribute("aria-selected") === "true", "Home must return to the complete catalog.");
      await capture("metric-explorer");
      const imageDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download image", exact: true }).click();
      invariant((await imageDownload).suggestedFilename().endsWith(".png"), "The activity image must download as a PNG.");
      await expandFilters();
      await page.getByLabel("Provider", { exact: true }).selectOption("openai");
      await settle(page);
      invariant(await page.getByLabel("Model", { exact: true }).locator('option[value="claude-sonnet-4"]').count() === 0, "Provider selection must narrow the model choices.");
      await page.getByLabel("Model", { exact: true }).selectOption("gpt-5");
      await page.getByLabel("Provider", { exact: true }).selectOption("anthropic");
      await settle(page);
      invariant(await page.getByLabel("Model", { exact: true }).inputValue() === "*", "Changing providers must clear the previous model selection.");
      await page.getByLabel("Client", { exact: true }).selectOption("opencode");
      await settle(page);
      invariant(await page.getByLabel("Provider", { exact: true }).inputValue() === "*", "Changing clients must clear the provider selection.");
      await page.getByRole("heading", { name: "No matching reported records", exact: true }).waitFor();
      const coverage = page.locator(".usage-stats__client-coverage");
      await coverage.locator("summary").focus(); await page.keyboard.press("Enter");
      const absentClient = coverage.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Amp", exact: true }) });
      invariant(await absentClient.getByText("Not included", { exact: true }).count() === 1, "An unlisted source must stay distinct from a source checked but not found.");
      const checkedClient = coverage.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "OpenCode", exact: true }) });
      invariant(await checkedClient.getByText("Not found", { exact: true }).count() === 1, "Coverage must preserve the source's checked status.");
      await capture("stats-client-coverage");
      await coverage.locator("summary").click();
      await page.getByLabel("Client", { exact: true }).selectOption("warp");
      await settle(page);
      if (name === "mobile") invariant(await page.getByRole("button", { name: "Filters · 1 active", exact: true }).count() === 1, "Collapsed filter control must expose the active scope count.");
      await page.getByText("No token observations", { exact: true }).waitFor();
      invariant(await page.locator(".usage-stats__cost > strong").textContent() === "Unavailable", "A cumulative Warp billing snapshot must not become daily period cost.");
      await page.getByRole("region", { name: "Warp billing snapshot", exact: true }).getByText("$12.35", { exact: true }).waitFor();
      const snapshotDownloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Download numeric CSV" }).click();
      const snapshotDownload = await snapshotDownloadEvent, snapshotFile = await snapshotDownload.path(); invariant(snapshotFile, "Snapshot CSV must download.");
      const snapshotCsv = await Bun.file(snapshotFile).text(); invariant(snapshotCsv.includes('"refresh_snapshot","warp"') && !snapshotCsv.includes('"codex"'), "CSV must retain the explicitly labeled latest Warp snapshot in the selected client scope.");
      await page.getByRole("button", { name: /^Clear filters/ }).click();
      await page.getByLabel("Token basis", { exact: true }).selectOption("estimated");
      await settle(page);
      invariant(await page.locator(".usage-stats__exact").textContent() === "60,000 exact", "Estimated tokens must remain separate.");
      await page.getByLabel("Token basis", { exact: true }).selectOption("reported");
      await settle(page);
      await page.getByRole("group", { name: "Group usage by" }).getByRole("button", { name: "Models", exact: true }).click();
      const sorted = page.getByRole("columnheader", { name: "Reported tokens", exact: true });
      await sorted.getByRole("button").focus(); await page.keyboard.press("Enter"); invariant(await sorted.getAttribute("aria-sort") === "ascending", "Sort must update accessible direction.");
      await page.getByRole("button", { name: "gpt-5", exact: true }).click();
      invariant(await page.getByLabel("Model", { exact: true }).inputValue() === "gpt-5", "Model drilldown must filter the common scope.");
      const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Download numeric CSV" }).focus(); await page.keyboard.press("Enter");
      const download = await downloadEvent, file = await download.path(); invariant(file, "CSV must download.");
      const csv = await Bun.file(file).text(); invariant(csv.includes("output_excluding_reasoning") && csv.includes('"gpt-5"') && !csv.includes('"warp"'), "CSV must match the selected numeric scope.");
      await page.getByRole("button", { name: /^Clear filters/ }).click();
      await choosePeriod(90); await page.getByRole("heading", { name: "Weekly usage" }).waitFor();
      const scroll = page.getByRole("region", { name: "Usage breakdown, scroll horizontally for all columns", exact: true });
      await page.keyboard.press("Tab"); await scroll.focus(); invariant(await scroll.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none"), "Breakdown requires visible keyboard focus.");
      if (name === "mobile") {
        invariant(await scroll.evaluate(el => el.scrollWidth > el.clientWidth), "Wide table must scroll inside its own region.");
        await page.keyboard.press("ArrowRight"); await page.waitForFunction(() => (document.querySelector(".usage-stats__breakdown .usage-stats__table-scroll")?.scrollLeft ?? 0) > 0);
      }
      await capture("stats-year-range");
      const today = Math.floor(Date.now() / 86_400_000), original = createUsageStatsExample(today);
      const target = original.rows.length - 3, widened = original.rows[target];
      // The contract caps one row at records x 8,388,608 tokens, so a
      // physically plausible wide fixture needs the matching record count.
      const records = 9_000_000;
      const wide = String(STATS_MAX_TOKENS_PER_RECORD * BigInt(records) / 5n);
      const large = { ...original,
        rows: original.rows.map((row, index) => index === target ? { ...row, records,
          tokens: { input: wide, cacheRead: wide, cacheWrite: wide, output: wide, reasoning: wide } } : row),
        sources: original.sources.map(source => source.client === widened.client
          ? { ...source, records: source.records - widened.records + records } : source) };
      invariant(parseUsageStatsReport(large), "Large local numeric fixture must validate.");
      const upload = page.getByLabel("Open numeric usage report", { exact: true });
      await upload.setInputFiles({ name: "numeric-report.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(large)) });
      await page.locator(".usage-stats-heading > span").filter({ hasText: "Local reports stay in this browser" }).waitFor();
      await capture("stats-local-large");
      const beforeRejectedImportDownloads = downloads, releaseCanceledImage = await holdNextImage(page);
      await page.getByRole("button", { name: "Download image", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.usageImageHeld === "true");
      await upload.setInputFiles({ name: "rejected-during-export.json", mimeType: "application/json", buffer: Buffer.from('{"unexpected":"synthetic"}') });
      await page.getByRole("alert").filter({ hasText: "could not be read as a numeric usage report" }).waitFor();
      await releaseCanceledImage();
      await page.getByRole("status").filter({ hasText: "Image canceled after the report changed" }).waitFor();
      invariant(downloads === beforeRejectedImportDownloads, "A pending replacement must cancel the old image even when its import fails.");
      const retryImage = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download image", exact: true }).click();
      invariant((await retryImage).suggestedFilename().endsWith(".png"), "A canceled image must release its job so the retained local report can be exported again.");
      const empty = { ...original, sources: [], rows: [] };
      await upload.setInputFiles({ name: "empty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(empty)) });
      await page.getByRole("heading", { name: "No matching reported records" }).waitFor(); await capture("stats-empty");
      await upload.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"prompt":"must not leave browser"}') });
      await page.getByRole("alert").filter({ hasText: "could not be read as a numeric usage report" }).waitFor(); await capture("stats-import-error");
      invariant(effects.length === 0, `Local report actions must have no API or write effects: ${JSON.stringify(effects)}`);
      invariant(peakWorkers <= 2, `Report replacement exceeded its two-worker custody bound: ${peakWorkers}.`);
      localInteraction = false;
      if (await account.count()) {
        await account.locator("summary").click(); signOutFails = false;
        const urlBeforeSignOut = page.url();
        await account.getByRole("button", { name: "Sign out", exact: true }).click();
        await account.getByText("Sign-in required", { exact: true }).waitFor();
        invariant(page.url() === urlBeforeSignOut && new URL(page.url()).pathname === "/usage/details" && await page.locator(".usage-stats").count() === 1
          && await page.getByText("Local reports stay in this browser", { exact: true }).count() === 1 && Number(signOutCalls) === 2,
          "Ordinary sign-out must clear account identity without navigating away from the initiating tab's local report.");
        await account.locator("summary").click();
        await siblingSignOut();
        invariant(await page.locator(".usage-stats").count() === 1 && await page.getByText("Local reports stay in this browser", { exact: true }).count() === 1,
          "A cross-tab sign-out must preserve a locally imported report.");
      }
      await page.locator(".usage-stats-source__menu > summary").click();
      if (await page.getByRole("button", { name: "Load account", exact: true }).count()) {
        statsMode = "authentication_required";
        await page.getByRole("button", { name: "Load account", exact: true }).click();
        await page.getByRole("heading", { name: "Sign in to view your usage", exact: true }).waitFor();
        invariant(await page.locator(".usage-stats").count() === 1 && await page.getByText("Local reports stay in this browser", { exact: true }).count() === 1,
          "Authentication failure must preserve a locally imported report.");
        statsMode = "ready"; accountSignedOut = false;
        await page.getByRole("button", { name: "Load account", exact: true }).click(); await page.getByText("Private to your account", { exact: true }).waitFor();
        await expandFilters();
        await page.getByLabel("Client", { exact: true }).selectOption("codex");
        await choosePeriod(90); await page.getByRole("heading", { name: "Weekly usage" }).waitFor();
        invariant(await page.getByLabel("Client", { exact: true }).inputValue() === "codex", "Account range refresh must preserve client selection.");
        await expandFilters();
        statsMode = "range_too_large"; await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "too much detail" }).waitFor(); await capture("stats-range-error");
        statsMode = "ready"; accountSignedOut = false; await page.getByRole("button", { name: "Load last 7 days", exact: true }).click();
        await page.getByRole("heading", { name: "Daily usage", exact: true }).waitFor();
        statsMode = "authentication_required"; await expandFilters(); await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await page.getByRole("heading", { name: "Sign in to view your usage", exact: true }).waitFor();
        invariant(await page.locator(".usage-stats").count() === 0, "Confirmed authentication failure must remove the old account report.");
        await page.getByRole("button", { name: "Explore example", exact: true }).click();
        await page.locator(".usage-stats-source__menu > summary").click();
        await page.getByRole("button", { name: "Load account", exact: true }).click();
        await page.getByRole("heading", { name: "Sign in to view your usage", exact: true }).waitFor();
        invariant(await page.locator(".usage-stats").count() === 1 && await page.getByText("Example data · synthetic", { exact: true }).count() === 1,
          "Authentication failure must preserve a synthetic example.");
        if (await account.count()) {
          await account.locator("summary").click();
          const urlBeforeFailedAuthSignOut = page.url();
          await account.getByRole("button", { name: "Sign out", exact: true }).click();
          await account.getByText("Sign-in required", { exact: true }).waitFor();
          invariant(page.url() === urlBeforeFailedAuthSignOut && new URL(page.url()).pathname === "/usage/details" && await page.locator(".usage-stats").count() === 1
            && await page.getByText("Example data · synthetic", { exact: true }).count() === 1 && Number(signOutCalls) === 3,
            "Ordinary sign-out must preserve the initiating tab's synthetic example.");
          await account.locator("summary").click();
          await siblingSignOut();
          invariant(await page.locator(".usage-stats").count() === 1 && await page.getByText("Example data · synthetic", { exact: true }).count() === 1,
            "A cross-tab sign-out must preserve example data.");
        }
        statsMode = "ready"; accountSignedOut = false; await page.getByRole("button", { name: "Load account", exact: true }).click();
        // The retained example already has a Daily usage heading. Wait for
        // the requested account owner before changing the response fixture.
        await page.getByText("Private to your account", { exact: true }).waitFor(); await settle(page);
        await page.getByRole("heading", { name: "Daily usage", exact: true }).waitFor();
        statsMode = "not_started"; await expandFilters(); await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await page.getByRole("heading", { name: "No detailed snapshot yet", exact: true }).waitFor();
        if (await account.count()) {
          statsMode = "ready"; accountSignedOut = false;
          const releaseHosted = await holdNextHostedAdmission(page);
          await page.getByRole("button", { name: "Load account", exact: true }).click();
          await page.waitForFunction(() => document.documentElement.dataset.usageHostedHeld === "true");
          await siblingSignOut();
          await page.getByRole("heading", { name: "Sign in to view your usage", exact: true }).waitFor();
          await settle(page);
          invariant(liveWorkers === 0, "Cross-tab sign-out must terminate the held hosted admission and previous account session.");
          await releaseHosted(); await settle(page);
          invariant(await page.locator(".usage-stats").count() === 0, "A late admitted worker reply must not restore account measurements after sign-out.");
          hostedAdmissionSignoutPassed = true;
          const arrived = new Promise<void>(done => { statsArrived = done; }); holdStats = true;
          await page.getByRole("button", { name: "Load account", exact: true }).click(); await arrived;
          await siblingSignOut();
          await page.getByRole("heading", { name: "Sign in to view your usage", exact: true }).waitFor();
          holdStats = false;
          for (const { route, accountId } of heldStats.splice(0)) {
            const range = parseStatsPublicSearch(new URL(route.request().url()).search); invariant(range, "Held read keeps its original range.");
            await route.fulfill({ status: 200, headers: { "content-type": STATS_PUBLIC_MEDIA, [USAGE_ACCOUNT_HEADER]: accountId }, body: JSON.stringify({ schemaVersion: 2, ok: true, value: hostedReport(range.firstUtcDay, range.dayCount, accountId) }) }).catch(() => undefined);
          }
          await settle(page);
          invariant(await page.locator(".usage-stats").count() === 0, "A late successful account response must not restore private data after cross-tab sign-out.");
        }
      }
      // Saved views (D5): a version-1 link migrates in place, seeds the
      // selection, keeps foreign parameters and follows later changes; a link
      // carrying a private identifier is refused whole with a stated reason.
      await page.goto(`${baseUrl}/usage/details?utm_source=check&view=1&days=7&group=model&second=utc-day&metric=peak-daily-tokens`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Explore a working example", exact: true }).click();
      await page.getByRole("heading", { name: "Daily usage", exact: true }).waitFor(); await settle(page);
      const migrated = new URL(page.url()).searchParams;
      invariant(migrated.get("utm_source") === "check" && migrated.get("view") === "2" && migrated.get("range") === "7d" && migrated.get("group") === "model" && migrated.get("then") === "utc-day"
        && migrated.get("metric") === "peak-daily-tokens" && !migrated.has("days") && !migrated.has("second"), `A version-1 link must migrate in place: ${page.url()}`);
      const pressedGrouping = () => page.getByRole("group", { name: "Group usage by", exact: true }).locator("button[aria-pressed=\"true\"]").textContent();
      invariant(name === "mobile" ? await page.getByLabel("Period", { exact: true }).inputValue() === "7" : await page.locator(".usage-stats__desktop-periods button[aria-pressed=\"true\"]").textContent() === "7 days", "The saved preset must select its period.");
      invariant(await pressedGrouping() === "Models", "The saved grouping must be applied.");
      const savedExplorer = page.getByRole("region", { name: "Metric explorer", exact: true });
      invariant(await savedExplorer.getByLabel("Second grouping").inputValue() === "utc-day" && (await savedExplorer.locator(".usage-metrics__definition").textContent())?.includes("peak-daily-tokens"), "The saved second grouping and metric must be applied.");
      await page.getByRole("group", { name: "Group usage by", exact: true }).getByRole("button", { name: "Clients", exact: true }).click(); await settle(page);
      const followed = new URL(page.url()).searchParams;
      invariant(!followed.has("group") && followed.get("utm_source") === "check" && followed.get("metric") === "peak-daily-tokens", `The link must follow the selection and keep foreign parameters: ${page.url()}`);
      await page.getByRole("button", { name: "Copy view link", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "View link copied" }).waitFor();
      const copiedLink = await page.locator("html").getAttribute("data-copied-account");
      invariant(copiedLink === page.url(), `The copied link must equal the followed URL: ${copiedLink} versus ${page.url()}.`);
      await page.goto(`${baseUrl}/usage/details?view=2&group=model&session=${"a".repeat(32)}`, { waitUntil: "networkidle" });
      await page.getByRole("status").filter({ hasText: "carries a private identifier" }).waitFor();
      await page.getByRole("button", { name: "Explore a working example", exact: true }).click();
      await page.getByRole("heading", { name: "Daily usage", exact: true }).waitFor(); await settle(page);
      invariant(await pressedGrouping() === "Clients", "A refused link must not apply any of its fields.");
      invariant(!new URL(page.url()).searchParams.has("session") && await page.getByRole("status").filter({ hasText: "carries a private identifier" }).count() === 1, "Following the view must drop private parameters and keep the refusal visible.");
      await capture("stats-saved-view");
      statsMode = "not_started";
      accountSignedOut = false; // A distinct synthetic signed-in visit for daily cleanup.
      // Network quiescence is not the daily report's ready boundary. Require
      // its admitted fixture and announcement before exercising sign-out.
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Codex", exact: true }).waitFor();
      await page.locator(".usage-daily__announcement").getByText("Daily usage loaded. Coverage is partial.", { exact: true }).waitFor();
      invariant(await page.locator(".usage-daily").getByText("112,500,000", { exact: true }).count() === 1, "Daily fallback must retain its exact 30-day synthetic total.");
      dailyReadyRequests = requestDiagnostics(); await capture("usage-fallback");
      if (await account.count()) {
        await account.locator("summary").click(); signOutFails = false;
        await account.getByRole("button", { name: "Sign out", exact: true }).click();
        await account.getByText("Sign-in required", { exact: true }).waitFor();
        invariant(page.url() === `${baseUrl}/dashboard` && await page.locator(".usage-daily table").count() === 0, "Confirmed sign-out must clear private daily data in the initiating tab.");
        invariant(Number(signOutCalls) === 4, "Every explicit sign-out must make exactly one SDK POST without replay.");
      }
      await page.goto(`${baseUrl}/leaderboard`, { waitUntil: "networkidle" }); await page.getByRole("heading", { name: "Public usage leaderboard", exact: true }).waitFor(); await capture("leaderboard-paused");
      const computedAtMs = today * 86_400_000 + 5 * 60_000;
      const rankings = parseLeaderboardSnapshot({ schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs, entries: [
        { rank: 1, publicHandle: "synthetic-max-counts", observedTokens: "999999999999999999999999999999", usageRecords: 640_000_000,
          consentedAtMs: computedAtMs - 86_400_000, refreshedAtMs: computedAtMs, windowFirstUtcDay: today - 29, windowUtcDays: 30 },
        { rank: 2, publicHandle: "synthetic-distinct-coverage", observedTokens: "9007199254740993", usageRecords: 12,
          consentedAtMs: computedAtMs - 86_400_000, refreshedAtMs: computedAtMs - 10 * 60_000, windowFirstUtcDay: today - 30, windowUtcDays: 30 },
      ] });
      invariant(rankings, "Maximum ranked fixture must pass the public contract.");
      const markup = renderToStaticMarkup(createElement(LeaderboardView, { available: true, snapshot: rankings }));
      await page.locator("main.leaderboard-home").evaluate((main, html) => {
        for (const section of main.querySelectorAll(":scope > section")) section.remove();
        main.insertAdjacentHTML("afterbegin", `<p class="usage-board__hint">Synthetic ranked fixture · layout verification only</p>${html}`);
      }, markup);
      const rankingRegion = page.getByRole("region", { name: "Public usage rankings", exact: true });
      invariant(await rankingRegion.getByText("999,999,999,999,999,999,999,999,999,999", { exact: true }).count() === 1, "Thirty-digit public totals must retain exact formatting.");
      invariant(await rankingRegion.getByText("640,000,000", { exact: true }).count() === 1, "Maximum record counts must remain readable.");
      await page.keyboard.press("Tab"); await rankingRegion.focus(); invariant(await rankingRegion.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none"), "Rankings require visible keyboard focus.");
      if (name === "mobile") {
        await page.keyboard.press("ArrowRight"); await page.waitForFunction(() => (document.querySelector(".usage-board__table-scroll")?.scrollLeft ?? 0) > 0);
      }
      await capture("leaderboard-ranked-max");
      invariant(peakWorkers <= 2, `Account recovery exceeded its two-worker custody bound: ${peakWorkers}.`);
      invariant(liveWorkers === 0, "Leaving the dashboard must release every report worker.");
      invariant(errors.length === 0, `Browser runtime errors: ${JSON.stringify(errors)}`);
      if (captureDirectory) await writeFile(resolve(captureDirectory, `${name}-functional.json`), JSON.stringify({ status: "passed",
        hostedAdmissionSignoutPassed, errors, effects, liveWorkers, peakWorkers, dailyReadyRequests, requests: requestDiagnostics() }, null, 2) + "\n");
      console.log(`${name}: stats local privacy, filters, sort, keyboard, CSV, bounds, account fallback and layout passed.`);
    } catch (error) {
      const failure = `${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
      failures.push(failure);
      if (captureDirectory) await writeFile(resolve(captureDirectory, `${name}-failure.json`), JSON.stringify({ status: "failed", failure,
        hostedAdmissionSignoutPassed, errors, effects, liveWorkers, peakWorkers, dailyReadyRequests, requests: requestDiagnostics() }, null, 2) + "\n");
      try { await capture("failure"); } catch { /* The original failure remains authoritative. */ }
    } finally { await context.close(); }
  }
  invariant(failures.length === 0, failures.join("\n"));
}

const statsBuildArtifacts = [".next/BUILD_ID", ".next/build-manifest.json", ".next/routes-manifest.json", ".next/server/app-paths-manifest.json"];
const statsBuildFlags = ["NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_DEPLOYMENT_ID", "VERCEL_PROJECT_ID", "VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_SITE_URL",
  "AICHARTS_USAGE_AUTH_ENABLED", "AICHARTS_USAGE_PRIVATE_READ_ENABLED", "AICHARTS_USAGE_STATS_ENABLED", "AICHARTS_USAGE_PUBLIC_READ_ENABLED"];

/** A qualification receipt must own a fresh build with the exact start flags.
 * Collect its process group and pipes before starting the browser server. */
async function buildForStatsBrowser(repository: string, environment: NodeJS.ProcessEnv): Promise<NonNullable<UsageStatsBrowserRuntime["build"]>> {
  const startedAtMs = Date.now(), command = [process.execPath, "run", "build"];
  const build = spawn(command[0], command.slice(1), { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"], detached: true });
  invariant(build.pid, "Stats production build was not spawned.");
  const pid = build.pid;
  build.stdout?.pipe(process.stdout, { end: false }); build.stderr?.pipe(process.stderr, { end: false });
  let closed = false, code: number | null = null;
  const drained = new Promise<void>(done => build.once("close", exit => { closed = true; code = exit; done(); }));
  const signal = (kind: NodeJS.Signals) => { try { process.kill(-pid, kind); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([drained, new Promise<never>((_done, reject) => {
      timer = setTimeout(() => reject(new Error("Stats production build exceeded its 180-second deadline.")), 180_000);
      build.once("error", reject);
    })]);
    invariant(code === 0, "Stats production build failed; no browser qualification started.");
  } finally {
    clearTimeout(timer); signal("SIGTERM");
    if (!closed) await Promise.race([drained, Bun.sleep(5_000)]);
    if (!closed) { signal("SIGKILL"); build.stdout?.destroy(); build.stderr?.destroy(); await Promise.race([drained, Bun.sleep(5_000)]); }
    invariant(closed, "Owned production build did not terminate and drain after bounded cleanup.");
  }
  const artifactSha256 = Object.fromEntries(await Promise.all(statsBuildArtifacts.map(async path => [path, createHash("sha256").update(await readFile(resolve(repository, path))).digest("hex")])));
  return { command, startedAtMs, finishedAtMs: Date.now(), buildId: (await readFile(resolve(repository, ".next/BUILD_ID"), "utf8")).trim(), artifactSha256,
    environment: Object.fromEntries(statsBuildFlags.map(flag => [flag, environment[flag]])) };
}

if (import.meta.main) {
  const repository = resolve(import.meta.dir, ".."), port = 47_000 + process.pid % 1_000, baseUrl = `http://127.0.0.1:${port}`;
  const dev = process.argv.includes("--dev"), captureIndex = process.argv.indexOf("--capture"), reuseIndex = process.argv.indexOf("--reuse-build"), episodesIndex = process.argv.indexOf("--profile-episodes");
  const profile = process.argv.includes("--worker-profile"), reusePath = reuseIndex < 0 ? null : process.argv[reuseIndex + 1];
  invariant(reuseIndex < 0 || (profile && typeof reusePath === "string" && !reusePath.startsWith("--") && !dev && !process.argv.includes("--build")), "Build reuse is limited to an explicit production worker diagnostic receipt.");
  invariant(episodesIndex < 0 || (profile && typeof process.argv[episodesIndex + 1] === "string"), "Episode selection requires the worker diagnostic.");
  const episodes = parseWorkerProfileEpisodes(episodesIndex < 0 ? undefined : process.argv[episodesIndex + 1]);
  invariant(dev || process.argv.includes("--build") || reusePath !== null, "Production browser verification requires --build to bind a fresh matching artifact.");
  invariant(!(dev && process.argv.includes("--build")), "Choose a development server or a production build, not both.");
  invariant(!(process.argv.includes("--worker-profile") && (dev || process.argv.includes("--max-report") || process.argv.includes("--also-functional"))), "Worker diagnostics require their own production run.");
  const captureDirectory = captureIndex >= 0 ? process.argv[captureIndex + 1] : process.env.AICHARTS_STATS_BROWSER_CAPTURE_DIR;
  const inputs = ["package.json", "bun.lock", "tsconfig.json", "next.config.ts", "scripts/build-theme-bootstrap.ts", "scripts/usage-stats-browser.ts", "app/usage/details/page.tsx",
    "components/usage/stats-dashboard.tsx", "components/usage/stats-report-file.ts", "components/usage/stats-report-view.tsx", "components/usage/stats-view.ts",
    "components/usage/stats-export.ts", "components/usage/stats-metric-explorer.tsx", "components/usage/rich-metric-explorer.tsx", "lib/usage/rich-metric-explorer-view.ts", "lib/usage/metric-export.ts", "lib/usage/session-example.ts", "lib/usage/saved-views.ts", "components/usage/stats-metric-projection.ts", "styles/usage-metric-explorer.css", "styles/usage-stats.css",
    "lib/usage/metric-explorer.ts", "lib/usage/metric-explorer-fold.ts", "lib/usage/metric-explorer-values.ts", "lib/usage/metric-explorer-catalog.ts",
    "lib/usage/metric-explorer-session.ts", "lib/usage/metric-explorer-worker.ts", "lib/usage/metric-explorer-worker-core.ts", "components/usage/stats-metric-presentation.ts", "components/usage/stats-metric-query.ts",
    "components/usage/stats-metric-daily-table.tsx",
    "lib/usage/stats-client.ts", "lib/usage/account-read-client.ts", "lib/usage/account-generation-read.ts", "lib/usage/account-public.ts",
    "lib/usage/stats-public.ts", "lib/usage/stats-http-contract.ts",
    "lib/usage/stats-contract.ts", "lib/usage/account-generation.ts", "lib/usage/account-session-events.ts", "data/usage-registry.json", "scripts/usage-stats-performance.ts",
    "scripts/usage-stats-cdp.ts", "scripts/usage-stats-worker-profile.ts", "lib/usage/metric-explorer.bench.ts"];
  const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, createHash("sha256").update(await readFile(resolve(repository, path))).digest("hex")])));
  const sourceSha256 = await hashes(), startedAtMs = Date.now();
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: dev ? "development" : "production", VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://aicharts.io",
    VERCEL_DEPLOYMENT_ID: "dpl_SYNTHETICStatsBrowser", VERCEL_PROJECT_ID: "prj_SYNTHETICStatsBrowser", VERCEL_GIT_COMMIT_SHA: "0".repeat(40),
    AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1", AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_PUBLIC_READ_ENABLED: "0", SUITE_OIDC_COOKIE_SECRET: "synthetic-stats-browser-no-production-authority" };
  for (const key of ["NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN", "POSTHOG_API_KEY", "VERCEL_OIDC_TOKEN"]) delete environment[key];
  const runtime: UsageStatsBrowserRuntime & { reuse?: { receiptPath: string; receiptSha256: string; verifiedAtMs: number; limitation: string } } = reusePath === null
    ? { mode: dev ? "development" : "production", build: dev ? null : await buildForStatsBrowser(repository, environment) }
    : await (async () => {
      const path = resolve(reusePath); invariant((await stat(path)).size <= 128 * 1024, "Diagnostic build receipt exceeds its byte ceiling.");
      const bytes = await readFile(path); invariant(bytes.length <= 128 * 1024, "Diagnostic build receipt changed beyond its byte ceiling.");
      const artifacts = Object.fromEntries(await Promise.all(statsBuildArtifacts.map(async path => [path, createHash("sha256").update(await readFile(resolve(repository, path))).digest("hex")])));
      const build = admitWorkerDiagnosticBuildReuse(JSON.parse(bytes.toString("utf8")) as unknown, sourceSha256, artifacts, Object.fromEntries(statsBuildFlags.map(flag => [flag, environment[flag]])));
      invariant((await readFile(resolve(repository, ".next/BUILD_ID"), "utf8")).trim() === build.buildId, "Diagnostic build ID changed.");
      return { mode: "production" as const, build, reuse: { receiptPath: path, receiptSha256: createHash("sha256").update(bytes).digest("hex"), verifiedAtMs: Date.now(),
        limitation: "Existing build reused only for selected synthetic diagnostic episodes after product/fixture/config/lock, artifact, Bun, environment and six-hour age checks. This is not a fresh-build or final integration receipt." } };
    })();
  invariant(JSON.stringify(sourceSha256) === JSON.stringify(await hashes()), "Browser-bound sources changed during production build.");
  // The server owns a separate process group. Closing only `bun run dev`
  // leaves its Next child holding localhost and the receipt's output pipe.
  const server = spawn(process.execPath, ["run", dev ? "dev" : "start", "--", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"], detached: true });
  invariant(server.pid, "Stats server was not spawned.");
  server.stdout?.pipe(process.stdout, { end: false }); server.stderr?.pipe(process.stderr, { end: false });
  const serverPid = server.pid;
  let serverClosed = false;
  const serverDrained = new Promise<void>(done => server.once("close", () => { serverClosed = true; done(); }));
  const signalGroup = (signal: NodeJS.Signals) => {
    try { process.kill(-serverPid, signal); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const listening = () => new Promise<boolean>(done => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (value: boolean) => { socket.destroy(); done(value); };
    socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.setTimeout(500, () => finish(true));
  });
  let browser: Browser | undefined, browserVersion = "unknown";
  try {
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      invariant(server.exitCode === null && server.signalCode === null, "Stats server exited before readiness.");
      try { if ((await fetch(`${baseUrl}/usage/details`)).status === 200) { ready = true; break; } } catch { /* Bounded readiness. */ }
      await Bun.sleep(500);
    }
    invariant(ready, "Stats server did not become ready.");
    // Compiling a sibling route for the first time can trigger Next's dev HMR
    // reload in an already-open tab. Compile the finite fixture route set
    // before private/local state is created, keeping lifecycle checks real.
    if (dev) for (const route of ["/usage/sessions", "/dashboard", "/leaderboard"])
      invariant((await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(60_000) })).status === 200, "Fixture route failed prewarm.");
    for (const executablePath of [process.env.CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter((path): path is string => path !== undefined)) {
      try { await access(executablePath); browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] }); break; } catch { /* Try available supported executable. */ }
    }
    invariant(browser, "No supported Chromium executable was available.");
    browserVersion = browser.version();
    try {
      if (process.argv.includes("--worker-profile")) {
        invariant(captureDirectory, "Worker profiling requires a receipt directory.");
        await verifyUsageStatsWorkerProfile(browser, baseUrl, captureDirectory, runtime, episodes, sourceSha256);
      } else if (process.argv.includes("--max-report")) {
        invariant(captureDirectory, "Maximum report measurement requires a receipt directory.");
        await mkdir(captureDirectory, { recursive: true }); await verifyUsageStatsMaximum(browser, baseUrl, captureDirectory, runtime);
        if (process.argv.includes("--also-functional")) await verifyUsageStats(browser, baseUrl, captureDirectory);
      } else await verifyUsageStats(browser, baseUrl, captureDirectory);
    }
    catch (error) { console.error("Synthetic browser journey failed:", error); throw error; }
    invariant(JSON.stringify(sourceSha256) === JSON.stringify(await hashes()), "Browser-bound source changed during qualification.");
    if (runtime.build !== null) for (const [path, expected] of Object.entries(runtime.build.artifactSha256))
      invariant(createHash("sha256").update(await readFile(resolve(repository, path))).digest("hex") === expected, "Production build artifacts changed during qualification.");
  } catch (error) {
    if (captureDirectory) {
      await mkdir(captureDirectory, { recursive: true });
      await writeFile(resolve(captureDirectory, "failed-receipt.json"), JSON.stringify({ schemaVersion: 1, status: "failed", runtime, sourceSha256,
        sourceStillMatches: JSON.stringify(sourceSha256) === JSON.stringify(await hashes()), browserVersion, bun: Bun.version, startedAtMs,
        failedAtMs: Date.now(), reason: error instanceof Error ? error.stack : String(error) }, null, 2) + "\n");
    }
    throw error;
  } finally {
    await browser?.close(); signalGroup("SIGTERM");
    await Promise.race([serverDrained, Bun.sleep(5_000)]);
    if (!serverClosed || await listening()) signalGroup("SIGKILL");
    await Promise.race([serverDrained, Bun.sleep(5_000)]);
    // The wrapper's output belongs to this process alone. Do not let a late
    // compiler child retain it after the driver has reported an outcome.
    server.stdout?.destroy(); server.stderr?.destroy();
    invariant(serverClosed && !await listening(), "Owned browser server did not terminate and drain after bounded cleanup.");
  }
  if (captureDirectory) await writeFile(resolve(captureDirectory, "receipt.json"), JSON.stringify({ schemaVersion: 1, status: "passed",
    command: [process.execPath, ...process.argv.slice(1)], mode: runtime.mode, runtime, sourceSha256,
    browserVersion, bun: Bun.version, startedAtMs, finishedAtMs: Date.now(),
    coverage: process.argv.includes("--worker-profile") ? `Selected synthetic production diagnostic episodes: ${episodes.join(", ")}. Instrumented and unprofiled samples remain separate. ${reusePath === null ? "Fresh build." : "Verified existing build; no fresh-build or final integration claim."} No live provider, modest-hardware or population-p95 claim.`
      : process.argv.includes("--max-report") ? `Synthetic maximum-report desktop performance diagnostic${process.argv.includes("--also-functional") ? " plus desktop/light and mobile/dark functional journeys" : ""}; see maximum-performance.json for timing, memory and limits. No live provider authority.`
      : "Synthetic desktop/light and mobile/dark reduced-motion journeys; all account/provider responses are fixtures. This does not qualify maximum-report latency or live authority." }, null, 2) + "\n");
}
