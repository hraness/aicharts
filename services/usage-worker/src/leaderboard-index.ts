import { DurableObject } from "cloudflare:workers";
import { parseLeaderboardConsentApply } from "../../../lib/usage/consent-contract";
import {
  LEADERBOARD_INDEX_NAME, LEADERBOARD_MAX_MEMBERS,
  LEADERBOARD_RANKING, leaderboardDecimal, leaderboardPublicHandle,
  parseLeaderboardProjection, rankLeaderboardEntries,
  type LeaderboardSnapshotV1,
} from "../../../lib/usage/leaderboard-contract";
import { enrollmentAccount, enrollmentAccountName, enrollmentSnapshot, enrollmentTime } from "./enrollment-contract";

export { LEADERBOARD_INDEX_NAME };
/** How often a member's projection is re-verified at the account object. */
export const LEADERBOARD_REFRESH_MS = 21_600_000;
/** Bounded per-read/per-alarm refresh batch; reads never scan accounts. */
export const LEADERBOARD_REFRESHES_PER_CYCLE = 8;
export const LEADERBOARD_MAX_TOMBSTONES = 256;
const MAX_PAYLOAD = 131_072;
const SCHEMA_SQL = "CREATE TABLE leaderboard_index (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0), payload TEXT CHECK (payload IS NULL OR length(payload) <= 131072))";

type IndexProjection = Readonly<{
  observedTokens: string; usageRecords: number; windowFirstUtcDay: number; windowUtcDays: number;
}>;
/** Internal member record. `accountId` exists only to re-query the account
 * object and to remove the member on withdrawal; it is never emitted in the
 * public snapshot. `eventAtMs` is the newest consent-decision time the index
 * has applied and orders replays against tombstones. */
type IndexMember = {
  accountId: string; eventAtMs: number; consentedAtMs: number; publicHandle: string;
  refreshedAtMs: number; projection: IndexProjection | null;
};
type IndexTombstone = { accountId: string; eventAtMs: number };
type IndexState = { schemaVersion: 1; members: IndexMember[]; tombstones: IndexTombstone[] };
type IndexError = "invalid_input" | "unauthorized" | "recovery_required" | "clock_regressed"
  | "storage_invalid" | "storage_unavailable" | "limit";
type IndexResult<T> = { ok: true; value: T } | { ok: false; error: IndexError };
type VerifyVerdict = "remove" | "stale" | Readonly<{ update: Readonly<{
  consentedAtMs: number; publicHandle: string; projection: IndexProjection;
}> }>;
const ok = <T>(value: T): IndexResult<T> => ({ ok: true, value });
const err = (error: IndexError): IndexResult<never> => ({ ok: false, error });

function validProjection(value: unknown): value is IndexProjection {
  const projection = enrollmentSnapshot(value, ["observedTokens", "usageRecords", "windowFirstUtcDay", "windowUtcDays"]);
  return projection !== null && leaderboardDecimal(projection.observedTokens)
    && typeof projection.usageRecords === "number" && Number.isSafeInteger(projection.usageRecords)
    && projection.usageRecords >= 0 && projection.usageRecords <= 100_000
    && typeof projection.windowFirstUtcDay === "number" && Number.isSafeInteger(projection.windowFirstUtcDay)
    && projection.windowFirstUtcDay >= 0 && projection.windowFirstUtcDay <= 100_000_000
    && typeof projection.windowUtcDays === "number" && Number.isSafeInteger(projection.windowUtcDays)
    && projection.windowUtcDays >= 1 && projection.windowUtcDays <= 30;
}
function validMember(value: unknown): value is IndexMember {
  const member = enrollmentSnapshot(value, ["accountId", "eventAtMs", "consentedAtMs", "publicHandle", "refreshedAtMs", "projection"]);
  if (member === null || !enrollmentAccount(member.accountId)
    || !enrollmentTime(member.eventAtMs) || !enrollmentTime(member.consentedAtMs)
    || member.consentedAtMs > member.eventAtMs || !enrollmentTime(member.refreshedAtMs)
    || !leaderboardPublicHandle(member.publicHandle)) return false;
  return member.projection === null || validProjection(member.projection);
}
function evictTombstones(state: IndexState): void {
  state.tombstones.sort((a, b) => a.eventAtMs - b.eventAtMs);
  if (state.tombstones.length > LEADERBOARD_MAX_TOMBSTONES) {
    state.tombstones.splice(0, state.tombstones.length - LEADERBOARD_MAX_TOMBSTONES);
  }
}
function validIndexState(value: unknown): value is IndexState {
  const state = enrollmentSnapshot(value, ["schemaVersion", "members", "tombstones"]);
  if (state?.schemaVersion !== 1 || !Array.isArray(state.members) || state.members.length > LEADERBOARD_MAX_MEMBERS
    || !Array.isArray(state.tombstones) || state.tombstones.length > LEADERBOARD_MAX_TOMBSTONES) return false;
  const members = new Set<string>();
  for (const candidate of state.members) {
    if (!validMember(candidate) || members.has(candidate.accountId)) return false;
    members.add(candidate.accountId);
  }
  const tombstones = new Set<string>();
  for (const candidate of state.tombstones as unknown[]) {
    const tombstone = enrollmentSnapshot(candidate, ["accountId", "eventAtMs"]);
    if (tombstone === null || !enrollmentAccount(tombstone.accountId) || !enrollmentTime(tombstone.eventAtMs)
      || tombstones.has(tombstone.accountId as string)) return false;
    tombstones.add(tombstone.accountId as string);
  }
  return true;
}

