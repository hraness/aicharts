import { contributionAccount, contributionHash, contributionIdentity, ContributionFault, CONTRIBUTION_MAX_TIME } from "../../../lib/usage/contributions";
import { statsInteger, statsOwnRecord } from "../../../lib/usage/stats-contract";

export const ACCOUNT_WORK_MAX_ATTEMPTS = 8;
export const ACCOUNT_WORK_RETRY_BASE_MS = 1_000;
export const ACCOUNT_WORK_RETRY_MAX_MS = 60_000;
export const ACCOUNT_WORK_MAX_BYTES = 4_096;
export const ACCOUNT_WORK_READY_DELAY_MS = 1;
export const ACCOUNT_WORK_DISPATCH_YIELD_MS = 2_000;
export const ACCOUNT_WORK_WATCHDOG_MS = 30_000;
export const ACCOUNT_WORK_SCHEMA = Object.freeze({
  account_work: "CREATE TABLE account_work (id INTEGER PRIMARY KEY CHECK (id = 1), account_id TEXT NOT NULL, generation TEXT NOT NULL, observed_at_ms INTEGER NOT NULL, payload TEXT NOT NULL CHECK (length(payload) <= 4096))",
});
export type AccountWorkKind = "consent" | "projection";
export type AccountWorkBlock = "retry_exhausted" | "clock_limit" | "capacity" | "authority" | "invalid_state" | "publishing_refused";
export type AccountWorkAuthority = Readonly<{ accountId: string; generation: string; observedAtMs: number; active: boolean }>;
export type AccountWorkFlight = Readonly<{ version: number; key: string; attempt: number; watchAtMs: number | null;
  status: "running" | "awaiting_settlement" }>;
export type AccountWorkRecord = Readonly<{
  version: number; key: string | null; acknowledgedKey: string | null; attempts: number; nextAtMs: number | null; blocked: AccountWorkBlock | null;
  flight: AccountWorkFlight | null;
}>;
export type AccountWorkSnapshot = Readonly<{
  accountId: string; generation: string; observedAtMs: number; consent: AccountWorkRecord; projection: AccountWorkRecord;
}>;
export type AccountWorkAttempt = Readonly<{ accountId: string; generation: string; kind: AccountWorkKind;
  version: number; key: string; attempt: number; retryAtMs: number | null }>;
export type AccountWorkOutcome = Readonly<{ kind: "acknowledge" | "progress" } | { kind: "refuse"; reason: AccountWorkBlock | null }
  | { kind: "defer"; readyAtMs: number | null }>;
type Storage = Pick<DurableObjectStorage, "sql" | "transactionSync">;
const attempts = new WeakSet<object>();
const blocks: readonly AccountWorkBlock[] = ["retry_exhausted", "clock_limit", "capacity", "authority", "invalid_state", "publishing_refused"];
const idle = (): AccountWorkRecord => Object.freeze({ version: 0, key: null, acknowledgedKey: null, attempts: 0, nextAtMs: null, blocked: null, flight: null });
const time = (value: unknown): value is number => statsInteger(value, 0, CONTRIBUTION_MAX_TIME);
export const accountWorkKey = (scope: AccountWorkKind, identity: readonly (string | number | null)[]): string =>
  contributionHash(`aicharts:account-work:v1\0${scope}\0${JSON.stringify(identity)}`);
export function accountWorkRetryAt(now: number, attempt: number): number | null {
  if (!time(now) || !statsInteger(attempt, 1, ACCOUNT_WORK_MAX_ATTEMPTS)) throw new ContributionFault("invalid_input");
  const delay = Math.min(ACCOUNT_WORK_RETRY_MAX_MS, ACCOUNT_WORK_RETRY_BASE_MS * 2 ** (attempt - 1));
  return now <= CONTRIBUTION_MAX_TIME - delay ? now + delay : null;
}
function record(value: unknown): AccountWorkRecord {
  const raw = statsOwnRecord(value, ["version", "key", "acknowledgedKey", "attempts", "nextAtMs", "blocked", "flight"]);
  if (!raw || !statsInteger(raw.version, 0, Number.MAX_SAFE_INTEGER) || !(raw.key === null || contributionIdentity(raw.key)) || !(raw.acknowledgedKey === null || contributionIdentity(raw.acknowledgedKey))
    || !statsInteger(raw.attempts, 0, ACCOUNT_WORK_MAX_ATTEMPTS) || !(raw.nextAtMs === null || time(raw.nextAtMs))
    || !(raw.blocked === null || blocks.includes(raw.blocked as AccountWorkBlock))
    || (raw.blocked !== null && raw.nextAtMs !== null)
    || (raw.key === null && (raw.attempts !== 0 || raw.nextAtMs !== null || raw.blocked !== null))
    || (raw.key !== null && raw.key === raw.acknowledgedKey && (raw.attempts !== 0 || raw.nextAtMs !== null || raw.blocked !== null))
    || (raw.key !== null && raw.key !== raw.acknowledgedKey && raw.nextAtMs === null && raw.blocked === null))
    throw new ContributionFault("storage_invalid");
  const flight = raw.flight === null ? null : statsOwnRecord(raw.flight, ["version", "key", "attempt", "watchAtMs", "status"]);
  if (raw.flight !== null && (!flight || !statsInteger(flight.version, 1, raw.version) || !contributionIdentity(flight.key)
    || !statsInteger(flight.attempt, 1, ACCOUNT_WORK_MAX_ATTEMPTS)
    || !(flight.status === "running" && time(flight.watchAtMs) || flight.status === "awaiting_settlement" && flight.watchAtMs === null)))
    throw new ContributionFault("storage_invalid");
  return Object.freeze({ version: raw.version, key: raw.key, acknowledgedKey: raw.acknowledgedKey, attempts: raw.attempts,
    nextAtMs: raw.nextAtMs, blocked: raw.blocked as AccountWorkBlock | null,
    flight: flight === null ? null : Object.freeze({ version: flight.version as number, key: flight.key as string,
      attempt: flight.attempt as number, watchAtMs: flight.watchAtMs as number | null, status: flight.status as AccountWorkFlight["status"] }) });
}
function checkedAuthority(authority: AccountWorkAuthority): void {
  if (!contributionAccount(authority.accountId) || !contributionIdentity(authority.generation) || !time(authority.observedAtMs)
    || authority.active !== true) throw new ContributionFault("unauthorized");
}

