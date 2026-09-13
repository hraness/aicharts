import { env } from "cloudflare:workers";
import { abortAllDurableObjects, createExecutionContext, reset, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ADMISSION_BATCH_HEADER_BYTES, decodeAdmissionBatch, decodeAdmissionJournal, encodeAdmissionBatch, encodeAdmissionOperation, MAX_ADMISSION_BATCH_BYTES, MAX_ADMISSION_JOURNAL_BYTES, type AdmissionBatch } from "../../../lib/usage/admission";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { PAIRING_HTTP_STAGE_MS } from "../../../lib/usage/pairing-http-contract";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import production from "../src/index";
import { ADMISSION_HTTP_BATCH_MEDIA, ADMISSION_HTTP_CAPACITY, ADMISSION_HTTP_JOURNAL_MEDIA, ADMISSION_HTTP_RPC_MS, ADMISSION_HTTP_URL, ADMISSION_HTTP_WORKER_MS, createAdmissionHttpHandler, type AdmissionHttpEnvironment } from "../src/admission-http";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0, 456);
const CANARY = "PRIVATE_TRANSCRIPT_CANARY";
const hex = (number: number, width = 32) => number.toString(16).padStart(width * 2, "0");
let serial = 0, account = "", intent = 0;
const actual: AdmissionHttpEnvironment = env; // Real binding assignability, not a cast.
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const effects = { now: Date.now, setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms), clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) };
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result.ok).toBe(true); if (!result.ok) throw new Error("synthetic_fixture_failure"); return result.value;
};
beforeEach(() => { account = `acct_${hex(++serial, 16)}`; intent = serial * 100; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await reset(); });
type Device = { proof: EnrollmentProof; id: Uint8Array };
async function enroll(): Promise<Device> {
  const proof = { intentId: hex(++intent), pollSecret: hex(intent + 1_000_000), uploadSecret: hex(intent + 2_000_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), nonce = hex(intent + 3_000_000);
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment: success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret)) }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: nonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: nonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: Math.floor(NOW / 1000) * 1000, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof));
  return { proof, id: admissionIdBytes(success(await stub().enroll(proof)).receipt.deviceId) };
}
function batch(device: Device, firstSequence = 1, count = 1, output = 5n): AdmissionBatch {
  const operations = Array.from({ length: count }, (_, index) => {
    const id = admissionIdBytes(hex(index + 1, 16));
    const frame = success(encodeUsageBatch({ utcDay: Math.floor(NOW / DAY_MS), registryRevision: 1,
      usage: [{ id, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1, provider: 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
        tokens: { inputUncached: 10n, cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, output, reasoningOutput: 0n } }], prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
    return success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: device.id,
      generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: 1, sequence: firstSequence + index,
      occurrenceId: id, expectedHeadHash: new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  });
  return success(decodeAdmissionBatch(success(encodeAdmissionBatch(operations, ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
}
function request(bytes: Uint8Array, secret: string, headers: Record<string, string> = {}): Request {
  return new Request(ADMISSION_HTTP_URL, { method: "POST", body: new Uint8Array(bytes), headers: {
    "content-type": ADMISSION_HTTP_BATCH_MEDIA, accept: ADMISSION_HTTP_JOURNAL_MEDIA,
    authorization: `Bearer ${secret}`, "content-length": String(bytes.length), ...headers,
  } });
}
async function call(req: Request, selected: AdmissionHttpEnvironment = actual, handler = createAdmissionHttpHandler(effects)): Promise<Response> {
  const ctx = createExecutionContext();
  try { return await handler(req, selected, ctx); } finally { await waitOnExecutionContext(ctx); }
}
async function snapshot() {
  const state = await runInDurableObject(stub(), (_instance, state) => ({
    control: state.storage.sql.exec("SELECT * FROM usage_admission_control").one(),
    heads: state.storage.sql.exec("SELECT * FROM usage_admission_heads ORDER BY occurrence_id").toArray(),
    devices: state.storage.sql.exec("SELECT * FROM usage_admission_devices ORDER BY device_id").toArray(),
    pending: state.storage.sql.exec("SELECT * FROM usage_admission_pending").toArray(),
    days: state.storage.sql.exec("SELECT * FROM usage_admission_days ORDER BY utc_day").toArray(),
  }));
  return { state, staging: (await env.STAGING.list()).objects.map(object => object.key).sort(), control: (await env.CONTROL.list()).objects.map(object => object.key).sort() };
}
async function terminal(response: Response, value: AdmissionBatch) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(ADMISSION_HTTP_JOURNAL_MEDIA);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.length).toBeLessThanOrEqual(MAX_ADMISSION_JOURNAL_BYTES);
  return { bytes, journal: success(decodeAdmissionJournal(bytes, value.bytes, ADMISSION_POLICY_V1)) };
}

test("real HTTP/RPC commit survives a lost RPC reply and restart without duplicate publication", async () => {
  const device = await enroll(), value = batch(device);
  let committed: Uint8Array | null = null;
  const lost = mockEnvironment(input => new Promise((_resolve, reject) => {
    void stub().admitBatch(input).then(raw => {
      try { committed = new Uint8Array(success(raw)); }
      finally {
        Reflect.apply(Object.getOwnPropertyDescriptor(raw, Symbol.dispose)!.value, raw, []);
        reject(new Error(CANARY));
      }
    }, reject);
  }));
  const unavailable = await call(request(value.bytes, device.proof.uploadSecret), lost);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ schemaVersion: 1, error: { code: "upload_unavailable" } });
  const before = await snapshot();
  expect(before.state.control).toMatchObject({ published_revision: 1, head_count: 1, live_count: 1 });
  expect(before.state.devices[0].settled_sequence).toBe(1); expect(before.state.pending).toEqual([]);
  expect(before.staging).toHaveLength(1); expect(before.control).toHaveLength(2);
  // The HTTP caller received no terminal bytes and must retain its exact flight.
  await abortAllDurableObjects();
  const replay = await terminal(await call(request(value.bytes, device.proof.uploadSecret)), value);
  expect(replay.journal.status).toBe(1); expect(replay.journal.receipts[0].outcome).toBe(1);
  expect(replay.bytes).toEqual(committed); expect(await snapshot()).toEqual(before);
});

test("concurrent HTTP retries receive one exact terminal journal and publish once", async () => {
  const device = await enroll(), value = batch(device), handler = createAdmissionHttpHandler(effects);
  const replies = await Promise.all(Array.from({ length: 3 }, async () => terminal(
    await call(request(value.bytes, device.proof.uploadSecret), actual, handler), value)));
  expect(replies[1].bytes).toEqual(replies[0].bytes); expect(replies[2].bytes).toEqual(replies[0].bytes);
  const state = await snapshot();
  expect(state.state.control).toMatchObject({ published_revision: 1, head_count: 1, live_count: 1 });
  expect(state.state.devices[0].settled_sequence).toBe(1); expect(state.state.pending).toEqual([]);
  expect(state.staging).toHaveLength(1); expect(state.control).toHaveLength(2);
});

test("routine upload outlives pairing expiry while revoked latest replay remains terminal", async () => {
  const device = await enroll(), value = batch(device);
  vi.setSystemTime(NOW + PAIRING_TTL_MS + 1);
  const first = await terminal(await call(request(value.bytes, device.proof.uploadSecret)), value);
  success(await stub().revokeEnrollment(device.proof));
  const before = await snapshot();
  await abortAllDurableObjects();
  const replay = await terminal(await call(request(value.bytes, device.proof.uploadSecret)), value);
  expect(replay.bytes).toEqual(first.bytes);
  const refusal = await call(request(batch(device, 2, 1, 6n).bytes, device.proof.uploadSecret));
  expect(refusal.status).toBe(409);
  expect(await refusal.json()).toEqual({ schemaVersion: 1, error: { code: "upload_blocked" } });
  expect(await snapshot()).toEqual(before);
});

test("terminal conflict is a checked journal with HTTP 200, not a transport failure", async () => {
  const device = await enroll(), first = batch(device);
  await terminal(await call(request(first.bytes, device.proof.uploadSecret)), first);
  const conflict = batch(device, 2, 1, 6n);
  const reply = await terminal(await call(request(conflict.bytes, device.proof.uploadSecret)), conflict);
  expect(reply.journal.status).toBe(2); expect(reply.journal.receipts[0].outcome).toBe(5);
  const state = await snapshot(); expect(state.state.control.head_count).toBe(1); expect(state.state.devices[0].settled_sequence).toBe(2);
});

test("maximum five-digit request and terminal journal lengths cross real RPC", async () => {
  const device = await enroll(), value = batch(device, 1, 256);
  expect(value.bytes.length).toBe(MAX_ADMISSION_BATCH_BYTES);
  const reply = await terminal(await call(request(value.bytes, device.proof.uploadSecret)), value);
  expect(reply.bytes.length).toBe(MAX_ADMISSION_JOURNAL_BYTES); expect(reply.journal.receipts).toHaveLength(256);
});

test("wrong upload preimage and polling substitution reserve no batch or objects", async () => {
  const device = await enroll(), value = batch(device), before = await snapshot();
  for (const secret of [hex(9999), device.proof.pollSecret]) {
    const response = await call(request(value.bytes, secret)); expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ schemaVersion: 1, error: { code: "unauthorized_device" } });
  }
  expect(await snapshot()).toEqual(before);
});

test("valid credentials cannot authorize another enrolled device or another account", async () => {
  const device = await enroll(), otherDevice = await enroll(), value = batch(device), before = await snapshot();
  expect((await call(request(value.bytes, otherDevice.proof.uploadSecret))).status).toBe(401);
  const foreign = value.bytes.slice();
  foreign[16] ^= 0x80; foreign[ADMISSION_BATCH_HEADER_BYTES + 16] ^= 0x80;
  expect(decodeAdmissionBatch(foreign, ADMISSION_POLICY_V1).ok).toBe(true);
  expect((await call(request(foreign, device.proof.uploadSecret))).status).toBe(401);
  expect(await snapshot()).toEqual(before);
});

test("framing and bearer refusals never select an account namespace", async () => {
  const device = await enroll(), value = batch(device); let selected = 0;
  const denied: AdmissionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } };
  const invalidHeaders: Record<string, string>[] = [
    ...["0", "01", "+424", "424.0", "4e2", "424, 424", "82025", "100000"].map(length => ({ "content-length": length })),
    { "content-encoding": "gzip" }, { cookie: CANARY }, { "content-type": "application/json" },
    { "content-type": `${ADMISSION_HTTP_BATCH_MEDIA}; charset=utf-8` }, { accept: "application/json" },
    { accept: `${ADMISSION_HTTP_JOURNAL_MEDIA}, */*` },
  ];
  for (const headers of invalidHeaders) {
    expect((await call(request(value.bytes, device.proof.uploadSecret, headers), denied)).status).toBe(400);
  }
  for (const secret of ["0".repeat(64), "FF".repeat(32), "a.b.c", CANARY, " " + device.proof.uploadSecret]) {
    expect((await call(request(value.bytes, secret), denied)).status).toBe(401);
  }
  for (const authorization of ["", `bearer ${device.proof.uploadSecret}`, `Basic ${device.proof.uploadSecret}`, `Bearer ${device.proof.uploadSecret}, Bearer ${device.proof.uploadSecret}`]) {
    expect((await call(request(value.bytes, device.proof.uploadSecret, { authorization }), denied)).status).toBe(401);
  }
  const missing = request(value.bytes, device.proof.uploadSecret); missing.headers.delete("authorization");
  expect((await call(missing, denied)).status).toBe(401);
  expect(selected).toBe(0);
});

