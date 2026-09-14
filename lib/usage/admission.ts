import { createHash } from "node:crypto";
import { err, ok, type Result } from "../result";
import { decodeUsageBatch, type Policy } from "./wire";

/** Server/native interoperability, not a browser credential or authentication protocol. */
export const OPERATION_DESCRIPTOR_BYTES = 184;
export const PUT_OPERATION_BYTES = 320;
export const OPERATION_RECEIPT_BYTES = 264;
export const ADMISSION_BATCH_HEADER_BYTES = 104;
export const ADMISSION_JOURNAL_HEADER_BYTES = 160;
export const MAX_ADMISSION_OPERATIONS = 256;
export const MAX_ADMISSION_BATCH_BYTES = 82_024;
export const MAX_ADMISSION_JOURNAL_BYTES = 67_744;
export const MAX_ADMISSION_TIMESTAMP = 8_640_000_000_000_000;

export type AdmissionError = "invalid_input" | "invalid_size" | "invalid_header" | "invalid_version"
  | "invalid_reserved" | "invalid_identity" | "invalid_sequence" | "invalid_frame" | "invalid_hash"
  | "invalid_binding" | "invalid_count" | "duplicate_occurrence" | "invalid_receipt" | "invalid_outcome";
export type AdmissionBinding = Readonly<{ accountId: Uint8Array; deviceId: Uint8Array; generation: Uint8Array }>;
export type AdmissionOperation = AdmissionBinding & Readonly<{
  action: 1 | 2; sequence: number; occurrenceId: Uint8Array; expectedHeadHash: Uint8Array;
  payloadHash: Uint8Array; frame: Uint8Array; bytes: Uint8Array; operationHash: Uint8Array;
}>;
export type AdmissionBatch = AdmissionBinding & Readonly<{
  firstSequence: number; operations: readonly AdmissionOperation[]; bytes: Uint8Array; batchHash: Uint8Array;
}>;
export type AdmissionOutcome = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type AdmissionReceipt = Readonly<{
  outcome: AdmissionOutcome; headOperationHash: Uint8Array; bytes: Uint8Array;
}>;
/** Only authenticated owned transport can establish receipt provenance. Decoding cannot. */
export type AdmissionJournal = Readonly<{
  status: 1 | 2; accountJournalRevision: number; committedAtMs: number;
  receipts: readonly AdmissionReceipt[]; bytes: Uint8Array;
}>;

const operationDomain = new TextEncoder().encode("aicharts:usage-operation:v1\0");
const batchDomain = new TextEncoder().encode("aicharts:usage-batch:v1\0");
const nonzero = (bytes: Uint8Array) => bytes.some(byte => byte !== 0);
export const equalAdmissionBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);
export const admissionHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const digest = (bytes: Uint8Array, domain?: Uint8Array): Uint8Array => {
  const hash = createHash("sha256");
  if (domain) hash.update(domain);
  return Uint8Array.from(hash.update(bytes).digest());
};
const safePositive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")!.get!;
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
function ownBytes(value: unknown, min: number, max = min): Uint8Array<ArrayBuffer> | null {
  try {
    if (!(value instanceof Uint8Array)) return null;
    const length: unknown = Reflect.apply(nativeLength, value, []);
    const buffer: unknown = Reflect.apply(nativeBuffer, value, []);
    // Shared memory cannot provide one stable synchronous request snapshot.
    if (typeof length !== "number" || length < min || length > max || !(buffer instanceof ArrayBuffer)) return null;
    const owned = new Uint8Array(length);
    // The intrinsic typed-array path does not consult Symbol.iterator, custom
    // properties, species or overridden length/getters on the source.
    Uint8Array.prototype.set.call(owned, value);
    return owned;
  } catch { return null; }
}
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const numberAt = (view: DataView, offset: number): number | null => {
  const value = view.getBigUint64(offset, true);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

// Reject value getters, symbols and unusual prototypes. Reflection on a Proxy
// can run its traps; this is a data boundary, not an in-process JS sandbox.
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const owned: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor)) return null;
      owned[key] = descriptor.value as unknown;
    }
    return owned;
  } catch { return null; }
}

