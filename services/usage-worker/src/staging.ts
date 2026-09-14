import { err, isRecord, ok, type Result } from "../../../lib/result";
import {
  decodeUsageBatch, encodeUsageBatch, MAX_PACKET_BYTES, validatePolicy,
  type Policy,
} from "../../../lib/usage/wire";

export const USAGE_MEDIA_TYPE = "application/vnd.aicharts.usage-v1";
export const STAGING_READ_TIMEOUT_MS = 5_000;
export const STAGING_MAX_READ_CHUNKS = 16_384;

export type StagingError =
  | "invalid_scope" | "invalid_policy" | "invalid_request"
  | "unsupported_media_type" | "unsupported_content_encoding"
  | "invalid_content_length" | "body_too_large" | "invalid_packet"
  | "body_cancelled" | "body_timeout" | "body_unreadable"
  | "storage_unavailable" | "storage_conflict";

/** This receipt is neither accepted usage nor an authorization or provenance proof. */
export type StagedReceipt = Readonly<{
  status: "staged";
  accepted: false;
  sha256: string;
  byteLength: number;
  utcDay: number;
  registryRevision: number;
  usageCount: number;
  promptCount: number;
  intervalCount: number;
}>;

type ReadError = "body_too_large" | "body_cancelled" | "body_timeout" | "body_unreadable";

