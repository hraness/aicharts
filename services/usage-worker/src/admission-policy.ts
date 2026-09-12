import {
  admissionHex, decodeAdmissionBatch, decodeAdmissionJournal, decodeAdmissionOperation,
  encodeAdmissionJournal, equalAdmissionBytes, MAX_ADMISSION_TIMESTAMP,
  type AdmissionBatch, type AdmissionJournal, type AdmissionOperation, type AdmissionOutcome,
} from "../../../lib/usage/admission";
import { DAY_MS, decodeUsageBatch, type Policy } from "../../../lib/usage/wire";

// Retained evidence must never be reinterpreted under a sliding date window.
// A different measurement profile or registry needs a reviewed schema change.
export const ADMISSION_POLICY_V1: Policy = Object.freeze({ firstDay: 0, lastDay: 100_000_000,
  registry: Object.freeze({ revision: 1, models: Object.freeze([]) }) });
export const MAX_ADMISSION_HEADS = 100_000;
export const MAX_ADMISSION_DAY_HEADS = 65_536;
export const MAX_ADMISSION_REVISIONS = 4_096;
export type AdmissionFailure = "invalid_input" | "unauthorized" | "not_enrolled" | "revoked" | "conflict"
  | "recovery_required" | "clock_regressed" | "storage_invalid" | "storage_unavailable" | "limit";
export class AdmissionFault extends Error {
  constructor(readonly code: AdmissionFailure = "storage_invalid") { super(code); }
}
export function requireAdmission(condition: unknown): asserts condition {
  if (!condition) throw new AdmissionFault();
}
export const zeroHash = () => new Uint8Array(32);
export const isZeroHash = (bytes: Uint8Array) => bytes.every(byte => byte === 0);
export const lastSequence = (batch: AdmissionBatch) => batch.firstSequence + batch.operations.length - 1;
export const batchAccount = (batch: AdmissionBatch) => `acct_${admissionHex(batch.accountId)}`;

/** Canonical imported token profile only; no prompt, interval or known model claims. */
export function operationDay(operation: AdmissionOperation): { day: number; timestamp: number } | null {
  if (operation.action === 2) return null;
  const frame = decodeUsageBatch(operation.frame, ADMISSION_POLICY_V1);
  requireAdmission(frame.ok);
  const usage = frame.value.usage[0];
  requireAdmission(frame.value.usage.length === 1 && frame.value.prompts.length === 0 && frame.value.intervals.length === 0
    && usage.modelId === 0 && usage.contextTier === 0 && usage.authMode === 0 && usage.evidence === 1
    && isZeroHash(usage.accountId) && (usage.provider === 1 || usage.provider === 2));
  const timestamp = frame.value.utcDay * DAY_MS + usage.offsetMs;
  requireAdmission(Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= MAX_ADMISSION_TIMESTAMP);
  return { day: frame.value.utcDay, timestamp };
}
export function ownedAdmissionBatch(input: unknown): AdmissionBatch {
  const parsed = decodeAdmissionBatch(input, ADMISSION_POLICY_V1);
  requireAdmission(parsed.ok);
  for (const operation of parsed.value.operations) operationDay(operation);
  return parsed.value;
}
export function ownedAdmissionOperation(input: unknown): AdmissionOperation {
  const parsed = decodeAdmissionOperation(input, ADMISSION_POLICY_V1);
  requireAdmission(parsed.ok);
  operationDay(parsed.value);
  return parsed.value;
}
export function ownedAdmissionJournal(input: unknown, batch: AdmissionBatch): AdmissionJournal {
  const parsed = decodeAdmissionJournal(input, batch.bytes, ADMISSION_POLICY_V1);
  requireAdmission(parsed.ok);
  return parsed.value;
}
export function timestampsAtMost(batch: AdmissionBatch, timestamp: number): void {
  for (const operation of batch.operations) {
    const measured = operationDay(operation);
    requireAdmission(measured === null || measured.timestamp <= timestamp);
  }
}

