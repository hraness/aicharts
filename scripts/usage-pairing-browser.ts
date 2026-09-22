import { resolve } from "node:path";
import type { Browser, Locator, Page } from "playwright-core";
import { encodePairingDecision, encodePairingPublicReply, PAIRING_PUBLIC_MEDIA, type PairingApproval } from "../lib/usage/pairing-public";

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const intent = "b7".repeat(32), csrf = "c8".repeat(32), account = `acct_${"d9".repeat(16)}`;
async function buttonContrast(button: Locator): Promise<void> {
  const paint = await button.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  const luminance = (color: string) => {
    const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(color);
    invariant(rgb !== null, "Pairing controls must resolve to opaque theme colors.");
    const channels = rgb.slice(1).map(value => Number(value) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
  };
  const levels = [luminance(paint.color), luminance(paint.background)].sort((a, b) => a - b);
  invariant((levels[1]! + .05) / (levels[0]! + .05) >= 4.5, "Pairing decision text must meet 4.5:1 contrast.");
}
async function noRetainedSecrets(page: Page): Promise<void> {
  const persisted = await page.evaluate(() => JSON.stringify({
    url: location.href, cookie: document.cookie,
    local: Object.entries(localStorage), session: Object.entries(sessionStorage),
  }));
  invariant(!persisted.includes(intent) && !persisted.includes(csrf), "Pairing capabilities must not enter URLs, cookies or browser storage.");
}

/** Synthetic UI/navigation evidence; the HTTP/provider authority is tested separately. */
export async function verifyUsagePairing(browser: Browser, disabledBaseUrl: string, baseUrl: string, captureDirectory?: string): Promise<void> {
  const disabled = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await disabled.newPage();
    let effects = 0;
    const origins = new Set<string>();
    await disabled.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://account.hraness.com") {
        // The shared footer's consent and mailing-enrollment calls are
        // production-only and hostname-allowlisted; answer the two boundary
        // routes synthetically while other Accounts access stays blocked.
        if (route.request().method() === "GET" && url.pathname === "/api/consent/region") {
          await route.fulfill({ status: 200, contentType: "application/json", body: '{"region":null,"required":false}' });
          return;
        }
        if (route.request().method() === "POST" && url.pathname === "/api/mailing/experiment") {
          await route.fulfill({ status: 204 });
          return;
        }
      }
      if (url.origin !== disabledBaseUrl) { origins.add(url.origin); await route.abort(); return; }
      if (url.pathname.startsWith("/api/usage/pairing")) effects++;
      await route.continue();
    });
    await page.goto(`${disabledBaseUrl}/usage/pairing#intentId=${intent}`);
    await page.getByRole("heading", { name: "Connect your collector" }).waitFor();
    await page.getByText("Collector connection is unavailable. Local collection still works.", { exact: true }).waitFor();
    await page.waitForFunction(() => location.hash === "");
    invariant(effects === 0, "A disabled pairing page must not contact a pairing endpoint.");
    invariant(!origins.has("https://account.hraness.com") && !origins.has("https://usage.aicharts.io"), "Disabled pairing must not attempt provider requests.");
    invariant(await page.getByRole("button", { name: "Continue with Hraness", exact: true }).count() === 0, "Disabled pairing must expose no start action.");
    await noRetainedSecrets(page);
  } finally { await disabled.close(); }

  for (const [name, width, colorScheme] of [["desktop", 1440, "light"], ["mobile", 390, "dark"]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    let state: PairingApproval["state"] = "pending", expired = false, uncertain = false, reads = 0, decisions = 0, starts = 0;
    const errors: string[] = [], origins = new Set<string>();
    page.on("pageerror", () => errors.push("pairing runtime error"));
    const reply = (): PairingApproval => ({ schemaVersion: 1, state, accountId: account, expiresAtMs: Date.now() + (expired ? -1000 : 120_000), csrfToken: csrf });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      invariant(!request.url().includes(intent) && !request.url().includes(csrf), "Pairing identifiers must not enter request URLs.");
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
      if (url.origin !== baseUrl) { origins.add(url.origin); await route.abort(); return; }
      if (url.pathname === "/api/usage/pairing/start") {
        starts++;
        invariant(request.isNavigationRequest() && request.method() === "POST" && request.postData() === `intentId=${intent}`, "Start must be one canonical native document POST.");
        invariant(request.headers()["content-type"] === "application/x-www-form-urlencoded", "Native start must preserve its fixed form media type.");
        await route.fulfill({ status: 302, headers: { location: "/usage/pairing", "cache-control": "private, no-store" } });
        return;
      }
      if (url.pathname !== "/api/usage/pairing") { await route.continue(); return; }
      invariant(url.search === "", "Approval must not accept an account, intent or capability query.");
      if (request.method() === "GET") {
        reads++;
        invariant(request.postData() === null, "Approval status must have no body.");
      } else {
        decisions++;
        const approve = encodePairingDecision("approve", csrf), deny = encodePairingDecision("deny", csrf);
        invariant(request.method() === "POST" && (request.postData() === approve || request.postData() === deny), "Decision POST must contain only the owned decision and CSRF token.");
        state = request.postData() === approve ? "browser-approved" : "denied";
        if (uncertain) { uncertain = false; await route.abort("failed"); return; }
      }
      const bytes = encodePairingPublicReply(reply());
      invariant(bytes !== null, "Pairing browser fixture must pass the exact public codec.");
      await route.fulfill({ status: 200, headers: { "content-type": PAIRING_PUBLIC_MEDIA, "cache-control": "private, no-store" }, body: Buffer.from(bytes) });
    });
    try {
      await page.goto(`${baseUrl}/usage/pairing#intentId=${intent}`, { waitUntil: "domcontentloaded" });
      const start = page.getByRole("button", { name: "Continue with Hraness", exact: true });
      await start.waitFor();
      await page.waitForFunction(() => location.hash === "");
      invariant(Number(reads) === 0 && Number(starts) === 0 && Number(decisions) === 0, "Loading an intent must not create an authentication attempt or read approval.");
      await noRetainedSecrets(page);
      state = "browser-approved";
      await start.focus(); await page.keyboard.press("Enter");
      const deny = page.getByRole("button", { name: "Deny", exact: true });
      await page.getByText("Approved. Return to your terminal to confirm this account.", { exact: true }).waitFor();
      await deny.waitFor();
      invariant(Number(starts) === 1 && Number(reads) === 1, "A completed native start navigation must perform one approval read.");
      invariant(await page.getByText(account, { exact: true }).count() === 1, "Approval must show the exact checked account.");
      invariant(await page.getByRole("button", { name: "Approve collector", exact: true }).count() === 0, "A sign-in-approved attempt must not offer another approval.");
      invariant(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Pairing must fit the viewport.");
      await page.mouse.move(1, 1); await buttonContrast(deny);
      await deny.hover(); await buttonContrast(deny);
      await page.mouse.move(1, 1);
      await deny.focus();
      invariant(await deny.evaluate(element => element === document.activeElement && getComputedStyle(element).outlineStyle !== "none"), "Pairing decisions need visible keyboard focus.");
      await noRetainedSecrets(page);
      if (captureDirectory !== undefined) await page.screenshot({ path: resolve(captureDirectory, `${name}-pairing.png`), fullPage: true });

      await deny.click();
      await page.getByText("Collector denied.", { exact: true }).waitFor();
      invariant(Number(decisions) === 1, "Deny must send one explicit decision.");

      state = "pending";
      await page.reload();
      const approve = page.getByRole("button", { name: "Approve collector", exact: true });
      await approve.waitFor();
      uncertain = true;
      await approve.click();
      const readback = page.getByRole("button", { name: "Check approval status", exact: true });
      await readback.waitFor();
      invariant(Number(decisions) === 2 && Number(reads) === 2, "An uncertain decision must not retry or claim completion automatically.");
      await readback.click();
      await page.getByText("Approved. Return to your terminal to confirm this account.", { exact: true }).waitFor();
      invariant(Number(decisions) === 2 && Number(reads) === 3, "Explicit readback must reconcile through one GET.");
      invariant(await approve.count() === 0, "A saved browser approval must not offer another approval or claim enrollment.");

      state = "pending"; expired = true;
      await page.reload();
      await page.getByText(/expired/i).first().waitFor();
      invariant(await approve.count() === 0, "Expired approval must not remain actionable.");
      await noRetainedSecrets(page);
      invariant(errors.length === 0, errors.join("; "));
      invariant(!origins.has("https://account.hraness.com") && !origins.has("https://usage.aicharts.io"), "Synthetic pairing browser checks must not reach providers.");
    } finally { await context.close(); }
  }
  console.log("Pairing browser: fragment custody, native start, explicit decisions, uncertain readback and responsive keyboard contracts passed.");
}
