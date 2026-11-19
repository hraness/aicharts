import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";

const capture = process.argv.includes("--preview");
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
    assert.equal(
      await page
        .getByRole("navigation", { name: "Product pages" })
        .getByRole("link", { name: "Changelog" })
        .getAttribute("href"),
      "/changelog",
    );
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
    await page.getByLabel("Effort", { exact: true }).selectOption({ index: 1 });
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
      () => document.querySelectorAll("[data-pj-entry]").length === 1,
    );
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("searchbox").fill("nonesuch");
    await page.getByText("No matching updates.").waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    assert.ok((await page.locator("[data-pj-entry]").count()) >= 3);
    assert.equal(new URL(page.url()).search, "");
    await context.close();
  }
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const page = await plain.newPage();
  await page.goto(url + "/blog/introducing-aicharts");
  assert.ok(
    await page.getByRole("link", { name: "Compare models" }).isVisible(),
  );
  await plain.close();
  if (capture) {
    const ctx = await browser.newContext({
      viewport: { width: 480, height: 800 },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto(url + "/?release=gemini-4-neon");
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
      alt: "aicharts comparing coding benchmark scores with cost per task at several reasoning effort settings.",
    };
    await writeFile(
      "showcase/media/preview.json",
      JSON.stringify(record, null, 2) + "\n",
    );
    await ctx.close();
  }
  console.log(
    "Verified the guide, comparison controls, closing action, filters, and mobile layout.",
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
