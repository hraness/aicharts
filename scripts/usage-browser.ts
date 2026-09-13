import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser, Locator, Page, Route } from "playwright-core";
import { encodePrivateDaysPublicResponse, parsePrivateDaysPublicSearch, privateDaysPublicStatus,
  PRIVATE_DAYS_PUBLIC_MEDIA, type PrivateDaysPublicReply, type PrivateDaysRange } from "../lib/usage/private-days-public";

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
  for (const text of ["Your AI work, measured without your words.", "Remote sync is not enabled yet.",
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
        invariant(await page.locator(".usage-daily table tbody").first().locator("tr").count() === 2, "Each date must have both provider rows.");
        invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Usage page must fit the viewport.");
        const scroll = page.getByRole("region", { name: "Daily usage, scroll horizontally for all columns" });
        await scroll.focus();
        invariant(await scroll.evaluate(element => element === document.activeElement && getComputedStyle(element).outlineStyle !== "none"), "The table must have a visible keyboard focus ring.");
        if (name === "mobile") {
          await page.keyboard.press("ArrowRight");
          await page.waitForFunction(() => (document.querySelector(".usage-daily__table-scroll")?.scrollLeft ?? 0) > 0);
          await scroll.evaluate(element => element.scrollTo({ left: 0, behavior: "instant" }));
          await page.waitForFunction(() => (document.querySelector(".usage-daily__table-scroll")?.scrollLeft ?? -1) === 0);
        }
        await page.locator("h1").click(); await page.evaluate(() => scrollTo(0, 0));
        if (captureDirectory !== undefined) await page.screenshot({ path: resolve(captureDirectory, `${name}.png`), fullPage: true });

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
        invariant(failures.length === 0, failures.join("; "));
        invariant(!blockedOrigins.has("https://account.hraness.com") && !blockedOrigins.has("https://usage.aicharts.io"), "Synthetic UI checks must not attempt account or usage-provider access.");
      } finally { await context.close(); }
    }
  } finally {
    server.kill("SIGTERM");
    await Promise.race([server.exited, Bun.sleep(5_000)]);
    if (server.exitCode === null) { server.kill("SIGKILL"); await server.exited; }
  }
  console.log("Usage dashboard: dormant HTTP, exact daily values, states, range ownership and responsive keyboard contracts passed.");
}
