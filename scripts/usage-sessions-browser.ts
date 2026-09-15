import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";
import { SESSION_EXAMPLE } from "../lib/usage/session-example";

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function verifyUsageSessions(browser: Browser, baseUrl: string): Promise<void> {
  const capture = process.env.AICHARTS_SESSIONS_BROWSER_CAPTURE_DIR;
  if (capture !== undefined) await mkdir(resolve(capture), { recursive: true });
  for (const [name, width, colorScheme] of [["desktop", 1440, "light"], ["mobile", 390, "dark"]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.addInitScript(example => {
      const state = { report: example, failed: false };
      Object.assign(window, { sessionReportFixture: state, showOpenFilePicker: async () => [{ getFile: async () => {
        if (state.failed) throw new Error("synthetic_read_failed");
        return new File([JSON.stringify(state.report)], "report.json", { type: "application/json" });
      } }] });
    }, SESSION_EXAMPLE);
    const page = await context.newPage();
    let interaction = false, effects = 0, errors = 0;
    page.on("pageerror", () => errors++);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (interaction && request.method() !== "GET") effects++;
      if (url.origin === "https://account.hraness.com") {
        // The shared footer's consent and mailing-enrollment calls are
        // production-only and hostname-allowlisted; answer the two boundary
        // routes synthetically while other Accounts access stays blocked.
        if (request.method() === "GET" && url.pathname === "/api/consent/region") {
          await route.fulfill({ status: 200, contentType: "application/json", body: '{"region":null,"required":false}' });
          return;
        }
        if (request.method() === "POST" && url.pathname === "/api/mailing/experiment") {
          await route.fulfill({ status: 204 });
          return;
        }
      }
      if (url.origin !== baseUrl) { await route.abort(); return; }
      if (interaction && url.pathname.startsWith("/api/")) effects++;
      await route.continue();
    });
    try {
      await page.goto(`${baseUrl}/usage/sessions`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Your sessions, in detail" }).waitFor();
      invariant(await page.locator('meta[name="robots"]').getAttribute("content").then(v => v?.includes("noindex")), "Local report page must be noindex.");
      invariant(await page.getByRole("heading", { name: "Start with your local measurements" }).count() === 1, "Initial state must not invent usage.");
      interaction = true;
      await page.getByRole("button", { name: "Explore an example" }).click();
      await page.getByText("Synthetic example · not your usage", { exact: true }).waitFor();
      invariant(await page.locator(".usage-sessions__table tbody tr").count() === 2, "Example must have two selectable sessions.");
      await page.getByRole("heading", { name: "Model mix", exact: true }).waitFor();
      invariant(await page.getByRole("rowheader", { name: "gpt-5.5", exact: true }).count() === 1, "Example must expose per-session model mix.");
      await page.getByLabel("Show", { exact: true }).selectOption("claude_code");
      invariant(await page.locator(".usage-sessions__table tbody tr").count() === 1, "Provider filtering must change the aggregate scope.");
      await page.getByRole("rowheader", { name: "claude-sonnet-4-6", exact: true }).waitFor();
      await page.getByLabel("Show", { exact: true }).selectOption("all");
      await page.locator(".usage-sessions__select").first().click();
      await page.evaluate(async () => { await document.fonts.ready; });
      invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Session page must fit the viewport.");
      const region = page.getByRole("region", { name: "Session list", exact: true });
      await region.focus();
      invariant(await region.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none"), "Session list must have visible keyboard focus.");
      await page.locator("h1").click(); await page.evaluate(() => scrollTo(0, 0));
      if (capture !== undefined) await page.screenshot({ path: resolve(capture, `${name}.png`), fullPage: true });

      const history = { ...SESSION_EXAMPLE, sessions: SESSION_EXAMPLE.sessions.map(s => ({ ...s, source: "history", spans: [] })) };
      await page.locator('input[type="file"]').setInputFiles({ name: "local-report.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(history)) });
      await page.getByText("Local report", { exact: true }).waitFor();
      await page.getByText("History provides token observations.", { exact: false }).waitFor();
      invariant(await page.locator(".usage-sessions__aggregate dd").first().textContent() === "Unknown", "Unmeasured historical inference must not become zero utilization.");
      invariant(await page.getByText("Synthetic example · not your usage", { exact: true }).count() === 0, "Imported report must replace example marker.");
      await page.locator('input[type="file"]').setInputFiles({ name: "rejected.json", mimeType: "application/json", buffer: Buffer.from('{"prompt":"DO_NOT_ECHO_PRIVATE_SOURCE"}') });
      await page.locator('.usage-sessions__notice[role="alert"]').waitFor();
      invariant(!(await page.locator("body").textContent())?.includes("DO_NOT_ECHO_PRIVATE_SOURCE"), "Rejected report must never echo source content.");
      await page.getByRole("button", { name: "Follow a report", exact: true }).click();
      await page.getByText("Following local report · every 3 seconds", { exact: true }).waitFor();
      await page.evaluate(() => { (window as unknown as { sessionReportFixture: { failed: boolean } }).sessionReportFixture.failed = true; });
      await page.getByRole("alert").filter({ hasText: "last valid reading" }).waitFor({ timeout: 8_000 });
      invariant(await page.locator(".usage-sessions__table tbody tr").count() === 2, "A failed watched read must preserve the last valid report with visible stale status.");
      await page.getByRole("button", { name: "Stop following", exact: true }).click();
      invariant(await page.getByRole("button", { name: "Stop following", exact: true }).count() === 0, "Stop must release the watched file.");
      invariant(effects === 0 && errors === 0, "Report import and interaction must have no API effects or browser errors.");
    } finally { await context.close(); }
  }
}