function ownList(value: unknown): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 1 || length > MAX_ADMISSION_OPERATIONS) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== length + 1) return null;
    const owned: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor)) return null;
      owned.push(descriptor.value as unknown);
    }
    return owned;
  } catch { return null; }
}

function header(bytes: Uint8Array, magic: string): AdmissionError | null {
  if (![...magic].every((letter, index) => bytes[index] === letter.charCodeAt(0))) return "invalid_header";
  const view = viewOf(bytes);
  if (view.getUint16(4, true) !== 1 || view.getUint16(8, true) !== 1) return "invalid_version";
  if (view.getUint16(6, true) !== 0) return "invalid_reserved";
  return null;
}
function writeHeader(bytes: Uint8Array, magic: string, binding: AdmissionBinding, sequence: number): void {
  bytes.set(new TextEncoder().encode(magic));
  const view = viewOf(bytes);
  view.setUint16(4, 1, true); view.setUint16(8, 1, true);
  bytes.set(binding.accountId, 16); bytes.set(binding.deviceId, 32); bytes.set(binding.generation, 64);
  view.setBigUint64(96, BigInt(sequence), true);
}
function bindingAt(bytes: Uint8Array): Result<AdmissionBinding, AdmissionError> {
  const accountId = bytes.slice(16, 32), deviceId = bytes.slice(32, 64), generation = bytes.slice(64, 96);
  return [accountId, deviceId, generation].every(nonzero)
    ? ok({ accountId, deviceId, generation }) : err("invalid_identity");
}
function sameBinding(left: AdmissionBinding, right: AdmissionBinding): boolean {
  return equalAdmissionBytes(left.accountId, right.accountId) && equalAdmissionBytes(left.deviceId, right.deviceId)
    && equalAdmissionBytes(left.generation, right.generation);
}

export function decodeAdmissionOperation(input: unknown, policy: Policy): Result<AdmissionOperation, AdmissionError> {
  const bytes = ownBytes(input, OPERATION_DESCRIPTOR_BYTES, PUT_OPERATION_BYTES);
  if (!bytes || (bytes.length !== OPERATION_DESCRIPTOR_BYTES && bytes.length !== PUT_OPERATION_BYTES)) return err("invalid_size");
  const view = viewOf(bytes);
  const invalid = header(bytes, "AICO");
  if (invalid) return err(invalid);
  if (bytes[11] !== 0) return err("invalid_reserved");
  const action = bytes[10], length = view.getUint32(12, true);
  if ((action !== 1 && action !== 2) || length !== (action === 1 ? 136 : 0)
    || bytes.length !== OPERATION_DESCRIPTOR_BYTES + length) return err("invalid_size");
  const binding = bindingAt(bytes);
  if (!binding.ok) return binding;
  const sequence = numberAt(view, 96), occurrenceId = bytes.slice(104, 120);
  if (!safePositive(sequence)) return err("invalid_sequence");
  if (!nonzero(occurrenceId)) return err("invalid_identity");
  const expectedHeadHash = bytes.slice(120, 152), payloadHash = bytes.slice(152, 184), frame = bytes.slice(184);
  if (action === 1) {
    const usage = decodeUsageBatch(frame, policy);
    if (!usage.ok || usage.value.usage.length !== 1 || usage.value.prompts.length !== 0 || usage.value.intervals.length !== 0
      || !equalAdmissionBytes(usage.value.usage[0].id, occurrenceId)) return err("invalid_frame");
    if (!equalAdmissionBytes(payloadHash, digest(frame))) return err("invalid_hash");
  } else if (nonzero(payloadHash)) return err("invalid_hash");
  return ok({ ...binding.value, action, sequence, occurrenceId, expectedHeadHash, payloadHash, frame,
    bytes, operationHash: digest(bytes, operationDomain) });
}

