import { contributionAccount, contributionBatchText, contributionBodyHash, contributionHash, contributionIdentity, contributionPayloadHash,
  CONTRIBUTION_MAX_TIME, parseContributionBatch,
  type ContributionBatch, type ContributionHead } from "../../../lib/usage/contributions";
import { contributionIndexKey, contributionIndexStageHash, parseContributionIndexReference, readContributionIndexCells,
  readContributionIndexScanPage, stageContributionIndex, CONTRIBUTION_INDEX_MAX_IO_BYTES,
  type ContributionIndexLoader, type ContributionIndexReference, type ContributionIndexScanCursor,
  type ContributionIndexStage } from "../../../lib/usage/contribution-index";
import { contributionRebuildRowCellKey, planContributionRebuildCells, CONTRIBUTION_REBUILD_HEADS_PER_STEP,
  type ContributionRebuildInput } from "../../../lib/usage/contribution-rebuild";
import { CONTRIBUTION_REBUILD_MAX_JOBS, CONTRIBUTION_REBUILD_METADATA_BYTES,
  parseContributionRebuildBudget, parseContributionRebuildReceipt, type ContributionRebuildBudget,
  type ContributionRebuildDifference, type ContributionRebuildReceipt, type ContributionRebuildStatus,
  type ContributionRebuildError } from "../../../lib/usage/contribution-rebuild-contract";
import { statsInteger, statsOwnRecord } from "../../../lib/usage/stats-contract";
import { ContributionState } from "./contributions-state";
import { ContributionProjectionState, CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES,
  type ContributionProjectionAuthority } from "./contribution-projection-state";
import { isVerifiedContributionBody, type VerifiedContributionBody } from "./contributions-objects";
import { isVerifiedContributionIndex, type VerifiedContributionIndex } from "./contribution-index-objects";
import { readCommittedContributionRevision } from "./contribution-replay";

export const CONTRIBUTION_REBUILD_SCHEMA = Object.freeze({
  usage_contribution_rebuild_jobs: `CREATE TABLE usage_contribution_rebuild_jobs (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, metadata TEXT NOT NULL CHECK (length(CAST(metadata AS BLOB)) <= 16384)) WITHOUT ROWID`,
});
type Storage = Pick<DurableObjectStorage, "sql" | "transactionSync">;
export type ContributionRebuildAuthority = ContributionProjectionAuthority;
export class ContributionRebuildFault extends Error { constructor(readonly code: ContributionRebuildError) { super(code); } }
type Pending = Readonly<{
  positionHash: string; chunkHash: string; consumed: number; liveHeads: number; nextHeadId: string;
  root: ContributionIndexReference | null; stageHash: string; writeBytes: number; writeObjects: number; hash: string;
}>;
type Job = Readonly<{
  receipt: ContributionRebuildReceipt; createdAtMs: number; boundary: Readonly<{ operationId: string; bodyHash: string }>;
  lastHeadId: string; leftCursor: ContributionIndexScanCursor | null; rightCursor: ContributionIndexScanCursor | null;
  leftDone: boolean; rightDone: boolean; pending: Pending | null; lastPlanHash: string | null; reservedBytes: number;
}>;
export type CheckedContributionRebuildJob = Job;
export type ContributionRebuildHeadChunk = Readonly<{ positionHash: string; hash: string; heads: readonly ContributionHead[];
  consumed: number; liveHeads: number; nextHeadId: string }>;
export type ContributionRebuildHeadPlan = Readonly<{ job: CheckedContributionRebuildJob; pending: Pending; stage: ContributionIndexStage }>;
export type ContributionRebuildComparisonPlan = Readonly<{
  job: CheckedContributionRebuildJob; hash: string; phase: "comparing" | "match" | "mismatch"; checkedCells: number;
  leftCursor: ContributionIndexScanCursor | null; rightCursor: ContributionIndexScanCursor | null;
  leftDone: boolean; rightDone: boolean; difference: ContributionRebuildDifference | null;
}>;
const checkedJobs = new WeakMap<object, Storage>(), chunks = new WeakMap<object, CheckedContributionRebuildJob>();
const checkedRows = new WeakMap<object, ContributionRebuildHeadChunk>(), headPlans = new WeakSet<object>(), comparisonPlans = new WeakSet<object>();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const length = (text: string) => new TextEncoder().encode(text).byteLength;
const zeroBudget: ContributionRebuildBudget = Object.freeze({ sourceObjects: 0, sourceBytes: 0, indexObjects: 0, indexBytes: 0, writeObjects: 0, writeBytes: 0 });
function require(value: unknown, code: ContributionRebuildError = "storage_invalid"): asserts value {
  if (!value) throw new ContributionRebuildFault(code);
}
function root(value: unknown): ContributionIndexReference | null {
  if (value === null) return null;
  const parsed = parseContributionIndexReference(value); require(parsed); return parsed;
}
const active = (job: Job) => job.receipt.phase === "building" || job.receipt.phase === "comparing";
const positionHash = (job: Job) => contributionHash(`aicharts:contribution-rebuild-position:v3\0${JSON.stringify({
  receipt: job.receipt, createdAtMs: job.createdAtMs, boundary: job.boundary, lastHeadId: job.lastHeadId,
  leftCursor: job.leftCursor, rightCursor: job.rightCursor, leftDone: job.leftDone, rightDone: job.rightDone })}`);
