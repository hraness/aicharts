import { admissionHex, equalAdmissionBytes, MAX_ADMISSION_TIMESTAMP, type AdmissionBatch, type AdmissionJournal } from "../../../lib/usage/admission";
import {
  AdmissionFault, auditReceiptHead, batchAccount, decideAdmission, freezeAdmission, lastSequence,
  MAX_ADMISSION_DAY_HEADS, MAX_ADMISSION_HEADS, MAX_ADMISSION_REVISIONS, operationDay, isZeroHash,
  ownedAdmissionBatch, ownedAdmissionJournal, ownedAdmissionOperation, requireAdmission, timestampsAtMost,
  type AdmissionHead, type AdmissionDecision,
} from "./admission-policy";
import { ADMISSION_SCHEMA } from "./admission-schema";

export type AdmissionAuthority = {
  accountId: string; generation: string; observedAtMs: number; phase: "pending" | "active";
  devices: readonly { deviceId: string; enrolledAtMs: number; revokedAtMs: number | null;
    reservation: { intentId: string; uploadCommitment: string } }[];
};
export type AdmissionControl = { revision: number; committed: number; observed: number; heads: number; live: number; quarantined: boolean };
export type AdmissionProgress = { device: string; sequence: number; batch: AdmissionBatch | null; journal: AdmissionJournal | null };
export type AdmissionPending = { phase: 1 | 2; predecessor: number; batch: AdmissionBatch; journal: AdmissionJournal | null };
type Row = Record<string, SqlStorageValue>;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const bytes = (value: unknown): Uint8Array => {
  requireAdmission(value instanceof ArrayBuffer);
  return new Uint8Array(value);
};
export const admissionIdBytes = (hex: string) => Uint8Array.from(hex.match(/../gu) ?? [], pair => Number.parseInt(pair, 16));
const sameAccount = (batch: AdmissionBatch, authority: AdmissionAuthority) => batchAccount(batch) === authority.accountId && admissionHex(batch.generation) === authority.generation;

function journalLifetime(authority: AdmissionAuthority, batch: AdmissionBatch, journal: AdmissionJournal): void {
  const device = authority.devices.find(device => device.deviceId === admissionHex(batch.deviceId));
  requireAdmission(device && journal.committedAtMs >= device.enrolledAtMs);
  const revokedDecision = journal.receipts[0].outcome === 7;
  requireAdmission(revokedDecision ? device.revokedAtMs !== null && device.revokedAtMs <= journal.committedAtMs
    : device.revokedAtMs === null || journal.committedAtMs <= device.revokedAtMs);
}

/** Synchronous SQL phases only. The owner supplies transactions and authority. */
export class AdmissionState {
  constructor(readonly sql: SqlStorage) {}

  initialize(authority: AdmissionAuthority | null): void {
    for (const definition of Object.values(ADMISSION_SCHEMA)) this.sql.exec(definition);
    this.sql.exec("INSERT INTO usage_admission_control (id, policy_version, published_revision, committed_at_ms, observed_at_ms, head_count, live_count, quarantined) VALUES (1, 1, 0, 0, ?, 0, 0, 0)", authority?.observedAtMs ?? 0);
    for (const device of authority?.devices ?? []) this.addDevice(device.deviceId);
  }
  addDevice(device: string): void {
    this.sql.exec("INSERT INTO usage_admission_devices (device_id, settled_sequence, last_batch, last_journal) VALUES (?, 0, NULL, NULL)", admissionIdBytes(device));
  }
  control(): AdmissionControl {
    const rows = this.sql.exec("SELECT * FROM usage_admission_control LIMIT 2").toArray(), row = rows[0];
    requireAdmission(rows.length === 1 && row?.id === 1 && row.policy_version === 1
      && integer(row.published_revision, 0, MAX_ADMISSION_REVISIONS) && integer(row.committed_at_ms, 0, MAX_ADMISSION_TIMESTAMP)
      && integer(row.observed_at_ms, row.committed_at_ms, MAX_ADMISSION_TIMESTAMP) && integer(row.head_count, 0, MAX_ADMISSION_HEADS)
      && integer(row.live_count, 0, row.head_count) && (row.quarantined === 0 || row.quarantined === 1));
    requireAdmission(row.published_revision !== 0 || (row.committed_at_ms === 0 && row.head_count === 0 && row.live_count === 0));
    return { revision: row.published_revision, committed: row.committed_at_ms, observed: row.observed_at_ms,
      heads: row.head_count, live: row.live_count, quarantined: row.quarantined === 1 };
  }
  observe(now: number): void {
    this.sql.exec("UPDATE usage_admission_control SET observed_at_ms = ? WHERE id = 1", now);
  }
  quarantine(): void { this.sql.exec("UPDATE usage_admission_control SET quarantined = 1 WHERE id = 1"); }

