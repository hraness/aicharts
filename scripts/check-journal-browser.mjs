import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";

const capture = process.argv.includes("--preview");
const entries = JSON.parse(await readFile("journal/entries.json", "utf8"));
const { releases } = JSON.parse(await readFile("data/releases.json", "utf8"));
const localHardware = JSON.parse(await readFile("data/local-hardware.json", "utf8"));
for (const file of ["local-hardware-language.json","local-hardware-nonlanguage.json", "local-hardware-iphone-studies.json"]) {
  const extra = JSON.parse(await readFile("data/" + file, "utf8"));
  localHardware.suites.push(...extra.suites);
}
const localBenchmarks = JSON.parse(await readFile("data/local-benchmarks.json", "utf8"));
// A current model with a costed run, so its page draws the chart.
const model = releases.find((r) => !r.deprecated && r.terminalBench?.costPerTaskUsd != null);
assert.ok(model, "Keep a current model with a costed Terminal-Bench run");
// The changelog filter matches title, summary, category and surfaces.
const frontierWebsite = entries.filter(
  (e) =>
    e.surfaces.includes("Website") &&
    [e.title, e.summary, e.category, ...e.surfaces]
      .join(" ")
      .toLowerCase()
      .includes("frontier"),
).length;
assert.ok(frontierWebsite > 0, "Keep a Website changelog entry about the frontier");
const noSideScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function pickCompact(page, label, query, value) {
  await page.getByRole("button", {name:label, exact:true}).click();
  const panel = page.getByRole("dialog", {name:"Choose " + label, exact:true});
  await panel.getByRole("combobox").fill(query);
  await panel.locator("[role=option]").filter({visible:true}).and(page.locator("[data-value=" + JSON.stringify(value) + "]")).click();
}

