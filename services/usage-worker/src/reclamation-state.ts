import { contributionAccount, CONTRIBUTION_MAX_TIME } from "../../../lib/usage/contributions";
import { isReclamationReason, isReclamationSurface, parseReclamationLedgerEntry, reclamationKey, reclamationKeyOwnedBy,
  RECLAMATION_ENTRIES_PER_STEP, RECLAMATION_LEDGER_MAX_ENTRIES, RECLAMATION_LEDGER_MAX_REFERENCE_BYTES,
  RECLAMATION_LEDGER_MAX_REFUSAL_BYTES, RECLAMATION_REPLAY_HORIZON_MS,
  type ReclamationEntryState, type ReclamationError, type ReclamationLedgerEntry, type ReclamationLedgerRow,
  type ReclamationRefusal } from "../../../lib/usage/reclamation-contract";
import { statsInteger } from "../../../lib/usage/stats-contract";

/** Durable `reclamation-ledger-v1`. One row per candidate object, keyed by
 * (surface, key), so recording is idempotent and a replayed producer never
 * creates a second candidate. Rows only move forward:
 * recorded/held -> deleting -> reclaimed, or any live state -> refused.
 * `deleting` is written before the provider delete so an interrupted step
 * resumes by re-verifying references and repeating the idempotent delete. */
export const RECLAMATION_SCHEMA = Object.freeze({
  usage_reclamation_ledger: `CREATE TABLE usage_reclamation_ledger (surface TEXT NOT NULL, key TEXT NOT NULL CHECK (length(CAST(key AS BLOB)) <= 512), account_id TEXT NOT NULL, reason TEXT NOT NULL, recorded_at_ms INTEGER NOT NULL, referenced_by TEXT NOT NULL CHECK (length(referenced_by) <= 4096), state TEXT NOT NULL CHECK (state IN ('recorded', 'held', 'deleting', 'reclaimed', 'refused')), eligible_at_ms INTEGER NOT NULL, attempted_at_ms INTEGER, reclaimed_at_ms INTEGER, refusal TEXT CHECK (refusal IS NULL OR length(refusal) <= 64), held_by TEXT NOT NULL CHECK (length(held_by) <= 4096), PRIMARY KEY (surface, key)) WITHOUT ROWID`,
});
type Storage = Pick<DurableObjectStorage, "sql" | "transactionSync">;
export class ReclamationFault extends Error { constructor(readonly code: ReclamationError) { super(code); } }
export type ReclamationLedgerCounts = Readonly<{ entries: number; recorded: number; held: number; deleting: number; reclaimed: number; refused: number }>;
const LIVE: readonly ReclamationEntryState[] = Object.freeze(["recorded", "held", "deleting"]);
const REFUSALS: readonly ReclamationRefusal[] = Object.freeze(["unsupported_surface", "foreign_key", "walk_incomplete", "storage_invalid", "capacity"]);
function invariant(value: unknown, code: ReclamationError = "storage_invalid"): asserts value {
  if (!value) throw new ReclamationFault(code);
}
const isState = (value: unknown): value is ReclamationEntryState =>
  value === "recorded" || value === "held" || value === "deleting" || value === "reclaimed" || value === "refused";
