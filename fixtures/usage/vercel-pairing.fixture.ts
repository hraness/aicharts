// Isolated synthetic binding check. No provider token, route or live fetch.
import { strict as assert } from "node:assert";
import { mock } from "bun:test";

const contextKey = Symbol.for("@vercel/request-context");
const globals = globalThis as unknown as Record<PropertyKey, unknown>;
const previousContext = Object.getOwnPropertyDescriptor(globals, contextKey);
const previousFetch = globalThis.fetch;
const events: string[] = [];
const terminals: Promise<void>[] = [];
let context: unknown = {};
let contexts = 0;
let fetches = 0;
let registrations = 0;
let lifetimeAvailable = true;
let expectedToken = "a.b.c";
let phase = "import";
let ok = false;

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({
  after(terminal: unknown) {
    registrations++;
    events.push("register");
    assert.ok(terminal instanceof Promise);
    if (!lifetimeAvailable) throw new Error("synthetic-private-lifetime-failure");
    terminals.push(terminal as Promise<void>);
  },
}));

Object.defineProperty(globals, contextKey, { configurable: true, value: {
  get() { contexts++; events.push("context"); return context; },
} });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetches++;
  events.push("fetch");
  assert.equal(input, "https://usage.aicharts.io/internal/pairing");
  assert.deepEqual(events, ["context", "register", "fetch"]);
  assert.equal(init?.method, "POST");
  assert.equal(init?.redirect, "manual");
  assert.equal(init?.credentials, "omit");
  assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${expectedToken}`);
  assert.ok(init?.signal instanceof AbortSignal);
  assert.equal(init.signal.aborted, false);
  const response = new Response('{"schemaVersion":1,"operation":"browserStatus","result":{"ok":false,"error":"not_initialized"}}', {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  Object.defineProperty(response, "url", { value: input });
  return response;
}) as typeof fetch;

const input = { intentId: "11".repeat(32), attemptId: "22".repeat(32), browserNonce: "33".repeat(32), contextToken: "44".repeat(32) };
async function refused(operation: () => Promise<unknown>) {
  let thrown: unknown;
  try { await operation(); } catch (error) { thrown = error; }
  assert.ok(thrown instanceof Error);
  assert.equal(thrown.message, "pairing_transport_unavailable");
  assert.equal(thrown.cause, undefined);
}

try {
  // @vercel/oidc is the real installed public entrypoint, not a copied helper.
  const { createVercelPairingTransport } = await import("../../lib/usage/pairing-vercel");
  const resolve = createVercelPairingTransport();
  const client = resolve(input.intentId);
  assert.equal(contexts + fetches + registrations, 0);
  phase = "request-context-and-lifetime";
  for (const token of ["a.b.c", "d.e.f"]) {
    expectedToken = token;
    context = { headers: { "x-vercel-oidc-token": token } };
    events.length = 0;
    assert.equal(JSON.stringify(await client.browserStatus(input)), '{"ok":false,"error":"not_initialized"}');
    await terminals.at(-1);
  }
  assert.equal(contexts, 2);
  assert.equal(fetches, 2);
  assert.equal(registrations, 2);

  phase = "no-environment-fallback";
  // Only a synthetic process-local canary: no real token is read or supplied.
  process.env.VERCEL_OIDC_TOKEN = "synthetic.environment.token";
  context = {};
  await refused(() => client.browserStatus(input));
  assert.equal(fetches, 2);
  assert.equal(registrations, 2);

  phase = "missing-next-lifetime";
  context = { headers: { "x-vercel-oidc-token": "a.b.c" } };
  lifetimeAvailable = false;
  await refused(() => client.browserStatus(input));
  await Promise.resolve();
  assert.equal(fetches, 2);
  assert.equal(registrations, 3);

  phase = "invalid-input-before-context";
  const before = contexts;
  await refused(() => client.browserStatus({ ...input, intentId: "55".repeat(32) }));
  assert.equal(contexts, before);
  assert.equal(fetches, 2);
  await Promise.all(terminals);
  ok = true;
} catch { /* Only finite phase evidence crosses this child-process boundary. */ }
finally {
  globalThis.fetch = previousFetch;
  if (previousContext === undefined) delete globals[contextKey];
  else Object.defineProperty(globals, contextKey, previousContext);
  delete process.env.VERCEL_OIDC_TOKEN;
}
process.stdout.write(JSON.stringify({ ok, phase, fetches, registrations }));
process.exitCode = ok ? 0 : 1;
