import { access } from "node:fs/promises";
import { join } from "node:path";
import { ATLAS_DATASETS } from "../lib/benchmark-atlas-catalog";
import { verifyUsageDashboard } from "./usage-browser";
import { verifyUsageSessions } from "./usage-sessions-browser";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";

const expectedBunVersion = "1.3.14";
const repository = process.cwd();
const hostname = "127.0.0.1";

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function launchFirstAvailableBrowser(paths: readonly string[]): Promise<Browser> {
  const failures: string[] = [];
  let availableExecutableCount = 0;
  for (const path of paths) {
    try {
      await access(path);
    } catch {
      // Continue through the supported Chromium and Chrome installations.
      continue;
    }

    availableExecutableCount += 1;
    try {
      return await chromium.launch({
        args: ["--no-sandbox"],
        executablePath: path,
        headless: true,
      });
    } catch (error: unknown) {
      failures.push(`${path}: ${errorMessage(error)}`);
    }
  }

  if (availableExecutableCount > 0) {
    throw new Error(
      `No discovered Chromium executable could launch:\n${failures.join("\n")}`,
    );
  }
  throw new Error(
    "No Chromium executable found. Set CHROMIUM_EXECUTABLE_PATH to run the model-card browser contract.",
  );
}

async function reservePort(): Promise<number> {
  const firstPort = 45_000 + (process.pid % 1_000);
  for (let offset = 0; offset < 20; offset += 1) {
    try {
      const port = firstPort + offset;
      const reservation = Bun.serve({
        fetch: () => new Response(null, { status: 204 }),
        hostname,
        port,
      });
      await reservation.stop(true);
      return port;
    } catch (error: unknown) {
      if (offset === 19) throw error;
    }
  }
  throw new Error("No local port was available for the model-card browser contract.");
}

async function waitForServer(url: string, server: Bun.Subprocess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`The production server exited with code ${String(server.exitCode)}.`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await Bun.sleep(250);
  }
  throw new Error("The production server did not become ready within 30 seconds.");
}

function attachDiagnostics(page: Page, label: string): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", error => failures.push(`${label} page: ${error.message}`));
  page.on("requestfailed", request => {
    // Identify the failing resource without logging query capabilities or bodies.
    const url = new URL(request.url());
    console.error(`${label} request: ${request.resourceType()} ${url.origin}${url.pathname} ${request.failure()?.errorText ?? "request-failed"}`);
  });
  page.on("response", response => {
    if (response.status() >= 400) console.error(`${label} response: ${response.status()} ${new URL(response.url()).origin}${new URL(response.url()).pathname}`);
  });
  return failures;
}

// The shared footer progressively enrolls mailing signups and asks Accounts
// whether cookie consent applies. Both calls are production-only and
// hostname-allowlisted, so the loopback verifier answers at the boundary:
// enrollment is declined and consent is reported not required.
async function stubAccountBoundary(context: BrowserContext): Promise<void> {
  await context.route("https://account.hraness.com/**", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/consent/region") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ region: null, required: false }),
      });
    }
    if (request.method() === "POST" && url.pathname === "/api/mailing/experiment") {
      return route.fulfill({ status: 204 });
    }
    return route.abort();
  });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

function boxCenter(box: Readonly<{ height: number; y: number }>): number {
  return box.y + box.height / 2;
}

async function assertCompactPickerAlignment(
  picker: Locator,
  optionName: string,
): Promise<void> {
  const trigger = picker.locator(".option-picker__trigger");
  await trigger.click();
  const option = picker.getByRole("option", { name: optionName, exact: true });
  const pickerBox = await picker.boundingBox();
  const triggerMark = await trigger.locator(".option-picker__leading, .option-picker__chip").first().boundingBox();
  const optionMark = await option.locator(".option-picker__leading, .option-picker__chip").first().boundingBox();
  const triggerText = await trigger.locator(".option-picker__value strong").boundingBox();
  const optionText = await option.locator(".option-picker__copy strong").boundingBox();
  invariant(pickerBox !== null, "The compact picker needs a layout box.");
  invariant(triggerMark !== null && optionMark !== null, "Compact picker rows need a leading icon.");
  invariant(triggerText !== null && optionText !== null, "Compact picker rows need a visible label.");
  const triggerInset = triggerMark.x - pickerBox.x;
  const optionInset = optionMark.x - pickerBox.x;
  invariant(
    Math.abs(triggerInset - optionInset) <= 2,
    `Trigger and list icons must share a left edge (trigger ${triggerInset.toFixed(1)}px, option ${optionInset.toFixed(1)}px).`,
  );
  invariant(
    Math.abs(boxCenter(triggerMark) - boxCenter(triggerText)) <= 3,
    "The closed trigger icon and label must share a vertical center.",
  );
  invariant(
    Math.abs(boxCenter(optionMark) - boxCenter(optionText)) <= 3,
    "Open list icons and labels must share a vertical center.",
  );
  await trigger.click();
}

