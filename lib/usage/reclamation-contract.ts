import { contributionAccount, contributionIdentity, CONTRIBUTION_MAX_TIME } from "./contributions";
import { statsInteger, statsOwnRecord } from "./stats-contract";

/** Shared durable ledger contract for physical reclamation. Producers (repair
 * cutover, scratch abort, account lifecycle closure) append candidates; the
 * disabled-by-default reclamation job consumes them. Recording a candidate
 * never deletes anything and never proves the object is unreferenced: the
 * job re-walks every reference before any provider delete. */
export const RECLAMATION_LEDGER_PROFILE = "reclamation-ledger-v1" as const;
export const RECLAMATION_LEDGER_MAX_ENTRIES = 65_536;
export const RECLAMATION_LEDGER_MAX_KEY_BYTES = 512;
export const RECLAMATION_LEDGER_MAX_REFERENCES = 16;
export const RECLAMATION_LEDGER_MAX_REFERENCE_BYTES = 4_096;
export const RECLAMATION_LEDGER_MAX_REFUSAL_BYTES = 64;
/** Candidates become eligible only after the retention policy for
 * unreferenced immutable orphans (P30D after terminal reconciliation) has
 * elapsed since they were recorded. Retirement horizons for retired roots are
 * shorter and are enforced separately by the reference walk. */
export const RECLAMATION_REPLAY_HORIZON_MS = 30 * 86_400_000;
export const RECLAMATION_ENTRIES_PER_STEP = 4;
export const RECLAMATION_MAX_WALK_READS = 512;
export const RECLAMATION_MAX_WALK_BYTES = 33_554_432;
export const RECLAMATION_DEADLINE_MS = 30_000;
export const RECLAMATION_REQUEST_BYTES = 2_048;
export const RECLAMATION_RESPONSE_BYTES = 16_384;

export const RECLAMATION_SURFACES = Object.freeze(["derived-index-node", "canonical-body", "canonical-artifact", "stats-snapshot",
  "stats-receipt", "admission-object", "staged-measurement", "namespace-anchor"] as const);
export type ReclamationSurface = typeof RECLAMATION_SURFACES[number];
export const RECLAMATION_REASONS = Object.freeze(["superseded-root", "aborted-scratch", "retired-publication", "orphaned-write",
  "account-deletion", "generation-closure"] as const);
export type ReclamationReason = typeof RECLAMATION_REASONS[number];
/** Minimal ledger entry. `referencedBy` lists references known when the
 * candidate was recorded; a non-empty list is an explicit hold, and an empty
 * list is not a claim of being unreferenced. */
export type ReclamationLedgerEntry = Readonly<{
  account: string; surface: ReclamationSurface; key: string; reason: ReclamationReason; recordedAt: number; referencedBy: readonly string[];
}>;
export type ReclamationEntryState = "recorded" | "held" | "deleting" | "reclaimed" | "refused";
/** `held`: a reference walk found a live reference; the entry is retried later.
 * `refused`: the walk could not be completed or the surface is unsupported;
 * the entry stays until an operator reviews it. Neither state deletes. */
export type ReclamationRefusal = "unsupported_surface" | "foreign_key" | "walk_incomplete" | "storage_invalid" | "capacity";
export type ReclamationLedgerRow = ReclamationLedgerEntry & Readonly<{
  state: ReclamationEntryState; eligibleAt: number; attemptedAt: number | null; reclaimedAt: number | null;
  refusal: ReclamationRefusal | null; heldBy: readonly string[];
}>;
export type ReclamationRequest = Readonly<{ schemaVersion: 1; accountId: string; generation: string; action: "record" | "step" | "status"; entries?: readonly ReclamationLedgerEntry[] }>;
export type ReclamationError = "invalid_input" | "disabled" | "not_started" | "unauthorized" | "generation_conflict" | "recovery_required"
  | "conflict" | "deadline" | "capacity" | "storage_invalid" | "storage_unavailable";
