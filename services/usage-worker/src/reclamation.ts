import { contributionAccount, contributionIdentity, ContributionFault, CONTRIBUTION_MAX_TIME } from "../../../lib/usage/contributions";
import { parseContributionIndexReference, type ContributionIndexReference } from "../../../lib/usage/contribution-index";
import { parseReclamationRequest, reclamationKeyOwnedBy, RECLAMATION_DEADLINE_MS, RECLAMATION_ENTRIES_PER_STEP, RECLAMATION_LEDGER_PROFILE,
  RECLAMATION_MAX_WALK_BYTES, RECLAMATION_MAX_WALK_READS, type ReclamationError, type ReclamationLedgerRow, type ReclamationRequest,
  type ReclamationResult, type ReclamationStepReceipt, type ReclamationSurface } from "../../../lib/usage/reclamation-contract";
import { statsInteger } from "../../../lib/usage/stats-contract";
import type { AdmissionObservation, AdmissionOwner, AdmissionTransaction } from "./account-admission";
import { AccountWorkState } from "./account-work-state";
import { ContributionState } from "./contributions-state";
import { ContributionProjectionState } from "./contribution-projection-state";
import { ContributionRebuildState, ContributionRebuildFault } from "./contribution-rebuild-state";
import { readContributionIndexObject } from "./contribution-index-objects";
import { enrollmentStorageCall } from "./namespace-anchor";
import { ReclamationFault, ReclamationState } from "./reclamation-state";

/** Fail-closed physical reclamation. Disabled by default: `policy.enabled`
 * is derived from an exact capability flag that stays unset everywhere, and a
 * disabled job refuses every action, including reads. When enabled, one step
 * takes at most `RECLAMATION_ENTRIES_PER_STEP` ledger rows, re-walks every
 * reference for each row inside the account's own transaction, and deletes an
 * object only when the account is quiescent, the row's replay horizon has
 * passed and the walk found no reference. Anything uncertain holds or refuses;
 * nothing is deleted to recover quota. */
export type ReclamationPolicy = Readonly<{ enabled: boolean }>;
export type ReclamationEnvironment = Pick<Env, "STAGING">;
type Authority = Readonly<{ accountId: string; generation: string; observedAtMs: number; active: boolean }>;
type Walk = Readonly<{ hashes: ReadonlySet<string>; reads: number; bytes: number; roots: string }>;
type Verdict = Readonly<{ kind: "referenced"; by: readonly string[] }> | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "refuse"; refusal: "unsupported_surface" | "foreign_key" | "walk_incomplete" }>;
type Storage = Pick<DurableObjectStorage, "sql" | "transactionSync">;
const NODE = /^usage-projections\/v3\/([^/]+)\/([0-9a-f]{64})\/nodes\/([0-9a-f]{64})\.json$/u;
const BODY = /^usage-contributions\/v3\/([^/]+)\/([0-9a-f]{64})\.json$/u;
const SNAPSHOT = /^usage-stats\/v2\/([^/]+)\/([0-9a-f]{64})\/snapshots\/([0-9a-f]{64})\.json$/u;
const RECEIPT = /^usage-stats\/v2\/([^/]+)\/([0-9a-f]{64})\/receipts\/([0-9a-f]{16})-([0-9a-f]{64})\.json$/u;
function failure(error: unknown): ReclamationError {
  if (error instanceof ReclamationFault) return error.code;
  return error instanceof ContributionRebuildFault || error instanceof ContributionFault ? reclamationErrorFrom(error.code) : "storage_unavailable";
}
/** Owner, contribution and rebuild refusals collapse onto the ledger contract. */
export function reclamationErrorFrom(code: string): ReclamationError {
  switch (code) {
    case "invalid_input": case "unauthorized": case "generation_conflict": case "recovery_required": case "conflict": case "capacity":
    case "storage_invalid": case "storage_unavailable": case "not_started": return code;
    case "not_enrolled": return "unauthorized";
    case "clock_regressed": case "not_caught_up": case "legacy_unresolved": case "limit": return "conflict";
    default: return "storage_invalid";
  }
}
const authority = (owner: AdmissionOwner, now: number): Authority =>
  Object.freeze({ accountId: owner.accountId, generation: owner.generation, observedAtMs: now, active: owner.phase === "active" });
