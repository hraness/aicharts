import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser, Locator, Page, Route } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardView } from "../components/usage/leaderboard-view";
import { encodePrivateDaysPublicResponse, parsePrivateDaysPublicSearch, privateDaysPublicStatus,
  PRIVATE_DAYS_PUBLIC_MEDIA, type PrivateDaysPublicReply, type PrivateDaysRange } from "../lib/usage/private-days-public";
import { encodeUsageConsentPublicReply, USAGE_CONSENT_PUBLIC_MEDIA } from "../lib/usage/consent-public";
import { parseLeaderboardSnapshot, type LeaderboardConsentViewV1 } from "../lib/usage/leaderboard-contract";
import { verifyUsagePairing } from "./usage-pairing-browser";

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

type Mode = "ready" | "zero" | "not_enrolled" | "authentication_required" | "unavailable" | "exact";

/** Synthetic browser data is checked by the same public codec as the service. */
function fixture(mode: Mode, range: PrivateDaysRange): PrivateDaysPublicReply {
  if (mode === "not_enrolled") return { schemaVersion: 1, state: mode };
  if (mode === "authentication_required" || mode === "unavailable") return { schemaVersion: 1, error: { code: mode } };
  const empty = { usageOccurrences: 0, observedAccountedTokens: "0", observedOutputTokens: "0" };
  return { schemaVersion: 1, state: "ready", value: {
    schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
    journalRevision: mode === "zero" ? 0 : 100,
    journalCommittedAtMs: mode === "zero" ? null : (range.firstUtcDay + range.dayCount - 1) * 86_400_000,
    firstUtcDay: range.firstUtcDay,
    days: Array.from({ length: range.dayCount }, (_, index) => ({ utcDay: range.firstUtcDay + index,
      codex: mode === "zero" ? empty : mode === "exact" && index === 0
        ? { usageOccurrences: 4_096, observedAccountedTokens: "9007199254740993", observedOutputTokens: "3000000000000123" }
        : { usageOccurrences: 20 + index, observedAccountedTokens: String(1_450_000 + (index * 679_133) % 5_000_000), observedOutputTokens: String(350_000 + index * 31_713) },
      claudeCode: mode === "zero" ? empty
        : { usageOccurrences: 9 + index, observedAccountedTokens: String(710_000 + (index * 331_721) % 3_000_000), observedOutputTokens: String(210_000 + index * 15_921) },
      devin: mode === "zero" ? empty
        : { usageOccurrences: 4 + index, observedAccountedTokens: String(380_000 + (index * 201_733) % 2_000_000), observedOutputTokens: String(90_000 + index * 9_517) },
    })),
  } };
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(done => requestAnimationFrame(() => done()));
  });
}

async function checkDormant(baseUrl: string): Promise<void> {
  const page = await fetch(`${baseUrl}/usage`), html = await page.text();
  invariant(page.status === 200, "Disabled usage page must remain available.");
  for (const text of ["Your AI usage", "Remote sync is not enabled yet.",
    "aicharts usage --key-file ./aicharts.key --codex ./sessions", "No transcript storage", 'aria-current="page" href="/usage"',
    '<link rel="canonical" href="https://aicharts.io/usage"']) {
    invariant(html.includes(text), "The real request-time page must preserve local-only measurement, coverage and current navigation.");
  }
  for (const [method, status] of [["GET", 503], ["HEAD", 405], ["POST", 405], ["OPTIONS", 405]] as const) {
    const response = await fetch(`${baseUrl}/api/usage/days?firstUtcDay=20000&dayCount=1`, { method });
    invariant(response.status === status, `Dormant usage ${method} must return ${status}.`);
    invariant(response.headers.get("cache-control") === "private, no-store", "Private usage must never be cached.");
    invariant(!response.headers.has("set-cookie") && !response.headers.has("location"), "Dormant usage must have no cookie or redirect effects.");
    if (method === "HEAD") invariant((await response.arrayBuffer()).byteLength === 0, "HEAD must have no body.");
    else invariant((await response.json() as { error: { code: string } }).error.code === (method === "GET" ? "unavailable" : "method_not_allowed"), "Dormant usage must retain fixed errors.");
  }
  const leaderboard = await fetch(`${baseUrl}/leaderboard`), leaderboardHtml = await leaderboard.text();
  invariant(leaderboard.status === 200, "The public leaderboard page must remain available while reads are paused.");
  for (const text of ["Public usage leaderboard", "Publishing paused", "Public publishing is not available yet",
    'aria-current="page" href="/leaderboard"', '<link rel="canonical" href="https://aicharts.io/leaderboard"']) {
    invariant(leaderboardHtml.includes(text), "The paused leaderboard must render its honest disabled state.");
  }
  for (const [path, method, status, code, cache] of [
    ["/api/leaderboard", "GET", 503, "unavailable", "private, no-store"],
    ["/api/leaderboard", "POST", 405, "method_not_allowed", "private, no-store"],
    ["/api/usage/consent", "GET", 503, "unavailable", "private, no-store"],
    ["/api/usage/consent", "POST", 503, "unavailable", "private, no-store"],
    ["/api/usage/consent", "PUT", 405, "method_not_allowed", "private, no-store"],
  ] as const) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    invariant(response.status === status, `Dormant ${method} ${path} must return ${status}.`);
    invariant(response.headers.get("cache-control") === cache, `Dormant ${path} must keep its declared cache policy.`);
    invariant(!response.headers.has("set-cookie") && !response.headers.has("location"), "Dormant routes must have no cookie or redirect effects.");
    invariant((await response.json() as { error: { code: string } }).error.code === code, `Dormant ${path} must retain fixed errors.`);
  }
}