export function encodeAdmissionOperation(input: unknown, policy: Policy): Result<Uint8Array, AdmissionError> {
  const value = record(input, ["accountId", "deviceId", "generation", "action", "sequence", "occurrenceId", "expectedHeadHash", "frame"]);
  if (!value || (value.action !== 1 && value.action !== 2)) return err("invalid_input");
  const accountId = ownBytes(value.accountId, 16), deviceId = ownBytes(value.deviceId, 32), generation = ownBytes(value.generation, 32);
  const occurrenceId = ownBytes(value.occurrenceId, 16), expectedHeadHash = ownBytes(value.expectedHeadHash, 32);
  const frame = ownBytes(value.frame, value.action === 1 ? 136 : 0);
  if (!accountId || !deviceId || !generation || !occurrenceId || !expectedHeadHash || !frame) return err("invalid_input");
  if (!safePositive(value.sequence)) return err("invalid_sequence");
  const bytes = new Uint8Array(OPERATION_DESCRIPTOR_BYTES + frame.length);
  writeHeader(bytes, "AICO", { accountId, deviceId, generation }, value.sequence);
  bytes[10] = value.action; viewOf(bytes).setUint32(12, frame.length, true);
  bytes.set(occurrenceId, 104); bytes.set(expectedHeadHash, 120); bytes.set(frame, 184);
  if (value.action === 1) bytes.set(digest(bytes.subarray(184)), 152);
  const decoded = decodeAdmissionOperation(bytes, policy);
  return decoded.ok ? ok(decoded.value.bytes) : decoded;
}

export function decodeAdmissionBatch(input: unknown, policy: Policy): Result<AdmissionBatch, AdmissionError> {
  const bytes = ownBytes(input, ADMISSION_BATCH_HEADER_BYTES + OPERATION_DESCRIPTOR_BYTES, MAX_ADMISSION_BATCH_BYTES);
  if (!bytes) return err("invalid_size");
  const view = viewOf(bytes);
  const invalid = header(bytes, "AICB");
  if (invalid) return err(invalid);
  const count = view.getUint16(10, true), firstSequence = numberAt(view, 96);
  if (count < 1 || count > MAX_ADMISSION_OPERATIONS) return err("invalid_count");
  if (!safePositive(firstSequence) || firstSequence > Number.MAX_SAFE_INTEGER - count + 1) return err("invalid_sequence");
  if (view.getUint32(12, true) !== bytes.length - ADMISSION_BATCH_HEADER_BYTES) return err("invalid_size");
  const binding = bindingAt(bytes);
  if (!binding.ok) return binding;
  const operations: AdmissionOperation[] = [], occurrences = new Set<string>();
  let offset = ADMISSION_BATCH_HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (bytes.length - offset < OPERATION_DESCRIPTOR_BYTES) return err("invalid_size");
    const length = view.getUint32(offset + 12, true);
    if (length !== 0 && length !== 136) return err("invalid_size");
    const end = offset + OPERATION_DESCRIPTOR_BYTES + length;
    if (end > bytes.length) return err("invalid_size");
    const decoded = decodeAdmissionOperation(bytes.subarray(offset, end), policy);
    if (!decoded.ok) return decoded;
    const operation = decoded.value;
    if (!sameBinding(operation, binding.value)) return err("invalid_binding");
    if (operation.sequence !== firstSequence + index) return err("invalid_sequence");
    const id = admissionHex(operation.occurrenceId);
    if (occurrences.has(id)) return err("duplicate_occurrence");
    occurrences.add(id); operations.push(operation); offset = end;
  }
  if (offset !== bytes.length) return err("invalid_size");
  return ok({ ...binding.value, firstSequence, operations, bytes, batchHash: digest(bytes, batchDomain) });
}

