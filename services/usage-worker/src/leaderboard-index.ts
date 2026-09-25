import { DurableObject } from "cloudflare:workers";
import { parseLeaderboardConsentApply } from "../../../lib/usage/consent-contract";
import {
  LEADERBOARD_INDEX_NAME, LEADERBOARD_MAX_MEMBERS, LEADERBOARD_MAX_RECORDS,
  LEADERBOARD_RANKING, leaderboardDecimal, leaderboardPublicHandle,
  parseLeaderboardProjection, rankLeaderboardEntries,
  type LeaderboardProjectionV1, type LeaderboardSnapshotV1,
} from "../../../lib/usage/leaderboard-contract";
import { enrollmentAccount, enrollmentAccountName, enrollmentHex, enrollmentRandom, enrollmentSnapshot, enrollmentTime } from "./enrollment-contract";
import { RESTORE_FENCE_LEASE_TTL_MS, restoreFenceName } from "./restore-fence";

export { LEADERBOARD_INDEX_NAME };
/** How often a member's projection is re-verified at the account object. */
export const LEADERBOARD_REFRESH_MS = 21_600_000;
/** Bounded per-alarm refresh batch; reads never contact accounts or write. */
export const LEADERBOARD_REFRESHES_PER_CYCLE = 8;
export const LEADERBOARD_RETRY_MS = 60_000;
/** Leave enough headroom to verify a full index before public rows expire. */
export const LEADERBOARD_RECHECK_MS = LEADERBOARD_REFRESH_MS
  - Math.ceil(LEADERBOARD_MAX_MEMBERS / LEADERBOARD_REFRESHES_PER_CYCLE) * LEADERBOARD_RETRY_MS;
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
  | "storage_invalid" | "storage_unavailable" | "limit" | "handle_unavailable";
type IndexResult<T> = { ok: true; value: T } | { ok: false; error: IndexError };
type Delivery = Readonly<{ eventAtMs: number; projection: LeaderboardProjectionV1 }>;
type Registration = Readonly<{ accountId: string; generation: string; epoch: number; workerVersion: string; token: string }>;
const ok = <T>(value: T): IndexResult<T> => ({ ok: true, value });
const err = (error: IndexError): IndexResult<never> => ({ ok: false, error });

