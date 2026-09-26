import { checkContributionAuthority, contributionAccount, contributionBatchText, contributionBodyHash, contributionHash,
  contributionHex, contributionIdentity, ContributionFault, CONTRIBUTION_MAX_ASSOCIATIONS, CONTRIBUTION_MAX_BYTES,
  CONTRIBUTION_MAX_HEADS, CONTRIBUTION_MAX_IMMUTABLE_BYTES, CONTRIBUTION_MAX_MEMBERS, CONTRIBUTION_MAX_OPERATIONS,
  CONTRIBUTION_MAX_POPULATIONS, CONTRIBUTION_MAX_TIME, CONTRIBUTION_ZERO_HASH, parseContributionBatch,
  parseContributionGrant, parseContributionReceipt, parseContributionActivationRequest, parseContributionLegacySeal, parseContributionReference, planContribution, type ContributionAuthority, type ContributionBatch,
  type ContributionControl, type ContributionDelta, type ContributionGrant, type ContributionHead, type ContributionMembership,
  type ContributionPlan, type ContributionPopulation, type ContributionReceipt, type ContributionTerminal,
  type ContributionActivationRequest, type ContributionActivationReceipt, type ContributionGrantReceipt,
  parseContributionMigrationRequest, parseContributionMigrationReceipt, type ContributionMigrationRequest, type ContributionMigrationReceipt } from "../../../lib/usage/contributions";
import { statsInteger, statsOwnRecord } from "../../../lib/usage/stats-contract";
import { parseContributionCancelRequest, type ContributionCancelRequest } from "../../../lib/usage/contribution-cancel";
import { contributionObjectKey, isVerifiedContributionBody, type VerifiedContributionBody } from "./contributions-objects";
import { contributionDeltaBundle, isVerifiedContributionJournal, type VerifiedContributionJournal, type ContributionJournalBundle } from "./contributions-journal";
import { sealedLegacyHead } from "./contributions-legacy";
import { clearMigrationScratch, contributionMigrationBundle, CONTRIBUTION_MIGRATION_MAX_BUNDLE_BYTES,
  CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES, isVerifiedContributionMigration, type ContributionMigrationBundle,
  type ContributionMigrationSnapshot, type VerifiedContributionMigration } from "./contributions-migration";

/** Conservative retained metadata reservations include journals, heads, and
 * association indexes. Never refund an uncertain or abandoned reservation. */
export const CONTRIBUTION_MAX_METADATA_BYTES = 536_870_912;
const METADATA_BASE = 8_192, METADATA_PER_MUTATION = 2_048;
export const CONTRIBUTION_SCHEMA = Object.freeze({
  usage_contribution_control: `CREATE TABLE usage_contribution_control (id INTEGER PRIMARY KEY CHECK (id = 1), account_id TEXT NOT NULL, generation TEXT NOT NULL, revision INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, head_count INTEGER NOT NULL, membership_count INTEGER NOT NULL, population_count INTEGER NOT NULL, operation_count INTEGER NOT NULL, immutable_bytes INTEGER NOT NULL, metadata_bytes INTEGER NOT NULL, pending_operation TEXT, phase TEXT NOT NULL CHECK (phase IN ('prepared', 'active')), activation_operation TEXT, activation_hash TEXT, migration_manifest_hash TEXT, legacy_seal TEXT CHECK (legacy_seal IS NULL OR length(legacy_seal) <= 4096))`,
  usage_contribution_populations: `CREATE TABLE usage_contribution_populations (id TEXT PRIMARY KEY NOT NULL, generation TEXT NOT NULL, device_id TEXT NOT NULL, writer_revision INTEGER NOT NULL, revision INTEGER NOT NULL, head_hash TEXT NOT NULL, member_count INTEGER NOT NULL) WITHOUT ROWID`,
  usage_contribution_heads: `CREATE TABLE usage_contribution_heads (id TEXT PRIMARY KEY NOT NULL, head_hash TEXT NOT NULL, payload_hash TEXT, reference TEXT CHECK (reference IS NULL OR length(reference) <= 1024), members INTEGER NOT NULL, deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)), legacy_support INTEGER NOT NULL CHECK (legacy_support IN (0, 1)), suppressed_legacy INTEGER NOT NULL CHECK (suppressed_legacy IN (0, 1))) WITHOUT ROWID`,
  usage_contribution_memberships: `CREATE TABLE usage_contribution_memberships (population_id TEXT NOT NULL, id TEXT NOT NULL, head_hash TEXT NOT NULL, PRIMARY KEY (population_id, id)) WITHOUT ROWID`,
  usage_contribution_operations: `CREATE TABLE usage_contribution_operations (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('batch', 'grant', 'activation', 'migration')), body_hash TEXT NOT NULL, body_bytes INTEGER NOT NULL, metadata_bytes INTEGER NOT NULL, device_id TEXT NOT NULL, generation TEXT NOT NULL, population_id TEXT, sequence INTEGER NOT NULL, expected_revision INTEGER NOT NULL, metadata TEXT NOT NULL CHECK (length(metadata) <= 4096), outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'committed', 'abandoned', 'granted', 'activated', 'migrated')), terminal TEXT CHECK (terminal IS NULL OR length(terminal) <= 4096), published_revision INTEGER UNIQUE, delta_hash TEXT, delta_count INTEGER) WITHOUT ROWID`,
  usage_contribution_devices: `CREATE TABLE usage_contribution_devices (generation TEXT NOT NULL, device_id TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY (generation, device_id)) WITHOUT ROWID`,
});
type StoredControl = ContributionControl & Readonly<{ metadataBytes: number; pendingOperation: string | null }>;
export type ContributionIntent = Readonly<{
  operationId: string; accountId: string; generation: string; deviceId: string; populationId: string | null;
  bodyHash: string; byteLength: number; sequence: number; expectedRevision: number; metadataBytes: number;
  deltaManifestHash: string | null; deltaBytes: number; deltaCount: number;
}>;
export type { ContributionGrantReceipt } from "../../../lib/usage/contributions";
type StoredOperation = Readonly<{
  kind: "batch" | "grant" | "activation" | "migration"; intent: ContributionIntent; outcome: "pending" | "committed" | "abandoned" | "granted" | "activated" | "migrated";
  terminal: ContributionTerminal | ContributionGrantReceipt | ContributionActivationReceipt | ContributionMigrationReceipt | null; publishedRevision: number | null;
  deltaHash: string | null; deltaCount: number | null;
}>;
export type ContributionReservation = Readonly<{ intent: ContributionIntent; objectKey: string; terminal: ContributionTerminal | null }>;
type CancelledBeforeReserve = Omit<ContributionIntent, "deltaManifestHash" | "deltaBytes" | "deltaCount"> & Readonly<{
  mode: "cancelled-before-reserve"; writerRevision: number; expectedPopulationRevision: number;
  expectedPopulationHead: string; cancellationExpectedRevision: number;
}>;
type OwnerStorage = Pick<DurableObjectStorage, "sql" | "transactionSync">;
function invariant(value: unknown): asserts value { if (!value) throw new ContributionFault("storage_invalid"); }
function json(value: SqlStorageValue): unknown {
  invariant(typeof value === "string" && value.length <= 4_096);
  try { return JSON.parse(value) as unknown; } catch { throw new ContributionFault("storage_invalid"); }
}
function populationValue(value: unknown): ContributionPopulation | null {
  try {
    const raw = statsOwnRecord(value, ["id", "generation", "deviceId", "writerRevision", "revision", "headHash", "memberCount"]);
    return raw && contributionIdentity(raw.id) && contributionIdentity(raw.generation) && contributionIdentity(raw.deviceId)
      && statsInteger(raw.writerRevision, 1, CONTRIBUTION_MAX_OPERATIONS) && statsInteger(raw.revision, 0, CONTRIBUTION_MAX_OPERATIONS)
      && contributionHex(raw.headHash) && statsInteger(raw.memberCount, 0, CONTRIBUTION_MAX_MEMBERS)
      && ((raw.revision === 0) === (raw.headHash === CONTRIBUTION_ZERO_HASH))
      ? { id: raw.id, generation: raw.generation, deviceId: raw.deviceId, writerRevision: raw.writerRevision,
        revision: raw.revision, headHash: raw.headHash, memberCount: raw.memberCount } : null;
  } catch { return null; }
}
function terminalValue(value: unknown): ContributionTerminal | null {
  const committed = statsOwnRecord(value, ["outcome", "receipt"]);
  if (committed?.outcome === "committed") {
    const receipt = parseContributionReceipt(committed.receipt);
    return receipt ? { outcome: "committed", receipt } : null;
  }
  const abandoned = statsOwnRecord(value, ["outcome", "operationId", "bodyHash", "revision"]);
  return abandoned?.outcome === "abandoned" && contributionIdentity(abandoned.operationId) && contributionIdentity(abandoned.bodyHash)
    && statsInteger(abandoned.revision, 1, CONTRIBUTION_MAX_OPERATIONS)
    ? { outcome: "abandoned", operationId: abandoned.operationId, bodyHash: abandoned.bodyHash, revision: abandoned.revision } : null;
}

