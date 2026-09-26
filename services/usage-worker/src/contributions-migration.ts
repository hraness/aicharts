import { admissionHex, equalAdmissionBytes } from "../../../lib/usage/admission";
import { contributionHash, contributionPayloadHash, ContributionFault, parseContributionLegacySeal,
  type ContributionDelta, type ContributionLegacySeal, type ContributionMigrationRequest } from "../../../lib/usage/contributions";
import { parseUsageStatsReport, statsInteger, STATS_TOKEN_KEYS, type UsageStatsReport } from "../../../lib/usage/stats-contract";
import { parseStatsReceipt, parseStatsUpload } from "../../../lib/usage/stats-http-contract";
import { AdmissionState, type AdmissionAuthority } from "./admission-state";
import { ADMISSION_SCHEMA } from "./admission-schema";
import { auditReceiptHead, batchAccount, decideAdmission, freezeAdmission, lastSequence, operationDay, ownedAdmissionBatch,
  ownedAdmissionJournal, ownedAdmissionOperation, timestampsAtMost, type AdmissionHead } from "./admission-policy";
import { StatsState, STATS_SCHEMA, statsUploadText } from "./stats-state";
import { legacyContributionRow } from "./contributions-legacy";
import { contributionArtifact, ensureContributionArtifact, sealVerifiedContributionJournal, CONTRIBUTION_JOURNAL_PAGE_ENTRIES,
  CONTRIBUTION_JOURNAL_ROOT_BYTES, parseContributionJournalRoot,
  type ContributionArtifact, type ContributionJournalBundle, type VerifiedContributionJournal } from "./contributions-journal";
import { enrollmentStorageCall } from "./namespace-anchor";

// Retained heads replay through a scratch table rather than an in-memory map,
// and page/delta artifacts stream into scratch as they are produced, so the
// durable-object heap stays bounded at any account size. The bound is now a
// scope and stage budget, not a memory invariant; 262,144 matches
// CONTRIBUTION_MAX_HEADS, the protocol ceiling a sealed account may carry.
export const CONTRIBUTION_MIGRATION_MAX_HEADS = 262_144;
// The retained journal table itself CHECKs revision <= 4,096, so a journal cap
// at the table maximum covers every reachable account.
export const CONTRIBUTION_MIGRATION_MAX_JOURNALS = 4_096;
export const CONTRIBUTION_MIGRATION_MAX_DAYS = 8_192;
export const CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES = 67_108_864;
// Total charged bytes for one migration (manifest + manifest pages + delta
// journal): entries up to heads+journals+days+devices, so ~110MB worst case.
export const CONTRIBUTION_MIGRATION_MAX_BUNDLE_BYTES = 268_435_456;
// Each stage commits bounded scratch progress inside one transactionSync, so
// an RPC timeout or restart rolls back at most one segment and the client's
// identical replayed request resumes at the cursor. The round cap bounds work
// inside a single call; hitting it surfaces an uncertain outcome and the
// client retries with the same request bytes.
const SEGMENT_JOURNALS = 64;
const SEGMENT_HEADS = 8_192;
const SEGMENT_DELTAS = 8_192;
const SEGMENT_PAGES = 64;
export const CONTRIBUTION_MIGRATION_STAGE_ROUNDS = 4_096;
const MIGRATION_PAGE_ENTRIES = 128;
type SourceObject = Readonly<{ bucket: "STAGING" | "CONTROL"; key: string; media: string; schema: string; bytes: Uint8Array<ArrayBuffer> }>;
type SourceDescriptor = Readonly<{ bucket: "STAGING" | "CONTROL"; key: string; media: string; schema: string; size: number;
  hash: string; revision: number; part: "batch" | "journal" }>;
type LegacyDay = Readonly<{ client: string; day: number; revision: number; bodyHash: string; projectionHash: string; bytes: number;
  deviceId: string; ownershipRevision: number; report: UsageStatsReport }>;
type LegacyBody = Readonly<{ bodyHash: string; deviceId: string; revision: number; committedAtMs: number; days: readonly LegacyDay[] }>;
type DeltaJournalParts = Readonly<{ count: number; entriesHash: string;
  descriptors: readonly Readonly<{ hash: string; bytes: number; count: number }>[]; pages: Iterable<ContributionArtifact> }>;
export type ContributionMigrationSnapshot = Readonly<{
  seal: ContributionLegacySeal; manifest: ContributionArtifact; pages: Iterable<ContributionArtifact>;
  sourceObjects: Iterable<SourceObject>; bodies: readonly LegacyBody[]; journal: DeltaJournalParts; sourceBytes: number;
}>;
export type ContributionMigrationBundle = Readonly<{ snapshot: ContributionMigrationSnapshot; journal: ContributionJournalBundle;
  bodyHash: string; byteLength: number; request: ContributionMigrationRequest }>;
function checked(value: unknown): asserts value { if (!value) throw new ContributionFault("storage_invalid"); }
const blob = (value: SqlStorageValue): Uint8Array<ArrayBuffer> => {
  if (!(value instanceof ArrayBuffer)) throw new ContributionFault("storage_invalid"); return new Uint8Array(value);
};
const digest = (value: unknown) => contributionHash(JSON.stringify(value));
const hashJoined = (fragments: Iterable<string>) => contributionHash(`[${[...fragments].join(",")}]`);
function paged(sql: SqlStorage, query: string, maximum: number): Record<string, SqlStorageValue>[] {
  const rows: Record<string, SqlStorageValue>[] = [];
  for (let offset = 0; offset <= maximum; offset += 256) {
    const page = sql.exec(`${query} LIMIT 256 OFFSET ?`, offset).toArray(); rows.push(...page);
    if (rows.length > maximum) throw new ContributionFault("limit"); if (page.length < 256) break;
  }
  return rows;
}

/* Scratch lives in durable `migration_*` tables: the enrollment schema
 * manifest excludes that prefix, so they stay outside the frozen exact-table
 * check while surviving object eviction — a mid-flight migration resumes at
 * its committed cursor instead of restarting. Everything stored is treated as
 * untrusted input: metadata re-parses, counts re-verify, and the sealed digest
 * inputs are byte-exact serializations. */
const SCRATCH_DDL = [
  `CREATE TABLE IF NOT EXISTS migration_meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS migration_heads (occurrence_id BLOB PRIMARY KEY NOT NULL, operation BLOB NOT NULL, journal_revision INTEGER NOT NULL, utc_day INTEGER) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS migration_frag (kind TEXT NOT NULL, seq INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (kind, seq)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS migration_delta (id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS migration_page (ordinal INTEGER PRIMARY KEY NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS migration_dpage (ordinal INTEGER PRIMARY KEY NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, count INTEGER NOT NULL) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS migration_heads_rev ON migration_heads (journal_revision, occurrence_id)`,
];
const SCRATCH_OBJECTS = ["migration_meta", "migration_heads", "migration_frag", "migration_delta", "migration_page", "migration_dpage"];