export function encodeAdmissionBatch(input: unknown, policy: Policy): Result<Uint8Array, AdmissionError> {
  const values = ownList(input);
  if (!values) return err("invalid_count");
  const operations: AdmissionOperation[] = [];
  for (const raw of values) {
    const operation = decodeAdmissionOperation(raw, policy);
    if (!operation.ok) return operation;
    operations.push(operation.value);
  }
  const bytes = new Uint8Array(ADMISSION_BATCH_HEADER_BYTES + operations.reduce((sum, item) => sum + item.bytes.length, 0));
  writeHeader(bytes, "AICB", operations[0], operations[0].sequence);
  const view = viewOf(bytes);
  view.setUint16(10, operations.length, true); view.setUint32(12, bytes.length - ADMISSION_BATCH_HEADER_BYTES, true);
  let offset = ADMISSION_BATCH_HEADER_BYTES;
  for (const operation of operations) { bytes.set(operation.bytes, offset); offset += operation.bytes.length; }
  const decoded = decodeAdmissionBatch(bytes, policy);
  return decoded.ok ? ok(decoded.value.bytes) : decoded;
}

function validOutcome(operation: AdmissionOperation, outcome: number, head: Uint8Array): boolean {
  if (outcome < 1 || outcome > 8) return false;
  if (outcome <= 3) {
    if (!nonzero(head) || !equalAdmissionBytes(head, operation.operationHash)) return false;
    if (outcome === 1) return operation.action === 1 && !nonzero(operation.expectedHeadHash);
    if (outcome === 2) return operation.action === 1 && nonzero(operation.expectedHeadHash);
    return operation.action === 2 && nonzero(operation.expectedHeadHash);
  }
  if (outcome === 4) return operation.action === 1 && nonzero(head);
  if (outcome === 7) return !nonzero(head);
  return outcome !== 8 || nonzero(head);
}

export function decodeAdmissionJournal(input: unknown, batchInput: unknown, policy: Policy): Result<AdmissionJournal, AdmissionError> {
  const bytes = ownBytes(input, ADMISSION_JOURNAL_HEADER_BYTES + OPERATION_RECEIPT_BYTES, MAX_ADMISSION_JOURNAL_BYTES);
  if (!bytes) return err("invalid_size");
  const checkedBatch = decodeAdmissionBatch(batchInput, policy);
  if (!checkedBatch.ok) return checkedBatch;
  const batch = checkedBatch.value, view = viewOf(bytes);
  const invalid = header(bytes, "AICJ");
  if (invalid) return err(invalid);
  const count = view.getUint16(10, true);
  if (count !== batch.operations.length) return err("invalid_count");
  if (view.getUint32(12, true) !== count * OPERATION_RECEIPT_BYTES
    || bytes.length !== ADMISSION_JOURNAL_HEADER_BYTES + count * OPERATION_RECEIPT_BYTES) return err("invalid_size");
  if (!equalAdmissionBytes(bytes.subarray(16, 104), batch.bytes.subarray(16, 104))) return err("invalid_binding");
  if (!equalAdmissionBytes(bytes.subarray(104, 136), batch.batchHash)) return err("invalid_hash");
  const accountJournalRevision = numberAt(view, 136), committedAtMs = numberAt(view, 144), status = bytes[152];
  if (!safePositive(accountJournalRevision) || committedAtMs === null || committedAtMs > MAX_ADMISSION_TIMESTAMP) return err("invalid_receipt");
  if (bytes.subarray(153, 160).some(byte => byte !== 0)) return err("invalid_reserved");
  if (status !== 1 && status !== 2) return err("invalid_outcome");
  const receipts: AdmissionReceipt[] = [];
  for (let index = 0; index < count; index += 1) {
    const operation = batch.operations[index], offset = ADMISSION_JOURNAL_HEADER_BYTES + index * OPERATION_RECEIPT_BYTES;
    const receipt = bytes.slice(offset, offset + OPERATION_RECEIPT_BYTES), receiptView = viewOf(receipt), outcome = receipt[11];
    const descriptor = Uint8Array.from(operation.bytes.subarray(0, OPERATION_DESCRIPTOR_BYTES));
    descriptor.set(new TextEncoder().encode("AICR")); descriptor[11] = outcome;
    if (!equalAdmissionBytes(receipt.subarray(0, OPERATION_DESCRIPTOR_BYTES), descriptor)
      || !equalAdmissionBytes(receipt.subarray(184, 216), operation.operationHash)
      || numberAt(receiptView, 248) !== accountJournalRevision || numberAt(receiptView, 256) !== committedAtMs) return err("invalid_receipt");
    const headOperationHash = receipt.slice(216, 248);
    if (!validOutcome(operation, outcome, headOperationHash) || (status === 1 ? outcome > 4 : outcome < 5)) return err("invalid_outcome");
    receipts.push({ outcome: outcome as AdmissionOutcome, headOperationHash, bytes: receipt });
  }
  if (status === 2 && (receipts.some(item => item.outcome === 7)
    ? !receipts.every(item => item.outcome === 7) : !receipts.some(item => item.outcome === 5 || item.outcome === 8))) return err("invalid_outcome");
  return ok({ status, accountJournalRevision, committedAtMs, receipts, bytes });
}

