import { access } from "node:fs/promises";
import { join } from "node:path";

import {
  chromium,
  type Browser,
  type Locator,
  type Page,
} from "playwright-core";

const expectedBunVersion = "1.3.14";
const repository = process.cwd();
const hostname = "127.0.0.1";

type FoilEvidence = Readonly<{
  active: boolean;
  angle: string;
  bandColors: readonly string[];
  glintCx: string;
  glintCy: string;
  illuminationDisplay: string;
  lightX: string;
  lightY: string;
  opacities: readonly string[];
  transitionDurations: readonly string[];
}>;

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function cssDurationMilliseconds(value: string): number | null {
  const match = /^((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(ms|s)$/iu.exec(value.trim());
  const numeric = match?.[1];
  const unit = match?.[2];
  if (numeric === undefined || unit === undefined) return null;
  const duration = Number(numeric);
  if (!Number.isFinite(duration) || duration < 0) return null;
  return unit.toLowerCase() === "s" ? duration * 1_000 : duration;
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
  return failures;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

async function openModels(page: Page, baseUrl: string): Promise<Locator> {
  await page.goto(`${baseUrl}/models`, { waitUntil: "domcontentloaded" });
  const frame = page.locator(".model-card-frame").first();
  await frame.waitFor();
  await settle(page);
  return frame;
}

async function verifyChartExport(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { height: 900, width: 1_280 },
  });
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "chart export");
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await settle(page);
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
    invariant(png.readUInt32BE(20) > 1_320, "The chart PNG omitted its branded export header.");
    invariant(failures.length === 0, failures.join("; "));
  } finally {
    await context.close();
  }
}

async function foilEvidence(frame: Locator): Promise<FoilEvidence> {
  return frame.evaluate((root) => {
    if (!(root instanceof HTMLElement)) throw new Error("The foil frame is not an HTML element.");
    const glint = root.querySelector(".model-card-holographic-foil__glint-gradient");
    const illumination = root.querySelector(".model-card-illumination");
    const layers = [
      root.querySelector(".model-card-holographic-foil__metal"),
      root.querySelector(".model-card-holographic-foil__spectrum"),
      root.querySelector(".model-card-holographic-foil__glint"),
    ];
    if (!(glint instanceof SVGElement) || !(illumination instanceof SVGElement)) {
      throw new Error("The holographic SVG is incomplete.");
    }
    if (layers.some(layer => !(layer instanceof SVGElement))) {
      throw new Error("The holographic paint layers are incomplete.");
    }
    const frameStyle = getComputedStyle(root);
    const glintStyle = getComputedStyle(glint);
    return {
      active: root.hasAttribute("data-foil-active"),
      angle: frameStyle.getPropertyValue("--foil-spectrum-angle").trim(),
      bandColors: Array.from(root.querySelectorAll<SVGStopElement>(
        "stop[data-holographic-band]",
      )).map(stop => getComputedStyle(stop).stopColor),
      glintCx: glintStyle.getPropertyValue("cx"),
      glintCy: glintStyle.getPropertyValue("cy"),
      illuminationDisplay: getComputedStyle(illumination).display,
      lightX: frameStyle.getPropertyValue("--foil-light-x").trim(),
      lightY: frameStyle.getPropertyValue("--foil-light-y").trim(),
      opacities: layers.map(layer => getComputedStyle(layer as SVGElement).opacity),
      transitionDurations: layers.map(
        layer => getComputedStyle(layer as SVGElement).transitionDuration,
      ),
    };
  });
}

async function moveInside(page: Page, frame: Locator): Promise<void> {
  await frame.scrollIntoViewIfNeeded();
  const box = await frame.boundingBox();
  invariant(box !== null && box.width > 0 && box.height > 0, "The foil frame has no layout box.");
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.24);
  await settle(page);
}

async function verifyInteractivePointer(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { height: 900, width: 1_280 },
  });
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "interactive");
  try {
    const frame = await openModels(page, baseUrl);
    const initial = await foilEvidence(frame);
    invariant(!initial.active, "The foil frame is active before pointer movement.");
    invariant(initial.bandColors.length === 5, "The holographic spectrum does not expose five bands.");

    await moveInside(page, frame);
    const active = await foilEvidence(frame);
    invariant(active.active, "Fine-pointer movement did not activate the foil frame.");
    invariant(
      active.lightX !== initial.lightX && active.lightY !== initial.lightY,
      `Pointer movement did not move the foil light: ${JSON.stringify({ active, initial })}`,
    );
    invariant(
      active.angle !== initial.angle,
      `Pointer movement did not rotate the spectrum: ${JSON.stringify({ active, initial })}`,
    );
    invariant(
      active.glintCx !== initial.glintCx && active.glintCy !== initial.glintCy,
      `The radial SVG glint did not follow the custom properties: ${JSON.stringify({ active, initial })}`,
    );
    invariant(
      active.bandColors.some((color, index) => color !== initial.bandColors[index]),
      `The SVG spectrum colors did not follow the phase angle: ${JSON.stringify({ active, initial })}`,
    );

    await page.mouse.move(1, 1);
    await settle(page);
    const reset = await foilEvidence(frame);
    invariant(!reset.active, "Pointer exit did not deactivate the foil frame.");
    invariant(
      reset.lightX === initial.lightX
      && reset.lightY === initial.lightY
      && reset.angle === initial.angle,
      `Pointer exit did not restore the deterministic seed pose: ${JSON.stringify({ initial, reset })}`,
    );
    invariant(failures.length === 0, failures.join("; "));
  } finally {
    await context.close();
  }
}