interface MigrationMeta {
  stage: "capture" | "rest" | "heads" | "seal" | "deltas" | "entries" | "pages" | "dpages" | "ready";
  pinV1: number; pinV2: number; pinHeads: number; pinLive: number; throughRevision: number;
  v1DeviceCount: number; v1DeviceBytes: number; sequence: Record<string, number>; previousTime: number; sourceBytes: number;
  headCursor: string | null; headsSeen: number; liveSeen: number; headSeq: number;
  numeric: Record<string, string[]>; suppressed: number;
  devicesJson?: string; writersJson?: string; sourceDaysJson?: string; ownedJson?: string; bodiesJson?: string;
  dayCount?: number; dayBytes?: number; sourceDescriptorsJson?: string; metadataBytes?: number;
  v2SourceDigest?: string; conservationJson?: string;
  sealJson?: string; deltaRevCursor?: number; deltaIdCursor?: string | null; deltaCount?: number;
  entrySource?: number; entryCursor?: number; entrySeq?: number; pageCursor?: number; deltaCursor?: string | null;
  deltaOrdinal?: number; manifestJson?: string; deltaEntriesHash?: string;
  // Ordered proof-of-storage progress: [0,sources) then bodies, manifest
  // pages, the manifest, delta pages and the journal root — every item
  // completes its R2 write/verify before the cursor advances. The byte
  // counter persists beside the index so the source bound stays honest.
  ensureIndex?: number; ensureInspected?: number;
}

export function clearMigrationScratch(sql: SqlStorage): void {
  for (const table of SCRATCH_OBJECTS) sql.exec(`DROP TABLE IF EXISTS ${table}`);
  sql.exec("DROP INDEX IF EXISTS migration_heads_rev");
}
function migrationScratchPresent(sql: SqlStorage): boolean {
  return sql.exec("SELECT 1 FROM sqlite_schema WHERE name='migration_meta' LIMIT 1").toArray().length === 1;
}
function metaLoad(sql: SqlStorage): MigrationMeta {
  const meta = metaRead(sql);
  checked(meta !== null);
  return meta;
}
function metaRead(sql: SqlStorage): MigrationMeta | null {
  const row = sql.exec("SELECT v FROM migration_meta WHERE k='meta'").toArray()[0];
  if (!row) return null;
  checked(typeof row.v === "string");
  try { return JSON.parse(row.v) as MigrationMeta; } catch { throw new ContributionFault("storage_invalid"); }
}
function metaStore(sql: SqlStorage, meta: MigrationMeta): void {
  sql.exec("INSERT INTO migration_meta (k, v) VALUES ('meta', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", JSON.stringify(meta));
}
function scratchInit(sql: SqlStorage): void {
  for (const ddl of SCRATCH_DDL) sql.exec(ddl);
}
function scratchReset(sql: SqlStorage): MigrationMeta {
  clearMigrationScratch(sql); scratchInit(sql);
  return { stage: "capture", pinV1: 0, pinV2: 0, pinHeads: 0, pinLive: 0, throughRevision: 0, v1DeviceCount: 0, v1DeviceBytes: 0,
    sequence: {}, previousTime: 0, sourceBytes: 0, headCursor: null, headsSeen: 0, liveSeen: 0, headSeq: 0, numeric: {}, suppressed: 0 };
}
function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function scratchHead(row: Record<string, SqlStorageValue>): AdmissionHead {
  return { operation: ownedAdmissionOperation(blob(row.operation)),
    revision: row.journal_revision as number, day: row.utc_day === null ? null : row.utc_day as number };
}
function scratchHeadFor(sql: SqlStorage, occurrenceId: Uint8Array): AdmissionHead | null {
  const rows = sql.exec("SELECT operation, journal_revision, utc_day FROM migration_heads WHERE occurrence_id=? LIMIT 2",
    occurrenceId).toArray();
  checked(rows.length <= 1); return rows.length ? scratchHead(rows[0]) : null;
}
function fragInsert(sql: SqlStorage, kind: string, seq: number, value: unknown): void {
  sql.exec("INSERT INTO migration_frag (kind, seq, text) VALUES (?, ?, ?)", kind, seq, JSON.stringify(value));
}
function* fragScan(sql: SqlStorage, kind: string): Generator<string> {
  for (let offset = 0; ; offset += 1024) {
    const page = sql.exec("SELECT text FROM migration_frag WHERE kind=? ORDER BY seq LIMIT 1024 OFFSET ?", kind, offset).toArray();
    for (const row of page) yield row.text as string;
    if (page.length < 1024) return;
  }
}
/** Assert the pinned source revisions still hold; drift between stages is a
 * conflict, resolved when the client replays a fresh request. */
function migrationPin(sql: SqlStorage, meta: MigrationMeta): void {
  const first = new AdmissionState(sql).control(), second = new StatsState(sql).control();
  if (first.revision !== meta.pinV1 || second.revision !== meta.pinV2) throw new ContributionFault("conflict");
}

