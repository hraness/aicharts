// Isolated synthetic default composition: no live Accounts or Cloudflare call.
import { strict as assert } from "node:assert";
import { mock } from "bun:test";
const key = Symbol.for("@vercel/request-context"), globals = globalThis as unknown as Record<PropertyKey, unknown>;
const savedContext = Object.getOwnPropertyDescriptor(globals, key), savedFetch = globalThis.fetch;
const terminals: Promise<void>[] = [];
let contexts = 0, fetches = 0, registrations = 0, phase = "import", ok = false;
let onContext = () => {}, onRegistration = () => {};
mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ after(promise: Promise<void>) { registrations++; terminals.push(promise); onRegistration(); } }));
Object.defineProperty(globals, key, { configurable: true, value: { get() {
  contexts++; onContext(); return { headers: { "x-vercel-oidc-token": "synthetic.oidc.token" } };
} } });
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  fetches++; assert.equal(url, "https://usage.aicharts.io/internal/pairing"); assert.equal(init?.method, "POST");
  const body = new TextDecoder().decode(init?.body as Uint8Array); assert.ok(body.includes('"operation":"beginBrowserAttempt"'));
  const response = new Response('{"schemaVersion":1,"operation":"beginBrowserAttempt","result":{"ok":false,"error":"not_initialized"}}', {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  Object.defineProperty(response, "url", { value: url }); return response;
}) as typeof fetch;
const base = { AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PAIRING_ENABLED: "1", VERCEL: "1", VERCEL_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://aicharts.io", SUITE_OIDC_COOKIE_SECRET: "synthetic-private-cookie-secret-32-bytes" };
function configure(change: Record<string, string> = {}) { Object.assign(process.env, base, change); }
function request(signal?: AbortSignal) {
  return new Request("https://aicharts.io/api/usage/pairing/start", { method: "POST", signal,
    headers: { origin: "https://aicharts.io", "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" }, body: `intentId=${"11".repeat(32)}` });
}
try {
  const { handleUsagePairingStart, handleUsagePairingApproval, usagePairingAvailable } = await import("./pairing-route");
  phase = "closed-defaults";
  const closedConfigurations: Readonly<Record<string, string>>[] = [{ AICHARTS_USAGE_PAIRING_ENABLED: "0" }, { AICHARTS_USAGE_AUTH_ENABLED: "0" }, { VERCEL_ENV: "preview" }];
  for (const change of closedConfigurations) {
    configure(change); assert.equal(usagePairingAvailable(), false);
    assert.equal((await handleUsagePairingStart(request())).status, 503);
    assert.equal((await handleUsagePairingApproval(new Request("https://aicharts.io/api/usage/pairing", { headers: { "sec-fetch-site": "same-origin" } }))).status, 503);
  }
  assert.equal(contexts + fetches + registrations, 0);
  phase = "context-closure";
  // The installed public helper is synchronous. Its return can observe a closed
  // request; the operation must check again before its registered microtask.
  for (const mode of ["flag", "secret", "abort"] as const) {
    configure(); const controller = new AbortController();
    onContext = () => { if (mode === "abort") controller.abort(); else if (mode === "flag") process.env.AICHARTS_USAGE_PAIRING_ENABLED = "0";
      else process.env.SUITE_OIDC_COOKIE_SECRET = `${base.SUITE_OIDC_COOKIE_SECRET}-rotated`; };
    assert.equal((await handleUsagePairingStart(request(controller.signal))).status, 503); await Promise.all(terminals);
  }
  assert.equal(contexts, 3); assert.equal(fetches, 0);
  phase = "registered-microtask-closure";
  configure(); onContext = () => {};
  onRegistration = () => { if (contexts === 4) process.env.AICHARTS_USAGE_PAIRING_ENABLED = "0"; };
  assert.equal((await handleUsagePairingStart(request())).status, 503); await Promise.all(terminals);
  assert.equal(contexts, 4); assert.equal(fetches, 0);
  phase = "guarded-public-binding";
  configure(); onRegistration = () => {};
  assert.equal((await handleUsagePairingStart(request())).status, 503); await Promise.all(terminals);
  assert.equal(contexts, 5); assert.equal(fetches, 1); ok = true;
} catch { /* Output only fixed phase and counters, never SDK input or errors. */ }
finally {
  globalThis.fetch = savedFetch;
  if (savedContext) Object.defineProperty(globals, key, savedContext); else Reflect.deleteProperty(globals, key);
}
process.stdout.write(JSON.stringify({ ok, phase, contexts, fetches }));
if (!ok) process.exitCode = 1;
