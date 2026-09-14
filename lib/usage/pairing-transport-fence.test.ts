import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
const { createPairingTransport } = await import("./pairing-transport");
const intent = "11".repeat(32), input = { intentId: intent, browserNonce: "22".repeat(32) };
const now = 1_800_000_000_000;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
async function tick() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
test("each request fence stops later fetch dispatch at context and registered-work boundaries", async () => {
  for (const phase of ["before", "context", "registration"] as const) {
    let current = phase !== "before", contexts = 0, fetches = 0;
    const terminals: Promise<void>[] = [];
    const resolve = createPairingTransport({ now: () => now, setTimeout, clearTimeout: key => clearTimeout(key as ReturnType<typeof setTimeout>),
      getContext() { contexts++; if (phase === "context") current = false; return { headers: { "x-vercel-oidc-token": "a.b.c" } }; },
      registerLifetime(promise) { terminals.push(promise); if (phase === "registration") current = false; },
      async fetch() { fetches++; throw new Error("PRIVATE_CANARY"); },
    });
    await expect(resolve(intent, () => current).beginBrowserAttempt(input)).rejects.toThrow("pairing_transport_unavailable");
    expect(contexts).toBe(phase === "before" ? 0 : 1); expect(fetches).toBe(0); await Promise.all(terminals);
  }
});
test("separate request fences retain one shared capacity and late response cleanup", async () => {
  const late = deferred<Response>(), terminals: Promise<void>[] = [], timers: Array<() => void> = [];
  let fetches = 0, cancels = 0;
  const resolve = createPairingTransport({ now: () => now, setTimeout(callback) { timers.push(callback); return {}; }, clearTimeout() {},
    getContext: () => ({ headers: { "x-vercel-oidc-token": "a.b.c" } }), registerLifetime(promise) { terminals.push(promise); },
    async fetch() { fetches++; return late.promise; },
  });
  const pending = Array.from({ length: 8 }, () => resolve(intent, () => true).beginBrowserAttempt(input).catch(() => null));
  await tick(); expect(fetches).toBe(8);
  await expect(resolve(intent, () => true).beginBrowserAttempt(input)).rejects.toThrow("pairing_transport_unavailable");
  for (const fire of timers) fire(); await Promise.all(pending);
  await expect(resolve(intent, () => true).beginBrowserAttempt(input)).rejects.toThrow("pairing_transport_unavailable"); expect(fetches).toBe(8);
  late.resolve(new Response(new ReadableStream({ cancel() { cancels++; } }))); await Promise.all(terminals); expect(cancels).toBe(1);
});