async function openModels(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(`${baseUrl}/models`, { waitUntil: "domcontentloaded" });
  const card = page.locator(".model-logo-card").first();
  await card.waitFor();
  await settle(page);
  return card;
}

async function verifyChartExport(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { height: 900, width: 1_280 },
  });
  await stubAccountBoundary(context);
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "chart export");
  try {
    await page.goto(`${baseUrl}/coding`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const benchmarkPicker = page.locator(".chart-benchmark-select:visible");
    invariant(await benchmarkPicker.count() === 1, "The coding chart needs exactly one visible benchmark picker.");
    await assertCompactPickerAlignment(benchmarkPicker, "DeepSWE v1.1");
    for (const metric of ["Cost", "Time", "Tokens"] as const) {
      invariant(
        await page.getByRole("radio", { name: metric, exact: true }).locator("svg").count() === 1,
        `The ${metric} compare-by control needs a scannable icon.`,
      );
    }
    const sourceChartHeight = await page.locator(".chart-canvas .benchmark-chart").evaluate((element) => {
      if (!(element instanceof SVGSVGElement)) {
        throw new Error("The coding-agent chart is not an SVG element.");
      }
      return element.viewBox.baseVal.height;
    });
    await page.getByRole("button", { name: "Share and export chart" }).click();
    await page.getByText("Image ready to share.", { exact: true }).waitFor({
      timeout: 30_000,
    });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download PNG" }).click();
    const download = await downloadPromise;
    invariant(download.suggestedFilename().endsWith(".png"), "The chart export did not use a PNG filename.");
    invariant(await download.failure() === null, "The browser failed to save the chart PNG.");
    const stream = await download.createReadStream();
    invariant(stream !== null, "The browser did not expose the chart PNG bytes.");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const png = Buffer.concat(chunks);
    invariant(png.length > 10_000, `The chart PNG was unexpectedly small (${String(png.length)} bytes).`);
    invariant(
      png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "The downloaded chart did not contain a PNG signature.",
    );
    invariant(png.readUInt32BE(16) === 1_440, "The chart PNG width changed from its export contract.");
    invariant(
      png.readUInt32BE(20) > sourceChartHeight,
      "The chart PNG omitted its branded export header.",
    );
    invariant(failures.length === 0, failures.join("; "));
  } finally {
    await context.close();
  }
}