/** Synthetic component integration with the real route's loaded CSS and theme.
 * This verifies ranked layout, not live SSR data or provider availability. */
async function verifyRankedLeaderboard(page: Page, baseUrl: string, name: string, captureDirectory?: string): Promise<void> {
  const computedAtMs = Date.UTC(2026, 8, 19, 0, 5), utcDay = Math.floor(computedAtMs / 86_400_000);
  const snapshot = parseLeaderboardSnapshot({ schemaVersion: 1, ranking: "observed-tokens-30d-v1", computedAtMs, entries: [
    { rank: 1, publicHandle: "synthetic-long-handle-1234567890", observedTokens: "9007199254740993", usageRecords: 4096,
      consentedAtMs: computedAtMs - 86_400_000, refreshedAtMs: computedAtMs, windowFirstUtcDay: utcDay - 29, windowUtcDays: 30 },
    { rank: 2, publicHandle: "synthetic-second-account", observedTokens: "1234567", usageRecords: 87,
      consentedAtMs: computedAtMs - 2 * 86_400_000, refreshedAtMs: computedAtMs - 10 * 60_000, windowFirstUtcDay: utcDay - 30, windowUtcDays: 30 },
  ] });
  invariant(snapshot !== null, "Synthetic rankings must pass the production snapshot contract.");
  const markup = renderToStaticMarkup(createElement(LeaderboardView, { available: true, snapshot }));
  await page.goto(`${baseUrl}/leaderboard`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Public usage leaderboard", exact: true }).waitFor();
  await settle(page);
  await page.locator("main.leaderboard-home").evaluate((main, html) => {
    for (const section of main.querySelectorAll(":scope > section")) section.remove();
    main.setAttribute("data-qa-fixture", "synthetic-ranked-leaderboard");
    main.insertAdjacentHTML("afterbegin", `<p class="usage-board__hint">Synthetic fixture · layout verification only</p>${html}`);
  }, markup);
  const rankings = page.getByRole("region", { name: "Public usage rankings", exact: true });
  await rankings.waitFor(); await settle(page);
  invariant(await rankings.locator("tbody tr").count() === 2, "The ranked fixture must render both accounts.");
  invariant(await rankings.getByText("9,007,199,254,740,993", { exact: true }).count() === 1, "Ranked token totals must retain integer precision.");
  invariant(await rankings.getByRole("columnheader", { name: "Last refreshed", exact: true }).count() === 1, "Rankings must label refreshes without claiming independent verification.");
  const coverage = await rankings.locator(".usage-board__coverage").allTextContents();
  invariant(coverage.length === 2 && coverage[0] !== coverage[1], "Ranked entries must retain distinct reporting windows.");
  invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Ranked leaderboard must fit the page viewport.");
  await page.keyboard.press("Tab"); await rankings.focus();
  invariant(await rankings.evaluate(element => element === document.activeElement && getComputedStyle(element).outlineStyle !== "none"), "Rankings must have visible keyboard focus.");
  if (name === "mobile") {
    invariant(await rankings.evaluate(element => element.scrollWidth > element.clientWidth && getComputedStyle(element).overflowX === "auto"), "Mobile ranking columns must scroll inside their own region.");
    await rankings.evaluate(element => {
      element.addEventListener("scrollend", () => element.setAttribute("data-keyboard-scroll-settled", ""), { once: true });
    });
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".usage-board__table-scroll")?.hasAttribute("data-keyboard-scroll-settled"));
    invariant(await rankings.evaluate(element => element.scrollLeft > 0), "ArrowRight must scroll the mobile rankings.");
    await rankings.evaluate(element => element.scrollTo({ left: 0, behavior: "instant" }));
  }
  await page.locator("h1").click(); await page.evaluate(() => scrollTo(0, 0)); await settle(page);
  if (captureDirectory !== undefined) {
    await page.screenshot({ path: resolve(captureDirectory, `${name}-leaderboard.png`), fullPage: true });
    await page.screenshot({ path: resolve(captureDirectory, `${name}-leaderboard-viewport.png`) });
  }
}

