import { enrollmentAccount, enrollmentHex, enrollmentTime } from "./enrollment-contract";

export type NamespaceAnchor = Readonly<{
  accountId: string;
  namespaceKey: string;
  intentId: string;
  reservationId: string;
  generation: string;
  createdAtMs: number;
}>;
export const NAMESPACE_ANCHOR_BYTES = 160;
const mediaType = "application/vnd.aicharts.namespace-v1";
const magic = Uint8Array.of(65, 73, 67, 78, 1, 0, 0, 0);
const hex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

/** Private fixed records; no headers, request bodies or arbitrary metadata persist. */
export function namespaceAnchorKey(accountId: string): string {
  if (!enrollmentAccount(accountId)) throw new Error("invalid_anchor");
  return `account-control/v1/${accountId.slice(5)}/namespace.aicn`;
}

export function encodeNamespaceAnchor(value: NamespaceAnchor): Uint8Array<ArrayBuffer> {
  if (!enrollmentAccount(value.accountId) || !enrollmentHex(value.namespaceKey) || !enrollmentHex(value.intentId)
    || !enrollmentHex(value.reservationId) || !enrollmentHex(value.generation) || !enrollmentTime(value.createdAtMs)) throw new Error("invalid_anchor");
  const bytes = new Uint8Array(NAMESPACE_ANCHOR_BYTES);
  bytes.set(magic);
  bytes.set(Buffer.from(value.accountId.slice(5), "hex"), 8);
  for (const [offset, key] of [[24, "namespaceKey"], [56, "intentId"], [88, "reservationId"], [120, "generation"]] as const) {
    bytes.set(Buffer.from(value[key], "hex"), offset);
  }
  new DataView(bytes.buffer).setBigUint64(152, BigInt(value.createdAtMs));
  return bytes;
}

function decode(bytes: Uint8Array): NamespaceAnchor {
  if (bytes.length !== NAMESPACE_ANCHOR_BYTES || magic.some((value, index) => bytes[index] !== value)) throw new Error("invalid_anchor");
  const value = Object.freeze({
    accountId: `acct_${hex(bytes.subarray(8, 24))}`, namespaceKey: hex(bytes.subarray(24, 56)),
    intentId: hex(bytes.subarray(56, 88)), reservationId: hex(bytes.subarray(88, 120)),
    generation: hex(bytes.subarray(120, 152)), createdAtMs: Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(152)),
  });
  encodeNamespaceAnchor(value);
  return value;
}

export function sameNamespaceAnchor(left: NamespaceAnchor, right: NamespaceAnchor): boolean {
  return left.accountId === right.accountId && left.namespaceKey === right.namespaceKey && left.intentId === right.intentId
    && left.reservationId === right.reservationId && left.generation === right.generation && left.createdAtMs === right.createdAtMs;
}

export async function enrollmentStorageCall<T>(promise: Promise<T>, late?: (value: T) => void): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error("storage_unavailable")); }, 5_000);
  });
  try {
    // RPC promises support pipelining. Give cleanup its own native reaction,
    // separate from the callback that delivers the RPC result.
    const settled = new Promise<T>((resolve, reject) => { void promise.then(resolve, reject); });
    return await Promise.race([settled.then(value => { if (timedOut) late?.(value); return value; }), timeout]);
  } finally { clearTimeout(timer); }
}

function discard(body: ReadableStream<Uint8Array>): void { void body.cancel().catch(() => {}); }

async function readFixed(body: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const bytes = new Uint8Array(NAMESPACE_ANCHOR_BYTES);
  let size = 0;
  let complete = false;
  // One timeout for the whole stream, not a renewable allowance per chunk.
  const operation = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        complete = true;
        if (size !== bytes.length) throw new Error("invalid_anchor");
        return bytes;
      }
      if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0 || next.value.byteLength > bytes.length - size) throw new Error("invalid_anchor");
      bytes.set(next.value, size);
      size += next.value.byteLength;
    }
  })();
  try { return await enrollmentStorageCall(operation); }
  finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function metadata(object: R2ObjectBody): boolean {
  const custom = object.customMetadata;
  const http = object.httpMetadata;
  const absent = ["contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"];
  return custom !== undefined && Object.keys(custom).length === 1 && custom.schemaVersion === "1"
    && http !== undefined && http.contentType === mediaType
    && Object.keys(http).every(key => key === "contentType" || absent.includes(key))
    && absent.every(key => (http as Record<string, unknown>)[key] === undefined);
}

/** Absence is a storage observation, never proof that a restored account is new. */
export async function readNamespaceAnchor(bucket: R2Bucket, accountId: string): Promise<NamespaceAnchor | null> {
  const object = await enrollmentStorageCall(bucket.get(namespaceAnchorKey(accountId)), value => { if (value) discard(value.body); });
  if (object === null) return null;
  if (object.size !== NAMESPACE_ANCHOR_BYTES || !metadata(object) || object.checksums.sha256 === undefined) {
    discard(object.body);
    throw new Error("invalid_anchor");
  }
  const bytes = await readFixed(object.body);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const stored = new Uint8Array(object.checksums.sha256);
  if (stored.length !== digest.length || stored.some((value, index) => value !== digest[index])) throw new Error("invalid_anchor");
  const value = decode(bytes);
  if (value.accountId !== accountId) throw new Error("invalid_anchor");
  return value;
}

/** Caller must durably retain this exact pending anchor before its first write. */
export async function ensureNamespaceAnchor(bucket: R2Bucket, expected: NamespaceAnchor, admitted: () => boolean): Promise<void> {
  const bytes = encodeNamespaceAnchor(expected);
  const owned = decode(bytes);
  if (!admitted()) throw new Error("enrollment_closed");
  let existing = await readNamespaceAnchor(bucket, owned.accountId);
  if (existing === null) {
    const sha256 = await crypto.subtle.digest("SHA-256", bytes);
    if (!admitted()) throw new Error("enrollment_closed");
    await enrollmentStorageCall(bucket.put(namespaceAnchorKey(owned.accountId), bytes, {
      onlyIf: new Headers({ "if-none-match": "*" }), sha256,
      httpMetadata: { contentType: mediaType }, customMetadata: { schemaVersion: "1" },
    }));
    if (!admitted()) throw new Error("enrollment_closed");
    existing = await readNamespaceAnchor(bucket, owned.accountId);
  }
  if (existing === null || !sameNamespaceAnchor(existing, owned)) throw new Error("invalid_anchor");
}
