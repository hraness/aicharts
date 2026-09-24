import { LEADERBOARD_MAX_RECORDS } from "../../../lib/usage/leaderboard-contract";
import { createHash } from "node:crypto";
import { admissionHex } from "../../../lib/usage/admission";
import { parseUsageStatsReport, statsDecimal, statsRowKey, statsTokenTotal, STATS_MAX_DAY, STATS_MAX_RECORDS, STATS_TOKEN_KEYS, type SourceCoverage, type StatsTokens, type UsageStatsReport, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { isStatsClient, isStatsModel, isStatsProvider } from "../../../lib/usage/stats-registry";
import { STATS_HTTP_RESPONSE_BYTES, STATS_HTTP_RESPONSE_ROWS, parseStatsReceipt, statsHex, statsInteger, type StatsError, type StatsRange, type StatsReceipt, type StatsStatus, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import type { StatsAbandonRequest, StatsAbandonment } from "../../../lib/usage/stats-http-contract";
import { STATS_TOTALS_MAX_CLIENTS, STATS_TOTALS_MAX_DEVICES, statsAddTokens, statsEmptyCell, statsZeroTokens, type StatsTotals, type StatsTotalsBasis, type StatsTotalsCell, type StatsTotalsClient, type StatsTotalsDevice } from "../../../lib/usage/stats-totals-contract";
import { decodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1, MAX_ADMISSION_HEADS } from "./admission-policy";
import { AdmissionState, legacyClient, legacyTokens, type AdmissionAuthority } from "./admission-state";

export const MAX_STATS_STORED_DAYS = 65_536;
export const MAX_STATS_STORED_ROWS = 262_144;
export const MAX_STATS_STORED_BYTES = 128 * 1024 * 1024;
export const MAX_STATS_IMMUTABLE_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_STATS_REVISIONS = 1_000_000;
export const MAX_STATS_DAY_SOURCES = 65_536;
export const MAX_STATS_RETIRED = 65_536;
export const LEGACY_STATS_WRITERS_SQL = `CREATE TABLE usage_stats_writers (client TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL CHECK (length(device_id) = 64)) WITHOUT ROWID`;
/** The pre-partition (client, day) ownership shape. Retained verbatim so an
 * existing store can be recognised and rebuilt by `migratePartition`; every
 * retained day keeps the device recorded as its source. */
export const RETIRED_STATS_SCHEMA = Object.freeze({
  usage_stats_writers: `CREATE TABLE usage_stats_writers (client TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL CHECK (length(device_id) = 64), ownership_revision INTEGER NOT NULL CHECK (ownership_revision BETWEEN 0 AND 1000000)) WITHOUT ROWID`,
  usage_stats_day_sources: `CREATE TABLE usage_stats_day_sources (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), device_id TEXT NOT NULL CHECK (length(device_id) = 64), ownership_revision INTEGER NOT NULL CHECK (ownership_revision BETWEEN 0 AND 1000000), PRIMARY KEY (client, utc_day)) WITHOUT ROWID`,
  usage_stats_pending: `CREATE TABLE usage_stats_pending (id INTEGER PRIMARY KEY CHECK (id = 1), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), device_id TEXT NOT NULL CHECK (length(device_id) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), expected_revision INTEGER NOT NULL CHECK (expected_revision BETWEEN 0 AND 999999), receipt TEXT CHECK (receipt IS NULL OR length(receipt) <= 1024))`,
  usage_stats_days: `CREATE TABLE usage_stats_days (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64), row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 8192), byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 4194304), projection TEXT NOT NULL CHECK (length(projection) <= 4194304), PRIMARY KEY (client, utc_day)) WITHOUT ROWID`,
  usage_stats_day_meta: `CREATE TABLE usage_stats_day_meta (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 8192), latest_at_ms INTEGER CHECK (latest_at_ms IS NULL OR latest_at_ms BETWEEN 0 AND 8640000000000000), rows_hash TEXT NOT NULL CHECK (length(rows_hash) = 64), PRIMARY KEY (client, utc_day)) WITHOUT ROWID`,
  usage_stats_day_rows: `CREATE TABLE usage_stats_day_rows (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 8191), provider TEXT, model TEXT, input_tokens TEXT NOT NULL, cache_read_tokens TEXT NOT NULL, cache_write_tokens TEXT NOT NULL, output_tokens TEXT NOT NULL, reasoning_tokens TEXT NOT NULL, records INTEGER NOT NULL CHECK (records BETWEEN 1 AND 10000000), reported_cost_microusd TEXT, reported_cost_records INTEGER NOT NULL CHECK (reported_cost_records BETWEEN 0 AND 10000000), estimated_cost_microusd TEXT, estimated_cost_records INTEGER NOT NULL CHECK (estimated_cost_records BETWEEN 0 AND 10000000), duration_ms TEXT, timed_records INTEGER NOT NULL CHECK (timed_records BETWEEN 0 AND 10000000), timed_tokens TEXT NOT NULL, token_basis TEXT NOT NULL CHECK (token_basis IN ('reported', 'estimated', 'unavailable')), breakdown_coverage TEXT NOT NULL CHECK (breakdown_coverage IN ('partial', 'complete')), PRIMARY KEY (client, utc_day, ordinal)) WITHOUT ROWID`,
});
/** Device-partitioned snapshot storage. A device owns its own (client, day)
 * cells; devices never contend for a client and never replace each other's
 * days. Reads sum the devices and add retained v1 heads only for
 * device/client/days the same device has not covered with a snapshot. */
export const STATS_SCHEMA = Object.freeze({
  usage_stats_control: `CREATE TABLE usage_stats_control (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 1000000), updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN 0 AND 8640000000000000), quarantined INTEGER NOT NULL CHECK (quarantined IN (0, 1)), immutable_bytes INTEGER NOT NULL CHECK (immutable_bytes BETWEEN 0 AND 8589934592))`,
  usage_stats_devices: `CREATE TABLE usage_stats_devices (device_id TEXT PRIMARY KEY NOT NULL CHECK (length(device_id) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), receipt TEXT NOT NULL CHECK (length(receipt) <= 1024)) WITHOUT ROWID`,
  usage_stats_pending: `CREATE TABLE usage_stats_pending (device_id TEXT PRIMARY KEY NOT NULL CHECK (length(device_id) = 64), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), expected_revision INTEGER NOT NULL CHECK (expected_revision BETWEEN 0 AND 999999), receipt TEXT CHECK (receipt IS NULL OR length(receipt) <= 1024)) WITHOUT ROWID`,
  usage_stats_days: `CREATE TABLE usage_stats_days (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), device_id TEXT NOT NULL CHECK (length(device_id) = 64), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64), row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 8192), byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 4194304), projection TEXT NOT NULL CHECK (length(projection) <= 4194304), PRIMARY KEY (client, utc_day, device_id)) WITHOUT ROWID`,
  usage_stats_day_meta: `CREATE TABLE usage_stats_day_meta (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), device_id TEXT NOT NULL CHECK (length(device_id) = 64), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 8192), latest_at_ms INTEGER CHECK (latest_at_ms IS NULL OR latest_at_ms BETWEEN 0 AND 8640000000000000), rows_hash TEXT NOT NULL CHECK (length(rows_hash) = 64), PRIMARY KEY (client, utc_day, device_id)) WITHOUT ROWID`,
  usage_stats_day_rows: `CREATE TABLE usage_stats_day_rows (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), device_id TEXT NOT NULL CHECK (length(device_id) = 64), ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 8191), provider TEXT, model TEXT, input_tokens TEXT NOT NULL, cache_read_tokens TEXT NOT NULL, cache_write_tokens TEXT NOT NULL, output_tokens TEXT NOT NULL, reasoning_tokens TEXT NOT NULL, records INTEGER NOT NULL CHECK (records BETWEEN 1 AND 10000000), reported_cost_microusd TEXT, reported_cost_records INTEGER NOT NULL CHECK (reported_cost_records BETWEEN 0 AND 10000000), estimated_cost_microusd TEXT, estimated_cost_records INTEGER NOT NULL CHECK (estimated_cost_records BETWEEN 0 AND 10000000), duration_ms TEXT, timed_records INTEGER NOT NULL CHECK (timed_records BETWEEN 0 AND 10000000), timed_tokens TEXT NOT NULL, token_basis TEXT NOT NULL CHECK (token_basis IN ('reported', 'estimated', 'unavailable')), breakdown_coverage TEXT NOT NULL CHECK (breakdown_coverage IN ('partial', 'complete')), PRIMARY KEY (client, utc_day, device_id, ordinal)) WITHOUT ROWID`,
  usage_stats_retired: `CREATE TABLE usage_stats_retired (device_id TEXT NOT NULL CHECK (length(device_id) = 64), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), retired_at_revision INTEGER NOT NULL CHECK (retired_at_revision BETWEEN 0 AND 1000000), PRIMARY KEY (device_id, body_hash)) WITHOUT ROWID`,
  usage_stats_day_totals: `CREATE TABLE usage_stats_day_totals (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), device_id TEXT NOT NULL CHECK (length(device_id) = 64), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), records INTEGER NOT NULL CHECK (records BETWEEN 0 AND 10000000), input_tokens TEXT NOT NULL, cache_read_tokens TEXT NOT NULL, cache_write_tokens TEXT NOT NULL, output_tokens TEXT NOT NULL, reasoning_tokens TEXT NOT NULL, PRIMARY KEY (client, utc_day, device_id)) WITHOUT ROWID`,
});
export class StatsFault extends Error { constructor(readonly code: StatsError = "storage_invalid") { super(code); } }
function requireStats(value: unknown): asserts value { if (!value) throw new StatsFault(); }
export const statsHash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const statsUploadText = (request: StatsUpload): string => JSON.stringify(request);
export const ZERO_HEAD_DIGEST = "0".repeat(64);
type Control = { revision: number; updatedAtMs: number; quarantined: boolean; immutableBytes: number };
export type StatsPending = { bodyHash: string; deviceId: string; sequence: number; expectedRevision: number; receipt: StatsReceipt | null };
type StoredDay = { client: string; utcDay: number; deviceId: string; revision: number; bodyHash: string; text: string; report: UsageStatsReport };
type DayKey = { client: string; utcDay: number; deviceId: string };
const dayKey = (client: string, utcDay: number, deviceId: string) => `${client}\0${utcDay}\0${deviceId}`;
const bigger = (left: string, right: string) => BigInt(left) >= BigInt(right) ? left : right;
const biggerNullable = (left: string | null, right: string | null) => left === null ? right : right === null ? left : bigger(left, right);
const addNullable = (left: string | null, right: string | null) => left === null ? right : right === null ? left : (BigInt(left) + BigInt(right)).toString();

/** Per-row upper envelope: a later observation of the same aggregate cell
 * may only raise numeric fields. File rotation and parser drift can shrink a
 * fresh local scan; the retained history is the maximum ever observed. */
export function envelopeRow(old: UsageStatsRow, next: UsageStatsRow): UsageStatsRow {
  const tokens = Object.freeze(Object.fromEntries(STATS_TOKEN_KEYS.map(key => [key, bigger(old.tokens[key], next.tokens[key])])) as Record<keyof StatsTokens, string>);
  const records = Math.max(old.records, next.records);
  const reportedCostRecords = Math.max(old.reportedCostRecords, next.reportedCostRecords);
  const estimatedCostRecords = Math.max(old.estimatedCostRecords, next.estimatedCostRecords);
  const timedRecords = Math.max(old.timedRecords, next.timedRecords);
  const merged = {
    ...next, tokens, records: Math.max(records, reportedCostRecords + estimatedCostRecords, timedRecords),
    reportedCostRecords, estimatedCostRecords, timedRecords,
    reportedCostMicrousd: biggerNullable(old.reportedCostMicrousd, next.reportedCostMicrousd),
    estimatedCostMicrousd: biggerNullable(old.estimatedCostMicrousd, next.estimatedCostMicrousd),
    durationMs: biggerNullable(old.durationMs, next.durationMs),
    timedTokens: bigger(old.timedTokens, next.timedTokens),
    breakdownCoverage: old.breakdownCoverage === "complete" || next.breakdownCoverage === "complete" ? "complete" as const : "partial" as const,
  };
  if (merged.tokenBasis === "unavailable" && statsTokenTotal(merged.tokens) !== 0n) return next;
  if (BigInt(merged.timedTokens) > statsTokenTotal(merged.tokens)) merged.timedTokens = statsTokenTotal(merged.tokens).toString();
  return Object.freeze(merged);
}
/** Sum of two devices' cells for the same row key; costs and durations add. */
export function sumRow(left: UsageStatsRow, right: UsageStatsRow): UsageStatsRow {
  return Object.freeze({
    ...left, tokens: statsAddTokens(left.tokens, right.tokens), records: left.records + right.records,
    reportedCostMicrousd: addNullable(left.reportedCostMicrousd, right.reportedCostMicrousd), reportedCostRecords: left.reportedCostRecords + right.reportedCostRecords,
    estimatedCostMicrousd: addNullable(left.estimatedCostMicrousd, right.estimatedCostMicrousd), estimatedCostRecords: left.estimatedCostRecords + right.estimatedCostRecords,
    durationMs: addNullable(left.durationMs, right.durationMs), timedRecords: left.timedRecords + right.timedRecords,
    timedTokens: (BigInt(left.timedTokens) + BigInt(right.timedTokens)).toString(),
    breakdownCoverage: left.breakdownCoverage === "complete" && right.breakdownCoverage === "complete" ? "complete" : "partial",
  });
}
function rowsTotals(rows: readonly UsageStatsRow[]): { records: number; tokens: StatsTokens } {
  let records = 0, tokens = statsZeroTokens();
  for (const row of rows) { records += row.records; tokens = statsAddTokens(tokens, row.tokens); }
  return { records, tokens };
}
class CellBuilder {
  records = 0; days = new Set<number>(); tokens = statsZeroTokens(); bases = new Set<StatsTotalsBasis>();
  add(day: number, records: number, tokens: StatsTokens, basis: StatsTotalsBasis): void {
    this.records += records; this.days.add(day); this.tokens = statsAddTokens(this.tokens, tokens); this.bases.add(basis);
  }
  cell(): StatsTotalsCell {
    if (this.days.size === 0) return statsEmptyCell();
    const ordered = [...this.days].sort((a, b) => a - b);
    return Object.freeze({ records: this.records, days: ordered.length, firstUtcDay: ordered[0], lastUtcDay: ordered[ordered.length - 1], tokens: this.tokens });
  }
  basis(): StatsTotalsBasis { return this.bases.size > 1 ? "mixed" : this.bases.has("legacy") ? "legacy" : "snapshots"; }
}

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
   * uncommitted intent cannot hold that device's later work hostage. R2
   * objects remain immutable evidence; only the uncommitted pointer is gone. */
  revokeDevice(deviceId: string): void {
    this.sql.exec("DELETE FROM usage_stats_pending WHERE device_id = ?", deviceId);
  }
  /** One-time rebuild from (client, day) ownership to (client, day, device)
   * partitions. Every retained day keeps the device recorded as its source;
   * the retired writer table is dropped, and per-day totals are derived from
   * the retained projections. Idempotent; runs inside the fenced owner's
   * schema transaction before the exact-manifest check. */
  migratePartition(): void {
    const definitions = new Map(this.sql.exec("SELECT name, sql FROM sqlite_schema WHERE name GLOB 'usage_stats_*' LIMIT 16").toArray().map(row => [String(row.name), row.sql]));
    if (!definitions.has("usage_stats_control")) return;
    if (definitions.get("usage_stats_days") === STATS_SCHEMA.usage_stats_days) {
      requireStats(!definitions.has("usage_stats_writers") && !definitions.has("usage_stats_day_sources")
        && definitions.get("usage_stats_day_totals") === STATS_SCHEMA.usage_stats_day_totals
        && definitions.get("usage_stats_retired") === STATS_SCHEMA.usage_stats_retired
        && definitions.get("usage_stats_pending") === STATS_SCHEMA.usage_stats_pending);
      return;
    }
    requireStats(definitions.get("usage_stats_days") === RETIRED_STATS_SCHEMA.usage_stats_days
      && definitions.get("usage_stats_pending") === RETIRED_STATS_SCHEMA.usage_stats_pending
      && (!definitions.has("usage_stats_day_meta") || definitions.get("usage_stats_day_meta") === RETIRED_STATS_SCHEMA.usage_stats_day_meta)
      && (!definitions.has("usage_stats_day_rows") || definitions.get("usage_stats_day_rows") === RETIRED_STATS_SCHEMA.usage_stats_day_rows));
    // Source attribution: the per-day source table when present, otherwise the
    // legacy single-writer table. A retained day without any recorded source
    // cannot be attributed and refuses the migration rather than guessing.
    const sources = new Map<string, string>();
    if (definitions.get("usage_stats_day_sources") === RETIRED_STATS_SCHEMA.usage_stats_day_sources) {
      for (const row of this.sql.exec("SELECT client, utc_day, device_id FROM usage_stats_day_sources LIMIT 65537")) {
        requireStats(isStatsClient(row.client) && statsInteger(row.utc_day, 0, STATS_MAX_DAY) && statsHex(row.device_id) && sources.size < MAX_STATS_DAY_SOURCES);
        sources.set(`${row.client}\0${row.utc_day}`, row.device_id);
      }
    } else {
      requireStats(!definitions.has("usage_stats_day_sources"));
      const writers = definitions.get("usage_stats_writers");
      requireStats(writers === RETIRED_STATS_SCHEMA.usage_stats_writers || writers === LEGACY_STATS_WRITERS_SQL);
      const owners = new Map<string, string>();
      for (const row of this.sql.exec("SELECT client, device_id FROM usage_stats_writers LIMIT 65")) {
        requireStats(isStatsClient(row.client) && statsHex(row.device_id)); owners.set(row.client, row.device_id);
      }
      for (const row of this.sql.exec("SELECT client, utc_day FROM usage_stats_days LIMIT 65537")) {
        const owner = owners.get(String(row.client));
        requireStats(owner !== undefined && statsInteger(row.utc_day, 0, STATS_MAX_DAY) && sources.size < MAX_STATS_DAY_SOURCES);
        sources.set(`${row.client}\0${row.utc_day}`, owner);
      }
    }
    const days = this.sql.exec("SELECT * FROM usage_stats_days LIMIT 65537").toArray();
    requireStats(days.length <= MAX_STATS_STORED_DAYS);
    for (const day of days) requireStats(sources.has(`${day.client}\0${day.utc_day}`));
    const pending = this.sql.exec("SELECT * FROM usage_stats_pending LIMIT 2").toArray();
    requireStats(pending.length <= 1);
    for (const name of ["usage_stats_day_rows", "usage_stats_day_meta", "usage_stats_days", "usage_stats_pending", "usage_stats_day_sources", "usage_stats_writers"])
      if (definitions.has(name)) this.sql.exec(`DROP TABLE ${name}`);
    for (const name of ["usage_stats_pending", "usage_stats_days", "usage_stats_day_meta", "usage_stats_day_rows", "usage_stats_retired", "usage_stats_day_totals"] as const)
      this.sql.exec(STATS_SCHEMA[name]);
    for (const row of pending) this.sql.exec("INSERT INTO usage_stats_pending (device_id, body_hash, sequence, expected_revision, receipt) VALUES (?, ?, ?, ?, ?)",
      row.device_id, row.body_hash, row.sequence, row.expected_revision, row.receipt);
    const control = this.control();
    for (const raw of days) {
      const deviceId = sources.get(`${raw.client}\0${raw.utc_day}`)!;
      this.sql.exec("INSERT INTO usage_stats_days (client, utc_day, device_id, revision, body_hash, projection_hash, row_count, byte_count, projection) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        raw.client, raw.utc_day, deviceId, raw.revision, raw.body_hash, raw.projection_hash, raw.row_count, raw.byte_count, raw.projection);
      const day = this.#day({ ...raw, device_id: deviceId }, control);
      this.#explodeDay(day.client, day.utcDay, day.deviceId, day.revision, day.report);
    }
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
  #pendingRow(row: Record<string, SqlStorageValue>): StatsPending {
    const receipt = row.receipt === null ? null : typeof row.receipt === "string" ? parseStatsReceipt(JSON.parse(row.receipt)) : null;
    requireStats(statsHex(row.body_hash) && statsHex(row.device_id) && statsInteger(row.sequence, 1)
      && statsInteger(row.expected_revision, 0, MAX_STATS_REVISIONS - 1) && (row.receipt === null || receipt)
      && (receipt === null || (receipt.bodyHash === row.body_hash && receipt.sequence === row.sequence && receipt.revision === row.expected_revision + 1)));
    return { bodyHash: row.body_hash, deviceId: row.device_id, sequence: row.sequence, expectedRevision: row.expected_revision, receipt };
  }
  /** One retained intent per device. Other devices' intents never block. */
  pending(deviceId: string): StatsPending | null {
    const rows = this.sql.exec("SELECT * FROM usage_stats_pending WHERE device_id = ? LIMIT 2", deviceId).toArray();
    requireStats(rows.length <= 1);
    return rows.length ? this.#pendingRow(rows[0]) : null;
  }
  pendings(): StatsPending[] {
    const rows = this.sql.exec("SELECT * FROM usage_stats_pending LIMIT 129").toArray();
    requireStats(rows.length <= 128);
    return rows.map(row => this.#pendingRow(row));
  }
  /** A newer snapshot from the same device retires its own earlier intent.
   * The retired intent's charge and any immutable object stay as evidence;
   * every delayed stage of it now finds no intent and refuses. */
  supersedePending(deviceId: string): void {
    const pending = this.pending(deviceId);
    if (pending === null) return;
    this.#retire(pending.deviceId, pending.bodyHash, pending.sequence);
    this.sql.exec("DELETE FROM usage_stats_pending WHERE device_id = ?", deviceId);
  }
  /** Terminal disposition of one flight's exact bytes: a later replay of the
   * same body from the same device refuses instead of reserving again. */
  #retire(deviceId: string, bodyHash: string, sequence: number): void {
    const count = this.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_retired").one().count;
    requireStats(statsInteger(count, 0, MAX_STATS_RETIRED));
    if (count >= MAX_STATS_RETIRED) throw new StatsFault("limit");
    this.sql.exec("INSERT INTO usage_stats_retired (device_id, body_hash, sequence, retired_at_revision) VALUES (?, ?, ?, ?) ON CONFLICT(device_id, body_hash) DO NOTHING",
      deviceId, bodyHash, sequence, this.control().revision);
  }
  retired(deviceId: string, bodyHash: string): boolean {
    const rows = this.sql.exec("SELECT sequence FROM usage_stats_retired WHERE device_id = ? AND body_hash = ? LIMIT 2", deviceId, bodyHash).toArray();
    requireStats(rows.length <= 1);
    return rows.length === 1;
  }
  #day(raw: Record<string, SqlStorageValue>, control = this.control()): StoredDay {
    requireStats(isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, 99_999_999) && statsHex(raw.device_id) && statsInteger(raw.revision, 1, control.revision)
      && statsHex(raw.body_hash) && statsHex(raw.projection_hash) && typeof raw.projection === "string"
      && new TextEncoder().encode(raw.projection).length === raw.byte_count && statsHash(raw.projection) === raw.projection_hash);
    const report = parseUsageStatsReport(JSON.parse(raw.projection));
    requireStats(report && report.sources.length === 1 && report.sources[0].client === raw.client && report.dayCount === 1
      && report.firstUtcDay === raw.utc_day && report.rows.length === raw.row_count && report.revision === raw.revision);
    return { client: raw.client, utcDay: raw.utc_day, deviceId: raw.device_id, revision: raw.revision, bodyHash: raw.body_hash, text: raw.projection, report };
  }
  /** Canonical digest input for one exploded row: the ordered field tuple. */
  #rowDigestInput(row: UsageStatsRow): string {
    return JSON.stringify([row.utcDay, row.client, row.provider, row.model, row.tokens.input, row.tokens.cacheRead, row.tokens.cacheWrite,
      row.tokens.output, row.tokens.reasoning, row.records, row.reportedCostMicrousd, row.reportedCostRecords, row.estimatedCostMicrousd,
      row.estimatedCostRecords, row.durationMs, row.timedRecords, row.timedTokens, row.tokenBasis, row.breakdownCoverage]);
  }
  #rowsDigest(latestAtMs: number | null, rows: readonly UsageStatsRow[]): string {
    const hash = createHash("sha256").update("aicharts:stats-v2:day-rows\0").update(`${latestAtMs ?? ""}\0`);
    for (const row of rows) hash.update(this.#rowDigestInput(row));
    return hash.digest("hex");
  }
  /** Structural validation for one exploded row. Value-level invariants are
   * additionally pinned by the day's rows_hash before the row may serve. */
  #storedRow(raw: Record<string, SqlStorageValue>): UsageStatsRow {
    const client = raw.client, utcDay = raw.utc_day, provider = raw.provider, model = raw.model, records = raw.records,
      reportedCostMicrousd = raw.reported_cost_microusd, reportedCostRecords = raw.reported_cost_records,
      estimatedCostMicrousd = raw.estimated_cost_microusd, estimatedCostRecords = raw.estimated_cost_records,
      durationMs = raw.duration_ms, timedRecords = raw.timed_records, timedTokens = raw.timed_tokens,
      tokenBasis = raw.token_basis, breakdownCoverage = raw.breakdown_coverage;
    const tokens = { input: raw.input_tokens, cacheRead: raw.cache_read_tokens, cacheWrite: raw.cache_write_tokens,
      output: raw.output_tokens, reasoning: raw.reasoning_tokens };
    requireStats(isStatsClient(client) && statsInteger(utcDay, 0, STATS_MAX_DAY) && statsInteger(raw.ordinal, 0, 8191)
      && (provider === null || isStatsProvider(provider)) && (model === null || isStatsModel(model))
      && statsDecimal(tokens.input) && statsDecimal(tokens.cacheRead) && statsDecimal(tokens.cacheWrite)
      && statsDecimal(tokens.output) && statsDecimal(tokens.reasoning) && statsDecimal(timedTokens)
      && statsInteger(records, 1, STATS_MAX_RECORDS) && statsInteger(reportedCostRecords, 0, records)
      && statsInteger(estimatedCostRecords, 0, records) && statsInteger(timedRecords, 0, records)
      && reportedCostRecords + estimatedCostRecords <= records
      && (reportedCostMicrousd === null || (statsDecimal(reportedCostMicrousd) && reportedCostRecords > 0))
      && (reportedCostMicrousd !== null || reportedCostRecords === 0)
      && (estimatedCostMicrousd === null || (statsDecimal(estimatedCostMicrousd) && estimatedCostRecords > 0))
      && (estimatedCostMicrousd !== null || estimatedCostRecords === 0)
      && (durationMs === null || (statsDecimal(durationMs) && timedRecords > 0))
      && (durationMs !== null || timedRecords === 0)
      && (tokenBasis === "reported" || tokenBasis === "estimated" || tokenBasis === "unavailable")
      && (breakdownCoverage === "partial" || breakdownCoverage === "complete"));
    const fixed = Object.freeze({ input: tokens.input, cacheRead: tokens.cacheRead, cacheWrite: tokens.cacheWrite,
      output: tokens.output, reasoning: tokens.reasoning });
    requireStats(!(tokenBasis === "unavailable" && (statsTokenTotal(fixed) !== 0n || timedTokens !== "0" || breakdownCoverage !== "partial"))
      && BigInt(timedTokens) <= statsTokenTotal(fixed) && !(timedRecords === 0 && timedTokens !== "0"));
    return Object.freeze({ utcDay, client, provider, model, tokens: fixed, records, reportedCostMicrousd, reportedCostRecords,
      estimatedCostMicrousd, estimatedCostRecords, durationMs, timedRecords, timedTokens, tokenBasis, breakdownCoverage });
  }
  /** Derived read model: explode a committed day's validated report into typed
   * rows plus one totals row. Written atomically with the projection it
   * summarizes; meta is last so a present-but-partial explosion can never
   * certify a pinned day. */
  #explodeDay(client: string, utcDay: number, deviceId: string, revision: number, report: UsageStatsReport): void {
    this.sql.exec("DELETE FROM usage_stats_day_rows WHERE client = ? AND utc_day = ? AND device_id = ?", client, utcDay, deviceId);
    let ordinal = 0;
    for (const row of report.rows) this.sql.exec("INSERT INTO usage_stats_day_rows (client, utc_day, device_id, ordinal, provider, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, reasoning_tokens, records, reported_cost_microusd, reported_cost_records, estimated_cost_microusd, estimated_cost_records, duration_ms, timed_records, timed_tokens, token_basis, breakdown_coverage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      client, utcDay, deviceId, ordinal++, row.provider, row.model, row.tokens.input, row.tokens.cacheRead, row.tokens.cacheWrite, row.tokens.output,
      row.tokens.reasoning, row.records, row.reportedCostMicrousd, row.reportedCostRecords, row.estimatedCostMicrousd, row.estimatedCostRecords,
      row.durationMs, row.timedRecords, row.timedTokens, row.tokenBasis, row.breakdownCoverage);
    const totals = rowsTotals(report.rows);
    this.sql.exec("INSERT INTO usage_stats_day_totals (client, utc_day, device_id, revision, records, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, reasoning_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client, utc_day, device_id) DO UPDATE SET revision = excluded.revision, records = excluded.records, input_tokens = excluded.input_tokens, cache_read_tokens = excluded.cache_read_tokens, cache_write_tokens = excluded.cache_write_tokens, output_tokens = excluded.output_tokens, reasoning_tokens = excluded.reasoning_tokens",
      client, utcDay, deviceId, revision, totals.records, totals.tokens.input, totals.tokens.cacheRead, totals.tokens.cacheWrite, totals.tokens.output, totals.tokens.reasoning);
    const latest = report.sources[0].latestAtMs;
    this.sql.exec("INSERT INTO usage_stats_day_meta (client, utc_day, device_id, revision, row_count, latest_at_ms, rows_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client, utc_day, device_id) DO UPDATE SET revision = excluded.revision, row_count = excluded.row_count, latest_at_ms = excluded.latest_at_ms, rows_hash = excluded.rows_hash",
      client, utcDay, deviceId, revision, report.rows.length, latest, this.#rowsDigest(latest, report.rows));
  }
  /** Exploded rows for a stored day, served only when the meta row pins the
   * day's current revision and the row scan reproduces its digest. Absent meta
   * means the derived model was never populated; every other inconsistency is
   * corruption, not a cache miss. */
  #storedDayRows(client: string, utcDay: number, deviceId: string, revision: number): { latestAtMs: number | null; rows: UsageStatsRow[] } | null {
    const meta = this.sql.exec("SELECT revision, row_count, latest_at_ms, rows_hash FROM usage_stats_day_meta WHERE client = ? AND utc_day = ? AND device_id = ? LIMIT 2", client, utcDay, deviceId).toArray();
    requireStats(meta.length <= 1);
    if (meta.length === 0) return null;
    const row = meta[0];
    requireStats(statsInteger(row.revision, 1, MAX_STATS_REVISIONS) && statsInteger(row.row_count, 0, 8192)
      && (row.latest_at_ms === null || statsInteger(row.latest_at_ms, 0, 8_640_000_000_000_000)) && statsHex(row.rows_hash));
    requireStats(row.revision === revision);
    const rows: UsageStatsRow[] = [], hash = createHash("sha256").update("aicharts:stats-v2:day-rows\0").update(`${row.latest_at_ms ?? ""}\0`);
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_day_rows WHERE client = ? AND utc_day = ? AND device_id = ? ORDER BY ordinal LIMIT 8193", client, utcDay, deviceId)) {
      const stored = this.#storedRow(raw);
      requireStats(stored.utcDay === utcDay && stored.client === client && rows.length < row.row_count);
      rows.push(stored); hash.update(this.#rowDigestInput(stored));
    }
    requireStats(rows.length === row.row_count && hash.digest("hex") === row.rows_hash);
    return { latestAtMs: row.latest_at_ms, rows };
  }
  /** Pure fallback when a derived read model has not been populated. Explicit
   * fenced maintenance owns backfill; an ordinary read never writes SQL. */
  #dayRows(raw: Record<string, SqlStorageValue>, control: Control): { latestAtMs: number | null; rows: readonly UsageStatsRow[] } {
    const day = this.#day(raw, control);
    return { latestAtMs: day.report.sources[0].latestAtMs, rows: day.report.rows };
  }
  #storedOrProjected(key: DayKey, revision: number, control: Control): { latestAtMs: number | null; rows: readonly UsageStatsRow[] } {
    const stored = this.#storedDayRows(key.client, key.utcDay, key.deviceId, revision);
    if (stored !== null) return stored;
    const full = this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? AND utc_day = ? AND device_id = ? LIMIT 2", key.client, key.utcDay, key.deviceId).toArray();
    requireStats(full.length === 1);
    return this.#dayRows(full[0], control);
  }
  /** Owner must hold the restore registration and a synchronous transaction. */
  backfillRows(authority: AdmissionAuthority | null): void {
    const { control } = this.auditControl(authority);
    let count = 0;
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_days LIMIT 65537")) {
      requireStats(++count <= MAX_STATS_STORED_DAYS && authority);
      const day = this.#day(raw, control);
      const totals = this.sql.exec("SELECT revision FROM usage_stats_day_totals WHERE client = ? AND utc_day = ? AND device_id = ? LIMIT 1", day.client, day.utcDay, day.deviceId).toArray();
      if (this.#storedDayRows(day.client, day.utcDay, day.deviceId, day.revision) === null || totals.length === 0 || totals[0].revision !== day.revision)
        this.#explodeDay(day.client, day.utcDay, day.deviceId, day.revision, day.report);
    }
  }
  #legacy(authority: AdmissionAuthority, range: StatsRange) {
    const admission = new AdmissionState(this.sql), control = admission.control(), sql = this.sql;
    function* heads() {
      let count = 0;
      for (const row of sql.exec(`SELECT occurrence_id, utc_day FROM usage_admission_heads WHERE utc_day >= ? AND utc_day < ? ORDER BY occurrence_id LIMIT ${MAX_ADMISSION_HEADS + 1}`, range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
        requireStats(row.occurrence_id instanceof ArrayBuffer && ++count <= MAX_ADMISSION_HEADS);
        const head = admission.head(new Uint8Array(row.occurrence_id), authority, control);
        requireStats(head && head.day !== null);
        const batch = decodeUsageBatch(head.operation.frame, ADMISSION_POLICY_V1);
        requireStats(batch.ok);
        yield { head, usage: batch.value.usage[0], client: legacyClient(batch.value.usage[0].provider), deviceId: admissionHex(head.operation.deviceId) };
      }
    }
    return { control, heads: heads() };
  }
  /** Constant-cost publication progress for one device. Retained v1 heads
   * never gate a snapshot: a device's own heads are shadowed by its snapshot
   * days at read time, and other devices' heads stay separate contributions. */
  status(deviceId: string): StatsStatus {
    const admission = new AdmissionState(this.sql).control();
    return { schemaVersion: 2, revision: this.control().revision, nextSequence: this.progress(deviceId).sequence + 1,
      writerDeviceId: null, v1Revision: admission.revision, headDigest: ZERO_HEAD_DIGEST, legacyRecords: 0, takeoverEligible: true };
  }
  #projections(request: StatsUpload, receipt: StatsReceipt): readonly { day: number; text: string; rows: number; report: UsageStatsReport }[] {
    const report = request.report, source = report.sources[0], deviceId = request.deviceId;
    return Array.from({ length: report.dayCount }, (_, index) => {
      const day = report.firstUtcDay + index;
      let rows = report.rows.filter(row => row.utcDay === day);
      if (request.mode === "preserve-history") {
        if (rows.length === 0) return null;
        const prior = this.sql.exec("SELECT revision FROM usage_stats_days WHERE client = ? AND utc_day = ? AND device_id = ? LIMIT 1", source.client, day, deviceId).toArray()[0];
        if (prior) {
          requireStats(statsInteger(prior.revision, 1, MAX_STATS_REVISIONS));
          const old = this.#storedOrProjected({ client: source.client, utcDay: day, deviceId }, prior.revision, this.control());
          // Never lower a retained cell: the stored day becomes the per-row
          // envelope of the old and new observations, and rows the fresh scan
          // no longer sees stay exactly as retained.
          const merged = new Map(old.rows.map(row => [statsRowKey(row), row] as const));
          for (const row of rows) { const key = statsRowKey(row), previous = merged.get(key); merged.set(key, previous ? envelopeRow(previous, row) : row); }
          rows = [...merged.values()].sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : 1);
        }
      }
      const records = rows.reduce((sum, row) => sum + row.records, 0), bases = new Set(rows.map(row => row.tokenBasis));
      const daily = parseUsageStatsReport({ ...report, firstUtcDay: day, dayCount: 1, revision: receipt.revision, updatedAtMs: receipt.committedAtMs,
        sources: [{ ...source, status: rows.length ? "observed" : "empty", records, tokenBasis: bases.size > 1 ? "mixed" : [...bases][0] ?? source.tokenBasis,
          latestAtMs: rows.length ? source.latestAtMs : null }], rows });
      requireStats(daily);
      return { day, text: JSON.stringify(daily), rows: rows.length, report: daily };
    }).filter((value): value is { day: number; text: string; rows: number; report: UsageStatsReport } => value !== null);
  }
  #capacity(request: StatsUpload, projections: readonly { day: number; text: string; rows: number }[]): void {
    const client = request.report.sources[0].client, deviceId = request.deviceId, first = request.report.firstUtcDay, last = first + request.report.dayCount;
    const [total] = this.sql.exec("SELECT COUNT(*) AS days, COALESCE(SUM(row_count), 0) AS rows, COALESCE(SUM(byte_count), 0) AS bytes FROM usage_stats_days").toArray();
    const selected = new Set(projections.map(value => value.day));
    const replaced = { days: 0, rows: 0, bytes: 0 };
    for (const row of this.sql.exec("SELECT utc_day, row_count, byte_count FROM usage_stats_days WHERE client = ? AND device_id = ? AND utc_day >= ? AND utc_day < ? LIMIT 367", client, deviceId, first, last)) {
      requireStats(statsInteger(row.utc_day) && statsInteger(row.row_count) && statsInteger(row.byte_count));
      if (selected.has(row.utc_day)) { replaced.days++; replaced.rows += row.row_count; replaced.bytes += row.byte_count; }
    }
    if (request.mode === "replace-snapshot") {
      const [all] = this.sql.exec("SELECT COUNT(*) AS days, COALESCE(SUM(row_count), 0) AS rows, COALESCE(SUM(byte_count), 0) AS bytes FROM usage_stats_days WHERE client = ? AND device_id = ?", client, deviceId).toArray();
      requireStats(statsInteger(all.days) && statsInteger(all.rows) && statsInteger(all.bytes));
      replaced.days = all.days; replaced.rows = all.rows; replaced.bytes = all.bytes;
    }
    for (const key of ["days", "rows", "bytes"] as const) requireStats(statsInteger(total[key]) && statsInteger(replaced[key]));
    const days = Number(total.days) - Number(replaced.days) + projections.length;
    const rows = Number(total.rows) - Number(replaced.rows) + projections.reduce((sum, value) => sum + value.rows, 0);
    const bytes = Number(total.bytes) - Number(replaced.bytes) + projections.reduce((sum, value) => sum + new TextEncoder().encode(value.text).length, 0);
    if (days > MAX_STATS_STORED_DAYS || rows > MAX_STATS_STORED_ROWS || bytes > MAX_STATS_STORED_BYTES) throw new StatsFault("limit");
  }
  /** Admission for one device's snapshot. The sequence is the device's own
   * order; the expected revision only has to be a revision this account has
   * actually reached, so two devices publishing at once never conflict. */
  check(request: StatsUpload): void {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (control.revision >= MAX_STATS_REVISIONS) throw new StatsFault("limit");
    const client = request.report.sources[0].client, deviceId = request.deviceId, progress = this.progress(deviceId);
    if (request.expectedRevision > control.revision || request.sequence !== progress.sequence + 1
      || this.retired(deviceId, statsHash(statsUploadText(request)))) throw new StatsFault("conflict");
    if (request.mode === "replace-snapshot") {
      const previous = this.sql.exec("SELECT d.utc_day, d.revision, m.revision AS pinned, m.latest_at_ms FROM usage_stats_days d LEFT JOIN usage_stats_day_meta m ON m.client = d.client AND m.utc_day = d.utc_day AND m.device_id = d.device_id WHERE d.client = ? AND d.device_id = ? ORDER BY d.utc_day DESC LIMIT 2", client, deviceId).toArray();
      requireStats(previous.length <= 1);
      if (previous.length) {
        const prior = previous[0];
        requireStats(statsInteger(prior.utc_day, 0, STATS_MAX_DAY) && statsInteger(prior.revision, 1, control.revision));
        let latest: number | null;
        if (prior.pinned === null) {
          const stored = this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? AND utc_day = ? AND device_id = ? LIMIT 2", client, prior.utc_day, deviceId).toArray();
          requireStats(stored.length === 1);
          latest = this.#day(stored[0], control).report.sources[0].latestAtMs;
        } else {
          requireStats(prior.pinned === prior.revision
            && (prior.latest_at_ms === null || statsInteger(prior.latest_at_ms, 0, 8_640_000_000_000_000)));
          latest = prior.latest_at_ms;
        }
        if ((request.report.sources[0].latestAtMs ?? 0) < (latest ?? 0)) throw new StatsFault("clock_regressed");
      }
    }
  }
  reserve(request: StatsUpload, now: number): void {
    this.check(request);
    requireStats(this.pending(request.deviceId) === null);
    const bodyHash = statsHash(statsUploadText(request));
    const receipt: StatsReceipt = { schemaVersion: 2, operationId: request.operationId, bodyHash, sequence: request.sequence, revision: request.expectedRevision + 1,
      committedAtMs: now, client: request.report.sources[0].client, firstUtcDay: request.report.firstUtcDay, dayCount: request.report.dayCount };
    this.#capacity(request, this.#projections(request, receipt));
    // Reserve before any immutable write. Uncertain/superseded objects retain
    // their charge permanently; replay of the same pending intent never enters
    // reserve again. Receipt headroom covers the complete bounded receipt body.
    const charge = new TextEncoder().encode(statsUploadText(request)).length + 1024;
    const retained = this.control().immutableBytes + charge;
    if (retained > MAX_STATS_IMMUTABLE_BYTES) throw new StatsFault("limit");
    this.sql.exec("UPDATE usage_stats_control SET immutable_bytes = ? WHERE id = 1", retained);
    this.sql.exec("INSERT INTO usage_stats_pending (device_id, body_hash, sequence, expected_revision, receipt) VALUES (?, ?, ?, ?, NULL)", request.deviceId, bodyHash, request.sequence, request.expectedRevision);
  }
  freeze(request: StatsUpload, now: number): StatsReceipt {
    this.check(request);
    const pending = this.pending(request.deviceId);
    requireStats(pending && pending.bodyHash === statsHash(statsUploadText(request)));
    if (pending.receipt) return pending.receipt;
    const receipt: StatsReceipt = { schemaVersion: 2, operationId: request.operationId, bodyHash: pending.bodyHash, sequence: request.sequence, revision: request.expectedRevision + 1,
      committedAtMs: now, client: request.report.sources[0].client, firstUtcDay: request.report.firstUtcDay, dayCount: request.report.dayCount };
    this.#capacity(request, this.#projections(request, receipt));
    this.sql.exec("UPDATE usage_stats_pending SET receipt = ? WHERE device_id = ?", JSON.stringify(receipt), request.deviceId);
    return receipt;
  }
  publish(request: StatsUpload): StatsReceipt {
    this.check(request);
    const pending = this.pending(request.deviceId);
    requireStats(pending?.receipt && pending.bodyHash === statsHash(statsUploadText(request)));
    const receipt = pending.receipt, projections = this.#projections(request, receipt), deviceId = request.deviceId;
    this.#capacity(request, projections);
    // Warp publishes a current billing-interval counter, not daily usage. Only
    // this device's derived projections are replaced; immutable snapshots and
    // receipts remain.
    if (request.mode === "replace-snapshot") {
      for (const table of ["usage_stats_days", "usage_stats_day_rows", "usage_stats_day_meta", "usage_stats_day_totals"])
        this.sql.exec(`DELETE FROM ${table} WHERE client = ? AND device_id = ?`, receipt.client, deviceId);
    }
    for (const day of projections) {
      this.sql.exec("INSERT INTO usage_stats_days (client, utc_day, device_id, revision, body_hash, projection_hash, row_count, byte_count, projection) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client, utc_day, device_id) DO UPDATE SET revision = excluded.revision, body_hash = excluded.body_hash, projection_hash = excluded.projection_hash, row_count = excluded.row_count, byte_count = excluded.byte_count, projection = excluded.projection",
        receipt.client, day.day, deviceId, receipt.revision, receipt.bodyHash, statsHash(day.text), day.rows, new TextEncoder().encode(day.text).length, day.text);
      this.#explodeDay(receipt.client, day.day, deviceId, receipt.revision, day.report);
    }
    this.sql.exec("INSERT INTO usage_stats_devices (device_id, sequence, receipt) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET sequence = excluded.sequence, receipt = excluded.receipt", deviceId, request.sequence, JSON.stringify(receipt));
    // The account revision always advances so every memoized read misses; the
    // receipt keeps the revision the device expected, which may be lower.
    const control = this.control();
    requireStats(control.revision < MAX_STATS_REVISIONS);
    this.sql.exec("UPDATE usage_stats_control SET revision = ?, updated_at_ms = ? WHERE id = 1", Math.max(control.revision + 1, receipt.revision), Math.max(receipt.committedAtMs, control.updatedAtMs));
    this.sql.exec("DELETE FROM usage_stats_pending WHERE device_id = ?", deviceId);
    return receipt;
  }
  /** Terminal disposition for one device's flight. It either returns the
   * receipt that flight already committed, or guarantees the flight can never
   * commit: its retained intent is removed and the account revision is fenced
   * strictly past the revision the flight expected. */
  abandon(request: StatsAbandonRequest, now: number): StatsAbandonment {
    const control = this.control(), progress = this.progress(request.deviceId);
    if (now < control.updatedAtMs) throw new StatsFault("clock_regressed");
    if (progress.receipt?.bodyHash === request.bodyHash && progress.receipt.operationId === request.operationId
      && progress.receipt.sequence === request.sequence && progress.receipt.revision === request.expectedRevision + 1) {
      return { schemaVersion: 2, outcome: "committed", receipt: progress.receipt };
    }
    const pending = this.pending(request.deviceId);
    if (pending && pending.bodyHash === request.bodyHash && pending.sequence === request.sequence && pending.expectedRevision === request.expectedRevision)
      this.sql.exec("DELETE FROM usage_stats_pending WHERE device_id = ?", request.deviceId);
    this.#retire(request.deviceId, request.bodyHash, request.sequence);
    let fencedAtRevision = control.revision;
    if (control.revision <= request.expectedRevision) {
      if (control.revision >= MAX_STATS_REVISIONS) throw new StatsFault("limit");
      // A maintenance revision permanently fences every delayed stage of this
      // exact predecessor. Only derived pending metadata is removed; any R2
      // object and its reserved byte charge are retained as recovery evidence.
      fencedAtRevision = request.expectedRevision + 1;
      this.sql.exec("UPDATE usage_stats_control SET revision = ?, updated_at_ms = ? WHERE id = 1", fencedAtRevision, now);
    }
    return { schemaVersion: 2, outcome: "abandoned", operationId: request.operationId, bodyHash: request.bodyHash,
      sequence: request.sequence, expectedRevision: request.expectedRevision, fencedAtRevision };
  }
  /** Every committed (client, day, device) in range, plus retained v1 heads
   * whose device has no snapshot for that client/day. Devices are summed per
   * row key; the report never carries a device dimension. */
  read(authority: AdmissionAuthority, range: StatsRange, now: number, memo?: Map<string, UsageStatsReport>): UsageStatsReport {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (now < control.updatedAtMs) throw new StatsFault("clock_regressed");
    if (!this.hasCommittedSnapshot()) throw new StatsFault("not_started");
    // A completed read is a pure function of its range plus the stats and
    // admission revisions; every guard above still runs before a hit serves.
    const memoKey = memo === undefined ? undefined
      : `${range.firstUtcDay}:${range.dayCount}:${control.revision}:${new AdmissionState(this.sql).control().revision}`;
    const hit = memo === undefined || memoKey === undefined ? undefined : memo.get(memoKey);
    if (hit !== undefined) return hit;
    let projectedBytes = 32_768; // Envelope/source headroom, charged before row content.
    const merged = new Map<string, UsageStatsRow>(), coverage = new Map<string, { latest: number | null; empty: boolean }>(), owned = new Set<string>();
    const admit = (row: UsageStatsRow) => {
      const key = statsRowKey(row), previous = merged.get(key), next = previous ? sumRow(previous, row) : row;
      projectedBytes += JSON.stringify(next).length - (previous ? JSON.stringify(previous).length : 0);
      merged.set(key, next);
      if (projectedBytes > STATS_HTTP_RESPONSE_BYTES || merged.size > STATS_HTTP_RESPONSE_ROWS) throw new StatsFault("limit");
    };
    for (const raw of this.sql.exec("SELECT client, utc_day, device_id, revision, row_count, byte_count FROM usage_stats_days WHERE utc_day >= ? AND utc_day < ? ORDER BY utc_day, client, device_id LIMIT 23425", range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
      if (owned.size >= 64 * 366) throw new StatsFault("limit");
      requireStats(isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, STATS_MAX_DAY) && statsHex(raw.device_id) && statsInteger(raw.revision, 1, control.revision)
        && statsInteger(raw.row_count, 0, 8192) && statsInteger(raw.byte_count, 1, 4 * 1024 * 1024));
      owned.add(dayKey(raw.client, raw.utc_day, raw.device_id));
      const day = this.#storedOrProjected({ client: raw.client, utcDay: raw.utc_day, deviceId: raw.device_id }, raw.revision, control);
      for (const row of day.rows) admit(row);
      const previous = coverage.get(raw.client);
      coverage.set(raw.client, { latest: day.latestAtMs === null ? previous?.latest ?? null : Math.max(day.latestAtMs, previous?.latest ?? 0), empty: (previous?.empty ?? true) && day.rows.length === 0 });
    }
    const legacy = new Map<string, UsageStatsRow>();
    for (const { head, usage, client, deviceId } of this.#legacy(authority, range).heads) {
      if (owned.has(dayKey(client, head.day!, deviceId))) continue; // This device's snapshot supersedes its own heads for the day.
      const key = `${client}:${head.day}`, previous = legacy.get(key), added = legacyTokens(usage);
      const tokens = Object.freeze(Object.fromEntries(STATS_TOKEN_KEYS.map(bucket => [bucket, (BigInt(previous?.tokens[bucket] ?? "0") + BigInt(added[bucket])).toString()])) as Record<keyof StatsTokens, string>);
      const cell: UsageStatsRow = { utcDay: head.day!, client, provider: null, model: null, tokens, records: (previous?.records ?? 0) + 1,
        reportedCostMicrousd: null, reportedCostRecords: 0, estimatedCostMicrousd: null, estimatedCostRecords: 0,
        durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" };
      legacy.set(key, cell);
      const latest = head.day! * 86_400_000 + usage.offsetMs, prior = coverage.get(client);
      coverage.set(client, { latest: Math.max(latest, prior?.latest ?? 0), empty: false });
    }
    for (const cell of legacy.values()) admit(cell);
    // Match the contract's byte ordering; locale collation is not canonical.
    const rows = [...merged.values()].sort((a, b) => statsRowKey(a) < statsRowKey(b) ? -1 : statsRowKey(a) === statsRowKey(b) ? 0 : 1);
    const sources: SourceCoverage[] = [...coverage].sort(([a], [b]) => a < b ? -1 : 1).map(([client, info]) => {
      const selected = rows.filter(row => row.client === client), bases = new Set(selected.map(row => row.tokenBasis));
      return { client, status: selected.length ? "observed" : "empty", records: selected.reduce((sum, row) => sum + row.records, 0), warnings: 0,
        tokenBasis: bases.size > 1 ? "mixed" : [...bases][0] ?? "unavailable", latestAtMs: info.latest };
    });
    const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
      firstUtcDay: range.firstUtcDay, dayCount: range.dayCount, generatedAtMs: now,
      revision: control.revision, updatedAtMs: control.updatedAtMs, sources, rows });
    if (!report) throw new StatsFault("limit");
    if (memo !== undefined && memoKey !== undefined) {
      if (memo.size >= 4) memo.delete(memo.keys().next().value!);
      memo.set(memoKey, report);
    }
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
    for (const raw of this.sql.exec("SELECT client, utc_day, device_id, revision, row_count, byte_count FROM usage_stats_days WHERE utc_day >= ? AND utc_day < ? ORDER BY utc_day, client, device_id LIMIT 23425", range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
      if (owned.size >= 64 * 366) throw new StatsFault("limit");
      requireStats(isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, STATS_MAX_DAY) && statsHex(raw.device_id) && statsInteger(raw.revision, 1, control.revision)
        && statsInteger(raw.row_count, 0, 8192) && statsInteger(raw.byte_count, 1, 4 * 1024 * 1024));
      owned.add(dayKey(raw.client, raw.utc_day, raw.device_id));
      const source = this.#storedOrProjected({ client: raw.client, utcDay: raw.utc_day, deviceId: raw.device_id }, raw.revision, control).rows;
      rowCount += source.length;
      for (const row of source) bytes += JSON.stringify(row).length;
      if (rowCount > MAX_STATS_STORED_ROWS || bytes > MAX_STATS_STORED_BYTES) throw new StatsFault("limit");
      for (const row of source) if (row.tokenBasis === "reported") add(statsTokenTotal(row.tokens), row.records);
    }
    for (const { head, usage, client, deviceId } of this.#legacy(authority, range).heads) {
      if (owned.has(dayKey(client, head.day!, deviceId))) continue;
      const token = usage.tokens;
      add(token.inputUncached + token.cacheRead + token.cacheWrite5m + token.cacheWrite1h + token.output, 1);
    }
    return { observedTokens: tokens.toString(), usageRecords: records };
  }
  /** Lifetime totals from the retained per-day totals rows: every device's
   * snapshot days plus the retained v1 day totals for device/client/days that
   * device never covered with a snapshot. Bounded by the stored-day cap; no
   * projection blob and no head is decoded. */
  totals(authority: AdmissionAuthority, now: number): StatsTotals {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (now < control.updatedAtMs) throw new StatsFault("clock_regressed");
    const admission = new AdmissionState(this.sql), legacyControl = admission.control(), cursor = admission.dayTotalsCursor();
    const total = new CellBuilder(), clients = new Map<string, CellBuilder>(), devices = new Map<string, { device: CellBuilder; clients: Map<string, CellBuilder> }>();
    const owned = new Set<string>();
    const contribute = (deviceId: string, client: string, day: number, records: number, tokens: StatsTokens, basis: StatsTotalsBasis) => {
      const device = devices.get(deviceId) ?? { device: new CellBuilder(), clients: new Map<string, CellBuilder>() };
      devices.set(deviceId, device);
      const perClient = device.clients.get(client) ?? new CellBuilder(); device.clients.set(client, perClient);
      const account = clients.get(client) ?? new CellBuilder(); clients.set(client, account);
      for (const builder of [total, account, device.device, perClient]) builder.add(day, records, tokens, basis);
      if (clients.size > STATS_TOTALS_MAX_CLIENTS || devices.size > STATS_TOTALS_MAX_DEVICES) throw new StatsFault("limit");
    };
    let count = 0;
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_day_totals ORDER BY client, utc_day, device_id LIMIT 65537")) {
      requireStats(++count <= MAX_STATS_STORED_DAYS && isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, STATS_MAX_DAY) && statsHex(raw.device_id)
        && statsInteger(raw.revision, 1, control.revision) && statsInteger(raw.records, 0, STATS_MAX_RECORDS)
        && statsDecimal(raw.input_tokens) && statsDecimal(raw.cache_read_tokens) && statsDecimal(raw.cache_write_tokens)
        && statsDecimal(raw.output_tokens) && statsDecimal(raw.reasoning_tokens));
      owned.add(dayKey(raw.client, raw.utc_day, raw.device_id));
      contribute(raw.device_id, raw.client, raw.utc_day, raw.records, Object.freeze({ input: raw.input_tokens, cacheRead: raw.cache_read_tokens,
        cacheWrite: raw.cache_write_tokens, output: raw.output_tokens, reasoning: raw.reasoning_tokens }), "snapshots");
    }
    for (const row of admission.legacyDayTotals()) {
      const client = legacyClient(row.provider);
      if (owned.has(dayKey(client, row.utcDay, row.deviceId))) continue;
      contribute(row.deviceId, client, row.utcDay, row.heads, row.tokens, "legacy");
    }
    const clientCells = (map: Map<string, CellBuilder>): StatsTotalsClient[] => [...map].sort(([a], [b]) => a < b ? -1 : 1)
      .map(([client, builder]) => Object.freeze({ client, basis: builder.basis(), ...builder.cell() }));
    const deviceCells: StatsTotalsDevice[] = authority.devices.map(device => {
      const entry = devices.get(device.deviceId);
      return Object.freeze({ deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, revokedAtMs: device.revokedAtMs,
        ...(entry?.device.cell() ?? statsEmptyCell()), clients: Object.freeze(entry ? clientCells(entry.clients) : []) });
    });
    for (const deviceId of devices.keys()) requireStats(authority.devices.some(device => device.deviceId === deviceId));
    return Object.freeze({ schemaVersion: 2, generatedAtMs: now, revision: control.revision, updatedAtMs: control.updatedAtMs,
      legacyRevision: legacyControl.revision, legacyVerifiedRevision: cursor.verifiedRevision, legacyComplete: cursor.verifiedRevision === legacyControl.revision,
      total: total.cell(), clients: Object.freeze(clientCells(clients)), devices: Object.freeze(deviceCells) });
  }
  /** Full audit: the stored-day scan, which begins with the control checks. */
  audit(authority: AdmissionAuthority | null): void {
    this.auditHistory(authority);
  }

  /** Constant-cost half of the audit. Devices and pending intents are each
   * capped well under a page; the stored-day table is not, so it is left to
   * `auditHistory`. */
  auditControl(authority: AdmissionAuthority | null): { control: Control } {
    const control = this.control();
    const devices = this.sql.exec("SELECT device_id FROM usage_stats_devices LIMIT 129").toArray();
    requireStats(devices.length <= 128);
    for (const device of devices) { requireStats(typeof device.device_id === "string" && authority?.devices.some(item => item.deviceId === device.device_id)); this.progress(device.device_id); }
    for (const pending of this.pendings()) requireStats(authority?.devices.some(device => device.deviceId === pending.deviceId)
      && pending.expectedRevision <= control.revision && pending.sequence === this.progress(pending.deviceId).sequence + 1);
    const retired = this.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_retired").one().count;
    requireStats(statsInteger(retired, 0, MAX_STATS_RETIRED));
    requireStats(control.revision !== 0 || devices.length === 0);
    return { control };
  }

  /** Linear in retained days, and each stored projection is parsed to confirm
   * it still matches its recorded metadata, that any populated derived model
   * reproduces the same rows exactly, and that its totals row agrees. The
   * owner runs it once per object lifetime before the first mutation, never to
   * serve a read. */
  auditHistory(authority: AdmissionAuthority | null): void {
    const { control } = this.auditControl(authority);
    let days = 0, rows = 0, bytes = 0;
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_days LIMIT 65537")) {
      requireStats(++days <= MAX_STATS_STORED_DAYS && authority);
      const day = this.#day(raw, control); rows += day.report.rows.length; bytes += new TextEncoder().encode(day.text).length;
      requireStats(rows <= MAX_STATS_STORED_ROWS && bytes <= MAX_STATS_STORED_BYTES && authority.devices.some(device => device.deviceId === day.deviceId));
      const stored = this.#storedDayRows(day.client, day.utcDay, day.deviceId, day.revision);
      if (stored !== null) requireStats(stored.latestAtMs === day.report.sources[0].latestAtMs
        && stored.rows.length === day.report.rows.length
        && stored.rows.every((row, index) => this.#rowDigestInput(row) === this.#rowDigestInput(day.report.rows[index])));
      const totals = this.sql.exec("SELECT * FROM usage_stats_day_totals WHERE client = ? AND utc_day = ? AND device_id = ? LIMIT 2", day.client, day.utcDay, day.deviceId).toArray();
      requireStats(totals.length <= 1);
      if (totals.length === 1) {
        const expected = rowsTotals(day.report.rows), row = totals[0];
        requireStats(row.revision === day.revision && row.records === expected.records && row.input_tokens === expected.tokens.input
          && row.cache_read_tokens === expected.tokens.cacheRead && row.cache_write_tokens === expected.tokens.cacheWrite
          && row.output_tokens === expected.tokens.output && row.reasoning_tokens === expected.tokens.reasoning);
      }
    }
    // The derived model may only cover days that still exist.
    const orphans = this.sql.exec("SELECT (SELECT COUNT(*) FROM usage_stats_day_meta m WHERE NOT EXISTS (SELECT 1 FROM usage_stats_days d WHERE d.client = m.client AND d.utc_day = m.utc_day AND d.device_id = m.device_id)) + (SELECT COUNT(*) FROM usage_stats_day_rows r WHERE NOT EXISTS (SELECT 1 FROM usage_stats_days d WHERE d.client = r.client AND d.utc_day = r.utc_day AND d.device_id = r.device_id)) + (SELECT COUNT(*) FROM usage_stats_day_totals t WHERE NOT EXISTS (SELECT 1 FROM usage_stats_days d WHERE d.client = t.client AND d.utc_day = t.utc_day AND d.device_id = t.device_id)) AS orphans").toArray()[0];
    requireStats(orphans.orphans === 0);
    requireStats(control.revision !== 0 || days === 0);
  }
}