/** Deferred audits and bound checks run once, when scratch is first laid. */
function captureBegin(sql: SqlStorage, authority: AdmissionAuthority, meta: MigrationMeta,
  request: ContributionMigrationRequest | null): void {
  const account = sql.exec("SELECT schema_version FROM account_enrollment WHERE id=1 LIMIT 2").toArray();
  checked(account.length === 1 && account[0].schema_version === 9 && authority.phase === "active");
  for (const [name, expected] of Object.entries({ ...ADMISSION_SCHEMA, ...STATS_SCHEMA }))
    checked(sql.exec("SELECT sql FROM sqlite_schema WHERE name=? LIMIT 2", name).toArray()[0]?.sql === expected);
  const admission = new AdmissionState(sql), stats = new StatsState(sql), first = admission.control(), second = stats.control();
  if (first.quarantined || second.quarantined) throw new ContributionFault("recovery_required");
  if (first.heads > CONTRIBUTION_MIGRATION_MAX_HEADS || first.revision > CONTRIBUTION_MIGRATION_MAX_JOURNALS) throw new ContributionFault("limit");
  if (admission.pending(authority) !== null || stats.pendings().length !== 0) throw new ContributionFault("conflict");
  // Do not let an understated/corrupt control row admit a larger legacy scan.
  const actualHeads = sql.exec("SELECT COUNT(*) AS count FROM (SELECT occurrence_id FROM usage_admission_heads LIMIT ?)", CONTRIBUTION_MIGRATION_MAX_HEADS + 1).one().count;
  const actualJournals = sql.exec("SELECT COUNT(*) AS count FROM (SELECT revision FROM usage_admission_journal LIMIT ?)", CONTRIBUTION_MIGRATION_MAX_JOURNALS + 1).one().count;
  if (!statsInteger(actualHeads, 0, CONTRIBUTION_MIGRATION_MAX_HEADS) || !statsInteger(actualJournals, 0, CONTRIBUTION_MIGRATION_MAX_JOURNALS))
    throw new ContributionFault("limit");
  checked(actualHeads === first.heads && actualJournals === first.revision);
  const totals = sql.exec("SELECT COUNT(*) AS count, COALESCE(SUM(byte_count),0) AS bytes FROM (SELECT byte_count FROM usage_stats_days LIMIT ?)", CONTRIBUTION_MIGRATION_MAX_DAYS + 1).one();
  if (!statsInteger(totals.count, 0, CONTRIBUTION_MIGRATION_MAX_DAYS) || !statsInteger(totals.bytes, 0, CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES)) throw new ContributionFault("limit");
  const v1Devices = sql.exec("SELECT COUNT(*) AS count, COALESCE(SUM(COALESCE(length(last_batch),0)+COALESCE(length(last_journal),0)),0) AS bytes FROM (SELECT last_batch,last_journal FROM usage_admission_devices LIMIT 129)").one();
  checked(statsInteger(v1Devices.count, 0, 128) && statsInteger(v1Devices.bytes, 0, CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES));
  if (request && (request.expectedV1Revision !== first.revision || request.expectedV2Revision !== second.revision))
    throw new ContributionFault("conflict");
  admission.verifyHistory(authority, true); stats.auditHistory(authority);
  meta.pinV1 = first.revision; meta.pinV2 = second.revision; meta.pinHeads = first.heads; meta.pinLive = first.live;
  meta.v1DeviceCount = Number(v1Devices.count); meta.v1DeviceBytes = Number(v1Devices.bytes);
  meta.dayCount = Number(totals.count); meta.dayBytes = Number(totals.bytes);
}

/** Replay the next ≤SEGMENT_JOURNALS retained journals into scratch heads;
 * prior-head lookups resolve through the scratch table, not a resident map. */
function captureSegment(sql: SqlStorage, authority: AdmissionAuthority, meta: MigrationMeta): void {
  const rows = sql.exec("SELECT * FROM usage_admission_journal WHERE revision > ? ORDER BY revision LIMIT ?",
    meta.throughRevision, SEGMENT_JOURNALS).toArray();
  const prefix = `usage-admission/v1/${authority.accountId.slice(5)}/${authority.generation}`;
  const descriptors: SourceDescriptor[] = meta.sourceDescriptorsJson ? JSON.parse(meta.sourceDescriptorsJson) as SourceDescriptor[] : [];
  for (const raw of rows) {
    const batch = ownedAdmissionBatch(blob(raw.batch)), journal = ownedAdmissionJournal(blob(raw.journal), batch);
    const device = authority.devices.find(device => device.deviceId === admissionHex(batch.deviceId));
    checked(typeof raw.revision === "number" && raw.revision === meta.throughRevision + 1 && journal.accountJournalRevision === raw.revision
      && batchAccount(batch) === authority.accountId && admissionHex(batch.generation) === authority.generation && device
      && batch.firstSequence === (meta.sequence[device.deviceId] ?? 0) + 1
      && journal.committedAtMs >= meta.previousTime && journal.committedAtMs >= device.enrolledAtMs
      && journal.committedAtMs === raw.committed_at_ms);
    const revoked = journal.receipts[0].outcome === 7;
    checked(revoked ? device.revokedAtMs !== null && device.revokedAtMs <= journal.committedAtMs
      : device.revokedAtMs === null || journal.committedAtMs <= device.revokedAtMs);
    timestampsAtMost(batch, journal.committedAtMs);
    const decision = decideAdmission(batch, batch.operations.map(operation => scratchHeadFor(sql, operation.occurrenceId)), revoked);
    checked(equalAdmissionBytes(freezeAdmission(batch, decision, journal.accountJournalRevision, journal.committedAtMs).bytes, journal.bytes));
    if (journal.status === 1) batch.operations.forEach((operation, index) => {
      if (journal.receipts[index].outcome <= 3)
        sql.exec("INSERT INTO migration_heads (occurrence_id, operation, journal_revision, utc_day) VALUES (?, ?, ?, ?)"
          + " ON CONFLICT(occurrence_id) DO UPDATE SET operation=excluded.operation, journal_revision=excluded.journal_revision, utc_day=excluded.utc_day",
          operation.occurrenceId, operation.bytes, journal.accountJournalRevision, operationDay(operation)?.day ?? null);
    });
    checked(Number(sql.exec("SELECT COUNT(*) AS c FROM migration_heads").one().c) <= CONTRIBUTION_MIGRATION_MAX_HEADS);
    meta.sequence[device.deviceId] = lastSequence(batch); meta.previousTime = journal.committedAtMs;
    const batchBytes = Uint8Array.from(batch.bytes), journalBytes = Uint8Array.from(journal.bytes);
    descriptors.push({ bucket: "STAGING", key: `${prefix}/batches/${admissionHex(batch.batchHash)}.aicb`, size: batchBytes.length,
      media: "application/vnd.aicharts.usage-batch-v1", schema: "1", hash: contributionHash(batchBytes),
      revision: journal.accountJournalRevision, part: "batch" },
    { bucket: "CONTROL", key: `${prefix}/journal/${String(journal.accountJournalRevision).padStart(16, "0")}.aicj`, size: journalBytes.length,
      media: "application/vnd.aicharts.usage-journal-v1", schema: "1", hash: contributionHash(journalBytes),
      revision: journal.accountJournalRevision, part: "journal" });
    meta.sourceBytes += batchBytes.length + journalBytes.length;
    if (meta.sourceBytes > CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES) throw new ContributionFault("limit");
    fragInsert(sql, "journal", journal.accountJournalRevision, [journal.accountJournalRevision, admissionHex(batch.batchHash),
      contributionHash(batchBytes), batchBytes.length, contributionHash(journalBytes), journalBytes.length, journal.committedAtMs]);
    meta.throughRevision += 1;
  }
  meta.sourceDescriptorsJson = JSON.stringify(descriptors);
  if (meta.throughRevision === meta.pinV1) meta.stage = "rest";
}

/** The small aggregates (days, bodies, devices, writers, source days, the
 * owned-day suppression set) materialize once into the meta record. */
