import { expect, test } from "bun:test";
import { createPairingController, requestPairing, type PairingBrowser } from "./client";
import { encodePairingPublicReply, PAIRING_PUBLIC_MEDIA, type PairingApproval, type PairingPublicReply } from "@/lib/usage/pairing-public";

const now = 1_800_000_000_000, intent = "11".repeat(32), token = "22".repeat(32);
const reply: PairingApproval = { schemaVersion: 1, state: "pending", accountId: `acct_${"33".repeat(16)}`, expiresAtMs: now + 60_000, csrfToken: token };
function response(value: PairingPublicReply = reply, status = 200, headers: HeadersInit = {}) {
  return new Response(encodePairingPublicReply(value), { status, headers: { "content-type": PAIRING_PUBLIC_MEDIA, ...headers } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
async function tick() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
function browser(fragment = "", request?: PairingBrowser["request"]) {
  const calls: Array<{ signal: AbortSignal; decision: Parameters<PairingBrowser["request"]>[1] }> = [], events: string[] = [];
  const timers = new Map<object, { run(): void; end: number }>(); let time = now;
  return { calls, events, effects: {
    takeFragment() { events.push("scrub"); return fragment; }, now: () => time,
    async request(signal, decision) { events.push("request"); calls.push({ signal, decision }); return request ? request(signal, decision) : reply; },
    later(run, ms) { const handle = {}; timers.set(handle, { run, end: time + ms }); return handle; }, clear(handle) { timers.delete(handle as object); },
  } satisfies PairingBrowser,
  advance(ms: number) { time += ms; for (const [key, timer] of [...timers]) if (timer.end <= time) { timers.delete(key); timer.run(); } },
  time(value: number) { time = value; } };
}

test("the browser sends only the fixed same-origin GET or exact decision, never the intent/account", async () => {
  const controller = new AbortController(); let calls = 0;
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(url).toBe("/api/usage/pairing"); expect(init?.signal).toBe(controller.signal); expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("same-origin"); expect(init?.redirect).toBe("error");
    if (calls++ === 0) { expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined(); }
    else { expect(init?.method).toBe("POST"); expect(init?.body).toBe(`{"decision":"approve","csrfToken":"${token}"}`); }
    return response();
  });
  expect(await requestPairing(controller.signal, undefined, fetcher)).toEqual(reply);
  expect(await requestPairing(controller.signal, { decision: "approve", csrfToken: token }, fetcher)).toEqual(reply); expect(calls).toBe(2);
});

test("response framing, schema and status failures are fixed and never retried", async () => {
  for (const create of [() => response(reply, 403), () => response(reply, 200, { "content-type": "text/html" }),
    () => response(reply, 200, { "content-length": "01" }), () => response(reply, 200, { "content-length": "1" }),
    () => response(reply, 200, { location: "/PRIVATE_CANARY" }), () => new Response("PRIVATE_CANARY", { headers: { "content-type": PAIRING_PUBLIC_MEDIA } }),
    () => new Response("x".repeat(513), { headers: { "content-type": PAIRING_PUBLIC_MEDIA } })]) {
    let calls = 0;
    await expect(requestPairing(new AbortController().signal, undefined, async () => { calls++; return create(); })).rejects.toThrow("pairing_unavailable");
    expect(calls).toBe(1);
  }
});

test("decoded bytes stay bounded independently of compressed Content-Length", async () => {
  expect(await requestPairing(new AbortController().signal, undefined, async () => response(reply, 200, { "content-encoding": "gzip", "content-length": "3" }))).toEqual(reply);
  let cancelled = 0, pulls = 0;
  const streamed = () => new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array()); }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { headers: { "content-type": PAIRING_PUBLIC_MEDIA } });
  await expect(requestPairing(new AbortController().signal, undefined, async () => streamed())).rejects.toThrow("pairing_unavailable");
  expect(pulls).toBe(513); expect(cancelled).toBe(1);
});

test("an already-aborted or malformed decision cannot reach fetch; a late response is discarded", async () => {
  const controller = new AbortController(); controller.abort(); let fetches = 0;
  const fetcher = async () => { fetches++; return response(); };
  await expect(requestPairing(controller.signal, undefined, fetcher)).rejects.toThrow("pairing_unavailable");
  await expect(requestPairing(new AbortController().signal, { decision: "approve", csrfToken: "PRIVATE_CANARY" }, fetcher)).rejects.toThrow("pairing_unavailable");
  expect(fetches).toBe(0);
  let cancelled = 0; const active = new AbortController();
  await expect(requestPairing(active.signal, undefined, async () => {
    active.abort(); return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": PAIRING_PUBLIC_MEDIA } });
  })).rejects.toThrow("pairing_unavailable");
  expect(cancelled).toBe(1);
});

test("construction is effect-free and every fragment is scrubbed even when availability is closed", () => {
  for (const available of [false, true]) for (const fragment of [`#intentId=${intent}`, "#PRIVATE_CANARY"]) {
    const b = browser(fragment), client = createPairingController(available, b.effects);
    expect(b.events).toEqual([]); const unmount = client.mount();
    expect(b.events).toEqual(["scrub"]); expect(b.calls).toHaveLength(0);
    expect(client.snapshot().kind).toBe(!available ? "disabled" : fragment.includes("intentId") ? "start" : "invalid");
    client.read(); client.decide("approve"); expect(b.calls).toHaveLength(0); unmount();
  }
});