async function verifyBenchmarkAtlas(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({ colorScheme: "light", viewport: { width: 1280, height: 900 } });
  await stubAccountBoundary(context);
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "benchmark atlas");
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await settle(page);
    invariant(await page.locator("#explore").count() === 0, "The default home must not stack a second benchmark workspace below the Pareto chart.");
    invariant(await page.locator(".chart-canvas").count() === 0, "Coding must have its own focused destination rather than another homepage control wall.");
    const pareto = page.locator(".intelligence-efficiency__frontier-line");
    invariant(await pareto.isVisible(), "The original Pareto curve must be visible on a fresh visit, without a disclosure.");
    const paretoPosition = await page.locator(".intelligence-efficiency__svg").boundingBox();
    invariant(paretoPosition !== null && paretoPosition.y < 600, "The Pareto chart must lead the homepage, not be buried below the benchmark library.");
    invariant(await page.locator("#advanced-charts").count() === 0, "Primary Pareto charts must not be hidden as advanced content.");
    const intelligence = page.locator(".intelligence-efficiency");
    invariant((await intelligence.textContent())?.includes("Intelligence Index v4.3"), "The leading Pareto chart must identify the admitted current index version.");
    invariant(await intelligence.locator('[data-intelligence-metric="costUsdPerTask"]').getAttribute("aria-pressed") === "true", "Home must start with interpretable task cost.");
    invariant(await intelligence.locator("select").count() === 0, "The dense model list must not fall back to a native select.");
    const modelPicker = intelligence.locator(".intelligence-efficiency__model-picker");
    const modelTrigger = modelPicker.locator(".option-picker__trigger");
    await modelTrigger.click();
    const modelSearch = modelPicker.getByRole("combobox", { name: "Search model configurations", exact: true });
    invariant(await modelSearch.evaluate(element => element === document.activeElement), "Opening the model picker must focus its search input.");
    const modelChoices = modelPicker.getByRole("option");
    invariant(await modelChoices.count() === await intelligence.locator(".intelligence-efficiency__point-control").count(), "The named picker must include every plotted configuration.");
    invariant(await modelPicker.locator('[aria-selected="true"]').count() === 1, "The picker must mark exactly the pinned configuration as selected.");
    const alternateOption = modelPicker.locator('[role="option"][aria-selected="false"]').first();
    const alternateModel = await alternateOption.getAttribute("title");
    invariant(alternateModel !== null, "The model picker needs an alternative configuration.");
    await modelSearch.fill(alternateModel);
    invariant(await modelChoices.count() < 90, "Search must narrow the dense model grid.");
    await modelSearch.press("Enter");
    invariant(await modelPicker.getByRole("dialog").isHidden(), "Selecting a configuration must close the picker panel.");
    const pickedTitle = await intelligence.locator(".intelligence-efficiency__inspector h3").textContent();
    invariant(pickedTitle === alternateModel, "The named picker did not update the model inspector.");
    const rovingLabel = await intelligence.locator('.intelligence-efficiency__point-control[tabindex="0"]').getAttribute("aria-label");
    invariant(rovingLabel !== null && rovingLabel.startsWith(`${pickedTitle},`), "The named picker and chart keyboard target diverged.");
    await page.setViewportSize({ width: 320, height: 900 });
    await settle(page);
    invariant(await modelTrigger.isVisible(), "The model picker must remain available on narrow screens.");
    invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "The model picker makes the homepage overflow at 320px.");
    const pickerBounds = await modelTrigger.boundingBox();
    invariant(pickerBounds !== null && pickerBounds.height >= 44, "The model picker needs a touch-friendly target.");
    await intelligence.locator('[data-intelligence-metric="outputTokensPerTask"]').click();
    invariant((await modelTrigger.textContent())?.includes(pickedTitle), "Changing the metric lost the named selection on mobile.");
    invariant(await intelligence.locator(".intelligence-efficiency__inspector h3").textContent() === pickedTitle, "Changing the metric lost the selected model inspector on mobile.");
    await intelligence.locator('[data-intelligence-metric="costUsdPerTask"]').click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await settle(page);
    const selectedPoint = intelligence.locator('.intelligence-efficiency__point-control[tabindex="0"]');
    await selectedPoint.focus();
    await selectedPoint.press("ArrowRight");
    await intelligence.locator('.intelligence-efficiency__point-control[tabindex="0"]').press("Enter");
    const selectedConfiguration = await intelligence.locator(".intelligence-efficiency__inspector h3").textContent();
    await intelligence.locator('[data-intelligence-metric="outputTokensPerTask"]').click();
    invariant(await intelligence.locator(".intelligence-efficiency__inspector h3").textContent() === selectedConfiguration, "Switching Pareto axes must preserve the selected configuration.");
    invariant(await pareto.isVisible(), "The Pareto curve disappeared after changing axes.");
    await page.getByLabel("Site").getByRole("link", { name: "Benchmarks", exact: true }).click();
    await page.waitForURL(`${baseUrl}/benchmarks`);
    const atlas = page.locator("#explore");
    invariant(await atlas.locator(".atlas-row").count() === 8, "Default ranking must show eight results, not a wall of labels.");
    await atlas.locator(".atlas-row").nth(1).click();
    const selectedName = await atlas.locator(".atlas-row[aria-pressed=true] strong").textContent();
    invariant(await atlas.locator(".atlas-inspector h3").textContent() === selectedName, "The inspector must identify the selected ranking row.");
    await atlas.getByRole("button", { name: "Add to comparison", exact: true }).click();
    await atlas.locator(".atlas-row").nth(2).click();
    await atlas.getByRole("button", { name: "Add to comparison", exact: true }).click();
    const sharedUrl = page.url();
    invariant(new URL(sharedUrl).searchParams.getAll("atlasCompare").length === 2, "Comparison must persist opaque row IDs independently.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await atlas.getByRole("region", { name: "Compare selected results" }).waitFor();
    invariant(await atlas.locator(".atlas-comparison h4").count() === 2, "Reload lost comparison results.");
    await atlas.getByRole("button", { name: "Cost vs. score", exact: true }).click();
    const point = atlas.locator('.atlas-scatter__point[tabindex="0"]');
    await point.focus();
    await point.press("ArrowRight");
    invariant(await atlas.locator('.atlas-scatter__point[aria-pressed="true"]').count() === 1, "Keyboard inspection must have one selected cost point.");
    invariant(await atlas.locator('.atlas-scatter__point[tabindex="0"]').getAttribute("aria-pressed") === "true", "Cost chart focus and selection diverged.");
    await page.goto(`${baseUrl}/?atlas=aa-intelligence&atlasView=cost`, { waitUntil: "domcontentloaded" });
    invariant(new URL(page.url()).pathname === "/benchmarks", "Legacy atlas links must resolve to the focused benchmark page.");
    await atlas.locator(".atlas-scatter__point").first().waitFor();
    const expectedCosts = ATLAS_DATASETS.find(dataset => dataset.benchmarkId === "aa-intelligence")!.points.filter(point => point.costUsd !== null && point.costUsd > 0).length;
    invariant(await atlas.locator(".atlas-scatter__point").count() === expectedCosts, "Cost view hid lower-effort configurations.");
    await atlas.locator(".atlas-scatter__point").last().focus();
    await atlas.locator(".atlas-scatter__point").last().press("Enter");
    const inspectedId = new URL(page.url()).searchParams.get("atlasPoint");
    invariant(inspectedId !== null, "Cost keyboard selection did not persist its configuration ID.");
    await atlas.getByRole("button", { name: "Ranking", exact: true }).click();
    invariant(new URL(page.url()).searchParams.get("atlasPoint") === inspectedId, "Switching chart view replaced the selected configuration.");
    invariant(await atlas.locator('.atlas-row[aria-pressed="true"]').count() === 1, "Switching to ranking hid the selected low-ranked configuration.");
    await atlas.getByRole("button", { name: "Show top eight", exact: true }).click();
    invariant(await atlas.locator(".atlas-row").count() === 8, "Collapsing results did not restore the top-eight view.");
    const taskPicker = atlas.locator(".atlas-task-select");
    await assertCompactPickerAlignment(taskPicker, "All tasks");
    invariant(
      await atlas.locator(".atlas-row .provider-brand-mark").count() === await atlas.locator(".atlas-row").count(),
      "Ranking rows must show a vendor mark beside the lab name.",
    );
    await taskPicker.locator(".option-picker__trigger").click();
    await taskPicker.getByRole("option", { name: "Memory", exact: true }).click();
    invariant(await atlas.locator(".atlas-row").count() === 6, "Memory comparisons must retain all six systems with the fixed reader.");
    await taskPicker.locator(".option-picker__trigger").click();
    await taskPicker.getByRole("option", { name: "Images", exact: true }).click();
    invariant(await atlas.locator("h2").textContent() === "Image generation · Arena", "Image task did not select its current preference chart.");
    await taskPicker.locator(".option-picker__trigger").click();
    await taskPicker.getByRole("option", { name: "Audio", exact: true }).click();
    invariant((await atlas.locator("h2").textContent())?.includes("Open ASR"), "Audio task must offer the qualified transcription chart.");
    invariant(await atlas.locator(".atlas-row").count() === 8, "Audio chart must show the first eight selected configurations.");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await atlas.getByRole("heading", { name: "Image generation · Arena", exact: true }).waitFor();
    invariant(await atlas.locator("h2").textContent() === "Image generation · Arena", "Back navigation did not restore the benchmark.");
    await page.setViewportSize({ width: 320, height: 900 });
    await settle(page);
    const benchmarkPicker = atlas.locator(".atlas-benchmark-select");
    const benchmarkTrigger = benchmarkPicker.locator(".option-picker__trigger");
    invariant(await benchmarkTrigger.isVisible(), "Mobile benchmark navigation must be named and visible.");
    invariant(await atlas.locator(".atlas-navigation select").count() === 0, "Task and benchmark navigation must use the shared picker, not a native select.");
    await atlas.locator(".atlas-library > summary").click();
    invariant(await atlas.getByLabel("Find a benchmark", { exact: true }).isVisible(), "Mobile search must be available in Browse library.");
    await atlas.locator(".atlas-library > summary").click();
    await benchmarkTrigger.click();
    await benchmarkPicker.getByRole("combobox", { name: "Search benchmarks", exact: true }).fill("GEditBench");
    await benchmarkPicker.getByRole("option").first().click();
    invariant((await atlas.locator("h2").textContent())?.includes("GEditBench"), "Mobile benchmark selector did not change the chart.");
    invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "The page overflows at 320px; chart panning must remain local.");
    await page.emulateMedia({ colorScheme: "dark" });
    await atlas.locator(".atlas-row").first().click();
    invariant(await atlas.locator(".atlas-inspector").isVisible(), "Selected result is unavailable on a narrow dark viewport.");
    const distribution = await page.request.get(`${baseUrl}/data/benchmark-atlas.json`);
    invariant(distribution.ok(), "The benchmark catalog JSON is not available.");
    await page.goto(`${baseUrl}/benchmarks?atlas=deep-swe&atlasView=cost`, { waitUntil: "domcontentloaded" });
    await page.getByText("Costs are measured across the AA coding suite, not separately for each test.", { exact: false }).waitFor();
    await page.goto(`${baseUrl}/?benchmark=aaIndex&compare=costUsd#chart`, { waitUntil: "domcontentloaded" });
    invariant(new URL(page.url()).pathname === "/coding", "Legacy coding selections must resolve to the dedicated coding chart.");
    // A route transition can retain the previous chart in a hidden tree.
    // Wait for the requested chart by its accessible name, not either SVG.
    await page.getByRole("group", { name: "AA Index versus API cost per task", exact: true }).waitFor();
    invariant(await page.getByRole("button", { name: "Share and export chart" }).isVisible(), "Legacy shared chart links no longer reveal the exportable chart.");
    for (const bookmark of [
      { source: "/?benchmark=aaIndex#model-updates", destination: "/coding?benchmark=aaIndex#model-updates", target: "#model-updates", message: "Combined query and section bookmarks must retain their original fragment." },
      { source: "/#chart", destination: "/coding#chart", target: "#chart", message: "Hash-only chart bookmarks must retain their destination." },
      { source: "/#explore", destination: "/benchmarks#explore", target: "#explore", message: "Hash-only benchmark bookmarks must retain their destination." },
    ]) {
      try {
        // Listen before hydration can replace the legacy document. A matching URL
        // observed afterward can precede the destination document's readiness.
        await Promise.all([
          page.waitForURL(`${baseUrl}${bookmark.destination}`, { waitUntil: "domcontentloaded" }),
          page.goto(`${baseUrl}${bookmark.source}`, { waitUntil: "domcontentloaded" }),
        ]);
        await page.locator(bookmark.target).waitFor({ state: "visible" });
        invariant(page.url() === `${baseUrl}${bookmark.destination}`, bookmark.message);
      } catch (cause: unknown) {
        throw new Error(bookmark.message, { cause });
      }
    }
    invariant(failures.length === 0, failures.join("; "));
  } finally {
    await context.close();
  }
}