function restSegment(sql: SqlStorage, meta: MigrationMeta): void {
  const stats = new StatsState(sql), second = stats.control();
  const rawDays = paged(sql, "SELECT d.*, d.revision AS ownership_revision FROM usage_stats_days d ORDER BY d.client,d.utc_day,d.device_id", CONTRIBUTION_MIGRATION_MAX_DAYS);
  const bodies = new Map<string, { bodyHash: string; deviceId: string; revision: number; committedAtMs: number; days: LegacyDay[] }>();
  const days: LegacyDay[] = rawDays.map(raw => {
    checked(typeof raw.projection === "string"); const report = parseUsageStatsReport(JSON.parse(raw.projection) as unknown);
    checked(report && typeof raw.client === "string" && typeof raw.body_hash === "string" && typeof raw.projection_hash === "string"
      && typeof raw.device_id === "string" && typeof raw.utc_day === "number" && typeof raw.revision === "number"
      && typeof raw.byte_count === "number" && typeof raw.ownership_revision === "number" && report.updatedAtMs !== null);
    const day = { client: raw.client, day: raw.utc_day, revision: raw.revision, bodyHash: raw.body_hash, projectionHash: raw.projection_hash,
      bytes: raw.byte_count, deviceId: raw.device_id, ownershipRevision: raw.ownership_revision, report };
    const body = bodies.get(day.bodyHash);
    checked(!body || (body.deviceId === day.deviceId && body.revision === day.revision && body.committedAtMs === report.updatedAtMs));
    if (body) body.days.push(day); else bodies.set(day.bodyHash, { bodyHash: day.bodyHash, deviceId: day.deviceId,
      revision: day.revision, committedAtMs: report.updatedAtMs, days: [day] });
    return day;
  });
  checked(days.length === meta.dayCount);
  const devices = paged(sql, "SELECT * FROM usage_stats_devices ORDER BY device_id", 128);
  for (const raw of devices) {
    checked(typeof raw.device_id === "string"); const receipt = stats.progress(raw.device_id).receipt; checked(receipt);
    const body = bodies.get(receipt.bodyHash);
    checked(!body || (body.deviceId === raw.device_id && body.revision === receipt.revision && body.committedAtMs === receipt.committedAtMs));
    if (!body) bodies.set(receipt.bodyHash, { bodyHash: receipt.bodyHash, deviceId: raw.device_id, revision: receipt.revision, committedAtMs: receipt.committedAtMs, days: [] });
  }
  if (bodies.size > CONTRIBUTION_MIGRATION_MAX_DAYS) throw new ContributionFault("limit");
  // Device partitions replaced the single writer per client; the sealed
  // manifest keeps an empty writer list for its retained shape.
  const writers: Record<string, SqlStorageValue>[] = [];
  const sourceDays = days.map(day => ({ client: day.client, day: day.day, revision: day.revision, bodyHash: day.bodyHash,
    projectionHash: day.projectionHash, bytes: day.bytes, deviceId: day.deviceId, ownershipRevision: day.ownershipRevision }));
  const owned = new Set(days.map(day => `${day.client}:${day.day}`));
  meta.bodiesJson = JSON.stringify([...bodies.values()]);
  meta.devicesJson = JSON.stringify(devices);
  meta.writersJson = JSON.stringify(writers);
  meta.sourceDaysJson = JSON.stringify(sourceDays);
  meta.ownedJson = JSON.stringify([...owned]);
  meta.v2SourceDigest = digest({ days: sourceDays, devices, writers, control: second });
  meta.metadataBytes = meta.sourceBytes + meta.v1DeviceBytes + meta.dayBytes! + meta.pinHeads * 1_024
    + days.length * 512 + meta.v1DeviceCount * 1_024 + devices.length * 2_048 + writers.length * 1_024 + 65_536;
  meta.stage = "heads";
}

/** Verify retained heads against the replayed scratch set and emit the
 * head-entry fragments (v1HeadDigest input) plus conservation accumulators. */
function headsSegment(sql: SqlStorage, authority: AdmissionAuthority, meta: MigrationMeta): void {
  const admission = new AdmissionState(sql), first = admission.control();
  const owned = new Set(JSON.parse(meta.ownedJson!) as string[]);
  const cursor = meta.headCursor === null ? new Uint8Array(0) : hexBytes(meta.headCursor);
  const rows = sql.exec("SELECT occurrence_id FROM usage_admission_heads WHERE occurrence_id > ? ORDER BY occurrence_id LIMIT ?",
    cursor, SEGMENT_HEADS).toArray();
  for (const raw of rows) {
    const idBuf = blob(raw.occurrence_id), id = admissionHex(idBuf);
    const replay = sql.exec("SELECT operation, journal_revision, utc_day FROM migration_heads WHERE occurrence_id=? LIMIT 2", idBuf).toArray()[0];
    const current = admission.head(idBuf, authority, first);
    checked(replay && current && equalAdmissionBytes(blob(replay.operation), current.operation.bytes)
      && replay.journal_revision === current.revision && replay.utc_day === current.day);
    fragInsert(sql, "head", meta.headSeq, [id, admissionHex(current.operation.operationHash),
      contributionHash(current.operation.frame), current.revision, current.day]);
    meta.headSeq += 1; meta.headsSeen += 1;
    if (current.day !== null) {
      meta.liveSeen += 1;
      const row = legacyContributionRow(current.operation), hidden = owned.has(`${row.client}:${row.utcDay}`);
      if (hidden) meta.suppressed += 1;
      const key = `${hidden ? "suppressed" : "visible"}:${row.client}:${row.utcDay}`;
      const vector = meta.numeric[key] ?? ["0", "0", "0", "0", "0", "0"];
      vector[0] = String(BigInt(vector[0]) + 1n);
      STATS_TOKEN_KEYS.forEach((name, index) => { vector[index + 1] = String(BigInt(vector[index + 1]) + BigInt(row.tokens[name])); });
      meta.numeric[key] = vector;
    }
    meta.headCursor = id;
  }
  if (rows.length < SEGMENT_HEADS) {
    checked(meta.headsSeen === meta.pinHeads && meta.liveSeen === meta.pinLive);
    meta.stage = "seal";
  }
}

/** Seal the retained state: the streamed digests, conservation, and the
 * bounded seal descriptor. */
