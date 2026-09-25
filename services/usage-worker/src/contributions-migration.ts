import { admissionHex, equalAdmissionBytes } from "../../../lib/usage/admission";
import { contributionHash, ContributionFault, parseContributionLegacySeal, type ContributionDelta,
  type ContributionLegacySeal, type ContributionMigrationRequest } from "../../../lib/usage/contributions";
import { parseUsageStatsReport, statsInteger, STATS_TOKEN_KEYS, type UsageStatsReport } from "../../../lib/usage/stats-contract";
import { parseStatsReceipt, parseStatsUpload } from "../../../lib/usage/stats-http-contract";
import { AdmissionState, type AdmissionAuthority } from "./admission-state";
import { ADMISSION_SCHEMA } from "./admission-schema";
import { batchAccount, decideAdmission, freezeAdmission, lastSequence, operationDay,
  ownedAdmissionBatch, ownedAdmissionJournal, timestampsAtMost, type AdmissionHead } from "./admission-policy";
import { StatsState, STATS_SCHEMA, statsUploadText } from "./stats-state";
import { legacyContributionRow, sealedLegacyHead } from "./contributions-legacy";
import { contributionArtifact, contributionDeltaBundle, ensureContributionArtifact, ensureContributionJournal,
  type ContributionArtifact, type ContributionJournalBundle, type VerifiedContributionJournal } from "./contributions-journal";
import { enrollmentStorageCall } from "./namespace-anchor";

// One retained head per distinct occurrence, replayed into an in-memory map
// alongside the sealed day/body vectors inside one transaction. 65,536 keeps
// a founder-scale history (≈10k session files ≈ tens of thousands of heads)
// inside the single-shot budget while staying well under the durable-object
// heap; beyond it, chunked migration is the follow-on.
export const CONTRIBUTION_MIGRATION_MAX_HEADS = 65_536;
// The retained journal table itself CHECKs revision <= 4,096, so a journal
// cap at the table maximum covers every reachable account; it is the
// single-transaction replay budget, not a storage invariant.
export const CONTRIBUTION_MIGRATION_MAX_JOURNALS = 4_096;
export const CONTRIBUTION_MIGRATION_MAX_DAYS = 8_192;
export const CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES = 67_108_864;
type SourceObject = Readonly<{ bucket: "STAGING" | "CONTROL"; key: string; media: string; schema: string; bytes: Uint8Array<ArrayBuffer> }>;
type LegacyDay = Readonly<{ client: string; day: number; revision: number; bodyHash: string; projectionHash: string; bytes: number;
  deviceId: string; ownershipRevision: number; report: UsageStatsReport }>;
type LegacyBody = Readonly<{ bodyHash: string; deviceId: string; revision: number; committedAtMs: number; days: readonly LegacyDay[] }>;
export type ContributionMigrationSnapshot = Readonly<{
  seal: ContributionLegacySeal; manifest: ContributionArtifact; pages: readonly ContributionArtifact[];
  sourceObjects: readonly SourceObject[]; bodies: readonly LegacyBody[]; deltas: readonly ContributionDelta[];
  sourceBytes: number;
}>;
export type ContributionMigrationBundle = Readonly<{ snapshot: ContributionMigrationSnapshot; journal: ContributionJournalBundle;
  bodyHash: string; byteLength: number; request: ContributionMigrationRequest }>;
