import { beforeAll, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createUsageOidcVerifier, type RequestLifetime, type VerificationResult } from "./usage-oidc-verifier";
import { encodeBase64Url } from "./bounded-json";

const URL = "https://oidc.vercel.com/hraness/.well-known/jwks";
const NOW = 1_800_000_000_000;
const claims = () => ({
  iss: "https://oidc.vercel.com/hraness", aud: "https://vercel.com/hraness",
  sub: "owner:hraness:project:aicharts:environment:production",
  owner: "hraness", owner_id: "team_UAd1iD2XogJlbFg4h14mRaPM",
  project: "aicharts", project_id: "prj_0ppMfRRMDfiVsQ1JaekoxSZ7Mwgn",
  environment: "production", iat: NOW / 1000, nbf: NOW / 1000, exp: NOW / 1000 + 7200,
});
let privateKey: CryptoKey;
let jwk: JWK;
let token: string;
let secondJwk: JWK;
let secondPrivate: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...await exportJWK(pair.publicKey), kid: "synthetic_1", alg: "RS256", use: "sig" };
  token = await new SignJWT(claims()).setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "synthetic_1" }).sign(privateKey);
  const second = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  secondPrivate = second.privateKey;
  secondJwk = { ...await exportJWK(second.publicKey), kid: "synthetic_2" };
});

