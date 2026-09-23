import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardView } from "../components/usage/leaderboard-view";
import { parseLeaderboardSnapshot } from "../lib/usage/leaderboard-contract";
import { createUsageStatsExample } from "../lib/usage/stats-example";
import { parseUsageStatsReport, type UsageStatsReport } from "../lib/usage/stats-contract";
import { parseStatsPublicSearch, statsPublicStatus, STATS_PUBLIC_MEDIA, type StatsPublicReply } from "../lib/usage/stats-public";
import { encodePrivateDaysPublicResponse, parsePrivateDaysPublicSearch, PRIVATE_DAYS_PUBLIC_MEDIA } from "../lib/usage/private-days-public";
import { encodeUsageConsentPublicReply, USAGE_CONSENT_PUBLIC_MEDIA } from "../lib/usage/consent-public";

function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle(page: Page) { await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => done())); }); }

function hostedReport(firstUtcDay: number, dayCount: number): UsageStatsReport {
  const example = createUsageStatsExample(firstUtcDay + dayCount - 1);
  const rows = example.rows.filter(row => row.utcDay >= firstUtcDay);
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
    let localInteraction = false, statsMode: "ready" | "not_started" | "range_too_large" | "authentication_required" = "ready";
    const accountId = `acct_${"a".repeat(32)}`;
    let signOutCalls = 0, signOutFails = true, accountSignedOut = false, holdStats = false;
    const heldStats: Route[] = []; let statsArrived: (() => void) | undefined;
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { document.documentElement.dataset.copiedAccount = text; } } });
    });
    page.on("pageerror", error => errors.push(error.message.slice(0, 500)));
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
        if (holdStats) { heldStats.push(route); statsArrived?.(); return; }
        const reply: StatsPublicReply = statsMode === "ready" ? { schemaVersion: 2, ok: true, value: hostedReport(range.firstUtcDay, range.dayCount) }
          : { schemaVersion: 2, ok: false, error: statsMode };
        await route.fulfill({ status: statsPublicStatus(reply), headers: { "content-type": STATS_PUBLIC_MEDIA, "cache-control": "private, no-store" }, body: JSON.stringify(reply) }); return;
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
        await route.fulfill({ status: 200, headers: { "content-type": PRIVATE_DAYS_PUBLIC_MEDIA }, body: Buffer.from(bytes) }); return;
      }
      if (url.pathname === "/api/usage/consent") {
        const bytes = encodeUsageConsentPublicReply({ schemaVersion: 1, error: { code: "authentication_required" } });
        invariant(bytes, "Consent fixture must validate.");
        await route.fulfill({ status: 401, headers: { "content-type": USAGE_CONSENT_PUBLIC_MEDIA }, body: Buffer.from(bytes) }); return;
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
      if (name === "mobile") {
        const toggle = page.getByRole("button", { name: /^Filters/ });
        if (await toggle.getAttribute("aria-expanded") !== "true") { await toggle.focus(); await page.keyboard.press("Enter"); }
      }
    };
    const choosePeriod = async (days: number) => {
      if (name === "mobile") await page.getByLabel("Period", { exact: true }).selectOption(String(days));
      else await page.getByRole("button", { name: `${days} days`, exact: true }).click();
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
        await account.getByRole("button", { name: "Sign out", exact: true }).click();
        await account.getByRole("alert").waitFor();
        invariant(signOutCalls === 1 && page.url() === `${baseUrl}/usage/details`, "A failed sign-out must not claim success or navigate.");
        await capture("account-sign-out-failed");
        await page.reload({ waitUntil: "networkidle" });
      }
      await capture("stats-initial");
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
      await page.getByRole("group", { name: "Chart metric" }).getByRole("button", { name: "Tok/s", exact: true }).click();
      await page.getByRole("group", { name: /^Measured tokens per second by day/ }).waitFor();
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
      const imageDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download image", exact: true }).click();
      invariant((await imageDownload).suggestedFilename().endsWith(".png"), "The activity image must download as a PNG.");
      await expandFilters();
      await page.getByLabel("Provider", { exact: true }).selectOption("openai");
      invariant(await page.getByLabel("Model", { exact: true }).locator('option[value="claude-sonnet-4"]').count() === 0, "Provider selection must narrow the model choices.");
      await page.getByLabel("Model", { exact: true }).selectOption("gpt-5");
      await page.getByLabel("Provider", { exact: true }).selectOption("anthropic");
      invariant(await page.getByLabel("Model", { exact: true }).inputValue() === "*", "Changing providers must clear the previous model selection.");
      await page.getByLabel("Client", { exact: true }).selectOption("opencode");
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
      if (name === "mobile") invariant(await page.getByRole("button", { name: "Filters · 1 active", exact: true }).count() === 1, "Collapsed filter control must expose the active scope count.");
      await page.getByText("No token observations", { exact: true }).waitFor();
      invariant(await page.locator(".usage-stats__cost > strong").textContent() === "Unavailable", "A cumulative Warp billing snapshot must not become daily period cost.");
      await page.getByRole("region", { name: "Warp billing snapshot", exact: true }).getByText("$12.35", { exact: true }).waitFor();
      const snapshotDownloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Download numeric CSV" }).click();
      const snapshotDownload = await snapshotDownloadEvent, snapshotFile = await snapshotDownload.path(); invariant(snapshotFile, "Snapshot CSV must download.");
      const snapshotCsv = await Bun.file(snapshotFile).text(); invariant(snapshotCsv.includes('"refresh_snapshot","warp"') && !snapshotCsv.includes('"codex"'), "CSV must retain the explicitly labeled latest Warp snapshot in the selected client scope.");
      await page.getByRole("button", { name: /^Clear filters/ }).click();
      await page.getByLabel("Token basis", { exact: true }).selectOption("estimated");
      invariant(await page.locator(".usage-stats__exact").textContent() === "60,000 exact", "Estimated tokens must remain separate.");
      await page.getByLabel("Token basis", { exact: true }).selectOption("reported");
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
      const large = { ...original, rows: original.rows.map((row, index) => index === original.rows.length - 3 ? { ...row, tokens: { ...row.tokens, input: "9007199254740993" } } : row) };
      invariant(parseUsageStatsReport(large), "Large local numeric fixture must validate.");
      const upload = page.getByLabel("Open numeric usage report", { exact: true });
      await upload.setInputFiles({ name: "numeric-report.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(large)) });
      await page.locator(".usage-stats-heading > span").filter({ hasText: "Local reports stay in this browser" }).waitFor();
      await capture("stats-local-large");
      const empty = { ...original, sources: [], rows: [] };
      await upload.setInputFiles({ name: "empty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(empty)) });
      await page.getByRole("heading", { name: "No matching reported records" }).waitFor(); await capture("stats-empty");
      await upload.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"prompt":"must not leave browser"}') });
      await page.getByRole("alert").filter({ hasText: "could not be read as a numeric usage report" }).waitFor(); await capture("stats-import-error");
      invariant(effects.length === 0, `Local report actions must have no API or write effects: ${JSON.stringify(effects)}`);
      localInteraction = false;
      if (await account.count()) {
        await account.locator("summary").click(); signOutFails = false;
        await account.getByRole("button", { name: "Sign out", exact: true }).click();
        await account.getByText("Sign-in required", { exact: true }).waitFor();
        invariant(page.url() === `${baseUrl}/usage/details` && await page.locator(".usage-stats").count() === 1
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
        statsMode = "ready";
        await page.getByRole("button", { name: "Load account", exact: true }).click(); await page.getByText("Private to your account", { exact: true }).waitFor();
        await expandFilters();
        await page.getByLabel("Client", { exact: true }).selectOption("codex");
        await choosePeriod(90); await page.getByRole("heading", { name: "Weekly usage" }).waitFor();
        invariant(await page.getByLabel("Client", { exact: true }).inputValue() === "codex", "Account range refresh must preserve client selection.");
        await expandFilters();
        statsMode = "range_too_large"; await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "too much detail" }).waitFor(); await capture("stats-range-error");
        statsMode = "ready"; await page.getByRole("button", { name: "Load last 7 days", exact: true }).click();
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
          await account.getByRole("button", { name: "Sign out", exact: true }).click();
          await account.getByText("Sign-in required", { exact: true }).waitFor();
          invariant(page.url() === `${baseUrl}/usage/details` && await page.locator(".usage-stats").count() === 1
            && await page.getByText("Example data · synthetic", { exact: true }).count() === 1 && Number(signOutCalls) === 3,
            "Ordinary sign-out must preserve the initiating tab's synthetic example.");
          await account.locator("summary").click();
          await siblingSignOut();
          invariant(await page.locator(".usage-stats").count() === 1 && await page.getByText("Example data · synthetic", { exact: true }).count() === 1,
            "A cross-tab sign-out must preserve example data.");
        }
        statsMode = "ready"; await page.getByRole("button", { name: "Load account", exact: true }).click();
        await page.getByRole("heading", { name: "Daily usage", exact: true }).waitFor();
        statsMode = "not_started"; await expandFilters(); await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await page.getByRole("heading", { name: "No detailed snapshot yet", exact: true }).waitFor();
        if (await account.count()) {
          statsMode = "ready";
          const arrived = new Promise<void>(done => { statsArrived = done; }); holdStats = true;
          await page.getByRole("button", { name: "Load account", exact: true }).click(); await arrived;
          await siblingSignOut();
          await page.getByRole("heading", { name: "Sign in to view your usage", exact: true }).waitFor();
          holdStats = false;
          for (const route of heldStats.splice(0)) {
            const range = parseStatsPublicSearch(new URL(route.request().url()).search); invariant(range, "Held read keeps its original range.");
            await route.fulfill({ status: 200, contentType: STATS_PUBLIC_MEDIA, body: JSON.stringify({ schemaVersion: 2, ok: true, value: hostedReport(range.firstUtcDay, range.dayCount) }) }).catch(() => undefined);
          }
          await settle(page);
          invariant(await page.locator(".usage-stats").count() === 0, "A late successful account response must not restore private data after cross-tab sign-out.");
        }
      }
      statsMode = "not_started";
      accountSignedOut = false; // A distinct synthetic signed-in visit for daily cleanup.
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle" }); await page.getByRole("heading", { name: "Codex", exact: true }).waitFor(); await capture("usage-fallback");
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
      invariant(errors.length === 0, `Browser runtime errors: ${JSON.stringify(errors)}`);
      console.log(`${name}: stats local privacy, filters, sort, keyboard, CSV, bounds, account fallback and layout passed.`);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      try { await capture("failure"); } catch { /* The original failure remains authoritative. */ }
    } finally { await context.close(); }
  }
  invariant(failures.length === 0, failures.join("\n"));
}