/** workerd adds an own Symbol.dispose to object-valued RPC replies. */
function rpcSnapshot(raw: unknown): { envelope: Record<string, unknown> | null; dispose: (() => void) | null } {
  let dispose: (() => void) | null = null;
  try {
    if (raw === null || typeof raw !== "object") return { envelope: null, dispose };
    const disposal = Object.getOwnPropertyDescriptor(raw, Symbol.dispose);
    if (disposal !== undefined && "value" in disposal && typeof disposal.value === "function") {
      const method: (...args: unknown[]) => unknown = disposal.value;
      dispose = () => { Reflect.apply(method, raw, []); };
    }
    if (dispose === null || Object.getPrototypeOf(raw) !== Object.prototype) return { envelope: null, dispose };
    const names = Reflect.ownKeys(raw);
    if (names.length !== 3 || !names.includes(Symbol.dispose)) return { envelope: null, dispose };
    const envelope: Record<string, unknown> = Object.create(null);
    for (const name of names) {
      if (name === Symbol.dispose) continue;
      if (name !== "ok" && name !== "value" && name !== "error") return { envelope: null, dispose };
      const descriptor = Object.getOwnPropertyDescriptor(raw, name);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return { envelope: null, dispose };
      envelope[name] = descriptor.value as unknown;
    }
    return { envelope, dispose };
  } catch { return { envelope: null, dispose }; }
}

/**
 * Materialized public index. Public reads serve only the ranked snapshot this
 * object materializes — there is no account enumeration on the read path. The
 * members set changes only through fenced consent applies; each public read or
 * scheduled alarm re-verifies a bounded stale subset at the account objects,
 * so withdrawal without a delivered apply is still removed at the source.
 */
