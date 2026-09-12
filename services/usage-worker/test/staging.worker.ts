import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createFixtureBatch, fixturePolicy } from "../../../lib/usage/fixtures";
import { encodeUsageBatch, MAX_PACKET_BYTES, MAX_RECORDS, type Policy } from "../../../lib/usage/wire";
import {
  stageUsageBatch, STAGING_MAX_READ_CHUNKS, STAGING_READ_TIMEOUT_MS,
  USAGE_MEDIA_TYPE, type StagedReceipt,
} from "../src/staging";

const scope = "11".repeat(32);
let nextScope = 0;
const isolatedScope = () => (++nextScope).toString(16).padStart(64, "0");

function bytes(): Uint8Array {
  const encoded = encodeUsageBatch(createFixtureBatch(), fixturePolicy);
  if (!encoded.ok) throw new Error("invalid_synthetic_fixture");
  return encoded.value;
}

function request(body: BodyInit = bytes(), headers: HeadersInit = {}, signal?: AbortSignal): Request {
  return new Request("https://aicharts.invalid/stage?ignored=synthetic", {
    method: "POST", body, signal,
    headers: { "content-type": USAGE_MEDIA_TYPE, ...Object.fromEntries(new Headers(headers)) },
  });
}

const keyFor = (accountScope: string, receipt: StagedReceipt) => `staging/v1/${accountScope}/${receipt.sha256}.aicu`;

async function noObjects(accountScope: string): Promise<void> {
  expect((await env.STAGING.list({ prefix: `staging/v1/${accountScope}/` })).objects).toEqual([]);
}

async function createStaged(accountScope: string) {
  const result = await stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("synthetic_staging_failed");
  const key = keyFor(accountScope, result.value);
  const object = await env.STAGING.get(key);
  if (!object) throw new Error("synthetic_object_missing");
  const body = await object.arrayBuffer();
  return { result, key, object, body };
}

afterEach(() => vi.useRealTimers());

