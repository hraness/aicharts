import { expect, mock, test } from "bun:test";
import { encodePairingPublicReply, encodePairingDecision, PAIRING_PUBLIC_MEDIA, PAIRING_PUBLIC_URL, PAIRING_START_URL } from "./pairing-public";
mock.module("server-only", () => ({}));
const { createPairingRoutes } = await import("./pairing-route");
const intent = "11".repeat(32), token = "22".repeat(32), now = 1_800_000_000_000;
// Earlier than the 15s route budget, so expiry cases cannot pass merely because
// the generic request deadline also elapsed.
const reply = { schemaVersion: 1, state: "pending", accountId: `acct_${"33".repeat(16)}`, expiresAtMs: now + 10_000, csrfToken: token } as const;
const bytes = (value: string) => new TextEncoder().encode(value);
const response = () => new Response(encodePairingPublicReply(reply), { headers: { "content-type": PAIRING_PUBLIC_MEDIA } });
function incoming(start = false, options: { method?: string; url?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  const method = options.method ?? (start ? "POST" : "GET");
  return new Request(options.url ?? (start ? PAIRING_START_URL : PAIRING_PUBLIC_URL), { method, signal: options.signal,
    headers: { "sec-fetch-site": "same-origin", origin: "https://aicharts.io", accept: "application/json",
      ...(method === "POST" ? { "content-type": start ? "application/x-www-form-urlencoded" : "application/json" } : {}), ...options.headers },
    ...(method === "POST" ? { body: options.body ?? (start ? `intentId=${intent}` : encodePairingDecision("approve", token)!) } : {}) });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function tick() { for (let count = 0; count < 20; count++) await Promise.resolve(); }
function fixture(options: { begin?: () => (() => boolean) | null; register?: () => void; start?: (r: Request, input: unknown) => Promise<Response>;
  read?: (r: Request) => Promise<Response>; decide?: (r: Request) => Promise<Response> } = {}) {
  let time = now, open = true, begins = 0, starts = 0, reads = 0, decisions = 0;
  const terminal: Promise<void>[] = [], timers = new Map<object, { callback: () => void; end: number }>();
  const routes = createPairingRoutes({ begin() { begins++; return options.begin ? options.begin() : () => open; },
    registerLifetime(promise) { terminal.push(promise); options.register?.(); },
    now: () => time, setTimeout(callback, ms) { const key = {}; timers.set(key, { callback, end: time + ms }); return key; }, clearTimeout(key) { timers.delete(key as object); },
    async start(request, input) { starts++; return options.start ? options.start(request, input) : new Response(null, { status: 302,
      headers: { location: "https://account.hraness.com/api/auth/oauth2/authorize?state=synthetic", "set-cookie": "__Host-synthetic=private; Secure; HttpOnly; Path=/" } }); },
    async read(r) { reads++; return options.read ? options.read(r) : response(); },
    async decide(r) { decisions++; return options.decide ? options.decide(r) : response(); },
  });
  return { ...routes, terminal, counts: () => ({ begins, starts, reads, decisions }), close() { open = false; }, time(value: number) { time = value; },
    fire(ms: number) { time += ms; for (const task of [...timers.values()]) if (task.end <= time) task.callback(); }, join: () => Promise.all(terminal) };
}
function privateHeaders(r: Response) {
  expect(r.headers.get("cache-control")).toBe("private, no-store"); expect(r.headers.get("pragma")).toBe("no-cache");
  expect(r.headers.get("vary")).toBe("Cookie"); expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff"); expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  for (const name of ["access-control-allow-origin", "access-control-allow-credentials", "etag", "last-modified"]) expect(r.headers.has(name)).toBe(false);
}

test("native start owns the fixed SDK request, intent locator, redirect and cookie projection", async () => {
  let invoked = false;
  const f = fixture({ start: async (request, input) => {
    invoked = true; expect(request.url).toBe("https://aicharts.io/api/suite-auth/start"); expect(request.method).toBe("GET"); expect(request.body).toBeNull();
    expect(request.headers.get("cookie")).toBe("synthetic-cookie"); expect(request.headers.has("content-type")).toBe(false);
    expect(input).toEqual({ intentId: intent });
    return new Response(null, { status: 302, headers: { location: "https://account.hraness.com/api/auth/oauth2/authorize?state=synthetic",
      "set-cookie": "__Host-synthetic=private; Secure; HttpOnly; Path=/", "x-upstream-canary": "PRIVATE_CANARY" } });
  } });
  const r = await f.start(incoming(true, { headers: { cookie: "synthetic-cookie", "content-length": "73" } }));
  expect(invoked).toBe(true); expect(r.status).toBe(302); expect(r.body).toBeNull(); privateHeaders(r);
  expect(r.headers.has("x-upstream-canary")).toBe(false); expect(r.headers.getSetCookie()).toHaveLength(1); await f.join();
});

test("GET and canonical POST return only the fixed checked public projection", async () => {
  const f = fixture({ decide: async request => { expect(await request.text()).toBe(encodePairingDecision("approve", token)!); return response(); } });
  for (const method of ["GET", "POST"]) {
    const r = await f.approval(incoming(false, { method })); expect(r.status).toBe(200); privateHeaders(r);
    expect(r.headers.has("set-cookie")).toBe(false); expect(await r.text()).toBe(new TextDecoder().decode(encodePairingPublicReply(reply)!));
  }
  expect(f.counts()).toEqual({ begins: 2, starts: 0, reads: 1, decisions: 1 }); await f.join();
});

test("disabled and unsupported routes do no request body, lifetime, SDK or durable work", async () => {
  const f = fixture({ begin: () => null });
  const request = incoming(true); Object.defineProperty(request, "url", { get() { throw new Error("PRIVATE_CANARY"); } });
  const r = await f.start(request); expect(r.status).toBe(503); privateHeaders(r); expect(await r.text()).not.toContain("PRIVATE_CANARY");
  for (const start of [false, true]) for (const method of ["HEAD", "OPTIONS", "PUT", "PATCH", "DELETE", ...(start ? ["GET"] : [])]) {
    const r = await (start ? f.start : f.approval)(incoming(start, { method })); expect(r.status).toBe(405); privateHeaders(r);
    if (method === "HEAD") expect(await r.text()).toBe("");
  }
  expect(f.counts()).toEqual({ begins: 1, starts: 0, reads: 0, decisions: 0 }); expect(f.terminal).toHaveLength(0);
});

test("origin, exact URL and framing refuse before consuming a stream or resolving authority", async () => {
  const f = fixture(); let pulls = 0;
  for (const options of [{ url: `${PAIRING_START_URL}?intentId=${intent}` }, { url: PAIRING_START_URL.replace("aicharts.io", "foreign.example") },
    { headers: { origin: "https://foreign.example" } }, { headers: { "sec-fetch-site": "same-site" } }, { headers: { "sec-fetch-site": "none" } },
    { headers: { authorization: "Bearer PRIVATE_CANARY" } }, { headers: { "content-length": "073" } }, { headers: { "content-length": "74" } },
    { headers: { "content-type": "application/json" } }, { headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } },
    { headers: { "content-encoding": "gzip" } }, { headers: { "transfer-encoding": "chunked" } }] as Parameters<typeof incoming>[1][]) {
    const request = incoming(true, options); Object.defineProperty(request, "body", { value: new ReadableStream({ pull() { pulls++; } }, { highWaterMark: 0 }) });
    expect([400, 403]).toContain((await f.start(request)).status);
  }
  expect(pulls).toBe(0); expect(f.terminal).toHaveLength(0); expect(f.counts().starts).toBe(0);
});

test("noncanonical form and decision bytes cannot begin authentication or call approval", async () => {
  const f = fixture();
  for (const body of [`intentId=${intent}&`, `intentId=${intent}&accountId=PRIVATE_CANARY`, `intentId=${"0".repeat(64)}`, `IntentId=${intent}`, `intentId=${intent}\n`, `\ufeffintentId=${intent}`]) {
    const r = await f.start(incoming(true, { body })); expect(r.status).toBe(400); expect(await r.text()).not.toContain(intent);
  }
  for (const body of [` ${encodePairingDecision("approve", token)}`, `{"csrfToken":"${token}","decision":"approve"}`, `{"decision":"approve","decision":"deny","csrfToken":"${token}"}`,
    `{"decision":"approve","csrfToken":"${token}","accountId":"PRIVATE_CANARY"}`, "x".repeat(513)]) {
    expect((await f.approval(incoming(false, { method: "POST", body }))).status).toBe(400);
  }
  expect(f.counts().starts).toBe(0); expect(f.counts().decisions).toBe(0); await f.join();
});

test("untrusted redirects, cookies, DTO fields and media never pass through approval", async () => {
  for (const raw of [() => new Response("PRIVATE_CANARY"), () => new Response(null, { status: 302, headers: { location: "https://foreign.example/PRIVATE_CANARY" } }),
    () => new Response(encodePairingPublicReply(reply), { headers: { "content-type": PAIRING_PUBLIC_MEDIA, "set-cookie": "PRIVATE_CANARY" } }),
    () => new Response(JSON.stringify({ ...reply, proof: "PRIVATE_CANARY" }), { headers: { "content-type": PAIRING_PUBLIC_MEDIA } }),
    () => new Response(encodePairingPublicReply(reply), { status: 403, headers: { "content-type": PAIRING_PUBLIC_MEDIA } })]) {
    const f = fixture({ read: async () => raw(), start: async () => raw() });
    for (const starting of [false, true]) {
      const r = await (starting ? f.start : f.approval)(incoming(starting)); expect(r.status).toBe(503); privateHeaders(r);
      expect(await r.text()).not.toContain("PRIVATE_CANARY"); expect(r.headers.has("location")).toBe(false); expect(r.headers.has("set-cookie")).toBe(false);
    }
    await f.join();
  }
});

test("configuration, abort and successful approval expiry remain fenced through final delivery", async () => {
  for (const action of ["close", "abort", "expiry", "clock"] as const) {
    const controller = new AbortController();
    const f = fixture({ read: async () => {
      if (action === "close") f.close(); else if (action === "abort") controller.abort(); else f.time(action === "expiry" ? reply.expiresAtMs : now - 1);
      return response();
    } });
    expect((await f.approval(incoming(false, { signal: controller.signal }))).status).toBe(503); await f.join();
  }
  // Refusal during response EOF is later than the coordinator's successful return.
  const f = fixture({ read: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes(new TextDecoder().decode(encodePairingPublicReply(reply)!))); controller.close(); f.time(reply.expiresAtMs);
  } }), { headers: { "content-type": PAIRING_PUBLIC_MEDIA } }) });
  expect((await f.approval(incoming())).status).toBe(503); await f.join();
});