test("only the exact fixed HTTPS POST route can acquire an account binding", async () => {
  const device = await enroll(), value = batch(device); let selected = 0;
  const denied: AdmissionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } };
  for (const url of ["http://usage.aicharts.io/v1/batches", "https://other.example/v1/batches", `${ADMISSION_HTTP_URL}/`, `${ADMISSION_HTTP_URL}?transcript=${CANARY}`, `${ADMISSION_HTTP_URL}#fragment`]) {
    const req = new Request(url, request(value.bytes, device.proof.uploadSecret));
    const reply = await call(req, denied);
    expect(reply.status).toBe(400); expect(await reply.text()).not.toContain(CANARY);
  }
  for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]) {
    expect((await call(new Request(ADMISSION_HTTP_URL, { method, headers: request(value.bytes, device.proof.uploadSecret).headers }), denied)).status).toBe(400);
  }
  expect(selected).toBe(0);
});

test("exact bounded framing accepts a stream without a declared length and rejects truncation", async () => {
  const device = await enroll(), value = batch(device);
  const chunked = request(value.bytes, device.proof.uploadSecret); chunked.headers.delete("content-length");
  const accepted = await terminal(await call(chunked), value);
  expect(accepted.journal.status).toBe(1);
  let selected = 0;
  const denied: AdmissionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } };
  for (const length of [value.bytes.length - 1, value.bytes.length + 1]) {
    expect((await call(request(value.bytes, device.proof.uploadSecret, { "content-length": String(length) }), denied)).status).toBe(400);
  }
  const empty = new Request(ADMISSION_HTTP_URL, { method: "POST", headers: chunked.headers });
  expect((await call(empty, denied)).status).toBe(400); expect(selected).toBe(0);
});