function cancelledBeforeReserve(value: unknown): CancelledBeforeReserve | null {
  const raw = statsOwnRecord(value, ["mode", "operationId", "accountId", "generation", "deviceId", "populationId", "bodyHash",
    "byteLength", "sequence", "expectedRevision", "metadataBytes", "writerRevision", "expectedPopulationRevision", "expectedPopulationHead", "cancellationExpectedRevision"]);
  if (!raw || raw.mode !== "cancelled-before-reserve" || !contributionIdentity(raw.operationId) || !contributionAccount(raw.accountId)
    || !contributionIdentity(raw.generation) || !contributionIdentity(raw.deviceId) || !contributionIdentity(raw.populationId)
    || !contributionIdentity(raw.bodyHash) || !statsInteger(raw.byteLength, 1, CONTRIBUTION_MAX_BYTES)
    || !statsInteger(raw.sequence, 1, Number.MAX_SAFE_INTEGER) || !statsInteger(raw.expectedRevision, 0, CONTRIBUTION_MAX_OPERATIONS - 1)
    || raw.metadataBytes !== METADATA_BASE || !statsInteger(raw.writerRevision, 1, CONTRIBUTION_MAX_OPERATIONS)
    || !statsInteger(raw.expectedPopulationRevision, 0, CONTRIBUTION_MAX_OPERATIONS) || !contributionHex(raw.expectedPopulationHead)
    || !statsInteger(raw.cancellationExpectedRevision, raw.expectedRevision, CONTRIBUTION_MAX_OPERATIONS - 1)) return null;
  return { mode: "cancelled-before-reserve", operationId: raw.operationId, accountId: raw.accountId, generation: raw.generation,
    deviceId: raw.deviceId, populationId: raw.populationId, bodyHash: raw.bodyHash, byteLength: raw.byteLength, sequence: raw.sequence,
    expectedRevision: raw.expectedRevision, metadataBytes: METADATA_BASE, writerRevision: raw.writerRevision,
    expectedPopulationRevision: raw.expectedPopulationRevision, expectedPopulationHead: raw.expectedPopulationHead,
    cancellationExpectedRevision: raw.cancellationExpectedRevision };
}

/** Constructors and read methods are pure. Only explicit fenced maintenance may
 * initialize. The AccountEnrollment owner authenticates and checks its retained
 * execution registration before each synchronous mutation, including commit
 * after every R2/projection await. Each mutation owns one atomic DO transaction. */