export type ReclamationStepReceipt = Readonly<{
  schemaVersion: 1; profile: typeof RECLAMATION_LEDGER_PROFILE; accountId: string; generation: string; observedAt: number;
  enabled: boolean; entries: number; recorded: number; held: number; deleting: number; reclaimed: number; refused: number;
  visited: readonly ReclamationLedgerRow[]; walkReads: number; walkBytes: number; deletes: number;
}>;
export type ReclamationResult = Readonly<{ ok: true; value: ReclamationStepReceipt }> | Readonly<{ ok: false; error: ReclamationError }>;

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export const isReclamationSurface = (value: unknown): value is ReclamationSurface => (RECLAMATION_SURFACES as readonly unknown[]).includes(value);
export const isReclamationReason = (value: unknown): value is ReclamationReason => (RECLAMATION_REASONS as readonly unknown[]).includes(value);
const KEY = /^[a-z0-9][a-z0-9/._-]*$/u;
export function reclamationKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && bytes(value) <= RECLAMATION_LEDGER_MAX_KEY_BYTES && KEY.test(value)
    && !value.split("/").some(part => part === "" || part === "." || part === "..");
}
/** The owning account must appear as a whole path segment of every key so a
 * ledger entry can never name another account's object. */
export function reclamationKeyOwnedBy(key: string, account: string): boolean {
  const parts = key.split("/");
  return parts.includes(account) || parts.includes(account.replace(/^acct_/u, ""));
}
export function parseReclamationLedgerEntry(value: unknown): ReclamationLedgerEntry | null {
  const raw = statsOwnRecord(value, ["account", "surface", "key", "reason", "recordedAt", "referencedBy"]);
  if (!raw || !contributionAccount(raw.account) || !isReclamationSurface(raw.surface) || !reclamationKey(raw.key)
    || !reclamationKeyOwnedBy(raw.key, raw.account) || !isReclamationReason(raw.reason)
    || !statsInteger(raw.recordedAt, 0, CONTRIBUTION_MAX_TIME) || !Array.isArray(raw.referencedBy)
    || raw.referencedBy.length > RECLAMATION_LEDGER_MAX_REFERENCES
    || raw.referencedBy.some(item => typeof item !== "string" || item.length === 0 || bytes(item) > 256)
    || new Set(raw.referencedBy).size !== raw.referencedBy.length) return null;
  return Object.freeze({ account: raw.account, surface: raw.surface, key: raw.key, reason: raw.reason, recordedAt: raw.recordedAt,
    referencedBy: Object.freeze([...raw.referencedBy as string[]]) });
}
export function reclamationLedgerEntry(input: ReclamationLedgerEntry): ReclamationLedgerEntry {
  const value = parseReclamationLedgerEntry(input);
  if (!value) throw new Error("invalid_reclamation_entry");
  return value;
}
export function parseReclamationRequest(value: unknown): ReclamationRequest | null {
  const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "action", "entries"])
    ?? statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "action"]);
  if (!raw || raw.schemaVersion !== 1 || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)
    || (raw.action !== "record" && raw.action !== "step" && raw.action !== "status")) return null;
  if (bytes(JSON.stringify(value)) > RECLAMATION_REQUEST_BYTES) return null;
  if (raw.action === "record") {
    if (!Array.isArray(raw.entries) || raw.entries.length === 0 || raw.entries.length > RECLAMATION_ENTRIES_PER_STEP) return null;
    const entries = raw.entries.map(parseReclamationLedgerEntry);
    if (entries.some(entry => entry === null || entry.account !== raw.accountId)) return null;
    return Object.freeze({ schemaVersion: 1, accountId: raw.accountId, generation: raw.generation, action: "record", entries: Object.freeze(entries as ReclamationLedgerEntry[]) });
  }
  if (raw.entries !== undefined) return null;
  return Object.freeze({ schemaVersion: 1, accountId: raw.accountId, generation: raw.generation, action: raw.action });
}
