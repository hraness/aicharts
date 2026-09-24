import { admissionHex, equalAdmissionBytes, type AdmissionOperation } from "../../../lib/usage/admission";
import { contributionPayloadHash, ContributionFault, type ContributionHead, type ContributionLegacySeal } from "../../../lib/usage/contributions";
import { parseUsageStatsRow, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { decodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1, auditReceiptHead, ownedAdmissionBatch, ownedAdmissionJournal } from "./admission-policy";
import { AdmissionState, admissionIdBytes } from "./admission-state";
import { StatsState } from "./stats-state";

export function legacyContributionRow(operation: AdmissionOperation): UsageStatsRow {
  if (operation.action !== 1) throw new ContributionFault("storage_invalid");
  const frame = decodeUsageBatch(operation.frame, ADMISSION_POLICY_V1);
  if (!frame.ok || frame.value.usage.length !== 1 || !equalAdmissionBytes(frame.value.usage[0].id, operation.occurrenceId))
    throw new ContributionFault("storage_invalid");
  const usage = frame.value.usage[0], token = usage.tokens;
  const client = usage.provider === 1 ? "codex" : usage.provider === 2 ? "claude" : usage.provider === 3 ? "devin-cli" : null;
  if (client === null) throw new ContributionFault("storage_invalid");
  const row = parseUsageStatsRow({ utcDay: frame.value.utcDay, client, provider: null, model: null,
    tokens: { input: token.inputUncached.toString(), cacheRead: token.cacheRead.toString(),
      cacheWrite: (token.cacheWrite5m + token.cacheWrite1h).toString(), output: (token.output - token.reasoningOutput).toString(), reasoning: token.reasoningOutput.toString() },
    records: 1, reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
    durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" });
  if (!row) throw new ContributionFault("limit"); return row;
}

/** Sealed V1 is an immutable account base, never an invented device population.
 * One indexed head and its bounded original journal establish the exact member
 * and original object reference. No whole-account scan or writes occur here. */
export function sealedLegacyHead(sql: SqlStorage, id: string, seal: ContributionLegacySeal): ContributionHead | null {
  const admission = new AdmissionState(sql), control = admission.control(), stats = new StatsState(sql).control();
  if (control.revision !== seal.v1Revision || control.heads !== seal.v1HeadCount || control.live !== seal.v1LiveCount
    || control.quarantined || stats.revision !== seal.v2Revision || stats.quarantined) throw new ContributionFault("recovery_required");
  const authority = { accountId: seal.accountId, generation: seal.generation, observedAtMs: control.observed,
    phase: "active" as const, devices: [] };
  const head = admission.head(admissionIdBytes(id), authority, control);
  if (!head) return null;
  const rows = sql.exec("SELECT batch, journal FROM usage_admission_journal WHERE revision=? LIMIT 2", head.revision).toArray();
  if (rows.length !== 1 || !(rows[0].batch instanceof ArrayBuffer) || !(rows[0].journal instanceof ArrayBuffer)) throw new ContributionFault("storage_invalid");
  const batch = ownedAdmissionBatch(new Uint8Array(rows[0].batch)), journal = ownedAdmissionJournal(new Uint8Array(rows[0].journal), batch);
  const index = batch.operations.findIndex(operation => equalAdmissionBytes(operation.occurrenceId, head.operation.occurrenceId));
  if (index < 0 || !equalAdmissionBytes(batch.operations[index].bytes, head.operation.bytes) || journal.accountJournalRevision !== head.revision)
    throw new ContributionFault("storage_invalid");
  auditReceiptHead(head.operation, journal.receipts[index], head.revision, head);
  const hash = admissionHex(head.operation.operationHash);
  if (head.operation.action === 2) return { id, headHash: hash, payloadHash: null, reference: null,
    members: 0, deleted: true, legacySupport: true, suppressedLegacy: false };
  const row = legacyContributionRow(head.operation), payloadHash = contributionPayloadHash(row);
  // A historical aggregate owning this cell may have superseded V1 under an
  // older binary. Preserve that suppression until exact population mapping;
  // migration never resurrects the hidden V1 row merely because bytes remain.
  const suppressedLegacy = sql.exec("SELECT 1 FROM usage_stats_days WHERE client=? AND utc_day=? LIMIT 1", row.client, row.utcDay).toArray().length !== 0;
  return { id, headHash: hash, payloadHash, reference: { kind: "admission-v1", generation: seal.generation,
    bodyHash: admissionHex(batch.batchHash), index, payloadHash, operationHash: hash }, members: 0,
    deleted: false, legacySupport: true, suppressedLegacy };
}