export class LeaderboardIndex extends DurableObject<Env> {
  #healthy = true;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      ctx.storage.transactionSync(() => {
        const objects = ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 4").toArray();
        if (objects.length === 0) {
          ctx.storage.sql.exec(SCHEMA_SQL);
          ctx.storage.sql.exec("INSERT INTO leaderboard_index (id, schema_version, revision, payload) VALUES (1, 1, 0, NULL)");
          return;
        }
        this.#schema();
      });
    } catch { this.#healthy = false; }
  }

  #schema(): void {
    const objects = this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 4").toArray();
    if (!this.#healthy || objects.length !== 1 || objects[0]?.type !== "table" || objects[0].name !== "leaderboard_index"
      || objects[0].sql !== SCHEMA_SQL) throw new Error("storage_invalid");
  }
  #stored(): { revision: number; state: IndexState } {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM leaderboard_index LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1 || row.schema_version !== 1 || typeof row.revision !== "number"
      || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) throw new Error("storage_invalid");
    if (row.payload === null) {
      if (row.revision !== 0) throw new Error("storage_invalid");
      return { revision: 0, state: { schemaVersion: 1, members: [], tombstones: [] } };
    }
    if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) throw new Error("storage_invalid");
    const parsed: unknown = JSON.parse(row.payload);
    if (!validIndexState(parsed)) throw new Error("storage_invalid");
    return { revision: row.revision as number, state: parsed };
  }
  #write(revision: number, state: IndexState): void {
    if (!validIndexState(state)) throw new Error("storage_invalid");
    const payload = JSON.stringify(state);
    if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
    this.ctx.storage.sql.exec("UPDATE leaderboard_index SET revision = ?, payload = ? WHERE id = 1", revision + 1, payload);
  }
  #identity(): boolean {
    try { return this.ctx.id.equals(this.env.PUBLIC_INDEX.idFromName(LEADERBOARD_INDEX_NAME)); }
    catch { return false; }
  }

  /** Apply one fenced consent decision. Stale replays at or before the newest
   * applied/removed event are no-ops; a grant upserts the member (projection
   * kept until re-verified), a withdrawal removes it and records a tombstone
   * so an older grant replay cannot resurrect it. */
  async applyConsent(input: unknown): Promise<IndexResult<Readonly<{ schemaVersion: 1 }>>> {
    try {
      const request = parseLeaderboardConsentApply(input);
      if (request === null) return err("invalid_input");
      if (!this.#identity()) return err("unauthorized");
      const now = Date.now();
      if (!enrollmentTime(now) || Object.is(now, -0)) return err("clock_regressed");
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { revision, state } = this.#stored();
        const member = state.members.find(candidate => candidate.accountId === request.accountId);
        const tombstone = state.tombstones.find(candidate => candidate.accountId === request.accountId);
        const prior = Math.max(member?.eventAtMs ?? -1, tombstone?.eventAtMs ?? -1);
        if (request.eventAtMs <= prior) return ok(Object.freeze({ schemaVersion: 1 as const }));
        if (request.consent === false) {
          // An authoritative withdrawal always removes the member and
          // tombstones at the decision time so an older grant replay cannot
          // resurrect it.
          state.members = state.members.filter(candidate => candidate.accountId !== request.accountId);
          state.tombstones = state.tombstones.filter(candidate => candidate.accountId !== request.accountId);
          state.tombstones.push({ accountId: request.accountId, eventAtMs: request.eventAtMs });
          evictTombstones(state);
          this.#write(revision, state);
          return ok(Object.freeze({ schemaVersion: 1 as const }));
        }
        if (member === undefined && state.members.length >= LEADERBOARD_MAX_MEMBERS) return err("limit");
        if (member !== undefined) {
          member.eventAtMs = request.eventAtMs;
          member.consentedAtMs = request.consentedAtMs as number;
          member.publicHandle = request.publicHandle as string;
        } else {
          state.members.push({ accountId: request.accountId, eventAtMs: request.eventAtMs,
            consentedAtMs: request.consentedAtMs as number, publicHandle: request.publicHandle as string,
            refreshedAtMs: 0, projection: null });
        }
        state.tombstones = state.tombstones.filter(candidate => candidate.accountId !== request.accountId);
        this.#write(revision, state);
        return ok(Object.freeze({ schemaVersion: 1 as const }));
      });
    } catch { return err("storage_unavailable"); }
  }

  /** One bounded source verification: consent is re-read at the account object.
   * Only affirmative evidence removes a member — `consent: false`, enrollment
   * loss, or a malformed authority reply. Transient failures keep the stale
   * entry; `refreshedAtMs` makes its age visible in every emitted row. */
  async #verify(accountId: string): Promise<VerifyVerdict> {
    let raw: unknown;
    try {
      raw = await this.env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId))
        .readLeaderboardProjection(Object.freeze({ schemaVersion: 1, accountId }));
    } catch { return "stale"; }
    const snapshot = rpcSnapshot(raw);
    try {
      if (snapshot.envelope === null || snapshot.dispose === null) return "remove";
      const success = snapshot.envelope;
      if (success.ok === true) {
        const projection = parseLeaderboardProjection(success.value);
        if (projection === null || projection.accountId !== accountId) return "remove";
        if (projection.consent === false) return "remove";
        return Object.freeze({ update: Object.freeze({
          consentedAtMs: projection.consentedAtMs, publicHandle: projection.publicHandle,
          projection: Object.freeze({ observedTokens: projection.observedTokens, usageRecords: projection.usageRecords,
            windowFirstUtcDay: projection.windowFirstUtcDay, windowUtcDays: projection.windowUtcDays }),
        }) });
      }
      if (success.ok === false && (success.error === "not_enrolled" || success.error === "unauthorized")) return "remove";
      return "stale";
    } finally { snapshot.dispose?.(); }
  }

  /** Bounded refresh cycle shared by reads and the scheduled alarm. Verdicts
   * apply only while the member's event ordering is unchanged. */
  async #refresh(now: number): Promise<void> {
    const stale = this.ctx.storage.transactionSync(() => {
      this.#schema();
      const { state } = this.#stored();
      return state.members
        .filter(member => member.projection === null || now - member.refreshedAtMs > LEADERBOARD_REFRESH_MS)
        .sort((a, b) => a.refreshedAtMs - b.refreshedAtMs)
        .slice(0, LEADERBOARD_REFRESHES_PER_CYCLE)
        .map(member => Object.freeze({ accountId: member.accountId, eventAtMs: member.eventAtMs }));
    });
    for (const target of stale) {
      const verdict = await this.#verify(target.accountId);
      this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { revision, state } = this.#stored();
        const member = state.members.find(candidate => candidate.accountId === target.accountId);
        if (member === undefined || member.eventAtMs !== target.eventAtMs) return;
        if (verdict === "stale") return;
        if (verdict === "remove") {
          // A verification removal records no tombstone: the source could not
          // affirm consent, so the member drops now, and a retried consent
          // apply at the same decision time can still self-heal later.
          state.members = state.members.filter(candidate => candidate.accountId !== target.accountId);
        } else {
          member.consentedAtMs = verdict.update.consentedAtMs;
          member.publicHandle = verdict.update.publicHandle;
          member.projection = verdict.update.projection;
          member.refreshedAtMs = now;
          member.eventAtMs = Math.max(member.eventAtMs, verdict.update.consentedAtMs);
        }
        this.#write(revision, state);
      });
    }
  }

  /** Public materialized read. Only the ranked snapshot leaves this object:
   * handles and numeric totals, never account or device identifiers. */
  async read(input: unknown): Promise<IndexResult<LeaderboardSnapshotV1>> {
    try {
      const request = enrollmentSnapshot(input, ["schemaVersion"]);
      if (request?.schemaVersion !== 1) return err("invalid_input");
      if (!this.#identity()) return err("unauthorized");
      const now = Date.now();
      if (!enrollmentTime(now) || Object.is(now, -0)) return err("clock_regressed");
      await this.#refresh(now);
      const snapshot = this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { state } = this.#stored();
        const rankables = state.members.filter(member => member.projection !== null).map(member => Object.freeze({
          publicHandle: member.publicHandle, observedTokens: (member.projection as IndexProjection).observedTokens,
          usageRecords: (member.projection as IndexProjection).usageRecords, consentedAtMs: member.consentedAtMs,
          refreshedAtMs: member.refreshedAtMs, windowFirstUtcDay: (member.projection as IndexProjection).windowFirstUtcDay,
          windowUtcDays: (member.projection as IndexProjection).windowUtcDays,
        }));
        return Object.freeze({ schemaVersion: 1 as const, ranking: LEADERBOARD_RANKING,
          computedAtMs: now, entries: rankLeaderboardEntries(rankables) });
      });
      // Keep a bounded periodic rebuild armed while members exist; each alarm
      // re-verifies the stale subset and re-arms only while work remains.
      const pending = this.ctx.storage.transactionSync(() => {
        this.#schema();
        return this.#stored().state.members.some(member => member.projection === null || now - member.refreshedAtMs > LEADERBOARD_REFRESH_MS);
      });
      try {
        if (pending) await this.ctx.storage.setAlarm(now + LEADERBOARD_REFRESH_MS);
      } catch { /* An unarmed alarm only delays the next bounded rebuild. */ }
      return ok(snapshot);
    } catch { return err("storage_unavailable"); }
  }

  /** Scheduled bounded rebuild; re-arms only while members still need refresh. */
  async alarm(): Promise<void> {
    try {
      if (!this.#identity()) return;
      const now = Date.now();
      if (!enrollmentTime(now) || Object.is(now, -0)) return;
      await this.#refresh(now);
      const pending = this.ctx.storage.transactionSync(() => {
        this.#schema();
        return this.#stored().state.members.some(member => member.projection === null || now - member.refreshedAtMs > LEADERBOARD_REFRESH_MS);
      });
      if (pending) await this.ctx.storage.setAlarm(now + LEADERBOARD_REFRESH_MS);
    } catch { /* Alarm failures retry on the next scheduled wake or read. */ }
  }
}
