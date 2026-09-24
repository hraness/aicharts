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
    const effectDetails: string[] = [], errorDetails: string[] = [];
    page.on("pageerror", error => {
      errors++;
      if (errorDetails.length < 8) errorDetails.push(`${error.name}: ${error.message.slice(0, 500)}`);
    });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
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
      // Count report effects after the two exact footer stubs above. Footer
      // assignment timing is independent of local report import and never
      // reaches Accounts here; every other external request remains blocked.
      if (interaction && request.method() !== "GET") {
        effects++;
        if (effectDetails.length < 8) effectDetails.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
      if (url.origin !== baseUrl) { await route.abort(); return; }
      if (interaction && url.pathname.startsWith("/api/")) {
        effects++;
        if (effectDetails.length < 8) effectDetails.push(`API ${request.method()} ${url.pathname}`);
      }
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
      const tokenSize = (title: string) => page.locator(".usage-sessions__rich-card")
        .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      await tokenSize("Median token size").getByText("25300", { exact: true }).waitFor();
      await tokenSize("P95 token size").getByText("26900", { exact: true }).waitFor();
      await page.getByLabel("Token quantity", { exact: true }).selectOption("output");
      await tokenSize("Median token size").getByText("2100", { exact: true }).waitFor();
      await tokenSize("Maximum token size").getByText("3000", { exact: true }).waitFor();
      await page.getByLabel("Token quantity", { exact: true }).selectOption("total");
      await page.getByLabel("Show", { exact: true }).selectOption("claude_code");
      invariant(await page.locator(".usage-sessions__table tbody tr").count() === 1, "Provider filtering must change the aggregate scope.");
      await page.getByRole("rowheader", { name: "claude-sonnet-4-6", exact: true }).waitFor();
      await tokenSize("Median token size").getByText("22200", { exact: true }).waitFor();
      await page.getByLabel("Token quantity", { exact: true }).selectOption("reasoning");
      await tokenSize("Median token size").getByText("Unavailable", { exact: true }).waitFor();
      await page.getByLabel("Token quantity", { exact: true }).selectOption("total");
      await page.getByLabel("Show", { exact: true }).selectOption("all");
      await page.locator(".usage-sessions__select").first().click();
      await page.evaluate(async () => { await document.fonts.ready; });
      invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Session page must fit the viewport.");
      const region = page.getByRole("region", { name: "Session list", exact: true });
      await region.focus();
      invariant(await region.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none"), "Session list must have visible keyboard focus.");
      await page.locator("h1").click(); await page.evaluate(() => scrollTo(0, 0));
      if (capture !== undefined) await page.screenshot({ path: resolve(capture, `${name}.png`), fullPage: true });

      const event = (session: typeof SESSION_EXAMPLE.sessions[number], reclaimed: number) => JSON.stringify({
        schema: "gobstopper/compaction-events-v1", ts: Math.floor(session.window.endMs / 1_000),
        provider: session.provider, session_id: session.sessionId, strategy: "context", action: "provider_compact",
        outcome: "applied", trigger_tokens: 200, context_tokens_before: 200, context_tokens_after: 200 - reclaimed,
        est_reclaimed_tokens: reclaimed, items_covered: 1, duration_ms: 10, error_code: null,
      });
      const events = page.locator('input[type="file"][accept=".jsonl,application/x-ndjson"]');
      await events.setInputFiles({ name: "events.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from(`${event(SESSION_EXAMPLE.sessions[0]!, 100)}\n${event(SESSION_EXAMPLE.sessions[1]!, 50)}\ntorn-line`) });
      const applied = page.locator(".usage-sessions__aggregate > div").filter({ has: page.getByText("Compactions applied", { exact: true }) }).locator("dd");
      await page.getByText("1 unrecognized or incomplete event lines were skipped.", { exact: false }).waitFor();
      invariant(await applied.textContent() === "2", "All-session compaction totals must include both matched events.");
      await page.getByLabel("Show", { exact: true }).selectOption("claude_code");
      invariant(await applied.textContent() === "1", "Filtered compaction totals must exclude events outside the selection.");
      const reclaimed = page.locator(".usage-sessions__aggregate > div").filter({ has: page.getByText("Tokens reclaimed", { exact: true }) }).locator("dd");
      invariant(await reclaimed.textContent() === "50", "Reclaimed tokens must follow the selected sessions.");
      await events.setInputFiles({ name: "wrong.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from('{"prompt":"DO_NOT_ECHO_COMPACTION_SOURCE"}') });
      await page.getByRole("alert").filter({ hasText: "valid gobstopper events log" }).waitFor();
      invariant(await applied.textContent() === "1", "Rejected events must preserve the last valid log.");
      invariant(!(await page.locator("body").textContent())?.includes("DO_NOT_ECHO_COMPACTION_SOURCE"), "Rejected compaction content must never be echoed.");
      await page.getByRole("button", { name: "Explore an example", exact: true }).click();
      invariant(await page.getByText("Compactions applied", { exact: true }).count() === 0, "Replacing a report must clear its attached event log.");

      const singleObservation = { ...SESSION_EXAMPLE, sessions: [{ ...SESSION_EXAMPLE.sessions[0],
        source: "history", window: { startMs: 200, endMs: 200 }, spans: [],
        usage: [{ ...SESSION_EXAMPLE.sessions[0]!.usage[0], atMs: 200, inputTokens: 13,
          cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 7, reasoningTokens: null }],
      }] };
      await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
        name: "single-observation.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(singleObservation)),
      });
      await tokenSize("Median token size").getByText("20", { exact: true }).waitFor();
      await tokenSize("Maximum token size").getByText("20", { exact: true }).waitFor();

      const history = { ...SESSION_EXAMPLE, sessions: SESSION_EXAMPLE.sessions.map(s => ({ ...s, source: "history", spans: [] })) };
      await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({ name: "local-report.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(history)) });
      await page.getByText("Local report", { exact: true }).waitFor();
      await page.getByText("History provides token observations.", { exact: false }).waitFor();
      invariant(await page.locator(".usage-sessions__aggregate dd").first().textContent() === "Unknown", "Unmeasured historical inference must not become zero utilization.");
      invariant(await page.getByText("Synthetic example · not your usage", { exact: true }).count() === 0, "Imported report must replace example marker.");
      await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({ name: "rejected.json", mimeType: "application/json", buffer: Buffer.from('{"prompt":"DO_NOT_ECHO_PRIVATE_SOURCE"}') });
      await page.locator('.usage-sessions__notice[role="alert"]').waitFor();
      invariant(!(await page.locator("body").textContent())?.includes("DO_NOT_ECHO_PRIVATE_SOURCE"), "Rejected report must never echo source content.");
      await page.getByRole("button", { name: "Follow a report", exact: true }).click();
      await page.getByText("Following local report · every 3 seconds", { exact: true }).waitFor();
      await page.evaluate(() => { (window as unknown as { sessionReportFixture: { failed: boolean } }).sessionReportFixture.failed = true; });
      await page.getByRole("alert").filter({ hasText: "last valid reading" }).waitFor({ timeout: 8_000 });
      invariant(await page.locator(".usage-sessions__table tbody tr").count() === 2, "A failed watched read must preserve the last valid report with visible stale status.");
      await page.getByRole("button", { name: "Stop following", exact: true }).click();
      invariant(await page.getByRole("button", { name: "Stop following", exact: true }).count() === 0, "Stop must release the watched file.");
      invariant(effects === 0 && errors === 0, `Session ${name}: report import and interaction must have no API effects or browser errors. Effects=${effects} ${JSON.stringify(effectDetails)}; browserErrors=${errors} ${JSON.stringify(errorDetails)}.`);
    } finally { await context.close(); }
  }
}