export type AdmissionHead = Readonly<{ operation: AdmissionOperation; revision: number; day: number | null }>;
export type AdmissionDecision = Readonly<{
  status: 1 | 2;
  receipts: readonly Readonly<{ outcome: AdmissionOutcome; headOperationHash: Uint8Array }>[];
}>;

export function classifyAdmission(operation: AdmissionOperation, head: AdmissionHead | null): AdmissionOutcome {
  if (head?.operation.action === 2) return 8;
  if (head && operation.action === 1 && equalAdmissionBytes(head.operation.frame, operation.frame)) return 4;
  if (!equalAdmissionBytes(operation.expectedHeadHash, head?.operation.operationHash ?? zeroHash()) || (!head && operation.action === 2)) return 5;
  return operation.action === 2 ? 3 : head ? 2 : 1;
}

/** Pure account-wide CAS decision. A rejection never publishes a partial batch. */
export function decideAdmission(batch: AdmissionBatch, heads: readonly (AdmissionHead | null)[], revoked: boolean): AdmissionDecision {
  requireAdmission(heads.length === batch.operations.length);
  if (revoked) return { status: 2, receipts: batch.operations.map(() => ({ outcome: 7, headOperationHash: zeroHash() })) };
  const receipts = batch.operations.map((operation, index) => {
    const head = heads[index];
    const oldHash = head?.operation.operationHash ?? zeroHash();
    const outcome = classifyAdmission(operation, head);
    return { outcome, headOperationHash: outcome <= 3 ? operation.operationHash : oldHash };
  });
  if (!receipts.some(receipt => receipt.outcome === 5 || receipt.outcome === 8)) return { status: 1, receipts };
  return { status: 2, receipts: receipts.map((receipt, index) => receipt.outcome >= 5 ? receipt : {
    outcome: 6, headOperationHash: heads[index]?.operation.operationHash ?? zeroHash(),
  }) };
}

export function freezeAdmission(batch: AdmissionBatch, decision: AdmissionDecision, revision: number, now: number): AdmissionJournal {
  const encoded = encodeAdmissionJournal(batch.bytes, { ...decision, accountJournalRevision: revision, committedAtMs: now }, ADMISSION_POLICY_V1);
  requireAdmission(encoded.ok);
  return ownedAdmissionJournal(encoded.value, batch);
}

/** Relational audit of retained terminal evidence against published heads. */
export function auditReceiptHead(operation: AdmissionOperation, receipt: AdmissionJournal["receipts"][number], revision: number, head: AdmissionHead | null): void {
  const later = head !== null && head.revision > revision;
  const older = head !== null && head.revision < revision;
  const matchingHash = head !== null && equalAdmissionBytes(head.operation.operationHash, receipt.headOperationHash);
  switch (receipt.outcome) {
    case 1: case 2:
      requireAdmission(later || (head !== null && head.revision === revision && equalAdmissionBytes(head.operation.bytes, operation.bytes)));
      break;
    case 3:
      requireAdmission(head !== null && head.revision === revision && head.operation.action === 2 && equalAdmissionBytes(head.operation.bytes, operation.bytes));
      break;
    case 4:
      requireAdmission(later || (older && head.operation.action === 1 && matchingHash && equalAdmissionBytes(head.operation.frame, operation.frame)));
      break;
    case 5: case 6:
      requireAdmission(later || (isZeroHash(receipt.headOperationHash) ? head === null : older && head.operation.action === 1 && matchingHash));
      if (!later) {
        const classified = classifyAdmission(operation, head);
        requireAdmission(receipt.outcome === 5 ? classified === 5 : classified <= 4);
      }
      break;
    case 7:
      requireAdmission(head === null || head.revision !== revision);
      break;
    case 8:
      requireAdmission(older && head.operation.action === 2 && matchingHash);
  }
}