function sealSegment(sql: SqlStorage, authority: AdmissionAuthority, meta: MigrationMeta): void {
  const second = new StatsState(sql).control();
  const conservation = Object.entries(meta.numeric).sort(([a], [b]) => a < b ? -1 : 1).map(([key, values]) => [key, values]);
  const v1Sources = (JSON.parse(meta.sourceDescriptorsJson!) as SourceDescriptor[])
    .map(({ bucket, key, media, schema, hash, size }) => ({ bucket, key, media, schema, hash, size }));
  const seal = parseContributionLegacySeal({ schemaVersion: 3, accountSchemaVersion: 9, accountId: authority.accountId,
    generation: authority.generation, v1Revision: meta.pinV1, v1HeadCount: meta.pinHeads, v1LiveCount: meta.pinLive,
    suppressedV1Heads: meta.suppressed, v1HeadDigest: hashJoined(fragScan(sql, "head")), v1JournalDigest: hashJoined(fragScan(sql, "journal")),
    v1SourceDigest: digest({ objects: v1Sources, devices: authority.devices.map(device => [device.deviceId, device.enrolledAtMs, device.revokedAtMs]) }),
    v2Revision: meta.pinV2, v2DayCount: meta.dayCount, v2BodyCount: (JSON.parse(meta.bodiesJson!) as unknown[]).length,
    v2SourceDigest: meta.v2SourceDigest, conservationDigest: digest(conservation),
    immutableBytes: meta.sourceBytes + second.immutableBytes, metadataBytes: meta.metadataBytes });
  if (!seal) throw new ContributionFault("limit");
  meta.sealJson = JSON.stringify(seal); meta.conservationJson = JSON.stringify(conservation);
  meta.deltaRevCursor = 0; meta.deltaIdCursor = null; meta.deltaCount = 0;
  meta.stage = "deltas";
}

/** Emit the retained delta entries, iterating heads by journal revision so
 * each batch decodes once; the scratch key (id) keeps the emitted order. */
function deltasSegment(sql: SqlStorage, meta: MigrationMeta): void {
  const seal = parseContributionLegacySeal(JSON.parse(meta.sealJson!) as unknown); checked(seal);
  const owned = new Set(JSON.parse(meta.ownedJson!) as string[]);
  const cursorId = meta.deltaIdCursor === null || meta.deltaIdCursor === undefined ? new Uint8Array(0) : hexBytes(meta.deltaIdCursor);
  const rows = sql.exec("SELECT * FROM migration_heads WHERE journal_revision > ? OR (journal_revision = ? AND occurrence_id > ?)"
    + " ORDER BY journal_revision, occurrence_id LIMIT ?", meta.deltaRevCursor!, meta.deltaRevCursor!, cursorId, SEGMENT_DELTAS).toArray();
  let batch: ReturnType<typeof ownedAdmissionBatch> | null = null, journal: ReturnType<typeof ownedAdmissionJournal> | null = null;
  let indexOf = new Map<string, number>(), revision = 0;
  for (const row of rows) {
    const head = scratchHead(row), id = admissionHex(blob(row.occurrence_id));
    if (head.revision !== revision) {
      const kept = sql.exec("SELECT batch, journal FROM usage_admission_journal WHERE revision=? LIMIT 2", head.revision).toArray();
      checked(kept.length === 1);
      batch = ownedAdmissionBatch(blob(kept[0].batch)); journal = ownedAdmissionJournal(blob(kept[0].journal), batch);
      checked(journal.accountJournalRevision === head.revision);
      indexOf = new Map(batch.operations.map((operation, index) => [admissionHex(operation.occurrenceId), index]));
      revision = head.revision;
    }
    const index = indexOf.get(id);
    checked(index !== undefined && equalAdmissionBytes(batch!.operations[index!].bytes, head.operation.bytes));
    auditReceiptHead(head.operation, journal!.receipts[index!], head.revision, head);
    meta.deltaRevCursor = head.revision; meta.deltaIdCursor = id;
    if (head.operation.action === 2 || head.day === null) continue;
    const deltaRow = legacyContributionRow(head.operation);
    if (owned.has(`${deltaRow.client}:${deltaRow.utcDay}`)) continue;
    sql.exec("INSERT INTO migration_delta (id, text) VALUES (?, ?)", id, JSON.stringify({ id, before: null,
      after: { kind: "admission-v1", generation: seal.generation, bodyHash: admissionHex(batch!.batchHash), index,
        payloadHash: contributionPayloadHash(deltaRow), operationHash: admissionHex(head.operation.operationHash) } } satisfies ContributionDelta));
    meta.deltaCount! += 1;
  }
  if (rows.length < SEGMENT_DELTAS) { meta.entrySource = 0; meta.entryCursor = 0; meta.entrySeq = 0; meta.stage = "entries"; }
}

/** Emit manifest entry fragments in section order: v1 heads (the stored tuple
 * text wrapped), journals, days, devices, writers, conservation. */
function entriesSegment(sql: SqlStorage, meta: MigrationMeta): void {
  const kinds = { head: "v1-head", journal: "v1-journal", day: "v2-day-unresolved", device: "v2-device",
    writer: "v2-writer", conservation: "conservation" } as const;
  const order = Object.keys(kinds) as (keyof typeof kinds)[];
  const inline: Record<string, unknown[]> = {};
  const loadInline = (kind: string): unknown[] => {
    if (inline[kind]) return inline[kind];
    const json = { day: meta.sourceDaysJson, device: meta.devicesJson, writer: meta.writersJson,
      conservation: meta.conservationJson }[kind];
    return inline[kind] = (json ? JSON.parse(json) : []) as unknown[];
  };
  for (let emitted = 0; emitted < SEGMENT_DELTAS; ) {
    if (meta.entrySource! >= order.length) { meta.pageCursor = 0; meta.stage = "pages"; return; }
    const source = order[meta.entrySource!];
    let text: string | null = null;
    if (source === "head" || source === "journal") {
      const row = sql.exec("SELECT seq, text FROM migration_frag WHERE kind=? AND seq>=? ORDER BY seq LIMIT 1",
        source, meta.entryCursor).toArray()[0];
      if (row) {
        text = `{"kind":${JSON.stringify(kinds[source])},"value":${row.text as string}}`;
        meta.entryCursor = (row.seq as number) + 1;
      }
    } else {
      const items = loadInline(source);
      if (meta.entryCursor! < items.length) {
        text = `{"kind":${JSON.stringify(kinds[source])},"value":${JSON.stringify(items[meta.entryCursor!])}}`;
        meta.entryCursor! += 1;
      }
    }
    if (text === null) { meta.entrySource! += 1; meta.entryCursor = 0; continue; }
    sql.exec("INSERT INTO migration_frag (kind, seq, text) VALUES ('entry', ?, ?)", meta.entrySeq!, text);
    meta.entrySeq! += 1; emitted += 1;
  }
}

/** Emit ≤SEGMENT_PAGES manifest page artifacts per call; each page serializes
 * through the same `contributionArtifact` codec as the one-shot path. */
