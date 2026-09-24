// Isolated synthetic public-platform binding check; no provider token or live fetch.
import { strict as assert } from "node:assert";
import { mock } from "bun:test";
import { decodePrivateDaysHttpRequest, PRIVATE_DAYS_HTTP_URL } from "../../lib/usage/private-days-http-contract";
import type { PrivateDaysTransportDependencies } from "../../lib/usage/private-days-transport";

const contextKey = Symbol.for("@vercel/request-context");
const globals = globalThis as unknown as Record<PropertyKey, unknown>;
const previousContext = Object.getOwnPropertyDescriptor(globals, contextKey), previousFetch = globalThis.fetch;
const events: string[] = [], terminals: Promise<void>[] = [];
let context: unknown = {}, contexts = 0, fetches = 0, registrations = 0, reads = 0, finishes = 0;
let lifetimeAvailable = true, authorityCurrent = true, revokeOnRead = false;
let expectedToken = "a.b.c", expectedAccount = `acct_${"a".repeat(32)}`;
let phase = "import", ok = false;
const request = new Request("https://aicharts.io/usage/me"), range = { firstUtcDay: 0, dayCount: 1 };
const expiresAtMs = Date.now() + 60_000;

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ after(terminal: unknown) {
  registrations++; events.push("register"); assert.ok(terminal instanceof Promise);
  if (!lifetimeAvailable) throw new Error("SYNTHETIC_PRIVATE_CANARY");
  terminals.push(terminal as Promise<void>);
} }));
Object.defineProperty(globals, contextKey, { configurable: true, value: {
  get() { contexts++; events.push("context"); return context; },
} });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetches++; events.push("fetch");
  assert.equal(input, PRIVATE_DAYS_HTTP_URL);
  assert.deepEqual(events, ["context", "register", "session", "read", "fetch"]);
  assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "manual"); assert.equal(init?.credentials, "omit");
  assert.equal(init?.cache, "no-store");
  assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${expectedToken}`);
  assert.ok(init?.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
  assert.deepEqual(decodePrivateDaysHttpRequest(init.body), { schemaVersion: 1, accountId: expectedAccount,
    sessionExpiresAtMs: expiresAtMs, ...range });
  const response = new Response('{"schemaVersion":1,"result":{"ok":false,"error":"not_enrolled"}}', {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  Object.defineProperty(response, "url", { value: input }); return response;
}) as typeof fetch;
async function refused(operation: () => Promise<unknown>) {
  assert.deepEqual(await operation(), { kind: "unavailable" });
}

try {
  // Actual installed @vercel/oidc public helper; only Next lifetime is mocked.
  const { createVercelPrivateDaysTransport } = await import("../../lib/usage/private-days-vercel");
  const { beginUsageAccountSession } = await import("../../lib/usage/auth-server");
  const realBegin: PrivateDaysTransportDependencies["beginSession"] = beginUsageAccountSession;
  assert.equal(typeof realBegin, "function");
  const defaultClient = createVercelPrivateDaysTransport();
  const client = createVercelPrivateDaysTransport(incoming => {
    events.push("session"); assert.equal(incoming, request);
    let open = true;
    return Object.freeze({
      async read() { throw new Error("Legacy accessor must not be used."); },
      async readOutcome() { reads++; events.push("read"); if (revokeOnRead) authorityCurrent = false;
        return Object.freeze({ kind: "authenticated", value: Object.freeze({ suiteAccountId: expectedAccount, expiresAtMs }) }); },
      current() { return open && authorityCurrent; },
      finish() { assert.equal(open, true); open = false; finishes++; },
    });
  }, () => true);
  assert.equal(contexts + fetches + registrations + reads + finishes, 0);
  phase = "request-context-and-fresh-session";
  for (const [token, account] of [["a.b.c", `acct_${"a".repeat(32)}`], ["d.e.f", `acct_${"b".repeat(32)}`]]) {
    expectedToken = token; expectedAccount = account;
    context = { headers: { "x-vercel-oidc-token": token } }; events.length = 0;
    assert.deepEqual(await client(request, range), {
      kind: "query", accountId: account, result: { ok: false, error: "not_enrolled" },
    });
    await terminals.at(-1);
  }
  assert.equal(contexts, 2); assert.equal(fetches, 2); assert.equal(reads, 2); assert.equal(finishes, 2);

  phase = "no-environment-fallback";
  process.env.VERCEL_OIDC_TOKEN = "synthetic.environment.token";
  context = {}; await refused(() => client(request, range));
  assert.equal(fetches, 2); assert.equal(registrations, 2); assert.equal(reads, 2);

  phase = "missing-next-lifetime";
  context = { headers: { "x-vercel-oidc-token": "a.b.c" } }; lifetimeAvailable = false;
  await refused(() => client(request, range)); await Promise.resolve();
  assert.equal(fetches, 2); assert.equal(registrations, 3); assert.equal(reads, 2); assert.equal(finishes, 2);

  phase = "authority-after-live-read";
  lifetimeAvailable = true; revokeOnRead = true; events.length = 0;
  await refused(() => client(request, range)); await terminals.at(-1);
  assert.equal(fetches, 2); assert.equal(reads, 3); assert.equal(finishes, 3);

  phase = "invalid-input-before-context";
  const before = contexts;
  await refused(() => client(request, { ...range, accountId: expectedAccount }));
  assert.equal(contexts, before); assert.equal(fetches, 2);

  phase = "default-auth-disabled";
  // These are synthetic process-local values in the sanitized child. The real
  // auth module is not mocked, and any provider/query fetch would be counted.
  Object.assign(process.env, { AICHARTS_USAGE_AUTH_ENABLED: "0", VERCEL: "1", VERCEL_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://aicharts.io", SUITE_OIDC_COOKIE_SECRET: "synthetic-private-days-cookie-secret-not-for-deployment-0001" });
  context = { headers: { "x-vercel-oidc-token": "a.b.c" } }; events.length = 0;
  await refused(() => defaultClient(request, range)); await terminals.at(-1);
  assert.deepEqual(events, []);
  assert.equal(fetches, 2); assert.equal(reads, 3); assert.equal(finishes, 3); assert.equal(registrations, 4);

  phase = "default-private-read-disabled";
  process.env.AICHARTS_USAGE_AUTH_ENABLED = "1";
  await refused(() => defaultClient(request, range));
  process.env.AICHARTS_USAGE_PRIVATE_READ_ENABLED = "0";
  await refused(() => defaultClient(request, range));
  assert.deepEqual(events, []); assert.equal(registrations, 4); assert.equal(fetches, 2);

  phase = "default-missing-session";
  process.env.AICHARTS_USAGE_PRIVATE_READ_ENABLED = "1";
  assert.deepEqual(await defaultClient(request, range), { kind: "authentication_required" });
  await terminals.at(-1);
  assert.deepEqual(events, ["context", "register"]); assert.equal(registrations, 5); assert.equal(fetches, 2);
  await Promise.all(terminals); ok = true;
} catch { /* Only bounded phase evidence crosses the isolated child boundary. */ }
finally {
  globalThis.fetch = previousFetch;
  if (previousContext === undefined) delete globals[contextKey];
  else Object.defineProperty(globals, contextKey, previousContext);
  delete process.env.VERCEL_OIDC_TOKEN;
  for (const key of ["AICHARTS_USAGE_AUTH_ENABLED", "AICHARTS_USAGE_PRIVATE_READ_ENABLED", "VERCEL", "VERCEL_ENV", "NEXT_PUBLIC_SITE_URL", "SUITE_OIDC_COOKIE_SECRET"]) delete process.env[key];
}
process.stdout.write(JSON.stringify({ ok, phase, fetches, registrations, reads, finishes }));
process.exitCode = ok ? 0 : 1;
