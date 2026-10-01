import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { ownedChromiumOptions } from "./owned-chromium.mjs";
import { waitForPublicPage } from "./public-page-readiness.mjs";
import { verifyPublicPageReadiness } from "./public-page-readiness.fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const production = process.argv.includes("--production");
assert.ok(process.argv.slice(2).every(argument => argument === "--production"), "Unknown argument");
const config = JSON.parse(await readFile(resolve(root, "scripts/public-site-browser.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(root, ".next/prerender-manifest.json"), "utf8"));
const allowed = route => config.prefixes.some(prefix => prefix === "*" || route === prefix || (prefix !== "/" && route.startsWith(prefix + "/")));
// Prerendered route handlers (downloads such as /data/benchmark-atlas/<id>) have no RSC data route.
const routes = [...new Set([...config.routes, ...Object.keys(manifest.routes).filter(route => allowed(route) && manifest.routes[route].dataRoute !== null && !route.includes("[") && !route.startsWith("/_") && !route.startsWith("/api/") && !/\.[a-z0-9]+$/iu.test(route) && !/\/(opengraph-image|twitter-image|icon|apple-icon)(\/|$)/u.test(route))])].sort();
assert.ok(routes.includes("/") && routes.every(route => route.startsWith("/") && !route.startsWith("//")), "Invalid public route inventory");
assert.ok(routes.length <= 2500, "Unexpectedly large public route inventory");
const artifacts = resolve(process.env.SITE_BROWSER_ARTIFACTS ?? "/tmp/public-site-browser");
await mkdir(artifacts, { recursive: true });
let origin = config.origin;
assert.match(origin, /^https:\/\/[a-z0-9.-]+$/u);
let server;
let exited;
let output = "";
let browser;
const results = [];
let failure;
const contextPool = Math.max(1, Math.min(6, Number(process.env.SITE_BROWSER_CONTEXTS ?? 3) || 3));
try {
  if (!production) {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolveClose, reject) => reservation.close(error => error ? reject(error) : resolveClose()));
    origin = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    exited = new Promise((resolveExit, reject) => { server.once("exit", resolveExit); server.once("error", reject); });
    // Keep diagnostics bounded while draining both pipes.
    for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-32_768); });
    const deadline = Date.now() + 45_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Next exited: ${output}`);
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(2_000) })).ok) { ready = true; break; } } catch { /* Wait for our server to bind. */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    assert.ok(ready, `Next did not become ready: ${output}`);
  }
  const owned = ownedChromiumOptions(await browserExecutable());
  browser = await chromium.launch(owned);
  console.log(`Owned Chromium: ${owned.executablePath} (${browser.version()})`);
  await verifyPublicPageReadiness(browser);
  // Contexts are isolated and share only the server, so a small pool of them runs at once.
  // Each combination records its own results; they are joined in the fixed combination order.
  const combinations = [360, 390, 1440].flatMap(width => ["light", "dark"].map(theme => ({ width, theme })));
  const perCombination = combinations.map(() => []);
  let next = 0;
  const lane = async () => {
    while (!failure && next < combinations.length) {
      const index = next++;
      try { await verifyCombination(combinations[index], perCombination[index]); } catch (error) { failure ??= error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(contextPool, combinations.length) }, lane));
  results.push(...perCombination.flat());
  if (failure) throw failure;
} catch (error) {
  failure ??= error;
} finally {
  try { await browser?.close(); }
  finally {
    if (server) {
      if (server.exitCode === null && server.signalCode === null) server.kill("SIGTERM");
      const timer = setTimeout(() => { if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL"); }, 5_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
}
await writeFile(resolve(artifacts, "results.json"), JSON.stringify({ passed: !failure, failure: failure?.message ?? null, origin, production, source: process.env.GITHUB_SHA ?? null, capturedAt: new Date().toISOString(), cleanup: "browser and owned server closed", results }, null, 2) + "\n");
if (failure) throw failure;
console.log(`Verified ${results.length} route/viewport/theme combinations at ${origin}.`);

/** Prefer an explicit test browser or the Chromium pinned by this app. */
async function browserExecutable() {
  const candidates = [process.env.CHROMIUM_EXECUTABLE_PATH, chromium.executablePath()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ }
  }
  throw new Error("No pinned Chromium executable found; provision this app's Playwright browser.");
}

async function verifyCombination({ width, theme }, results) {
  const context = await browser.newContext({ viewport: { width, height: width === 360 ? 740 : width === 390 ? 844 : 900 }, colorScheme: theme, hasTouch: width < 600 });
  try {
    const page = await context.newPage();
    const errors = [];
    const signedOutUsage = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      // Signed out, the live usage dashboard's own session-bound API answers 401.
      // Record that exact response; every other console error still fails.
      const source = message.location().url ?? "";
      if (production && message.text() === "Failed to load resource: the server responded with a status of 401 ()" && source.startsWith(`${origin}/api/usage/`)) signedOutUsage.push(source);
      else errors.push(message.text());
    });
    for (const route of routes) {
      if (failure) return;
      const response = await page.goto(origin + route);
      assert.equal(response?.status(), 200, route);
      await waitForPublicPage(page, { minimal: config.minimalRoutes?.includes(route) ?? false });
      await page.evaluate(() => document.fonts.ready);
      const state = await page.evaluate(() => {
        const footer = document.querySelector("#hraness-site-footer");
        return {
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector("main")?.getBoundingClientRect().right ?? 0) > innerWidth + 1,
          viewportWidth: innerWidth,
          bodyWidth: document.body.scrollWidth,
          heading: document.querySelector("h1")?.textContent?.trim(),
          theme: document.documentElement.dataset.theme,
          footerPositions: [footer, footer?.querySelector(".hraness-site-footer__inner")].map(element => element ? getComputedStyle(element).position : null),
          smallHeaderTargets: innerWidth > 600 ? [] : [...document.querySelectorAll("header a, header button, header summary")].filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5); }).map(element => ({ label: element.textContent?.trim() || element.getAttribute("aria-label"), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
        };
      });
      const name = `${width}-${theme}-${route === "/" ? "home" : route.slice(1).replaceAll("/", "_")}`;
      const screenshot = await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true, animations: "disabled" });
      const screenshotWidth = screenshot.readUInt32BE(16);
      await writeFile(resolve(artifacts, `${name}.json`), JSON.stringify({ route, state, screenshotWidth, errors, signedOutUsage }, null, 2));
      assert.equal(screenshotWidth, width, `${route}: full-page screenshot width`);
      assert.ok(!state.overflow, `${route}: horizontal overflow at ${width}`);
      assert.ok(state.heading || config.minimalRoutes?.includes(route), `${route}: missing heading`);
      assert.equal(state.theme, config.forcedTheme ?? theme, `${route}: system appearance`);
      assert.ok(state.footerPositions.every(position => position === null || position === "static" || position === "relative"), `${route}: footer not in normal flow`);
      assert.ok(state.footerPositions[0] || config.minimalRoutes?.includes(route), `${route}: footer missing`);
      assert.deepEqual(state.smallHeaderTargets, [], `${route}: phone targets below 44px`);
      assert.deepEqual(errors, [], `${route}: browser errors`);
      results.push({ route, width, theme });
    }
    await page.goto(origin);
    const targetTheme = config.forcedTheme ?? (theme === "light" ? "dark" : "light");
    if (config.appearance !== "forced") {
      const trigger = config.appearance === "palette" ? "summary" : "button";
      await page.locator(`[data-hraness-appearance-menu][data-ready="true"] ${trigger}`).first().click();
      await page.getByRole(config.appearance === "palette" ? "radio" : "menuitemradio", { name: new RegExp(`^${targetTheme}$`, "iu") }).click();
    }
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, targetTheme);
    await page.reload();
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, targetTheme);
    const destination = await page.locator('header a[href^="/"]').evaluateAll(links => links.map(link => link.getAttribute("href")).find(href => href !== "/" && !href.startsWith("//")));
    assert.ok(destination, "Header has no internal navigation link");
    await page.locator(`header a[href=${JSON.stringify(destination)}]`).first().click();
    await page.waitForURL(url => url.pathname === new URL(destination, origin).pathname);
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, targetTheme);
    assert.deepEqual(errors, [], "Browser errors after appearance and navigation");
  } finally { await context.close(); }
}
