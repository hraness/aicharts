import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../lib/result";
import {
  admissionHex, decodeAdmissionBatch, decodeAdmissionJournal, equalAdmissionBytes,
  MAX_ADMISSION_BATCH_BYTES, MAX_ADMISSION_JOURNAL_BYTES, type AdmissionBatch,
} from "../../../lib/usage/admission";
import type { Policy } from "../../../lib/usage/wire";
import { enrollmentStorageCall } from "./namespace-anchor";

export type AdmissionObjectError = "invalid_input" | "storage_unavailable" | "storage_conflict" | "admission_closed";
export type AdmissionObjectReceipt = Readonly<{ key: string; sha256: string; byteLength: number }>;
type OwnedObject = { key: string; bytes: Uint8Array<ArrayBuffer>; mediaType: string; sha256: Uint8Array<ArrayBuffer> };
const batchType = "application/vnd.aicharts.usage-batch-v1";
const journalType = "application/vnd.aicharts.usage-journal-v1";
const sha256 = (bytes: Uint8Array) => Uint8Array.from(createHash("sha256").update(bytes).digest());
const discard = (body: ReadableStream<Uint8Array>) => { void body.cancel().catch(() => undefined); };
const prefix = (batch: AdmissionBatch) => `usage-admission/v1/${admissionHex(batch.accountId)}/${admissionHex(batch.generation)}`;

function ownedBatch(input: unknown, policy: Policy): Result<{ batch: AdmissionBatch; object: OwnedObject }, AdmissionObjectError> {
  const checked = decodeAdmissionBatch(input, policy);
  if (!checked.ok) return err("invalid_input");
  const batch = checked.value, bytes = Uint8Array.from(batch.bytes);
  return ok({ batch, object: { key: `${prefix(batch)}/batches/${admissionHex(batch.batchHash)}.aicb`, bytes, mediaType: batchType, sha256: sha256(bytes) } });
}

function ownedJournal(input: unknown, batchInput: unknown, policy: Policy): Result<OwnedObject, AdmissionObjectError> {
  const batch = ownedBatch(batchInput, policy);
  if (!batch.ok) return batch;
  const checked = decodeAdmissionJournal(input, batch.value.batch.bytes, policy);
  if (!checked.ok) return err("invalid_input");
  const journal = checked.value, bytes = Uint8Array.from(journal.bytes);
  return ok({ key: `${prefix(batch.value.batch)}/journal/${String(journal.accountJournalRevision).padStart(16, "0")}.aicj`,
    bytes, mediaType: journalType, sha256: sha256(bytes) });
}

function metadata(object: R2ObjectBody, expected: OwnedObject): boolean {
  const custom = object.customMetadata, http = object.httpMetadata;
  const absent = ["contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"];
  return object.size === expected.bytes.length && object.checksums.sha256 !== undefined
    && equalAdmissionBytes(new Uint8Array(object.checksums.sha256), expected.sha256)
    && custom !== undefined && Object.keys(custom).length === 1 && custom.schemaVersion === "1"
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

async function ensureObject(bucket: R2Bucket, expected: OwnedObject, admitted: () => boolean): Promise<Result<AdmissionObjectReceipt, AdmissionObjectError>> {
  try {
    if (!admitted()) return err("admission_closed");
    let existing = await readExact(bucket, expected);
    if (!admitted()) return err("admission_closed");
    if (existing === "absent") {
      await enrollmentStorageCall(bucket.put(expected.key, expected.bytes, {
        onlyIf: new Headers({ "if-none-match": "*" }), sha256: expected.sha256.buffer,
        httpMetadata: { contentType: expected.mediaType }, customMetadata: { schemaVersion: "1" },
      }));
      if (!admitted()) return err("admission_closed");
      existing = await readExact(bucket, expected);
    }
    if (!admitted()) return err("admission_closed");
    if (existing !== "match") return err("storage_conflict");
    return ok({ key: expected.key, sha256: admissionHex(expected.sha256), byteLength: expected.bytes.length });
  } catch { return err("storage_unavailable"); }
}

/** Caller must already retain these exact bytes in authenticated durable custody. */
export async function ensureAdmissionBatchObject(
  bucket: R2Bucket, input: unknown, policy: Policy, admitted: () => boolean,
): Promise<Result<AdmissionObjectReceipt, AdmissionObjectError>> {
  const owned = ownedBatch(input, policy);
  return owned.ok ? ensureObject(bucket, owned.value.object, admitted) : owned;
}

/**
 * Only a same-account irreversible terminal decision may call this. Object
 * presence alone never authorizes a batch or publishes its measurement heads.
 */
export async function ensureAdmissionJournalObject(
  bucket: R2Bucket, input: unknown, batchInput: unknown, policy: Policy, admitted: () => boolean,
): Promise<Result<AdmissionObjectReceipt, AdmissionObjectError>> {
  const owned = ownedJournal(input, batchInput, policy);
  return owned.ok ? ensureObject(bucket, owned.value, admitted) : owned;
}

// Keep the persistence allocation envelope explicit alongside the wire limits.
export const ADMISSION_OBJECT_MAX_BYTES = Math.max(MAX_ADMISSION_BATCH_BYTES, MAX_ADMISSION_JOURNAL_BYTES);
