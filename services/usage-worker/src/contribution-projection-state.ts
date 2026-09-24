import { contributionAccount, contributionHash, contributionIdentity, ContributionFault, CONTRIBUTION_MAX_OPERATIONS,
  CONTRIBUTION_MAX_TIME, type ContributionError } from "../../../lib/usage/contributions";
import { contributionIndexKey, contributionIndexStageHash, parseContributionIndexReference, readContributionIndexCells, stageContributionIndex,
  CONTRIBUTION_INDEX_MAX_IO_BYTES, type ContributionIndexLoader, type ContributionIndexReference, type ContributionIndexStage } from "../../../lib/usage/contribution-index";
import { contributionRowCellKey, planContributionRollups } from "../../../lib/usage/contribution-rollups";
import { statsInteger, statsOwnRecord } from "../../../lib/usage/stats-contract";
import { ContributionState } from "./contributions-state";
import { CONTRIBUTION_JOURNAL_MAX_ENTRIES } from "./contributions-journal";
import { isVerifiedContributionChunk, isVerifiedContributionRevision, readCommittedContributionRevision,
  CONTRIBUTION_REPLAY_CHUNK_ENTRIES, type CommittedContributionRevision, type ContributionReplayPhase,
  type VerifiedContributionChunk, type VerifiedContributionRevision } from "./contribution-replay";
import { isVerifiedContributionIndex, type VerifiedContributionIndex } from "./contribution-index-objects";