function references(value: unknown): readonly string[] {
  invariant(typeof value === "string" && value.length <= RECLAMATION_LEDGER_MAX_REFERENCE_BYTES);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ReclamationFault("storage_invalid"); }
  invariant(Array.isArray(parsed) && parsed.every(item => typeof item === "string" && item.length > 0 && item.length <= 256)
    && new Set(parsed).size === parsed.length);
  return Object.freeze([...parsed as string[]]);
}
function row(value: Record<string, SqlStorageValue>): ReclamationLedgerRow {
  invariant(isReclamationSurface(value.surface) && reclamationKey(value.key) && contributionAccount(value.account_id)
    && reclamationKeyOwnedBy(value.key, value.account_id) && isReclamationReason(value.reason)
    && statsInteger(value.recorded_at_ms, 0, CONTRIBUTION_MAX_TIME) && isState(value.state)
    && statsInteger(value.eligible_at_ms, value.recorded_at_ms, CONTRIBUTION_MAX_TIME)
    && (value.attempted_at_ms === null || statsInteger(value.attempted_at_ms, value.recorded_at_ms, CONTRIBUTION_MAX_TIME))
    && (value.reclaimed_at_ms === null || statsInteger(value.reclaimed_at_ms, value.recorded_at_ms, CONTRIBUTION_MAX_TIME))
    && (value.refusal === null || (typeof value.refusal === "string" && value.refusal.length <= RECLAMATION_LEDGER_MAX_REFUSAL_BYTES
      && (REFUSALS as readonly string[]).includes(value.refusal))));
  const referencedBy = references(value.referenced_by), heldBy = references(value.held_by);
  // Terminal and refusal markers are exclusive to their own states.
  invariant((value.state === "reclaimed") === (value.reclaimed_at_ms !== null) && (value.state === "refused") === (value.refusal !== null)
    && (value.state !== "deleting" || value.attempted_at_ms !== null));
  const entry = parseReclamationLedgerEntry({ account: value.account_id, surface: value.surface, key: value.key, reason: value.reason,
    recordedAt: value.recorded_at_ms, referencedBy });
  invariant(entry);
  return Object.freeze({ ...entry, state: value.state, eligibleAt: value.eligible_at_ms, attemptedAt: value.attempted_at_ms as number | null,
    reclaimedAt: value.reclaimed_at_ms as number | null, refusal: value.refusal as ReclamationRefusal | null, heldBy });
}
export class ReclamationState {
  readonly #sql: SqlStorage;
  constructor(readonly storage: Storage) { this.#sql = storage.sql; }
  static present(storage: Storage): boolean {
    return storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='usage_reclamation_ledger' LIMIT 1").toArray().length === 1;
  }
  initialize(): void {
    invariant(!ReclamationState.present(this.storage), "conflict");
    this.#sql.exec(RECLAMATION_SCHEMA.usage_reclamation_ledger);
  }
  #row(surface: string, key: string): ReclamationLedgerRow | null {
    const rows = this.#sql.exec("SELECT * FROM usage_reclamation_ledger WHERE surface=? AND key=? LIMIT 2", surface, key).toArray();
    invariant(rows.length <= 1);
    return rows.length ? row(rows[0]) : null;
  }
  read(surface: string, key: string): ReclamationLedgerRow | null { return this.#row(surface, key); }
  counts(): ReclamationLedgerCounts {
    const rows = this.#sql.exec("SELECT state, COUNT(*) AS n FROM usage_reclamation_ledger GROUP BY state LIMIT 8").toArray();
    const counts = { entries: 0, recorded: 0, held: 0, deleting: 0, reclaimed: 0, refused: 0 };
    for (const item of rows) {
      invariant(isState(item.state) && statsInteger(item.n, 0, RECLAMATION_LEDGER_MAX_ENTRIES));
      counts[item.state] = item.n; counts.entries += item.n;
    }
    invariant(counts.entries <= RECLAMATION_LEDGER_MAX_ENTRIES);
    return Object.freeze(counts);
  }
  /** Idempotent append. An identical replay returns the existing row; a row
   * that names a different account or reason for the same object is a conflict.
   * `now` must not precede the producer's recording time. Recording is never a
   * claim that the object is unreferenced: a non-empty `referencedBy` holds it
   * and every entry is re-walked before any delete. */
  record(entries: readonly ReclamationLedgerEntry[], accountId: string, now: number): readonly ReclamationLedgerRow[] {
    invariant(entries.length >= 1 && entries.length <= RECLAMATION_ENTRIES_PER_STEP, "invalid_input");
    invariant(statsInteger(now, 0, CONTRIBUTION_MAX_TIME), "invalid_input");
    return this.storage.transactionSync(() => {
      const values: ReclamationLedgerRow[] = [];
      for (const input of entries) {
        const entry = parseReclamationLedgerEntry(input);
        invariant(entry && entry.account === accountId && entry.recordedAt <= now, "invalid_input");
        const existing = this.#row(entry.surface, entry.key);
        if (existing) {
          invariant(existing.account === entry.account && existing.reason === entry.reason && existing.recordedAt === entry.recordedAt
            && JSON.stringify(existing.referencedBy) === JSON.stringify(entry.referencedBy), "conflict");
          values.push(existing); continue;
        }
        invariant(this.counts().entries < RECLAMATION_LEDGER_MAX_ENTRIES, "capacity");
        const eligibleAt = entry.recordedAt + RECLAMATION_REPLAY_HORIZON_MS;
        invariant(eligibleAt <= CONTRIBUTION_MAX_TIME, "invalid_input");
        const state: ReclamationEntryState = entry.referencedBy.length ? "held" : "recorded";
        this.#sql.exec("INSERT INTO usage_reclamation_ledger VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)", entry.surface, entry.key, entry.account,
          entry.reason, entry.recordedAt, JSON.stringify(entry.referencedBy), state, eligibleAt, JSON.stringify(entry.referencedBy));
        const written = this.#row(entry.surface, entry.key); invariant(written); values.push(written);
      }
      return Object.freeze(values);
    });
  }
  /** Deterministic next candidates: interrupted `deleting` rows first (they
   * resume regardless of horizon), then eligible rows by horizon, surface, key. */
  next(limit: number, now: number, accountId: string): readonly ReclamationLedgerRow[] {
    invariant(statsInteger(limit, 1, RECLAMATION_ENTRIES_PER_STEP) && statsInteger(now, 0, CONTRIBUTION_MAX_TIME), "invalid_input");
    const rows = this.#sql.exec("SELECT * FROM usage_reclamation_ledger WHERE state IN ('recorded','held','deleting') AND (state='deleting' OR eligible_at_ms<=?) ORDER BY CASE state WHEN 'deleting' THEN 0 ELSE 1 END, eligible_at_ms, surface, key LIMIT ?", now, limit).toArray();
    const values = rows.map(row);
    invariant(values.every(value => value.account === accountId));
    return Object.freeze(values);
  }
  #move(surface: string, key: string, from: readonly ReclamationEntryState[], now: number, assignment: string, ...args: SqlStorageValue[]): ReclamationLedgerRow {
    invariant(statsInteger(now, 0, CONTRIBUTION_MAX_TIME), "invalid_input");
    const current = this.#row(surface, key);
    invariant(current && from.includes(current.state) && now >= current.recordedAt, "conflict");
    const cursor = this.#sql.exec(`UPDATE usage_reclamation_ledger SET ${assignment} WHERE surface=? AND key=? AND state IN (${from.map(() => "?").join(",")})`,
      ...args, surface, key, ...from);
    invariant(cursor.rowsWritten === 1);
    const moved = this.#row(surface, key); invariant(moved); return moved;
  }
  markDeleting(surface: string, key: string, now: number): ReclamationLedgerRow {
    return this.#move(surface, key, LIVE, now, "state='deleting', attempted_at_ms=?", now);
  }
  markReclaimed(surface: string, key: string, now: number): ReclamationLedgerRow {
    return this.#move(surface, key, ["deleting"], now, "state='reclaimed', reclaimed_at_ms=?", now);
  }
  markHeld(surface: string, key: string, heldBy: readonly string[], now: number): ReclamationLedgerRow {
    const text = JSON.stringify(heldBy.slice(0, 16));
    invariant(heldBy.length >= 1 && text.length <= RECLAMATION_LEDGER_MAX_REFERENCE_BYTES, "invalid_input");
    return this.#move(surface, key, LIVE, now, "state='held', attempted_at_ms=?, held_by=?", now, text);
  }
  markRefused(surface: string, key: string, refusal: ReclamationRefusal, now: number): ReclamationLedgerRow {
    return this.#move(surface, key, LIVE, now, "state='refused', attempted_at_ms=?, refusal=?", now, refusal);
  }
}