  #progress(row: Row, authority: AdmissionAuthority, control: AdmissionControl): AdmissionProgress {
    const deviceBytes = bytes(row.device_id), device = admissionHex(deviceBytes);
    requireAdmission(deviceBytes.length === 32 && authority.devices.some(item => item.deviceId === device)
      && integer(row.settled_sequence, 0, 256 * control.revision));
    if (row.settled_sequence === 0) {
      requireAdmission(row.last_batch === null && row.last_journal === null);
      return { device, sequence: 0, batch: null, journal: null };
    }
    const batch = ownedAdmissionBatch(bytes(row.last_batch)), journal = ownedAdmissionJournal(bytes(row.last_journal), batch);
    requireAdmission(sameAccount(batch, authority) && admissionHex(batch.deviceId) === device && lastSequence(batch) === row.settled_sequence
      && journal.accountJournalRevision <= control.revision && journal.committedAtMs <= control.committed
      && row.settled_sequence <= 256 * journal.accountJournalRevision);
    timestampsAtMost(batch, journal.committedAtMs);
    journalLifetime(authority, batch, journal);
    return { device, sequence: row.settled_sequence, batch, journal };
  }
  progress(device: Uint8Array, authority: AdmissionAuthority, control = this.control()): AdmissionProgress {
    const rows = this.sql.exec("SELECT * FROM usage_admission_devices WHERE device_id = ? LIMIT 2", device).toArray();
    requireAdmission(rows.length === 1);
    return this.#progress(rows[0], authority, control);
  }
  pending(authority: AdmissionAuthority | null, control = this.control()): AdmissionPending | null {
    const rows = this.sql.exec("SELECT * FROM usage_admission_pending LIMIT 2").toArray();
    requireAdmission(rows.length <= 1);
    if (rows.length === 0) return null;
    const row = rows[0];
    requireAdmission(authority?.phase === "active" && row.id === 1 && (row.phase === 1 || row.phase === 2)
      && integer(row.predecessor_revision, 0, MAX_ADMISSION_REVISIONS - 1) && row.predecessor_revision === control.revision);
    const batch = ownedAdmissionBatch(bytes(row.batch));
    requireAdmission(sameAccount(batch, authority));
    const progress = this.progress(batch.deviceId, authority, control);
    requireAdmission(batch.firstSequence === progress.sequence + 1);
    if (row.phase === 1) {
      requireAdmission(row.journal === null);
      timestampsAtMost(batch, control.observed);
      return { phase: 1, predecessor: row.predecessor_revision, batch, journal: null };
    }
    const journal = ownedAdmissionJournal(bytes(row.journal), batch);
    requireAdmission(journal.accountJournalRevision === control.revision + 1 && journal.committedAtMs >= control.committed
      && journal.committedAtMs <= control.observed);
    timestampsAtMost(batch, journal.committedAtMs);
    journalLifetime(authority, batch, journal);
    // Heads are still the predecessor's projection. Frozen revoked decisions
    // use their retained outcome, not the device's current active flag.
    const decision = decideAdmission(batch, this.heads(batch, authority, control), journal.receipts[0].outcome === 7);
    requireAdmission(equalAdmissionBytes(freezeAdmission(batch, decision, journal.accountJournalRevision, journal.committedAtMs).bytes, journal.bytes));
    return { phase: 2, predecessor: row.predecessor_revision, batch, journal };
  }
  #head(row: Row, authority: AdmissionAuthority, control: AdmissionControl): AdmissionHead {
    const operation = ownedAdmissionOperation(bytes(row.operation)), id = bytes(row.occurrence_id), day = operationDay(operation);
    requireAdmission(id.length === 16 && equalAdmissionBytes(id, operation.occurrenceId)
      && `acct_${admissionHex(operation.accountId)}` === authority.accountId
      && admissionHex(operation.generation) === authority.generation
      && integer(row.journal_revision, 1, control.revision) && row.utc_day === (day?.day ?? null)
      && (day === null || day.timestamp <= control.observed)
      && (operation.action !== 2 || !isZeroHash(operation.expectedHeadHash)));
    return { operation, revision: row.journal_revision, day: day?.day ?? null };
  }
  head(id: Uint8Array, authority: AdmissionAuthority, control = this.control()): AdmissionHead | null {
    const rows = this.sql.exec("SELECT * FROM usage_admission_heads WHERE occurrence_id = ? LIMIT 2", id).toArray();
    requireAdmission(rows.length <= 1);
    return rows.length === 0 ? null : this.#head(rows[0], authority, control);
  }
  heads(batch: AdmissionBatch, authority: AdmissionAuthority, control = this.control()): (AdmissionHead | null)[] {
    return batch.operations.map(operation => this.head(operation.occurrenceId, authority, control));
  }
  dayCount(day: number): number {
    const rows = this.sql.exec("SELECT utc_day, live_count FROM usage_admission_days WHERE utc_day = ? LIMIT 2", day).toArray();
    requireAdmission(rows.length <= 1);
    if (rows.length === 0) return 0;
    requireAdmission(rows[0].utc_day === day && integer(rows[0].live_count, 1, MAX_ADMISSION_DAY_HEADS));
    return rows[0].live_count;
  }

  /** Net changes, not per-member intermediate counts; no mutation before caps. */
  projection(batch: AdmissionBatch, journal: AdmissionDecision, heads: readonly (AdmissionHead | null)[], control: AdmissionControl): { heads: number; live: number; days: Map<number, number> } {
    let headCount = control.heads, live = control.live;
    const deltas = new Map<number, number>();
    const delta = (day: number, amount: number) => deltas.set(day, (deltas.get(day) ?? 0) + amount);
    if (journal.status === 1) batch.operations.forEach((operation, index) => {
      if (journal.receipts[index].outcome > 3) return;
      const before = heads[index], after = operationDay(operation);
      if (!before) headCount += 1;
      if (before?.day !== null && before?.day !== undefined) { delta(before.day, -1); live -= 1; }
      if (after) { delta(after.day, 1); live += 1; }
    });
    const days = new Map<number, number>();
    for (const [day, change] of deltas) days.set(day, this.dayCount(day) + change);
    if (!integer(headCount, 0, MAX_ADMISSION_HEADS) || !integer(live, 0, headCount)
      || [...days.values()].some(count => !integer(count, 0, MAX_ADMISSION_DAY_HEADS))) throw new AdmissionFault("limit");
    return { heads: headCount, live, days };
  }
  reserve(batch: AdmissionBatch, authority: AdmissionAuthority, now: number): AdmissionPending {
    const control = this.control();
    requireAdmission(this.pending(authority, control) === null);
    if (control.revision === MAX_ADMISSION_REVISIONS) throw new AdmissionFault("limit");
    const heads = this.heads(batch, authority, control), decision = decideAdmission(batch, heads, false);
    this.projection(batch, decision, heads, control);
    this.sql.exec("INSERT INTO usage_admission_pending (id, phase, predecessor_revision, batch, journal) VALUES (1, 1, ?, ?, NULL)", control.revision, batch.bytes);
    this.observe(now);
    return { phase: 1, predecessor: control.revision, batch, journal: null };
  }
  freeze(pending: AdmissionPending, authority: AdmissionAuthority, now: number): AdmissionPending {
    if (pending.phase === 2) return pending;
    const control = this.control(), device = authority.devices.find(device => device.deviceId === admissionHex(pending.batch.deviceId));
    requireAdmission(device && pending.predecessor === control.revision);
    const heads = this.heads(pending.batch, authority, control), decision = decideAdmission(pending.batch, heads, device.revokedAtMs !== null);
    this.projection(pending.batch, decision, heads, control);
    const journal = freezeAdmission(pending.batch, decision, control.revision + 1, now);
    this.sql.exec("UPDATE usage_admission_pending SET phase = 2, journal = ? WHERE id = 1", journal.bytes);
    return { ...pending, phase: 2, journal };
  }
  publish(pending: AdmissionPending, authority: AdmissionAuthority): Uint8Array {
    const control = this.control(), { batch, journal } = pending;
    requireAdmission(pending.phase === 2 && journal && pending.predecessor === control.revision);
    const heads = this.heads(batch, authority, control), projection = this.projection(batch, journal, heads, control);
    if (journal.status === 1) batch.operations.forEach((operation, index) => {
      if (journal.receipts[index].outcome > 3) return;
      this.sql.exec("INSERT INTO usage_admission_heads (occurrence_id, operation, journal_revision, utc_day) VALUES (?, ?, ?, ?) ON CONFLICT(occurrence_id) DO UPDATE SET operation = excluded.operation, journal_revision = excluded.journal_revision, utc_day = excluded.utc_day",
        operation.occurrenceId, operation.bytes, journal.accountJournalRevision, operationDay(operation)?.day ?? null);
    });
    for (const [day, count] of projection.days) {
      if (count === 0) this.sql.exec("DELETE FROM usage_admission_days WHERE utc_day = ?", day);
      else this.sql.exec("INSERT INTO usage_admission_days (utc_day, live_count) VALUES (?, ?) ON CONFLICT(utc_day) DO UPDATE SET live_count = excluded.live_count", day, count);
    }
    this.sql.exec("UPDATE usage_admission_devices SET settled_sequence = ?, last_batch = ?, last_journal = ? WHERE device_id = ?", lastSequence(batch), batch.bytes, journal.bytes, batch.deviceId);
    this.sql.exec("UPDATE usage_admission_control SET published_revision = ?, committed_at_ms = ?, head_count = ?, live_count = ? WHERE id = 1", journal.accountJournalRevision, journal.committedAtMs, projection.heads, projection.live);
    this.sql.exec("DELETE FROM usage_admission_pending WHERE id = 1");
    return Uint8Array.from(journal.bytes);
  }

  /** Finite restart audit: stream heads, retain bounded metadata, no cross-product. */
  audit(authority: AdmissionAuthority | null): void {
    const control = this.control();
    requireAdmission(control.observed >= (authority?.observedAtMs ?? 0));
    const devices = new Map<string, { sequence: number; first: number; revision: number }>();
    const latestRevisions = new Set<number>();
    const latestTimes: { revision: number; time: number }[] = [];
    const latestCreators = new Map<string, Uint8Array>();
    let sequences = 0, maxRevision = 0, maxTime = 0, deviceCount = 0;
    for (const row of this.sql.exec("SELECT * FROM usage_admission_devices LIMIT 129")) {
      requireAdmission(authority && ++deviceCount <= 128);
      const progress = this.#progress(row, authority, control);
      requireAdmission(!devices.has(progress.device));
      devices.set(progress.device, { sequence: progress.sequence, first: progress.batch?.firstSequence ?? 0, revision: progress.journal?.accountJournalRevision ?? 0 });
      sequences += progress.sequence;
      requireAdmission(Number.isSafeInteger(sequences));
      if (!progress.journal || !progress.batch) continue;
      const { batch, journal } = progress;
      requireAdmission(!latestRevisions.has(journal.accountJournalRevision));
      latestRevisions.add(journal.accountJournalRevision);
      latestTimes.push({ revision: journal.accountJournalRevision, time: journal.committedAtMs });
      if (journal.accountJournalRevision > maxRevision) { maxRevision = journal.accountJournalRevision; maxTime = journal.committedAtMs; }
      batch.operations.forEach((operation, index) => {
        auditReceiptHead(operation, journal.receipts[index], journal.accountJournalRevision, this.head(operation.occurrenceId, authority, control));
        if (journal.receipts[index].outcome <= 3) latestCreators.set(`${journal.accountJournalRevision}:${admissionHex(operation.occurrenceId)}`, operation.bytes);
      });
    }
    requireAdmission(deviceCount === (authority?.devices.length ?? 0) && maxRevision === control.revision && maxTime === control.committed
      && sequences >= control.revision && sequences <= 256 * control.revision);
    latestTimes.sort((left, right) => left.revision - right.revision);
    for (let index = 1; index < latestTimes.length; index += 1) requireAdmission(latestTimes[index].time >= latestTimes[index - 1].time);
    const dayCounts = new Map<number, number>(), seenSequences = new Set<string>(), revisionOwners = new Map<number, string>();
    let headCount = 0, liveCount = 0;
    for (const row of this.sql.exec("SELECT * FROM usage_admission_heads LIMIT 100001")) {
      requireAdmission(authority && ++headCount <= MAX_ADMISSION_HEADS);
      const head = this.#head(row, authority, control), deviceId = admissionHex(head.operation.deviceId), progress = devices.get(deviceId);
      requireAdmission(progress && head.operation.sequence <= progress.sequence && head.operation.sequence <= 256 * head.revision
        && head.revision <= progress.revision && (head.revision === progress.revision || head.operation.sequence < progress.first));
      const sequenceKey = `${deviceId}:${head.operation.sequence}`;
      requireAdmission(!seenSequences.has(sequenceKey)); seenSequences.add(sequenceKey);
      const owner = revisionOwners.get(head.revision);
      requireAdmission(owner === undefined || owner === deviceId); revisionOwners.set(head.revision, deviceId);
      if (latestRevisions.has(head.revision)) {
        const creator = latestCreators.get(`${head.revision}:${admissionHex(head.operation.occurrenceId)}`);
        requireAdmission(creator && equalAdmissionBytes(creator, head.operation.bytes));
      }
      if (head.day !== null) {
        liveCount += 1; dayCounts.set(head.day, (dayCounts.get(head.day) ?? 0) + 1);
      }
    }
    requireAdmission(headCount === control.heads && liveCount === control.live);
    let days = 0;
    for (const row of this.sql.exec("SELECT utc_day, live_count FROM usage_admission_days LIMIT 100001")) {
      requireAdmission(++days <= liveCount && integer(row.utc_day, 0, 100_000_000) && integer(row.live_count, 1, MAX_ADMISSION_DAY_HEADS)
        && dayCounts.get(row.utc_day) === row.live_count);
    }
    requireAdmission(days === dayCounts.size);
    const pending = this.pending(authority, control);
    if (pending) {
      requireAdmission(authority);
      const heads = this.heads(pending.batch, authority, control);
      this.projection(pending.batch, pending.journal ?? decideAdmission(pending.batch, heads, false), heads, control);
    }
  }
}