test("oversized, trailing and transcript-shaped bodies are refused before account lookup", async () => {
  const device = await enroll(), value = batch(device); let selected = 0;
  const denied: AdmissionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } };
  const bodies = [new Uint8Array(MAX_ADMISSION_BATCH_BYTES + 1), new Uint8Array([...value.bytes, 0]), new TextEncoder().encode(JSON.stringify({ transcript: CANARY }))];
  for (const body of bodies) {
    const response = await call(request(body, device.proof.uploadSecret), denied); expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(CANARY);
  }
  expect(selected).toBe(0);
});

test("production handler remains unavailable and exposes no admission route", async () => {
  const response = production.fetch(); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "usage_service_unavailable" });
});

function disposedReply(value: object, dispose: () => void): object {
  return Object.defineProperty(value, Symbol.dispose, { value: dispose });
}
function mockEnvironment(run: (input: unknown) => Promise<unknown>): AdmissionHttpEnvironment {
  return { ACCOUNT_ENROLLMENTS: { getByName(name) { expect(name).toBe(enrollmentAccountName(account)); return { admitBatch: run }; } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function clock() {
  let now = NOW;
  const timers = new Map<object, { callback: () => void; deadline: number }>();
  return {
    effects: { now: () => now, setTimeout(callback: () => void, delay: number) { const id = {}; timers.set(id, { callback, deadline: now + delay }); return id; }, clearTimeout(id: unknown) { timers.delete(id as object); } },
    advance(ms: number, fire = true) { now += ms; if (fire) for (const value of [...timers.values()]) if (value.deadline <= now) value.callback(); },
    timers,
  };
}

test("owned ordinary RPC input and exact journal correlation survive request-buffer mutation", async () => {
  const device = await enroll(), value = batch(device);
  const journal = success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes }));
  let disposed = 0;
  const selected = mockEnvironment(async input => {
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype); expect(Object.isFrozen(input)).toBe(true);
    expect(Reflect.ownKeys(input as object)).toEqual(["uploadSecret", "batch"]);
    const projected = input as { uploadSecret: string; batch: Uint8Array };
    expect(projected.uploadSecret).toBe(device.proof.uploadSecret); expect(projected.batch).toEqual(value.bytes);
    projected.batch.fill(0); // Never changes the independently retained request binding.
    return disposedReply({ ok: true, value: journal }, () => { disposed++; });
  });
  const reply = await terminal(await call(request(value.bytes, device.proof.uploadSecret), selected), value);
  expect(reply.bytes).toEqual(journal); expect(disposed).toBe(1);
});