if (import.meta.main) {
  const repository = resolve(import.meta.dir, ".."), port = 47_000 + process.pid % 1_000, baseUrl = `http://127.0.0.1:${port}`;
  const dev = process.argv.includes("--dev"), captureIndex = process.argv.indexOf("--capture");
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: dev ? "development" : "production", VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://aicharts.io",
    VERCEL_DEPLOYMENT_ID: "dpl_SYNTHETICStatsBrowser", VERCEL_PROJECT_ID: "prj_SYNTHETICStatsBrowser", VERCEL_GIT_COMMIT_SHA: "0".repeat(40),
    AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1", AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_PUBLIC_READ_ENABLED: "0", SUITE_OIDC_COOKIE_SECRET: "synthetic-stats-browser-no-production-authority" };
  for (const key of ["NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN", "POSTHOG_API_KEY", "VERCEL_OIDC_TOKEN"]) delete environment[key];
  const server = Bun.spawn([process.execPath, "run", dev ? "dev" : "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: repository, env: environment, stdout: "inherit", stderr: "inherit" });
  let browser: Browser | undefined;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      invariant(server.exitCode === null, "Stats server exited before readiness.");
      try { if ((await fetch(`${baseUrl}/usage/details`)).status === 200) { ready = true; break; } } catch { /* Bounded readiness. */ }
      await Bun.sleep(500);
    }
    invariant(ready, "Stats server did not become ready.");
    for (const executablePath of [process.env.CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter((path): path is string => path !== undefined)) {
      try { await access(executablePath); browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] }); break; } catch { /* Try available supported executable. */ }
    }
    invariant(browser, "No supported Chromium executable was available.");
    await verifyUsageStats(browser, baseUrl, captureIndex >= 0 ? process.argv[captureIndex + 1] : process.env.AICHARTS_STATS_BROWSER_CAPTURE_DIR);
  } finally {
    await browser?.close(); server.kill("SIGTERM"); await Promise.race([server.exited, Bun.sleep(5_000)]); if (server.exitCode === null) server.kill("SIGKILL");
  }
}
