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
      await feed
        .locator('[role="option"][aria-selected="true"]')
        .filter({ hasText: whole(name) })
        .waitFor();
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
    await page.getByLabel("Budget", { exact: true }).selectOption("tokens");
    await page.waitForFunction(() =>
      document.querySelector("output").textContent.includes("output tokens"),
    );
    // Picking another model moves the readout to it.
    const guideModel = page.getByLabel("Model", { exact: true });
    const shown = await guideModel.inputValue();
    const [otherSlug, otherName] = await guideModel
      .locator("option")
      .evaluateAll(
        (options, current) =>
          options
            .filter((o) => o.value !== current)
            .map((o) => [o.value, o.textContent])[0],
        shown,
      );
    await guideModel.selectOption(otherSlug);
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
    await page.getByLabel("Budget", { exact: true }).selectOption("tokens");
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
    // The API page documents every object, and its example is real data.
    await page.goto(url + "/api");
    assert.equal(await page.locator("table.data-table--fields").count(), 6);
    const example = JSON.parse(await page.locator("#example ~ pre").textContent());
    assert.ok(releases.some((r) => r.slug === example.slug), "The API example is a release");
    // The reverse order of a comparison redirects to the canonical page.
    const [first, second] = pair.slice("/compare/".length).split("-vs-");
    await page.goto(url + "/compare/" + second + "-vs-" + first);
    assert.equal(new URL(page.url()).pathname, pair);
    // Coding agent pages: the budget control relabels the readout.
    await page.goto(url + "/agents");
    await page.getByLabel("Budget", { exact: true }).selectOption("tokens");
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
    await page.goto(url + "/?release=" + model.slug);
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
      },
      browser: browser.version(),
      encoder: execFileSync("cwebp", ["-version"], { encoding: "utf8" }).trim(),
      alt: "aicharts plotting Terminal-Bench scores against cost per task for Anthropic, OpenAI and Google models.",
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
