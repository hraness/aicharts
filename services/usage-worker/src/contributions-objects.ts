import { contributionAccount, contributionBatchText, contributionHash, contributionIdentity, CONTRIBUTION_MAX_BYTES,
  ContributionFault, parseContributionJson, parseContributionReference, contributionPayloadHash, type ContributionBatch, type ContributionReference, type ContributionResult } from "../../../lib/usage/contributions";
import { admissionHex, decodeAdmissionBatch, equalAdmissionBytes, MAX_ADMISSION_BATCH_BYTES } from "../../../lib/usage/admission";
import { enrollmentStorageCall } from "./namespace-anchor";
import { ADMISSION_POLICY_V1 } from "./admission-policy";
import { legacyContributionRow } from "./contributions-legacy";
import type { UsageStatsRow } from "../../../lib/usage/stats-contract";

const MEDIA = "application/vnd.aicharts.contributions-v3+json";
const verified = new WeakSet<object>();
export type VerifiedContributionBody = Readonly<{ accountId: string; bodyHash: string; byteLength: number; key: string }>;
export function contributionObjectKey(accountId: string, bodyHash: string): string {
  if (!contributionAccount(accountId) || !contributionIdentity(bodyHash)) throw new ContributionFault("invalid_input");
  return `usage-contributions/v3/${accountId}/${bodyHash}.json`;
}
export const isVerifiedContributionBody = (value: VerifiedContributionBody): boolean => verified.has(value);
const discard = (body: ReadableStream<Uint8Array>): void => { void body.cancel().catch(() => undefined); };
const bytes = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(new TextEncoder().encode(text));
function mark(accountId: string, bodyHash: string, byteLength: number): VerifiedContributionBody {
  const result = Object.freeze({ accountId, bodyHash, byteLength, key: contributionObjectKey(accountId, bodyHash) });
  verified.add(result); return result;
}
async function boundedBody(body: ReadableStream<Uint8Array>, size: number): Promise<Uint8Array<ArrayBuffer>> {
  const result = new Uint8Array(size), reader = body.getReader();
  let offset = 0, completed = false;
  try {
    return await enrollmentStorageCall((async () => {
      while (offset <= size) {
        const chunk = await reader.read();
        if (chunk.done) {
          completed = true;
          if (offset !== size) throw new ContributionFault("storage_invalid");
          return result;
        }
        if (!(chunk.value instanceof Uint8Array) || chunk.value.length === 0 || chunk.value.length > size - offset)
          throw new ContributionFault("storage_invalid");
        result.set(chunk.value, offset); offset += chunk.value.length;
      }
      throw new ContributionFault("storage_invalid");
    })());
  } finally {
    if (!completed) void reader.cancel().catch(() => undefined);
    // A timed out read may still be pending. Releasing a pending reader is
    // allowed and rejects that pending read; the terminal caller owns no SQL.
    reader.releaseLock();
  }
}
async function read(bucket: R2Bucket, accountId: string, bodyHash: string): Promise<Readonly<{
  batch: ContributionBatch; bytes: Uint8Array<ArrayBuffer>; verified: VerifiedContributionBody;
}> | null> {
  const object = await enrollmentStorageCall(bucket.get(contributionObjectKey(accountId, bodyHash)), value => { if (value) discard(value.body); });
  if (object === null) return null;
  const checksum = object.checksums.sha256;
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > CONTRIBUTION_MAX_BYTES
    || object.httpMetadata?.contentType !== MEDIA || object.httpMetadata.contentEncoding !== undefined
    || object.customMetadata?.schemaVersion !== "3" || Object.keys(object.customMetadata).length !== 1
    || checksum === undefined || [...new Uint8Array(checksum)].map(value => value.toString(16).padStart(2, "0")).join("") !== bodyHash) {
    discard(object.body); throw new ContributionFault("storage_invalid");
  }
  const owned = await boundedBody(object.body, object.size);
  if (contributionHash(owned) !== bodyHash) throw new ContributionFault("storage_invalid");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned), batch = parseContributionJson(text);
  if (!batch || batch.accountId !== accountId || contributionBatchText(batch) !== text) throw new ContributionFault("storage_invalid");
  return { batch, bytes: owned, verified: mark(accountId, bodyHash, owned.length) };
}
function failure(error: unknown): ContributionResult<never> {
  return { ok: false, error: error instanceof ContributionFault ? error.code : "storage_unavailable" };
}
/** Only call after the exact intent and its full possible immutable charge are
 * durable. A timed out conditional put may finish as an immutable orphan; this
 * helper never schedules a SQL continuation after returning an error. */