function discard(stream: ReadableStream<Uint8Array>): void {
  // A hostile underlying cancel hook may never settle; cleanup must not block.
  void stream.cancel().catch(() => undefined);
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  signal?: AbortSignal,
): Promise<Result<Uint8Array, ReadError>> {
  if (signal?.aborted) {
    discard(stream);
    return err("body_cancelled");
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch {
    return err("body_unreadable");
  }
  let stopped: ReadError | undefined;
  let stop!: (error: ReadError) => void;
  const interruption = new Promise<Result<never, ReadError>>(resolve => {
    stop = error => {
      stopped ??= error;
      resolve(err(error));
    };
  });
  const onAbort = () => stop("body_cancelled");
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("body_timeout"), STAGING_READ_TIMEOUT_MS);
  let completed = false;
  try {
    // Fixed allocation avoids unbounded per-chunk retention before validation.
    const buffer = new Uint8Array(limit);
    let size = 0;
    for (let chunks = 0; chunks < STAGING_MAX_READ_CHUNKS; chunks += 1) {
      if (signal?.aborted) return err("body_cancelled");
      const next = await Promise.race([
        reader.read().then(value => ok(value), () => err("body_unreadable" as const)),
        interruption,
      ]);
      if (stopped) return err(stopped);
      if (!next.ok) return next;
      if (next.value.done) {
        completed = true;
        return ok(buffer.slice(0, size));
      }
      const chunk: unknown = next.value.value;
      if (!(chunk instanceof Uint8Array)) return err("body_unreadable");
      if (chunk.byteLength > limit - size) return err("body_too_large");
      buffer.set(chunk, size);
      size += chunk.byteLength;
    }
    // This also bounds endless zero-byte chunks that could starve a timer.
    return err("body_unreadable");
  } catch {
    return err("body_unreadable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function sameMetadata(
  actual: unknown,
  expected: Readonly<Record<string, string>>,
): boolean {
  return isRecord(actual) && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
}

function canonicalHttpMetadata(actual: unknown): boolean {
  if (!isRecord(actual) || !Object.hasOwn(actual, "contentType") || actual.contentType !== USAGE_MEDIA_TYPE) return false;
  // R2 materializes its optional HTTP fields as own undefined properties. Permit
  // those documented absent fields, but no populated or unrecognized field.
  const absent = ["contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"];
  return Object.keys(actual).every(key => key === "contentType" || (absent.includes(key) && actual[key] === undefined))
    && absent.every(key => actual[key] === undefined);
}

async function storageCall<T>(operation: Promise<T>, onLateResult?: (value: T) => void): Promise<Result<T, "storage_unavailable">> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<never, "storage_unavailable">>(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(err("storage_unavailable"));
    }, STAGING_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      operation.then(value => {
        if (timedOut) onLateResult?.(value);
        return ok(value);
      }, () => err("storage_unavailable" as const)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Internal, dormant staging primitive. The caller must supply an authorized opaque
 * account routing ID, never a provider Usage.accountId or a client-selected path.
 * No enrollment, accepted index, ranking, or raw-request audit log exists here.
 * An uncertain write returns a fixed error; a later identical call reconciles the
 * immutable object without overwriting it. Do not automatically retry that error.
 */
export async function stageUsageBatch(
  bucket: R2Bucket,
  request: unknown,
  policy: Policy,
  accountScope: unknown,
): Promise<Result<StagedReceipt, StagingError>> {
  if (!(request instanceof Request)) return err("invalid_request");
  const rejectRequest = (error: StagingError): Result<never, StagingError> => {
    if (request.body !== null && !request.body.locked) discard(request.body);
    return err(error);
  };
  if (typeof accountScope !== "string" || !/^[0-9a-f]{64}$/.test(accountScope)) return rejectRequest("invalid_scope");
  if (!validatePolicy(policy)) return rejectRequest("invalid_policy");
  // Own the policy before reading an asynchronous caller-controlled stream.
  const ownedPolicy: Policy = {
    firstDay: policy.firstDay,
    lastDay: policy.lastDay,
    registry: {
      revision: policy.registry.revision,
      models: policy.registry.models.map(([provider, model]) => [provider, model] as const),
    },
  };
  if (request.method !== "POST" || request.body === null || request.bodyUsed
    || request.headers.has("content-disposition") || request.headers.has("content-range")
    || request.headers.has("trailer")) return rejectRequest("invalid_request");
  if (request.headers.has("content-encoding")) return rejectRequest("unsupported_content_encoding");
  if (request.headers.get("content-type") !== USAGE_MEDIA_TYPE) return rejectRequest("unsupported_media_type");
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null && !/^(0|[1-9][0-9]{0,9})$/.test(lengthHeader)) return rejectRequest("invalid_content_length");
  const declaredLength = lengthHeader === null ? undefined : Number(lengthHeader);
  if (declaredLength !== undefined && declaredLength > MAX_PACKET_BYTES) return rejectRequest("body_too_large");
  const input = await readBounded(request.body, MAX_PACKET_BYTES, request.signal);
  if (!input.ok) return input;
  if (declaredLength !== undefined && input.value.byteLength !== declaredLength) return err("invalid_content_length");
  const decoded = decodeUsageBatch(input.value, ownedPolicy);
  if (!decoded.ok) return err("invalid_packet");
  const encoded = encodeUsageBatch(decoded.value, ownedPolicy);
  if (!encoded.ok) return err("invalid_packet");
  // Only freshly encoded, privately owned bytes cross the storage boundary.
  const canonical = encoded.value;
  try {
    const digest = await crypto.subtle.digest("SHA-256", canonical);
    if (request.signal.aborted) return err("body_cancelled");
    const sha256 = hex(new Uint8Array(digest));
    const key = `staging/v1/${accountScope}/${sha256}.aicu`;
    const receipt: StagedReceipt = {
      status: "staged", accepted: false, sha256, byteLength: canonical.byteLength,
      utcDay: decoded.value.utcDay, registryRevision: decoded.value.registryRevision,
      usageCount: decoded.value.usage.length, promptCount: decoded.value.prompts.length,
      intervalCount: decoded.value.intervals.length,
    };
    const metadata = {
      schemaVersion: "1", sha256, byteLength: String(receipt.byteLength),
      utcDay: String(receipt.utcDay), registryRevision: String(receipt.registryRevision),
      usageCount: String(receipt.usageCount), promptCount: String(receipt.promptCount),
      intervalCount: String(receipt.intervalCount),
    };
    const put = await storageCall(bucket.put(key, canonical, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      sha256: digest,
      httpMetadata: { contentType: USAGE_MEDIA_TYPE },
      customMetadata: metadata,
    }));
    if (!put.ok) return put;
    // A successful conditional create and a lost race both require readback.
    const readback = await storageCall(bucket.get(key), value => {
      if (value) discard(value.body);
    });
    if (!readback.ok) return readback;
    const object = readback.value;
    if (object === null) return err("storage_unavailable");
    if (object.size !== canonical.byteLength || !sameMetadata(object.customMetadata, metadata)
      || !canonicalHttpMetadata(object.httpMetadata)
      || object.checksums.sha256 === undefined
      || !sameBytes(new Uint8Array(object.checksums.sha256), new Uint8Array(digest))) {
      discard(object.body);
      return err("storage_conflict");
    }
    const stored = await readBounded(object.body, canonical.byteLength);
    if (!stored.ok) return err(stored.error === "body_too_large" ? "storage_conflict" : "storage_unavailable");
    if (!sameBytes(stored.value, canonical)
      || hex(new Uint8Array(await crypto.subtle.digest("SHA-256", stored.value))) !== sha256) return err("storage_conflict");
    return ok(receipt);
  } catch {
    // Provider exceptions may contain keys or request details; never return/log them.
    return err("storage_unavailable");
  }
}