export function encodeAdmissionJournal(batchInput: unknown, input: unknown, policy: Policy): Result<Uint8Array, AdmissionError> {
  const checkedBatch = decodeAdmissionBatch(batchInput, policy);
  if (!checkedBatch.ok) return checkedBatch;
  const batch = checkedBatch.value, value = record(input, ["status", "accountJournalRevision", "committedAtMs", "receipts"]);
  const receipts = ownList(value?.receipts);
  if (!value || (value.status !== 1 && value.status !== 2) || !safePositive(value.accountJournalRevision)
    || typeof value.committedAtMs !== "number" || !Number.isSafeInteger(value.committedAtMs) || value.committedAtMs < 0
    || value.committedAtMs > MAX_ADMISSION_TIMESTAMP || !receipts
    || receipts.length !== batch.operations.length) return err("invalid_input");
  const bytes = new Uint8Array(ADMISSION_JOURNAL_HEADER_BYTES + batch.operations.length * OPERATION_RECEIPT_BYTES), view = viewOf(bytes);
  writeHeader(bytes, "AICJ", batch, batch.firstSequence);
  view.setUint16(10, batch.operations.length, true); view.setUint32(12, batch.operations.length * OPERATION_RECEIPT_BYTES, true);
  bytes.set(batch.batchHash, 104); view.setBigUint64(136, BigInt(value.accountJournalRevision), true);
  view.setBigUint64(144, BigInt(value.committedAtMs), true); bytes[152] = value.status;
  for (let index = 0; index < batch.operations.length; index += 1) {
    const decision = record(receipts[index], ["outcome", "headOperationHash"]);
    const headOperationHash = ownBytes(decision?.headOperationHash, 32);
    if (!decision || typeof decision.outcome !== "number" || !Number.isInteger(decision.outcome) || decision.outcome < 1 || decision.outcome > 8
      || !headOperationHash) return err("invalid_input");
    const operation = batch.operations[index], offset = ADMISSION_JOURNAL_HEADER_BYTES + index * OPERATION_RECEIPT_BYTES;
    bytes.set(operation.bytes.subarray(0, OPERATION_DESCRIPTOR_BYTES), offset);
    bytes.set(new TextEncoder().encode("AICR"), offset); bytes[offset + 11] = decision.outcome;
    bytes.set(operation.operationHash, offset + 184); bytes.set(headOperationHash, offset + 216);
    view.setBigUint64(offset + 248, BigInt(value.accountJournalRevision), true); view.setBigUint64(offset + 256, BigInt(value.committedAtMs), true);
  }
  const decoded = decodeAdmissionJournal(bytes, batch.bytes, policy);
  return decoded.ok ? ok(decoded.value.bytes) : decoded;
}