describe("numeric-only private R2 staging", () => {
  test("local R2 exposes exact supplied metadata and SHA-256", async () => {
    const input = bytes();
    const key = `synthetic-r2-contract/${isolatedScope()}`;
    const digest = await crypto.subtle.digest("SHA-256", input);
    const put = await env.STAGING.put(key, input, {
      onlyIf: new Headers({ "if-none-match": "*" }), sha256: digest,
      customMetadata: { schemaVersion: "1" }, httpMetadata: { contentType: USAGE_MEDIA_TYPE },
    });
    expect(put).not.toBeNull();
    const object = await env.STAGING.get(key);
    expect(object).not.toBeNull();
    if (!object) return;
    expect(Object.keys(object.customMetadata ?? {})).toEqual(["schemaVersion"]);
    expect(object.httpMetadata).toStrictEqual({
      contentType: USAGE_MEDIA_TYPE, contentLanguage: undefined, contentDisposition: undefined,
      contentEncoding: undefined, cacheControl: undefined, cacheExpiry: undefined,
    });
    expect(object.checksums.sha256).toBeDefined();
    expect(new Uint8Array(object.checksums.sha256!)).toEqual(new Uint8Array(digest));
    expect(new Uint8Array(await object.arrayBuffer())).toEqual(input);
  });
  test("stores only canonical binary and fixed derived metadata; the receipt is not acceptance", async () => {
    const accountScope = isolatedScope();
    const input = bytes();
    const result = await stageUsageBatch(env.STAGING, request(input, {
      "x-object-key": "forbidden-client-key", "x-session-text": "synthetic-private-canary",
      "x-amz-meta-chat": "synthetic-private-canary", "authorization": "synthetic-unused-token",
    }), fixturePolicy, accountScope);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value).toEqual({
      status: "staged", accepted: false, sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      byteLength: 240, utcDay: 20_000, registryRevision: 1,
      usageCount: 1, promptCount: 1, intervalCount: 1,
    });
    const object = await env.STAGING.get(keyFor(accountScope, result.value));
    expect(object).not.toBeNull();
    if (!object) return;
    expect(new Uint8Array(await object.arrayBuffer())).toEqual(input);
    expect(object.httpMetadata).toEqual({ contentType: USAGE_MEDIA_TYPE });
    expect(object.customMetadata).toEqual({
      schemaVersion: "1", sha256: result.value.sha256, byteLength: "240", utcDay: "20000",
      registryRevision: "1", usageCount: "1", promptCount: "1", intervalCount: "1",
    });
    expect((await env.STAGING.list({ prefix: `staging/v1/${accountScope}/` })).objects).toHaveLength(1);
    expect(await env.STAGING.head("forbidden-client-key")).toBeNull();
    expect(JSON.stringify(result)).not.toContain("synthetic-private-canary");
  });

  test("identical retries retain the original object version", async () => {
    const accountScope = isolatedScope();
    const first = await createStaged(accountScope);
    const again = await stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope);
    expect(again).toEqual(first.result);
    expect((await env.STAGING.head(first.key))?.version).toBe(first.object.version);
    expect((await env.STAGING.list({ prefix: `staging/v1/${accountScope}/` })).objects).toHaveLength(1);
  });

  test.each(["put reply lost", "readback reply lost"] as const)("reconciles an uncertain committed write after %s", async failure => {
    const accountScope = isolatedScope();
    // Fault injection wraps only the reply; the actual synthetic R2 operation
    // still commits. A subsequent call uses the real binding and same bytes.
    const bucket = new Proxy(env.STAGING, {
      get(target, property) {
        if (property === "put" && failure === "put reply lost") {
          return async (...args: Parameters<R2Bucket["put"]>) => {
            await target.put(...args);
            throw new Error("private-provider-failure-canary");
          };
        }
        if (property === "get" && failure === "readback reply lost") {
          return async (key: string) => {
            const object = await target.get(key);
            if (object) await object.body.cancel();
            throw new Error("private-provider-failure-canary");
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await stageUsageBatch(bucket, request(), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "storage_unavailable" });
    const staged = await env.STAGING.list({ prefix: `staging/v1/${accountScope}/` });
    expect(staged.objects).toHaveLength(1);
    const first = staged.objects[0];
    const retry = await stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.status).toBe("staged");
    expect(retry.value.accepted).toBe(false);
    expect((await env.STAGING.head(first.key))?.version).toBe(first.version);
    expect(new Uint8Array(await (await env.STAGING.get(first.key))!.arrayBuffer())).toEqual(bytes());
  });

  test("simultaneous conditional creates converge on one exact object", async () => {
    const accountScope = isolatedScope();
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope)));
    expect(results.every(result => result.ok)).toBe(true);
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
    const objects = await env.STAGING.list({ prefix: `staging/v1/${accountScope}/` });
    expect(objects.objects).toHaveLength(1);
    expect(new Uint8Array(await (await env.STAGING.get(objects.objects[0].key))!.arrayBuffer())).toEqual(bytes());
  });

  test.each(["put", "get"] as const)("bounds a late %s reply and reconciles the committed object without overwrite", async operation => {
    const accountScope = isolatedScope();
    let started!: () => void;
    const operationStarted = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    let lateReadCancelled = false;
    const bucket = new Proxy(env.STAGING, {
      get(target, property) {
        if (property === operation) {
          return async (key: string, ...args: unknown[]) => {
            const object = operation === "get" ? await target.get(key)
              : await target.put(key, args[0] as Uint8Array, args[1] as R2PutOptions);
            let response = object;
            if (object && "body" in object && object.body instanceof ReadableStream) {
              const original = object.body;
              const stream = new ReadableStream<Uint8Array>({
                cancel() { lateReadCancelled = true; return original.cancel(); },
              });
              response = new Proxy(object, { get: (value, key) => key === "body" ? stream : Reflect.get(value, key, value) });
            }
            const late = new Promise<typeof object>(resolve => { release = () => resolve(response); });
            started();
            return late;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    vi.useFakeTimers();
    const pending = stageUsageBatch(bucket, request(), fixturePolicy, accountScope);
    await operationStarted;
    await vi.advanceTimersByTimeAsync(STAGING_READ_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: "storage_unavailable" });
    vi.useRealTimers();
    release();
    // Drain the late-result cleanup without sleeping or retrying the operation.
    await Promise.resolve();
    await Promise.resolve();
    if (operation === "get") expect(lateReadCancelled).toBe(true);
    const objects = await env.STAGING.list({ prefix: `staging/v1/${accountScope}/` });
    expect(objects.objects).toHaveLength(1);
    const original = objects.objects[0];
    expect((await stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope)).ok).toBe(true);
    expect((await env.STAGING.head(original.key))?.version).toBe(original.version);
  });

  test.each(["different bytes", "truncated", "oversized", "stalled"] as const)(
    "checks the existing body independently of matching metadata and checksums: %s", async failure => {
      const accountScope = isolatedScope();
      const fixture = await createStaged(accountScope);
      let reached!: () => void;
      const reading = new Promise<void>(resolve => { reached = resolve; });
      let cancelled = false;
      const bucket = new Proxy(env.STAGING, {
        get(target, property) {
          if (property === "get") return async (key: string) => {
            const object = await target.get(key);
            if (!object) return null;
            const body = new Uint8Array(await object.arrayBuffer());
            body[239] ^= 1;
            const changed = failure === "truncated" ? body.slice(0, -1)
              : failure === "oversized" ? new Uint8Array(body.length + 1) : body;
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                if (failure !== "stalled") { controller.enqueue(changed); controller.close(); }
              },
              pull() { reached(); },
              cancel() { cancelled = true; return new Promise<void>(() => undefined); },
            });
            return new Proxy(object, { get: (value, key) => key === "body" ? stream : Reflect.get(value, key, value) });
          };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      if (failure === "stalled") vi.useFakeTimers();
      const pending = stageUsageBatch(bucket, request(), fixturePolicy, accountScope);
      if (failure === "stalled") {
        await reading;
        await vi.advanceTimersByTimeAsync(STAGING_READ_TIMEOUT_MS);
      }
      expect(await pending).toEqual({ ok: false, error: failure === "stalled" ? "storage_unavailable" : "storage_conflict" });
      vi.useRealTimers();
      if (failure === "stalled") expect(cancelled).toBe(true);
      expect((await env.STAGING.head(fixture.key))?.version).toBe(fixture.object.version);
      expect(new Uint8Array(await (await env.STAGING.get(fixture.key))!.arrayBuffer())).toEqual(bytes());
    },
  );

  test("account routing scope, not the wire provider account ID, partitions staging", async () => {
    const left = await createStaged(isolatedScope());
    const right = await createStaged(isolatedScope());
    expect(left.result.value.sha256).toBe(right.result.value.sha256);
    expect(left.key).not.toBe(right.key);
    expect(new Uint8Array(left.body)).toEqual(new Uint8Array(right.body));
  });

  test.each(["", "../escape", "ff".repeat(16), "AA".repeat(32), "11".repeat(33), `${scope}/suffix`])(
    "rejects a noncanonical account scope %s", async accountScope => {
      expect(await stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope))
        .toEqual({ ok: false, error: "invalid_scope" });
    },
  );

  test("rejects non-string scopes and non-Request values without coercion", async () => {
    let coerced = false;
    const fakeScope = { toString() { coerced = true; return scope; } };
    expect(await stageUsageBatch(env.STAGING, request(), fixturePolicy, fakeScope)).toEqual({ ok: false, error: "invalid_scope" });
    expect(coerced).toBe(false);
    for (const input of [null, {}, "private-request-canary"]) {
      expect(await stageUsageBatch(env.STAGING, input, fixturePolicy, scope)).toEqual({ ok: false, error: "invalid_request" });
    }
  });

  test("header refusal cancels unread input without waiting on its cancel hook", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => undefined); } });
    expect(await stageUsageBatch(env.STAGING, request(body, { "content-type": "application/json" }), fixturePolicy, isolatedScope()))
      .toEqual({ ok: false, error: "unsupported_media_type" });
    expect(cancelled).toBe(true);
  });

  test.each([
    [{ "content-type": "application/octet-stream" }, "unsupported_media_type"],
    [{ "content-type": `${USAGE_MEDIA_TYPE}; charset=utf-8` }, "unsupported_media_type"],
    [{ "content-type": "application/json" }, "unsupported_media_type"],
    [{ "content-type": "multipart/form-data; boundary=synthetic" }, "unsupported_media_type"],
    [{ "content-encoding": "gzip" }, "unsupported_content_encoding"],
    [{ "content-encoding": "identity" }, "unsupported_content_encoding"],
    [{ "content-disposition": "attachment; filename=synthetic.txt" }, "invalid_request"],
    [{ "content-range": "bytes 0-239/240" }, "invalid_request"],
    [{ trailer: "x-session-text" }, "invalid_request"],
    [{ "content-length": "-1" }, "invalid_content_length"],
    [{ "content-length": "0240" }, "invalid_content_length"],
    [{ "content-length": "240,240" }, "invalid_content_length"],
    [{ "content-length": "241" }, "invalid_content_length"],
    [{ "content-length": String(MAX_PACKET_BYTES + 1) }, "body_too_large"],
  ] as const)("rejects forbidden request framing %j", async (headers, error) => {
    const accountScope = isolatedScope();
    expect(await stageUsageBatch(env.STAGING, request(bytes(), headers), fixturePolicy, accountScope))
      .toEqual({ ok: false, error });
    await noObjects(accountScope);
  });

  test("rejects missing MIME, missing body, consumed body, and non-POST requests", async () => {
    const accountScope = isolatedScope();
    const missingType = request();
    missingType.headers.delete("content-type");
    expect(await stageUsageBatch(env.STAGING, missingType, fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "unsupported_media_type" });
    for (const input of [new Request("https://aicharts.invalid"), new Request("https://aicharts.invalid", { method: "POST" })]) {
      expect(await stageUsageBatch(env.STAGING, input, fixturePolicy, accountScope)).toEqual({ ok: false, error: "invalid_request" });
    }
    const consumed = request();
    await consumed.arrayBuffer();
    expect(await stageUsageBatch(env.STAGING, consumed, fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "invalid_request" });
    await noObjects(accountScope);
  });

  test.each([
    ["truncated", (value: Uint8Array) => value.slice(0, -1)],
    ["trailing string", (value: Uint8Array) => new Uint8Array([...value, ...new TextEncoder().encode("synthetic-chat")])],
    ["JSON string body", () => new TextEncoder().encode('{"messages":["synthetic-chat"]}')],
    ["empty", () => new Uint8Array()],
    ["bad magic", (value: Uint8Array) => { value[0] = 0; return value; }],
    ["reserved field", (value: Uint8Array) => { value[6] = 1; return value; }],
    ["unknown provider", (value: Uint8Array) => { value[76] = 3; return value; }],
    ["forbidden context tier", (value: Uint8Array) => { value[84] = 1; return value; }],
    ["wrong registry", (value: Uint8Array) => { value[20] = 2; return value; }],
    ["zero occurrence ID", (value: Uint8Array) => { value.fill(0, 24, 40); return value; }],
  ] as const)("rejects %s without storing a raw packet", async (_name, mutate) => {
    const accountScope = isolatedScope();
    expect(await stageUsageBatch(env.STAGING, request(mutate(bytes())), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "invalid_packet" });
    await noObjects(accountScope);
  });

  test("snapshots trusted policy before awaiting caller-controlled input", async () => {
    const accountScope = isolatedScope();
    const policy = { firstDay: 20_000, lastDay: 20_000, registry: { revision: 1, models: [] } };
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { source = controller; },
    });
    const pending = stageUsageBatch(env.STAGING, request(body), policy, accountScope);
    policy.registry.revision = 2;
    source.enqueue(bytes());
    source.close();
    expect((await pending).ok).toBe(true);
    expect(await stageUsageBatch(env.STAGING, request(), { ...fixturePolicy, firstDay: 20_001 } as Policy, isolatedScope()))
      .toEqual({ ok: false, error: "invalid_policy" });
  });

  test("accepts arbitrary chunk boundaries without a Content-Length", async () => {
    const accountScope = isolatedScope();
    const input = bytes();
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === input.length) controller.close();
        else controller.enqueue(input.slice(offset, ++offset));
      },
    });
    const result = await stageUsageBatch(env.STAGING, request(body), fixturePolicy, accountScope);
    expect(result.ok).toBe(true);
    if (result.ok) expect(new Uint8Array(await (await env.STAGING.get(keyFor(accountScope, result.value)))!.arrayBuffer())).toEqual(input);
  });

  test("accepts the exact maximum legal packet", async () => {
    const fixture = createFixtureBatch();
    const id = (index: number) => {
      const result = new Uint8Array(16);
      new DataView(result.buffer).setUint32(12, index + 1);
      return result;
    };
    const encoded = encodeUsageBatch({
      ...fixture,
      usage: Array.from({ length: MAX_RECORDS }, (_, index) => ({ ...fixture.usage[0], id: id(index) })),
      prompts: Array.from({ length: MAX_RECORDS }, (_, index) => ({ ...fixture.prompts[0], id: id(index) })),
      intervals: Array.from({ length: MAX_RECORDS }, (_, index) => ({ ...fixture.intervals[0], executionId: id(index) })),
    }, fixturePolicy);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value.byteLength).toBe(MAX_PACKET_BYTES);
    const result = await stageUsageBatch(env.STAGING, request(encoded.value), fixturePolicy, isolatedScope());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.byteLength).toBe(MAX_PACKET_BYTES);
  });

  test("rejects an oversized chunk before copying it and does not await a hanging cancel hook", async () => {
    const accountScope = isolatedScope();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_PACKET_BYTES + 1)); },
      cancel() { cancelled = true; return new Promise<void>(() => undefined); },
    });
    expect(await stageUsageBatch(env.STAGING, request(body), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "body_too_large" });
    expect(cancelled).toBe(true);
    await noObjects(accountScope);
  });

  test("caps cumulative chunk bytes rather than trusting the declared length", async () => {
    const accountScope = isolatedScope();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PACKET_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    expect(await stageUsageBatch(env.STAGING, request(body, { "content-length": "240" }), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "body_too_large" });
    await noObjects(accountScope);
  });

  test("bounds endlessly empty chunks even when they could starve timers", async () => {
    const accountScope = isolatedScope();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; controller.enqueue(new Uint8Array()); } });
    expect(await stageUsageBatch(env.STAGING, request(body), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "body_unreadable" });
    expect(pulls).toBeLessThanOrEqual(STAGING_MAX_READ_CHUNKS + 1);
    await noObjects(accountScope);
  });

  test("body errors are fixed results without their private error text", async () => {
    const accountScope = isolatedScope();
    const body = new ReadableStream<Uint8Array>({ pull() { throw new Error("synthetic-private-error"); } });
    expect(await stageUsageBatch(env.STAGING, request(body), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "body_unreadable" });
    await noObjects(accountScope);
  });

  test("already-aborted input and cancellation of a stalled stream cannot stage", async () => {
    const accountScope = isolatedScope();
    const aborted = new AbortController();
    aborted.abort("synthetic-private-reason");
    expect(await stageUsageBatch(env.STAGING, request(bytes(), {}, aborted.signal), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "body_cancelled" });
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => undefined); } });
    const pending = stageUsageBatch(env.STAGING, request(body, {}, controller.signal), fixturePolicy, accountScope);
    controller.abort("synthetic-private-reason");
    expect(await pending).toEqual({ ok: false, error: "body_cancelled" });
    expect(cancelled).toBe(true);
    await noObjects(accountScope);
  });

  test("a stalled body hits the fixed deadline and cancels without waiting", async () => {
    const accountScope = isolatedScope();
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => undefined); } });
    const pending = stageUsageBatch(env.STAGING, request(body), fixturePolicy, accountScope);
    await vi.advanceTimersByTimeAsync(STAGING_READ_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: "body_timeout" });
    expect(cancelled).toBe(true);
    vi.useRealTimers();
    await noObjects(accountScope);
  });

  test.each(["body", "oversize", "metadata", "extra metadata", "http metadata", "checksum"] as const)(
    "rejects a conflicting existing object's %s without overwriting it", async corruption => {
      const accountScope = isolatedScope();
      const fixture = await createStaged(accountScope);
      const body = corruption === "oversize" ? new Uint8Array(MAX_PACKET_BYTES + 1)
        : new Uint8Array(fixture.body);
      if (corruption === "body") body[239] ^= 1;
      const customMetadata = { ...fixture.object.customMetadata };
      if (corruption === "metadata") customMetadata.utcDay = "1";
      if (corruption === "extra metadata") customMetadata.session = "synthetic-private-canary";
      await env.STAGING.put(fixture.key, body, {
        customMetadata,
        httpMetadata: corruption === "http metadata" ? { contentType: USAGE_MEDIA_TYPE, contentDisposition: "synthetic.txt" }
          : { contentType: USAGE_MEDIA_TYPE },
        ...(corruption === "checksum" ? {} : { sha256: await crypto.subtle.digest("SHA-256", body) }),
      });
      const corrupted = await env.STAGING.head(fixture.key);
      expect(await stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope))
        .toEqual({ ok: false, error: "storage_conflict" });
      expect((await env.STAGING.head(fixture.key))?.version).toBe(corrupted?.version);
      expect(new Uint8Array(await (await env.STAGING.get(fixture.key))!.arrayBuffer())).toEqual(body);
    },
  );

  test.each([
    ["contentLanguage", "en"], ["contentDisposition", "attachment"],
    ["contentEncoding", "gzip"], ["cacheControl", "public"],
    ["cacheExpiry", new Date("2030-01-01T00:00:00.000Z")],
  ] as const)("rejects a populated optional R2 HTTP metadata field: %s", async (field, value) => {
    const accountScope = isolatedScope();
    const fixture = await createStaged(accountScope);
    await env.STAGING.put(fixture.key, fixture.body, {
      sha256: await crypto.subtle.digest("SHA-256", fixture.body),
      customMetadata: fixture.object.customMetadata,
      httpMetadata: { contentType: USAGE_MEDIA_TYPE, [field]: value },
    });
    const corrupted = await env.STAGING.head(fixture.key);
    expect(await stageUsageBatch(env.STAGING, request(), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "storage_conflict" });
    expect((await env.STAGING.head(fixture.key))?.version).toBe(corrupted?.version);
  });

  test.each([undefined, "synthetic-private-canary"])("rejects unknown R2 HTTP metadata fields even when empty (%s)", async injectedValue => {
    const accountScope = isolatedScope();
    const fixture = await createStaged(accountScope);
    const bucket = new Proxy(env.STAGING, {
      get(target, property) {
        if (property === "get") return async (key: string) => {
          const object = await target.get(key);
          if (!object) return null;
          // An independent facade injects corruption without changing the
          // runtime's native object properties or their Proxy invariants.
          return new Proxy(Object.create(null) as R2ObjectBody, {
            get: (_target, key) => key === "httpMetadata" ? { ...object.httpMetadata, unexpected: injectedValue } : Reflect.get(object, key, object),
          });
        };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await stageUsageBatch(bucket, request(), fixturePolicy, accountScope))
      .toEqual({ ok: false, error: "storage_conflict" });
    expect((await env.STAGING.head(fixture.key))?.version).toBe(fixture.object.version);
  });
});