function context() {
  const pending: Promise<void>[] = [];
  const ctx: RequestLifetime = { waitUntil(p) { expect(this).toBe(ctx); pending.push(p); } };
  return { ctx, pending, drain: () => Promise.all(pending) };
}
function wireResponse(body: BodyInit | null, init: ResponseInit = {}) {
  const res = new Response(body, { ...init, headers: { "content-type": "application/jwk-set+json", ...init.headers } });
  Object.defineProperty(res, "url", { value: URL, configurable: true });
  return res;
}
function response(body: unknown = { keys: [jwk] }) { return wireResponse(JSON.stringify(body)); }
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let requests = 0; let time = NOW; let elapsed = 0; let serial = 0;
  let reply: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Response | Promise<Response> = () => response();
  const timers = new Map<number, { at: number; fn: () => void }>();
  const verifier = createUsageOidcVerifier({
    fetch: async (input, init) => {
      requests++; expect(input).toBe(URL); expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual"); expect(init?.credentials).toBe("omit");
      expect(init?.headers).toEqual({ Accept: "application/json, application/jwk-set+json" });
      expect(init?.signal instanceof AbortSignal).toBe(true);
      return reply(input, init);
    }, now: () => time,
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { at: elapsed + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
  });
  return {
    verifier, requests: () => requests, timers: () => timers.size,
    get time() { return time; }, set time(value: number) { time = value; },
    reply(fn: typeof reply) { reply = fn; },
    tick(ms: number, advanceWall = true) {
      elapsed += ms; if (advanceWall) time += ms;
      for (let count = 0; count < 100; count++) {
        const due = [...timers].filter(([, timer]) => timer.at <= elapsed).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        timers.delete(due[0]); due[1].fn();
      }
      throw new Error("synthetic timer loop exceeded");
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
async function invoke(f: Fixture, input: unknown = token) {
  const c = context(); const scope = f.verifier.beginRequest(c.ctx);
  const result = await scope.verify(input); await c.drain();
  return { result, scope };
}
async function signed(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  return new SignJWT({ ...claims(), ...overrides })
    .setProtectedHeader({ alg: "RS256", typ: "jwt", kid: "synthetic_1", ...header })
    .sign(privateKey);
}
async function rawSigned(header: string | Uint8Array, body: string | Uint8Array) {
  const bytes = (input: string | Uint8Array) => typeof input === "string" ? new TextEncoder().encode(input) : input;
  const content = `${encodeBase64Url(bytes(header))}.${encodeBase64Url(bytes(body))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(content));
  return `${content}.${encodeBase64Url(new Uint8Array(signature))}`;
}
const denied = { ok: false, error: "unauthorized" } as const;
const down = { ok: false, error: "unavailable" } as const;
function interceptCrypto(name: "verify" | "importKey", callback: (call: () => Promise<unknown>) => Promise<unknown>) {
  const prior = Object.getOwnPropertyDescriptor(crypto.subtle, name);
  const original = crypto.subtle[name];
  Object.defineProperty(crypto.subtle, name, { configurable: true, value(...args: unknown[]) {
    return callback(() => Reflect.apply(original, crypto.subtle, args) as Promise<unknown>);
  } });
  return () => { if (prior) Object.defineProperty(crypto.subtle, name, prior); else Reflect.deleteProperty(crypto.subtle, name); };
}
function value(result: VerificationResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected synthetic success");
  return result.value;
}

test("construction and request scopes do no work", () => {
  const f = fixture(); const c = context(); const s = f.verifier.beginRequest(c.ctx);
  expect(f.requests()).toBe(0); expect(c.pending).toHaveLength(0);
  expect(Object.isFrozen(f.verifier)).toBe(true); expect(Object.isFrozen(s)).toBe(true);
  expect(s.isCurrent({})).toBe(false); s.finish(); s.finish();
});
test("signed exact identity mints only request-local authority and finish revokes it", async () => {
  const f = fixture(); const c = context(); const s = f.verifier.beginRequest(c.ctx);
  const handle = value(await s.verify(token)); await c.drain();
  expect(f.requests()).toBe(1); expect(c.pending).toHaveLength(1);
  expect(s.isCurrent(handle)).toBe(true); expect(Object.isFrozen(handle)).toBe(true);
  expect(JSON.stringify(handle)).toBe("{}"); expect(s.isCurrent({ ...handle })).toBe(false);
  expect(f.verifier.beginRequest(context().ctx).isCurrent(handle)).toBe(false);
  s.finish(); expect(s.isCurrent(handle)).toBe(false);
});
test("malformed input never fetches and consumes the one attempt", async () => {
  const f = fixture(); const c = context(); const s = f.verifier.beginRequest(c.ctx);
  expect(await s.verify("bad")).toEqual({ ok: false, error: "unauthorized" });
  expect(await s.verify(token)).toEqual({ ok: false, error: "unavailable" });
  expect(f.requests()).toBe(0); expect(c.pending).toHaveLength(0);
});
test("completed keys serve a different scope without a second fetch", async () => {
  const f = fixture(); const a = context(); const b = context();
  const first = f.verifier.beginRequest(a.ctx); value(await first.verify(token)); first.finish(); await a.drain();
  const next = f.verifier.beginRequest(b.ctx); const handle = value(await next.verify(token)); await b.drain();
  expect(next.isCurrent(handle)).toBe(true); expect(f.requests()).toBe(1); next.finish();
});

test("typ accepts exactly three ASCII jwt letters in any case", async () => {
  const f = fixture();
  for (const typ of ["jwt", "JWT", "jWt", "JwT"]) { const r = await invoke(f, await signed({}, { typ })); value(r.result); r.scope.finish(); }
  for (const typ of ["application/jwt", "JWT\n", " JWT", "JWT ", "", "jwт", 1, null]) {
    const bad = fixture(); expect((await invoke(bad, await rawSigned(JSON.stringify({ alg: "RS256", kid: "synthetic_1", typ }), JSON.stringify(claims())))).result).toEqual(denied); expect(bad.requests()).toBe(0);
  }
  expect(f.requests()).toBe(1);
});

test("every exact signed identity field is mandatory and wrong audience arrays fail before fetch", async () => {
  for (const field of ["iss", "aud", "sub", "owner", "owner_id", "project", "project_id", "environment"]) {
    for (const replacement of [undefined, null, "wrong", 1, [claims()[field as keyof ReturnType<typeof claims>]]]) {
      const f = fixture(); expect((await invoke(f, await signed({ [field]: replacement }))).result).toEqual(denied); expect(f.requests()).toBe(0);
    }
  }
});

test("signed dates enforce integer presence, issuance window and exact millisecond expiry", async () => {
  const second = NOW / 1000;
  const cases: Record<string, unknown>[] = [];
  for (const field of ["exp", "iat", "nbf"]) {
    for (const value of [undefined, null, -1, 1.5, "1800000000", Number.MAX_SAFE_INTEGER, 8_640_000_000_001]) cases.push({ [field]: value });
  }
  cases.push({ exp: second }, { exp: second + 7201 }, { nbf: second + 7200 }, { iat: second + 1 }, { nbf: second + 1 }, { nbf: undefined, nfb: second }, { nfb: second });
  for (const override of cases) { const f = fixture(); expect((await invoke(f, await signed(override))).result).toEqual(denied); expect(f.requests()).toBe(0); }
  for (const field of ["iat", "nbf", "exp"]) {
    const text = JSON.stringify(claims()).replace(new RegExp(`"${field}":[0-9]+`), `"${field}":-0`);
    const f = fixture(); expect((await invoke(f, await rawSigned('{"alg":"RS256","typ":"jwt","kid":"synthetic_1"}', text))).result).toEqual(denied); expect(f.requests()).toBe(0);
  }
  const expires = await signed({ exp: second + 1 }); const f = fixture(); f.time = NOW + 999;
  const r = await invoke(f, expires); const handle = value(r.result); expect(r.scope.isCurrent(handle)).toBe(true);
  f.time = NOW + 1000; expect(r.scope.isCurrent(handle)).toBe(false); expect((await invoke(f, expires)).result).toEqual(denied);
});

test("iat and nbf need no invented relative ordering; bounded ignored claims grant no authority", async () => {
  for (const override of [{ iat: NOW / 1000 - 1, exp: NOW / 1000 + 7199 }, { nbf: NOW / 1000 - 1 }]) {
    const f = fixture(); const r = await invoke(f, await signed({ ...override, jti: "SYNTHETIC_PRIVATE_CANARY", extra: { input: [false, null] } }));
    const handle = value(r.result); expect(Reflect.ownKeys(handle)).toEqual([]); expect(JSON.stringify(r.result)).toBe('{"ok":true,"value":{}}'); r.scope.finish();
  }
});

test("protected extensions, duplicates and malformed signed JSON are rejected before key work", async () => {
  const header = '{"alg":"RS256","typ":"jwt","kid":"synthetic_1"}';
  const body = JSON.stringify(claims());
  const badHeaders = [
    '{"alg":"RS256","alg":"RS256","typ":"jwt","kid":"synthetic_1"}',
    '{"alg":"RS256","typ":"jwt","kid":"synthetic_1","\\u006bid":"synthetic_1"}',
    ...["crit", "b64", "jku", "jwk", "x5u", "x5c", "zip", "extra"].map((key) => JSON.stringify({ alg: "RS256", typ: "jwt", kid: "synthetic_1", [key]: [] })),
    ...["none", "HS256", "PS256", "rs256"].map((alg) => JSON.stringify({ alg, typ: "jwt", kid: "synthetic_1" })),
    ...["", "with space", "a".repeat(129), "x/y", "x\n"].map((kid) => JSON.stringify({ alg: "RS256", typ: "jwt", kid })),
    "null", "[]", "{}", "\ufeff" + header,
  ];
  for (const input of badHeaders) { const f = fixture(); expect((await invoke(f, await rawSigned(input, body))).result).toEqual(denied); expect(f.requests()).toBe(0); }
  for (const input of [body.slice(0, -1) + ',"exp":1800007200}', body.slice(0, -1) + ',"\\u0065xp":1800007200}', "null", "[]", "{}", body + "x", "\ufeff" + body]) {
    const f = fixture(); expect((await invoke(f, await rawSigned(header, input))).result).toEqual(denied); expect(f.requests()).toBe(0);
  }
  for (const invalid of [new Uint8Array([0xff]), new Uint8Array([0xed, 0xa0, 0x80])]) {
    const f = fixture(); expect((await invoke(f, await rawSigned(header, invalid))).result).toEqual(denied); expect(f.requests()).toBe(0);
  }
});

test("exact header/claims byte boundaries and every compact-token truncation", async () => {
  const baseHeader = '{"alg":"RS256","typ":"jwt","kid":"synthetic_1"}';
  const baseBody = JSON.stringify(claims());
  const atHeader = baseHeader.padEnd(512, " "); const atBody = baseBody.padEnd(4096, " ");
  const f = fixture(); value((await invoke(f, await rawSigned(atHeader, atBody))).result);
  for (const [head, body] of [[atHeader + " ", atBody], [atHeader, atBody + " "]]) {
    const bad = fixture(); expect((await invoke(bad, await rawSigned(head!, body!))).result).toEqual(denied); expect(bad.requests()).toBe(0);
  }
  const bad = fixture();
  for (let end = 0; end < token.length; end++) expect((await invoke(bad, token.slice(0, end))).result).toEqual(denied);
  for (const input of [token + ".", token + "\n", token + "=", "A".repeat(8193), {}, null, 1, new String(token)]) expect((await invoke(bad, input)).result).toEqual(denied);
  expect(bad.requests()).toBe(0);
});

test("matching kid signature failure and wrong signature size never trigger a refresh", async () => {
  const f = fixture(); value((await invoke(f)).result); f.time += 30_001;
  const badSignature = await new SignJWT(claims()).setProtectedHeader({ alg: "RS256", typ: "jwt", kid: "synthetic_1" }).sign(secondPrivate);
  expect((await invoke(f, badSignature)).result).toEqual(denied);
  const parts = token.split("."); const largeSignature = `${parts[0]}.${parts[1]}.${encodeBase64Url(new Uint8Array(512))}`;
  expect((await invoke(f, largeSignature)).result).toEqual(denied); expect(f.requests()).toBe(1);
});

test("JWKS header and body policy refuses HTTP substitutions with fixed private results", async () => {
  const cases: (() => Response)[] = [
    () => wireResponse("{}", { status: 201 }), () => wireResponse("{}", { status: 500 }),
    () => wireResponse("{}", { headers: { "content-type": "text/plain" } }),
    () => wireResponse("{}", { headers: { "content-type": "application/json; charset=latin1" } }),
    () => wireResponse("{}", { headers: { "content-type": "application/json; extra=1" } }),
    () => wireResponse("{}", { headers: { "content-encoding": "gzip" } }),
    () => wireResponse("{}", { headers: { "content-encoding": "" } }),
    ...["0", "01", "+2", "2.0", "16385", "9999999999999999999999", "3"].map((length) => () => wireResponse("{}", { headers: { "content-length": length } })),
    () => wireResponse(null), () => wireResponse(""), () => wireResponse("SYNTHETIC_RESPONSE_CANARY"),
    () => { const r = response(); Object.defineProperty(r, "url", { value: "https://wrong.invalid/" }); return r; },
    () => { const r = response(); Object.defineProperty(r, "redirected", { value: true }); return r; },
    () => { const r = response(); r.headers.delete("content-type"); return r; },
    () => wireResponse(new Uint8Array([0xff])), () => wireResponse("\ufeff{}"),
  ];
  for (const make of cases) { const f = fixture(); f.reply(make); expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1); expect(f.timers()).toBe(0); }
  const f = fixture(); f.reply(() => { throw new Error("SYNTHETIC_EXCEPTION_CANARY"); }); expect((await invoke(f)).result).toEqual(down);
  expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1);
});

test("manual redirect policy refuses all five redirect statuses and either Location origin without another fetch", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const location of ["https://oidc.vercel.com/hraness/synthetic-forbidden", "https://redirect.invalid/synthetic-forbidden"]) {
      const f = fixture(); let mode: RequestRedirect | undefined; let canceled = 0; let signal: AbortSignal | null | undefined;
      const body = new ReadableStream<Uint8Array>({ cancel() { canceled++; } }, { highWaterMark: 0 });
      f.reply((input, init) => {
        expect(input).toBe(URL);
        mode = init?.redirect; signal = init?.signal;
        return wireResponse(body, { status, headers: { Location: location } });
      });
      const first = await invoke(f);
      expect(first.result).toEqual(down); expect(mode).toBe("manual");
      expect(f.requests()).toBe(1); expect(canceled).toBe(1); expect(signal?.aborted).toBe(true);
      expect(body.locked).toBe(false); expect(f.timers()).toBe(0); expect(first.scope.isCurrent({})).toBe(false);
      first.scope.finish();
      // No redirect destination, retry or key admission follows the settled refusal.
      expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1); expect(canceled).toBe(1);
    }
  }
});

test("whole JWKS schema rejects invalid unused keys and never partially installs", async () => {
  const clone = () => JSON.parse(JSON.stringify({ ...jwk, kid: "unused" })) as Record<string, unknown>;
  const invalid: unknown[] = [];
  for (const field of ["kty", "kid", "n", "e"]) { const k = clone(); delete k[field]; invalid.push(k); }
  for (const [field, replacement] of Object.entries({ kty: "oct", kid: "bad/kid", e: "Aw", alg: "PS256", use: "enc", ext: false, key_ops: ["verify", "sign"] })) invalid.push({ ...clone(), [field]: replacement });
  for (const name of ["d", "p", "q", "dp", "dq", "qi", "oth", "k", "x5c", "x5u", "unknown"]) invalid.push({ ...clone(), [name]: "PRIVATE_CANARY" });
  invalid.push({ ...clone(), n: "AA" }, { ...clone(), n: encodeBase64Url(new Uint8Array(513).fill(255)) }, { ...clone(), n: encodeBase64Url(new Uint8Array(255).fill(255)) });
  const even = new Uint8Array(256).fill(255); even[255] = 254; invalid.push({ ...clone(), n: encodeBase64Url(even) });
  const zero = new Uint8Array(257).fill(255); zero[0] = 0; invalid.push({ ...clone(), n: encodeBase64Url(zero) });
  for (const key of invalid) { const f = fixture(); f.reply(() => response({ keys: [jwk, key] })); expect((await invoke(f)).result).toEqual(down); }
  for (const set of [null, [], {}, { keys: null }, { keys: [jwk], extra: 1 }, { keys: [jwk, jwk] }, { keys: Array.from({ length: 9 }, (_, i) => ({ ...jwk, kid: `k${i}` })) }]) {
    const f = fixture(); f.reply(() => response(set)); expect((await invoke(f)).result).toEqual(down);
  }
  const duplicate = JSON.stringify({ keys: [jwk] }).replace('"keys":', '"keys":[],"keys":');
  const f = fixture(); f.reply(() => wireResponse(duplicate)); expect((await invoke(f)).result).toEqual(down);
});

test("eight valid keys including same public material under distinct kids are admitted", async () => {
  const f = fixture(); f.reply(() => response({ keys: Array.from({ length: 8 }, (_, i) => ({ ...jwk, kid: i ? `other_${i}` : "synthetic_1" })) }));
  value((await invoke(f)).result); expect(f.requests()).toBe(1);
  const second = await invoke(f, await signed({}, { kid: "other_7" })); value(second.result);
});

test("exact 16384 one-byte chunks plus EOF fit both independent byte and read bounds", async () => {
  const f = fixture(); const body = new TextEncoder().encode(JSON.stringify({ keys: [jwk] }).padEnd(16384, " "));
  let at = 0;
  f.reply(() => wireResponse(new ReadableStream({ pull(c) { if (at === body.length) c.close(); else c.enqueue(body.slice(at, ++at)); } }), { headers: { "content-length": "16384", "content-type": "Application/JSON; charset=\"UTF-8\"" } }));
  value((await invoke(f)).result); expect(at).toBe(16384); expect(f.timers()).toBe(0);
});

test("byte cap and independent empty-read cap refuse and cancel without requiring a clock tick", async () => {
  const tooLarge = fixture(); let canceled = 0;
  tooLarge.reply(() => wireResponse(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16385)); }, cancel() { canceled++; } })));
  expect((await invoke(tooLarge)).result).toEqual(down); expect(canceled).toBe(1);
  const empty = fixture(); let pulls = 0; let reads = 0; let emptyCanceled = 0;
  empty.reply(() => {
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array()); }, cancel() { emptyCanceled++; } });
    const original = stream.getReader.bind(stream);
    Object.defineProperty(stream, "getReader", { value() {
      const reader = original(); return { read() { reads++; return reader.read(); }, cancel() { return reader.cancel(); }, releaseLock() { reader.releaseLock(); } };
    } });
    return wireResponse(stream);
  });
  expect((await invoke(empty)).result).toEqual(down); expect(reads).toBe(16385);
  expect(pulls).toBeLessThanOrEqual(16386); expect(emptyCanceled).toBe(1); expect(empty.timers()).toBe(0);
});

test("cold overlapping scopes refuse promptly rather than awaiting another owner's fetch", async () => {
  const f = fixture(); const entered = deferred<void>(); const gate = deferred<Response>();
  f.reply(() => { entered.resolve(); return gate.promise; });
  const a = context(); const first = f.verifier.beginRequest(a.ctx); const pending = first.verify(token);
  await entered.promise;
  for (let i = 0; i < 12; i++) expect((await invoke(f)).result).toEqual(down);
  expect(f.requests()).toBe(1);
  gate.resolve(response()); value(await pending); await a.drain(); first.finish();
  value((await invoke(f)).result); expect(f.requests()).toBe(1); expect(f.timers()).toBe(0);
});

test("failed unknown-kid refresh preserves old handles/keys at the unchanged original deadline", async () => {
  const missing = await signed({}, { kid: "not_admitted" });
  const failures = [
    () => { throw new Error("PRIVATE_NETWORK_CANARY"); },
    () => response({ keys: [jwk, { ...secondJwk, e: "Aw" }] }),
    () => wireResponse("not JSON"),
    () => wireResponse(new ReadableStream({ start(c) { c.error(new Error("PRIVATE_BODY_CANARY")); } })),
  ];
  for (const fail of failures) {
    const f = fixture(); const original = await invoke(f); const handle = value(original.result);
    f.time += 30_000; f.reply(fail);
    expect((await invoke(f, missing)).result).toEqual(down); expect(original.scope.isCurrent(handle)).toBe(true);
    expect((await invoke(f, missing)).result).toEqual(denied); expect(f.requests()).toBe(2);
    value((await invoke(f)).result); expect(f.requests()).toBe(2);
    f.time = NOW + 299_999; expect(original.scope.isCurrent(handle)).toBe(true); value((await invoke(f)).result);
    f.time = NOW + 300_000; expect(original.scope.isCurrent(handle)).toBe(false);
    expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(3);
  }
});

test("successful rotation including empty removal invalidates prior authority without a retry loop", async () => {
  const secondToken = await new SignJWT(claims()).setProtectedHeader({ alg: "RS256", typ: "jwt", kid: "synthetic_2" }).sign(secondPrivate);
  const f = fixture(); const first = await invoke(f); const handle = value(first.result);
  f.time += 30_000; f.reply(() => response({ keys: [secondJwk] }));
  value((await invoke(f, secondToken)).result); expect(first.scope.isCurrent(handle)).toBe(false);
  expect((await invoke(f)).result).toEqual(denied); expect(f.requests()).toBe(2);
  const next = await invoke(f, secondToken); const secondHandle = value(next.result);
  f.time += 30_000; f.reply(() => response({ keys: [] }));
  expect((await invoke(f, token)).result).toEqual(denied); expect(next.scope.isCurrent(secondHandle)).toBe(false);
  expect((await invoke(f, secondToken)).result).toEqual(denied); expect(f.requests()).toBe(3);
});

test("a refresh that retains the same key still changes generation; its TTL starts at flight start", async () => {
  const f = fixture(); const first = await invoke(f); const originalHandle = value(first.result);
  f.time += 30_000;
  f.reply(() => { f.time += 1000; return response(); });
  expect((await invoke(f, await signed({}, { kid: "missing" }))).result).toEqual(denied);
  expect(first.scope.isCurrent(originalHandle)).toBe(false);
  const next = await invoke(f); const handle = value(next.result);
  f.time = NOW + 329_999; expect(next.scope.isCurrent(handle)).toBe(true);
  f.time = NOW + 330_000; expect(next.scope.isCurrent(handle)).toBe(false);
});

test("fetch deadline aborts at stationary wall time and keeps an ignored-abort gate occupied", async () => {
  const f = fixture(); const entered = deferred<void>(); const gate = deferred<Response>();
  let signal: AbortSignal | undefined;
  f.reply((_input, init) => { signal = init!.signal!; entered.resolve(); return gate.promise; });
  const a = context(); const scope = f.verifier.beginRequest(a.ctx); const pending = scope.verify(token);
  await entered.promise; f.tick(2000, false);
  expect(await pending).toEqual(down); expect(signal!.aborted).toBe(true);
  f.time += 90_000; expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1);
  gate.resolve(response()); await a.drain(); expect(f.timers()).toBe(0);
  expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1);
  f.time += 30_000; f.reply(() => response()); value((await invoke(f)).result); expect(f.requests()).toBe(2);
});

test("known fresh keys remain usable while an unknown-kid timeout still owns its fetch", async () => {
  const f = fixture(); const old = await invoke(f); const handle = value(old.result); f.time += 30_000;
  const entered = deferred<void>(); const gate = deferred<Response>();
  f.reply(() => { entered.resolve(); return gate.promise; });
  const c = context(); const pending = f.verifier.beginRequest(c.ctx).verify(await signed({}, { kid: "missing" }));
  await entered.promise; value((await invoke(f)).result); f.tick(2000);
  expect(await pending).toEqual(down); expect(old.scope.isCurrent(handle)).toBe(true);
  value((await invoke(f)).result); expect(f.requests()).toBe(2);
  gate.reject(new Error("synthetic late failure")); await c.drain(); expect(old.scope.isCurrent(handle)).toBe(true);
});

test("finish before microtask start, after success, or during registration leaves no orphan work", async () => {
  const f = fixture(); const c = context(); const scope = f.verifier.beginRequest(c.ctx);
  const pending = scope.verify(token); scope.finish(); scope.finish();
  expect(await pending).toEqual(down); await c.drain(); expect(f.requests()).toBe(0); expect(f.timers()).toBe(0);
  const failure = f.verifier.beginRequest({ waitUntil() { throw new Error("PRIVATE_CTX_CANARY"); } });
  expect(await failure.verify(token)).toEqual(down); expect(f.requests()).toBe(0);
  value((await invoke(f)).result);
  const local = context();
  const during: ReturnType<typeof f.verifier.beginRequest> = f.verifier.beginRequest({ waitUntil(p) { local.ctx.waitUntil(p); during.finish(); } });
  expect(await during.verify(token)).toEqual(down); await local.drain(); expect(f.requests()).toBe(1);
});

test("finish during fetch invalidates only its scope and does not reclaim unresolved work", async () => {
  const f = fixture(); const entered = deferred<void>(); const gate = deferred<Response>();
  f.reply(() => { entered.resolve(); return gate.promise; });
  const c = context(); const owner = f.verifier.beginRequest(c.ctx); const pending = owner.verify(token);
  await entered.promise; owner.finish(); expect(await pending).toEqual(down);
  f.time += 40_000; expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1);
  gate.resolve(response()); await c.drain();
  f.time += 30_000; f.reply(() => response()); value((await invoke(f)).result); expect(f.requests()).toBe(2);
});

test("reader cancellation settlement remains owned and blocks replacement fetches", async () => {
  const f = fixture(); const reading = deferred<void>(); const canceled = deferred<void>(); const cancellation = deferred<void>();
  f.reply(() => wireResponse(new ReadableStream<Uint8Array>({ pull() { reading.resolve(); }, cancel() { canceled.resolve(); return cancellation.promise; } })));
  const c = context(); const owner = f.verifier.beginRequest(c.ctx); const pending = owner.verify(token);
  await reading.promise; f.tick(2000); expect(await pending).toEqual(down); await canceled.promise;
  f.time += 40_000; expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1);
  cancellation.resolve(); await c.drain(); f.time += 30_000;
  f.reply(() => response()); value((await invoke(f)).result); expect(f.requests()).toBe(2);
});

test("eight outstanding crypto tasks retain their permits after response timeout until actual settlement", async () => {
  const f = fixture(); value((await invoke(f)).result);
  const gate = deferred<void>(); const entered = deferred<void>(); let calls = 0;
  const restore = interceptCrypto("verify", async (call) => { if (++calls === 8) entered.resolve(); await gate.promise; return call(); });
  const contexts = Array.from({ length: 8 }, context);
  try {
    const scopes = contexts.map((c) => f.verifier.beginRequest(c.ctx));
    const pending = scopes.map((scope) => scope.verify(token)); await entered.promise;
    expect((await invoke(f)).result).toEqual(down); expect(calls).toBe(8);
    f.tick(5000, false); expect(await Promise.all(pending)).toEqual(Array(8).fill(down));
    for (let i = 0; i < 8; i++) expect((await invoke(f)).result).toEqual(down);
    expect(calls).toBe(8); gate.resolve(); await Promise.all(contexts.map((c) => c.drain()));
    for (const scope of scopes) expect(scope.isCurrent({})).toBe(false);
  } finally { gate.resolve(); await Promise.all(contexts.map((c) => c.drain())); restore(); }
  value((await invoke(f)).result); expect(f.requests()).toBe(1); expect(f.timers()).toBe(0);
});

test("expiry, cache expiry, clock regression and finish are rechecked after successful crypto", async () => {
  for (const change of ["token_expiry", "cache_expiry", "clock_regression", "finish"] as const) {
    const f = fixture(); const old = await invoke(f); const oldHandle = value(old.result);
    const c = context(); const scope = f.verifier.beginRequest(c.ctx);
    const input = change === "token_expiry" ? await signed({ exp: NOW / 1000 + 1 }) : token;
    if (change === "cache_expiry") f.time = NOW + 299_999;
    const restore = interceptCrypto("verify", async (call) => {
      const valid = await call();
      if (change === "token_expiry") f.time = NOW + 1000;
      if (change === "cache_expiry") f.time = NOW + 300_000;
      if (change === "clock_regression") f.time = NOW - 1;
      if (change === "finish") scope.finish();
      return valid;
    });
    try { expect(await scope.verify(input)).toEqual(change === "token_expiry" ? denied : down); await c.drain(); }
    finally { restore(); }
    if (change === "clock_regression") { f.time = NOW; expect(old.scope.isCurrent(oldHandle)).toBe(false); }
  }
});

test("valid rotation during pending crypto invalidates the captured old generation", async () => {
  const f = fixture(); const original = await invoke(f); const handle = value(original.result); f.time += 30_000;
  const entered = deferred<void>(); const gate = deferred<void>(); let callNumber = 0;
  const restore = interceptCrypto("verify", async (call) => { if (++callNumber === 1) { entered.resolve(); await gate.promise; } return call(); });
  const c = context(); const pending = f.verifier.beginRequest(c.ctx).verify(token);
  try {
    await entered.promise; f.reply(() => response({ keys: [] }));
    expect((await invoke(f, await signed({}, { kid: "unknown" }))).result).toEqual(denied);
    expect(original.scope.isCurrent(handle)).toBe(false); gate.resolve(); expect(await pending).toEqual(down); await c.drain();
  } finally { gate.resolve(); await c.drain(); restore(); }
});

test("unabortable import keeps its fetch ticket and cannot publish after a deadline or finish", async () => {
  for (const end of ["deadline", "finish"] as const) {
    const f = fixture(); const entered = deferred<void>(); const gate = deferred<void>();
    const restore = interceptCrypto("importKey", async (call) => { entered.resolve(); await gate.promise; return call(); });
    const c = context(); const scope = f.verifier.beginRequest(c.ctx); const pending = scope.verify(token);
    try {
      await entered.promise; if (end === "deadline") f.tick(2000); else scope.finish();
      expect(await pending).toEqual(down); f.time += 40_000;
      expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1);
      gate.resolve(); await c.drain();
    } finally { gate.resolve(); await c.drain(); restore(); }
    f.time += 30_000; value((await invoke(f)).result); expect(f.requests()).toBe(2);
  }
});

test("clock faults clear authority without clamping or lowering the prior observed floor", async () => {
  for (const badTime of [NOW - 1, NaN, Infinity, -0, -1, 1.5, 8_640_000_000_000_000, Number.MAX_SAFE_INTEGER]) {
    const f = fixture(); const first = await invoke(f); const handle = value(first.result);
    f.time = badTime; expect(first.scope.isCurrent(handle)).toBe(false);
    f.time = NOW - 1; expect((await invoke(f)).result).toEqual(down);
    f.time = NOW; expect(first.scope.isCurrent(handle)).toBe(false); expect((await invoke(f)).result).toEqual(down);
    f.time = NOW + 30_000; value((await invoke(f)).result); expect(first.scope.isCurrent(handle)).toBe(false); expect(f.requests()).toBe(2);
  }
});

test("escaping import errors are unavailable; jose-masked verify errors are unauthorized with no retry", async () => {
  for (const method of ["importKey", "verify"] as const) {
    const f = fixture(); const restore = interceptCrypto(method, async () => { throw new Error("PRIVATE_CRYPTO_CANARY"); });
    try {
      expect((await invoke(f)).result).toEqual(method === "verify" ? denied : down); expect(f.timers()).toBe(0);
      expect((await invoke(f)).result).toEqual(method === "verify" ? denied : down); expect(f.requests()).toBe(1);
    }
    finally { restore(); }
    f.time += 30_000; value((await invoke(f)).result);
  }
});

test("clock fault during pending fetch cannot be erased by recovery before its response", async () => {
  const f = fixture(); const entered = deferred<void>(); const gate = deferred<Response>();
  f.reply(() => { entered.resolve(); return gate.promise; });
  const c = context(); const pending = f.verifier.beginRequest(c.ctx).verify(token); await entered.promise;
  f.time = NOW - 1; expect((await invoke(f)).result).toEqual(down);
  f.time = NOW; gate.resolve(response()); expect(await pending).toEqual(down); await c.drain();
  expect((await invoke(f)).result).toEqual(down); expect(f.requests()).toBe(1);
  f.time += 30_000; f.reply(() => response()); value((await invoke(f)).result); expect(f.requests()).toBe(2);
});

test("failed refresh imports preserve fresh prior keys and import each new key sequentially", async () => {
  const f = fixture(); const prior = await invoke(f); const handle = value(prior.result); f.time += 30_000;
  const restore = interceptCrypto("importKey", async () => { throw new Error("IMPORT_CANARY"); });
  try {
    expect((await invoke(f, await signed({}, { kid: "unknown" }))).result).toEqual(down);
    expect(prior.scope.isCurrent(handle)).toBe(true); value((await invoke(f)).result);
  } finally { restore(); }
  const next = fixture(); let active = 0; let maximum = 0; let calls = 0;
  const ordered = interceptCrypto("importKey", async (call) => {
    calls++; active++; maximum = Math.max(maximum, active);
    try { return await call(); } finally { active--; }
  });
  try {
    next.reply(() => response({ keys: Array.from({ length: 8 }, (_, i) => ({ ...jwk, kid: i ? `k${i}` : "synthetic_1" })) }));
    value((await invoke(next)).result); expect(calls).toBe(8); expect(maximum).toBe(1); expect(active).toBe(0);
  } finally { ordered(); }
});

test("RSA admission covers the actual 4096-bit upper bound and rejects 2047-bit modulus", async () => {
  const f = fixture(); f.reply(() => response({ keys: [jwk, { kty: "RSA", kid: "upper", n: encodeBase64Url(new Uint8Array(512).fill(255)), e: "AQAB" }] }));
  value((await invoke(f)).result);
  const small = new Uint8Array(256).fill(255); small[0] = 127;
  const bad = fixture(); bad.reply(() => response({ keys: [{ ...jwk, n: encodeBase64Url(small) }] }));
  expect((await invoke(bad)).result).toEqual(down);
});

test("epoch zero and highest usable Date-range clock preserve exact integer handling", async () => {
  const epoch = fixture(); epoch.time = 0;
  value((await invoke(epoch, await signed({ iat: 0, nbf: 0, exp: 7200 }))).result);
  const ceiling = 8_640_000_000_000;
  const high = fixture(); high.time = ceiling * 1000 - 300_000;
  value((await invoke(high, await signed({ iat: ceiling - 7200, nbf: ceiling - 7200, exp: ceiling }))).result);
  high.time++; expect((await invoke(high, token)).result).toEqual(down);
});

test("token expiration during public-key import cannot become authority", async () => {
  const f = fixture(); const input = await signed({ exp: NOW / 1000 + 1 });
  const restore = interceptCrypto("importKey", async (call) => { const key = await call(); f.time += 1000; return key; });
  try { expect((await invoke(f, input)).result).toEqual(denied); expect(f.timers()).toBe(0); }
  finally { restore(); }
});

test("seeded signed identity mutations never consume network work or produce authority", async () => {
  let seed = 0x3758614d;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const fields = ["iss", "aud", "sub", "owner", "owner_id", "project", "project_id", "environment"];
  const f = fixture();
  for (let i = 0; i < 96; i++) {
    const field = fields[next() % fields.length]!;
    expect((await invoke(f, await signed({ [field]: `synthetic_${next()}` }))).result).toEqual(denied);
  }
  expect(f.requests()).toBe(0); expect(f.timers()).toBe(0);
});

test("even failed crypto settlement samples clock health before classifying jose's masked failure", async () => {
  const f = fixture(); const prior = await invoke(f); const handle = value(prior.result);
  const restore = interceptCrypto("verify", async () => { f.time = NOW - 1; throw new Error("MASKED_CLOCK_CANARY"); });
  try { expect((await invoke(f)).result).toEqual(down); }
  finally { restore(); }
  f.time = NOW; expect(prior.scope.isCurrent(handle)).toBe(false);
});