/** Two fixed work classes. These are retry/acknowledgment controls, not numeric
 * history. The caller owns a live execution lease and its checked transaction.
 * Reading or constructing this helper never creates a table or schedules work. */
export class AccountWorkState {
  constructor(readonly storage: Storage) {}
  initialize(authority: AccountWorkAuthority): void {
    checkedAuthority(authority);
    this.storage.sql.exec(ACCOUNT_WORK_SCHEMA.account_work);
    this.storage.sql.exec("INSERT INTO account_work VALUES (1,?,?,?,?)", authority.accountId, authority.generation,
      authority.observedAtMs, JSON.stringify({ consent: idle(), projection: idle() }));
  }
  snapshot(authority: AccountWorkAuthority): AccountWorkSnapshot {
    checkedAuthority(authority);
    const rows = this.storage.sql.exec("SELECT * FROM account_work LIMIT 2").toArray(), row = rows[0];
    if (rows.length !== 1 || row.id !== 1 || row.account_id !== authority.accountId || row.generation !== authority.generation
      || !time(row.observed_at_ms) || typeof row.payload !== "string" || new TextEncoder().encode(row.payload).byteLength > ACCOUNT_WORK_MAX_BYTES)
      throw new ContributionFault("storage_invalid");
    if (row.observed_at_ms > authority.observedAtMs) throw new ContributionFault("clock_regressed");
    let raw;
    try { raw = statsOwnRecord(JSON.parse(row.payload) as unknown, ["consent", "projection"]); } catch { throw new ContributionFault("storage_invalid"); }
    if (!raw) throw new ContributionFault("storage_invalid");
    return Object.freeze({ accountId: authority.accountId, generation: authority.generation, observedAtMs: row.observed_at_ms,
      consent: record(raw.consent), projection: record(raw.projection) });
  }
  #write(snapshot: AccountWorkSnapshot, kind: AccountWorkKind, value: Omit<AccountWorkRecord, "version">, authority: AccountWorkAuthority): AccountWorkRecord {
    if (snapshot[kind].version >= Number.MAX_SAFE_INTEGER) throw new ContributionFault("limit");
    const next = record({ ...value, version: snapshot[kind].version + 1 });
    const payload = JSON.stringify({ consent: kind === "consent" ? next : snapshot.consent,
      projection: kind === "projection" ? next : snapshot.projection });
    if (new TextEncoder().encode(payload).byteLength > ACCOUNT_WORK_MAX_BYTES) throw new ContributionFault("limit");
    this.storage.sql.exec("UPDATE account_work SET observed_at_ms=?,payload=? WHERE id=1", authority.observedAtMs, payload);
    return next;
  }
  /** New work identity resets its own retry budget. Appending unrelated source
   * revisions must not change the current projection-position identity. */
  reconcile(kind: AccountWorkKind, key: string | null, readyAtMs: number | null, authority: AccountWorkAuthority, resume = false): AccountWorkRecord {
    if (!(key === null || contributionIdentity(key)) || !(readyAtMs === null || time(readyAtMs)) || (key === null && readyAtMs !== null))
      throw new ContributionFault("invalid_input");
    const snapshot = this.snapshot(authority), previous = snapshot[kind];
    if (previous.key === key && !resume) return previous;
    const done = key === null || key === previous.acknowledgedKey;
    const next: Omit<AccountWorkRecord, "version"> = { key, acknowledgedKey: previous.acknowledgedKey, attempts: 0,
      nextAtMs: done ? null : readyAtMs, blocked: !done && readyAtMs === null ? "clock_limit" : null,
      flight: resume ? null : previous.flight };
    return this.#write(snapshot, kind, next, authority);
  }
  /** The caller persists an alarm before this claim, and before every later
   * durable progress callback. A lost callback retains this attempt's deadline. */
  claim(kind: AccountWorkKind, authority: AccountWorkAuthority, mode: "due" | "explicit" = "due"): AccountWorkAttempt | null {
    const snapshot = this.snapshot(authority), current = snapshot[kind];
    if (current.flight !== null || current.key === null || current.key === current.acknowledgedKey || current.blocked !== null
      || current.nextAtMs === null || mode === "due" && current.nextAtMs > authority.observedAtMs) return null;
    if (current.attempts >= ACCOUNT_WORK_MAX_ATTEMPTS) {
      this.#write(snapshot, kind, { ...current, nextAtMs: null, blocked: "retry_exhausted" }, authority); return null;
    }
    const attempt = current.attempts + 1, retryAtMs = accountWorkRetryAt(authority.observedAtMs, attempt);
    const watchAtMs = authority.observedAtMs <= CONTRIBUTION_MAX_TIME - ACCOUNT_WORK_WATCHDOG_MS ? authority.observedAtMs + ACCOUNT_WORK_WATCHDOG_MS : null;
    const flight: AccountWorkFlight = { version: current.version + 1, key: current.key, attempt,
      watchAtMs, status: watchAtMs === null ? "awaiting_settlement" : "running" };
    const next = this.#write(snapshot, kind, { ...current, attempts: attempt, nextAtMs: retryAtMs, blocked: retryAtMs === null ? "clock_limit" : null, flight }, authority);
    const value = Object.freeze({ accountId: authority.accountId, generation: authority.generation,
      kind, version: next.version, key: current.key, attempt, retryAtMs }); attempts.add(value); return value;
  }
  /** A direct user mutation can confirm its exact consent decision without
   * pretending to have consumed an alarm attempt. A newer decision wins. */
  acknowledgeConsent(key: string, authority: AccountWorkAuthority): boolean {
    if (!contributionIdentity(key)) throw new ContributionFault("invalid_input");
    const snapshot = this.snapshot(authority), current = snapshot.consent;
    if (current.key !== key) return false;
    if (current.acknowledgedKey === key) return true;
    this.#write(snapshot, "consent", { ...current, key, acknowledgedKey: key, attempts: 0, nextAtMs: null, blocked: null }, authority);
    return true;
  }
  /** One durable watchdog transition, never another dispatch or a drain claim.
   * Its independent flight version survives ordinary work-position changes. */
  watch(kind: AccountWorkKind, authority: AccountWorkAuthority): void {
    const snapshot = this.snapshot(authority), current = snapshot[kind], flight = current.flight;
    if (flight === null || flight.status !== "running" || flight.watchAtMs === null || flight.watchAtMs > authority.observedAtMs) return;
    this.#write(snapshot, kind, { ...current, flight: { ...flight, status: "awaiting_settlement", watchAtMs: null } }, authority);
  }
  /** Only the actual continuation may clear its independently versioned flight.
   * A resumed claim invalidates this capability even at the same key/attempt.
   * Clearing custody does not acknowledge a newer work identity. */
  complete(attempt: AccountWorkAttempt, outcome: AccountWorkOutcome, authority: AccountWorkAuthority): boolean {
    if (!attempts.has(attempt)) throw new ContributionFault("invalid_input");
    if (attempt.accountId !== authority.accountId || attempt.generation !== authority.generation) throw new ContributionFault("unauthorized");
    const snapshot = this.snapshot(authority), current = snapshot[attempt.kind], flight = current.flight;
    if (flight === null || flight.version !== attempt.version || flight.key !== attempt.key || flight.attempt !== attempt.attempt) return false;
    let next: Omit<AccountWorkRecord, "version"> = { ...current, flight: null };
    if (current.key === attempt.key && current.attempts === attempt.attempt && current.acknowledgedKey !== attempt.key) {
      if (outcome.kind === "acknowledge") next = { ...next, acknowledgedKey: attempt.key, attempts: 0, nextAtMs: null, blocked: null };
      else if (outcome.kind === "refuse") {
        if (outcome.reason !== null && !blocks.includes(outcome.reason)) throw new ContributionFault("invalid_input");
        const blocked = outcome.reason ?? (current.attempts === ACCOUNT_WORK_MAX_ATTEMPTS ? "retry_exhausted" : current.blocked);
        next = { ...next, blocked, nextAtMs: blocked === null ? current.nextAtMs : null };
      } else if (outcome.kind === "defer") {
        if (!(outcome.readyAtMs === null || time(outcome.readyAtMs))) throw new ContributionFault("invalid_input");
        next = { ...next, attempts: 0, nextAtMs: outcome.readyAtMs, blocked: outcome.readyAtMs === null ? "clock_limit" : null };
      }
    }
    this.#write(snapshot, attempt.kind, next, authority); return true;
  }
}