test("staged, mismatched, extended and accessor RPC results fail without reflection and dispose once", async () => {
  const device = await enroll(), value = batch(device);
  const first = success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes }));
  const other = batch(device, 2, 1, 6n);
  const mismatched = success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: other.bytes }));
  let accessed = 0;
  const accessor = Object.defineProperty({ ok: true }, "value", { enumerable: true, get() { accessed++; return first; } });
  for (const raw of [
    { ok: true, value: { status: "staged", accepted: false } }, { ok: true, value: mismatched },
    { ok: true, value: new Uint8Array(MAX_ADMISSION_JOURNAL_BYTES + 1) }, { ok: true, value: first, transcript: CANARY },
    { ok: false, error: CANARY }, { ok: 1, value: first }, accessor,
  ]) {
    let disposed = 0;
    const response = await call(request(value.bytes, device.proof.uploadSecret), mockEnvironment(async () => disposedReply(raw, () => { disposed++; })));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ schemaVersion: 1, error: { code: "upload_unavailable" } });
    expect(disposed).toBe(1);
  }
  expect(accessed).toBe(0);
  expect((await call(request(value.bytes, device.proof.uploadSecret), mockEnvironment(async () => ({ ok: true, value: first })))).status).toBe(503);
});

test("raw RPC then accessors are boxed and never invoked; disposal failure is unavailable", async () => {
  const device = await enroll(), value = batch(device); let accessed = 0, disposed = 0;
  const raw = disposedReply(Object.defineProperty({ ok: false, error: "unauthorized" }, "then", { get() { accessed++; throw new Error(CANARY); } }), () => { disposed++; });
  const selected = mockEnvironment(() => ({ then(fulfilled: (raw: unknown) => void) { fulfilled(raw); return Promise.resolve(); } }) as unknown as Promise<unknown>);
  expect((await call(request(value.bytes, device.proof.uploadSecret), selected)).status).toBe(503);
  expect(accessed).toBe(0); expect(disposed).toBe(1);
  const failed = mockEnvironment(async () => disposedReply({ ok: false, error: "unauthorized" }, () => { throw new Error(CANARY); }));
  expect((await call(request(value.bytes, device.proof.uploadSecret), failed)).status).toBe(503);
});