export class ContributionState {
  constructor(readonly storage: OwnerStorage) {}
  get sql(): SqlStorage { return this.storage.sql; }
  initialize(accountId: string, generation: string): void {
    if (!contributionAccount(accountId) || !contributionIdentity(generation)) throw new ContributionFault("invalid_input");
    this.storage.transactionSync(() => {
      for (const definition of Object.values(CONTRIBUTION_SCHEMA)) this.sql.exec(definition);
      this.sql.exec("INSERT INTO usage_contribution_control VALUES (1, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 'prepared', NULL, NULL, NULL, NULL)", accountId, generation);
    });
  }
  control(): StoredControl {
    const rows = this.sql.exec("SELECT * FROM usage_contribution_control LIMIT 2").toArray(), row = rows[0];
    invariant(rows.length === 1 && row.id === 1 && contributionAccount(row.account_id) && contributionIdentity(row.generation)
      && statsInteger(row.revision, 0, CONTRIBUTION_MAX_OPERATIONS) && statsInteger(row.updated_at_ms, 0, CONTRIBUTION_MAX_TIME)
      && statsInteger(row.head_count, 0, CONTRIBUTION_MAX_HEADS) && statsInteger(row.membership_count, 0, CONTRIBUTION_MAX_ASSOCIATIONS)
      && statsInteger(row.population_count, 0, CONTRIBUTION_MAX_POPULATIONS) && statsInteger(row.operation_count, 0, CONTRIBUTION_MAX_OPERATIONS)
      && statsInteger(row.immutable_bytes, 0, CONTRIBUTION_MAX_IMMUTABLE_BYTES) && statsInteger(row.metadata_bytes, 0, CONTRIBUTION_MAX_METADATA_BYTES)
      && (row.pending_operation === null || contributionIdentity(row.pending_operation))
      && ((row.phase === "prepared" && row.activation_operation === null && row.activation_hash === null && row.migration_manifest_hash === null)
        || (row.phase === "active" && contributionIdentity(row.activation_operation) && contributionIdentity(row.activation_hash)
          && (row.migration_manifest_hash === null || contributionIdentity(row.migration_manifest_hash)))));
    const legacySeal = row.legacy_seal === null ? null : parseContributionLegacySeal(json(row.legacy_seal));
    invariant(row.legacy_seal === null ? row.migration_manifest_hash === null : legacySeal && row.phase === "active" && contributionIdentity(row.migration_manifest_hash)
      && legacySeal.accountId === row.account_id && legacySeal.generation === row.generation && legacySeal.v1HeadCount <= row.head_count);
    return { accountId: row.account_id, generation: row.generation, revision: row.revision, updatedAtMs: row.updated_at_ms,
      headCount: row.head_count, membershipCount: row.membership_count, populationCount: row.population_count,
      operationCount: row.operation_count, immutableBytes: row.immutable_bytes, metadataBytes: row.metadata_bytes, pendingOperation: row.pending_operation,
      phase: row.phase as "prepared" | "active", activationOperationId: row.activation_operation as string | null,
      activationHash: row.activation_hash as string | null, migrationManifestHash: row.migration_manifest_hash as string | null, legacySeal };
  }
  population(id: string): ContributionPopulation | null {
    if (!contributionIdentity(id)) throw new ContributionFault("invalid_input");
    const rows = this.sql.exec("SELECT * FROM usage_contribution_populations WHERE id = ? LIMIT 2", id).toArray(), row = rows[0];
    invariant(rows.length <= 1);
    if (!row) return null;
    const result = populationValue({ id: row.id, generation: row.generation, deviceId: row.device_id, writerRevision: row.writer_revision,
      revision: row.revision, headHash: row.head_hash, memberCount: row.member_count });
    invariant(result); return result;
  }
  head(id: string): ContributionHead | null {
    if (!contributionIdentity(id, 32)) throw new ContributionFault("invalid_input");
    const rows = this.sql.exec("SELECT * FROM usage_contribution_heads WHERE id = ? LIMIT 2", id).toArray(), row = rows[0];
    invariant(rows.length <= 1);
    if (!row) { const seal = this.control().legacySeal; return seal ? sealedLegacyHead(this.sql, id, seal) : null; }
    invariant(row.id === id && contributionIdentity(row.head_hash) && statsInteger(row.members, 0, CONTRIBUTION_MAX_POPULATIONS)
      && (row.deleted === 0 || row.deleted === 1) && (row.legacy_support === 0 || row.legacy_support === 1)
      && (row.suppressed_legacy === 0 || row.suppressed_legacy === 1));
    if (row.deleted === 1) {
      invariant(row.payload_hash === null && row.reference === null);
      return { id, headHash: row.head_hash, payloadHash: null, reference: null, members: row.members, deleted: true,
        legacySupport: row.legacy_support === 1, suppressedLegacy: row.suppressed_legacy === 1 };
    }
    const reference = parseContributionReference(json(row.reference));
    invariant(contributionIdentity(row.payload_hash) && reference && reference.payloadHash === row.payload_hash);
    return { id, headHash: row.head_hash, payloadHash: row.payload_hash, reference, members: row.members, deleted: false,
      legacySupport: row.legacy_support === 1, suppressedLegacy: row.suppressed_legacy === 1 };
  }
  membership(populationId: string, id: string): ContributionMembership | null {
    if (!contributionIdentity(populationId) || !contributionIdentity(id, 32)) throw new ContributionFault("invalid_input");
    const rows = this.sql.exec("SELECT id, head_hash FROM usage_contribution_memberships WHERE population_id = ? AND id = ? LIMIT 2", populationId, id).toArray();
    invariant(rows.length <= 1);
    if (!rows.length) return null;
    invariant(rows[0].id === id && contributionIdentity(rows[0].head_hash)); return { id, headHash: rows[0].head_hash };
  }
  members(populationId: string): readonly ContributionMembership[] {
    if (!contributionIdentity(populationId)) throw new ContributionFault("invalid_input");
    const rows = this.sql.exec("SELECT id, head_hash FROM usage_contribution_memberships WHERE population_id = ? ORDER BY id LIMIT ?",
      populationId, CONTRIBUTION_MAX_MEMBERS + 1).toArray();
    invariant(rows.length <= CONTRIBUTION_MAX_MEMBERS);
    return rows.map(row => { invariant(contributionIdentity(row.id, 32) && contributionIdentity(row.head_hash)); return { id: row.id, headHash: row.head_hash }; });
  }
  sequence(generation: string, deviceId: string): number {
    if (!contributionIdentity(generation) || !contributionIdentity(deviceId)) throw new ContributionFault("invalid_input");
    const rows = this.sql.exec("SELECT sequence FROM usage_contribution_devices WHERE generation = ? AND device_id = ? LIMIT 2", generation, deviceId).toArray();
    invariant(rows.length <= 1 && (!rows.length || statsInteger(rows[0].sequence, 1, Number.MAX_SAFE_INTEGER)));
    return rows.length ? rows[0].sequence as number : 0;
  }
  operation(operationId: string): StoredOperation | null {
    if (!contributionIdentity(operationId)) throw new ContributionFault("invalid_input");
    const rows = this.sql.exec("SELECT * FROM usage_contribution_operations WHERE id = ? LIMIT 2", operationId).toArray(), row = rows[0];
    invariant(rows.length <= 1);
    if (!row) return null;
    const control = this.control();
    invariant(row.id === operationId && (row.kind === "batch" || row.kind === "grant" || row.kind === "activation" || row.kind === "migration") && contributionIdentity(row.body_hash)
      && statsInteger(row.body_bytes, row.kind === "batch" || row.kind === "migration" ? 1 : 0, row.kind === "batch" ? CONTRIBUTION_MAX_BYTES : row.kind === "migration" ? 16_777_216 : 0)
      && statsInteger(row.metadata_bytes, METADATA_BASE, CONTRIBUTION_MAX_METADATA_BYTES) && contributionIdentity(row.device_id)
      && contributionIdentity(row.generation) && (row.kind === "activation" || row.kind === "migration" ? row.population_id === null : contributionIdentity(row.population_id))
      && statsInteger(row.sequence, row.kind === "batch" ? 1 : 0, row.kind === "batch" ? Number.MAX_SAFE_INTEGER : 0)
      && statsInteger(row.expected_revision, 0, CONTRIBUTION_MAX_OPERATIONS - 1)
      && (row.published_revision === null || statsInteger(row.published_revision, 1, control.revision)));
    const metadata = json(row.metadata), cancellation = row.kind === "batch" ? cancelledBeforeReserve(metadata) : null;
    const migrationMetadata = row.kind === "migration" ? statsOwnRecord(metadata, ["request", "seal", "manifestHash", "deltaManifestHash", "deltaBytes", "deltaCount"]) : null;
    const batchMetadata = row.kind === "batch" ? statsOwnRecord(metadata, ["operationId", "accountId", "generation", "deviceId", "populationId", "bodyHash", "byteLength", "sequence", "expectedRevision", "metadataBytes", "deltaManifestHash", "deltaBytes", "deltaCount"]) : migrationMetadata;
    invariant(cancellation !== null || row.kind !== "batch" && row.kind !== "migration" || (batchMetadata && contributionIdentity(batchMetadata.deltaManifestHash)
      && statsInteger(batchMetadata.deltaBytes, 1, CONTRIBUTION_MIGRATION_MAX_SOURCE_BYTES) && statsInteger(batchMetadata.deltaCount, 0, CONTRIBUTION_MAX_HEADS)));
    const intent: ContributionIntent = { operationId, accountId: control.accountId, generation: row.generation, deviceId: row.device_id,
      populationId: row.population_id as string | null, bodyHash: row.body_hash, byteLength: row.body_bytes, sequence: row.sequence,
      expectedRevision: row.expected_revision, metadataBytes: row.metadata_bytes, deltaManifestHash: batchMetadata?.deltaManifestHash as string ?? null,
      deltaBytes: batchMetadata?.deltaBytes as number ?? 0, deltaCount: batchMetadata?.deltaCount as number ?? 0 };
    let terminal: StoredOperation["terminal"] = null;
    if (cancellation !== null) {
      // This terminal records only an exact refusal fence. No body or planned
      // journal was reserved, stored or verified. Empty published deltas are
      // authoritative; byteLength describes the cancelled body, not R2 usage.
      invariant(JSON.stringify(metadata) === JSON.stringify(cancellation) && cancellation.accountId === control.accountId
        && cancellation.operationId === operationId && cancellation.generation === row.generation && cancellation.deviceId === row.device_id
        && cancellation.populationId === row.population_id && cancellation.bodyHash === row.body_hash && cancellation.byteLength === row.body_bytes
        && cancellation.sequence === row.sequence && cancellation.expectedRevision === row.expected_revision
        && cancellation.metadataBytes === row.metadata_bytes && row.outcome === "abandoned"
        && row.published_revision === cancellation.cancellationExpectedRevision + 1 && control.pendingOperation !== operationId);
      const abandoned = terminalValue(json(row.terminal));
      invariant(abandoned?.outcome === "abandoned" && abandoned.operationId === operationId && abandoned.bodyHash === row.body_hash
        && abandoned.revision === row.published_revision);
      terminal = abandoned;
    } else if (row.kind === "migration") {
      const request = parseContributionMigrationRequest(migrationMetadata?.request), seal = parseContributionLegacySeal(migrationMetadata?.seal);
      invariant(request && seal && contributionIdentity(migrationMetadata?.manifestHash) && request.operationId === operationId
        && request.accountId === control.accountId && request.generation === row.generation && request.deviceId === row.device_id
        && request.expectedRevision === row.expected_revision && seal.accountId === request.accountId && seal.generation === request.generation
        && request.expectedV1Revision === seal.v1Revision && request.expectedV2Revision === seal.v2Revision
        && contributionHash(`aicharts:contribution-migration:v3\0${JSON.stringify(request)}\0${migrationMetadata.manifestHash}`) === row.body_hash);
      if (row.outcome === "pending") invariant(row.terminal === null && row.published_revision === null && control.pendingOperation === operationId);
      else if (row.outcome === "abandoned") {
        const abandoned = terminalValue(json(row.terminal));
        invariant(abandoned?.outcome === "abandoned" && abandoned.operationId === operationId && abandoned.bodyHash === row.body_hash && abandoned.revision === row.published_revision);
        terminal = abandoned;
      } else {
        const receipt = parseContributionMigrationReceipt(json(row.terminal));
        invariant(row.outcome === "migrated" && receipt && receipt.operationId === operationId && receipt.bodyHash === row.body_hash
          && receipt.accountId === request.accountId && receipt.generation === request.generation && receipt.deviceId === request.deviceId
          && receipt.expectedRevision === request.expectedRevision && receipt.expectedV1Revision === request.expectedV1Revision
          && receipt.expectedV2Revision === request.expectedV2Revision
          && receipt.manifestHash === migrationMetadata.manifestHash && receipt.deltaManifestHash === intent.deltaManifestHash
          && receipt.deltaCount === intent.deltaCount && receipt.revision === row.published_revision && receipt.headCount === seal.v1HeadCount
          && receipt.suppressedV1Heads === seal.suppressedV1Heads && receipt.unresolvedV2Bodies === seal.v2BodyCount);
        terminal = receipt;
      }
    } else if (row.kind === "activation") {
      const input = parseContributionActivationRequest(json(row.metadata));
      invariant(input && input.operationId === operationId && input.accountId === control.accountId && input.generation === row.generation
        && input.deviceId === row.device_id && input.expectedRevision === row.expected_revision && row.outcome === "activated"
        && contributionHash(`aicharts:contribution-activation:v3\0${JSON.stringify(input)}`) === row.body_hash);
      const expected = { ...input, bodyHash: row.body_hash, revision: row.published_revision };
      invariant(JSON.stringify(json(row.terminal)) === JSON.stringify(expected)); terminal = expected as ContributionActivationReceipt;
    } else if (row.kind === "grant") {
      const input = parseContributionGrant(json(row.metadata)), raw = statsOwnRecord(json(row.terminal), ["schemaVersion", "operationId", "bodyHash", "revision", "population"]);
      const population = raw ? populationValue(raw.population) : null;
      invariant(input && raw?.schemaVersion === 3 && raw.operationId === operationId && raw.bodyHash === row.body_hash
        && raw.revision === row.published_revision && population && population.id === row.population_id && row.outcome === "granted"
        && contributionHash(`aicharts:contribution-grant:v3\0${JSON.stringify(input)}`) === row.body_hash);
      terminal = { schemaVersion: 3, operationId, bodyHash: row.body_hash, revision: raw.revision as number, population };
    } else {
      invariant(JSON.stringify(metadata) === JSON.stringify(intent));
      if (row.outcome === "pending") invariant(row.terminal === null && row.published_revision === null && control.pendingOperation === operationId);
      else {
        terminal = terminalValue(json(row.terminal)); invariant(terminal && terminal.outcome === row.outcome);
        const identity = terminal.outcome === "committed" ? terminal.receipt : terminal;
        invariant(identity.operationId === operationId && identity.bodyHash === row.body_hash && identity.revision === row.published_revision);
        if (terminal.outcome === "committed") invariant(terminal.receipt.accountId === control.accountId
          && terminal.receipt.generation === row.generation && terminal.receipt.deviceId === row.device_id
          && terminal.receipt.sequence === row.sequence && terminal.receipt.populationId === row.population_id);
      }
    }
    invariant(((row.outcome === "committed" || row.outcome === "migrated") && row.delta_hash === intent.deltaManifestHash && row.delta_count === intent.deltaCount)
      || (row.outcome !== "committed" && row.outcome !== "migrated" && row.delta_hash === null && row.delta_count === null));
    return { kind: row.kind, intent, outcome: row.outcome as StoredOperation["outcome"], terminal, publishedRevision: row.published_revision as number | null,
      deltaHash: row.delta_hash as string | null, deltaCount: row.delta_count as number | null };
  }
  #capacity(control: StoredControl, bodyBytes: number, metadataBytes: number): void {
    if (control.revision >= CONTRIBUTION_MAX_OPERATIONS || control.operationCount >= CONTRIBUTION_MAX_OPERATIONS
      || control.immutableBytes + bodyBytes > CONTRIBUTION_MAX_IMMUTABLE_BYTES
      || control.metadataBytes + metadataBytes > CONTRIBUTION_MAX_METADATA_BYTES) throw new ContributionFault("limit");
  }
  #writePopulation(population: ContributionPopulation): void {
    this.sql.exec("INSERT INTO usage_contribution_populations VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation, device_id=excluded.device_id, writer_revision=excluded.writer_revision, revision=excluded.revision, head_hash=excluded.head_hash, member_count=excluded.member_count",
      population.id, population.generation, population.deviceId, population.writerRevision, population.revision, population.headHash, population.memberCount);
  }
  #plan(control: StoredControl, batch: ContributionBatch, authority: ContributionAuthority): ContributionPlan {
    const population = this.population(batch.populationId);
    if (!population) throw new ContributionFault("writer_conflict");
    return planContribution({ control, population, head: id => this.head(id), membership: id => this.membership(batch.populationId, id),
      members: () => this.members(batch.populationId) }, batch, authority);
  }
  check(batch: ContributionBatch, authority: ContributionAuthority): ContributionPlan { return this.#plan(this.control(), batch, authority); }
  deltaBundle(batch: ContributionBatch, authority: ContributionAuthority): ContributionJournalBundle {
    const plan = this.check(batch, authority);
    return contributionDeltaBundle({ accountId: batch.accountId, generation: batch.generation, operationId: batch.operationId,
      bodyHash: plan.receipt.bodyHash, previousRevision: batch.expectedRevision, revision: batch.expectedRevision + 1 }, plan.deltas);
  }
  #terminalSequence(intent: ContributionIntent): void {
    if (intent.sequence === 0) return;
    invariant(this.sequence(intent.generation, intent.deviceId) + 1 === intent.sequence);
    this.sql.exec("INSERT INTO usage_contribution_devices VALUES (?, ?, ?) ON CONFLICT(generation, device_id) DO UPDATE SET sequence=excluded.sequence",
      intent.generation, intent.deviceId, intent.sequence);
  }
  reserveMigration(request: ContributionMigrationRequest, snapshot: ContributionMigrationSnapshot,
    authority: ContributionAuthority): ContributionMigrationBundle {
    if (!parseContributionMigrationRequest(request)) throw new ContributionFault("invalid_input");
    const bundle = contributionMigrationBundle(request, snapshot);
    return this.storage.transactionSync(() => {
      const control = this.control(); checkContributionAuthority(control, authority, request.deviceId);
      const existing = this.operation(request.operationId);
      if (existing) {
        if (existing.kind !== "migration" || existing.intent.bodyHash !== bundle.bodyHash || existing.outcome !== "pending") throw new ContributionFault("conflict");
        return bundle;
      }
      if (control.phase !== "prepared" || control.pendingOperation !== null || control.revision !== request.expectedRevision
        || control.headCount !== 0 || control.membershipCount !== 0) throw new ContributionFault("conflict");
      if (request.accountId !== control.accountId || request.generation !== control.generation) throw new ContributionFault("generation_conflict");
      this.#capacity(control, bundle.byteLength + snapshot.seal.immutableBytes, METADATA_BASE + snapshot.seal.metadataBytes);
      const metadata = { request, seal: snapshot.seal, manifestHash: snapshot.manifest.hash, deltaManifestHash: bundle.journal.artifact.hash,
        deltaBytes: bundle.journal.byteLength, deltaCount: bundle.journal.root.count };
      invariant(JSON.stringify(metadata).length <= 4_096 && bundle.byteLength <= CONTRIBUTION_MIGRATION_MAX_BUNDLE_BYTES);
      this.sql.exec("INSERT INTO usage_contribution_operations VALUES (?, 'migration', ?, ?, ?, ?, ?, NULL, 0, ?, ?, 'pending', NULL, NULL, NULL, NULL)",
        request.operationId, bundle.bodyHash, bundle.byteLength, METADATA_BASE, request.deviceId, request.generation, request.expectedRevision, JSON.stringify(metadata));
      // Reserve newly writable artifacts now; legacy bytes already exist and
      // are charged on cutover after a second exact capacity check.
      this.sql.exec("UPDATE usage_contribution_control SET operation_count=?, immutable_bytes=?, metadata_bytes=?, pending_operation=?, updated_at_ms=? WHERE id=1",
        control.operationCount + 1, control.immutableBytes + bundle.byteLength, control.metadataBytes + METADATA_BASE, request.operationId, authority.observedAtMs);
      return bundle;
    });
  }
  commitMigration(bundle: ContributionMigrationBundle, verified: VerifiedContributionMigration, authority: ContributionAuthority,
    recapture: () => ContributionMigrationSnapshot): ContributionMigrationReceipt {
    return this.storage.transactionSync(() => {
      const control = this.control(), request = bundle.request; checkContributionAuthority(control, authority, request.deviceId);
      const operation = this.operation(request.operationId);
      if (!operation || operation.kind !== "migration" || operation.intent.bodyHash !== bundle.bodyHash) throw new ContributionFault("conflict");
      if (operation.outcome === "migrated") return operation.terminal as ContributionMigrationReceipt;
      if (operation.outcome !== "pending" || control.phase !== "prepared" || control.revision !== request.expectedRevision
        || control.pendingOperation !== request.operationId) throw new ContributionFault("conflict");
      invariant(isVerifiedContributionMigration(verified) && verified.bodyHash === bundle.bodyHash && verified.manifestHash === bundle.snapshot.manifest.hash
        && verified.byteLength === operation.intent.byteLength && verified.journal.hash === operation.intent.deltaManifestHash
        && verified.journal.count === operation.intent.deltaCount && verified.journal.byteLength === operation.intent.deltaBytes);
      const current = recapture();
      if (current.manifest.hash !== bundle.snapshot.manifest.hash || JSON.stringify(current.seal) !== JSON.stringify(bundle.snapshot.seal)) throw new ContributionFault("conflict");
      const repeated = contributionMigrationBundle(request, current);
      invariant(repeated.bodyHash === bundle.bodyHash && repeated.journal.artifact.hash === verified.journal.hash && repeated.byteLength === verified.byteLength);
      if (control.immutableBytes + current.seal.immutableBytes > CONTRIBUTION_MAX_IMMUTABLE_BYTES
        || control.metadataBytes + current.seal.metadataBytes > CONTRIBUTION_MAX_METADATA_BYTES
        || current.seal.v1HeadCount > CONTRIBUTION_MAX_HEADS) throw new ContributionFault("limit");
      const receipt: ContributionMigrationReceipt = { ...request, bodyHash: bundle.bodyHash, revision: control.revision + 1,
        manifestHash: current.manifest.hash, deltaManifestHash: repeated.journal.artifact.hash, deltaCount: repeated.journal.root.count,
        headCount: current.seal.v1HeadCount, suppressedV1Heads: current.seal.suppressedV1Heads, unresolvedV2Bodies: current.seal.v2BodyCount };
      this.sql.exec("UPDATE usage_contribution_operations SET outcome='migrated', terminal=?, published_revision=?, delta_hash=?, delta_count=? WHERE id=? AND outcome='pending'",
        JSON.stringify(receipt), receipt.revision, receipt.deltaManifestHash, receipt.deltaCount, request.operationId);
      this.sql.exec("UPDATE usage_contribution_control SET revision=?, updated_at_ms=?, head_count=?, immutable_bytes=?, metadata_bytes=?, pending_operation=NULL, phase='active', activation_operation=?, activation_hash=?, migration_manifest_hash=?, legacy_seal=? WHERE id=1",
        receipt.revision, authority.observedAtMs, current.seal.v1HeadCount, control.immutableBytes + current.seal.immutableBytes,
        control.metadataBytes + current.seal.metadataBytes, request.operationId, bundle.bodyHash, current.manifest.hash, JSON.stringify(current.seal));
      clearMigrationScratch(this.sql);
      return receipt;
    });
  }
  /** This callback must examine actual V1/V2 controls, journals, tombstones and
   * pending decisions in the same owner transaction. Empty aggregate totals or
   * an absent optional table are not evidence that legacy authority is empty.
   * Populated accounts use the separately verified retained migration path. */
  activateFresh(value: ContributionActivationRequest, authority: ContributionAuthority,
    legacyIsEmpty: () => boolean): ContributionActivationReceipt {
    const request = parseContributionActivationRequest(value);
    if (!request) throw new ContributionFault("invalid_input");
    return this.storage.transactionSync(() => {
      const control = this.control(); checkContributionAuthority(control, authority, request.deviceId);
      if (request.accountId !== control.accountId || request.generation !== control.generation) throw new ContributionFault("generation_conflict");
      const bodyHash = contributionHash(`aicharts:contribution-activation:v3\0${JSON.stringify(request)}`), existing = this.operation(request.operationId);
      if (existing) {
        if (existing.kind !== "activation" || existing.intent.bodyHash !== bodyHash) throw new ContributionFault("conflict");
        return existing.terminal as ContributionActivationReceipt;
      }
      if (control.phase !== "prepared" || control.revision !== request.expectedRevision || control.pendingOperation !== null)
        throw new ContributionFault("conflict");
      this.#capacity(control, 0, METADATA_BASE);
      if (legacyIsEmpty() !== true || control.headCount !== 0 || control.membershipCount !== 0) throw new ContributionFault("recovery_required");
      const receipt: ContributionActivationReceipt = { ...request, bodyHash, revision: control.revision + 1 };
      this.sql.exec("INSERT INTO usage_contribution_operations VALUES (?, 'activation', ?, 0, ?, ?, ?, NULL, 0, ?, ?, 'activated', ?, ?, NULL, NULL)",
        request.operationId, bodyHash, METADATA_BASE, request.deviceId, request.generation, request.expectedRevision,
        JSON.stringify(request), JSON.stringify(receipt), receipt.revision);
      this.sql.exec("UPDATE usage_contribution_control SET revision=?, updated_at_ms=?, operation_count=?, metadata_bytes=?, phase='active', activation_operation=?, activation_hash=? WHERE id=1",
        receipt.revision, authority.observedAtMs, control.operationCount + 1, control.metadataBytes + METADATA_BASE, request.operationId, bodyHash);
      return receipt;
    });
  }
  /** Fresh account authority must independently establish that the predecessor
   * is durably revoked. Transfer preserves all previous memberships and bytes.
   * Optional abandonment names exactly the pending revoked predecessor intent. */
  grantPopulation(value: ContributionGrant, authority: ContributionAuthority & Readonly<{ previousWriterRevoked: boolean }>): ContributionGrantReceipt {
    const request = parseContributionGrant(value);
    if (!request) throw new ContributionFault("invalid_input");
    return this.storage.transactionSync(() => {
      const control = this.control(); checkContributionAuthority(control, authority, request.deviceId);
      if (request.accountId !== control.accountId || request.generation !== control.generation) throw new ContributionFault("generation_conflict");
      const bodyHash = contributionHash(`aicharts:contribution-grant:v3\0${JSON.stringify(request)}`), existing = this.operation(request.operationId);
      if (existing) {
        if (existing.kind !== "grant" || existing.intent.bodyHash !== bodyHash) throw new ContributionFault("conflict");
        return existing.terminal as ContributionGrantReceipt;
      }
      if (control.revision !== request.expectedRevision) throw new ContributionFault("conflict");
      this.#capacity(control, 0, METADATA_BASE);
      const previous = this.population(request.populationId);
      if (previous ? previous.deviceId !== request.previousDeviceId || previous.writerRevision !== request.expectedWriterRevision
        || !authority.previousWriterRevoked || (previous.deviceId === request.deviceId && previous.generation === request.generation)
        : request.previousDeviceId !== null || control.populationCount >= CONTRIBUTION_MAX_POPULATIONS) throw new ContributionFault("writer_conflict");
      const nextRevision = control.revision + 1;
      if (control.pendingOperation !== null) {
        const pending = this.operation(control.pendingOperation);
        if (request.abandonOperationId !== control.pendingOperation || !pending || pending.outcome !== "pending"
          || pending.intent.deviceId !== request.previousDeviceId || pending.intent.populationId !== request.populationId)
          throw new ContributionFault("conflict");
        // One journal revision belongs to each terminal operation. The grant is
        // the next revision, so no terminal result ever changes on later retry.
        if (nextRevision >= CONTRIBUTION_MAX_OPERATIONS) throw new ContributionFault("limit");
        this.#abandon(pending.intent, nextRevision);
      } else if (request.abandonOperationId !== null) throw new ContributionFault("conflict");
      const revision = nextRevision + (control.pendingOperation === null ? 0 : 1);
      const population: ContributionPopulation = { id: request.populationId, generation: request.generation, deviceId: request.deviceId,
        writerRevision: (previous?.writerRevision ?? 0) + 1, revision: previous?.revision ?? 0,
        headHash: previous?.headHash ?? CONTRIBUTION_ZERO_HASH, memberCount: previous?.memberCount ?? 0 };
      const receipt: ContributionGrantReceipt = { schemaVersion: 3, operationId: request.operationId, bodyHash, revision, population };
      this.#writePopulation(population);
      this.sql.exec("INSERT INTO usage_contribution_operations VALUES (?, 'grant', ?, 0, ?, ?, ?, ?, 0, ?, ?, 'granted', ?, ?, NULL, NULL)",
        request.operationId, bodyHash, METADATA_BASE, request.deviceId, request.generation, request.populationId, request.expectedRevision,
        JSON.stringify(request), JSON.stringify(receipt), revision);
      this.sql.exec("UPDATE usage_contribution_control SET revision=?, updated_at_ms=?, population_count=?, operation_count=?, metadata_bytes=?, pending_operation=NULL WHERE id=1",
        revision, authority.observedAtMs, control.populationCount + (previous ? 0 : 1), control.operationCount + 1, control.metadataBytes + METADATA_BASE);
      return receipt;
    });
  }
  reserve(value: ContributionBatch, authority: ContributionAuthority): ContributionReservation {
    const batch = parseContributionBatch(value);
    if (!batch) throw new ContributionFault("invalid_input");
    const text = contributionBatchText(batch), bodyHash = contributionHash(text), byteLength = new TextEncoder().encode(text).length;
    return this.storage.transactionSync(() => {
      const control = this.control(); checkContributionAuthority(control, authority, batch.deviceId);
      if (batch.accountId !== control.accountId || batch.generation !== control.generation) throw new ContributionFault("generation_conflict");
      const existing = this.operation(batch.operationId);
      if (existing) {
        if (existing.kind !== "batch" || existing.intent.bodyHash !== bodyHash) throw new ContributionFault("conflict");
        return { intent: existing.intent, objectKey: contributionObjectKey(batch.accountId, bodyHash), terminal: existing.terminal as ContributionTerminal | null };
      }
      if (control.pendingOperation !== null) throw new ContributionFault("conflict");
      if (batch.sequence !== this.sequence(batch.generation, batch.deviceId) + 1) throw new ContributionFault("conflict");
      const plan = this.#plan(control, batch, authority);
      const delta = contributionDeltaBundle({ accountId: batch.accountId, generation: batch.generation, operationId: batch.operationId,
        bodyHash, previousRevision: batch.expectedRevision, revision: batch.expectedRevision + 1 }, plan.deltas);
      const metadataBytes = METADATA_BASE + METADATA_PER_MUTATION * (batch.mutations.length + plan.removals.length);
      this.#capacity(control, byteLength + delta.byteLength, metadataBytes);
      const intent: ContributionIntent = { operationId: batch.operationId, accountId: batch.accountId, generation: batch.generation,
        deviceId: batch.deviceId, populationId: batch.populationId, bodyHash, byteLength, sequence: batch.sequence,
        expectedRevision: batch.expectedRevision, metadataBytes, deltaManifestHash: delta.artifact.hash, deltaBytes: delta.byteLength, deltaCount: delta.root.count };
      this.sql.exec("INSERT INTO usage_contribution_operations VALUES (?, 'batch', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL)",
        intent.operationId, bodyHash, byteLength, metadataBytes, intent.deviceId, intent.generation, intent.populationId,
        intent.sequence, intent.expectedRevision, JSON.stringify(intent));
      this.sql.exec("UPDATE usage_contribution_control SET operation_count=?, immutable_bytes=?, metadata_bytes=?, pending_operation=?, updated_at_ms=? WHERE id=1",
        control.operationCount + 1, control.immutableBytes + byteLength + delta.byteLength, control.metadataBytes + metadataBytes, batch.operationId, authority.observedAtMs);
      return { intent, objectKey: contributionObjectKey(batch.accountId, bodyHash), terminal: null };
    });
  }
  /** Verify/hydrate required immutable numeric bodies before entry. A projection
   * callback is synchronous and runs in this transaction; throwing rolls back
   * journal, heads, associations, and derived publication together. */
  commit(batch: ContributionBatch, body: VerifiedContributionBody, authority: ContributionAuthority,
    journal: VerifiedContributionJournal,
    publishProjection: (deltas: readonly ContributionDelta[], receipt: ContributionReceipt) => undefined = () => undefined): ContributionTerminal {
    if (!isVerifiedContributionBody(body) || body.accountId !== batch.accountId || body.bodyHash !== contributionBodyHash(batch)
      || body.byteLength !== new TextEncoder().encode(contributionBatchText(batch)).length) throw new ContributionFault("storage_invalid");
    return this.storage.transactionSync(() => {
      const control = this.control(); checkContributionAuthority(control, authority, batch.deviceId);
      if (batch.accountId !== control.accountId || batch.generation !== control.generation) throw new ContributionFault("generation_conflict");
      const operation = this.operation(batch.operationId);
      if (!operation || operation.kind !== "batch") throw new ContributionFault("not_started");
      if (operation.intent.bodyHash !== body.bodyHash || operation.intent.byteLength !== body.byteLength) throw new ContributionFault("conflict");
      if (operation.terminal) return operation.terminal as ContributionTerminal;
      const plan = this.#plan(control, batch, authority);
      const delta = contributionDeltaBundle({ accountId: batch.accountId, generation: batch.generation, operationId: batch.operationId,
        bodyHash: plan.receipt.bodyHash, previousRevision: batch.expectedRevision, revision: batch.expectedRevision + 1 }, plan.deltas);
      invariant(isVerifiedContributionJournal(journal) && journal.accountId === batch.accountId && journal.hash === delta.artifact.hash
        && journal.hash === operation.intent.deltaManifestHash && journal.byteLength === operation.intent.deltaBytes
        && journal.count === operation.intent.deltaCount && delta.byteLength === journal.byteLength);
      for (const head of plan.heads) this.sql.exec("INSERT INTO usage_contribution_heads VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET head_hash=excluded.head_hash, payload_hash=excluded.payload_hash, reference=excluded.reference, members=excluded.members, deleted=excluded.deleted, legacy_support=excluded.legacy_support, suppressed_legacy=excluded.suppressed_legacy",
        head.id, head.headHash, head.payloadHash, head.reference === null ? null : JSON.stringify(head.reference), head.members, head.deleted ? 1 : 0, head.legacySupport ? 1 : 0, head.suppressedLegacy ? 1 : 0);
      for (const id of plan.removals) this.sql.exec("DELETE FROM usage_contribution_memberships WHERE population_id=? AND id=?", batch.populationId, id);
      for (const member of plan.memberships) this.sql.exec("INSERT INTO usage_contribution_memberships VALUES (?, ?, ?) ON CONFLICT(population_id, id) DO UPDATE SET head_hash=excluded.head_hash",
        batch.populationId, member.id, member.headHash);
      this.#writePopulation(plan.population); this.#terminalSequence(operation.intent);
      const terminal: ContributionTerminal = { outcome: "committed", receipt: plan.receipt };
      this.sql.exec("UPDATE usage_contribution_operations SET outcome='committed', terminal=?, published_revision=?, delta_hash=?, delta_count=? WHERE id=? AND outcome='pending'",
        JSON.stringify(terminal), plan.receipt.revision, delta.artifact.hash, plan.deltas.length, batch.operationId);
      this.sql.exec("UPDATE usage_contribution_control SET revision=?, updated_at_ms=?, head_count=?, membership_count=?, pending_operation=NULL WHERE id=1",
        plan.receipt.revision, authority.observedAtMs, plan.headCount, plan.membershipCount);
      const continuation: unknown = publishProjection(plan.deltas, plan.receipt);
      if (continuation !== undefined) throw new ContributionFault("storage_invalid");
      return terminal;
    });
  }
  #abandon(intent: ContributionIntent, revision: number): ContributionTerminal {
    const terminal: ContributionTerminal = { outcome: "abandoned", operationId: intent.operationId, bodyHash: intent.bodyHash, revision };
    this.#terminalSequence(intent);
    this.sql.exec("UPDATE usage_contribution_operations SET outcome='abandoned', terminal=?, published_revision=? WHERE id=? AND outcome='pending'",
      JSON.stringify(terminal), revision, intent.operationId);
    return terminal;
  }
  #cancellation(value: ContributionCancelRequest, authority: ContributionAuthority) {
    const request = parseContributionCancelRequest(value);
    if (!request) throw new ContributionFault("invalid_input");
    const batch = request.batch, control = this.control(); checkContributionAuthority(control, authority, batch.deviceId);
    if (batch.accountId !== control.accountId || batch.generation !== control.generation) throw new ContributionFault("generation_conflict");
    const text = contributionBatchText(batch), bodyHash = contributionHash(text), byteLength = new TextEncoder().encode(text).length;
    const operation = this.operation(batch.operationId);
    if (operation && (operation.kind !== "batch" || operation.intent.bodyHash !== bodyHash || operation.intent.byteLength !== byteLength
      || operation.intent.deviceId !== batch.deviceId || operation.intent.generation !== batch.generation
      || operation.intent.populationId !== batch.populationId || operation.intent.sequence !== batch.sequence
      || operation.intent.expectedRevision !== batch.expectedRevision)) throw new ContributionFault("conflict");
    return { request, batch, control, bodyHash, byteLength, operation };
  }
  /** Pure exact-terminal lookup; no fresh writer/CAS decision is inferred from
   * this read. The admission owner still authenticates the current device. */
  cancellationTerminal(request: ContributionCancelRequest, authority: ContributionAuthority): ContributionTerminal | null {
    return this.#cancellation(request, authority).operation?.terminal as ContributionTerminal | null ?? null;
  }
  /** Cancel the exact frozen batch even when stale predecessors prevented its
   * reservation. One permanent terminal consumes its next device sequence and
   * an empty canonical revision. An absent reservation charges metadata only. */
  cancelBatch(value: ContributionCancelRequest, authority: ContributionAuthority): ContributionTerminal {
    return this.storage.transactionSync(() => {
      const { request, batch, control, bodyHash, byteLength, operation } = this.#cancellation(value, authority);
      if (operation?.terminal) return operation.terminal as ContributionTerminal;
      if (control.phase !== "active") throw new ContributionFault("recovery_required");
      if (control.revision !== request.expectedRevision || request.expectedRevision < batch.expectedRevision
        || (control.pendingOperation !== null && control.pendingOperation !== batch.operationId)) throw new ContributionFault("conflict");
      const population = this.population(batch.populationId);
      if (!population || population.deviceId !== batch.deviceId || population.generation !== batch.generation
        || population.writerRevision !== batch.writerRevision) throw new ContributionFault("writer_conflict");
      if (batch.sequence !== this.sequence(batch.generation, batch.deviceId) + 1) throw new ContributionFault("conflict");
      if (control.revision >= CONTRIBUTION_MAX_OPERATIONS) throw new ContributionFault("limit");
      const revision = control.revision + 1;
      let terminal: ContributionTerminal;
      if (operation) {
        invariant(operation.outcome === "pending" && control.pendingOperation === batch.operationId);
        terminal = this.#abandon(operation.intent, revision);
      } else {
        invariant(control.pendingOperation === null);
        this.#capacity(control, 0, METADATA_BASE);
        const metadata: CancelledBeforeReserve = { mode: "cancelled-before-reserve", operationId: batch.operationId,
          accountId: batch.accountId, generation: batch.generation, deviceId: batch.deviceId, populationId: batch.populationId,
          bodyHash, byteLength, sequence: batch.sequence, expectedRevision: batch.expectedRevision, metadataBytes: METADATA_BASE,
          writerRevision: batch.writerRevision, expectedPopulationRevision: batch.expectedPopulationRevision,
          expectedPopulationHead: batch.expectedPopulationHead, cancellationExpectedRevision: request.expectedRevision };
        this.#terminalSequence({ ...metadata, deltaManifestHash: null, deltaBytes: 0, deltaCount: 0 });
        terminal = { outcome: "abandoned", operationId: batch.operationId, bodyHash, revision };
        this.sql.exec("INSERT INTO usage_contribution_operations VALUES (?, 'batch', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'abandoned', ?, ?, NULL, NULL)",
          batch.operationId, bodyHash, byteLength, METADATA_BASE, batch.deviceId, batch.generation, batch.populationId,
          batch.sequence, batch.expectedRevision, JSON.stringify(metadata), JSON.stringify(terminal), revision);
        this.sql.exec("UPDATE usage_contribution_control SET operation_count=?, metadata_bytes=? WHERE id=1",
          control.operationCount + 1, control.metadataBytes + METADATA_BASE);
      }
      this.sql.exec("UPDATE usage_contribution_control SET revision=?, updated_at_ms=?, pending_operation=NULL WHERE id=1", revision, authority.observedAtMs);
      return terminal;
    });
  }
  abandon(operationId: string, bodyHash: string, authority: ContributionAuthority): ContributionTerminal {
    if (!contributionIdentity(operationId) || !contributionIdentity(bodyHash)) throw new ContributionFault("invalid_input");
    return this.storage.transactionSync(() => {
      const control = this.control(), operation = this.operation(operationId);
      checkContributionAuthority(control, authority);
      if (!operation || (operation.kind !== "batch" && operation.kind !== "migration")) throw new ContributionFault("not_started");
      if (operation.intent.bodyHash !== bodyHash || operation.intent.deviceId !== authority.deviceId
        || operation.intent.generation !== authority.generation) throw new ContributionFault("conflict");
      if (operation.outcome === "migrated") throw new ContributionFault("conflict");
      if (operation.terminal) return operation.terminal as ContributionTerminal;
      if (control.revision >= CONTRIBUTION_MAX_OPERATIONS) throw new ContributionFault("limit");
      const terminal = this.#abandon(operation.intent, control.revision + 1);
      if (operation.kind === "migration") clearMigrationScratch(this.sql);
      this.sql.exec("UPDATE usage_contribution_control SET revision=?, updated_at_ms=?, pending_operation=NULL WHERE id=1", control.revision + 1, authority.observedAtMs);
      return terminal;
    });
  }
  /** Committed marker order is authoritative; R2 object presence alone is not.
   * The caller binds paging to a separately retained account/fence snapshot. */
  journal(afterRevision: number, limit: number): readonly StoredOperation[] {
    if (!statsInteger(afterRevision, 0, CONTRIBUTION_MAX_OPERATIONS) || !statsInteger(limit, 1, 256)) throw new ContributionFault("invalid_input");
    return this.sql.exec("SELECT id FROM usage_contribution_operations WHERE published_revision > ? ORDER BY published_revision LIMIT ?", afterRevision, limit)
      .toArray().map(row => { invariant(contributionIdentity(row.id)); const operation = this.operation(row.id); invariant(operation); return operation; });
  }
}
