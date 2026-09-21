import { LEADERBOARD_MAX_RECORDS } from "../../../lib/usage/leaderboard-contract";
import { createHash } from "node:crypto";
import { admissionHex, equalAdmissionBytes, type AdmissionBatch } from "../../../lib/usage/admission";
import { parseUsageStatsReport, statsRowKey, statsTokenTotal, type SourceCoverage, type UsageStatsReport, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { isStatsClient } from "../../../lib/usage/stats-registry";
import { STATS_HTTP_RESPONSE_BYTES, STATS_HTTP_RESPONSE_ROWS, parseStatsReceipt, statsHex, statsInteger, type StatsError, type StatsRange, type StatsReceipt, type StatsStatus, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import type { StatsAbandonRequest, StatsAbandonment } from "../../../lib/usage/stats-http-contract";
import { decodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1, AdmissionFault, operationDay } from "./admission-policy";
import { AdmissionState, type AdmissionAuthority } from "./admission-state";

export const MAX_STATS_STORED_DAYS = 65_536;
export const MAX_STATS_STORED_ROWS = 262_144;
export const MAX_STATS_STORED_BYTES = 128 * 1024 * 1024;
export const MAX_STATS_IMMUTABLE_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_STATS_REVISIONS = 1_000_000;
export const STATS_SCHEMA = Object.freeze({
  usage_stats_control: `CREATE TABLE usage_stats_control (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 1000000), updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN 0 AND 8640000000000000), quarantined INTEGER NOT NULL CHECK (quarantined IN (0, 1)), immutable_bytes INTEGER NOT NULL CHECK (immutable_bytes BETWEEN 0 AND 8589934592))`,
  usage_stats_writers: `CREATE TABLE usage_stats_writers (client TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL CHECK (length(device_id) = 64)) WITHOUT ROWID`,
  usage_stats_devices: `CREATE TABLE usage_stats_devices (device_id TEXT PRIMARY KEY NOT NULL CHECK (length(device_id) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), receipt TEXT NOT NULL CHECK (length(receipt) <= 1024)) WITHOUT ROWID`,
  usage_stats_pending: `CREATE TABLE usage_stats_pending (id INTEGER PRIMARY KEY CHECK (id = 1), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), device_id TEXT NOT NULL CHECK (length(device_id) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), expected_revision INTEGER NOT NULL CHECK (expected_revision BETWEEN 0 AND 999999), receipt TEXT CHECK (receipt IS NULL OR length(receipt) <= 1024))`,
  usage_stats_days: `CREATE TABLE usage_stats_days (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64), row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 8192), byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 4194304), projection TEXT NOT NULL CHECK (length(projection) <= 4194304), PRIMARY KEY (client, utc_day)) WITHOUT ROWID`,
});
export class StatsFault extends Error { constructor(readonly code: StatsError = "storage_invalid") { super(code); } }
function requireStats(value: unknown): asserts value { if (!value) throw new StatsFault(); }
export const statsHash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const statsUploadText = (request: StatsUpload): string => JSON.stringify(request);
const legacyClient = (provider: number): string => provider === 1 ? "codex" : provider === 2 ? "claude" : "devin-cli";
type Control = { revision: number; updatedAtMs: number; quarantined: boolean; immutableBytes: number };
export type StatsPending = { bodyHash: string; deviceId: string; sequence: number; expectedRevision: number; receipt: StatsReceipt | null };
type StoredDay = { client: string; utcDay: number; revision: number; bodyHash: string; text: string; report: UsageStatsReport };

/** Account transaction owner supplies authority and serialization. R2 retains
 * authoritative snapshots; these numeric daily projections are rebuildable. */
export class StatsState {
  constructor(readonly sql: SqlStorage) {}
  initialize(): void {
    for (const definition of Object.values(STATS_SCHEMA)) this.sql.exec(definition);
    this.sql.exec("INSERT INTO usage_stats_control VALUES (1, 0, 0, 0, 0)");
  }
  control(): Control {
    const rows = this.sql.exec("SELECT * FROM usage_stats_control LIMIT 2").toArray(), row = rows[0];
    requireStats(rows.length === 1 && row.id === 1 && statsInteger(row.revision, 0, MAX_STATS_REVISIONS)
      && statsInteger(row.updated_at_ms, 0, 8_640_000_000_000_000) && (row.quarantined === 0 || row.quarantined === 1)
      && (row.revision !== 0 || row.updated_at_ms === 0) && statsInteger(row.immutable_bytes, 0, MAX_STATS_IMMUTABLE_BYTES));
    return { revision: row.revision, updatedAtMs: row.updated_at_ms, quarantined: row.quarantined === 1, immutableBytes: row.immutable_bytes };
  }
  quarantine(): void { this.sql.exec("UPDATE usage_stats_control SET quarantined = 1 WHERE id = 1"); }
  /** The enclosing transaction already durably revokes this device. An
   * uncommitted intent cannot hold unrelated clients hostage afterward. R2
   * objects remain immutable evidence; only the uncommitted pointer is gone. */
  revokeDevice(deviceId: string): void {
    this.sql.exec("DELETE FROM usage_stats_pending WHERE id = 1 AND device_id = ?", deviceId);
  }
  writer(client: string): string | null {
    const rows = this.sql.exec("SELECT device_id FROM usage_stats_writers WHERE client = ? LIMIT 2", client).toArray();
    requireStats(rows.length <= 1 && (!rows.length || statsHex(rows[0].device_id)));
    return rows.length ? rows[0].device_id as string : null;
  }
  progress(device: string): { sequence: number; receipt: StatsReceipt | null } {
    const rows = this.sql.exec("SELECT sequence, receipt FROM usage_stats_devices WHERE device_id = ? LIMIT 2", device).toArray();
    requireStats(rows.length <= 1);
    if (!rows.length) return { sequence: 0, receipt: null };
    const row = rows[0], receipt = typeof row.receipt === "string" ? parseStatsReceipt(JSON.parse(row.receipt)) : null;
    requireStats(statsInteger(row.sequence, 1) && receipt && receipt.sequence === row.sequence && receipt.revision <= this.control().revision);
    return { sequence: row.sequence, receipt };
  }
  /** Maintenance fences advance control revision without publishing data.
   * Device receipts prove publication even when an explicit empty snapshot
   * intentionally created no day projections. */
  hasCommittedSnapshot(): boolean {
    const rows = this.sql.exec("SELECT device_id FROM usage_stats_devices LIMIT 1").toArray();
    if (rows.length === 0) return false;
    requireStats(statsHex(rows[0].device_id));
    return this.progress(rows[0].device_id).receipt !== null;
  }
  pending(): StatsPending | null {
    const rows = this.sql.exec("SELECT * FROM usage_stats_pending LIMIT 2").toArray();
    requireStats(rows.length <= 1);
    if (!rows.length) return null;
    const row = rows[0], receipt = row.receipt === null ? null : typeof row.receipt === "string" ? parseStatsReceipt(JSON.parse(row.receipt)) : null;
    requireStats(row.id === 1 && statsHex(row.body_hash) && statsHex(row.device_id) && statsInteger(row.sequence, 1)
      && statsInteger(row.expected_revision, 0, MAX_STATS_REVISIONS - 1) && (row.receipt === null || receipt)
      && (receipt === null || (receipt.bodyHash === row.body_hash && receipt.sequence === row.sequence && receipt.revision === row.expected_revision + 1)));
    return { bodyHash: row.body_hash, deviceId: row.device_id, sequence: row.sequence, expectedRevision: row.expected_revision, receipt };
  }
  owns(client: string, day: number): boolean {
    return this.sql.exec("SELECT 1 FROM usage_stats_days WHERE client = ? AND utc_day = ? LIMIT 1", client, day).toArray().length === 1;
  }
  #day(raw: Record<string, SqlStorageValue>, control = this.control()): StoredDay {
    requireStats(isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, 99_999_999) && statsInteger(raw.revision, 1, control.revision)
      && statsHex(raw.body_hash) && statsHex(raw.projection_hash) && typeof raw.projection === "string"
      && new TextEncoder().encode(raw.projection).length === raw.byte_count && statsHash(raw.projection) === raw.projection_hash);
    const report = parseUsageStatsReport(JSON.parse(raw.projection));
    requireStats(report && report.sources.length === 1 && report.sources[0].client === raw.client && report.dayCount === 1
      && report.firstUtcDay === raw.utc_day && report.rows.length === raw.row_count && report.revision === raw.revision);
    return { client: raw.client, utcDay: raw.utc_day, revision: raw.revision, bodyHash: raw.body_hash, text: raw.projection, report };
  }
  #legacy(authority: AdmissionAuthority, range: StatsRange) {
    const admission = new AdmissionState(this.sql), control = admission.control(), sql = this.sql;
    function* heads() {
      let count = 0;
      for (const row of sql.exec("SELECT occurrence_id FROM usage_admission_heads WHERE utc_day >= ? AND utc_day < ? ORDER BY occurrence_id LIMIT 100001", range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
        requireStats(row.occurrence_id instanceof ArrayBuffer && ++count <= 100_000);
        const head = admission.head(new Uint8Array(row.occurrence_id), authority, control);
        requireStats(head && head.day !== null);
        const batch = decodeUsageBatch(head.operation.frame, ADMISSION_POLICY_V1);
        requireStats(batch.ok);
        yield { head, usage: batch.value.usage[0], client: legacyClient(batch.value.usage[0].provider) };
      }
    }
    return { control, heads: heads() };
  }
  status(authority: AdmissionAuthority, deviceId: string, client: string, range: StatsRange): StatsStatus {
    const { control, heads } = this.#legacy(authority, range), hash = createHash("sha256").update("aicharts:stats-v2:legacy-heads\0").update(client).update("\0").update(`${range.firstUtcDay}:${range.dayCount}\0`);
    let legacyRecords = 0, eligible = true;
    const ownedDays = new Set(this.sql.exec("SELECT utc_day FROM usage_stats_days WHERE client = ? AND utc_day >= ? AND utc_day < ? LIMIT 367", client, range.firstUtcDay, range.firstUtcDay + range.dayCount).toArray().map(row => row.utc_day));
    requireStats(ownedDays.size <= 366);
    for (const { head, client: source } of heads) {
      if (source !== client || ownedDays.has(head.day!)) continue;
      hash.update(head.operation.occurrenceId).update(head.operation.operationHash);
      legacyRecords++;
      if (admissionHex(head.operation.deviceId) !== deviceId) eligible = false;
    }
    // V1 tombstones deliberately discard their day/provider frame. Until an
    // explicit canonical reconciliation can establish that provenance, a
    // legacy-client snapshot must not resurrect an erased occurrence.
    if (["codex", "claude", "devin-cli"].includes(client) && ownedDays.size < range.dayCount) {
      const admission = new AdmissionState(this.sql);
      let tombstones = 0;
      for (const row of this.sql.exec("SELECT occurrence_id FROM usage_admission_heads WHERE utc_day IS NULL ORDER BY occurrence_id LIMIT 100001")) {
        requireStats(++tombstones <= 100_000 && row.occurrence_id instanceof ArrayBuffer);
        const head = admission.head(new Uint8Array(row.occurrence_id), authority, control);
        requireStats(head && head.operation.action === 2);
        hash.update(head.operation.occurrenceId).update(head.operation.operationHash); eligible = false;
      }
    }
    return { schemaVersion: 2, revision: this.control().revision, nextSequence: this.progress(deviceId).sequence + 1,
      writerDeviceId: this.writer(client), v1Revision: control.revision, headDigest: hash.digest("hex"), legacyRecords, takeoverEligible: eligible };
  }
  guardV1(batch: AdmissionBatch, authority: AdmissionAuthority): void {
    const admission = new AdmissionState(this.sql), progress = admission.progress(batch.deviceId, authority);
    if (progress.batch && equalAdmissionBytes(progress.batch.bytes, batch.bytes)) return;
    // An authenticated v2 intent fences the complete legacy basis until it
    // settles. Otherwise a concurrent v1 commit could strand an immutable
    // takeover request after its expected predecessor had changed.
    if (this.pending() !== null) throw new AdmissionFault("conflict");
    for (const operation of batch.operations) {
      const before = admission.head(operation.occurrenceId, authority);
      for (const candidate of [before?.operation, operation]) {
        if (!candidate || candidate.action === 2) continue;
        const day = operationDay(candidate), frame = decodeUsageBatch(candidate.frame, ADMISSION_POLICY_V1);
        requireStats(day && frame.ok);
        if (this.owns(legacyClient(frame.value.usage[0].provider), day.day)) throw new AdmissionFault("profile_superseded");
      }
    }
  }
  #projections(request: StatsUpload, receipt: StatsReceipt): readonly { day: number; text: string; rows: number }[] {
    const report = request.report, source = report.sources[0];
    return Array.from({ length: report.dayCount }, (_, index) => {
      const day = report.firstUtcDay + index, rows = report.rows.filter(row => row.utcDay === day), records = rows.reduce((sum, row) => sum + row.records, 0);
      if (request.mode === "preserve-history") {
        if (rows.length === 0) return null;
        const prior = this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? AND utc_day = ? LIMIT 1", source.client, day).toArray()[0];
        if (prior) {
          const next = new Map(rows.map(row => [statsRowKey(row), row]));
          for (const old of this.#day(prior).report.rows) {
            const row = next.get(statsRowKey(old));
            if (!row || row.records < old.records || (old.breakdownCoverage === "complete" && row.breakdownCoverage !== "complete")
              || row.reportedCostRecords < old.reportedCostRecords || row.estimatedCostRecords < old.estimatedCostRecords
              || row.timedRecords < old.timedRecords || BigInt(row.timedTokens) < BigInt(old.timedTokens)
              || Object.keys(old.tokens).some(key => BigInt(row.tokens[key as keyof typeof row.tokens]) < BigInt(old.tokens[key as keyof typeof old.tokens]))
              || (["reportedCostMicrousd", "estimatedCostMicrousd", "durationMs"] as const).some(key => old[key] !== null && (row[key] === null || BigInt(row[key]!) < BigInt(old[key]!)))) throw new StatsFault("replacement_required");
          }
        }
      }
      const bases = new Set(rows.map(row => row.tokenBasis));
      const daily = parseUsageStatsReport({ ...report, firstUtcDay: day, dayCount: 1, revision: receipt.revision, updatedAtMs: receipt.committedAtMs,
        sources: [{ ...source, status: rows.length ? "observed" : "empty", records, tokenBasis: bases.size > 1 ? "mixed" : [...bases][0] ?? source.tokenBasis,
          latestAtMs: rows.length ? source.latestAtMs : null }], rows });
      requireStats(daily);
      return { day, text: JSON.stringify(daily), rows: rows.length };
    }).filter((value): value is { day: number; text: string; rows: number } => value !== null);
  }
  #capacity(request: StatsUpload, projections: readonly { day: number; text: string; rows: number }[]): void {
    const client = request.report.sources[0].client, first = request.report.firstUtcDay, last = first + request.report.dayCount;
    const [total] = this.sql.exec("SELECT COUNT(*) AS days, COALESCE(SUM(row_count), 0) AS rows, COALESCE(SUM(byte_count), 0) AS bytes FROM usage_stats_days").toArray();
    const selected = new Set(projections.map(value => value.day));
    const replaced = { days: 0, rows: 0, bytes: 0 };
    for (const row of this.sql.exec("SELECT utc_day, row_count, byte_count FROM usage_stats_days WHERE client = ? AND utc_day >= ? AND utc_day < ? LIMIT 367", client, first, last)) {
      requireStats(statsInteger(row.utc_day) && statsInteger(row.row_count) && statsInteger(row.byte_count));
      if (selected.has(row.utc_day)) { replaced.days++; replaced.rows += row.row_count; replaced.bytes += row.byte_count; }
    }
    if (request.mode === "replace-snapshot") {
      const [all] = this.sql.exec("SELECT COUNT(*) AS days, COALESCE(SUM(row_count), 0) AS rows, COALESCE(SUM(byte_count), 0) AS bytes FROM usage_stats_days WHERE client = ?", client).toArray();
      requireStats(statsInteger(all.days) && statsInteger(all.rows) && statsInteger(all.bytes));
      replaced.days = all.days; replaced.rows = all.rows; replaced.bytes = all.bytes;
    }
    for (const key of ["days", "rows", "bytes"] as const) requireStats(statsInteger(total[key]) && statsInteger(replaced[key]));
    const days = Number(total.days) - Number(replaced.days) + projections.length;
    const rows = Number(total.rows) - Number(replaced.rows) + projections.reduce((sum, value) => sum + value.rows, 0);
    const bytes = Number(total.bytes) - Number(replaced.bytes) + projections.reduce((sum, value) => sum + new TextEncoder().encode(value.text).length, 0);
    if (days > MAX_STATS_STORED_DAYS || rows > MAX_STATS_STORED_ROWS || bytes > MAX_STATS_STORED_BYTES) throw new StatsFault("limit");
  }
  #checkLegacyCoverage(request: StatsUpload, authority: AdmissionAuthority): void {
    const client = request.report.sources[0].client;
    const owned = new Set(this.sql.exec("SELECT utc_day FROM usage_stats_days WHERE client = ? AND utc_day >= ? AND utc_day < ? LIMIT 367",
      client, request.report.firstUtcDay, request.report.firstUtcDay + request.report.dayCount).toArray().map(row => row.utc_day));
    requireStats(owned.size <= 366);
    const incoming = new Map<number, { records: number; tokens: Record<keyof UsageStatsRow["tokens"], bigint> }>();
    for (const row of request.report.rows) {
      if (row.tokenBasis !== "reported") continue;
      const value = incoming.get(row.utcDay) ?? { records: 0, tokens: { input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n, reasoning: 0n } };
      value.records += row.records;
      for (const bucket of Object.keys(value.tokens) as (keyof typeof value.tokens)[]) value.tokens[bucket] += BigInt(row.tokens[bucket]);
      incoming.set(row.utcDay, value);
    }
    // The digest proves which predecessor was reviewed. These inequalities
    // separately prove that taking ownership cannot lose its numeric coverage.
    // Subtract each retained occurrence from the incoming per-day populations;
    // model regrouping is allowed, estimated rows cannot cover reported usage.
    for (const { head, usage, client: original } of this.#legacy(authority, request.report).heads) {
      if (original !== client || owned.has(head.day!)) continue;
      const value = incoming.get(head.day!), old = usage.tokens;
      if (!value || --value.records < 0) throw new StatsFault("replacement_required");
      const retained = { input: old.inputUncached, cacheRead: old.cacheRead, cacheWrite: old.cacheWrite5m + old.cacheWrite1h,
        output: old.output - old.reasoningOutput, reasoning: old.reasoningOutput };
      for (const bucket of Object.keys(retained) as (keyof typeof retained)[]) {
        value.tokens[bucket] -= retained[bucket];
        if (value.tokens[bucket] < 0n) throw new StatsFault("replacement_required");
      }
    }
  }
  check(request: StatsUpload, authority: AdmissionAuthority): void {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (control.revision >= MAX_STATS_REVISIONS) throw new StatsFault("limit");
    const client = request.report.sources[0].client, status = this.status(authority, request.deviceId, client, request.report);
    if (status.writerDeviceId !== null && status.writerDeviceId !== request.deviceId) throw new StatsFault("writer_conflict");
    if (request.expectedRevision !== status.revision || request.sequence !== status.nextSequence) throw new StatsFault("conflict");
    if (request.mode === "replace-snapshot") {
      const previous = this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? ORDER BY utc_day DESC LIMIT 2", client).toArray();
      requireStats(previous.length <= 1);
      if (previous.length && (request.report.sources[0].latestAtMs ?? 0) < (this.#day(previous[0]).report.sources[0].latestAtMs ?? 0)) throw new StatsFault("clock_regressed");
    }
    if (new AdmissionState(this.sql).pending(authority)) throw new StatsFault("conflict");
    if (!status.takeoverEligible || (status.legacyRecords > 0 && request.takeover === null)) throw new StatsFault("takeover_required");
    if (request.takeover && (request.takeover.expectedV1Revision !== status.v1Revision || request.takeover.headDigest !== status.headDigest || !status.takeoverEligible)) throw new StatsFault("conflict");
    if (request.takeover && status.legacyRecords > 0) this.#checkLegacyCoverage(request, authority);
  }
  reserve(request: StatsUpload, authority: AdmissionAuthority, now: number): void {
    this.check(request, authority);
    requireStats(this.pending() === null);
    const bodyHash = statsHash(statsUploadText(request));
    const receipt: StatsReceipt = { schemaVersion: 2, operationId: request.operationId, bodyHash, sequence: request.sequence, revision: request.expectedRevision + 1,
      committedAtMs: now, client: request.report.sources[0].client, firstUtcDay: request.report.firstUtcDay, dayCount: request.report.dayCount };
    this.#capacity(request, this.#projections(request, receipt));
    // Reserve before any immutable write. Uncertain/abandoned objects retain
    // their charge permanently; replay of the same pending intent never enters
    // reserve again. Receipt headroom covers the complete bounded receipt body.
    const charge = new TextEncoder().encode(statsUploadText(request)).length + 1024;
    const retained = this.control().immutableBytes + charge;
    if (retained > MAX_STATS_IMMUTABLE_BYTES) throw new StatsFault("limit");
    this.sql.exec("UPDATE usage_stats_control SET immutable_bytes = ? WHERE id = 1", retained);
    this.sql.exec("INSERT INTO usage_stats_pending (id, body_hash, device_id, sequence, expected_revision, receipt) VALUES (1, ?, ?, ?, ?, NULL)", bodyHash, request.deviceId, request.sequence, request.expectedRevision);
  }
  freeze(request: StatsUpload, authority: AdmissionAuthority, now: number): StatsReceipt {
    this.check(request, authority);
    const pending = this.pending();
    requireStats(pending && pending.bodyHash === statsHash(statsUploadText(request)) && pending.deviceId === request.deviceId);
    if (pending.receipt) return pending.receipt;
    const receipt: StatsReceipt = { schemaVersion: 2, operationId: request.operationId, bodyHash: pending.bodyHash, sequence: request.sequence, revision: request.expectedRevision + 1,
      committedAtMs: now, client: request.report.sources[0].client, firstUtcDay: request.report.firstUtcDay, dayCount: request.report.dayCount };
    this.#capacity(request, this.#projections(request, receipt));
    this.sql.exec("UPDATE usage_stats_pending SET receipt = ? WHERE id = 1", JSON.stringify(receipt));
    return receipt;
  }
  publish(request: StatsUpload, authority: AdmissionAuthority): StatsReceipt {
    this.check(request, authority);
    const pending = this.pending();
    requireStats(pending?.receipt && pending.bodyHash === statsHash(statsUploadText(request)) && pending.deviceId === request.deviceId);
    const receipt = pending.receipt, projections = this.#projections(request, receipt);
    this.#capacity(request, projections);
    // Warp publishes a current billing-interval counter, not daily usage. Only
    // derived projections are replaced; immutable snapshots/receipts remain.
    if (request.mode === "replace-snapshot") this.sql.exec("DELETE FROM usage_stats_days WHERE client = ?", receipt.client);
    for (const day of projections) this.sql.exec("INSERT INTO usage_stats_days (client, utc_day, revision, body_hash, projection_hash, row_count, byte_count, projection) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client, utc_day) DO UPDATE SET revision = excluded.revision, body_hash = excluded.body_hash, projection_hash = excluded.projection_hash, row_count = excluded.row_count, byte_count = excluded.byte_count, projection = excluded.projection",
      receipt.client, day.day, receipt.revision, receipt.bodyHash, statsHash(day.text), day.rows, new TextEncoder().encode(day.text).length, day.text);
    this.sql.exec("INSERT INTO usage_stats_writers (client, device_id) VALUES (?, ?) ON CONFLICT(client) DO NOTHING", receipt.client, request.deviceId);
    this.sql.exec("INSERT INTO usage_stats_devices (device_id, sequence, receipt) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET sequence = excluded.sequence, receipt = excluded.receipt", request.deviceId, request.sequence, JSON.stringify(receipt));
    this.sql.exec("UPDATE usage_stats_control SET revision = ?, updated_at_ms = ? WHERE id = 1", receipt.revision, receipt.committedAtMs);
    this.sql.exec("DELETE FROM usage_stats_pending WHERE id = 1");
    return receipt;
  }
  abandon(request: StatsAbandonRequest, now: number): StatsAbandonment {
    const control = this.control(), progress = this.progress(request.deviceId);
    if (now < control.updatedAtMs) throw new StatsFault("clock_regressed");
    if (progress.receipt?.bodyHash === request.bodyHash && progress.receipt.operationId === request.operationId
      && progress.receipt.sequence === request.sequence && progress.receipt.revision === request.expectedRevision + 1) {
      return { schemaVersion: 2, outcome: "committed", receipt: progress.receipt };
    }
    // A different/higher device progress cannot prove whether this historical
    // request committed. Never discard the caller's uncertain flight by guess.
    if (progress.sequence !== request.sequence - 1 || control.revision < request.expectedRevision) throw new StatsFault("conflict");
    let fencedAtRevision = control.revision;
    if (control.revision === request.expectedRevision) {
      const pending = this.pending();
      if (pending && (pending.bodyHash !== request.bodyHash || pending.deviceId !== request.deviceId
        || pending.sequence !== request.sequence || pending.expectedRevision !== request.expectedRevision)) throw new StatsFault("conflict");
      if (control.revision >= MAX_STATS_REVISIONS) throw new StatsFault("limit");
      fencedAtRevision++;
      // A maintenance revision permanently fences every delayed stage of this
      // exact predecessor. Only derived pending metadata is removed; any R2
      // object and its reserved byte charge are retained as recovery evidence.
      this.sql.exec("UPDATE usage_stats_control SET revision = ?, updated_at_ms = ? WHERE id = 1", fencedAtRevision, now);
      if (pending) this.sql.exec("DELETE FROM usage_stats_pending WHERE id = 1 AND body_hash = ? AND device_id = ?", request.bodyHash, request.deviceId);
    }
    return { schemaVersion: 2, outcome: "abandoned", operationId: request.operationId, bodyHash: request.bodyHash,
      sequence: request.sequence, expectedRevision: request.expectedRevision, fencedAtRevision };
  }
  read(authority: AdmissionAuthority, range: StatsRange, now: number): UsageStatsReport {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (now < control.updatedAtMs) throw new StatsFault("clock_regressed");
    if (!this.hasCommittedSnapshot()) throw new StatsFault("not_started");
    let projectedBytes = 32_768; // Envelope/source headroom, charged before parsing projection text.
    const rows: UsageStatsRow[] = [], coverage = new Map<string, { latest: number | null; empty: boolean }>(), owned = new Set<string>();
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_days WHERE utc_day >= ? AND utc_day < ? ORDER BY utc_day, client LIMIT 23425", range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
      if (owned.size >= 64 * 366) throw new StatsFault("limit");
      requireStats(statsInteger(raw.byte_count, 1, 4 * 1024 * 1024));
      projectedBytes += raw.byte_count;
      if (projectedBytes > STATS_HTTP_RESPONSE_BYTES) throw new StatsFault("limit");
      const day = this.#day(raw, control); owned.add(`${day.client}:${day.utcDay}`);
      rows.push(...day.report.rows);
      if (rows.length > STATS_HTTP_RESPONSE_ROWS) throw new StatsFault("limit");
      const previous = coverage.get(day.client), latest = day.report.sources[0].latestAtMs;
      coverage.set(day.client, { latest: latest === null ? previous?.latest ?? null : Math.max(latest, previous?.latest ?? 0), empty: (previous?.empty ?? true) && day.report.rows.length === 0 });
    }
    const legacy = new Map<string, UsageStatsRow>();
    for (const { head, usage, client } of this.#legacy(authority, range).heads) {
      if (owned.has(`${client}:${head.day}`)) continue;
      const key = `${client}:${head.day}`, previous = legacy.get(key);
      const token = usage.tokens;
      const added = { input: token.inputUncached, cacheRead: token.cacheRead, cacheWrite: token.cacheWrite5m + token.cacheWrite1h,
        output: token.output - token.reasoningOutput, reasoning: token.reasoningOutput };
      const tokens = { input: "0", cacheRead: "0", cacheWrite: "0", output: "0", reasoning: "0" };
      for (const bucket of Object.keys(tokens) as (keyof typeof tokens)[]) tokens[bucket] = (BigInt(previous?.tokens[bucket] ?? "0") + added[bucket]).toString();
      if (!previous && rows.length + legacy.size >= STATS_HTTP_RESPONSE_ROWS) throw new StatsFault("limit");
      const cell: UsageStatsRow = { utcDay: head.day!, client, provider: null, model: null, tokens, records: (previous?.records ?? 0) + 1,
        reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
        durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" };
      projectedBytes += JSON.stringify(cell).length - (previous ? JSON.stringify(previous).length : 0);
      if (projectedBytes > STATS_HTTP_RESPONSE_BYTES) throw new StatsFault("limit");
      legacy.set(key, cell);
      const latest = head.day! * 86_400_000 + usage.offsetMs, prior = coverage.get(client);
      coverage.set(client, { latest: Math.max(latest, prior?.latest ?? 0), empty: false });
    }
    rows.push(...legacy.values());
    // Match the contract's byte ordering; locale collation is not canonical.
    rows.sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : statsRowKey(a) === statsRowKey(b) ? 0 : 1);
    const sources: SourceCoverage[] = [...coverage].sort(([a], [b]) => a < b ? -1 : 1).map(([client, info]) => {
      const selected = rows.filter(row => row.client === client), bases = new Set(selected.map(row => row.tokenBasis));
      return { client, status: selected.length ? "observed" : "empty", records: selected.reduce((sum, row) => sum + row.records, 0), warnings: 0,
        tokenBasis: bases.size > 1 ? "mixed" : [...bases][0] ?? "unavailable", latestAtMs: info.latest };
    });
    const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
      firstUtcDay: range.firstUtcDay, dayCount: range.dayCount, generatedAtMs: now,
      revision: control.revision, updatedAtMs: control.updatedAtMs, sources, rows });
    if (!report) throw new StatsFault("limit");
    return report;
  }
  leaderboard(authority: AdmissionAuthority, range: StatsRange, now: number): { observedTokens: string; usageRecords: number } {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (now < control.updatedAtMs) throw new StatsFault("clock_regressed");
    if (!this.hasCommittedSnapshot()) throw new StatsFault("not_started");
    let tokens = 0n, records = 0, rowCount = 0, bytes = 0;
    const owned = new Set<string>();
    const add = (amount: bigint, count: number) => {
      tokens += amount; records += count;
      if (records > LEADERBOARD_MAX_RECORDS || tokens.toString().length > 30) throw new StatsFault("limit");
    };
    // Public arithmetic does not materialize the private response. A dense
    // publisher remains rankable even when its requested browser range needs
    // to be shortened. Each daily projection is independently bounded.
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_days WHERE utc_day >= ? AND utc_day < ? ORDER BY utc_day, client LIMIT 23425", range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
      if (owned.size >= 64 * 366) throw new StatsFault("limit");
      const day = this.#day(raw, control); owned.add(`${day.client}:${day.utcDay}`);
      rowCount += day.report.rows.length; bytes += day.text.length;
      if (rowCount > MAX_STATS_STORED_ROWS || bytes > MAX_STATS_STORED_BYTES) throw new StatsFault("limit");
      for (const row of day.report.rows) if (row.tokenBasis === "reported") add(statsTokenTotal(row.tokens), row.records);
    }
    for (const { head, usage, client } of this.#legacy(authority, range).heads) {
      if (owned.has(`${client}:${head.day}`)) continue;
      const token = usage.tokens;
      add(token.inputUncached + token.cacheRead + token.cacheWrite5m + token.cacheWrite1h + token.output, 1);
    }
    return { observedTokens: tokens.toString(), usageRecords: records };
  }
  /** Full audit: the stored-day scan, which begins with the control checks. */
  audit(authority: AdmissionAuthority | null): void {
    this.auditHistory(authority);
  }

  /** Constant-cost half of the audit. Writers, devices and the pending intent
   * are each capped well under a page; the stored-day table is not, so it is
   * left to `auditHistory`. Returns the writer clients it already read so the
   * history scan does not repeat the query. */
  auditControl(authority: AdmissionAuthority | null): { control: Control; clients: Set<SqlStorageValue> } {
    const control = this.control();
    const writers = this.sql.exec("SELECT * FROM usage_stats_writers LIMIT 65").toArray();
    requireStats(writers.length <= 64);
    for (const writer of writers) requireStats(isStatsClient(writer.client) && authority?.devices.some(device => device.deviceId === writer.device_id));
    requireStats(control.revision !== 0 || writers.length === 0);
    const devices = this.sql.exec("SELECT device_id FROM usage_stats_devices LIMIT 129").toArray();
    requireStats(devices.length <= 128);
    for (const device of devices) { requireStats(typeof device.device_id === "string" && authority?.devices.some(item => item.deviceId === device.device_id)); this.progress(device.device_id); }
    const pending = this.pending();
    if (pending) requireStats(authority?.devices.some(device => device.deviceId === pending.deviceId) && pending.expectedRevision === control.revision && pending.sequence === this.progress(pending.deviceId).sequence + 1);
    return { control, clients: new Set(writers.map(writer => writer.client)) };
  }

  /** Linear in retained days, and each stored projection is parsed to confirm
   * it still matches its recorded metadata. The owner runs it once per object
   * lifetime before the first mutation, never to serve a read. */
  auditHistory(authority: AdmissionAuthority | null): void {
    const { control, clients } = this.auditControl(authority);
    let days = 0, rows = 0, bytes = 0;
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_days LIMIT 65537")) {
      requireStats(++days <= MAX_STATS_STORED_DAYS && authority);
      const day = this.#day(raw, control); rows += day.report.rows.length; bytes += new TextEncoder().encode(day.text).length;
      requireStats(rows <= MAX_STATS_STORED_ROWS && bytes <= MAX_STATS_STORED_BYTES && clients.has(day.client));
    }
    requireStats(control.revision !== 0 || days === 0);
  }
}