const pendingHash = (value: Omit<Pending, "hash">) => contributionHash(`aicharts:contribution-rebuild-step:v3\0${JSON.stringify(value)}`);
function cursor(value: unknown, reference: ContributionIndexReference | null, checked: number): ContributionIndexScanCursor | null {
  if (value === null) return null;
  const raw = statsOwnRecord(value, ["rootHash", "afterKey", "scannedCells"]);
  require(raw && reference && raw.rootHash === reference.hash && typeof raw.afterKey === "string"
    && length(raw.afterKey) <= 512 && raw.afterKey >= reference.first && raw.afterKey < reference.last
    && statsInteger(raw.scannedCells, 1, reference.cells - 1) && raw.scannedCells === checked);
  return Object.freeze({ rootHash: raw.rootHash as string, afterKey: raw.afterKey as string, scannedCells: raw.scannedCells as number });
}
function pending(value: unknown): Pending | null {
  if (value === null) return null;
  const raw = statsOwnRecord(value, ["positionHash", "chunkHash", "consumed", "liveHeads", "nextHeadId", "root", "stageHash", "writeBytes", "writeObjects", "hash"]);
  require(raw && contributionIdentity(raw.positionHash) && contributionIdentity(raw.chunkHash)
    && statsInteger(raw.consumed, 1, CONTRIBUTION_REBUILD_HEADS_PER_STEP) && statsInteger(raw.liveHeads, 0, raw.consumed)
    && contributionIdentity(raw.nextHeadId, 32) && contributionIdentity(raw.stageHash) && contributionIdentity(raw.hash)
    && statsInteger(raw.writeObjects, 0, 512) && statsInteger(raw.writeBytes, raw.writeObjects, CONTRIBUTION_INDEX_MAX_IO_BYTES)
    && raw.writeBytes <= raw.writeObjects * 262_144);
  const step = Object.freeze({ positionHash: raw.positionHash, chunkHash: raw.chunkHash, consumed: raw.consumed, liveHeads: raw.liveHeads,
    nextHeadId: raw.nextHeadId, root: root(raw.root), stageHash: raw.stageHash, writeBytes: raw.writeBytes, writeObjects: raw.writeObjects });
  require(pendingHash(step) === raw.hash); return Object.freeze({ ...step, hash: raw.hash });
}
function parseJob(value: unknown): Job {
  const raw = statsOwnRecord(value, ["receipt", "createdAtMs", "boundary", "lastHeadId", "leftCursor", "rightCursor", "leftDone", "rightDone",
    "pending", "lastPlanHash", "reservedBytes"]);
  const receipt = raw ? parseContributionRebuildReceipt(raw.receipt) : null;
  const boundary = raw ? statsOwnRecord(raw.boundary, ["operationId", "bodyHash"]) : null;
  require(raw && receipt && boundary && contributionIdentity(boundary.operationId) && contributionIdentity(boundary.bodyHash)
    && statsInteger(raw.createdAtMs, 0, receipt.completedAtMs) && typeof raw.leftDone === "boolean" && typeof raw.rightDone === "boolean"
    && (raw.lastPlanHash === null || contributionIdentity(raw.lastPlanHash)) && typeof raw.lastHeadId === "string"
    && (receipt.processedHeads === 0 ? raw.lastHeadId === "" : contributionIdentity(raw.lastHeadId, 32))
    && statsInteger(raw.reservedBytes, receipt.chargedBytes, CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES)
    && receipt.headSteps === Math.ceil(receipt.processedHeads / CONTRIBUTION_REBUILD_HEADS_PER_STEP)
    && (receipt.phase !== "building" || receipt.processedHeads % CONTRIBUTION_REBUILD_HEADS_PER_STEP === 0)
    && receipt.version === 1 + receipt.headSteps + receipt.comparisonSteps + (receipt.phase === "aborted" ? 1 : 0)
    && (receipt.action !== "begin" || (receipt.version === 1 && receipt.processedHeads === 0 && receipt.scratchRoot === null && receipt.chargedBytes === 0))
    && (receipt.phase === "aborted") === (receipt.action === "abort"));
  const leftCursor = cursor(raw.leftCursor, receipt.scratchRoot, receipt.checkedCells);
  const rightCursor = cursor(raw.rightCursor, receipt.publishedRoot, receipt.checkedCells), staged = pending(raw.pending);
  const result: Job = Object.freeze({ receipt, createdAtMs: raw.createdAtMs, boundary: Object.freeze({ operationId: boundary.operationId, bodyHash: boundary.bodyHash }),
    lastHeadId: raw.lastHeadId, leftCursor, rightCursor, leftDone: raw.leftDone, rightDone: raw.rightDone,
    pending: staged, lastPlanHash: raw.lastPlanHash as string | null, reservedBytes: raw.reservedBytes });
  if (receipt.phase === "comparing") {
    require(staged === null && (result.leftDone ? leftCursor === null && receipt.checkedCells === (receipt.scratchRoot?.cells ?? 0)
      : receipt.checkedCells === 0 ? leftCursor === null : leftCursor !== null)
      && (result.rightDone ? rightCursor === null && receipt.checkedCells === (receipt.publishedRoot?.cells ?? 0)
        : receipt.checkedCells === 0 ? rightCursor === null : rightCursor !== null)
      && (!leftCursor || !rightCursor || leftCursor.afterKey === rightCursor.afterKey));
  } else require(leftCursor === null && rightCursor === null && !result.leftDone && !result.rightDone);
  if (receipt.phase === "building") require(receipt.comparisonSteps === 0 && receipt.checkedCells === 0);
  if (staged) {
    require(receipt.phase === "building" || receipt.phase === "aborted");
    require(staged.consumed === Math.min(CONTRIBUTION_REBUILD_HEADS_PER_STEP, receipt.headCount - receipt.processedHeads)
      && staged.nextHeadId > result.lastHeadId && (staged.root?.cells ?? 0) <= receipt.liveHeads + staged.liveHeads);
    if (receipt.phase === "building") require(staged.positionHash === positionHash(result) && result.reservedBytes === receipt.chargedBytes + staged.writeBytes);
    else require(result.reservedBytes === receipt.chargedBytes);
  } else require(result.reservedBytes === receipt.chargedBytes);
  return result;
}
function indexFailure(code: string): never {
  throw new ContributionRebuildFault(code === "capacity" || code === "overflow" ? "limit"
    : code === "conflict" ? "conflict" : code === "storage_unavailable" ? "storage_unavailable" : "storage_invalid");
}
function receipt(value: ContributionRebuildReceipt): ContributionRebuildReceipt {
  const result = parseContributionRebuildReceipt(value); require(result); return result;
}