function pagesSegment(sql: SqlStorage, authority: AdmissionAuthority, meta: MigrationMeta): void {
  for (let pages = 0; pages < SEGMENT_PAGES; pages++) {
    const rows = sql.exec("SELECT seq, text FROM migration_frag WHERE kind='entry' AND seq>=? ORDER BY seq LIMIT ?",
      meta.pageCursor!, MIGRATION_PAGE_ENTRIES).toArray();
    if (!rows.length) break;
    const entries = rows.map(row => JSON.parse(row.text as string) as unknown);
    const artifact = contributionArtifact({ schemaVersion: 3, kind: "contribution-migration-page",
      accountId: authority.accountId, generation: authority.generation, offset: meta.pageCursor, entries });
    sql.exec("INSERT INTO migration_page (ordinal, text, hash, bytes) VALUES (?, ?, ?, ?)",
      meta.pageCursor! / MIGRATION_PAGE_ENTRIES, artifact.text, artifact.hash, artifact.bytes);
    meta.pageCursor = (rows[rows.length - 1].seq as number) + 1;
    if (rows.length < MIGRATION_PAGE_ENTRIES) break;
  }
  if (sql.exec("SELECT 1 FROM migration_frag WHERE kind='entry' AND seq>=? LIMIT 1", meta.pageCursor!).toArray().length) return;
  const descriptors = sql.exec("SELECT hash, bytes FROM migration_page ORDER BY ordinal").toArray()
    .map(row => ({ hash: row.hash as string, bytes: row.bytes as number }));
  const entryCount = Number(sql.exec("SELECT COUNT(*) AS c FROM migration_frag WHERE kind='entry'").one().c);
  const seal = parseContributionLegacySeal(JSON.parse(meta.sealJson!) as unknown); checked(seal);
  const manifest = contributionArtifact({ schemaVersion: 3, kind: "contribution-migration", seal,
    pages: descriptors, entryCount, entriesHash: hashJoined(fragScan(sql, "entry")),
    legacyResolution: (JSON.parse(meta.bodiesJson!) as unknown[]).length ? "unresolved" : "exact-v1" });
  meta.manifestJson = manifest.text;
  meta.deltaCursor = null; meta.deltaOrdinal = 0;
  meta.stage = "dpages";
}

/** Emit ≤SEGMENT_PAGES delta-journal page artifacts per call, iterating the
 * scratch deltas in their keyed (id) order. */
function dpagesSegment(sql: SqlStorage, authority: AdmissionAuthority, meta: MigrationMeta): void {
  for (let pages = 0; pages < SEGMENT_PAGES; pages++) {
    const cursor = meta.deltaCursor === null || meta.deltaCursor === undefined ? "" : meta.deltaCursor;
    const rows = sql.exec("SELECT id, text FROM migration_delta WHERE id > ? ORDER BY id LIMIT ?",
      cursor, CONTRIBUTION_JOURNAL_PAGE_ENTRIES).toArray();
    if (!rows.length) break;
    const entries = rows.map(row => JSON.parse(row.text as string) as ContributionDelta);
    const artifact = contributionArtifact({ schemaVersion: 3, kind: "contribution-delta-page",
      accountId: authority.accountId, generation: authority.generation, entries });
    sql.exec("INSERT INTO migration_dpage (ordinal, text, hash, bytes, count) VALUES (?, ?, ?, ?, ?)",
      meta.deltaOrdinal!, artifact.text, artifact.hash, artifact.bytes, entries.length);
    meta.deltaOrdinal! += 1;
    meta.deltaCursor = rows[rows.length - 1].id as string;
    if (rows.length < CONTRIBUTION_JOURNAL_PAGE_ENTRIES) break;
  }
  if (sql.exec("SELECT 1 FROM migration_delta WHERE id > ? LIMIT 1",
    meta.deltaCursor === null || meta.deltaCursor === undefined ? "" : meta.deltaCursor).toArray().length) return;
  meta.deltaEntriesHash = hashJoined(function* () { for (const row of sql.exec("SELECT text FROM migration_delta ORDER BY id").toArray()) yield row.text as string; }());
  meta.stage = "ready";
}

/** The assembled snapshot over scratch: pages, sources, and delta pages read
 * lazily so the resident set stays bounded. Re-pins the source revisions so a
 * drifted account fails closed at commit time as well. */
export function stagedMigrationSnapshot(sql: SqlStorage): ContributionMigrationSnapshot {
  const meta = metaLoad(sql);
  checked(meta.stage === "ready");
  migrationPin(sql, meta);
  const seal = parseContributionLegacySeal(JSON.parse(meta.sealJson!) as unknown); checked(seal);
  const manifest: ContributionArtifact = Object.freeze({ text: meta.manifestJson!,
    hash: contributionHash(meta.manifestJson!), bytes: new TextEncoder().encode(meta.manifestJson!).length });
  const artifactRows = (table: string): Iterable<ContributionArtifact> => ({
    [Symbol.iterator]: function* () {
      for (let offset = 0; ; offset += 256) {
        const page = sql.exec(`SELECT text, hash, bytes FROM ${table} ORDER BY ordinal LIMIT 256 OFFSET ?`, offset).toArray();
        for (const row of page)
          yield Object.freeze({ text: row.text as string, hash: row.hash as string, bytes: row.bytes as number });
        if (page.length < 256) return;
      }
    },
  });
  const descriptors = JSON.parse(meta.sourceDescriptorsJson!) as SourceDescriptor[];
  const bodies = JSON.parse(meta.bodiesJson!) as LegacyBody[];
  const deltaDescriptors = sql.exec("SELECT hash, bytes, count FROM migration_dpage ORDER BY ordinal").toArray()
    .map(row => ({ hash: row.hash as string, bytes: row.bytes as number, count: row.count as number }));
  return { seal, manifest,
    pages: artifactRows("migration_page"),
    sourceObjects: { [Symbol.iterator]: function* () {
      for (const descriptor of descriptors) {
        const column = descriptor.part === "batch" ? "batch" : "journal";
        const row = sql.exec(`SELECT ${column} AS bytes FROM usage_admission_journal WHERE revision=? LIMIT 2`, descriptor.revision).toArray()[0];
        checked(row); const bytes = blob(row.bytes);
        checked(bytes.length === descriptor.size && contributionHash(bytes) === descriptor.hash);
        yield Object.freeze({ bucket: descriptor.bucket, key: descriptor.key, media: descriptor.media, schema: descriptor.schema, bytes });
      }
    } },
    bodies, sourceBytes: meta.sourceBytes,
    journal: Object.freeze({ count: meta.deltaCount!, entriesHash: meta.deltaEntriesHash!,
      descriptors: Object.freeze(deltaDescriptors.map(row => Object.freeze(row))), pages: artifactRows("migration_dpage") }) };
}

/** Advance the staged capture one bounded step. Returns the assembled
 * snapshot once every stage has run; null while work remains. */
