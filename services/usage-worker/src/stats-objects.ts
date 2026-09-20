import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../lib/result";
import { equalAdmissionBytes, admissionHex } from "../../../lib/usage/admission";
import { type StatsUpload, type StatsReceipt } from "../../../lib/usage/stats-http-contract";
import { enrollmentStorageCall } from "./namespace-anchor";
import { statsUploadText } from "./stats-state";

export type StatsObjectError = "invalid_input" | "storage_unavailable" | "storage_conflict" | "admission_closed";
export type StatsObjectReceipt = Readonly<{ key: string; sha256: string; byteLength: number }>;
type OwnedObject = { key: string; bytes: Uint8Array<ArrayBuffer>; mediaType: string; sha256: Uint8Array<ArrayBuffer> };
const discard = (body: ReadableStream<Uint8Array>) => { void body.cancel().catch(() => undefined); };
const digest = (bytes: Uint8Array) => Uint8Array.from(createHash("sha256").update(bytes).digest());
const prefix = (request: StatsUpload) => `usage-stats/v2/${request.accountId}/${request.generation}`;
function object(key: string, text: string): OwnedObject {
  const bytes = Uint8Array.from(new TextEncoder().encode(text));
  return { key, bytes, mediaType: "application/vnd.aicharts.stats-v2+json", sha256: digest(bytes) };
}
function metadata(object: R2ObjectBody, expected: OwnedObject): boolean {
  const custom = object.customMetadata, http = object.httpMetadata;
  const absent = ["contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"];
  return object.size === expected.bytes.length && object.checksums.sha256 !== undefined
    && equalAdmissionBytes(new Uint8Array(object.checksums.sha256), expected.sha256)
    && custom !== undefined && Object.keys(custom).length === 1 && custom.schemaVersion === "2"
    && http !== undefined && http.contentType === expected.mediaType
    && Object.keys(http).every(key => key === "contentType" || absent.includes(key))
    && absent.every(key => (http as Record<string, unknown>)[key] === undefined);
}

async function matchesBody(body: ReadableStream<Uint8Array>, expected: Uint8Array): Promise<boolean> {
  const reader = body.getReader();
  let offset = 0, completed = false;
  const read = (async () => {
    // Each admitted chunk consumes at least one byte. Even immediate empty
    // chunks cannot keep this loop alive or renew its one whole-body deadline.
    while (offset <= expected.length) {
      const next = await reader.read();
      if (next.done) { completed = true; return offset === expected.length; }
      if (!(next.value instanceof Uint8Array) || next.value.length === 0 || next.value.length > expected.length - offset
        || !equalAdmissionBytes(next.value, expected.subarray(offset, offset + next.value.length))) return false;
      offset += next.value.length;
    }
    return false;
  })();
  try { return await enrollmentStorageCall(read); }
  finally {
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function readExact(bucket: R2Bucket, expected: OwnedObject): Promise<"absent" | "match" | "conflict"> {
  const object = await enrollmentStorageCall(bucket.get(expected.key), value => { if (value) discard(value.body); });
  if (object === null) return "absent";
  if (!metadata(object, expected)) { discard(object.body); return "conflict"; }
  return await matchesBody(object.body, expected.bytes) ? "match" : "conflict";
}

async function ensureObject(bucket: R2Bucket, expected: OwnedObject, admitted: () => boolean): Promise<Result<StatsObjectReceipt, StatsObjectError>> {
  try {
    if (!admitted()) return err("admission_closed");
    let existing = await readExact(bucket, expected);
    if (!admitted()) return err("admission_closed");
    if (existing === "absent") {
      await enrollmentStorageCall(bucket.put(expected.key, expected.bytes, {
        onlyIf: new Headers({ "if-none-match": "*" }), sha256: expected.sha256.buffer,
        httpMetadata: { contentType: expected.mediaType }, customMetadata: { schemaVersion: "2" },
      }));
      if (!admitted()) return err("admission_closed");
      existing = await readExact(bucket, expected);
    }
    if (!admitted()) return err("admission_closed");
    if (existing !== "match") return err("storage_conflict");
    return ok({ key: expected.key, sha256: admissionHex(expected.sha256), byteLength: expected.bytes.length });
  } catch { return err("storage_unavailable"); }
}


/** Durable intent is reserved before either immutable object operation. */
export async function ensureStatsSnapshot(bucket: R2Bucket, request: StatsUpload, admitted: () => boolean): Promise<Result<StatsObjectReceipt, StatsObjectError>> {
  const text = statsUploadText(request), hash = createHash("sha256").update(text).digest("hex");
  return ensureObject(bucket, object(`${prefix(request)}/snapshots/${hash}.json`, text), admitted);
}
export async function ensureStatsReceipt(bucket: R2Bucket, request: StatsUpload, receipt: StatsReceipt, admitted: () => boolean): Promise<Result<StatsObjectReceipt, StatsObjectError>> {
  // A revoked intent may have retained this planned receipt without publishing.
  // Bind its key to the body too, so a later legitimate operation can use the
  // same uncommitted revision without overwriting or colliding with that orphan.
  return ensureObject(bucket, object(`${prefix(request)}/receipts/${String(receipt.revision).padStart(16, "0")}-${receipt.bodyHash}.json`, JSON.stringify(receipt)), admitted);
}