test("checked durable failures are nonterminal fixed HTTP failures", async () => {
  const device = await enroll(), value = batch(device);
  for (const [error, status] of [["invalid_input", 400], ["not_enrolled", 401], ["revoked", 409], ["conflict", 409], ["limit", 409], ["recovery_required", 503], ["storage_invalid", 503], ["clock_regressed", 503]] as const) {
    let disposed = 0;
    const reply = await call(request(value.bytes, device.proof.uploadSecret), mockEnvironment(async () => disposedReply({ ok: false, error }, () => { disposed++; })));
    expect(reply.status).toBe(status); expect(reply.headers.get("content-type")).toBe("application/json; charset=utf-8"); expect(disposed).toBe(1);
  }
});

test("request lifetime registration fails closed before body or namespace acquisition", async () => {
  const device = await enroll(), value = batch(device); let selected = 0;
  const denied: AdmissionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } };
  const handler = createAdmissionHttpHandler(effects);
  const response = await handler(request(value.bytes, device.proof.uploadSecret), denied, { waitUntil() { throw new Error(CANARY); } });
  expect(response.status).toBe(503); expect(selected).toBe(0);
});

test("clock failures and already aborted requests fail closed before body acquisition", async () => {
  const device = await enroll(), value = batch(device); let selected = 0;
  const denied: AdmissionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } };
  for (const now of [() => { throw new Error(CANARY); }, () => NaN, () => -0, () => -1, () => Infinity, () => 8_640_000_000_000_000]) {
    const reply = await call(request(value.bytes, device.proof.uploadSecret), denied, createAdmissionHttpHandler({ ...effects, now }));
    expect(reply.status).toBe(503); expect(await reply.text()).not.toContain(CANARY);
  }
  const controller = new AbortController(); controller.abort();
  const aborted = new Request(request(value.bytes, device.proof.uploadSecret), { signal: controller.signal });
  expect((await call(aborted, denied)).status).toBe(503); expect(selected).toBe(0);
});

test("a stalled body times out without RPC and retains custody through cancellation settlement", async () => {
  const device = await enroll(), value = batch(device), time = clock();
  const entered = deferred<void>(), cleanup = deferred<void>(); let cancelled = 0, selected = 0, settled = false;
  const terminals: Promise<void>[] = [];
  const stream = new ReadableStream<Uint8Array>({
    pull() { entered.resolve(); },
    cancel() { cancelled++; return cleanup.promise; },
  });
  const req = new Request(ADMISSION_HTTP_URL, { method: "POST", headers: request(value.bytes, device.proof.uploadSecret).headers, body: stream });
  const response = createAdmissionHttpHandler(time.effects)(req, { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } },
    { waitUntil: terminal => { terminals.push(terminal); void terminal.then(() => { settled = true; }); } });
  await entered.promise;
  expect(time.timers.size).toBe(2);
  time.advance(PAIRING_HTTP_STAGE_MS);
  expect((await response).status).toBe(503); expect(selected).toBe(0); expect(cancelled).toBe(1); expect(settled).toBe(false);
  cleanup.resolve(); await Promise.all(terminals);
  expect(settled).toBe(true); expect(time.timers.size).toBe(0); expect(stream.locked).toBe(false);
});