export function advanceContributionMigration(sql: SqlStorage, authority: AdmissionAuthority,
  request: ContributionMigrationRequest | null): ContributionMigrationSnapshot | null {
  // Tables without a meta row are a partial begin — reset and start over.
  let meta = migrationScratchPresent(sql) ? metaRead(sql) : null;
  if (meta === null) {
    meta = scratchReset(sql);
    captureBegin(sql, authority, meta, request);
    metaStore(sql, meta);
    return null;
  }
  if (meta.stage === "ready") return stagedMigrationSnapshot(sql);
  migrationPin(sql, meta);
  switch (meta.stage) {
    case "capture": captureSegment(sql, authority, meta); break;
    case "rest": restSegment(sql, meta); break;
    case "heads": headsSegment(sql, authority, meta); break;
    case "seal": sealSegment(sql, authority, meta); break;
    case "deltas": deltasSegment(sql, meta); break;
    case "entries": entriesSegment(sql, meta); break;
    case "pages": pagesSegment(sql, authority, meta); break;
    case "dpages": dpagesSegment(sql, authority, meta); break;
  }
  metaStore(sql, meta);
  const stage: string = meta.stage;
  return stage === "ready" ? stagedMigrationSnapshot(sql) : null;
}

/** Compatibility entry for the deferred-audit call sites and tests: run the
 * staged capture to completion inside the caller's transaction. */
export function captureContributionMigration(sql: SqlStorage, authority: AdmissionAuthority,
  request?: ContributionMigrationRequest): ContributionMigrationSnapshot {
  for (let rounds = 0; rounds < CONTRIBUTION_MIGRATION_STAGE_ROUNDS; rounds++) {
    const snapshot = advanceContributionMigration(sql, authority, request ?? null);
    if (snapshot) return snapshot;
  }
  throw new ContributionFault("limit");
}

/** The migration journal's root and artifact are bound to the reserved
 * operation; the staged descriptor set lets the journal materialize without
 * holding the delta list in memory. */