export const CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES = 4_294_967_296;
export const CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS = 64;
export const CONTRIBUTION_PROJECTION_RETIRE_MS = 930_000;
export const CONTRIBUTION_PROJECTION_PUBLISH_INTERVAL_MS = 16_000;
export const CONTRIBUTION_PROJECTION_MAX_CONTROL_BYTES = 8_192;
export const CONTRIBUTION_PROJECTION_SCHEMA = Object.freeze({
  usage_contribution_projection_control: `CREATE TABLE usage_contribution_projection_control (id INTEGER PRIMARY KEY CHECK (id = 1), account_id TEXT NOT NULL, generation TEXT NOT NULL, applied_revision INTEGER NOT NULL, applied_root TEXT CHECK (applied_root IS NULL OR length(applied_root) <= 2048), published_revision INTEGER NOT NULL, published_root TEXT CHECK (published_root IS NULL OR length(published_root) <= 2048), staged_source TEXT CHECK (staged_source IS NULL OR length(staged_source) <= 2048), staged_root TEXT CHECK (staged_root IS NULL OR length(staged_root) <= 2048), phase TEXT CHECK (phase IS NULL OR phase IN ('retract', 'add')), cursor INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, immutable_bytes INTEGER NOT NULL)`,
  usage_contribution_projection_pending: `CREATE TABLE usage_contribution_projection_pending (id INTEGER PRIMARY KEY CHECK (id = 1), plan_hash TEXT NOT NULL, metadata TEXT NOT NULL CHECK (length(metadata) <= 8192), write_bytes INTEGER NOT NULL)`,
  usage_contribution_projection_publications: `CREATE TABLE usage_contribution_projection_publications (revision INTEGER PRIMARY KEY NOT NULL, root TEXT CHECK (root IS NULL OR length(root) <= 2048), published_at_ms INTEGER NOT NULL, expires_at_ms INTEGER) WITHOUT ROWID`,
});
type Storage = Pick<DurableObjectStorage, "sql" | "transactionSync">;
export type ContributionProjectionAuthority = Readonly<{ accountId: string; generation: string; observedAtMs: number; active: boolean }>;
export type ContributionProjectionControl = Readonly<{
  accountId: string; generation: string; appliedRevision: number; appliedRoot: ContributionIndexReference | null;
  publishedRevision: number; publishedRoot: ContributionIndexReference | null;
  source: CommittedContributionRevision | null; stagedRoot: ContributionIndexReference | null; phase: ContributionReplayPhase | null;
  cursor: number; updatedAtMs: number; immutableBytes: number;
}>;
export type ContributionProjectionPublication = Readonly<{
  revision: number; root: ContributionIndexReference | null; publishedAtMs: number; expiresAtMs: number | null;
}>;
export type ContributionProjectionStatus = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; sourceRevision: number; appliedRevision: number; publishedRevision: number;
  appliedLag: number; publishedLag: number; lag: number;
  nextPublicationAtMs: number | null; publicationWait: "interval" | "retention" | "clock_limit" | null;
  staged: Readonly<{ revision: number; phase: ContributionReplayPhase; cursor: number; count: number }> | null;
  pending: boolean; immutableBytes: number; refusal: ContributionError | null;
}>;
type Step = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; source: CommittedContributionRevision; appliedRevision: number;
  previousRoot: ContributionIndexReference | null; phase: ContributionReplayPhase; cursor: number; consumed: number;
  entriesHash: string; root: ContributionIndexReference | null; stageHash: string; writeBytes: number;
}>;
export type ContributionProjectionPending = Readonly<{ hash: string; step: Step }>;
export type ContributionProjectionPlan = Readonly<{ pending: ContributionProjectionPending; stage: ContributionIndexStage }>;
const checkedControls = new WeakSet<object>(), ownedPlans = new WeakSet<object>();
const invariant = (value: unknown): void => { if (!value) throw new ContributionFault("storage_invalid"); };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const encode = (value: unknown) => value === null ? null : JSON.stringify(value);
function json(value: SqlStorageValue): unknown {
  invariant(typeof value === "string" && value.length <= CONTRIBUTION_PROJECTION_MAX_CONTROL_BYTES);
  try { return JSON.parse(value as string) as unknown; } catch { throw new ContributionFault("storage_invalid"); }
}
function reference(value: unknown): ContributionIndexReference | null {
  const result = value === null ? null : parseContributionIndexReference(value);
  if (value !== null && !result) throw new ContributionFault("storage_invalid"); return result;
}
function sourceValue(value: unknown): CommittedContributionRevision {
  const raw = statsOwnRecord(value, ["accountId", "generation", "revision", "operationId", "bodyHash", "deltaManifestHash", "deltaCount"]);
  if (!raw || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation) || !contributionIdentity(raw.operationId)
    || !contributionIdentity(raw.bodyHash) || !statsInteger(raw.revision, 1, CONTRIBUTION_MAX_OPERATIONS)
    || !(raw.deltaManifestHash === null || contributionIdentity(raw.deltaManifestHash)) || !statsInteger(raw.deltaCount, 0, CONTRIBUTION_JOURNAL_MAX_ENTRIES)
    || (raw.deltaManifestHash === null && raw.deltaCount !== 0)) throw new ContributionFault("storage_invalid");
  return Object.freeze({ accountId: raw.accountId, generation: raw.generation, revision: raw.revision, operationId: raw.operationId,
    bodyHash: raw.bodyHash, deltaManifestHash: raw.deltaManifestHash, deltaCount: raw.deltaCount });
}
function stepValue(value: unknown): Step {
  const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "source", "appliedRevision", "previousRoot", "phase", "cursor", "consumed", "entriesHash", "root", "stageHash", "writeBytes"]);
  if (!raw || raw.schemaVersion !== 3 || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)
    || !statsInteger(raw.appliedRevision, 0, CONTRIBUTION_MAX_OPERATIONS - 1) || (raw.phase !== "retract" && raw.phase !== "add")
    || !statsInteger(raw.cursor, 0, CONTRIBUTION_JOURNAL_MAX_ENTRIES - 1) || raw.cursor % CONTRIBUTION_REPLAY_CHUNK_ENTRIES !== 0
    || !statsInteger(raw.consumed, 1, CONTRIBUTION_REPLAY_CHUNK_ENTRIES) || !contributionIdentity(raw.entriesHash)
    || !contributionIdentity(raw.stageHash) || !statsInteger(raw.writeBytes, 0, CONTRIBUTION_INDEX_MAX_IO_BYTES)) throw new ContributionFault("storage_invalid");
  const source = sourceValue(raw.source);
  invariant(source.accountId === raw.accountId && source.generation === raw.generation && source.revision === raw.appliedRevision + 1
    && raw.cursor < source.deltaCount && raw.consumed === Math.min(CONTRIBUTION_REPLAY_CHUNK_ENTRIES, source.deltaCount - raw.cursor));
  return Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation, source, appliedRevision: raw.appliedRevision,
    previousRoot: reference(raw.previousRoot), phase: raw.phase, cursor: raw.cursor, consumed: raw.consumed, entriesHash: raw.entriesHash,
    root: reference(raw.root), stageHash: raw.stageHash, writeBytes: raw.writeBytes });
}
const stepHash = (step: Step) => contributionHash(`aicharts:contribution-projection-step:v3\0${JSON.stringify(step)}`);
function indexFailure(error: string): never {
  throw new ContributionFault(error === "capacity" || error === "overflow" ? "limit"
    : error === "storage_unavailable" ? "storage_unavailable" : error === "conflict" ? "conflict" : "storage_invalid");
}