test("a valid locator waits for explicit native navigation and survives a development remount in memory", () => {
  const b = browser(`#intentId=${intent}`), client = createPairingController(true, b.effects);
  const first = client.mount(); expect(client.snapshot()).toEqual({ kind: "start", intentId: intent }); first();
  const second = client.mount(); expect(b.events).toEqual(["scrub"]); expect(client.snapshot()).toEqual({ kind: "start", intentId: intent });
  client.navigating(); expect(client.snapshot().kind).toBe("starting"); client.navigating(); expect(b.calls).toHaveLength(0); second();
});

test("the fragment-free callback page reads once and only explicit approval dispatches one POST", async () => {
  const b = browser("", async (_signal, decision) => decision ? { ...reply, state: "browser-approved" } : reply);
  const client = createPairingController(true, b.effects), unmount = client.mount(); await tick();
  expect(b.events).toEqual(["scrub", "request"]); expect(client.snapshot()).toEqual({ kind: "reply", reply });
  client.decide("approve"); client.decide("approve"); await tick();
  expect(b.calls.map(call => call.decision)).toEqual([undefined, { decision: "approve", csrfToken: token }]);
  expect(client.snapshot()).toEqual({ kind: "reply", reply: { ...reply, state: "browser-approved" } });
  client.decide("approve"); expect(b.calls).toHaveLength(2);
  client.decide("deny"); await tick();
  expect(b.calls.map(call => call.decision)).toEqual([undefined, { decision: "approve", csrfToken: token }, { decision: "deny", csrfToken: token }]);
  unmount();
});

test("denial reaches a browser-approved attempt but not a terminal one", async () => {
  const b = browser("", async (_signal, decision) => decision ? { ...reply, state: "terminal-confirmed" } : { ...reply, state: "browser-approved" });
  const client = createPairingController(true, b.effects), unmount = client.mount(); await tick();
  expect(client.snapshot()).toEqual({ kind: "reply", reply: { ...reply, state: "browser-approved" } });
  client.decide("deny"); await tick();
  expect(b.calls.map(call => call.decision)).toEqual([undefined, { decision: "deny", csrfToken: token }]);
  expect(client.snapshot()).toEqual({ kind: "reply", reply: { ...reply, state: "terminal-confirmed" } });
  client.decide("deny"); expect(b.calls).toHaveLength(2); unmount();
});

test("a lost decision is uncertain until explicit GET readback and is never automatically repeated", async () => {
  const pending = deferred<PairingPublicReply>(); let reads = 0;
  const b = browser("", async (_signal, decision) => decision ? pending.promise : ++reads === 1 ? reply : { ...reply, state: "browser-approved" });
  const client = createPairingController(true, b.effects), unmount = client.mount(); await tick(); client.decide("approve");
  b.advance(20_000); expect(client.snapshot().kind).toBe("uncertain"); expect(b.calls[1].signal.aborted).toBe(true);
  client.decide("approve"); expect(b.calls).toHaveLength(2); client.read(); await tick();
  expect(client.snapshot()).toEqual({ kind: "reply", reply: { ...reply, state: "browser-approved" } });
  pending.resolve(reply); await tick(); expect(client.snapshot()).toEqual({ kind: "reply", reply: { ...reply, state: "browser-approved" } });
  expect(b.calls.map(call => call.decision?.decision ?? "GET")).toEqual(["GET", "approve", "GET"]); unmount();
});

test("unmount aborts and suppresses late read replies, while expiry removes pending approval", async () => {
  const late = deferred<PairingPublicReply>(), b = browser("", async () => late.promise), client = createPairingController(true, b.effects);
  const unmount = client.mount(); unmount(); expect(b.calls[0].signal.aborted).toBe(true); late.resolve(reply); await tick(); expect(client.snapshot().kind).toBe("loading");
  const b2 = browser(), other = createPairingController(true, b2.effects), stop = other.mount(); await tick(); b2.advance(60_000);
  expect(other.snapshot().kind).toBe("expired"); other.decide("approve"); other.read(); expect(b2.calls).toHaveLength(1); stop();
});

test("rejected, unavailable and already-expired projections never expose approval controls", async () => {
  for (const [projection, kind] of [
    [{ error: { code: "USAGE_PAIRING_AUTH_REJECTED" }, schemaVersion: 1 }, "rejected"],
    [{ error: { code: "USAGE_PAIRING_AUTH_UNAVAILABLE" }, schemaVersion: 1 }, "unavailable"],
    [{ ...reply, expiresAtMs: now }, "expired"],
  ] as const) {
    const b = browser("", async () => projection), c = createPairingController(true, b.effects), stop = c.mount(); await tick();
    expect(c.snapshot().kind).toBe(kind); c.decide("approve"); expect(b.calls).toHaveLength(1); stop();
  }
});