export function contributionMigrationBundle(request: ContributionMigrationRequest, snapshot: ContributionMigrationSnapshot): ContributionMigrationBundle {
  if (request.accountId !== snapshot.seal.accountId || request.generation !== snapshot.seal.generation
    || request.expectedV1Revision !== snapshot.seal.v1Revision || request.expectedV2Revision !== snapshot.seal.v2Revision) throw new ContributionFault("conflict");
  const bodyHash = contributionHash(`aicharts:contribution-migration:v3\0${JSON.stringify(request)}\0${snapshot.manifest.hash}`);
  const root = parseContributionJournalRoot({ schemaVersion: 3, kind: "contribution-deltas", accountId: request.accountId,
    generation: request.generation, operationId: request.operationId, bodyHash,
    previousRevision: request.expectedRevision, revision: request.expectedRevision + 1,
    count: snapshot.journal.count, entriesHash: snapshot.journal.entriesHash, pages: snapshot.journal.descriptors });
  if (!root) throw new ContributionFault("invalid_input");
  const artifact = contributionArtifact(root, CONTRIBUTION_JOURNAL_ROOT_BYTES);
  const journal: ContributionJournalBundle = Object.freeze({ root, artifact, pages: snapshot.journal.pages,
    byteLength: artifact.bytes + snapshot.journal.descriptors.reduce((sum, page) => sum + page.bytes, 0) });
  let manifestPageBytes = 0;
  for (const page of snapshot.pages) manifestPageBytes += page.bytes;
  return { snapshot, journal, bodyHash, request,
    byteLength: snapshot.manifest.bytes + manifestPageBytes + journal.byteLength };
}
async function sourceBytes(bucket: R2Bucket, key: string, media: string, schema: string, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const object = await enrollmentStorageCall(bucket.get(key), value => { if (value) void value.body.cancel().catch(() => undefined); });
  if (!object) throw new ContributionFault("storage_invalid");
  if (!statsInteger(object.size, 1, maximum) || object.httpMetadata?.contentType !== media || object.httpMetadata.contentEncoding !== undefined
    || object.customMetadata?.schemaVersion !== schema || Object.keys(object.customMetadata).length !== 1 || object.checksums.sha256 === undefined) {
    void object.body.cancel().catch(() => undefined); throw new ContributionFault("storage_invalid");
  }
  const bytes = new Uint8Array(object.size), reader = object.body.getReader(); let offset = 0, done = false;
  try {
    await enrollmentStorageCall((async () => {
      for (;;) {
        const next = await reader.read();
        if (next.done) { done = true; checked(offset === bytes.length); return; }
        checked(next.value instanceof Uint8Array && next.value.length > 0 && next.value.length <= bytes.length - offset);
        bytes.set(next.value, offset); offset += next.value.length;
      }
    })());
  } finally { if (!done) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  checked(contributionHash(bytes) === admissionHex(new Uint8Array(object.checksums.sha256))); return bytes;
}
const verified = new WeakSet<object>();
export type VerifiedContributionMigration = Readonly<{ bodyHash: string; manifestHash: string; byteLength: number; journal: VerifiedContributionJournal }>;
export const isVerifiedContributionMigration = (value: VerifiedContributionMigration): boolean => verified.has(value);

/** The proof-of-storage loop walks thousands of artifacts — far beyond one
 * exchange's wall clock — so progress is checkpointed into scratch: a flat
 * ordered item index (sources, bodies, manifest pages, manifest, delta pages,
 * journal root) that a timed-out call resumes from. Every item is verified
 * before the cursor advances; a crash between item and checkpoint simply
 * re-verifies that item on resume. The call ends on an item budget — the
 * request clock cannot be trusted to advance — with `budgetMs` on the
 * monotonic clock as a secondary bound, both inside the caller's exchange
 * deadline so the checkpoint lands before a disconnect. */
export async function ensureContributionMigration(env: Pick<Env, "STAGING" | "CONTROL">, bundle: ContributionMigrationBundle,
  admitted: () => boolean, sql: SqlStorage, budgetMs: number): Promise<VerifiedContributionMigration> {
  const accountId = bundle.request.accountId;
  const check = () => { if (!admitted()) throw new ContributionFault("recovery_required"); };
  check();
  checked(migrationScratchPresent(sql));
  const meta = metaLoad(sql);
  checked(meta.stage === "ready");
  // Date.now() is frozen at request start in the worker runtime; the
  // monotonic clock still advances across awaited I/O, and the per-call item
  // budget is the deterministic bound a frozen clock cannot hide.
  const startedAt = performance.now(), budgetItems = 160;
  let doneThisCall = 0;
  const persist = () => { meta.ensureIndex = index; meta.ensureInspected = inspected; metaStore(sql, meta); };
  const expire = () => {
    if (doneThisCall >= budgetItems || performance.now() - startedAt > budgetMs) {
      persist(); throw new ContributionFault("storage_unavailable");
    }
  };

  const sourceDescriptors = JSON.parse(meta.sourceDescriptorsJson!) as SourceDescriptor[];
  const bodies = JSON.parse(meta.bodiesJson!) as LegacyBody[];
  const manifestOrdinals = sql.exec("SELECT ordinal FROM migration_page ORDER BY ordinal").toArray().map(row => row.ordinal as number);
  const deltaOrdinals = sql.exec("SELECT ordinal FROM migration_dpage ORDER BY ordinal").toArray().map(row => row.ordinal as number);
  const total = sourceDescriptors.length + bodies.length + manifestOrdinals.length + 1 + deltaOrdinals.length + 1;

  // Flat item sequence: [0,S) source verifies, [S,S+B) body verifies,
  // manifest pages, manifest, delta pages, journal root.
  let index = meta.ensureIndex ?? 0, inspected = meta.ensureInspected ?? 0;
  const manifestArtifact = () => parseArtifactRow(meta.manifestJson!);
  const scratchArtifact = (table: string, ordinal: number) => {
    const row = sql.exec(`SELECT text, hash, bytes FROM ${table} WHERE ordinal=? LIMIT 1`, ordinal).toArray()[0];
    checked(row); return parseArtifactRow(row.text as string, row.hash as string, row.bytes as number);
  };
  const available = (maximum: number) => {
    const remaining = CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES - inspected;
    if (remaining < 1) throw new ContributionFault("limit"); return Math.min(maximum, remaining);
  };
  const done = () => index >= total;

  while (!done()) {
    expire(); if (index % 16 === 0) { check(); persist(); }
    let position = 0;
    if (index < sourceDescriptors.length) {
      const descriptor = sourceDescriptors[index], maximum = available(descriptor.size);
      const object = await enrollmentStorageCall(env[descriptor.bucket].get(descriptor.key), value => { if (value) void value.body.cancel().catch(() => undefined); });
      if (!object) throw new ContributionFault("storage_invalid");
      checked(statsInteger(object.size, 1, maximum)
        && object.httpMetadata?.contentType === descriptor.media && object.httpMetadata.contentEncoding === undefined
        && object.customMetadata?.schemaVersion === descriptor.schema && Object.keys(object.customMetadata).length === 1
        && object.checksums.sha256 !== undefined);
      const bytes = await enrollmentStorageCall(object.arrayBuffer() as Promise<ArrayBuffer>);
      checked(contributionHash(new Uint8Array(bytes)) === descriptor.hash);
      inspected += descriptor.size; index += 1; doneThisCall += 1; continue;
    }
    position += sourceDescriptors.length;
    if (index < position + bodies.length) {
      const body = bodies[index - position], prefix = `usage-stats/v2/${accountId}/${bundle.request.generation}`;
      const bytes = await sourceBytes(env.STAGING, `${prefix}/snapshots/${body.bodyHash}.json`, "application/vnd.aicharts.stats-v2+json", "2", available(4_194_304));
      inspected += bytes.length;
      checked(contributionHash(bytes) === body.bodyHash);
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), request = parseStatsUpload(JSON.parse(text) as unknown);
      checked(request && statsUploadText(request) === text && request.accountId === accountId && request.generation === bundle.request.generation
        && request.deviceId === body.deviceId && request.expectedRevision + 1 === body.revision);
      const receiptBytes = await sourceBytes(env.CONTROL, `${prefix}/receipts/${String(body.revision).padStart(16, "0")}-${body.bodyHash}.json`,
        "application/vnd.aicharts.stats-v2+json", "2", available(1_024));
      inspected += receiptBytes.length;
      const receipt = parseStatsReceipt(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(receiptBytes)) as unknown);
      checked(receipt && receipt.bodyHash === body.bodyHash && receipt.operationId === request.operationId && receipt.sequence === request.sequence
        && receipt.revision === body.revision && receipt.committedAtMs === body.committedAtMs && receipt.client === request.report.sources[0].client
        && receipt.firstUtcDay === request.report.firstUtcDay && receipt.dayCount === request.report.dayCount);
      for (const day of body.days) {
        const rows = request.report.rows.filter(row => row.utcDay === day.day), source = request.report.sources[0], bases = new Set(rows.map(row => row.tokenBasis));
        const projected = parseUsageStatsReport({ ...request.report, firstUtcDay: day.day, dayCount: 1, revision: receipt.revision, updatedAtMs: receipt.committedAtMs,
          sources: [{ ...source, status: rows.length ? "observed" : "empty", records: rows.reduce((sum, row) => sum + row.records, 0),
            tokenBasis: bases.size > 1 ? "mixed" : [...bases][0] ?? source.tokenBasis, latestAtMs: rows.length ? source.latestAtMs : null }], rows });
        checked(projected && contributionHash(JSON.stringify(projected)) === day.projectionHash && JSON.stringify(projected) === JSON.stringify(day.report));
      }
      index += 1; doneThisCall += 1; continue;
    }
    position += bodies.length;
    if (index < position + manifestOrdinals.length) {
      await ensureContributionArtifact(env.STAGING, accountId, scratchArtifact("migration_page", manifestOrdinals[index - position]), admitted);
      index += 1; doneThisCall += 1; continue;
    }
    position += manifestOrdinals.length;
    if (index === position) {
      await ensureContributionArtifact(env.STAGING, accountId, manifestArtifact(), admitted);
      index += 1; doneThisCall += 1; continue;
    }
    position += 1;
    if (index < position + deltaOrdinals.length) {
      await ensureContributionArtifact(env.STAGING, accountId, scratchArtifact("migration_dpage", deltaOrdinals[index - position]), admitted);
      index += 1; doneThisCall += 1; continue;
    }
    position += deltaOrdinals.length;
    if (index === position) {
      await ensureContributionArtifact(env.STAGING, accountId, bundle.journal.artifact, admitted);
      index += 1; doneThisCall += 1; continue;
    }
    checked(false);
  }
  check();
  const journal = sealVerifiedContributionJournal(bundle.journal);
  const result = Object.freeze({ bodyHash: bundle.bodyHash, manifestHash: bundle.snapshot.manifest.hash,
    byteLength: bundle.byteLength, journal });
  verified.add(result); return result;
}
function parseArtifactRow(text: string, hash?: string, bytes?: number): ContributionArtifact {
  const artifact: ContributionArtifact = Object.freeze({ text,
    hash: hash ?? contributionHash(text), bytes: bytes ?? new TextEncoder().encode(text).length });
  checked(artifact.bytes === new TextEncoder().encode(artifact.text).length && contributionHash(artifact.text) === artifact.hash);
  return artifact;
}