export async function ensureContributionBody(bucket: R2Bucket, batch: ContributionBatch,
  admitted: () => boolean): Promise<ContributionResult<VerifiedContributionBody>> {
  try {
    const owned = bytes(contributionBatchText(batch)), bodyHash = contributionHash(owned);
    if (!admitted()) throw new ContributionFault("recovery_required");
    let existing = await read(bucket, batch.accountId, bodyHash);
    if (!admitted()) throw new ContributionFault("recovery_required");
    if (existing === null) {
      await enrollmentStorageCall(bucket.put(contributionObjectKey(batch.accountId, bodyHash), owned, {
        onlyIf: new Headers({ "if-none-match": "*" }),
        sha256: Uint8Array.from(bodyHash.match(/../gu)!.map(value => Number.parseInt(value, 16))).buffer,
        httpMetadata: { contentType: MEDIA }, customMetadata: { schemaVersion: "3" },
      }));
      if (!admitted()) throw new ContributionFault("recovery_required");
      existing = await read(bucket, batch.accountId, bodyHash);
    }
    if (!admitted()) throw new ContributionFault("recovery_required");
    if (existing === null || !equalAdmissionBytes(existing.bytes, owned)) throw new ContributionFault("storage_invalid");
    return { ok: true, value: existing.verified };
  } catch (error) { return failure(error); }
}
/** Pure object read. No absent object is repaired or published on this path. */
export async function readContributionBody(bucket: R2Bucket, accountId: string,
  bodyHash: string): Promise<ContributionResult<Readonly<{ batch: ContributionBatch; verified: VerifiedContributionBody }>>> {
  try {
    const value = await read(bucket, accountId, bodyHash);
    return value === null ? { ok: false, error: "storage_invalid" } : { ok: true, value: { batch: value.batch, verified: value.verified } };
  } catch (error) { return failure(error); }
}

/** Resolve one qualified numeric observation from its exact retained source.
 * The original V1 batch is bounded by the frozen V1 wire envelope; the index,
 * operation hash, account/generation and normalized payload all have to agree. */
export async function resolveContributionReference(bucket: R2Bucket, accountId: string, id: string,
  input: ContributionReference): Promise<ContributionResult<UsageStatsRow>> {
  try {
    const reference = parseContributionReference(input);
    if (!contributionAccount(accountId) || !contributionIdentity(id, 32) || !reference) throw new ContributionFault("invalid_input");
    if (reference.kind === "batch-v3") {
      const body = await read(bucket, accountId, reference.bodyHash), mutation = body?.batch.mutations[reference.index];
      if (!mutation || mutation.kind !== "put" || mutation.id !== id || contributionPayloadHash(mutation.row) !== reference.payloadHash)
        throw new ContributionFault("storage_invalid");
      return { ok: true, value: mutation.row };
    }
    if (reference.kind !== "admission-v1" || !contributionIdentity(reference.generation) || !contributionIdentity(reference.bodyHash))
      throw new ContributionFault("invalid_input");
    const key = `usage-admission/v1/${accountId.slice(5)}/${reference.generation}/batches/${reference.bodyHash}.aicb`;
    const object = await enrollmentStorageCall(bucket.get(key), value => { if (value) discard(value.body); });
    if (!object) throw new ContributionFault("storage_invalid");
    if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > MAX_ADMISSION_BATCH_BYTES
      || object.httpMetadata?.contentType !== "application/vnd.aicharts.usage-batch-v1" || object.httpMetadata.contentEncoding !== undefined
      || object.customMetadata?.schemaVersion !== "1" || Object.keys(object.customMetadata).length !== 1 || object.checksums.sha256 === undefined) {
      discard(object.body); throw new ContributionFault("storage_invalid");
    }
    const owned = await boundedBody(object.body, object.size);
    if (contributionHash(owned) !== admissionHex(new Uint8Array(object.checksums.sha256))) throw new ContributionFault("storage_invalid");
    const decoded = decodeAdmissionBatch(owned, ADMISSION_POLICY_V1);
    if (!decoded.ok || admissionHex(decoded.value.batchHash) !== reference.bodyHash || `acct_${admissionHex(decoded.value.accountId)}` !== accountId
      || admissionHex(decoded.value.generation) !== reference.generation) throw new ContributionFault("storage_invalid");
    const operation = decoded.value.operations[reference.index];
    if (!operation || operation.action !== 1 || admissionHex(operation.occurrenceId) !== id
      || admissionHex(operation.operationHash) !== reference.operationHash) throw new ContributionFault("storage_invalid");
    const row = legacyContributionRow(operation);
    if (contributionPayloadHash(row) !== reference.payloadHash) throw new ContributionFault("storage_invalid");
    return { ok: true, value: row };
  } catch (error) { return failure(error); }
}