async function verifyReducedMotion(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1_280 },
  });
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "reduced motion");
  try {
    const frame = await openModels(page, baseUrl);
    invariant(
      await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      "Chromium did not activate reduced motion.",
    );
    const initial = await foilEvidence(frame);
    await moveInside(page, frame);
    const moved = await foilEvidence(frame);
    invariant(!moved.active, "Reduced motion allowed pointer-driven foil activation.");
    invariant(
      moved.lightX === initial.lightX
      && moved.lightY === initial.lightY
      && moved.angle === initial.angle,
      `Reduced motion changed the deterministic seed pose: ${JSON.stringify({ initial, moved })}`,
    );
    invariant(
      moved.transitionDurations.every((duration) => {
        const milliseconds = cssDurationMilliseconds(duration);
        // Chromium normalizes a disabled transition to 1e-05s in reduced-motion
        // emulation, which is its effectively-zero computed duration.
        return milliseconds !== null && milliseconds <= 0.01;
      }),
      `Reduced motion retained foil transitions: ${JSON.stringify(moved.transitionDurations)}`,
    );
    invariant(failures.length === 0, failures.join("; "));
  } finally {
    await context.close();
  }
}

async function verifyReducedTransparency(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { height: 900, width: 1_280 },
  });
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "reduced transparency");
  const session = await context.newCDPSession(page);
  try {
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    const frame = await openModels(page, baseUrl);
    invariant(
      await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches),
      "Chromium did not activate reduced transparency.",
    );
    const initial = await foilEvidence(frame);
    invariant(
      JSON.stringify(initial.opacities) === JSON.stringify(["0.44", "0.08", "0.035"]),
      `Reduced transparency produced ${JSON.stringify(initial.opacities)} foil opacities.`,
    );
    await moveInside(page, frame);
    const moved = await foilEvidence(frame);
    invariant(moved.active, "Reduced transparency disabled fine-pointer foil feedback.");
    invariant(
      moved.angle !== initial.angle,
      `Reduced transparency prevented pointer-driven spectrum movement: ${JSON.stringify({ initial, moved })}`,
    );
    invariant(
      JSON.stringify(moved.opacities) === JSON.stringify(initial.opacities),
      `Pointer movement escaped reduced-transparency opacity caps: ${JSON.stringify({ initial, moved })}`,
    );
    invariant(failures.length === 0, failures.join("; "));
  } finally {
    await session.detach();
    await context.close();
  }
}

async function verifyForcedColors(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "dark",
    forcedColors: "active",
    viewport: { height: 900, width: 1_280 },
  });
  const page = await context.newPage();
  const failures = attachDiagnostics(page, "forced colors");
  try {
    const frame = await openModels(page, baseUrl);
    invariant(
      await page.evaluate(() => matchMedia("(forced-colors: active)").matches),
      "Chromium did not activate forced colors.",
    );
    const initial = await foilEvidence(frame);
    invariant(initial.illuminationDisplay === "none", "Forced colors did not hide decorative illumination.");
    await moveInside(page, frame);
    const moved = await foilEvidence(frame);
    invariant(!moved.active, "Forced colors allowed pointer-driven foil activation.");
    invariant(
      moved.lightX === initial.lightX
      && moved.lightY === initial.lightY
      && moved.angle === initial.angle,
      `Forced colors changed the deterministic seed pose: ${JSON.stringify({ initial, moved })}`,
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
  env: { ...process.env, NODE_ENV: "production" },
  stderr: "inherit",
  stdout: "inherit",
});

try {
  await waitForServer(`${baseUrl}/models`, server);
  const browser = await launchFirstAvailableBrowser(executablePaths);
  try {
    await verifyChartExport(browser, baseUrl);
    await verifyInteractivePointer(browser, baseUrl);
    await verifyReducedMotion(browser, baseUrl);
    await verifyReducedTransparency(browser, baseUrl);
    await verifyForcedColors(browser, baseUrl);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
  await Promise.race([server.exited, Bun.sleep(5_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

console.log("Model-card foil browser contract passed.");
