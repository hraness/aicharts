import { LEADERBOARD_MAX_RECORDS } from "../../../lib/usage/leaderboard-contract";
import { createHash } from "node:crypto";
import { parseUsageStatsReport, statsDecimal, statsRowKey, statsTokenTotal, STATS_MAX_DAY, STATS_MAX_RECORDS, type SourceCoverage, type UsageStatsReport, type UsageStatsRow } from "../../../lib/usage/stats-contract";
import { isStatsClient, isStatsModel, isStatsProvider } from "../../../lib/usage/stats-registry";
import { STATS_HTTP_RESPONSE_BYTES, STATS_HTTP_RESPONSE_ROWS, parseStatsReceipt, statsHex, statsInteger, type StatsError, type StatsRange, type StatsReceipt, type StatsStatus, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import type { StatsAbandonRequest, StatsAbandonment } from "../../../lib/usage/stats-http-contract";
import { decodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1, MAX_ADMISSION_HEADS } from "./admission-policy";
import { AdmissionState, type AdmissionAuthority } from "./admission-state";

export const MAX_STATS_STORED_DAYS = 65_536;
export const MAX_STATS_STORED_ROWS = 262_144;
export const MAX_STATS_STORED_BYTES = 128 * 1024 * 1024;
export const MAX_STATS_IMMUTABLE_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_STATS_REVISIONS = 1_000_000;
export const MAX_STATS_DAY_SOURCES = 65_536;
export const LEGACY_STATS_WRITERS_SQL = `CREATE TABLE usage_stats_writers (client TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL CHECK (length(device_id) = 64)) WITHOUT ROWID`;
export const STATS_SCHEMA = Object.freeze({
  usage_stats_control: `CREATE TABLE usage_stats_control (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 1000000), updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms BETWEEN 0 AND 8640000000000000), quarantined INTEGER NOT NULL CHECK (quarantined IN (0, 1)), immutable_bytes INTEGER NOT NULL CHECK (immutable_bytes BETWEEN 0 AND 8589934592))`,
  usage_stats_writers: `CREATE TABLE usage_stats_writers (client TEXT PRIMARY KEY NOT NULL, device_id TEXT NOT NULL CHECK (length(device_id) = 64), ownership_revision INTEGER NOT NULL CHECK (ownership_revision BETWEEN 0 AND 1000000)) WITHOUT ROWID`,
  usage_stats_day_sources: `CREATE TABLE usage_stats_day_sources (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), device_id TEXT NOT NULL CHECK (length(device_id) = 64), ownership_revision INTEGER NOT NULL CHECK (ownership_revision BETWEEN 0 AND 1000000), PRIMARY KEY (client, utc_day)) WITHOUT ROWID`,
  usage_stats_devices: `CREATE TABLE usage_stats_devices (device_id TEXT PRIMARY KEY NOT NULL CHECK (length(device_id) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), receipt TEXT NOT NULL CHECK (length(receipt) <= 1024)) WITHOUT ROWID`,
  usage_stats_pending: `CREATE TABLE usage_stats_pending (id INTEGER PRIMARY KEY CHECK (id = 1), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), device_id TEXT NOT NULL CHECK (length(device_id) = 64), sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991), expected_revision INTEGER NOT NULL CHECK (expected_revision BETWEEN 0 AND 999999), receipt TEXT CHECK (receipt IS NULL OR length(receipt) <= 1024))`,
  usage_stats_days: `CREATE TABLE usage_stats_days (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), body_hash TEXT NOT NULL CHECK (length(body_hash) = 64), projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64), row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 8192), byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 4194304), projection TEXT NOT NULL CHECK (length(projection) <= 4194304), PRIMARY KEY (client, utc_day)) WITHOUT ROWID`,
  usage_stats_day_meta: `CREATE TABLE usage_stats_day_meta (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000), row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 8192), latest_at_ms INTEGER CHECK (latest_at_ms IS NULL OR latest_at_ms BETWEEN 0 AND 8640000000000000), rows_hash TEXT NOT NULL CHECK (length(rows_hash) = 64), PRIMARY KEY (client, utc_day)) WITHOUT ROWID`,
  usage_stats_day_rows: `CREATE TABLE usage_stats_day_rows (client TEXT NOT NULL, utc_day INTEGER NOT NULL CHECK (utc_day BETWEEN 0 AND 99999999), ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 8191), provider TEXT, model TEXT, input_tokens TEXT NOT NULL, cache_read_tokens TEXT NOT NULL, cache_write_tokens TEXT NOT NULL, output_tokens TEXT NOT NULL, reasoning_tokens TEXT NOT NULL, records INTEGER NOT NULL CHECK (records BETWEEN 1 AND 10000000), reported_cost_microusd TEXT, reported_cost_records INTEGER NOT NULL CHECK (reported_cost_records BETWEEN 0 AND 10000000), estimated_cost_microusd TEXT, estimated_cost_records INTEGER NOT NULL CHECK (estimated_cost_records BETWEEN 0 AND 10000000), duration_ms TEXT, timed_records INTEGER NOT NULL CHECK (timed_records BETWEEN 0 AND 10000000), timed_tokens TEXT NOT NULL, token_basis TEXT NOT NULL CHECK (token_basis IN ('reported', 'estimated', 'unavailable')), breakdown_coverage TEXT NOT NULL CHECK (breakdown_coverage IN ('partial', 'complete')), PRIMARY KEY (client, utc_day, ordinal)) WITHOUT ROWID`,
});
export class StatsFault extends Error { constructor(readonly code: StatsError = "storage_invalid") { super(code); } }
function requireStats(value: unknown): asserts value { if (!value) throw new StatsFault(); }
export const statsHash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const statsUploadText = (request: StatsUpload): string => JSON.stringify(request);
const legacyClient = (provider: number): string => provider === 1 ? "codex" : provider === 2 ? "claude" : "devin-cli";
const LEGACY_CLIENTS = ["codex", "claude", "devin-cli"];
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
  transferWriter(authority: AdmissionAuthority, client: string, previousDeviceId: string, deviceId: string,
    expectedRevision: number, now: number): { writerDeviceId: string; ownershipRevision: number } {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (now < control.updatedAtMs) throw new StatsFault("clock_regressed");
    const row = this.sql.exec("SELECT device_id, ownership_revision FROM usage_stats_writers WHERE client = ? LIMIT 2", client).toArray();
    if (row.length !== 1) throw new StatsFault("writer_conflict");
    if (!authority.devices.some(device => device.deviceId === deviceId && device.revokedAtMs === null)) throw new StatsFault("unauthorized");
    if (row[0].device_id === deviceId && row[0].ownership_revision === expectedRevision + 1)
      return { writerDeviceId: deviceId, ownershipRevision: expectedRevision + 1 };
    if (row[0].device_id !== previousDeviceId || previousDeviceId === deviceId
      || !authority.devices.some(device => device.deviceId === previousDeviceId && device.revokedAtMs !== null)) throw new StatsFault("writer_conflict");
    if (control.revision !== expectedRevision) throw new StatsFault("conflict");
    if (control.revision >= MAX_STATS_REVISIONS) throw new StatsFault("limit");
    const pending = this.pending();
    if (pending !== null && pending.deviceId !== previousDeviceId) throw new StatsFault("conflict");
    const ownershipRevision = control.revision + 1;
    this.sql.exec("UPDATE usage_stats_writers SET device_id = ?, ownership_revision = ? WHERE client = ?", deviceId, ownershipRevision, client);
    this.sql.exec("UPDATE usage_stats_control SET revision = ?, updated_at_ms = ? WHERE id = 1", ownershipRevision, now);
    if (pending !== null) this.sql.exec("DELETE FROM usage_stats_pending WHERE id = 1");
    // Each committed day retains its own original owner. Transfer does not
    // attest that the successor's local ledger contains that population.
    return { writerDeviceId: deviceId, ownershipRevision };
  }
  /** Fenced schema upgrade preserves the original writer attribution of every
   * retained day. Historic generations never supported writer transfer. */
  migrateOwnership(accountVersion: SqlStorageValue): void {
    const definitions = new Map(this.sql.exec("SELECT name, sql FROM sqlite_schema WHERE name IN ('usage_stats_writers', 'usage_stats_day_sources') LIMIT 3")
      .toArray().map(row => [String(row.name), row.sql]));
    if (accountVersion === 8 || accountVersion === 9 || accountVersion === 10 || accountVersion === 11 || accountVersion === 12 || accountVersion === 13) {
      // Current sources are authority, never a rebuildable projection. A
      // restored old writer table or missing sources cannot attest ownership.
      requireStats(definitions.get("usage_stats_writers") === STATS_SCHEMA.usage_stats_writers
        && definitions.get("usage_stats_day_sources") === STATS_SCHEMA.usage_stats_day_sources);
      return;
    }
    requireStats(accountVersion === 7 && definitions.get("usage_stats_writers") === LEGACY_STATS_WRITERS_SQL
      && !definitions.has("usage_stats_day_sources"));
    this.sql.exec("ALTER TABLE usage_stats_writers RENAME TO usage_stats_writers_retired");
    this.sql.exec(STATS_SCHEMA.usage_stats_writers);
    this.sql.exec("INSERT INTO usage_stats_writers SELECT client, device_id, 0 FROM usage_stats_writers_retired");
    this.sql.exec("DROP TABLE usage_stats_writers_retired");
    this.sql.exec(STATS_SCHEMA.usage_stats_day_sources);
    const count = this.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_days").one().count;
    requireStats(statsInteger(count, 0, MAX_STATS_DAY_SOURCES));
    this.sql.exec("INSERT INTO usage_stats_day_sources SELECT d.client, d.utc_day, w.device_id, w.ownership_revision FROM usage_stats_days d JOIN usage_stats_writers w ON w.client = d.client");
    requireStats(this.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_day_sources").one().count === count);
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
  #day(raw: Record<string, SqlStorageValue>, control = this.control()): StoredDay {
    requireStats(isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, 99_999_999) && statsInteger(raw.revision, 1, control.revision)
      && statsHex(raw.body_hash) && statsHex(raw.projection_hash) && typeof raw.projection === "string"
      && new TextEncoder().encode(raw.projection).length === raw.byte_count && statsHash(raw.projection) === raw.projection_hash);
    const report = parseUsageStatsReport(JSON.parse(raw.projection));
    requireStats(report && report.sources.length === 1 && report.sources[0].client === raw.client && report.dayCount === 1
      && report.firstUtcDay === raw.utc_day && report.rows.length === raw.row_count && report.revision === raw.revision);
    return { client: raw.client, utcDay: raw.utc_day, revision: raw.revision, bodyHash: raw.body_hash, text: raw.projection, report };
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
   * rows. Written atomically with the projection it summarizes; meta is last so
   * a present-but-partial explosion can never certify a pinned day. */
  #explodeDay(client: string, utcDay: number, revision: number, report: UsageStatsReport): void {
    this.sql.exec("DELETE FROM usage_stats_day_rows WHERE client = ? AND utc_day = ?", client, utcDay);
    let ordinal = 0;
    for (const row of report.rows) this.sql.exec("INSERT INTO usage_stats_day_rows (client, utc_day, ordinal, provider, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, reasoning_tokens, records, reported_cost_microusd, reported_cost_records, estimated_cost_microusd, estimated_cost_records, duration_ms, timed_records, timed_tokens, token_basis, breakdown_coverage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      client, utcDay, ordinal++, row.provider, row.model, row.tokens.input, row.tokens.cacheRead, row.tokens.cacheWrite, row.tokens.output,
      row.tokens.reasoning, row.records, row.reportedCostMicrousd, row.reportedCostRecords, row.estimatedCostMicrousd, row.estimatedCostRecords,
      row.durationMs, row.timedRecords, row.timedTokens, row.tokenBasis, row.breakdownCoverage);
    const latest = report.sources[0].latestAtMs;
    this.sql.exec("INSERT INTO usage_stats_day_meta (client, utc_day, revision, row_count, latest_at_ms, rows_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(client, utc_day) DO UPDATE SET revision = excluded.revision, row_count = excluded.row_count, latest_at_ms = excluded.latest_at_ms, rows_hash = excluded.rows_hash",
      client, utcDay, revision, report.rows.length, latest, this.#rowsDigest(latest, report.rows));
  }
  /** Exploded rows for a stored day, served only when the meta row pins the
   * day's current revision and the row scan reproduces its digest. Absent meta
   * means the derived model was never populated; every other inconsistency is
   * corruption, not a cache miss. */
  #storedDayRows(client: string, utcDay: number, revision: number): { latestAtMs: number | null; rows: UsageStatsRow[] } | null {
    const meta = this.sql.exec("SELECT revision, row_count, latest_at_ms, rows_hash FROM usage_stats_day_meta WHERE client = ? AND utc_day = ? LIMIT 2", client, utcDay).toArray();
    requireStats(meta.length <= 1);
    if (meta.length === 0) return null;
    const row = meta[0];
    requireStats(statsInteger(row.revision, 1, MAX_STATS_REVISIONS) && statsInteger(row.row_count, 0, 8192)
      && (row.latest_at_ms === null || statsInteger(row.latest_at_ms, 0, 8_640_000_000_000_000)) && statsHex(row.rows_hash));
    requireStats(row.revision === revision);
    const rows: UsageStatsRow[] = [], hash = createHash("sha256").update("aicharts:stats-v2:day-rows\0").update(`${row.latest_at_ms ?? ""}\0`);
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_day_rows WHERE client = ? AND utc_day = ? ORDER BY ordinal LIMIT 8193", client, utcDay)) {
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
  /** Owner must hold the restore registration and a synchronous transaction. */
  backfillRows(authority: AdmissionAuthority | null): void {
    const { control } = this.auditControl(authority);
    let count = 0;
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_days LIMIT 65537")) {
      requireStats(++count <= MAX_STATS_STORED_DAYS && authority);
      const day = this.#day(raw, control);
      if (this.#storedDayRows(day.client, day.utcDay, day.revision) === null) this.#explodeDay(day.client, day.utcDay, day.revision, day.report);
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
        yield { head, usage: batch.value.usage[0], client: legacyClient(batch.value.usage[0].provider) };
      }
    }
    return { control, heads: heads() };
  }
  status(authority: AdmissionAuthority, deviceId: string, client: string, range: StatsRange): StatsStatus {
    let legacyRecords = 0, eligible = true;
    const { control, heads } = this.#legacy(authority, range);
    const hash = createHash("sha256").update("aicharts:stats-v2:legacy-heads\0").update(client).update("\0").update(`${range.firstUtcDay}:${range.dayCount}\0`);
    for (const { head, client: source } of heads) {
      if (source !== client) continue;
      hash.update(head.operation.occurrenceId).update(head.operation.operationHash);
      legacyRecords++; eligible = false;
    }
    // V1 tombstones deliberately discard their day/provider frame. Until an
    // explicit canonical reconciliation can establish that provenance, a
    // legacy-client snapshot must not resurrect an erased occurrence. Only
    // device's erased population could be copied into an aggregate. Until an
    // exact population proof exists, neither device identity nor totals prove
    // overlap or disjointness. Guard every ambiguous legacy takeover.
    if (LEGACY_CLIENTS.includes(client)) {
      const admission = new AdmissionState(this.sql);
      let tombstones = 0;
      for (const row of this.sql.exec(`SELECT occurrence_id FROM usage_admission_heads WHERE utc_day IS NULL ORDER BY occurrence_id LIMIT ${MAX_ADMISSION_HEADS + 1}`)) {
        requireStats(++tombstones <= MAX_ADMISSION_HEADS && row.occurrence_id instanceof ArrayBuffer);
        const head = admission.head(new Uint8Array(row.occurrence_id), authority, control);
        requireStats(head && head.operation.action === 2);
        hash.update(head.operation.occurrenceId).update(head.operation.operationHash); eligible = false;
      }
    }
    return { schemaVersion: 2, revision: this.control().revision, nextSequence: this.progress(deviceId).sequence + 1,
      writerDeviceId: this.writer(client), v1Revision: control.revision, headDigest: hash.digest("hex"), legacyRecords, takeoverEligible: eligible };
  }
  #projections(request: StatsUpload, receipt: StatsReceipt): readonly { day: number; text: string; rows: number; report: UsageStatsReport }[] {
    const report = request.report, source = report.sources[0];
    return Array.from({ length: report.dayCount }, (_, index) => {
      const day = report.firstUtcDay + index, rows = report.rows.filter(row => row.utcDay === day), records = rows.reduce((sum, row) => sum + row.records, 0);
      if (request.mode === "preserve-history") {
        if (rows.length === 0) return null;
        const prior = this.sql.exec("SELECT revision FROM usage_stats_days WHERE client = ? AND utc_day = ? LIMIT 1", source.client, day).toArray()[0];
        if (prior) {
          requireStats(statsInteger(prior.revision, 1, MAX_STATS_REVISIONS));
          // Prefer the exploded read model; only an unpopulated day pays the
          // blob parse, and the digest pins the exploded copy to the stored day.
          const stored = this.#storedDayRows(source.client, day, prior.revision);
          const oldRows = stored !== null ? stored.rows : this.#day(
            this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? AND utc_day = ? LIMIT 1", source.client, day).toArray()[0]).report.rows;
          const next = new Map(rows.map(row => [statsRowKey(row), row]));
          for (const old of oldRows) {
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
      return { day, text: JSON.stringify(daily), rows: rows.length, report: daily };
    }).filter((value): value is { day: number; text: string; rows: number; report: UsageStatsReport } => value !== null);
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
  check(request: StatsUpload, authority: AdmissionAuthority): void {
    const control = this.control();
    if (control.quarantined) throw new StatsFault("recovery_required");
    if (control.revision >= MAX_STATS_REVISIONS) throw new StatsFault("limit");
    const client = request.report.sources[0].client, status = this.status(authority, request.deviceId, client, request.report);
    if (status.writerDeviceId !== null && status.writerDeviceId !== request.deviceId) throw new StatsFault("writer_conflict");
    if (request.expectedRevision !== status.revision || request.sequence !== status.nextSequence) throw new StatsFault("conflict");
    const selected = new Set(request.report.rows.map(row => row.utcDay));
    for (const source of this.sql.exec("SELECT utc_day, device_id FROM usage_stats_day_sources WHERE client = ? AND utc_day >= ? AND utc_day < ? LIMIT 367",
      client, request.mode === "replace-snapshot" ? 0 : request.report.firstUtcDay,
      request.mode === "replace-snapshot" ? STATS_MAX_DAY + 1 : request.report.firstUtcDay + request.report.dayCount)) {
      requireStats(statsInteger(source.utc_day, 0, STATS_MAX_DAY) && statsHex(source.device_id));
      if (source.device_id !== request.deviceId && (request.mode !== "preserve-history" || selected.has(source.utc_day)))
        throw new StatsFault("replacement_required");
    }
    if (request.mode === "replace-snapshot") {
      const previous = this.sql.exec("SELECT d.utc_day, d.revision, m.revision AS pinned, m.latest_at_ms FROM usage_stats_days d LEFT JOIN usage_stats_day_meta m ON m.client = d.client AND m.utc_day = d.utc_day WHERE d.client = ? ORDER BY d.utc_day DESC LIMIT 2", client).toArray();
      requireStats(previous.length <= 1);
      if (previous.length) {
        const prior = previous[0];
        requireStats(statsInteger(prior.utc_day, 0, STATS_MAX_DAY) && statsInteger(prior.revision, 1, control.revision));
        let latest: number | null;
        if (prior.pinned === null) {
          const stored = this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? AND utc_day = ? LIMIT 2", client, prior.utc_day).toArray();
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
    if (!status.takeoverEligible || (status.legacyRecords > 0 && request.takeover === null)) throw new StatsFault("takeover_required");
    if (request.takeover && (request.takeover.expectedV1Revision !== status.v1Revision || request.takeover.headDigest !== status.headDigest || !status.takeoverEligible)) throw new StatsFault("conflict");
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
    if (request.mode === "replace-snapshot") {
      this.sql.exec("DELETE FROM usage_stats_days WHERE client = ?", receipt.client);
      this.sql.exec("DELETE FROM usage_stats_day_rows WHERE client = ?", receipt.client);
      this.sql.exec("DELETE FROM usage_stats_day_meta WHERE client = ?", receipt.client);
      this.sql.exec("DELETE FROM usage_stats_day_sources WHERE client = ?", receipt.client);
    }
    const writer = this.sql.exec("SELECT ownership_revision FROM usage_stats_writers WHERE client = ? LIMIT 1", receipt.client).toArray()[0];
    const ownershipRevision = writer?.ownership_revision ?? receipt.revision;
    requireStats(statsInteger(ownershipRevision, 0, receipt.revision));
    for (const day of projections) {
      this.sql.exec("INSERT INTO usage_stats_days (client, utc_day, revision, body_hash, projection_hash, row_count, byte_count, projection) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client, utc_day) DO UPDATE SET revision = excluded.revision, body_hash = excluded.body_hash, projection_hash = excluded.projection_hash, row_count = excluded.row_count, byte_count = excluded.byte_count, projection = excluded.projection",
        receipt.client, day.day, receipt.revision, receipt.bodyHash, statsHash(day.text), day.rows, new TextEncoder().encode(day.text).length, day.text);
      this.#explodeDay(receipt.client, day.day, receipt.revision, day.report);
      this.sql.exec("INSERT INTO usage_stats_day_sources (client, utc_day, device_id, ownership_revision) VALUES (?, ?, ?, ?) ON CONFLICT(client, utc_day) DO UPDATE SET device_id = excluded.device_id, ownership_revision = excluded.ownership_revision",
        receipt.client, day.day, request.deviceId, ownershipRevision);
    }
    this.sql.exec("INSERT INTO usage_stats_writers (client, device_id, ownership_revision) VALUES (?, ?, ?) ON CONFLICT(client) DO NOTHING", receipt.client, request.deviceId, ownershipRevision);
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
    const rows: UsageStatsRow[] = [], coverage = new Map<string, { latest: number | null; empty: boolean }>(), owned = new Set<string>();
    for (const raw of this.sql.exec("SELECT client, utc_day, revision, row_count, byte_count FROM usage_stats_days WHERE utc_day >= ? AND utc_day < ? ORDER BY utc_day, client LIMIT 23425", range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
      if (owned.size >= 64 * 366) throw new StatsFault("limit");
      requireStats(isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, STATS_MAX_DAY) && statsInteger(raw.revision, 1, control.revision)
        && statsInteger(raw.row_count, 0, 8192) && statsInteger(raw.byte_count, 1, 4 * 1024 * 1024));
      owned.add(`${raw.client}:${raw.utc_day}`);
      // The exploded read model serves pinned days straight from typed storage;
      // only a never-populated day pays the pure projection parse.
      const stored = this.#storedDayRows(raw.client, raw.utc_day, raw.revision);
      let latest: number | null, count: number;
      if (stored !== null) {
        for (const row of stored.rows) {
          rows.push(row); projectedBytes += JSON.stringify(row).length;
          if (projectedBytes > STATS_HTTP_RESPONSE_BYTES || rows.length > STATS_HTTP_RESPONSE_ROWS) throw new StatsFault("limit");
        }
        latest = stored.latestAtMs; count = stored.rows.length;
      } else {
        const full = this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? AND utc_day = ? LIMIT 2", raw.client, raw.utc_day).toArray();
        requireStats(full.length === 1);
        projectedBytes += raw.byte_count;
        if (projectedBytes > STATS_HTTP_RESPONSE_BYTES) throw new StatsFault("limit");
        const day = this.#dayRows(full[0], control);
        rows.push(...day.rows);
        if (rows.length > STATS_HTTP_RESPONSE_ROWS) throw new StatsFault("limit");
        latest = day.latestAtMs; count = day.rows.length;
      }
      const previous = coverage.get(raw.client);
      coverage.set(raw.client, { latest: latest === null ? previous?.latest ?? null : Math.max(latest, previous?.latest ?? 0), empty: (previous?.empty ?? true) && count === 0 });
    }
    const legacy = new Map<string, UsageStatsRow>();
    // Ambiguous historical overlap is withheld, never silently hidden or summed.
    for (const { head, usage, client } of this.#legacy(authority, range).heads) {
      if (owned.has(`${client}:${head.day}`)) throw new StatsFault("takeover_required");
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
    for (const raw of this.sql.exec("SELECT client, utc_day, revision, row_count, byte_count FROM usage_stats_days WHERE utc_day >= ? AND utc_day < ? ORDER BY utc_day, client LIMIT 23425", range.firstUtcDay, range.firstUtcDay + range.dayCount)) {
      if (owned.size >= 64 * 366) throw new StatsFault("limit");
      requireStats(isStatsClient(raw.client) && statsInteger(raw.utc_day, 0, STATS_MAX_DAY) && statsInteger(raw.revision, 1, control.revision)
        && statsInteger(raw.row_count, 0, 8192) && statsInteger(raw.byte_count, 1, 4 * 1024 * 1024));
      owned.add(`${raw.client}:${raw.utc_day}`);
      const stored = this.#storedDayRows(raw.client, raw.utc_day, raw.revision);
      const source = stored !== null ? stored.rows : this.#dayRows(
        this.sql.exec("SELECT * FROM usage_stats_days WHERE client = ? AND utc_day = ? LIMIT 2", raw.client, raw.utc_day).toArray()[0], control).rows;
      rowCount += source.length;
      for (const row of source) bytes += JSON.stringify(row).length;
      if (rowCount > MAX_STATS_STORED_ROWS || bytes > MAX_STATS_STORED_BYTES) throw new StatsFault("limit");
      for (const row of source) if (row.tokenBasis === "reported") add(statsTokenTotal(row.tokens), row.records);
    }
    for (const { head, usage, client } of this.#legacy(authority, range).heads) {
      if (owned.has(`${client}:${head.day}`)) throw new StatsFault("takeover_required");
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
    for (const writer of writers) requireStats(isStatsClient(writer.client) && statsInteger(writer.ownership_revision, 0, control.revision)
      && authority?.devices.some(device => device.deviceId === writer.device_id));
    requireStats(control.revision !== 0 || writers.length === 0);
    const devices = this.sql.exec("SELECT device_id FROM usage_stats_devices LIMIT 129").toArray();
    requireStats(devices.length <= 128);
    for (const device of devices) { requireStats(typeof device.device_id === "string" && authority?.devices.some(item => item.deviceId === device.device_id)); this.progress(device.device_id); }
    const pending = this.pending();
    if (pending) requireStats(authority?.devices.some(device => device.deviceId === pending.deviceId) && pending.expectedRevision === control.revision && pending.sequence === this.progress(pending.deviceId).sequence + 1);
    return { control, clients: new Set(writers.map(writer => writer.client)) };
  }

  /** Linear in retained days, and each stored projection is parsed to confirm
   * it still matches its recorded metadata — and any populated derived model
   * reproduces the same rows exactly. The owner runs it once per object
   * lifetime before the first mutation, never to serve a read. */
  auditHistory(authority: AdmissionAuthority | null): void {
    const { control, clients } = this.auditControl(authority);
    let days = 0, rows = 0, bytes = 0;
    for (const raw of this.sql.exec("SELECT * FROM usage_stats_days LIMIT 65537")) {
      requireStats(++days <= MAX_STATS_STORED_DAYS && authority);
      const day = this.#day(raw, control); rows += day.report.rows.length; bytes += new TextEncoder().encode(day.text).length;
      requireStats(rows <= MAX_STATS_STORED_ROWS && bytes <= MAX_STATS_STORED_BYTES && clients.has(day.client));
      const source = this.sql.exec("SELECT device_id, ownership_revision FROM usage_stats_day_sources WHERE client = ? AND utc_day = ? LIMIT 2", day.client, day.utcDay).toArray();
      requireStats(source.length === 1 && statsInteger(source[0].ownership_revision, 0, day.revision)
        && authority.devices.some(device => device.deviceId === source[0].device_id));
      const stored = this.#storedDayRows(day.client, day.utcDay, day.revision);
      if (stored !== null) requireStats(stored.latestAtMs === day.report.sources[0].latestAtMs
        && stored.rows.length === day.report.rows.length
        && stored.rows.every((row, index) => this.#rowDigestInput(row) === this.#rowDigestInput(day.report.rows[index])));
    }
    // The derived model may only cover days that still exist.
    const orphans = this.sql.exec("SELECT (SELECT COUNT(*) FROM usage_stats_day_meta m WHERE NOT EXISTS (SELECT 1 FROM usage_stats_days d WHERE d.client = m.client AND d.utc_day = m.utc_day)) + (SELECT COUNT(*) FROM usage_stats_day_rows r WHERE NOT EXISTS (SELECT 1 FROM usage_stats_days d WHERE d.client = r.client AND d.utc_day = r.utc_day)) AS orphans").toArray()[0];
    requireStats(orphans.orphans === 0);
    requireStats(days <= MAX_STATS_DAY_SOURCES && this.sql.exec("SELECT COUNT(*) AS count FROM usage_stats_day_sources").one().count === days);
    requireStats(control.revision !== 0 || days === 0);
  }
}