function checked(value: unknown): asserts value { if (!value) throw new ContributionFault("storage_invalid"); }
const blob = (value: SqlStorageValue): Uint8Array<ArrayBuffer> => {
  if (!(value instanceof ArrayBuffer)) throw new ContributionFault("storage_invalid"); return new Uint8Array(value);
};
const digest = (value: unknown) => contributionHash(JSON.stringify(value));
function paged(sql: SqlStorage, query: string, maximum: number): Record<string, SqlStorageValue>[] {
  const rows: Record<string, SqlStorageValue>[] = [];
  for (let offset = 0; offset <= maximum; offset += 256) {
    const page = sql.exec(`${query} LIMIT 256 OFFSET ?`, offset).toArray(); rows.push(...page);
    if (rows.length > maximum) throw new ContributionFault("limit"); if (page.length < 256) break;
  }
  return rows;
}
/** A bounded full source proof, used only by explicit mutation/maintenance.
 * Every V1 decision is replayed from zero; an old cached audit stamp is not an
 * integrity root. Current source bodies and provenance remain separate from
 * aggregate-only V2 cohorts, whose overlap is deliberately unresolved. */
export function captureContributionMigration(sql: SqlStorage, authority: AdmissionAuthority): ContributionMigrationSnapshot {
  const account = sql.exec("SELECT schema_version FROM account_enrollment WHERE id=1 LIMIT 2").toArray();
  checked(account.length === 1 && account[0].schema_version === 9 && authority.phase === "active");
  for (const [name, expected] of Object.entries({ ...ADMISSION_SCHEMA, ...STATS_SCHEMA }))
    checked(sql.exec("SELECT sql FROM sqlite_schema WHERE name=? LIMIT 2", name).toArray()[0]?.sql === expected);
  const admission = new AdmissionState(sql), stats = new StatsState(sql), first = admission.control(), second = stats.control();
  if (first.quarantined || second.quarantined) throw new ContributionFault("recovery_required");
  if (first.heads > CONTRIBUTION_MIGRATION_MAX_HEADS || first.revision > CONTRIBUTION_MIGRATION_MAX_JOURNALS) throw new ContributionFault("limit");
  if (admission.pending(authority) !== null || stats.pendings().length !== 0) throw new ContributionFault("conflict");
  // Do not let an understated/corrupt control row admit a larger legacy scan.
  // The extra row detects overflow without traversing the remaining history.
  const actualHeads = sql.exec("SELECT COUNT(*) AS count FROM (SELECT occurrence_id FROM usage_admission_heads LIMIT ?)", CONTRIBUTION_MIGRATION_MAX_HEADS + 1).one().count;
  const actualJournals = sql.exec("SELECT COUNT(*) AS count FROM (SELECT revision FROM usage_admission_journal LIMIT ?)", CONTRIBUTION_MIGRATION_MAX_JOURNALS + 1).one().count;
  if (!statsInteger(actualHeads, 0, CONTRIBUTION_MIGRATION_MAX_HEADS) || !statsInteger(actualJournals, 0, CONTRIBUTION_MIGRATION_MAX_JOURNALS))
    throw new ContributionFault("limit");
  checked(actualHeads === first.heads && actualJournals === first.revision);
  const totals = sql.exec("SELECT COUNT(*) AS count, COALESCE(SUM(byte_count),0) AS bytes FROM (SELECT byte_count FROM usage_stats_days LIMIT ?)", CONTRIBUTION_MIGRATION_MAX_DAYS + 1).one();
  if (!statsInteger(totals.count, 0, CONTRIBUTION_MIGRATION_MAX_DAYS) || !statsInteger(totals.bytes, 0, CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES)) throw new ContributionFault("limit");
  const v1Devices = sql.exec("SELECT COUNT(*) AS count, COALESCE(SUM(COALESCE(length(last_batch),0)+COALESCE(length(last_journal),0)),0) AS bytes FROM (SELECT last_batch,last_journal FROM usage_admission_devices LIMIT 129)").one();
  checked(statsInteger(v1Devices.count, 0, 128) && statsInteger(v1Devices.bytes, 0, CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES));
  admission.verifyHistory(authority, true); stats.auditHistory(authority);
  const heads = new Map<string, AdmissionHead>(), sequence = new Map<string, number>();
  const sourceObjects: SourceObject[] = [], journals: unknown[] = []; let sourceBytes = 0, previousTime = 0;
  for (const raw of paged(sql, "SELECT * FROM usage_admission_journal ORDER BY revision", CONTRIBUTION_MIGRATION_MAX_JOURNALS)) {
    const batch = ownedAdmissionBatch(blob(raw.batch)), journal = ownedAdmissionJournal(blob(raw.journal), batch);
    const device = authority.devices.find(device => device.deviceId === admissionHex(batch.deviceId));
    checked(raw.revision === journals.length + 1 && journal.accountJournalRevision === raw.revision && batchAccount(batch) === authority.accountId
      && admissionHex(batch.generation) === authority.generation && device && batch.firstSequence === (sequence.get(device.deviceId) ?? 0) + 1
      && journal.committedAtMs >= previousTime && journal.committedAtMs >= device.enrolledAtMs && journal.committedAtMs === raw.committed_at_ms);
    const revoked = journal.receipts[0].outcome === 7;
    checked(revoked ? device.revokedAtMs !== null && device.revokedAtMs <= journal.committedAtMs
      : device.revokedAtMs === null || journal.committedAtMs <= device.revokedAtMs);
    timestampsAtMost(batch, journal.committedAtMs);
    const decision = decideAdmission(batch, batch.operations.map(operation => heads.get(admissionHex(operation.occurrenceId)) ?? null), revoked);
    checked(equalAdmissionBytes(freezeAdmission(batch, decision, journal.accountJournalRevision, journal.committedAtMs).bytes, journal.bytes));
    if (journal.status === 1) batch.operations.forEach((operation, index) => {
      if (journal.receipts[index].outcome <= 3) heads.set(admissionHex(operation.occurrenceId), { operation, revision: journal.accountJournalRevision, day: operationDay(operation)?.day ?? null });
    });
    if (heads.size > CONTRIBUTION_MIGRATION_MAX_HEADS) throw new ContributionFault("limit");
    sequence.set(device.deviceId, lastSequence(batch)); previousTime = journal.committedAtMs;
    const prefix = `usage-admission/v1/${authority.accountId.slice(5)}/${authority.generation}`;
    const batchBytes = Uint8Array.from(batch.bytes), journalBytes = Uint8Array.from(journal.bytes);
    sourceObjects.push({ bucket: "STAGING", key: `${prefix}/batches/${admissionHex(batch.batchHash)}.aicb`, bytes: batchBytes,
      media: "application/vnd.aicharts.usage-batch-v1", schema: "1" },
    { bucket: "CONTROL", key: `${prefix}/journal/${String(journal.accountJournalRevision).padStart(16, "0")}.aicj`, bytes: journalBytes,
      media: "application/vnd.aicharts.usage-journal-v1", schema: "1" });
    sourceBytes += batchBytes.length + journalBytes.length;
    if (sourceBytes > CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES) throw new ContributionFault("limit");
    journals.push([journal.accountJournalRevision, admissionHex(batch.batchHash), contributionHash(batchBytes), batchBytes.length,
      contributionHash(journalBytes), journalBytes.length, journal.committedAtMs]);
  }
  checked(journals.length === first.revision && heads.size === first.heads && [...heads.values()].filter(head => head.day !== null).length === first.live);
  const storedHeads = paged(sql, "SELECT occurrence_id FROM usage_admission_heads ORDER BY occurrence_id", CONTRIBUTION_MIGRATION_MAX_HEADS);
  const headEntries: unknown[] = [], numeric = new Map<string, bigint[]>();
  for (const raw of storedHeads) {
    const id = admissionHex(blob(raw.occurrence_id)), expected = heads.get(id), current = admission.head(blob(raw.occurrence_id), authority, first);
    checked(expected && current && equalAdmissionBytes(expected.operation.bytes, current.operation.bytes) && expected.revision === current.revision);
    headEntries.push([id, admissionHex(current.operation.operationHash), contributionHash(current.operation.frame), current.revision, current.day]);
  }
  checked(storedHeads.length === heads.size);
  // Days are partitioned by the device that published them; the publishing
  // revision is the only ownership generation a day has.
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
  checked(days.length === totals.count);
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
  const sourceDays = days.map(day => ({ client: day.client, day: day.day, revision: day.revision, bodyHash: day.bodyHash, projectionHash: day.projectionHash, bytes: day.bytes, deviceId: day.deviceId, ownershipRevision: day.ownershipRevision })), headDigest = digest(headEntries), journalDigest = digest(journals);
  const v1Sources = sourceObjects.map(({ bytes, ...source }) => ({ ...source, hash: contributionHash(bytes), size: bytes.length }));
  const owned = new Set(days.map(day => `${day.client}:${day.day}`)); let suppressed = 0;
  // Independent decimal sufficient-stat conservation, partitioned by visibility.
  for (const head of heads.values()) if (head.day !== null) {
    const row = legacyContributionRow(head.operation), hidden = owned.has(`${row.client}:${row.utcDay}`); if (hidden) suppressed++;
    const key = `${hidden ? "suppressed" : "visible"}:${row.client}:${row.utcDay}`, vector = numeric.get(key) ?? [0n, 0n, 0n, 0n, 0n, 0n];
    vector[0]++; STATS_TOKEN_KEYS.forEach((name, index) => { vector[index + 1] += BigInt(row.tokens[name]); }); numeric.set(key, vector);
  }
  const conservation = [...numeric].sort(([a], [b]) => a < b ? -1 : 1).map(([key, values]) => [key, values.map(String)]);
  // V1 last-batch/receipt rows duplicate bytes already retained in its journal.
  // Count them explicitly; a rejected large batch can leave very few heads, so
  // a per-head allowance cannot cover the extra per-device retained copy.
  const metadataBytes = sourceBytes + Number(v1Devices.bytes) + Number(totals.bytes) + first.heads * 1_024
    + days.length * 512 + Number(v1Devices.count) * 1_024 + devices.length * 2_048 + writers.length * 1_024 + 65_536;
  const seal = parseContributionLegacySeal({ schemaVersion: 3, accountSchemaVersion: 9, accountId: authority.accountId, generation: authority.generation,
    v1Revision: first.revision, v1HeadCount: first.heads, v1LiveCount: first.live, suppressedV1Heads: suppressed,
    v1HeadDigest: headDigest, v1JournalDigest: journalDigest, v1SourceDigest: digest({ objects: v1Sources, devices: authority.devices.map(device => [device.deviceId, device.enrolledAtMs, device.revokedAtMs]) }), v2Revision: second.revision,
    v2DayCount: days.length, v2BodyCount: bodies.size, v2SourceDigest: digest({ days: sourceDays, devices, writers, control: second }),
    conservationDigest: digest(conservation), immutableBytes: sourceBytes + second.immutableBytes, metadataBytes });
  if (!seal) throw new ContributionFault("limit");
  const deltas: ContributionDelta[] = [];
  for (const id of heads.keys()) {
    const head = sealedLegacyHead(sql, id, seal); checked(head);
    if (!head.deleted && !head.suppressedLegacy) { checked(head.reference); deltas.push({ id, before: null, after: head.reference }); }
  }
  deltas.sort((a, b) => a.id < b.id ? -1 : 1);
  const entries = [...headEntries.map(value => ({ kind: "v1-head", value })), ...journals.map(value => ({ kind: "v1-journal", value })),
    ...sourceDays.map(value => ({ kind: "v2-day-unresolved", value })), ...devices.map(value => ({ kind: "v2-device", value })),
    ...writers.map(value => ({ kind: "v2-writer", value })), ...conservation.map(value => ({ kind: "conservation", value }))];
  const pages: ContributionArtifact[] = [];
  for (let i = 0; i < entries.length; i += 128) pages.push(contributionArtifact({ schemaVersion: 3, kind: "contribution-migration-page",
    accountId: authority.accountId, generation: authority.generation, offset: i, entries: entries.slice(i, i + 128) }));
  const manifest = contributionArtifact({ schemaVersion: 3, kind: "contribution-migration", seal,
    pages: pages.map(page => ({ hash: page.hash, bytes: page.bytes })), entryCount: entries.length,
    entriesHash: digest(entries), legacyResolution: bodies.size ? "unresolved" : "exact-v1" });
  return { seal, manifest, pages, sourceObjects, bodies: [...bodies.values()], deltas, sourceBytes };
}
export function contributionMigrationBundle(request: ContributionMigrationRequest, snapshot: ContributionMigrationSnapshot): ContributionMigrationBundle {
  if (request.accountId !== snapshot.seal.accountId || request.generation !== snapshot.seal.generation
    || request.expectedV1Revision !== snapshot.seal.v1Revision || request.expectedV2Revision !== snapshot.seal.v2Revision) throw new ContributionFault("conflict");
  const bodyHash = contributionHash(`aicharts:contribution-migration:v3\0${JSON.stringify(request)}\0${snapshot.manifest.hash}`);
  const journal = contributionDeltaBundle({ accountId: request.accountId, generation: request.generation, operationId: request.operationId,
    bodyHash, previousRevision: request.expectedRevision, revision: request.expectedRevision + 1 }, snapshot.deltas);
  return { snapshot, journal, bodyHash, request, byteLength: snapshot.manifest.bytes + snapshot.pages.reduce((sum, page) => sum + page.bytes, 0) + journal.byteLength };
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
export async function ensureContributionMigration(env: Pick<Env, "STAGING" | "CONTROL">, bundle: ContributionMigrationBundle,
  admitted: () => boolean): Promise<VerifiedContributionMigration> {
  const check = () => { if (!admitted()) throw new ContributionFault("recovery_required"); }; let inspected = 0;
  const available = (maximum: number) => {
    const remaining = CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES - inspected;
    if (remaining < 1) throw new ContributionFault("limit"); return Math.min(maximum, remaining);
  };
  for (const source of bundle.snapshot.sourceObjects) {
    check(); const bytes = await sourceBytes(env[source.bucket], source.key, source.media, source.schema, available(source.bytes.length)); check();
    checked(equalAdmissionBytes(bytes, source.bytes)); inspected += bytes.length;
  }
  for (const body of bundle.snapshot.bodies) {
    check(); const prefix = `usage-stats/v2/${bundle.request.accountId}/${bundle.request.generation}`;
    const bytes = await sourceBytes(env.STAGING, `${prefix}/snapshots/${body.bodyHash}.json`, "application/vnd.aicharts.stats-v2+json", "2", available(4_194_304)); check();
    inspected += bytes.length;
    checked(contributionHash(bytes) === body.bodyHash);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), request = parseStatsUpload(JSON.parse(text) as unknown);
    checked(request && statsUploadText(request) === text && request.accountId === bundle.request.accountId && request.generation === bundle.request.generation
      && request.deviceId === body.deviceId && request.expectedRevision + 1 === body.revision);
    const receiptBytes = await sourceBytes(env.CONTROL, `${prefix}/receipts/${String(body.revision).padStart(16, "0")}-${body.bodyHash}.json`, "application/vnd.aicharts.stats-v2+json", "2", available(1_024)); check();
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
  }
  check();
  for (const page of bundle.snapshot.pages) await ensureContributionArtifact(env.STAGING, bundle.request.accountId, page, admitted);
  await ensureContributionArtifact(env.STAGING, bundle.request.accountId, bundle.snapshot.manifest, admitted);
  const journal = await ensureContributionJournal(env.STAGING, bundle.journal, admitted); check();
  const result = Object.freeze({ bodyHash: bundle.bodyHash, manifestHash: bundle.snapshot.manifest.hash, byteLength: bundle.byteLength, journal });
  verified.add(result); return result;
}