function validProjection(value: unknown): value is IndexProjection {
  const projection = enrollmentSnapshot(value, ["observedTokens", "usageRecords", "windowFirstUtcDay", "windowUtcDays"]);
  return projection !== null && leaderboardDecimal(projection.observedTokens)
    && typeof projection.usageRecords === "number" && Number.isSafeInteger(projection.usageRecords)
    && projection.usageRecords >= 0 && projection.usageRecords <= LEADERBOARD_MAX_RECORDS
    && typeof projection.windowFirstUtcDay === "number" && Number.isSafeInteger(projection.windowFirstUtcDay)
    && projection.windowFirstUtcDay >= 0 && projection.windowFirstUtcDay <= 100_000_000
    && typeof projection.windowUtcDays === "number" && Number.isSafeInteger(projection.windowUtcDays)
    && projection.windowUtcDays >= 1 && projection.windowUtcDays <= 30
    && projection.windowFirstUtcDay + projection.windowUtcDays - 1 <= 100_000_000;
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
 * members set changes only through fenced consent applies; consent mutations and
 * scheduled alarms re-verify a bounded stale subset at the account objects,
 * so withdrawal without a delivered apply is still removed at the source.
 */
export class LeaderboardIndex extends DurableObject<Env> {
  #healthy = true;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Constructing this object for a public read never creates persistent state.
    try { this.#schema(); } catch { this.#healthy = false; }
  }

  #objects(): Record<string, SqlStorageValue>[] {
    return this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 4").toArray();
  }
  #schema(): void {
    const objects = this.#objects();
    if (!this.#healthy || (objects.length !== 0 && (objects.length !== 1 || objects[0]?.type !== "table"
      || objects[0].name !== "leaderboard_index" || objects[0].sql !== SCHEMA_SQL))) throw new Error("storage_invalid");
  }
  #initialize(): void {
    this.#schema();
    if (this.#objects().length === 0) {
      this.ctx.storage.sql.exec(SCHEMA_SQL);
      this.ctx.storage.sql.exec("INSERT INTO leaderboard_index (id, schema_version, revision, payload) VALUES (1, 1, 0, NULL)");
    }
  }
  #stored(): { revision: number; state: IndexState } {
    if (this.#objects().length === 0) return { revision: 0, state: { schemaVersion: 1, members: [], tombstones: [] } };
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
  #accountStamp(state: IndexState, accountId: string): string {
    return JSON.stringify([state.members.find(member => member.accountId === accountId) ?? null,
      state.tombstones.find(tombstone => tombstone.accountId === accountId) ?? null]);
  }

  /** This execution owns its registration independently of the account RPC
   * caller. A lost caller reply cannot release a still-running index update. */
  async #acquire(accountId: string): Promise<Registration | null> {
    const generation: unknown = this.env.USAGE_ENROLLMENT_GENERATION;
    const workerVersion: unknown = this.env.USAGE_WORKER_VERSION;
    if (!enrollmentHex(generation) || !enrollmentHex(workerVersion)) return null;
    const stub = this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    let epoch: number;
    let raw: unknown;
    try {
      raw = await stub.read({ accountId, generation });
      const { envelope, dispose } = rpcSnapshot(raw);
      try {
        const view = envelope?.ok === true ? enrollmentSnapshot(envelope.value, ["record", "inFlight", "observedAtMs"]) : null;
        const record = view === null ? null : enrollmentSnapshot(view.record,
          ["schemaVersion", "accountId", "generation", "epoch", "workerVersion", "phase", "established", "updatedAtMs"]);
        if (record?.schemaVersion !== 1 || record.accountId !== accountId || record.generation !== generation
          || record.workerVersion !== workerVersion || record.phase !== "open" || record.established !== true
          || typeof record.epoch !== "number" || !Number.isSafeInteger(record.epoch) || record.epoch < 0) return null;
        epoch = record.epoch;
      } finally { dispose?.(); }
    } catch { return null; }
    const attemptId = enrollmentRandom();
    const request = { accountId, generation, epoch, workerVersion, attemptId, leaseMs: RESTORE_FENCE_LEASE_TTL_MS };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = await stub.assertOpen(request);
        const { envelope, dispose } = rpcSnapshot(raw);
        try {
          const lease = envelope?.ok === true ? enrollmentSnapshot(envelope.value, ["token", "epoch", "established", "deadlineMs"]) : null;
          if (lease?.token === attemptId && lease.epoch === epoch && lease.established === true && enrollmentTime(lease.deadlineMs)) {
            return Object.freeze({ accountId, generation, epoch, workerVersion, token: attemptId });
          }
          if (envelope?.ok === false) break;
        } finally { dispose?.(); }
      } catch { /* Reconcile the same durable execution, never a replacement. */ }
    }
    // No index continuation has begun. Terminal cancellation prevents a late
    // reordered grant; an unavailable fence retains any uncertain holder.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = await stub.cancelAcquire({ accountId, generation, epoch, workerVersion, attemptId });
        const { envelope, dispose } = rpcSnapshot(raw);
        try { if (envelope?.ok === true && envelope.value === null) return null; }
        finally { dispose?.(); }
      } catch { /* Uncertain acquisition remains fail-closed. */ }
    }
    return null;
  }

  /** Release only after local SQL, alarm work, and every future canonical
   * continuation have ended. Source reads are pure even if their reply is lost. */
  async #settle(registration: Registration): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw: unknown = await this.env.RESTORE_FENCES.getByName(restoreFenceName(registration.accountId))
          .release({ accountId: registration.accountId, token: registration.token, committed: false });
        const { envelope, dispose } = rpcSnapshot(raw);
        try { if (envelope?.ok === true && envelope.value === null) return; }
        finally { dispose?.(); }
      } catch { /* A lost terminal reply reconciles this same decision. */ }
    }
  }

  /** A coherent account-owned decision and projection, never caller authority. */
  async #delivery(accountId: string): Promise<Delivery | null> {
    let raw: unknown;
    try {
      raw = await this.env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId))
        .readLeaderboardDelivery(Object.freeze({ schemaVersion: 1, accountId }));
    } catch { return null; }
    const { envelope, dispose } = rpcSnapshot(raw);
    try {
      const delivery = envelope?.ok === true ? enrollmentSnapshot(envelope.value, ["schemaVersion", "accountId", "eventAtMs", "projection"]) : null;
      if (delivery?.schemaVersion !== 1 || delivery.accountId !== accountId || !enrollmentTime(delivery.eventAtMs)) return null;
      const projection = parseLeaderboardProjection(delivery.projection);
      if (projection === null || projection.accountId !== accountId
        || (projection.consent && projection.consentedAtMs > delivery.eventAtMs)) return null;
      return Object.freeze({ eventAtMs: delivery.eventAtMs, projection });
    } finally { dispose?.(); }
  }

  /** The v1 apply is a reconciliation hint. Exact source confirmation and an
   * account projection comparison keep stale intent from acquiring a newer epoch. */
  async applyConsent(input: unknown): Promise<IndexResult<Readonly<{ schemaVersion: 1 }>>> {
    let registration: Registration | null = null;
    try {
      const request = parseLeaderboardConsentApply(input);
      if (request === null) return err("invalid_input");
      if (!this.#identity()) return err("unauthorized");
      registration = await this.#acquire(request.accountId);
      if (registration === null) return err("recovery_required");
      const before = this.ctx.storage.transactionSync(() => {
        this.#schema(); return this.#accountStamp(this.#stored().state, request.accountId);
      });
      const delivery = await this.#delivery(request.accountId);
      if (delivery === null) return err("storage_unavailable");
      const projection = delivery.projection;
      if (delivery.eventAtMs !== request.eventAtMs || projection.consent !== request.consent
        || (projection.consent && (projection.publicHandle !== request.publicHandle || projection.consentedAtMs !== request.consentedAtMs))) {
        return err("recovery_required");
      }
      const now = Date.now();
      if (!enrollmentTime(now) || Object.is(now, -0) || now < delivery.eventAtMs) return err("clock_regressed");
      const applied = this.ctx.storage.transactionSync(() => {
        this.#schema();
        const stored = this.#stored(), state = stored.state;
        // Another index decision during the source await wins. In particular,
        // a delayed source reply cannot undo a completed withdrawal. A fresh
        // retry can reconcile the current decision without rebinding old data.
        if (this.#accountStamp(state, request.accountId) !== before) return err("storage_unavailable");
        const member = state.members.find(candidate => candidate.accountId === request.accountId);
        if (projection.consent === false) {
          state.members = state.members.filter(candidate => candidate.accountId !== request.accountId);
          state.tombstones = state.tombstones.filter(candidate => candidate.accountId !== request.accountId);
          state.tombstones.push({ accountId: request.accountId, eventAtMs: delivery.eventAtMs });
          evictTombstones(state);
        } else {
          if (state.members.some(candidate => candidate.accountId !== request.accountId
            && candidate.publicHandle === projection.publicHandle)) return err("handle_unavailable");
          if (member === undefined && state.members.length >= LEADERBOARD_MAX_MEMBERS) return err("limit");
          const verified: IndexMember = { accountId: request.accountId, eventAtMs: delivery.eventAtMs,
            consentedAtMs: projection.consentedAtMs, publicHandle: projection.publicHandle,
            refreshedAtMs: now, projection: this.#numericProjection(projection) };
          state.members = state.members.filter(candidate => candidate.accountId !== request.accountId);
          state.members.push(verified);
          state.tombstones = state.tombstones.filter(candidate => candidate.accountId !== request.accountId);
        }
        this.#initialize();
        this.#write(stored.revision, state);
        return ok(Object.freeze({ schemaVersion: 1 as const }));
      });
      if (!applied.ok) return applied;
      await this.#schedule(now);
      return applied;
    } catch { return err("storage_unavailable"); }
    finally { if (registration !== null) await this.#settle(registration); }
  }

  #numericProjection(projection: Extract<LeaderboardProjectionV1, { consent: true }>): IndexProjection {
    return Object.freeze({ observedTokens: projection.observedTokens, usageRecords: projection.usageRecords,
      windowFirstUtcDay: projection.windowFirstUtcDay, windowUtcDays: projection.windowUtcDays });
  }

  /** Each account refresh owns a registration independent of its alarm caller.
   * Persisted order rotates attempted accounts, including unavailable sources.
   * Account comparison prevents delayed replies from replacing newer state. */
  async #refresh(now: number): Promise<boolean> {
    const stale = this.ctx.storage.transactionSync(() => {
      this.#schema();
      return this.#stored().state.members.filter(member => member.projection === null
        || now - member.refreshedAtMs >= LEADERBOARD_RECHECK_MS)
        .map(member => member.accountId);
    });
    let scheduled = false, refreshed = 0;
    for (const accountId of stale) {
      if (refreshed >= LEADERBOARD_REFRESHES_PER_CYCLE) break;
      const registration = await this.#acquire(accountId);
      if (registration === null) continue;
      refreshed++;
      try {
        const before = this.ctx.storage.transactionSync(() => {
          this.#schema(); return this.#accountStamp(this.#stored().state, accountId);
        });
        const delivery = await this.#delivery(accountId);
        const current = Date.now();
        if (!enrollmentTime(current) || Object.is(current, -0) || current < now
          || (delivery !== null && current < delivery.eventAtMs)) throw new Error("clock_regressed");
        this.ctx.storage.transactionSync(() => {
          this.#schema();
          const stored = this.#stored(), state = stored.state;
          if (this.#accountStamp(state, accountId) !== before) return;
          const member = state.members.find(candidate => candidate.accountId === accountId);
          if (member === undefined) return;
          state.members = state.members.filter(candidate => candidate.accountId !== accountId);
          if (delivery?.projection.consent === false) {
            state.tombstones = state.tombstones.filter(candidate => candidate.accountId !== accountId);
            state.tombstones.push({ accountId, eventAtMs: delivery.eventAtMs });
            evictTombstones(state);
          } else {
            state.members.push(member);
            if (delivery !== null && delivery.projection.consent) {
              const projection = delivery.projection;
              if (state.members.some(candidate => candidate.accountId !== accountId && candidate.publicHandle === projection.publicHandle)) {
                member.projection = null;
              } else {
                member.eventAtMs = delivery.eventAtMs;
                member.consentedAtMs = projection.consentedAtMs;
                member.publicHandle = projection.publicHandle;
                member.projection = this.#numericProjection(projection);
                member.refreshedAtMs = current;
              }
            }
          }
          this.#write(stored.revision, state);
        });
        await this.#schedule(current);
        scheduled = true;
      } finally { await this.#settle(registration); }
    }
    return scheduled;
  }

  /** Keep periodic verification alive even when the current batch is complete.
   * Backlogs retry after one minute, rather than one full freshness interval. */
  async #schedule(now: number): Promise<void> {
    const next = this.ctx.storage.transactionSync(() => {
      this.#schema();
      const { state } = this.#stored();
      if (state.members.length === 0) return null;
      return Math.min(...state.members.map(member => member.projection === null
        || now - member.refreshedAtMs >= LEADERBOARD_RECHECK_MS
        ? now + LEADERBOARD_RETRY_MS : member.refreshedAtMs + LEADERBOARD_RECHECK_MS));
    });
    if (next === null) { await this.ctx.storage.deleteAlarm(); return; }
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing <= now || next < existing) await this.ctx.storage.setAlarm(next);
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
      const snapshot = this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { state } = this.#stored();
        const rankables = state.members.filter(member => member.projection !== null
          && member.refreshedAtMs <= now && now - member.refreshedAtMs <= LEADERBOARD_REFRESH_MS).map(member => Object.freeze({
          publicHandle: member.publicHandle, observedTokens: (member.projection as IndexProjection).observedTokens,
          usageRecords: (member.projection as IndexProjection).usageRecords, consentedAtMs: member.consentedAtMs,
          refreshedAtMs: member.refreshedAtMs, windowFirstUtcDay: (member.projection as IndexProjection).windowFirstUtcDay,
          windowUtcDays: (member.projection as IndexProjection).windowUtcDays,
        }));
        return Object.freeze({ schemaVersion: 1 as const, ranking: LEADERBOARD_RANKING,
          computedAtMs: now, entries: rankLeaderboardEntries(rankables) });
      });
      return ok(snapshot);
    } catch { return err("storage_unavailable"); }
  }

  /** Scheduled bounded rebuild; retains a future wake while members exist. */
  async alarm(): Promise<void> {
    try {
      if (!this.#identity()) return;
      const now = Date.now();
      if (!enrollmentTime(now) || Object.is(now, -0)) return;
      const accounts = this.ctx.storage.transactionSync(() => {
        this.#schema(); return this.#stored().state.members.map(member => member.accountId);
      });
      // An absent/empty index needs no initialization or alarm mutation.
      if (accounts.length === 0 || await this.#refresh(now)) return;
      // Fresh members still need their next wake, owned by a current account
      // registration. A closed fence cannot be bypassed merely to rearm work.
      for (const accountId of accounts) {
        const registration = await this.#acquire(accountId);
        if (registration === null) continue;
        try {
          const current = Date.now();
          if (!enrollmentTime(current) || Object.is(current, -0) || current < now) throw new Error("clock_regressed");
          await this.#schedule(current); return;
        }
        finally { await this.#settle(registration); }
      }
      throw new Error("leaderboard_refresh_unavailable");
    } catch {
      // A thrown alarm is retried by the runtime; swallowing this failure can
      // permanently stop updates after a transient storage outage.
      throw new Error("leaderboard_refresh_unavailable");
    }
  }

  /** Pure account-scoped membership read for lifecycle status. It reports
   * whether the account is a current member and, once a waitlist exists, its
   * position; it never contacts the account object or writes. */
  async readMembership(input: unknown): Promise<IndexResult<Readonly<{ schemaVersion: 1; member: boolean; waitlist: Readonly<{ position: number; total: number }> | null }>>> {
    try {
      const request = enrollmentSnapshot(input, ["schemaVersion", "accountId"]);
      if (request?.schemaVersion !== 1 || !enrollmentAccount(request.accountId)) return err("invalid_input");
      if (!this.#identity()) return err("unauthorized");
      const accountId = request.accountId;
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { state } = this.#stored();
        return ok(Object.freeze({ schemaVersion: 1 as const, member: state.members.some(member => member.accountId === accountId), waitlist: null }));
      });
    } catch { return err("storage_unavailable"); }
  }
}