/** Plan only from a checked SQL position and an owned, source-bound numeric
 * chunk. The loader is read-only. No intent or content object is written here. */
export async function planContributionProjectionChunk(control: ContributionProjectionControl, chunk: VerifiedContributionChunk,
  load: ContributionIndexLoader): Promise<ContributionProjectionPlan> {
  if (!checkedControls.has(control) || !isVerifiedContributionChunk(chunk) || !control.source
    || !same(chunk.source, control.source) || chunk.phase !== control.phase || chunk.cursor !== control.cursor)
    throw new ContributionFault("invalid_input");
  const owner = { accountId: control.accountId, generation: control.generation }, keys = new Map<string, string>();
  for (const value of chunk.values) for (const row of [value.before, value.after]) if (row) {
    const key = contributionRowCellKey(row); if (key === null) throw new ContributionFault("storage_invalid");
    keys.set(key, `${String(row.utcDay).padStart(8, "0")}:${key}`);
  }
  const loaded = await readContributionIndexCells(owner, control.stagedRoot, [...keys.values()], load);
  if (!loaded.ok) indexFailure(loaded.error);
  const prior = new Map([...loaded.value.cells.values()].filter(cell => cell !== null).map(cell => [contributionIndexKey(cell!), cell!]));
  const changes = planContributionRollups(key => prior.get(keys.get(key)!) ?? null, chunk.values, control.stagedRoot?.cells ?? 0);
  if (!changes.ok) indexFailure(changes.error);
  const planned = await stageContributionIndex(owner, control.stagedRoot, changes.value, load);
  if (!planned.ok) indexFailure(planned.error);
  const stageHash = contributionIndexStageHash(planned.value);
  if (stageHash === null) throw new ContributionFault("storage_invalid");
  const step = stepValue({ schemaVersion: 3, ...owner, source: control.source, appliedRevision: control.appliedRevision,
    previousRoot: control.stagedRoot, phase: control.phase, cursor: control.cursor, consumed: chunk.consumed, entriesHash: chunk.entriesHash,
    root: planned.value.root, stageHash, writeBytes: planned.value.writeBytes });
  const result = Object.freeze({ pending: Object.freeze({ hash: stepHash(step), step }), stage: planned.value });
  ownedPlans.add(result); return result;
}

/** Only registered fenced mutations create or mutate these three tables.
 * Content remains immutable in R2. Reads never prune, backfill or repair. */