async function assertLogoCardArtIsolation(page: Page): Promise<void> {
  const isolation = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".model-card-grid .model-logo-card")];
    const measured: Array<{
      art: DOMRect;
      card: DOMRect;
      providerTop: number;
    }> = [];
    const violations: string[] = [];

    for (const [index, card] of cards.entries()) {
      const art = card.querySelector(".model-logo-card__art");
      const provider = card.querySelector(".model-logo-card__provider");
      if (!(art instanceof HTMLElement) || !(provider instanceof HTMLElement)) {
        violations.push(`card ${String(index)} is missing a contained art pill or provider label`);
        continue;
      }
      const cardBox = card.getBoundingClientRect();
      const artBox = art.getBoundingClientRect();
      const providerBox = provider.getBoundingClientRect();
      if (
        artBox.left < cardBox.left - 0.5
        || artBox.right > cardBox.right + 0.5
        || artBox.top < cardBox.top - 0.5
        || artBox.bottom > cardBox.bottom + 0.5
      ) {
        violations.push(`card ${String(index)} art paints outside its card`);
      }
      if (artBox.left < cardBox.left + 8 || artBox.right > cardBox.right - 8) {
        violations.push(`card ${String(index)} art is not inset from the card edges`);
      }
      if (providerBox.top < cardBox.top + 10) {
        violations.push(`card ${String(index)} provider label sits too close to the top edge`);
      }
      measured.push({ art: artBox, card: cardBox, providerTop: providerBox.top });
    }

    const rows: Array<typeof measured> = [];
    for (const item of measured) {
      const row = rows.find(candidate => {
        const first = candidate[0];
        return first !== undefined && Math.abs(first.card.top - item.card.top) < 4;
      });
      if (row === undefined) rows.push([item]);
      else row.push(item);
    }

    for (const row of rows) {
      row.sort((left, right) => left.art.left - right.art.left);
      for (let index = 1; index < row.length; index += 1) {
        const previous = row[index - 1];
        const current = row[index];
        if (previous === undefined || current === undefined) continue;
        const gap = current.art.left - previous.art.right;
        if (gap < 8) {
          violations.push(`art pills in a row overlap or bleed (gap ${gap.toFixed(1)}px)`);
        }
      }
    }

    return {
      cardCount: cards.length,
      rowCount: rows.length,
      lastRowCount: rows.at(-1)?.length ?? 0,
      violations,
    };
  });

  invariant(isolation.cardCount > 1, "The gallery needs more than one logo card to test row isolation.");
  invariant(isolation.rowCount > 1, "The gallery did not wrap into more than one card row at 1280px.");
  invariant(isolation.lastRowCount > 1, "The last gallery row needs multiple cards to catch cross-card art bleed.");
  invariant(
    isolation.violations.length === 0,
    isolation.violations.join("; "),
  );
}