test("stream failure, overflow and empty chunks cancel without selecting an account", async () => {
  const device = await enroll(), value = batch(device); let selected = 0;
  const denied: AdmissionHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { selected++; throw new Error(CANARY); } } };
  for (const chunk of [new Uint8Array(), new Uint8Array(MAX_ADMISSION_BATCH_BYTES + 1), CANARY]) {
    let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk as Uint8Array); }, cancel() { cancelled++; } });
    const headers = request(value.bytes, device.proof.uploadSecret).headers; headers.delete("content-length");
    const req = new Request(ADMISSION_HTTP_URL, { method: "POST", headers, body: stream });
    const reply = await call(req, denied);
    expect(reply.status).toBe(400); expect(await reply.text()).not.toContain(CANARY); expect(cancelled).toBe(1); expect(stream.locked).toBe(false);
  }
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(CANARY)); } });
  const reply = await call(new Request(ADMISSION_HTTP_URL, { method: "POST", headers: request(value.bytes, device.proof.uploadSecret).headers, body: stream }), denied);
  expect(reply.status).toBe(400); expect(await reply.text()).not.toContain(CANARY); expect(stream.locked).toBe(false); expect(selected).toBe(0);
});

test("late RPC retains capacity until actual disposal and cannot replace the outward timeout", async () => {
  const device = await enroll(), value = batch(device), time = clock(), handler = createAdmissionHttpHandler(time.effects);
  const pending = Array.from({ length: ADMISSION_HTTP_CAPACITY }, () => deferred<unknown>());
  const entered = deferred<void>(); const terminals: Promise<void>[] = []; let calls = 0, disposed = 0;
  const selected = mockEnvironment(() => { const reply = pending[calls++].promise; if (calls === ADMISSION_HTTP_CAPACITY) entered.resolve(); return reply; });
  const replies = pending.map(() => handler(request(value.bytes, device.proof.uploadSecret), selected, { waitUntil: terminal => { terminals.push(terminal); } }));
  await entered.promise;
  time.advance(ADMISSION_HTTP_RPC_MS);
  expect((await Promise.all(replies)).every(response => response.status === 503)).toBe(true);
  expect((await handler(request(value.bytes, device.proof.uploadSecret), selected, { waitUntil: terminal => { terminals.push(terminal); } })).status).toBe(503);
  expect(calls).toBe(ADMISSION_HTTP_CAPACITY); expect(terminals).toHaveLength(ADMISSION_HTTP_CAPACITY);
  for (const reply of pending) reply.resolve(disposedReply({ ok: false, error: "unauthorized" }, () => { disposed++; }));
  await Promise.all(terminals); expect(disposed).toBe(ADMISSION_HTTP_CAPACITY); expect(time.timers.size).toBe(0);
  expect((await call(request(value.bytes, device.proof.uploadSecret), mockEnvironment(async () => disposedReply({ ok: false, error: "unauthorized" }, () => { disposed++; })), handler)).status).toBe(401);
});

test("delayed timers cannot admit a reply beyond its absolute RPC deadline", async () => {
  const device = await enroll(), value = batch(device), time = clock();
  const reply = deferred<unknown>(), entered = deferred<void>(); let disposed = 0;
  const response = call(request(value.bytes, device.proof.uploadSecret), mockEnvironment(() => { entered.resolve(); return reply.promise; }), createAdmissionHttpHandler(time.effects));
  await entered.promise; time.advance(ADMISSION_HTTP_RPC_MS + 1, false);
  reply.resolve(disposedReply({ ok: false, error: "unauthorized" }, () => { disposed++; }));
  expect((await response).status).toBe(503); expect(disposed).toBe(1); expect(time.timers.size).toBe(0);
});

test.each(["abort", "regression", "worker-deadline"] as const)("%s while an RPC is pending never acknowledges its eventual journal", async reason => {
  const device = await enroll(), value = batch(device), time = clock();
  const journal = success(await stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes }));
  const reply = deferred<unknown>(), entered = deferred<void>(), controller = new AbortController(); let disposed = 0;
  const req = new Request(request(value.bytes, device.proof.uploadSecret), { signal: controller.signal });
  const response = call(req, mockEnvironment(() => { entered.resolve(); return reply.promise; }), createAdmissionHttpHandler(time.effects));
  await entered.promise;
  if (reason === "abort") controller.abort();
  else time.advance(reason === "regression" ? -1 : ADMISSION_HTTP_WORKER_MS, false);
  reply.resolve(disposedReply({ ok: true, value: journal }, () => { disposed++; }));
  expect((await response).status).toBe(503); expect(disposed).toBe(1); expect(time.timers.size).toBe(0);
});