const present = (storage: Storage, table: string): boolean =>
  storage.sql.exec("SELECT name FROM sqlite_schema WHERE name=? LIMIT 1", table).toArray().length === 1;
/** Every index root any live reader, pending step, publication row, rebuild
 * job or unexpired cutover still names. Read inside the account transaction. */
function liveRoots(storage: Storage, now: number): readonly ContributionIndexReference[] {
  const values = [...new ContributionProjectionState(storage).referencedRoots()];
  if (present(storage, "usage_contribution_rebuild_jobs")) values.push(...new ContributionRebuildState(storage).referencedRoots(now));
  return values;
}
const rootSignature = (roots: readonly ContributionIndexReference[]): string => JSON.stringify([...new Set(roots.map(root => root.hash))].sort());
/** The account is quiescent when no canonical operation, projection step,
 * scheduled or in-flight account work, or reserved rebuild step exists. A
 * delete is only admitted between two identical quiescent observations. */
function assertQuiescent(storage: Storage, owner: AdmissionOwner, now: number): void {
  const source = new ContributionState(storage).control(), projection = new ContributionProjectionState(storage);
  const control = projection.control();
  if (source.accountId !== owner.accountId || source.generation !== owner.generation || source.phase !== "active"
    || control.accountId !== owner.accountId || control.generation !== owner.generation) throw new ReclamationFault("recovery_required");
  if (source.pendingOperation !== null || control.source !== null || control.stagedRoot !== null || projection.pending() !== null
    || control.appliedRevision !== control.publishedRevision || control.appliedRevision !== source.revision) throw new ReclamationFault("conflict");
  const work = new AccountWorkState(storage).snapshot(authority(owner, now));
  if (work.projection.flight !== null || work.projection.key !== null) throw new ReclamationFault("conflict");
  if (present(storage, "usage_contribution_rebuild_jobs")) {
    for (const job of new ContributionRebuildState(storage).inventory()) if (job.pending) throw new ReclamationFault("conflict");
  }
}
export class AccountReclamation {
  constructor(readonly env: ReclamationEnvironment, readonly ledger: ReclamationState, readonly transaction: AdmissionTransaction,
    readonly policy: ReclamationPolicy) {}
  #run<T>(request: ReclamationRequest, observation: AdmissionObservation, live: () => void, callback: (owner: AdmissionOwner, now: number) => T): T {
    live();
    const result = this.transaction(observation, (owner, now) => {
      live();
      if (!owner || owner.phase !== "active") throw new ReclamationFault("unauthorized");
      if (owner.accountId !== request.accountId) throw new ReclamationFault("unauthorized");
      if (owner.generation !== request.generation) throw new ReclamationFault("generation_conflict");
      if (!statsInteger(now, observation.observed, CONTRIBUTION_MAX_TIME)) throw new ReclamationFault("conflict");
      if (!ReclamationState.present(this.ledger.storage)) throw new ReclamationFault("not_started");
      return callback(owner, now);
    });
    if (!result.ok) throw new ReclamationFault(reclamationErrorFrom(result.error)); return result.value;
  }
  #receipt(request: ReclamationRequest, now: number, visited: readonly ReclamationLedgerRow[], walkReads: number, walkBytes: number, deletes: number): ReclamationStepReceipt {
    const counts = this.ledger.counts();
    return Object.freeze({ schemaVersion: 1, profile: RECLAMATION_LEDGER_PROFILE, accountId: request.accountId, generation: request.generation,
      observedAt: now, enabled: this.policy.enabled, ...counts, visited: Object.freeze([...visited]), walkReads, walkBytes, deletes });
  }
  async execute(input: unknown, observation: AdmissionObservation): Promise<ReclamationResult> {
    const request = parseReclamationRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    if (this.policy.enabled !== true) return { ok: false, error: "disabled" };
    let retired = false, lastObserved = 0;
    const deadline = performance.now() + RECLAMATION_DEADLINE_MS;
    const live = () => { if (retired || performance.now() >= deadline) throw new ReclamationFault("deadline"); };
    const run = <T>(callback: (owner: AdmissionOwner, now: number) => T) => this.#run(request, observation, live, (owner, now) => {
      if (now < lastObserved) throw new ReclamationFault("conflict");
      lastObserved = now; return callback(owner, now);
    });
    try {
      if (request.action === "status") return { ok: true, value: run((_owner, now) => this.#receipt(request, now, [], 0, 0, 0)) };
      if (request.action === "record") return { ok: true, value: run((_owner, now) => {
        const rows = this.ledger.record(request.entries ?? [], request.accountId, now);
        return this.#receipt(request, now, rows, 0, 0, 0);
      }) };
      return { ok: true, value: await this.#step(request, run, live) };
    } catch (error) { return { ok: false, error: failure(error) }; }
    finally { retired = true; }
  }
  /** Bounded transitive walk over every live root. Branch nodes are read from
   * the content store; leaves need no read because their hash is already in
   * the parent. Budget overflow refuses the whole walk. */
  async #walk(roots: readonly ContributionIndexReference[], owner: Pick<Authority, "accountId" | "generation">, live: () => void): Promise<Walk> {
    const hashes = new Set<string>(); const queue: ContributionIndexReference[] = [...roots]; let reads = 0, bytes = 0;
    while (queue.length) {
      const reference = queue.shift()!;
      if (hashes.has(reference.hash)) continue;
      hashes.add(reference.hash);
      if (reference.level === 0) continue;
      if (reads >= RECLAMATION_MAX_WALK_READS || bytes + reference.byteLength > RECLAMATION_MAX_WALK_BYTES) throw new ReclamationFault("capacity");
      live(); reads++; bytes += reference.byteLength;
      const text = await readContributionIndexObject(this.env.STAGING, owner, reference); live();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new ReclamationFault("storage_invalid"); }
      const children = (parsed as { children?: unknown }).children;
      if (!parsed || typeof parsed !== "object" || (parsed as { kind?: unknown }).kind !== "branch" || !Array.isArray(children) || !children.length)
        throw new ReclamationFault("storage_invalid");
      for (const child of children) { const ref = parseContributionIndexReference(child); if (!ref) throw new ReclamationFault("storage_invalid"); queue.push(ref); }
    }
    return Object.freeze({ hashes, reads, bytes, roots: rootSignature(roots) });
  }
  /** SQL-only reference checks, evaluated inside the account transaction. */
  #verdict(storage: Storage, row: ReclamationLedgerRow, owner: AdmissionOwner, walk: Walk | null): Verdict {
    if (!reclamationKeyOwnedBy(row.key, owner.accountId) || row.account !== owner.accountId) return { kind: "refuse", refusal: "foreign_key" };
    const own = (account: string, generation?: string) => account === owner.accountId && (generation === undefined || generation === owner.generation);
    switch (row.surface) {
      case "derived-index-node": {
        const match = NODE.exec(row.key);
        if (!match || !own(match[1], match[2])) return { kind: "refuse", refusal: "foreign_key" };
        if (!walk) return { kind: "refuse", refusal: "walk_incomplete" };
        return walk.hashes.has(match[3]) ? { kind: "referenced", by: ["index-walk"] } : { kind: "clear" };
      }
      case "canonical-body": {
        const match = BODY.exec(row.key);
        if (!match || !own(match[1])) return { kind: "refuse", refusal: "foreign_key" };
        if (row.reason !== "orphaned-write" && row.reason !== "account-deletion") return { kind: "refuse", refusal: "unsupported_surface" };
        const hash = match[2], by: string[] = [], sql = storage.sql;
        if (sql.exec("SELECT id FROM usage_contribution_operations WHERE body_hash=? LIMIT 1", hash).toArray().length) by.push("operations");
        if (sql.exec("SELECT id FROM usage_contribution_heads WHERE payload_hash=? LIMIT 1", hash).toArray().length) by.push("heads");
        if (sql.exec("SELECT id FROM usage_contribution_control WHERE activation_hash=? OR migration_manifest_hash=? OR instr(pending_operation, ?)>0 OR instr(legacy_seal, ?)>0 LIMIT 1",
          hash, hash, hash, hash).toArray().length) by.push("control");
        return by.length ? { kind: "referenced", by } : { kind: "clear" };
      }
      case "stats-snapshot": case "stats-receipt": {
        const match = (row.surface === "stats-snapshot" ? SNAPSHOT : RECEIPT).exec(row.key);
        if (!match || !own(match[1], match[2])) return { kind: "refuse", refusal: "foreign_key" };
        if (!present(storage, "usage_stats_control")) return { kind: "refuse", refusal: "walk_incomplete" };
        const hash = match[match.length - 1], by: string[] = [], sql = storage.sql;
        if (sql.exec("SELECT client FROM usage_stats_days WHERE body_hash=? LIMIT 1", hash).toArray().length) by.push("days");
        if (sql.exec("SELECT id FROM usage_stats_pending WHERE body_hash=? OR instr(receipt, ?)>0 LIMIT 1", hash, hash).toArray().length) by.push("pending");
        if (sql.exec("SELECT device_id FROM usage_stats_devices WHERE instr(receipt, ?)>0 LIMIT 1", hash).toArray().length) by.push("devices");
        return by.length ? { kind: "referenced", by } : { kind: "clear" };
      }
      default: return { kind: "refuse", refusal: "unsupported_surface" };
    }
  }
  async #step(request: ReclamationRequest, run: <T>(callback: (owner: AdmissionOwner, now: number) => T) => T, live: () => void): Promise<ReclamationStepReceipt> {
    const storage = this.ledger.storage;
    const candidates = run((owner, now) => {
      assertQuiescent(storage, owner, now);
      return { rows: this.ledger.next(RECLAMATION_ENTRIES_PER_STEP, now, owner.accountId), roots: liveRoots(storage, now) };
    });
    let walk: Walk | null = null;
    if (candidates.rows.some(row => row.surface === "derived-index-node")) {
      const owner = { accountId: request.accountId, generation: request.generation };
      if (!contributionAccount(owner.accountId) || !contributionIdentity(owner.generation)) throw new ReclamationFault("invalid_input");
      walk = await this.#walk(candidates.roots, owner, live);
    }
    const visited: ReclamationLedgerRow[] = []; let deletes = 0;
    for (const row of candidates.rows) {
      live();
      // An interrupted delete resumes: a missing object is already reclaimed;
      // a present one is re-verified exactly like a fresh candidate.
      const existing = await enrollmentStorageCall(this.env.STAGING.head(row.key)); live();
      if (row.state === "deleting" && existing === null) {
        visited.push(run((_owner, now) => this.ledger.markReclaimed(row.surface, row.key, now))); continue;
      }
      const decision = run((owner, now) => {
        assertQuiescent(storage, owner, now);
        const current = this.ledger.read(row.surface, row.key);
        if (!current || current.state !== row.state) throw new ReclamationFault("conflict");
        if (current.state !== "deleting" && current.eligibleAt > now) throw new ReclamationFault("conflict");
        // The walk is only valid for the exact root set it started from.
        if (walk && walk.roots !== rootSignature(liveRoots(storage, now))) throw new ReclamationFault("conflict");
        const verdict = this.#verdict(storage, current, owner, walk);
        if (verdict.kind === "refuse") return { row: this.ledger.markRefused(row.surface, row.key, verdict.refusal, now), remove: false };
        if (verdict.kind === "referenced") return { row: this.ledger.markHeld(row.surface, row.key, verdict.by, now), remove: false };
        if (existing === null) return { row: this.ledger.markReclaimed(row.surface, row.key, now), remove: false };
        return { row: this.ledger.markDeleting(row.surface, row.key, now), remove: true };
      });
      if (!decision.remove) { visited.push(decision.row); continue; }
      // The row is durably `deleting` before the provider delete; a crash here
      // resumes above without a second charge because the delete is idempotent.
      await enrollmentStorageCall(this.env.STAGING.delete(row.key)); deletes++; live();
      if (await enrollmentStorageCall(this.env.STAGING.head(row.key)) !== null) throw new ReclamationFault("storage_invalid");
      live();
      visited.push(run((_owner, now) => this.ledger.markReclaimed(row.surface, row.key, now)));
    }
    return run((_owner, now) => this.#receipt(request, now, visited, walk?.reads ?? 0, walk?.bytes ?? 0, deletes));
  }
}
export const isReclamationSurfaceSupported = (surface: ReclamationSurface): boolean =>
  surface === "derived-index-node" || surface === "canonical-body" || surface === "stats-snapshot" || surface === "stats-receipt";