test("body-stage timeout keeps its permit until cancellation settles", async () => {
  const cancelled = deferred<void>(); let cancels = 0;
  const f = fixture(), stream = new ReadableStream<Uint8Array>({ cancel() { cancels++; return cancelled.promise; } }, { highWaterMark: 0 });
  const request = incoming(true); Object.defineProperty(request, "body", { value: stream });
  const pending = f.start(request); await tick(); f.fire(5_000);
  expect((await pending).status).toBe(503); expect(cancels).toBe(1);
  let settled = false; void f.terminal[0].then(() => { settled = true; }); await tick(); expect(settled).toBe(false);
  cancelled.resolve(); await f.join(); expect(settled).toBe(true); expect(f.counts().starts).toBe(0);
});

test("successful approval cannot escape when response disposal reaches expiry equality", async () => {
  for (const expire of [false, true]) {
    let disposals = 0;
    const f = fixture({ read: async () => {
      const r = response(), stream = r.body!;
      Object.defineProperty(r, "body", { get() {
        // The owned stream has reached EOF and released its reader. This is the
        // route's final response disposal, after the outgoing DTO was checked.
        if (r.bodyUsed && !stream.locked) { disposals++; if (expire) f.time(reply.expiresAtMs); }
        return stream;
      } });
      return r;
    } });
    expect((await f.approval(incoming())).status).toBe(expire ? 503 : 200);
    await f.join(); expect(disposals).toBeGreaterThan(0);
  }
});

test("eight timed-out calls retain capacity through late settlement and dispose late responses", async () => {
  const late = deferred<Response>(); let cancelled = 0;
  const f = fixture({ read: async () => late.promise });
  const pending = Array.from({ length: 8 }, () => f.approval(incoming())); await tick();
  expect(f.counts().reads).toBe(8); expect((await f.approval(incoming())).status).toBe(503);
  f.fire(15_000); expect((await Promise.all(pending)).map(r => r.status)).toEqual(Array(8).fill(503));
  expect((await f.approval(incoming())).status).toBe(503); expect(f.counts().reads).toBe(8);
  late.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": PAIRING_PUBLIC_MEDIA } }));
  await f.join(); expect(cancelled).toBe(1);
});

test("failed lifetime registration refuses before dispatch and observed fence errors stay fixed", async () => {
  const f = fixture({ register() { throw new Error("PRIVATE_CANARY"); } });
  expect((await f.start(incoming(true))).status).toBe(503); expect(f.counts().starts).toBe(0); await f.join();
  const g = fixture({ begin() { throw new Error("PRIVATE_CANARY"); } });
  const r = await g.approval(incoming()); expect(r.status).toBe(503); expect(await r.text()).not.toContain("PRIVATE_CANARY");
});