/** One bounded durable diagnostic, independent of the projection's work slot.
 * SQL is the trusted committed authority and comparison-prefix store. Neither
 * constructors nor status reads initialize, repair, prune or resume anything. */
export class ContributionRebuildState {
  constructor(readonly storage: Storage) {}
  get sql(): SqlStorage { return this.storage.sql; }
  initialize(): void { for (const definition of Object.values(CONTRIBUTION_REBUILD_SCHEMA)) this.sql.exec(definition); }
  #read(id: string): Job | null {
    require(contributionIdentity(id), "invalid_input");
    const rows = this.sql.exec("SELECT id,version,metadata FROM usage_contribution_rebuild_jobs WHERE id = ? LIMIT 2", id).toArray();
    require(rows.length <= 1); if (!rows.length) return null;
    const row = rows[0]; require(typeof row.metadata === "string" && length(row.metadata) <= CONTRIBUTION_REBUILD_METADATA_BYTES);
    let decoded: unknown; try { decoded = JSON.parse(row.metadata); } catch { throw new ContributionRebuildFault("storage_invalid"); }
    const job = parseJob(decoded);
    require(row.id === id && job.receipt.jobId === id && row.version === job.receipt.version && JSON.stringify(job) === row.metadata);
    return job;
  }
  #write(job: Job, insert = false): void {
    const value = parseJob(job), text = JSON.stringify(value); require(length(text) <= CONTRIBUTION_REBUILD_METADATA_BYTES, "limit");
    if (insert) this.sql.exec("INSERT INTO usage_contribution_rebuild_jobs VALUES (?,?,?)", value.receipt.jobId, value.receipt.version, text);
    else this.sql.exec("UPDATE usage_contribution_rebuild_jobs SET version=?,metadata=? WHERE id=?", value.receipt.version, text, value.receipt.jobId);
  }
  status(id: string): ContributionRebuildStatus | null {
    const job = this.#read(id); return job ? Object.freeze({ receipt: job.receipt, pending: job.pending !== null, chargedBytes: job.reservedBytes }) : null;
  }
  inventory(): readonly ContributionRebuildStatus[] {
    const rows = this.sql.exec("SELECT id FROM usage_contribution_rebuild_jobs ORDER BY id LIMIT ?", CONTRIBUTION_REBUILD_MAX_JOBS + 1).toArray();
    require(rows.length <= CONTRIBUTION_REBUILD_MAX_JOBS);
    const values: ContributionRebuildStatus[] = []; let activeCount = 0;
    for (const row of rows) {
      require(contributionIdentity(row.id)); const job = this.#read(row.id); require(job);
      if (active(job)) activeCount++;
      if (values.length) require(job.receipt.accountId === values[0].receipt.accountId && job.receipt.generation === values[0].receipt.generation);
      values.push(Object.freeze({ receipt: job.receipt, pending: job.pending !== null, chargedBytes: job.reservedBytes }));
    }
    require(activeCount <= 1); return Object.freeze(values);
  }
  #base(authority: ContributionRebuildAuthority, job?: Job): ContributionState {
    require(authority.active, "recovery_required");
    require(contributionAccount(authority.accountId) && contributionIdentity(authority.generation), "invalid_input");
    const state = new ContributionState(this.storage), source = state.control(), projection = new ContributionProjectionState(this.storage).control();
    require(source.accountId === authority.accountId && projection.accountId === authority.accountId, "unauthorized");
    require(source.generation === authority.generation && projection.generation === authority.generation, "generation_conflict");
    require(source.phase === "active", "recovery_required");
    require(statsInteger(authority.observedAtMs, Math.max(source.updatedAtMs, projection.updatedAtMs, job?.receipt.completedAtMs ?? 0), CONTRIBUTION_MAX_TIME), "clock_regressed");
    if (job) require(job.receipt.accountId === authority.accountId && job.receipt.generation === authority.generation, "generation_conflict");
    return state;
  }
  assertAuthority(authority: ContributionRebuildAuthority): void { this.#base(authority); }
  #anchor(job: Job, authority: ContributionRebuildAuthority): ContributionState {
    const state = this.#base(authority, job), source = state.control(), projection = new ContributionProjectionState(this.storage), control = projection.control();
    require(source.legacySeal === null, "legacy_unresolved");
    require(source.revision === job.receipt.sourceRevision && source.headCount === job.receipt.headCount, "conflict");
    require(source.pendingOperation === null && control.source === null && projection.pending() === null
      && control.appliedRevision === source.revision && control.publishedRevision === source.revision, "not_caught_up");
    const publication = projection.publication(source.revision, authority.observedAtMs);
    require(publication.expiresAtMs === null && same(publication.root, job.receipt.publishedRoot)
      && same(control.publishedRoot, job.receipt.publishedRoot) && same(control.appliedRoot, job.receipt.publishedRoot), "conflict");
    const boundary = readCommittedContributionRevision(state, source.revision - 1);
    require(boundary && boundary.revision === source.revision && boundary.operationId === job.boundary.operationId && boundary.bodyHash === job.boundary.bodyHash);
    return state;
  }
  begin(id: string, expectedRevision: number, authority: ContributionRebuildAuthority): ContributionRebuildReceipt {
    require(contributionIdentity(id) && statsInteger(expectedRevision, 1, 1_000_000), "invalid_input");
    return this.storage.transactionSync(() => {
      this.#base(authority);
      const existing = this.#read(id);
      if (existing) {
        this.#base(authority, existing); require(existing.receipt.sourceRevision === expectedRevision, "conflict");
        return receipt({ ...existing.receipt, scratchRoot: null, version: 1, phase: existing.receipt.headCount ? "building" : "comparing",
          processedHeads: 0, liveHeads: 0, checkedCells: 0, headSteps: 0, comparisonSteps: 0, chargedBytes: 0,
          action: "begin", expectedVersion: 0, completedAtMs: existing.createdAtMs, difference: null, budget: zeroBudget });
      }
      const inventory = this.sql.exec("SELECT id FROM usage_contribution_rebuild_jobs ORDER BY id LIMIT ?", CONTRIBUTION_REBUILD_MAX_JOBS + 1).toArray();
      require(inventory.length <= CONTRIBUTION_REBUILD_MAX_JOBS); require(inventory.length < CONTRIBUTION_REBUILD_MAX_JOBS, "limit");
      for (const row of inventory) {
        require(contributionIdentity(row.id)); const retained = this.#read(row.id); require(retained);
        this.#base(authority, retained); require(!active(retained), "conflict");
      }
      const state = new ContributionState(this.storage), source = state.control(), projection = new ContributionProjectionState(this.storage).control();
      require(source.revision === expectedRevision, "conflict");
      const boundary = readCommittedContributionRevision(state, source.revision - 1); require(boundary);
      const value = receipt({ schemaVersion: 3, profile: "canonical-index-rebuild-v3", scope: "full-index", accountId: authority.accountId,
        generation: authority.generation, jobId: id, sourceRevision: source.revision, headCount: source.headCount, publishedRoot: projection.publishedRoot,
        scratchRoot: null, version: 1, phase: source.headCount ? "building" : "comparing", processedHeads: 0, liveHeads: 0, checkedCells: 0,
        headSteps: 0, comparisonSteps: 0, chargedBytes: 0, action: "begin", expectedVersion: 0, completedAtMs: authority.observedAtMs,
        difference: null, budget: zeroBudget });
      const job: Job = Object.freeze({ receipt: value, createdAtMs: authority.observedAtMs,
        boundary: Object.freeze({ operationId: boundary.operationId, bodyHash: boundary.bodyHash }), lastHeadId: "", leftCursor: null, rightCursor: null,
        leftDone: false, rightDone: false, pending: null, lastPlanHash: null, reservedBytes: 0 });
      this.#anchor(job, authority); this.#write(job, true); return value;
    });
  }
  retry(id: string, expectedVersion: number, action: "advance" | "abort", authority: ContributionRebuildAuthority): ContributionRebuildReceipt | null {
    const job = this.#read(id); require(job, "not_started"); this.#base(authority, job);
    if (job.receipt.version === expectedVersion + 1 && job.receipt.expectedVersion === expectedVersion && job.receipt.action === action) return job.receipt;
    require(job.receipt.version === expectedVersion, "conflict"); return null;
  }
  checked(id: string, expectedVersion: number, authority: ContributionRebuildAuthority): CheckedContributionRebuildJob {
    const job = this.#read(id); require(job, "not_started");
    require(job.receipt.version === expectedVersion && active(job), "conflict");
    this.#anchor(job, authority); checkedJobs.set(job, this.storage); return job;
  }
  assertPosition(job: CheckedContributionRebuildJob, authority: ContributionRebuildAuthority): CheckedContributionRebuildJob {
    require(checkedJobs.get(job) === this.storage, "invalid_input");
    const fresh = this.checked(job.receipt.jobId, job.receipt.version, authority);
    require(positionHash(fresh) === positionHash(job), "conflict"); return fresh;
  }
  headChunk(job: CheckedContributionRebuildJob, authority: ContributionRebuildAuthority): ContributionRebuildHeadChunk {
    this.assertPosition(job, authority); require(job.receipt.phase === "building", "conflict");
    const ids = this.sql.exec("SELECT id FROM usage_contribution_heads WHERE id > ? ORDER BY id LIMIT ?", job.lastHeadId, CONTRIBUTION_REBUILD_HEADS_PER_STEP + 1).toArray();
    const remaining = job.receipt.headCount - job.receipt.processedHeads, consumed = Math.min(remaining, CONTRIBUTION_REBUILD_HEADS_PER_STEP);
    require(ids.length === Math.min(remaining, CONTRIBUTION_REBUILD_HEADS_PER_STEP + 1));
    let previous = job.lastHeadId;
    for (const item of ids) { require(contributionIdentity(item.id, 32) && item.id > previous); previous = item.id; }
    const state = new ContributionState(this.storage), heads: ContributionHead[] = [];
    for (const item of ids.slice(0, consumed)) {
      const head = state.head(item.id as string); require(head); require(!head.legacySupport && !head.suppressedLegacy, "legacy_unresolved");
      require(head.deleted || head.reference?.kind === "batch-v3", "legacy_unresolved");
      heads.push(Object.freeze({ ...head, reference: head.reference ? Object.freeze({ ...head.reference }) : null }));
    }
    const items = Object.freeze(heads), position = positionHash(job), liveHeads = heads.filter(head => !head.deleted && head.members > 0).length;
    const result = Object.freeze({ positionHash: position, hash: contributionHash(`aicharts:contribution-rebuild-heads:v3\0${JSON.stringify({ position, heads: items })}`),
      heads: items, consumed, liveHeads, nextHeadId: heads.at(-1)!.id });
    chunks.set(result, job); return result;
  }
  resolveHead(chunk: ContributionRebuildHeadChunk, id: string, input: ContributionBatch, proof: VerifiedContributionBody,
    authority: ContributionRebuildAuthority): ContributionRebuildInput {
    const job = chunks.get(chunk); require(job, "invalid_input"); this.assertPosition(job, authority);
    const head = chunk.heads.find(value => value.id === id); require(head && !head.deleted && head.members > 0 && head.reference?.kind === "batch-v3", "invalid_input");
    const batch = parseContributionBatch(input); require(batch && isVerifiedContributionBody(proof), "invalid_input");
    const ref = head.reference; require(ref?.kind === "batch-v3");
    require(batch.accountId === job.receipt.accountId && batch.generation === job.receipt.generation
      && proof.accountId === batch.accountId && proof.bodyHash === ref.bodyHash && contributionBodyHash(batch) === ref.bodyHash
      && length(contributionBatchText(batch)) === proof.byteLength);
    const mutation = batch.mutations[ref.index]; require(mutation?.kind === "put" && mutation.id === id);
    const state = new ContributionState(this.storage); require(same(state.head(id), head), "conflict");
    const operation = state.operation(batch.operationId);
    require(operation?.kind === "batch" && operation.outcome === "committed" && operation.terminal && "outcome" in operation.terminal && operation.terminal.outcome === "committed");
    const intent = operation.intent, terminal = operation.terminal.receipt;
    require(contributionPayloadHash(mutation.row) === head.payloadHash && ref.payloadHash === head.payloadHash
      && head.headHash === contributionHash(`aicharts:contribution-head:v3\0${JSON.stringify([batch.accountId, batch.generation, batch.operationId, id, head.payloadHash])}`)
      && intent.operationId === batch.operationId && intent.bodyHash === ref.bodyHash && intent.byteLength === proof.byteLength
      && intent.accountId === batch.accountId && intent.generation === batch.generation && intent.deviceId === batch.deviceId
      && intent.populationId === batch.populationId && intent.sequence === batch.sequence && intent.expectedRevision === batch.expectedRevision
      && operation.publishedRevision === batch.expectedRevision + 1 && operation.publishedRevision <= job.receipt.sourceRevision
      && terminal.populationRevision === batch.expectedPopulationRevision + 1
      && terminal.populationHead === contributionHash(`aicharts:population-history:v3\0${JSON.stringify([batch.expectedPopulationHead, ref.bodyHash])}`));
    const result = Object.freeze({ id, row: mutation.row }); checkedRows.set(result, chunk); return result;
  }
  async planHeadStep(job: CheckedContributionRebuildJob, chunk: ContributionRebuildHeadChunk,
    values: readonly ContributionRebuildInput[], load: ContributionIndexLoader): Promise<ContributionRebuildHeadPlan> {
    require(checkedJobs.get(job) === this.storage && chunks.get(chunk) === job && chunk.positionHash === positionHash(job), "invalid_input");
    require(Array.isArray(values) && values.length === chunk.liveHeads, "invalid_input");
    const ownedValues = Object.freeze([...values]);
    require(ownedValues.every((value, index) => checkedRows.get(value) === chunk
      && (index === 0 || ownedValues[index - 1].id < value.id)), "invalid_input");
    const owner = { accountId: job.receipt.accountId, generation: job.receipt.generation }, keys = new Map<string, string>();
    for (const value of ownedValues) { const key = contributionRebuildRowCellKey(value.row); require(key); keys.set(key, `${String(value.row.utcDay).padStart(8, "0")}:${key}`); }
    const loaded = await readContributionIndexCells(owner, job.receipt.scratchRoot, [...keys.values()], load);
    if (!loaded.ok) indexFailure(loaded.error);
    const cells = new Map([...loaded.value.cells.values()].filter(cell => cell !== null).map(cell => [contributionIndexKey(cell!), cell!]));
    const folded = planContributionRebuildCells(ownedValues, key => cells.get(keys.get(key)!) ?? null, job.receipt.scratchRoot?.cells ?? 0);
    if (!folded.ok) indexFailure(folded.error);
    const stage = await stageContributionIndex(owner, job.receipt.scratchRoot, folded.value, load);
    if (!stage.ok) indexFailure(stage.error);
    const stageHash = contributionIndexStageHash(stage.value); require(stageHash);
    const descriptor = Object.freeze({ positionHash: positionHash(job), chunkHash: chunk.hash, consumed: chunk.consumed, liveHeads: chunk.liveHeads,
      nextHeadId: chunk.nextHeadId, root: stage.value.root, stageHash, writeBytes: stage.value.writeBytes, writeObjects: stage.value.objects.length });
    const plan = Object.freeze({ job, pending: Object.freeze({ ...descriptor, hash: pendingHash(descriptor) }), stage: stage.value });
    headPlans.add(plan); return plan;
  }
  reserveHeadStep(plan: ContributionRebuildHeadPlan, authority: ContributionRebuildAuthority): void {
    require(headPlans.has(plan), "invalid_input");
    this.storage.transactionSync(() => {
      const job = this.assertPosition(plan.job, authority);
      if (job.pending) { require(same(job.pending, plan.pending), "conflict"); return; }
      const control = new ContributionProjectionState(this.storage).control();
      require(control.immutableBytes + plan.pending.writeBytes <= CONTRIBUTION_PROJECTION_MAX_IMMUTABLE_BYTES, "limit");
      this.#write(Object.freeze({ ...job, pending: plan.pending, reservedBytes: job.reservedBytes + plan.pending.writeBytes }));
      // Shared cumulative quota only. Normal projection frontiers, pending
      // state and publications remain untouched in this atomic reservation.
      this.sql.exec("UPDATE usage_contribution_projection_control SET immutable_bytes=?,updated_at_ms=? WHERE id=1",
        control.immutableBytes + plan.pending.writeBytes, authority.observedAtMs);
    });
  }
  reserved(plan: ContributionRebuildHeadPlan, authority: ContributionRebuildAuthority): void {
    require(headPlans.has(plan), "invalid_input"); const job = this.assertPosition(plan.job, authority);
    require(same(job.pending, plan.pending), "conflict");
  }
  commitHeadStep(plan: ContributionRebuildHeadPlan, stored: VerifiedContributionIndex, budget: ContributionRebuildBudget,
    authority: ContributionRebuildAuthority): ContributionRebuildReceipt {
    require(headPlans.has(plan) && isVerifiedContributionIndex(stored), "invalid_input");
    return this.storage.transactionSync(() => {
      this.reserved(plan, authority); const job = this.#read(plan.job.receipt.jobId)!;
      require(stored.accountId === job.receipt.accountId && stored.generation === job.receipt.generation && stored.stageHash === plan.pending.stageHash
        && stored.writeBytes === plan.pending.writeBytes && same(stored.root, plan.pending.root));
      require(parseContributionRebuildBudget(budget) && budget.sourceObjects === plan.pending.liveHeads
        && budget.writeBytes === plan.pending.writeBytes && budget.writeObjects === plan.pending.writeObjects, "invalid_input");
      const processedHeads = job.receipt.processedHeads + plan.pending.consumed;
      const value = receipt({ ...job.receipt, scratchRoot: plan.pending.root, version: job.receipt.version + 1,
        phase: processedHeads === job.receipt.headCount ? "comparing" : "building", processedHeads,
        liveHeads: job.receipt.liveHeads + plan.pending.liveHeads, headSteps: job.receipt.headSteps + 1,
        chargedBytes: job.reservedBytes, action: "advance", expectedVersion: job.receipt.version, completedAtMs: authority.observedAtMs, budget });
      this.#write(Object.freeze({ ...job, receipt: value, lastHeadId: plan.pending.nextHeadId, pending: null, lastPlanHash: plan.pending.hash }));
      return value;
    });
  }
  async planComparison(job: CheckedContributionRebuildJob, load: ContributionIndexLoader): Promise<ContributionRebuildComparisonPlan> {
    require(checkedJobs.get(job) === this.storage && job.receipt.phase === "comparing", "invalid_input");
    const owner = { accountId: job.receipt.accountId, generation: job.receipt.generation };
    const empty = { ok: true as const, value: { cells: [], next: null, scannedCells: job.receipt.checkedCells } };
    const left = job.leftDone ? empty : await readContributionIndexScanPage(owner, job.receipt.scratchRoot, { limit: 16, cursor: job.leftCursor }, load);
    if (!left.ok) indexFailure(left.error);
    const right = job.rightDone ? empty : await readContributionIndexScanPage(owner, job.receipt.publishedRoot, { limit: 16, cursor: job.rightCursor }, load);
    if (!right.ok) indexFailure(right.error);
    require(left.value.scannedCells === job.receipt.checkedCells + left.value.cells.length && right.value.scannedCells === job.receipt.checkedCells + right.value.cells.length);
    let difference: ContributionRebuildDifference | null = null, checkedCells = job.receipt.checkedCells;
    for (let index = 0; index < Math.max(left.value.cells.length, right.value.cells.length); index++) {
      const a = left.value.cells[index] ?? null, b = right.value.cells[index] ?? null;
      if (same(a, b)) { checkedCells++; continue; }
      const aKey = a ? contributionIndexKey(a) : null, bKey = b ? contributionIndexKey(b) : null;
      const key = aKey === null ? bKey! : bKey === null ? aKey : aKey < bKey ? aKey : bKey;
      difference = Object.freeze({ key, rebuilt: aKey === key ? a : null, published: bKey === key ? b : null }); break;
    }
    const phase = difference ? "mismatch" : left.value.next === null && right.value.next === null ? "match" : "comparing";
    const value = { phase, checkedCells, difference, leftCursor: phase === "comparing" ? left.value.next : null,
      rightCursor: phase === "comparing" ? right.value.next : null, leftDone: phase === "comparing" && left.value.next === null,
      rightDone: phase === "comparing" && right.value.next === null } as const;
    const plan = Object.freeze({ job, ...value, hash: contributionHash(`aicharts:contribution-rebuild-comparison:v3\0${JSON.stringify({ position: positionHash(job), ...value })}`) });
    comparisonPlans.add(plan); return plan;
  }
  commitComparison(plan: ContributionRebuildComparisonPlan, budget: ContributionRebuildBudget,
    authority: ContributionRebuildAuthority): ContributionRebuildReceipt {
    require(comparisonPlans.has(plan) && parseContributionRebuildBudget(budget) && budget.sourceObjects === 0 && budget.writeObjects === 0
      && budget.indexObjects <= 252, "invalid_input");
    return this.storage.transactionSync(() => {
      const job = this.assertPosition(plan.job, authority);
      const value = receipt({ ...job.receipt, version: job.receipt.version + 1, phase: plan.phase, checkedCells: plan.checkedCells,
        comparisonSteps: job.receipt.comparisonSteps + 1, difference: plan.difference, action: "advance", expectedVersion: job.receipt.version,
        completedAtMs: authority.observedAtMs, budget });
      this.#write(Object.freeze({ ...job, receipt: value, leftCursor: plan.leftCursor, rightCursor: plan.rightCursor,
        leftDone: plan.leftDone, rightDone: plan.rightDone, lastPlanHash: plan.hash })); return value;
    });
  }
  abort(id: string, expectedVersion: number, authority: ContributionRebuildAuthority): ContributionRebuildReceipt {
    return this.storage.transactionSync(() => {
      const repeated = this.retry(id, expectedVersion, "abort", authority); if (repeated) return repeated;
      const job = this.#read(id)!; this.#base(authority, job); require(active(job), "conflict");
      const value = receipt({ ...job.receipt, version: job.receipt.version + 1, phase: "aborted", chargedBytes: job.reservedBytes,
        action: "abort", expectedVersion, completedAtMs: authority.observedAtMs, budget: zeroBudget });
      // A retained pending descriptor records possibly orphaned immutable
      // writes. Abort neither refunds their charge nor deletes any object.
      this.#write(Object.freeze({ ...job, receipt: value, leftCursor: null, rightCursor: null, leftDone: false, rightDone: false })); return value;
    });
  }
}