export class ContributionProjectionState {
  constructor(readonly storage: Storage) {}
  get sql(): SqlStorage { return this.storage.sql; }
  initialize(accountId: string, generation: string): void {
    if (!contributionAccount(accountId) || !contributionIdentity(generation)) throw new ContributionFault("invalid_input");
    this.storage.transactionSync(() => {
      const source = new ContributionState(this.storage).control();
      if (source.phase !== "active" || source.accountId !== accountId || source.generation !== generation) throw new ContributionFault("recovery_required");
      for (const definition of Object.values(CONTRIBUTION_PROJECTION_SCHEMA)) this.sql.exec(definition);
      this.sql.exec("INSERT INTO usage_contribution_projection_control VALUES (1,?,?,0,NULL,0,NULL,NULL,NULL,NULL,0,?,0)", accountId, generation, source.updatedAtMs);
      this.sql.exec("INSERT INTO usage_contribution_projection_publications VALUES (0,NULL,?,NULL)", source.updatedAtMs);
    });
  }
  control(): ContributionProjectionControl {
    const rows = this.sql.exec("SELECT * FROM usage_contribution_projection_control LIMIT 2").toArray(), row = rows[0];
    if (rows.length !== 1 || row.id !== 1 || !contributionAccount(row.account_id) || !contributionIdentity(row.generation)
      || !statsInteger(row.applied_revision, 0, CONTRIBUTION_MAX_OPERATIONS) || !statsInteger(row.published_revision, 0, row.applied_revision)
      || !statsInteger(row.cursor, 0, CONTRIBUTION_JOURNAL_MAX_ENTRIES)
      || !statsInteger(row.updated_at_ms, 0, CONTRIBUTION_MAX_TIME) || !statsInteger(row.immutable_bytes, 0, CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES))
      throw new ContributionFault("storage_invalid");
    const source = row.staged_source === null ? null : sourceValue(json(row.staged_source));
    const appliedRoot = reference(row.applied_root === null ? null : json(row.applied_root));
    const publishedRoot = reference(row.published_root === null ? null : json(row.published_root));
    const stagedRoot = reference(row.staged_root === null ? null : json(row.staged_root));
    invariant((row.applied_revision !== 0 || appliedRoot === null) && (row.published_revision !== 0 || publishedRoot === null)
      && (row.applied_revision !== row.published_revision || same(appliedRoot, publishedRoot)));
    if (source === null) invariant(row.phase === null && row.cursor === 0 && stagedRoot === null);
    else invariant(source.accountId === row.account_id && source.generation === row.generation && source.revision === row.applied_revision + 1
      && (row.phase === "retract" || row.phase === "add") && row.cursor <= source.deltaCount
      && (row.cursor === source.deltaCount || row.cursor % CONTRIBUTION_REPLAY_CHUNK_ENTRIES === 0)
      && (row.phase === "add" || row.cursor < source.deltaCount));
    const value = Object.freeze({ accountId: row.account_id, generation: row.generation, appliedRevision: row.applied_revision, appliedRoot, publishedRevision: row.published_revision,
      publishedRoot, source, stagedRoot, phase: row.phase as ContributionReplayPhase | null, cursor: row.cursor,
      updatedAtMs: row.updated_at_ms, immutableBytes: row.immutable_bytes });
    checkedControls.add(value); return value;
  }
  pending(): ContributionProjectionPending | null {
    const rows = this.sql.exec("SELECT * FROM usage_contribution_projection_pending LIMIT 2").toArray(); invariant(rows.length <= 1);
    if (!rows.length) return null;
    const row = rows[0], step = stepValue(json(row.metadata));
    invariant(row.id === 1 && row.plan_hash === stepHash(step) && row.write_bytes === step.writeBytes);
    const control = this.control(); this.#position(control, step);
    return Object.freeze({ hash: row.plan_hash as string, step });
  }
  #canonical(control: ContributionProjectionControl, now: number): ContributionState {
    if (!statsInteger(now, 0, CONTRIBUTION_MAX_TIME) || now < control.updatedAtMs) throw new ContributionFault("clock_regressed");
    const state = new ContributionState(this.storage), source = state.control();
    if (source.phase !== "active" || source.accountId !== control.accountId || source.generation !== control.generation
      || source.revision < control.appliedRevision) throw new ContributionFault("recovery_required");
    if (now < source.updatedAtMs) throw new ContributionFault("clock_regressed");
    if (control.source) invariant(same(readCommittedContributionRevision(state, control.appliedRevision), control.source));
    return state;
  }
  #authority(control: ContributionProjectionControl, authority: ContributionProjectionAuthority): ContributionState {
    if (!authority.active) throw new ContributionFault("recovery_required");
    if (authority.accountId !== control.accountId || authority.generation !== control.generation) throw new ContributionFault("generation_conflict");
    return this.#canonical(control, authority.observedAtMs);
  }
  #position(control: ContributionProjectionControl, step: Step): void {
    if (step.accountId !== control.accountId || step.generation !== control.generation || step.appliedRevision !== control.appliedRevision
      || !same(step.source, control.source) || !same(step.previousRoot, control.stagedRoot)
      || step.phase !== control.phase || step.cursor !== control.cursor) throw new ContributionFault("conflict");
  }
  publication(revision: number, now: number): ContributionProjectionPublication {
    const control = this.control(); this.#canonical(control, now);
    if (!statsInteger(revision, 0, control.publishedRevision)) throw new ContributionFault("invalid_input");
    const rows = this.sql.exec("SELECT * FROM usage_contribution_projection_publications WHERE revision=? LIMIT 2", revision).toArray();
    if (rows.length !== 1) throw new ContributionFault("conflict");
    const row = rows[0], root = reference(row.root === null ? null : json(row.root));
    invariant(row.revision === revision && statsInteger(row.published_at_ms, 0, control.updatedAtMs)
      && (row.expires_at_ms === null || statsInteger(row.expires_at_ms, row.published_at_ms, CONTRIBUTION_MAX_TIME)));
    if (revision === control.publishedRevision) invariant(row.expires_at_ms === null && same(root, control.publishedRoot));
    else {
      invariant(row.expires_at_ms !== null);
      if (now >= (row.expires_at_ms as number)) throw new ContributionFault("conflict");
    }
    return Object.freeze({ revision, root, publishedAtMs: row.published_at_ms as number, expiresAtMs: row.expires_at_ms as number | null });
  }
  #publicationWindow(control: ContributionProjectionControl, current: ContributionProjectionPublication, now: number):
    Pick<ContributionProjectionStatus, "nextPublicationAtMs" | "publicationWait"> {
    if (control.appliedRevision === control.publishedRevision) return { nextPublicationAtMs: null, publicationWait: null };
    // Inspect a bounded metadata inventory. Expired rows remain intact on this
    // read path; only a successful explicit publication prunes them.
    const rows = this.sql.exec("SELECT revision,published_at_ms,expires_at_ms FROM usage_contribution_projection_publications LIMIT ?",
      CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS + 1).toArray();
    invariant(rows.length > 0 && rows.length <= CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS);
    let live = 0, currents = 0, firstExpiry = CONTRIBUTION_MAX_TIME;
    for (const row of rows) {
      invariant(statsInteger(row.revision, 0, control.publishedRevision) && statsInteger(row.published_at_ms, 0, control.updatedAtMs));
      if (row.revision === control.publishedRevision) {
        invariant(row.expires_at_ms === null && row.published_at_ms === current.publishedAtMs); currents++; live++;
      } else {
        invariant(statsInteger(row.expires_at_ms, row.published_at_ms as number, CONTRIBUTION_MAX_TIME));
        if ((row.expires_at_ms as number) > now) { live++; firstExpiry = Math.min(firstExpiry, row.expires_at_ms as number); }
      }
    }
    invariant(currents === 1);
    const interval = current.publishedAtMs + CONTRIBUTION_PROJECTION_PUBLISH_INTERVAL_MS;
    const next = Math.max(interval, live >= CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS ? firstExpiry : 0);
    if (Math.max(next, now) > CONTRIBUTION_MAX_TIME - CONTRIBUTION_PROJECTION_RETIRE_MS)
      return { nextPublicationAtMs: null, publicationWait: "clock_limit" };
    return { nextPublicationAtMs: next, publicationWait: live >= CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS ? "retention"
      : now < interval ? "interval" : null };
  }
  status(now: number, refusal: ContributionError | null = null): ContributionProjectionStatus {
    const control = this.control(), source = this.#canonical(control, now).control();
    const current = this.publication(control.publishedRevision, now);
    return Object.freeze({ schemaVersion: 3, accountId: control.accountId, generation: control.generation,
      sourceRevision: source.revision, appliedRevision: control.appliedRevision, publishedRevision: control.publishedRevision,
      appliedLag: source.revision - control.appliedRevision, publishedLag: source.revision - control.publishedRevision, lag: source.revision - control.publishedRevision,
      ...this.#publicationWindow(control, current, now),
      staged: control.source ? Object.freeze({ revision: control.source.revision, phase: control.phase!, cursor: control.cursor, count: control.source.deltaCount }) : null,
      pending: this.pending() !== null, immutableBytes: control.immutableBytes, refusal });
  }
  begin(proof: VerifiedContributionRevision, authority: ContributionProjectionAuthority): void {
    if (!isVerifiedContributionRevision(proof)) throw new ContributionFault("invalid_input");
    this.storage.transactionSync(() => {
      const control = this.control(), source = this.#authority(control, authority);
      if (control.source) { if (!same(control.source, proof.source)) throw new ContributionFault("conflict"); return; }
      invariant(this.pending() === null);
      if (!same(readCommittedContributionRevision(source, control.appliedRevision), proof.source)) throw new ContributionFault("conflict");
      this.sql.exec("UPDATE usage_contribution_projection_control SET staged_source=?,staged_root=?,phase=?,cursor=0,updated_at_ms=? WHERE id=1",
        JSON.stringify(proof.source), encode(control.appliedRoot), proof.source.deltaCount === 0 ? "add" : "retract", authority.observedAtMs);
    });
  }
  reserve(plan: ContributionProjectionPlan, authority: ContributionProjectionAuthority): ContributionProjectionPending {
    if (!ownedPlans.has(plan)) throw new ContributionFault("invalid_input");
    return this.storage.transactionSync(() => {
      const control = this.control(); this.#authority(control, authority); this.#position(control, plan.pending.step);
      const existing = this.pending();
      if (existing) { if (!same(existing, plan.pending)) throw new ContributionFault("conflict"); return existing; }
      if (control.immutableBytes + plan.pending.step.writeBytes > CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES) throw new ContributionFault("limit");
      const text = JSON.stringify(plan.pending.step); invariant(text.length <= CONTRIBUTION_PROJECTION_MAX_CONTROL_BYTES);
      this.sql.exec("INSERT INTO usage_contribution_projection_pending VALUES (1,?,?,?)", plan.pending.hash, text, plan.pending.step.writeBytes);
      this.sql.exec("UPDATE usage_contribution_projection_control SET immutable_bytes=?,updated_at_ms=? WHERE id=1",
        control.immutableBytes + plan.pending.step.writeBytes, authority.observedAtMs);
      return plan.pending;
    });
  }
  commit(plan: ContributionProjectionPlan, proof: VerifiedContributionIndex, authority: ContributionProjectionAuthority): void {
    if (!ownedPlans.has(plan) || !isVerifiedContributionIndex(proof)) throw new ContributionFault("invalid_input");
    this.storage.transactionSync(() => {
      const control = this.control(); this.#authority(control, authority); this.#position(control, plan.pending.step);
      const pending = this.pending(), step = plan.pending.step;
      if (!pending || !same(pending, plan.pending)) throw new ContributionFault("conflict");
      invariant(proof.accountId === control.accountId && proof.generation === control.generation && proof.stageHash === step.stageHash
        && proof.writeBytes === step.writeBytes && same(proof.root, step.root));
      const finished = step.cursor + step.consumed === step.source.deltaCount;
      const phase = step.phase === "retract" && finished ? "add" : step.phase, cursor = step.phase === "retract" && finished ? 0 : step.cursor + step.consumed;
      this.sql.exec("UPDATE usage_contribution_projection_control SET staged_root=?,phase=?,cursor=?,updated_at_ms=? WHERE id=1",
        encode(step.root), phase, cursor, authority.observedAtMs);
      this.sql.exec("DELETE FROM usage_contribution_projection_pending WHERE id=1");
    });
  }
  /** Commit a complete canonical revision to the private applied frontier.
   * This grants no query authority and consumes no retained-publication slot. */
  apply(authority: ContributionProjectionAuthority): void {
    this.storage.transactionSync(() => {
      const control = this.control(); this.#authority(control, authority);
      if (!control.source || control.phase !== "add" || control.cursor !== control.source.deltaCount || this.pending() !== null)
        throw new ContributionFault("conflict");
      this.sql.exec("UPDATE usage_contribution_projection_control SET applied_revision=?,applied_root=?,staged_source=NULL,staged_root=NULL,phase=NULL,cursor=0,updated_at_ms=? WHERE id=1",
        control.source.revision, encode(control.stagedRoot), authority.observedAtMs);
    });
  }
  /** Publish a complete applied root, even while its successor is staged.
   * The hard interval also covers caught-up bursts, keeping the cursor horizon
   * independent of the canonical ingestion rate. */
  publish(authority: ContributionProjectionAuthority): ContributionProjectionPublication {
    return this.storage.transactionSync(() => {
      const control = this.control(); this.#authority(control, authority);
      const current = this.publication(control.publishedRevision, authority.observedAtMs);
      if (control.appliedRevision === control.publishedRevision) return current;
      const window = this.#publicationWindow(control, current, authority.observedAtMs);
      if (window.publicationWait !== null) throw new ContributionFault(window.publicationWait === "interval" ? "conflict" : "limit");
      invariant(window.nextPublicationAtMs !== null && window.nextPublicationAtMs <= authority.observedAtMs);
      this.sql.exec("DELETE FROM usage_contribution_projection_publications WHERE expires_at_ms IS NOT NULL AND expires_at_ms<=?", authority.observedAtMs);
      const retained = this.sql.exec("SELECT revision FROM usage_contribution_projection_publications LIMIT ?", CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS + 1).toArray();
      if (retained.length >= CONTRIBUTION_PROJECTION_MAX_PUBLICATIONS) throw new ContributionFault("limit");
      this.sql.exec("UPDATE usage_contribution_projection_publications SET expires_at_ms=? WHERE revision=? AND expires_at_ms IS NULL",
        authority.observedAtMs + CONTRIBUTION_PROJECTION_RETIRE_MS, control.publishedRevision);
      this.sql.exec("INSERT INTO usage_contribution_projection_publications VALUES (?,?,?,NULL)", control.appliedRevision, encode(control.appliedRoot), authority.observedAtMs);
      this.sql.exec("UPDATE usage_contribution_projection_control SET published_revision=?,published_root=?,updated_at_ms=? WHERE id=1",
        control.appliedRevision, encode(control.appliedRoot), authority.observedAtMs);
      return this.publication(control.appliedRevision, authority.observedAtMs);
    });
  }
}