async function checkFooter(page) {
  const footer = page.getByRole("contentinfo", { name: "Site" });
  assert.equal(
    await footer.getByRole("link", { name: "Coding agents" }).getAttribute("href"),
    "/agents",
  );
  assert.equal(
    await footer.getByRole("link", { name: "API", exact: true }).getAttribute("href"),
    "/api",
  );
  assert.equal(
    await footer.getByRole("link", { name: "Hraness" }).getAttribute("href"),
    "https://hraness.com",
  );
  assert.equal(
    await footer.getByRole("link", { name: "Your Privacy Choices" }).count(),
    1,
  );
}
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "0",
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(Error("Local website did not start")),
      25000,
    );
    server.stdout.on("data", (chunk) => {
      log += chunk;
      const local = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (local) {
        clearTimeout(timer);
        resolve(local[0]);
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error("Next exited with " + code));
    });
  });
  browser = await chromium.launch({
    channel: "chromium",
    args: [
      "--mute-audio",
      "--disable-features=PaintHolding,MacAppCodeSignClone",
    ],
  });
  console.log(
    "Using",
    chromium.executablePath(),
    "Chromium",
    browser.version(),
  );
  for (const [width, colorScheme] of [
    [320, "dark"],
    [960, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 850 },
      colorScheme,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === url
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    await page.goto(url);
    // The favicon and portfolio export must still show the same mark after a redesign.
    if (width === 960) {
      const png = (await readFile("showcase/icon.png")).toString("base64");
      const difference = await page.evaluate(async (encoded) => {
        const favicon = document.querySelector('link[rel~="icon"]').href;
        const mark = document.querySelector(".topbar__brand img");
        if (!mark || new URL(mark.src).pathname !== new URL(favicon).pathname)
          return 255;
        const pixels = async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 64;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, 64, 64);
          return ctx.getImageData(0, 0, 64, 64).data;
        };
        const [svg, raster] = await Promise.all([
          pixels(favicon),
          pixels("data:image/png;base64," + encoded),
        ]);
        return (
          svg.reduce(
            (sum, channel, i) => sum + Math.abs(channel - raster[i]),
            0,
          ) / svg.length
        );
      }, png);
      assert.ok(
        difference < 5,
        "Regenerate the portfolio PNG from the site favicon",
      );
    }

    assert.equal(
      await page
        .getByRole("navigation", { name: "Product pages" })
        .getByRole("link", { name: "Changelog" })
        .getAttribute("href"),
      "/changelog",
    );
    // The explorer has its own header; it links the catalog pages too.
    assert.equal(
      await page
        .getByRole("navigation", { name: "Product pages" })
        .getByRole("link", { name: "Agents" })
        .getAttribute("href"),
      "/agents",
    );
    await checkFooter(page);
    assert.equal(await noSideScroll(page), true);
    const header = page.locator(".topbar");
    assert.equal(await header.getByText(/^(Anthropic|OpenAI|Google|JSON)$/).count(), 0);

    const benchmark = page.getByRole("button", { name: /^Benchmark:/ });
    const benchmarkDialog = page.getByRole("dialog", { name: "Choose a benchmark" });
    const search = benchmarkDialog.getByRole("combobox", { name: "Search benchmarks" });
    const benchmarkOption = (name) => benchmarkDialog.getByRole("option", { name, exact: true });
    const openBenchmark = async () => {
      await benchmark.click();
      await benchmarkDialog.waitFor();
    };
    const chooseBenchmark = async (name) => {
      await openBenchmark();
      await benchmarkOption(name).click();
      await benchmarkDialog.waitFor({ state: "hidden" });
    };
    const chart = (id) => page.locator(`[data-benchmark="${id}"]`);
    const budget = page.getByRole("group", { name: "Budget axis" });
    const waitForParams = (expected) =>
      page.waitForURL(({ searchParams }) =>
        Object.entries(expected).every(([key, value]) => searchParams.get(key) === value),
      );
    await page.getByRole("button", { name: "Benchmark: Argo-Bench", exact: true }).waitFor();
    await openBenchmark();
    assert.equal(await search.evaluate((input) => input === document.activeElement), true);
    assert.equal(await noSideScroll(page), true);
    await search.fill("zzznomatchzzz");
    await benchmarkDialog.getByText(/no (matching benchmarks|benchmarks|results)/i).waitFor();
    assert.equal(await benchmarkDialog.getByRole("option").count(), 0);
    await benchmarkDialog.getByRole("button", { name: /^clear( search)?$/i }).click();
    assert.equal(await search.inputValue(), "");
    await benchmarkOption("Argo-Bench").waitFor();
    await search.press("ArrowDown");
    const highlighted = await search.getAttribute("aria-activedescendant");
    assert.ok(highlighted);
    await search.press("ArrowDown");
    assert.notEqual(await search.getAttribute("aria-activedescendant"), highlighted);
    await search.press("ArrowUp");
    assert.equal(await search.getAttribute("aria-activedescendant"), highlighted);
    await search.press("Escape");
    await benchmarkDialog.waitFor({ state: "hidden" });
    assert.equal(await benchmark.evaluate((button) => button === document.activeElement), true);
    await openBenchmark();
    await page.getByRole("heading", { level: 1 }).click();
    await benchmarkDialog.waitFor({ state: "hidden" });
    const argo = chart("argo-bench");
    assert.equal(await budget.getByRole("button", { name: "Cost", pressed: true }).count(), 1);
    assert.equal(
      await page.locator('.pareto-card a[href="https://arxiv.org/abs/2610.02122"]').count(),
      1,
    );
    for (const provider of ["anthropic", "openai", "google"]) {
      const series = argo.locator(`.peer-series--${provider} polyline, .hero-series--${provider} polyline`);
      assert.ok(await series.count(), `Argo-Bench draws the ${provider} effort series`);
    }
    const settings = page.getByRole("group", { name: "Reasoning settings" });
    assert.ok((await settings.getByRole("button").count()) >= 3);
    const firstEffort = settings.getByRole("button").first();
    await firstEffort.click();
    assert.equal(await firstEffort.getAttribute("aria-pressed"), "true");
    await page.waitForURL(({ searchParams }) => searchParams.has("effort"));
    await budget.getByRole("button", { name: "Tokens" }).click();
    await waitForParams({ bench: "argo-bench", axis: "tokens" });
    assert.match(await argo.locator(".pareto-svg").getAttribute("aria-label"), /output tokens/i);
    await budget.getByRole("button", { name: "Cost" }).click();
    await waitForParams({ bench: null, axis: null });

    // The lineup is the default order. The chart keeps its axes whichever
    // model, order or lab is picked, so siblings compare by position: before
    // the fix, Claude Opus 5.5 and GPT-6.2 Sol (Tier 2, two months apart)
    // drew on different axes in the At release view.
    const ticks = () =>
      page.locator(".chart-tick").evaluateAll((nodes) => nodes.map((n) => n.textContent));
    // "Claude Fable 5" must not match Claude Fable 5.1 or 5.2.
    const whole = (name) =>
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![.\\d])");
    const pick = async (feed, name) => {
      await feed.getByRole("option", { name: whole(name) }).click();
      await feed.getByRole("option", { name: whole(name), selected: true }).waitFor();
      return ticks();
    };
    const lineup = page.getByRole("listbox", { name: "Models by lineup tier" });
    const tier2 = lineup.getByRole("group", { name: "Current Tier 2" });
    const siblings = await tier2
      .getByRole("option")
      .evaluateAll((rows) =>
        rows.map((row) => row.querySelector(".feed-row__name").textContent),
      );
    assert.ok(siblings.length >= 2, "Keep at least two current Tier 2 models");
    const axes = await pick(lineup, siblings[0]);
    assert.ok(axes.length >= 6, "The chart draws its axis ticks");
    for (const name of siblings.slice(1)) {
      assert.deepEqual(await pick(lineup, name), axes, `${name} keeps the axes`);
    }
    await page.getByRole("button", { name: "Releases", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("view"), "releases");
    const byDate = page.getByRole("listbox", { name: "Models by release date" });
    const dates = [...releases].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    for (const name of [...siblings, dates[0].name, dates.at(-1).name]) {
      assert.deepEqual(await pick(byDate, name), axes, `${name} keeps the axes at release`);
    }
    await page.getByRole("tab", { name: "Anthropic", exact: true }).click();
    assert.deepEqual(await ticks(), axes, "The lab filter keeps the axes");
    await page.getByRole("tab", { name: "All", exact: true }).click();
    await page.getByRole("button", { name: "Lineup", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("view"), null);
    assert.equal(await noSideScroll(page), true);

    const astra = "gpt-6-2-astra";
    const modelPage = page.getByRole("link", { name: "Model page", exact: true });
    await page.goto(url + `/?bench=argo-bench&axis=tokens&release=${astra}&effort=medium`);
    await budget.getByRole("button", { name: "Tokens", pressed: true }).waitFor();
    await settings.getByRole("button", { name: /^Medium\b/, pressed: true }).waitFor();
    await waitForParams({ bench: "argo-bench", axis: "tokens", release: astra, effort: "medium" });
    assert.equal(await modelPage.getAttribute("href"), `/models/${astra}`);
    for (const [id, name, minSettings, source] of [
      ["roboflow", "Roboflow Visual Reasoning", 2, "web/benchmark_summary.json"],
      ["ironbee", "IronBee Code Review", 3, "reports/full-r123/configs.csv"],
      ["game-bench", "GameBench 2", 2, "benchmarks.duellab.org/releases/"],
    ]) {
      if (id === "roboflow") {
        await openBenchmark();
        await search.fill("robflw");
        await benchmarkOption(name).waitFor();
        await search.press("ArrowDown");
        await search.press("Enter");
      } else if (id === "ironbee") {
        await openBenchmark();
        await search.fill("pull request");
        await benchmarkDialog.getByRole("option").first().and(benchmarkOption(name)).waitFor();
        await benchmarkOption(name).getByText(/pull requests/i).click();
      } else {
        await chooseBenchmark(name);
      }
      await benchmarkDialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Benchmark: ${name}`, exact: true }).waitFor();
      await chart(id).waitFor();
      await waitForParams({ bench: id, effort: null });
      assert.ok((await settings.getByRole("button").count()) >= minSettings, id);
      assert.equal(await page.locator(`.benchmark-note a[href*="${source}"]`).count(), 1, id);
      if (id === "ironbee") {
        // Astra has no IronBee result. The explorer selects a measured model.
        assert.notEqual(await modelPage.getAttribute("href"), `/models/${astra}`);
      }
      assert.equal(await noSideScroll(page), true);
    }
    assert.equal(await budget.count(), 0);
    await chooseBenchmark("Terminal-Bench");
    await chart("terminal-bench").waitFor();
    await waitForParams({ bench: "terminal-bench" });

    for (const [id, name] of [
      ["mirrorCode", "MirrorCode"],
      ["gpqaDiamond", "GPQA Diamond"],
      ["frontierMath", "FrontierMath Tiers 1–3"],
    ]) {
      await chooseBenchmark(name);
      const scores = page.getByRole("group", { name: name + " best scores" });
      await scores.getByRole("button").first().click();
      assert.equal(await scores.getByRole("button").first().getAttribute("aria-pressed"), "true");
      assert.equal(new URL(page.url()).searchParams.get("bench"), id);
      assert.equal(await noSideScroll(page), true);
    }
    await page.goto(url + "/?axis=tokens");
    await page.locator('[data-benchmark="terminal-bench"]').waitFor();
    await page.getByRole("button", { name: "Benchmark: Terminal-Bench", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Tokens", exact: true }).getAttribute("aria-pressed"), "true");

    await page
      .getByRole("navigation", { name: "Product pages" })
      .getByRole("link", { name: "Blog" })
      .click();
    await page
      .getByRole("button", { name: "Use cookieless analytics" })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "without a cookie" })
      .waitFor();
    await page.locator("[data-pj-evergreen] a").click();
    await page.locator(".guide-chart").waitFor();
    await pickCompact(page,"Budget","Output tokens","tokens");
    await page.waitForFunction(() =>
      document.querySelector("output").textContent.includes("output tokens"),
    );
    // Picking another model moves the readout to it.
    const currentModel = await page.getByRole("button",{name:"Model",exact:true}).getAttribute("data-value");
    const other = releases.find(r => r.slug !== currentModel && r.terminalBench && !r.deprecated);
    const otherName = other.name;
    await pickCompact(page,"Model",otherName,other.slug);
    await page.waitForFunction(
      (name) => document.querySelector(".guide-chart output").textContent.startsWith(name),
      otherName,
    );
    assert.equal(
      await page.locator("figure[data-pj-article-figure] figcaption").count(),
      1,
    );
    assert.equal(
      await page.locator("article > :last-child [data-pj-cta-link]").count(),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.getByRole("link", { name: "Compare models" }).click();
    await page.locator(".pareto-chart-wrap").waitFor();
    await page.goto(url + "/changelog?q=frontier&surface=Website");
    await page.waitForFunction(
      (count) => document.querySelectorAll("[data-pj-entry]").length === count,
      frontierWebsite,
    );
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("searchbox").fill("nonesuch");
    await page.getByText("No matching updates.").waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    assert.ok((await page.locator("[data-pj-entry]").count()) >= 3);
    assert.equal(new URL(page.url()).search, "");

    // Model and comparison pages share the header and footer and never
    // scroll sideways, even with wide tables on a phone.
    await page.goto(url + "/models");
    await page
      .getByRole("link", { name: model.name, exact: true })
      .first()
      .click();
    await page.waitForURL(url + "/models/" + model.slug);
    await page.locator(".catalog-chart .pareto-svg").waitFor();
    await pickCompact(page,"Budget","Output tokens","tokens");
    await page.waitForFunction(() =>
      document.querySelector(".chart-readout").textContent.includes("output tokens"),
    );
    const pair = await page
      .locator('a[href^="/compare/"]')
      .first()
      .getAttribute("href");
    for (const path of [
      "/models",
      "/models/" + model.slug,
      "/compare",
      pair,
      "/api",
      "/local",
    ]) {
      await page.goto(url + path);
      assert.equal(await page.locator("main h1").count(), 1, path);
      assert.equal(
        await page
          .getByRole("navigation", { name: "Product pages" })
          .getByRole("link", { name: "Models" })
          .getAttribute("href"),
        "/models",
      );
      await checkFooter(page);
      assert.equal(await noSideScroll(page), true, path + " scrolls sideways");
    }
    assert.equal(await page.locator("main h1").textContent(), "Local AI benchmarks");
    const matrix = page.getByRole("table",{name:"Speed by workload"});
    await page.addInitScript(() => {
      Object.defineProperty(navigator,"platform",{configurable:true,value:"Linux armv8l"});
      Object.defineProperty(navigator,"userAgent",{configurable:true,value:"Mozilla/5.0 (Linux; Android 15) Chrome"});
      Object.defineProperty(navigator,"userAgentData",{configurable:true,value:{
        platform:"Android",getHighEntropyValues:async () => ({model:"SM-S931U"})
      }});
    });
    await page.reload();
    await matrix.getByRole("columnheader",{name:/Samsung Galaxy S25/}).waitFor();
    assert.match(await page.locator(".hardware-detected").textContent(), /SM-S931U.*reported model/);
    await page.goto(url + "/local?platform=iPhone+%26+iPad&device=iPhone+17+Pro#hardware");
    await matrix.getByRole("columnheader",{name:/iPhone 17 Pro/}).waitFor();
    assert.equal(await matrix.locator("thead th").count(),2);
    await page.getByRole("button",{name:"Remember iPhone 17 Pro on this browser"}).click();
    await page.goto(url + "/local#hardware");
    await matrix.getByRole("columnheader",{name:/iPhone 17 Pro/}).waitFor();
    await page.getByRole("button",{name:"Forget saved device"}).click();
    const taskChip = page.locator(".coverage-tasks button").filter({hasText:"Music generation"});
    await taskChip.click();
    await page.locator(".hardware-browse-results button").first().waitFor();
    await taskChip.click();
    const shortcut = page.locator(".hardware-shortcuts button").first();
    const peerName = await shortcut.textContent();
    await shortcut.click();
    assert.ok((await matrix.locator("thead").textContent()).includes(peerName));
    await page.locator("#hardware-detail > summary").click();
    await pickCompact(page,"Measurement","Mobile","moi/latency");
    await page.getByLabel("Available memory (GiB)", { exact: true }).fill("1");
    assert.ok((await page.locator(".hardware-meta").allTextContents()).some(t => t.includes("over budget")));
    await pickCompact(page,"Device","RTX 4090",JSON.stringify(["NVIDIA GPUs","RTX 4090"]));
    await page.locator("#hardware-detail > summary").click();
    await pickCompact(page,"Measurement","Music generation","ace/latency");
    assert.ok((await page.locator(".hardware-plot").textContent()).includes("1.74 s"));
    const hardwareLink = await page.getByRole("link", { name: "Link to this comparison" }).getAttribute("href");
    await page.goto(url + hardwareLink);
    await page.waitForFunction(() => document.querySelector(".hardware-panel h3")?.textContent === "RTX 4090");
    assert.ok((await page.locator(".hardware-plot").textContent()).includes("1.74 s"));
    await pickCompact(page,"Compare device","One device","");
    assert.equal(await matrix.locator("thead th").count(),2);
    assert.ok(await page.locator("#quality").evaluate(e => !!(e.compareDocumentPosition(document.querySelector("#hardware")) & Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.ok(await page.locator(".local-score-table tbody tr").count() <= 15);
    const overview = localBenchmarks.workloads[0];
    assert.equal(await page.locator(".local-score-table tbody tr").count(),overview.overviewPublishers.length);
    await page.getByRole("button",{name:"See all " + overview.models.length + " checkpoints"}).click();
    assert.equal(await page.locator(".local-score-table tbody tr").count(),15);
    await page.getByRole("button",{name:"Next",exact:true}).click();
    assert.ok((await page.getByRole("navigation",{name:"Model result pages"}).textContent()).includes("16–30"));
    const music = localBenchmarks.workloads.find(g => g.name === "Music generation");
    const alternate = music.comparisons[0];
    await page.getByRole("button",{name:"Benchmark",exact:true}).click();
    const picker = page.getByRole("dialog",{name:"Choose Benchmark",exact:true});
    await picker.getByRole("option",{name:"Music generation",exact:true}).click();
    await picker.getByRole("option",{name:alternate.metric,exact:true}).click();
    await page.getByRole("heading", { name: alternate.metric, exact: true }).waitFor();
    await page.getByText("Sort, filter and compare",{exact:true}).click();
    await pickCompact(page,"Compare with",alternate.models[0].name,alternate.models[0].name);
    await page.getByRole("columnheader", { name: "Difference", exact: true }).waitFor();
    assert.equal(await noSideScroll(page), true);
    const localData = await page.request.get(url + "/api/local");
    assert.equal(localData.status(), 200);
    assert.deepEqual(await localData.json(), { ...localBenchmarks, deviceBenchmarks: localHardware });
    // The API page documents every object, and its example is real data.
    await page.goto(url + "/api");
    assert.equal(await page.locator("table.data-table--fields").count(), 7);
    const example = JSON.parse(await page.locator("#example ~ pre").textContent());
    assert.ok(releases.some((r) => r.slug === example.slug), "The API example is a release");
    // The reverse order of a comparison redirects to the canonical page.
    const [first, second] = pair.slice("/compare/".length).split("-vs-");
    await page.goto(url + "/compare/" + second + "-vs-" + first);
    assert.equal(new URL(page.url()).pathname, pair);
    // Coding agent pages: the budget control relabels the readout.
    await page.goto(url + "/agents");
    await pickCompact(page,"Budget","Output tokens","tokens");
    await page.waitForFunction(() =>
      document.querySelector(".agent-chart .chart-readout").textContent.includes("output tokens"),
    );
    const agentPairs = await page
      .locator('.pair-links a[href^="/agents/"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    assert.ok(agentPairs.length > 0);
    for (const path of ["/agents", ...agentPairs]) {
      await page.goto(url + path);
      assert.equal(await page.locator("main h1").count(), 1, path);
      assert.equal(
        await page
          .getByRole("navigation", { name: "Product pages" })
          .getByRole("link", { name: "Agents" })
          .getAttribute("href"),
        "/agents",
      );
      assert.equal(await page.locator("table.facts tbody tr").first().locator("td").count(), path === "/agents" ? 3 : 2, path);
      await checkFooter(page);
      assert.equal(await noSideScroll(page), true, path + " scrolls sideways");
    }
    // The other order, and Gemini CLI's old name, point to the matchup.
    const [agentA, agentB] = agentPairs[0].slice("/agents/".length).split("-vs-");
    await page.goto(url + "/agents/" + agentB + "-vs-" + agentA);
    assert.equal(new URL(page.url()).pathname, agentPairs[0]);
    const antigravity = agentPairs.find((path) => path.includes("antigravity-cli"));
    if (antigravity) {
      await page.goto(url + antigravity.replace("antigravity-cli", "gemini-cli"));
      assert.equal(new URL(page.url()).pathname, antigravity);
    }
    await context.close();
  }
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const page = await plain.newPage();
  await page.goto(url + "/blog/introducing-aicharts");
  assert.ok(
    await page.getByRole("link", { name: "Compare models" }).isVisible(),
  );
  // Without JavaScript, a model page still draws its chart and hides the controls.
  await page.goto(url + "/models/" + model.slug);
  assert.ok(await page.locator(".catalog-chart .pareto-svg").isVisible());
  assert.equal(await page.locator(".catalog-chart .chart-controls").isVisible(), false);
  assert.ok(await page.locator("table.data-table").first().isVisible());
  // The agent chart also draws without JavaScript.
  await page.goto(url + "/agents");
  assert.ok(await page.locator(".agent-chart .pareto-svg").isVisible());
  assert.equal(await page.locator(".agent-chart .chart-controls").isVisible(), false);
  await page.goto(url + "/local");
  assert.equal(await page.locator(".local-score-table tbody tr").count(), localBenchmarks.workloads[0].overviewPublishers.length);
  await page.getByText("Browse evaluations",{exact:true}).click();
  await page.getByRole("link", { name: "MusicCaps text consistency", exact: true }).click();
  assert.equal(await page.locator(".local-quality h4").textContent(), "MusicCaps text consistency");
  // Addresses from the earlier aicharts.io keep working.
  for (const [from, to] of [
    ["/models/lab/" + model.slug + "/profile", "/models/" + model.slug],
    ["/models/lab/retired-model/profile", "/models"],
    ["/blog/introducing-ai-charts", "/blog/introducing-aicharts"],
    ["/blog/harnesstax-coding-agent-harness", "/agents"],
    ["/calculator", "/models"],
    // The effort pages were retired with the data they compared.
    ["/effort", "/models"],
    ["/effort/xhigh-vs-high", "/models"],
  ]) {
    await page.goto(url + from);
    assert.equal(new URL(page.url()).pathname, to, from);
  }
  // Any website may call the API; the route sends the header itself.
  const api = await fetch(url + "/api/releases");
  assert.equal(api.status, 200);
  assert.equal(api.headers.get("access-control-allow-origin"), "*");
  assert.equal((await api.json()).releases.length, releases.length);
  await plain.close();
  if (capture) {
    const ctx = await browser.newContext({
      viewport: { width: 480, height: 800 },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.locator(".pareto-svg").waitFor();
    await page.waitForFunction(
      () => document.querySelector(".pareto-svg").width.baseVal.value < 480,
    );
    const top = await page
      .locator(".pareto-card")
      .evaluate((el) =>
        Math.floor(el.getBoundingClientRect().top + window.scrollY),
      );
    const tmp = await mkdtemp(join(tmpdir(), "aicharts-preview-"));
    const png = join(tmp, "preview.png");
    await page.screenshot({
      path: png,
      clip: { x: 0, y: top, width: 480, height: 480 },
      animations: "disabled",
    });
    await mkdir("showcase/media", { recursive: true });
    execFileSync("cwebp", [
      "-quiet",
      "-q",
      "90",
      "-m",
      "6",
      "-metadata",
      "none",
      png,
      "-o",
      "showcase/media/preview.webp",
    ]);
    const bytes = await readFile("showcase/media/preview.webp");
    const hash = (input) => createHash("sha256").update(input).digest("hex");
    const record = {
      schemaVersion: 1,
      product: "aicharts",
      file: "preview.webp",
      command: "bun run showcase",
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      pixelWidth: 480,
      pixelHeight: 480,
      bytes: bytes.length,
      sha256: hash(bytes),
      inputs: {
        "data/releases.json": hash(await readFile("data/releases.json")),
        "data/argo-bench.json": hash(await readFile("data/argo-bench.json")),
      },
      browser: browser.version(),
      encoder: execFileSync("cwebp", ["-version"], { encoding: "utf8" }).trim(),
      alt: "aicharts plotting Argo-Bench scores against cost per task across reasoning settings for Anthropic, OpenAI and Google models.",
    };
    await writeFile(
      "showcase/media/preview.json",
      JSON.stringify(record, null, 2) + "\n",
    );
    await ctx.close();
  }
  console.log(
    "Verified the guide, comparison controls, closing action, filters, catalog and coding agent pages, redirects, footer, and mobile layout.",
  );
} finally {
  try {
    await browser?.close();
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
  }
}
