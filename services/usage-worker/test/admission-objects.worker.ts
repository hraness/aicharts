import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import {
  admissionHex, decodeAdmissionBatch, encodeAdmissionBatch, encodeAdmissionJournal, encodeAdmissionOperation,
} from "../../../lib/usage/admission";
import { encodeUsageBatch } from "../../../lib/usage/wire";
import { createFixtureBatch, fixturePolicy } from "../../../lib/usage/fixtures";
import { ensureAdmissionBatchObject, ensureAdmissionJournalObject } from "../src/admission-objects";

const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("synthetic admission fixture failed");
  return result.value;
};
const allow = () => true;
function fixture(count = 1, firstSequence = 1) {
  const usage = createFixtureBatch();
  const operations = Array.from({ length: count }, (_, index) => {
    const id = new Uint8Array(16); new DataView(id.buffer).setUint32(12, index + 1, true);
    const frame = success(encodeUsageBatch({ ...usage, usage: [{ ...usage.usage[0], id }], prompts: [], intervals: [] }, fixturePolicy));
    return success(encodeAdmissionOperation({ accountId: new Uint8Array(16).fill(11), deviceId: new Uint8Array(32).fill(12),
      generation: new Uint8Array(32).fill(13), action: 1, sequence: firstSequence + index, occurrenceId: id,
      expectedHeadHash: new Uint8Array(32), frame }, fixturePolicy));
  });
  const batch = success(encodeAdmissionBatch(operations, fixturePolicy));
  const decoded = success(decodeAdmissionBatch(batch, fixturePolicy));
  const journal = success(encodeAdmissionJournal(batch, { status: 1, accountJournalRevision: 1, committedAtMs: 123,
    receipts: decoded.operations.map(operation => ({ outcome: 1, headOperationHash: operation.operationHash })) }, fixturePolicy));
  return { batch, journal };
}
function intercept(change: {
  get?: (bucket: R2Bucket, key: string) => Promise<R2ObjectBody | null>;
  put?: (bucket: R2Bucket, args: Parameters<R2Bucket["put"]>) => Promise<R2Object | null>;
}): R2Bucket {
  return new Proxy(env.STAGING, { get(target, property) {
    if (property === "get" && change.get) return (key: string) => change.get!(target, key);
    if (property === "put" && change.put) return (...args: Parameters<R2Bucket["put"]>) => change.put!(target, args);
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
afterEach(async () => { await reset(); });

describe("immutable canonical batch/journal persistence", () => {
  test("stores 256 measurements as one exact batch object and one terminal journal", async () => {
    const { batch, journal } = fixture(256);
    const stored = success(await ensureAdmissionBatchObject(env.STAGING, batch, fixturePolicy, allow));
    const terminal = success(await ensureAdmissionJournalObject(env.STAGING, journal, batch, fixturePolicy, allow));
    expect(stored.byteLength).toBe(82_024); expect(terminal.byteLength).toBe(67_744);
    expect(stored.sha256).toBe(createHash("sha256").update(batch).digest("hex"));
    expect(terminal.sha256).toBe(createHash("sha256").update(journal).digest("hex"));
    expect((await env.STAGING.list()).objects).toHaveLength(2);
    for (const [key, expected] of [[stored.key, batch], [terminal.key, journal]] as const) {
      const object = await env.STAGING.get(key);
      expect(object).not.toBeNull();
      expect(new Uint8Array(await object!.arrayBuffer())).toEqual(expected);
      expect(object!.customMetadata).toEqual({ schemaVersion: "1" });
    }
  });

  test("exact retry reads existing immutable bytes and preserves object versions", async () => {
    const { batch, journal } = fixture();
    const first = success(await ensureAdmissionBatchObject(env.STAGING, batch, fixturePolicy, allow));
    const terminal = success(await ensureAdmissionJournalObject(env.STAGING, journal, batch, fixturePolicy, allow));
    const versions = (await env.STAGING.list()).objects.map(object => [object.key, object.version]);
    const bucket = intercept({ put: async () => { throw new Error("unexpected second write"); } });
    expect(success(await ensureAdmissionBatchObject(bucket, batch, fixturePolicy, allow))).toEqual(first);
    expect(success(await ensureAdmissionJournalObject(bucket, journal, batch, fixturePolicy, allow))).toEqual(terminal);
    expect((await env.STAGING.list()).objects.map(object => [object.key, object.version])).toEqual(versions);
  });

  test("lost committed PUT reply preserves the object and reconciles on an exact later retry", async () => {
    const { batch } = fixture();
    const bucket = intercept({ put: async (target, args) => { await target.put(...args); throw new Error("private provider canary"); } });
    expect(await ensureAdmissionBatchObject(bucket, batch, fixturePolicy, allow)).toEqual({ ok: false, error: "storage_unavailable" });
    const before = (await env.STAGING.list()).objects;
    expect(before).toHaveLength(1);
    success(await ensureAdmissionBatchObject(env.STAGING, batch, fixturePolicy, allow));
    expect((await env.STAGING.list()).objects.map(object => object.version)).toEqual(before.map(object => object.version));
  });

  test("a lost readback is not a successful persistence receipt", async () => {
    const { batch } = fixture(); let gets = 0;
    const bucket = intercept({ get: async (target, key) => { if (++gets === 2) throw new Error("private provider canary"); return target.get(key); } });
    expect(await ensureAdmissionBatchObject(bucket, batch, fixturePolicy, allow)).toEqual({ ok: false, error: "storage_unavailable" });
    expect((await env.STAGING.list()).objects).toHaveLength(1);
    success(await ensureAdmissionBatchObject(env.STAGING, batch, fixturePolicy, allow));
  });

  test("fixed revision keys reject forked journals without replacing the first terminal decision", async () => {
    const first = fixture(), other = fixture(1, 2);
    const receipt = success(await ensureAdmissionJournalObject(env.STAGING, first.journal, first.batch, fixturePolicy, allow));
    expect(await ensureAdmissionJournalObject(env.STAGING, other.journal, other.batch, fixturePolicy, allow))
      .toEqual({ ok: false, error: "storage_conflict" });
    const object = await env.STAGING.get(receipt.key);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(first.journal);
    expect((await env.STAGING.list()).objects).toHaveLength(1);
  });

  test("rejects malformed or oversized numeric containers before any object access", async () => {
    let accessed = false;
    const bucket = intercept({ get: async () => { accessed = true; throw new Error("unexpected access"); } });
    const { batch, journal } = fixture();
    const wrongHash = Uint8Array.from(batch); wrongHash[104 + 152] ^= 1;
    for (const input of [null, "private transcript", new Uint8Array(82_025), wrongHash]) {
      expect(await ensureAdmissionBatchObject(bucket, input, fixturePolicy, allow)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(await ensureAdmissionJournalObject(bucket, journal, fixture(1, 2).batch, fixturePolicy, allow)).toEqual({ ok: false, error: "invalid_input" });
    expect(accessed).toBe(false);
  });

  test("owns canonical inputs before asynchronous storage can mutate the caller's buffers", async () => {
    const { batch } = fixture(), original = Uint8Array.from(batch);
    const bucket = intercept({ get: async (target, key) => { batch.fill(0); return target.get(key); } });
    const receipt = success(await ensureAdmissionBatchObject(bucket, batch, fixturePolicy, allow));
    const object = await env.STAGING.get(receipt.key);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(original);
  });

  test("closed fences prevent object access or withhold success after an uncertain write", async () => {
    const { batch } = fixture(); let opened = false, admitted = true;
    const noAccess = intercept({ get: async () => { opened = true; return null; } });
    expect(await ensureAdmissionBatchObject(noAccess, batch, fixturePolicy, () => false)).toEqual({ ok: false, error: "admission_closed" });
    expect(opened).toBe(false);
    const closeAfterRead = intercept({ get: async (target, key) => { admitted = false; return target.get(key); } });
    expect(await ensureAdmissionBatchObject(closeAfterRead, batch, fixturePolicy, () => admitted)).toEqual({ ok: false, error: "admission_closed" });
    expect((await env.STAGING.list()).objects).toHaveLength(0);
    admitted = true;
    const closeAfterWrite = intercept({ put: async (target, args) => { const result = await target.put(...args); admitted = false; return result; } });
    expect(await ensureAdmissionBatchObject(closeAfterWrite, batch, fixturePolicy, () => admitted)).toEqual({ ok: false, error: "admission_closed" });
    expect((await env.STAGING.list()).objects).toHaveLength(1);
  });

  test("checks actual readback bytes even when size and checksum metadata claim a match", async () => {
    const { batch } = fixture();
    success(await ensureAdmissionBatchObject(env.STAGING, batch, fixturePolicy, allow));
    let cancelled = false;
    const bucket = intercept({ get: async (target, key) => {
      const object = await target.get(key);
      if (!object) return null;
      const corrupt = Uint8Array.from(batch); corrupt[0] ^= 1;
      void object.body.cancel();
      return new Proxy(object, { get(original, property) {
        if (property === "body") return new ReadableStream({ start(controller) { controller.enqueue(corrupt); }, cancel() { cancelled = true; } });
        return Reflect.get(original, property, original);
      } });
    } });
    expect(await ensureAdmissionBatchObject(bucket, batch, fixturePolicy, allow)).toEqual({ ok: false, error: "storage_conflict" });
    expect(cancelled).toBe(true);
  });

  test("metadata extensions and zero-byte readback chunks fail closed", async () => {
    const { batch } = fixture();
    success(await ensureAdmissionBatchObject(env.STAGING, batch, fixturePolicy, allow));
    for (const mode of ["metadata", "empty", "checksum"] as const) {
      const bucket = intercept({ get: async (target, key) => {
        const object = await target.get(key);
        if (!object) return null;
        return new Proxy(object, { get(original, property) {
          if (mode === "metadata" && property === "customMetadata") return { schemaVersion: "1", transcript: "private canary" };
          if (mode === "checksum" && property === "checksums") return { sha256: new Uint8Array(32).buffer };
          if (mode === "empty" && property === "body") {
            void object.body.cancel();
            return new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array()); } });
          }
          return Reflect.get(original, property, original);
        } });
      } });
      expect(await ensureAdmissionBatchObject(bucket, batch, fixturePolicy, allow)).toEqual({ ok: false, error: "storage_conflict" });
    }
  });

  test("key scope derives only from canonical numeric account/generation and domain-separated batch identity", async () => {
    const { batch } = fixture(), decoded = success(decodeAdmissionBatch(batch, fixturePolicy));
    const result = success(await ensureAdmissionBatchObject(env.STAGING, batch, fixturePolicy, allow));
    expect(result.key).toBe(`usage-admission/v1/${admissionHex(decoded.accountId)}/${admissionHex(decoded.generation)}/batches/${admissionHex(decoded.batchHash)}.aicb`);
    expect(Object.keys(result).sort()).toEqual(["byteLength", "key", "sha256"]);
    expect(JSON.stringify(result)).not.toContain("private canary");
  });
});