async function verifyModelLogoCards(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { height: 900, width: 1_280 },
  });
  await stubAccountBoundary(context);
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "model logo cards");
  try {
    const card = await openModels(page, baseUrl);
    const box = await card.boundingBox();
    invariant(box !== null && box.width > 0 && box.height > 0, "The logo card has no layout box.");
    invariant(Math.abs(box.width - box.height) < 2, "Gallery logo cards must stay square.");
    invariant(
      await page.locator(".model-logo-card").count() > 0,
      "The gallery did not render square logo cards.",
    );
    invariant(
      await page.locator(".model-card-frame, .model-card-holographic-foil, .model-card-illumination").count() === 0,
      "Foil or illumination chrome remains on the gallery.",
    );
    await assertLogoCardArtIsolation(page);
    const mimo = page.getByRole("link", { name: /MiMo-V2\.6-Pro/u });
    await mimo.click();
    await page.waitForURL("**/models/xiaomi/mimo-v2-6-pro/index");
    invariant(
      await page.getByRole("heading", { name: "Notes from X" }).isVisible(),
      "The MiMo page did not surface curated commentary.",
    );
    invariant(failures.length === 0, failures.join("; "));
  } finally {
    await context.close();
  }
}

invariant(Bun.version === expectedBunVersion, `Expected Bun ${expectedBunVersion}; received ${Bun.version}.`);
await access(join(repository, ".next", "BUILD_ID"));
const executablePaths = [
  ...(process.env.CHROMIUM_EXECUTABLE_PATH === undefined
    ? []
    : [process.env.CHROMIUM_EXECUTABLE_PATH]),
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
] as const;
const port = await reservePort();
const baseUrl = `http://${hostname}:${String(port)}`;
const server = Bun.spawn([
  process.execPath,
  "run",
  "start",
  "--",
  "--hostname",
  hostname,
  "--port",
  String(port),
], {
  cwd: repository,
  env: { ...process.env, NODE_ENV: "production", AICHARTS_USAGE_AUTH_ENABLED: "0", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "0" },
  stderr: "inherit",
  stdout: "inherit",
});

try {
  await waitForServer(`${baseUrl}/models`, server);
  const browser = await launchFirstAvailableBrowser(executablePaths);
  try {
    await verifyBenchmarkAtlas(browser, baseUrl);
    await verifyChartExport(browser, baseUrl);
    await verifyModelLogoCards(browser, baseUrl);
    await verifyUsageDashboard(browser, baseUrl, repository, hostname, await reservePort());
    await verifyUsageSessions(browser, baseUrl);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
  await Promise.race([server.exited, Bun.sleep(5_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

console.log("Benchmark atlas, chart export, and model logo-card browser contracts passed.");