async function assertButtonContrast(button: Locator): Promise<void> {
  const paint = await button.evaluate(element => {
    const style = getComputedStyle(element);
    return { text: style.color, background: style.backgroundColor };
  });
  const luminance = (color: string) => {
    const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(color);
    invariant(rgb !== null, "Enabled button colors must resolve to opaque sRGB.");
    const channels = rgb.slice(1).map(value => Number(value) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
  };
  const levels = [luminance(paint.text), luminance(paint.background)].sort((a, b) => a - b);
  invariant((levels[1]! + .05) / (levels[0]! + .05) >= 4.5, "Enabled Refresh text must meet 4.5:1 contrast in every tested state.");
}

export async function verifyUsageDashboard(browser: Browser, disabledBaseUrl: string, repository: string, hostname: string, port: number): Promise<void> {
  await checkDormant(disabledBaseUrl);
  const baseUrl = `http://${hostname}:${port}`;
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production",
    VERCEL_DEPLOYMENT_ID: "dpl_SYNTHETICUsageBrowser", VERCEL_PROJECT_ID: "prj_SYNTHETICUsageBrowser", VERCEL_GIT_COMMIT_SHA: "0".repeat(40),
    NEXT_PUBLIC_SITE_URL: "https://aicharts.io", AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1",
    AICHARTS_USAGE_PAIRING_ENABLED: "1", AICHARTS_USAGE_PUBLIC_READ_ENABLED: "0",
    SUITE_OIDC_COOKIE_SECRET: "synthetic-browser-fixture-not-a-production-secret" };
  for (const key of ["NEXT_PUBLIC_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_SURFACE_ORIGIN", "NEXT_PUBLIC_HRANESS_VERCEL_PREVIEW_ORIGIN", "POSTHOG_API_KEY", "VERCEL_OIDC_TOKEN"]) delete environment[key];
  const server = Bun.spawn([process.execPath, "run", "start", "--", "--hostname", hostname, "--port", String(port)], {
    cwd: repository, env: environment, stdout: "inherit", stderr: "inherit",
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      invariant(server.exitCode === null, "Usage fixture server exited before readiness.");
      try { if ((await fetch(`${baseUrl}/usage`)).status === 200) { ready = true; break; } } catch { /* Bounded startup. */ }
      await Bun.sleep(250);
    }
    invariant(ready, "Usage fixture server did not become ready.");
    const captureDirectory = process.env.AICHARTS_USAGE_BROWSER_CAPTURE_DIR;
    if (captureDirectory !== undefined) await mkdir(resolve(captureDirectory), { recursive: true });
    for (const [name, width, colorScheme] of [["desktop", 1440, "light"], ["mobile", 390, "dark"]] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: "reduce", serviceWorkers: "block" });
      const page = await context.newPage();
      const failures: string[] = [];
      const blockedOrigins = new Set<string>();
      page.on("pageerror", () => failures.push("browser runtime error"));
      let mode: Mode = "ready", hold = false, requests = 0;
      const held: Route[] = [];
      let heldArrived: (() => void) | undefined;
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin === "https://account.hraness.com") {
          // The shared footer's consent and mailing-enrollment calls are
          // production-only and hostname-allowlisted; answer the two boundary
          // routes synthetically while other Accounts access stays blocked.
          if (route.request().method() === "GET" && url.pathname === "/api/consent/region") {
            await route.fulfill({ status: 200, contentType: "application/json", body: '{"region":null,"required":false}' });
            return;
          }
          if (route.request().method() === "POST" && url.pathname === "/api/mailing/experiment") {
            await route.fulfill({ status: 204 });
            return;
          }
        }
        if (url.origin !== baseUrl) { blockedOrigins.add(url.origin); await route.abort(); return; }
        if (url.pathname !== "/api/usage/days") { await route.continue(); return; }
        requests++;
        const request = route.request();
        invariant(request.method() === "GET" && request.postData() === null && request.headers()["accept"] === "application/json", "The browser must request only the numeric GET contract.");
        const range = parsePrivateDaysPublicSearch(url.search);
        invariant(range !== null, "Browser date range must be canonical.");
        if (hold) { held.push(route); heldArrived?.(); return; }
        const reply = fixture(mode, range), bytes = encodePrivateDaysPublicResponse(reply, range);
        invariant(bytes !== null, "Synthetic browser measurements must pass the public codec.");
        await route.fulfill({ status: privateDaysPublicStatus(reply), headers: { "content-type": PRIVATE_DAYS_PUBLIC_MEDIA, "cache-control": "private, no-store" }, body: Buffer.from(bytes) });
      });
      const loaded = async () => {
        await page.getByRole("heading", { name: "Codex", exact: true }).waitFor();
        await settle(page);
      };
      const refresh = async (next: Mode) => { mode = next; await page.getByRole("button", { name: "Refresh", exact: true }).click(); };
      try {
        await page.goto(`${baseUrl}/usage`, { waitUntil: "domcontentloaded" });
        await loaded();
        invariant(requests === 1, "The initial dashboard must issue one request.");
        const refreshButton = page.getByRole("button", { name: "Refresh", exact: true });
        await page.mouse.move(1, 1); await settle(page); await assertButtonContrast(refreshButton);
        await refreshButton.hover(); await settle(page); await assertButtonContrast(refreshButton);
        await refreshButton.focus(); await page.mouse.move(1, 1); await settle(page); await assertButtonContrast(refreshButton);
        invariant(await page.locator(".usage-daily__coverage").textContent().then(text => text?.includes("Last recorded sync:")), "The timestamp must describe a recorded sync.");
        invariant(await page.locator(".usage-daily table tbody").count() === 30, "Each UTC date must be its own semantic row group.");
        invariant(await page.locator(".usage-daily table tbody").first().locator("tr").count() === 3, "Each date must have all three provider rows.");
        invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Usage page must fit the viewport.");
        const scroll = page.getByRole("region", { name: "Daily usage, scroll horizontally for all columns" });
        await scroll.focus();
        invariant(await scroll.evaluate(element => element === document.activeElement && getComputedStyle(element).outlineStyle !== "none"), "The table must have a visible keyboard focus ring.");
        if (name === "mobile") {
          // Native keyboard scrolling can continue after the first nonzero offset.
          // Wait for its completion before resetting the screenshot position.
          await scroll.evaluate(element => {
            element.addEventListener("scrollend", () => element.setAttribute("data-keyboard-scroll-settled", ""), { once: true });
          });
          await page.keyboard.press("ArrowRight");
          await page.waitForFunction(() => document.querySelector(".usage-daily__table-scroll")?.hasAttribute("data-keyboard-scroll-settled"));
          invariant(await scroll.evaluate(element => element.scrollLeft > 0), "ArrowRight must scroll the mobile table horizontally.");
          await scroll.evaluate(element => element.scrollTo({ left: 0, behavior: "instant" }));
          await page.waitForFunction(() => (document.querySelector(".usage-daily__table-scroll")?.scrollLeft ?? -1) === 0);
        }
        await page.locator("h1").click(); await page.evaluate(() => scrollTo(0, 0));
        if (captureDirectory !== undefined) {
          await page.screenshot({ path: resolve(captureDirectory, `${name}.png`), fullPage: true });
          await page.screenshot({ path: resolve(captureDirectory, `${name}-viewport.png`) });
        }

        const todayInput = await page.getByLabel("Through", { exact: true }).inputValue();
        const todayUtcDay = Date.parse(`${todayInput}T00:00:00.000Z`) / 86_400_000;
        const quickRanges = page.getByRole("group", { name: "Quick date ranges in UTC", exact: true });
        for (const [label, days] of [["Today", 1], ["Last 7 days", 7], ["Last 30 days", 30]] as const) {
          const beforePreset: number = requests;
          const button = quickRanges.getByRole("button", { name: label, exact: true });
          await button.focus(); await page.keyboard.press("Enter"); await loaded();
          invariant(requests === beforePreset + 1, "Each date preset must issue exactly one bounded read.");
          invariant(await page.locator(".usage-daily table tbody").count() === days, "Preset calendar days must control daily rows.");
          invariant(await button.getAttribute("aria-pressed") === "true", "The applied preset must expose its selected state.");
          invariant(await page.getByLabel("From", { exact: true }).inputValue() === new Date((todayUtcDay - days + 1) * 86_400_000).toISOString().slice(0, 10), "Presets must use UTC calendar days.");
          invariant(await page.getByLabel("Through", { exact: true }).inputValue() === todayInput, "Presets must include the server's current UTC day.");
        }
        invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Preset controls must fit the viewport.");

        await refresh("zero"); await page.getByRole("heading", { name: "No observations in these dates" }).waitFor();
        invariant(await page.locator(".usage-daily__plot").count() === 0, "Connected zero observations must not invent chart data.");
        await refresh("not_enrolled"); await page.getByRole("heading", { name: "No collector connected" }).waitFor();
        invariant(await page.locator(".usage-daily table").count() === 0, "Unenrolled state must clear previous measurements.");
        await refresh("authentication_required"); await page.getByRole("button", { name: "Sign in with Hraness" }).waitFor();
        invariant(await page.locator('form[action="/api/suite-auth/start"][method="get"] input[name="return_to"]').inputValue() === "/usage", "Document sign-in must return to this private page.");
        await refresh("ready"); await loaded();
        await refresh("unavailable"); await page.getByRole("heading", { name: "Usage is unavailable right now" }).waitFor();
        invariant(await page.locator(".usage-daily table").count() === 0, "Failed refresh must clear old values.");
        if (captureDirectory !== undefined) await page.screenshot({ path: resolve(captureDirectory, `${name}-unavailable.png`), fullPage: true });

        const first = page.getByLabel("From", { exact: true }), last = page.getByLabel("Through", { exact: true });
        await first.fill("2026-09-01"); await last.fill("2026-10-02");
        const beforeInvalid = requests;
        await page.getByRole("button", { name: "Apply dates" }).click();
        await page.getByRole("alert").filter({ hasText: "Choose 1–31 days" }).waitFor();
        invariant(requests === beforeInvalid && await page.getByRole("heading", { name: "Usage is unavailable right now" }).count() === 0, "Invalid dates must report their own error without a network request.");
        await last.fill("2026-09-01"); mode = "exact";
        await page.getByRole("button", { name: "Apply dates" }).click(); await loaded();
        invariant(await page.locator(".usage-daily table tbody").count() === 1, "Applied date range must control daily rows.");
        invariant(await page.locator(".usage-daily table").getByText("9,007,199,254,740,993", { exact: true }).count() === 1, "Token counts above 2^53 must remain exact.");

        const heldRequest = new Promise<void>(done => { heldArrived = done; });
        hold = true;
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await page.locator(".usage-daily__loading").waitFor();
        await heldRequest;
        invariant(await page.locator(".usage-daily table").count() === 0, "Loading must clear old values.");
        // A new range can supersede a pending refresh, without waiting for it.
        await last.fill("2026-09-02"); hold = false; mode = "ready";
        await page.getByRole("button", { name: "Apply dates" }).click(); await loaded();
        for (const route of held.splice(0)) await route.fulfill({ status: 503, contentType: PRIVATE_DAYS_PUBLIC_MEDIA, body: '{"schemaVersion":1,"error":{"code":"unavailable"}}' }).catch(() => undefined);
        await settle(page);
        invariant(await page.locator(".usage-daily table tbody").count() === 2, "Superseded responses must not replace the selected range.");
        let consent: LeaderboardConsentViewV1 = { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null };
        let consentWrites = 0, interruptConsent = true, refuseConsent = false;
        await page.route("**/api/usage/consent", async route => {
          if (route.request().method() === "POST") {
            consentWrites++;
            if (refuseConsent) {
              const bytes = encodeUsageConsentPublicReply({ schemaVersion: 1, error: { code: "publishing_full" } });
              invariant(bytes !== null, "Capacity refusal must pass the public codec.");
              await route.fulfill({ status: 409, headers: { "content-type": USAGE_CONSENT_PUBLIC_MEDIA, "cache-control": "private, no-store" }, body: Buffer.from(bytes) });
              return;
            }
            const decision = route.request().postDataJSON() as { consent: boolean; publicHandle: string | null };
            consent = decision.consent
              ? { schemaVersion: 1, consent: true, consentedAtMs: 1_800_000_000_000, publicHandle: decision.publicHandle }
              : { schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null };
            // The server commits the change, but the response is lost.
            if (interruptConsent) { await route.abort(); return; }
          }
          const bytes = encodeUsageConsentPublicReply({ schemaVersion: 1, state: "ready", value: consent });
          invariant(bytes !== null, "Consent fixture must pass its public codec.");
          await route.fulfill({ status: 200, headers: { "content-type": USAGE_CONSENT_PUBLIC_MEDIA, "cache-control": "private, no-store" }, body: Buffer.from(bytes) });
        });
        await page.reload(); await loaded();
        const consentPanel = page.locator(".usage-consent");
        await consentPanel.getByLabel("Public handle", { exact: true }).fill("browser-check");
        await consentPanel.getByLabel("Publish my handle and numeric usage totals on the public leaderboard.", { exact: true }).check();
        await consentPanel.getByRole("button", { name: "Publish to leaderboard", exact: true }).click();
        await consentPanel.getByRole("button", { name: "Check publishing status", exact: true }).waitFor();
        invariant(consentWrites === 1 && await consentPanel.locator("form").count() === 0, "An uncertain write must require a read before another mutation.");
        await consentPanel.getByRole("button", { name: "Check publishing status", exact: true }).click();
        await consentPanel.getByRole("button", { name: "Withdraw from leaderboard", exact: true }).waitFor();
        invariant(consentWrites === 1, "Consent reconciliation must be read-only.");
        await consentPanel.getByRole("button", { name: "Withdraw from leaderboard", exact: true }).click();
        await consentPanel.getByRole("button", { name: "Check publishing status", exact: true }).click();
        await consentPanel.getByLabel("Public handle", { exact: true }).fill("browser-check");
        await consentPanel.getByLabel("Publish my handle and numeric usage totals on the public leaderboard.", { exact: true }).check();
        interruptConsent = false;
        await consentPanel.getByRole("button", { name: "Publish to leaderboard", exact: true }).click();
        await consentPanel.getByRole("button", { name: "Withdraw from leaderboard", exact: true }).waitFor();
        invariant(Number(consentWrites) === 3, "Publishing must work after reconciling a failed withdrawal.");
        await consentPanel.getByRole("button", { name: "Withdraw from leaderboard", exact: true }).click();
        await consentPanel.getByLabel("Public handle", { exact: true }).fill("browser-check");
        await consentPanel.getByLabel("Publish my handle and numeric usage totals on the public leaderboard.", { exact: true }).check();
        refuseConsent = true;
        await consentPanel.getByRole("button", { name: "Publish to leaderboard", exact: true }).click();
        await consentPanel.getByRole("heading", { name: "The leaderboard is full", exact: true }).waitFor();
        invariant(await consentPanel.locator("form").count() === 0 && Number(consentWrites) === 5, "Capacity refusal must not invite a duplicate publishing attempt.");
        await consentPanel.getByRole("button", { name: "Check publishing status", exact: true }).click();
        await consentPanel.getByLabel("Public handle", { exact: true }).waitFor();
        invariant(Number(consentWrites) === 5, "Checking capacity-refused consent must stay read-only.");
        invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Consent controls must fit the viewport.");
        await verifyRankedLeaderboard(page, baseUrl, name, captureDirectory);
        invariant(failures.length === 0, failures.join("; "));
        invariant(!blockedOrigins.has("https://account.hraness.com") && !blockedOrigins.has("https://usage.aicharts.io"), "Synthetic UI checks must not attempt account or usage-provider access.");
      } finally { await context.close(); }
    }
    await verifyUsagePairing(browser, disabledBaseUrl, baseUrl, captureDirectory);
  } finally {
    server.kill("SIGTERM");
    await Promise.race([server.exited, Bun.sleep(5_000)]);
    if (server.exitCode === null) { server.kill("SIGKILL"); await server.exited; }
  }
  console.log("Usage dashboard: dormant HTTP, exact daily values, states, range ownership and responsive keyboard contracts passed.");
}
