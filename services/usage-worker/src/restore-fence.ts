import { DurableObject } from "cloudflare:workers";
import { enrollmentAccount, enrollmentHex, enrollmentRandom, enrollmentSnapshot, enrollmentTime } from "./enrollment-contract";

export type RestoreFenceError = "invalid_input" | "unauthorized" | "not_found" | "recovery_required"
  | "conflict" | "expired" | "storage_invalid" | "storage_unavailable" | "clock_regressed" | "limit";
export type RestoreFenceResult<T> = { ok: true; value: T } | { ok: false; error: RestoreFenceError };

/** Active Worker deployment identity. Pinned by the operator at publish time; a
 * routine redeploy keeps the same value. Presented per operation so a restored
 * or mismatched deployment cannot commit under a stale authority. */
export type RestoreFenceDeployment = Readonly<{ workerVersion: string }>;

export type RestoreFencePhase = "open" | "closed";

/** One append-only account/generation authority record. `epoch` only ever moves
 * forward through `publish`; `phase` is the open/closed state the runbook
 * requires. `established` records that the account committed durable state at
 * least once under this generation, so a wiped account object cannot silently
 * re-run genesis while the fence still claims the account exists. */
export type RestoreFenceRecord = Readonly<{
  schemaVersion: 1;
  accountId: string;
  generation: string;
  epoch: number;
  workerVersion: string;
  phase: RestoreFencePhase;
  established: boolean;
  updatedAtMs: number;
}>;

export type RestoreFenceView = Readonly<{ record: RestoreFenceRecord | null; inFlight: number; observedAtMs: number }>;

/** A granted provider-operation lease. The token is a one-time release handle;
 * the deadline bounds a crashed Worker's outstanding lease so the drain barrier
 * can always finish after the worst-case operation latency. `epoch` and
 * `established` are the authoritative values at grant time; the lease pins the
 * epoch because a closed fence cannot publish while any lease is outstanding. */
export type RestoreFenceLease = Readonly<{ token: string; epoch: number; established: boolean; deadlineMs: number }>;

/** The authoritative values a granted lease observed, handed to the account
 * object's transaction so it can cross-check its own recorded epoch and refuse
 * a wiped-but-established genesis. Shared with the admission boundary without
 * importing the account object. */
export type FenceObservation = Readonly<{ epoch: number; established: boolean }>;

export const RESTORE_FENCE_GENESIS_EPOCH = 0;
export const RESTORE_FENCE_LEASE_TTL_MS = 30_000;
export const RESTORE_FENCE_MAX_LEASES = 64;
const MAX_PAYLOAD = 65_536;
const RECORD_SQL = "CREATE TABLE restore_fence (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0), payload TEXT CHECK (payload IS NULL OR length(payload) <= 65536))";
const LEASE_SQL = "CREATE TABLE fence_lease (token BLOB PRIMARY KEY CHECK (length(token) = 32), deadline_ms INTEGER NOT NULL CHECK (deadline_ms >= 0))";
const tokenBytes = (token: string): Uint8Array => Uint8Array.from(token.match(/../gu) ?? [], pair => Number.parseInt(pair, 16));

const ok = <T>(value: T): RestoreFenceResult<T> => ({ ok: true, value });
const err = (error: RestoreFenceError): RestoreFenceResult<never> => ({ ok: false, error });

function validRecord(value: unknown): value is RestoreFenceRecord {
  const record = enrollmentSnapshot(value, ["schemaVersion", "accountId", "generation", "epoch", "workerVersion", "phase", "established", "updatedAtMs"]);
  return record !== null && record.schemaVersion === 1 && enrollmentAccount(record.accountId) && enrollmentHex(record.generation)
    && enrollmentHex(record.workerVersion) && (record.phase === "open" || record.phase === "closed")
    && (record.established === true || record.established === false) && enrollmentTime(record.updatedAtMs)
    && typeof record.epoch === "number" && Number.isSafeInteger(record.epoch) && record.epoch >= RESTORE_FENCE_GENESIS_EPOCH;
}

function fenceSnapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const disposal = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (disposal !== undefined && !("value" in disposal && typeof disposal.value === "function")) return null;
    const owned = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === Symbol.dispose) continue;
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) return null;
      owned[key] = descriptor.value as unknown;
    }
    return enrollmentSnapshot(owned, keys);
  } catch { return null; }
}

/** Stable across restore epochs; an epoch transition must never rebind the fence. */
export const restoreFenceName = (accountId: string): string => `restore-fence-v1:${accountId}`;

/**
 * External append-only restore authority, separately stored from the account
 * Durable Object and the R2 control/record buckets. The Worker adapter holds a
 * provider-operation lease across each mutating operation; the operator holds
 * close, drain, reconcile and publish. Public routing stays closed.
 */
export class RestoreFence extends DurableObject<Env> {
  #healthy = true;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      ctx.storage.transactionSync(() => {
        const objects = this.#objects();
        if (objects.length === 0) {
          ctx.storage.sql.exec(RECORD_SQL);
          ctx.storage.sql.exec(LEASE_SQL);
          ctx.storage.sql.exec("INSERT INTO restore_fence (id, schema_version, revision, payload) VALUES (1, 1, 0, NULL)");
        }
        this.#schema();
      });
    } catch { this.#healthy = false; }
  }

  #objects(): Record<string, SqlStorageValue>[] {
    return this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 8").toArray();
  }
  #schema(): void {
    const objects = this.#objects();
    const expected: Record<string, string> = { restore_fence: RECORD_SQL, fence_lease: LEASE_SQL };
    if (!this.#healthy || objects.length !== 2 || objects.some(object => object.type !== "table"
      || typeof object.name !== "string" || !Object.hasOwn(expected, object.name) || object.sql !== expected[object.name])) throw new Error("storage_invalid");
  }
  /** The Worker deployment version this fence instance is running under. */
  #workerVersion(): string | null {
    const value: unknown = this.env.USAGE_WORKER_VERSION;
    return enrollmentHex(value) ? value : null;
  }
  #stored(): { revision: number; record: RestoreFenceRecord | null } {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM restore_fence LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1 || row.schema_version !== 1 || typeof row.revision !== "number"
      || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) throw new Error("storage_invalid");
    if (row.payload === null) {
      if (row.revision !== 0) throw new Error("storage_invalid");
      return { revision: row.revision, record: null };
    }
    if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) throw new Error("storage_invalid");
    const parsed: unknown = JSON.parse(row.payload);
    if (!validRecord(parsed) || !this.ctx.id.equals(this.env.RESTORE_FENCES.idFromName(restoreFenceName(parsed.accountId)))) throw new Error("storage_invalid");
    return { revision: row.revision, record: parsed };
  }

  /** Drop leases whose deadline passed; a crashed or over-running operation can
   * never hold the drain barrier open indefinitely. */
  #expireLeases(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM fence_lease WHERE deadline_ms <= ?", now);
  }
  #inFlight(): number {
    const rows = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM fence_lease").toArray();
    const count = rows[0]?.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > RESTORE_FENCE_MAX_LEASES) throw new Error("storage_invalid");
    return count;
  }
  #write(revision: number, record: RestoreFenceRecord): void {
    const payload = JSON.stringify(record);
    if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
    this.ctx.storage.sql.exec("UPDATE restore_fence SET revision = ?, payload = ? WHERE id = 1", revision + 1, payload);
  }

  #transaction<T>(accountId: string, run: (record: RestoreFenceRecord | null, revision: number, now: number) => RestoreFenceResult<T>): RestoreFenceResult<T> {
    try {
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        const now = Date.now();
        if (!enrollmentTime(now) || Object.is(now, -0)) return err("clock_regressed");
        this.#expireLeases(now);
        const { revision, record } = this.#stored();
        if (record !== null && (record.accountId !== accountId || record.updatedAtMs > now)) return err("clock_regressed");
        return run(record, revision, now);
      });
    } catch { return err("storage_invalid"); }
  }

  #account(input: unknown): { accountId: string; generation: string } | null {
    const value = fenceSnapshot(input, ["accountId", "generation"]);
    return value !== null && enrollmentAccount(value.accountId) && enrollmentHex(value.generation)
      && this.ctx.id.equals(this.env.RESTORE_FENCES.idFromName(restoreFenceName(value.accountId)))
      ? { accountId: value.accountId, generation: value.generation } : null;
  }

  /** Operator/adapter view of current authority. Absent record means the account
   * has never been seen under any epoch — not proof that a restored account is new. */
  async read(input: unknown): Promise<RestoreFenceResult<RestoreFenceView>> {
    const account = this.#account(input);
    if (account === null) return err("invalid_input");
    return this.#transaction(account.accountId, (record, _revision, now) =>
      record !== null && record.generation !== account.generation
        ? err("recovery_required")
        : ok(Object.freeze({ record, inFlight: this.#inFlight(), observedAtMs: now })));
  }

  /**
   * Acquire a provider-operation lease. Fails closed unless the fence is open,
   * the expected epoch and active Worker version match, and the generation
   * binds. A first contact under a fresh generation initializes epoch zero.
   * A wiped-but-established account is refused until an operator republishes.
   */
  async assertOpen(input: unknown): Promise<RestoreFenceResult<RestoreFenceLease>> {
    const value = fenceSnapshot(input, ["accountId", "generation", "epoch", "workerVersion", "leaseMs"]);
    if (value === null || !enrollmentAccount(value.accountId) || !enrollmentHex(value.generation)
      || !enrollmentHex(value.workerVersion) || typeof value.epoch !== "number" || !Number.isSafeInteger(value.epoch)
      || value.epoch < RESTORE_FENCE_GENESIS_EPOCH || typeof value.leaseMs !== "number" || !Number.isSafeInteger(value.leaseMs)
      || value.leaseMs <= 0 || value.leaseMs > RESTORE_FENCE_LEASE_TTL_MS) return err("invalid_input");
    const accountId = value.accountId, generation = value.generation, epoch = value.epoch, leaseMs = value.leaseMs;
    if (!this.ctx.id.equals(this.env.RESTORE_FENCES.idFromName(restoreFenceName(accountId)))) return err("unauthorized");
    const workerVersion = this.#workerVersion();
    if (workerVersion === null || workerVersion !== value.workerVersion) return err("recovery_required");
    return this.#transaction<RestoreFenceLease>(accountId, (record, revision, now) => {
      if (record === null) {
        if (epoch !== RESTORE_FENCE_GENESIS_EPOCH) return err("recovery_required");
        const created: RestoreFenceRecord = Object.freeze({ schemaVersion: 1, accountId,
          generation, epoch: RESTORE_FENCE_GENESIS_EPOCH, workerVersion, phase: "open",
          established: false, updatedAtMs: now });
        return this.#grant(created, revision, now, leaseMs);
      }
      if (record.generation !== generation) return err("recovery_required");
      if (record.phase !== "open") return err("recovery_required");
      if (record.epoch !== epoch || record.workerVersion !== workerVersion) return err("recovery_required");
      return this.#grant(record, revision, now, leaseMs);
    });
  }
  #grant(record: RestoreFenceRecord, revision: number, now: number, leaseMs: number): RestoreFenceResult<RestoreFenceLease> {
    if (this.#inFlight() >= RESTORE_FENCE_MAX_LEASES) return err("limit");
    const token = enrollmentRandom(), deadlineMs = now + leaseMs;
    this.ctx.storage.sql.exec("INSERT INTO fence_lease (token, deadline_ms) VALUES (?, ?)", tokenBytes(token), deadlineMs);
    this.#write(revision, { ...record, updatedAtMs: now });
    return ok(Object.freeze({ token, epoch: record.epoch, established: record.established, deadlineMs }));
  }

  /** Settle a lease. `committed` marks a mutating operation that durably wrote;
   * the first committed mutation establishes the account under this generation. */
  async release(input: unknown): Promise<RestoreFenceResult<null>> {
    const value = fenceSnapshot(input, ["accountId", "token", "committed"]);
    if (value === null || !enrollmentAccount(value.accountId) || !enrollmentHex(value.token)
      || (value.committed !== true && value.committed !== false)) return err("invalid_input");
    if (!this.ctx.id.equals(this.env.RESTORE_FENCES.idFromName(restoreFenceName(value.accountId)))) return err("unauthorized");
    return this.#transaction<null>(value.accountId, (record, revision, now) => {
      this.ctx.storage.sql.exec("DELETE FROM fence_lease WHERE token = ?", tokenBytes(value.token as string));
      if (record !== null && value.committed === true && record.established === false) {
        this.#write(revision, { ...record, established: true, updatedAtMs: now });
      }
      return ok(null);
    });
  }

  /**
   * Begin closing the current epoch: refuse new leases and report the drain
   * count. The operator waits for in-flight operations to settle, restores both
   * stores, then publishes a strictly greater epoch. Closing an already closed
   * epoch is idempotent so an uncertain close reconciles on readback.
   */
  async close(input: unknown): Promise<RestoreFenceResult<RestoreFenceView>> {
    const value = fenceSnapshot(input, ["accountId", "generation", "epoch", "workerVersion"]);
    if (value === null || !enrollmentAccount(value.accountId) || !enrollmentHex(value.generation)
      || !enrollmentHex(value.workerVersion) || typeof value.epoch !== "number" || !Number.isSafeInteger(value.epoch)) return err("invalid_input");
    if (!this.ctx.id.equals(this.env.RESTORE_FENCES.idFromName(restoreFenceName(value.accountId)))) return err("unauthorized");
    const workerVersion = this.#workerVersion();
    if (workerVersion === null) return err("recovery_required");
    return this.#transaction<RestoreFenceView>(value.accountId, (record, revision, now) => {
      if (record === null || record.generation !== value.generation) return err("recovery_required");
      if (record.epoch !== value.epoch) return err("recovery_required");
      if (record.phase === "closed") {
        return ok(Object.freeze({ record, inFlight: this.#inFlight(), observedAtMs: now }));
      }
      const closed: RestoreFenceRecord = Object.freeze({ ...record, phase: "closed", updatedAtMs: now });
      this.#write(revision, closed);
      return ok(Object.freeze({ record: closed, inFlight: this.#inFlight(), observedAtMs: now }));
    });
  }

  /**
   * Reopen at a strictly greater epoch after both stores reconcile. Requires a
   * closed, fully drained fence; the restored object can never reach this call
   * itself, so a rollback cannot reopen. Idempotent on readback of the same
   * epoch so an uncertain publish reconciles instead of retrying blindly.
   */
  async publish(input: unknown): Promise<RestoreFenceResult<RestoreFenceView>> {
    const value = fenceSnapshot(input, ["accountId", "generation", "epoch", "workerVersion"]);
    if (value === null || !enrollmentAccount(value.accountId) || !enrollmentHex(value.generation)
      || !enrollmentHex(value.workerVersion) || typeof value.epoch !== "number" || !Number.isSafeInteger(value.epoch)) return err("invalid_input");
    if (!this.ctx.id.equals(this.env.RESTORE_FENCES.idFromName(restoreFenceName(value.accountId)))) return err("unauthorized");
    return this.#transaction<RestoreFenceView>(value.accountId, (record, revision, now) => {
      if (record === null || record.generation !== value.generation) return err("recovery_required");
      if (record.phase === "open" && record.epoch === value.epoch && record.workerVersion === value.workerVersion) {
        return ok(Object.freeze({ record, inFlight: this.#inFlight(), observedAtMs: now }));
      }
      if (record.phase !== "closed") return err("recovery_required");
      if (this.#inFlight() !== 0) return err("recovery_required");
      if ((value.epoch as number) <= record.epoch) return err("recovery_required");
      const reopened: RestoreFenceRecord = Object.freeze({ ...record, epoch: value.epoch as number,
        workerVersion: value.workerVersion as string, phase: "open", updatedAtMs: now });
      this.#write(revision, reopened);
      return ok(Object.freeze({ record: reopened, inFlight: 0, observedAtMs: now }));
    });
  }
}
