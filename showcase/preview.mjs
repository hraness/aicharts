import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const inputs = [
  "data/releases.json", "data/argo-bench.json",
  "app/globals.css", "components/pareto-chart.tsx", "components/release-explorer.tsx",
  "lib/pareto.ts", "showcase/preview.mjs",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function previewInputs() {
  return Object.fromEntries(await Promise.all(inputs.map(async (path) => [path, sha256(await readFile(path))])));
}

export async function renderPreview(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 480, height: 800 }, colorScheme: "light", reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  try {
    await context.route("**/*", (route) => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(url);
    const chart = page.locator(".pareto-card");
    await chart.locator(".pareto-svg").waitFor();
    await page.waitForFunction(() => document.querySelector(".pareto-svg").width.baseVal.value < 480);
    assert.match(await chart.innerText(), /Argo-Bench/i);
    await page.evaluate(() => document.fonts.ready);
    const top = await chart.evaluate(el => Math.floor(el.getBoundingClientRect().top + scrollY));
    const png = await page.screenshot({ clip: { x: 0, y: top, width: 480, height: 480 }, animations: "disabled" });
    const encoded = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 480;
      canvas.getContext("2d").drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", 0.92);
    }, png.toString("base64"));
    assert.ok(encoded.startsWith("data:image/webp;base64,"));
    const bytes = Buffer.from(encoded.split(",")[1], "base64");
    assert.ok(bytes.length <= 96 * 1024, "Portfolio preview exceeds 96 KiB");
    const record = {
      schemaVersion: 1, product: "aicharts", file: "preview.webp", command: "bun run showcase",
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      pixelWidth: 480, pixelHeight: 480, bytes: bytes.length, sha256: sha256(bytes),
      inputs: await previewInputs(), browser: browser.version(), encoder: "Chromium canvas WebP, quality 0.92",
      alt: "aicharts plotting Argo-Bench scores against cost per task across reasoning settings.",
    };
    await writeFile("showcase/media/preview.webp", bytes);
    await writeFile("showcase/media/preview.json", JSON.stringify(record, null, 2) + "\n");
  } finally {
    await context.close();
  }
}
