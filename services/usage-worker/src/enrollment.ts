import { DurableObject } from "cloudflare:workers";
import { parseStatsQuery, parseStatsStatusRequest, parseStatsUpload, type StatsError, type StatsReceipt, type StatsResult, type StatsStatus } from "../../../lib/usage/stats-http-contract";
import { parseStatsAbandonRequest, type StatsAbandonment } from "../../../lib/usage/stats-http-contract";
import type { UsageStatsReport } from "../../../lib/usage/stats-contract";
import { StatsState, StatsFault, STATS_SCHEMA } from "./stats-state";
import { AccountStats } from "./stats-admission";
import { createHash } from "node:crypto";
import { type AdmissionBatch } from "../../../lib/usage/admission";
import { AccountAdmission, type AdmissionObservation } from "./account-admission";
import { AdmissionFault, batchAccount, ownedAdmissionBatch } from "./admission-policy";
import { ADMISSION_SCHEMA } from "./admission-schema";
import { AdmissionState, type AdmissionControl } from "./admission-state";
import { parsePrivateDaysRequest, type PrivateDaysV1 } from "../../../lib/usage/private-days-contract";
import {
  LEADERBOARD_INDEX_NAME, LEADERBOARD_WINDOW_DAYS, leaderboardPublicHandle,
  type LeaderboardConsentViewV1, type LeaderboardProjectionV1,
} from "../../../lib/usage/leaderboard-contract";
import { parseUsageConsentRequest } from "../../../lib/usage/consent-contract";
import { DAY_MS } from "../../../lib/usage/wire";
import {
  enrollmentAccount, enrollmentAccountName, enrollmentHex, enrollmentRandom,
  enrollmentSnapshot, enrollmentTime, parseEnrollmentProof, parseEnrollmentReservation,
  type EnrollmentProof, type EnrollmentReservation,
} from "./enrollment-contract";
import {
  ensureNamespaceAnchor, enrollmentStorageCall, readNamespaceAnchor, sameNamespaceAnchor, type NamespaceAnchor,
} from "./namespace-anchor";
import {
  RESTORE_FENCE_GENESIS_EPOCH, RESTORE_FENCE_LEASE_TTL_MS, restoreFenceName,
  type FenceObservation,
} from "./restore-fence";

export type EnrollmentError = "invalid_input" | "unavailable" | "unauthorized" | "not_reserved" | "not_enrolled"
  | StatsError | "expired" | "conflict" | "recovery_required" | "revoked" | "storage_invalid" | "storage_unavailable" | "clock_regressed" | "limit" | "handle_unavailable" | "publishing_full";
export type EnrollmentResult<T> = { ok: true; value: T } | { ok: false; error: EnrollmentError };
export type EnrollmentReceipt = Readonly<{
  schemaVersion: 1; accountId: string; intentId: string; reservationId: string;
  deviceId: string; enrolledAtMs: number; namespaceVersion: 1;
}>;
export type EnrollmentView = Readonly<{ receipt: EnrollmentReceipt; deviceState: "active" | "revoked" }>;
/** Nonsecret, account-owned control snapshot for a trusted coordinator.
 * Namespace keys, credential preimages and source content are deliberately absent. */
export type EnrollmentStatus = Readonly<{
  schemaVersion: 1; accountId: string; generation: string; phase: "pending" | "active";
  stateRevision: number; admissionRevision: number; admissionCommittedAtMs: number | null;
  admissionObservedAtMs: number; headCount: number; liveCount: number; quarantined: boolean;
  devices: readonly EnrollmentView[];
}>;
type Device = { reservation: EnrollmentReservation; deviceId: string; enrolledAtMs: number; revokedAtMs: number | null };
type GenesisCompletion = { mode: "original" | "fresh-recovery"; intentId: string; reservationId: string; completedAtMs: number };
/** Account-owned public-publishing consent. `changedAtMs` is the recorded
 * commit time of the latest decision; it orders replays at the index and is
 * never part of the public projection. `consentedAtMs` is the latest grant
 * commit time, `null` whenever consent is off. */
type LeaderboardState = {
  consent: boolean; consentedAtMs: number | null; publicHandle: string | null; changedAtMs: number;
};
type State = {
  accountId: string; generation: string; observedAtMs: number; phase: "pending" | "active";
  // The restore epoch this state last committed under. `null` marks a
  // migrated pre-fence payload that adopts the authoritative epoch on first
  // fenced contact; a real epoch must match the fence's or the account is
  // stale (restored) and must refuse recovery_required.
  fenceEpoch: number | null; anchor: NamespaceAnchor; devices: Device[]; genesisCompletion: GenesisCompletion | null;
  leaderboard: LeaderboardState;
};
// `fence`/`leaseToken`/`committed` are the request-scoped restore-fence
// context: `fence` is the authoritative epoch/established the lease pinned,
// `leaseToken` the one-time release handle, `committed` the mutable cell the
// transaction sets when it durably writes. All null/false for a read.
type Operation = {
  proof: EnrollmentProof; grant: EnrollmentReservation; generation: string; observed: number;
  fence: FenceObservation | null; leaseToken: string | null; committed: boolean;
};
export const MAX_ENROLLED_DEVICES = 128; // Includes revoked receipts; never evict identity to reclaim a slot.
const MAX_PAYLOAD = 131_072;
const SCHEMA_SQL = "CREATE TABLE account_enrollment (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0), payload TEXT CHECK (payload IS NULL OR length(payload) <= 131072))";
const ok = <T>(value: T): EnrollmentResult<T> => ({ ok: true, value });
const err = (error: EnrollmentError): EnrollmentResult<never> => ({ ok: false, error });

function deviceIdFor(grant: EnrollmentReservation): string {
  return createHash("sha256").update(["aicharts:enrollment:v1", "device", grant.accountId, grant.intentId, grant.reservationId].join("\0")).digest("hex");
}

function sameGrant(left: EnrollmentReservation, right: EnrollmentReservation): boolean {
  return left.schemaVersion === right.schemaVersion && left.intentId === right.intentId && left.accountId === right.accountId
    && left.reservationId === right.reservationId && left.pollCommitment === right.pollCommitment
    && left.uploadCommitment === right.uploadCommitment && left.recoveryGeneration === right.recoveryGeneration
    && left.reservedAtMs === right.reservedAtMs && left.expiresAtMs === right.expiresAtMs;
}

// legacy=true is used only by the additive constructor migration. No legacy
// shape is admitted to an operation before deriving and validating completion.
// fence=false reads the schema-version-2/3 payload, which predates the
// restore-epoch field; fence=true reads and admits only the schema-4+ shape.
// leaderboard=false reads the schema-≤4 payload, which predates consent;
// leaderboard=true admits only the current schema-5 shape. These flags exist
// solely so additive migrations can load older rows.
function validState(value: unknown, legacy = false, fence = true, leaderboard = true): value is State {
  const state = enrollmentSnapshot(value, ["accountId", "generation", "observedAtMs", "phase", ...(fence ? ["fenceEpoch"] : []), "anchor", "devices", ...(legacy ? [] : ["genesisCompletion"]), ...(leaderboard ? ["leaderboard"] : [])]);
  if (state === null || !enrollmentAccount(state.accountId) || !enrollmentHex(state.generation) || !enrollmentTime(state.observedAtMs)
    || (state.phase !== "pending" && state.phase !== "active") || !Array.isArray(state.devices)
    || state.devices.length > MAX_ENROLLED_DEVICES || (state.phase === "pending") !== (state.devices.length === 0)) return false;
  if (fence && !(state.fenceEpoch === null || (typeof state.fenceEpoch === "number" && Number.isSafeInteger(state.fenceEpoch) && state.fenceEpoch >= 0))) return false;
  if (leaderboard && !validLeaderboard(state.leaderboard, state.observedAtMs)) return false;
  const anchor = enrollmentSnapshot(state.anchor, ["accountId", "namespaceKey", "intentId", "reservationId", "generation", "createdAtMs"]);
  if (anchor === null || anchor.accountId !== state.accountId || anchor.generation !== state.generation
    || !enrollmentHex(anchor.namespaceKey) || !enrollmentHex(anchor.intentId) || !enrollmentHex(anchor.reservationId)
    || !enrollmentTime(anchor.createdAtMs) || anchor.createdAtMs > state.observedAtMs) return false;
  const intentIds = new Set<string>();
  const deviceIds = new Set<string>();
  for (const raw of state.devices as unknown[]) {
    const device = enrollmentSnapshot(raw, ["reservation", "deviceId", "enrolledAtMs", "revokedAtMs"]);
    if (device === null) return false;
    const grant = parseEnrollmentReservation(device.reservation);
    if (grant === null || grant.accountId !== state.accountId || grant.recoveryGeneration !== state.generation
      || device.deviceId !== deviceIdFor(grant) || deviceIds.has(device.deviceId) || intentIds.has(grant.intentId)
      || !enrollmentTime(device.enrolledAtMs) || device.enrolledAtMs < grant.reservedAtMs
      || device.enrolledAtMs < anchor.createdAtMs || device.enrolledAtMs >= grant.expiresAtMs || device.enrolledAtMs > state.observedAtMs
      || !(device.revokedAtMs === null || (enrollmentTime(device.revokedAtMs)
        && device.revokedAtMs >= device.enrolledAtMs && device.revokedAtMs <= state.observedAtMs))) return false;
    intentIds.add(grant.intentId);
    deviceIds.add(device.deviceId);
  }
  if (legacy) return state.phase === "pending" || (state.devices as Device[]).some(device =>
    device.reservation.intentId === anchor.intentId && device.reservation.reservationId === anchor.reservationId);
  if (state.phase === "pending") return state.genesisCompletion === null;
  const completion = enrollmentSnapshot(state.genesisCompletion, ["mode", "intentId", "reservationId", "completedAtMs"]);
  if (completion === null || (completion.mode !== "original" && completion.mode !== "fresh-recovery")
    || !enrollmentHex(completion.intentId) || !enrollmentHex(completion.reservationId) || !enrollmentTime(completion.completedAtMs)) return false;
  const original = completion.intentId === anchor.intentId && completion.reservationId === anchor.reservationId;
  const anchorCreatedAtMs = anchor.createdAtMs;
  if ((completion.mode === "original") !== original || (completion.mode === "fresh-recovery" && completion.intentId === anchor.intentId)) return false;
  if (completion.mode === "fresh-recovery" && (state.devices as Device[]).some(device => device.reservation.intentId === anchor.intentId)) return false;
  return (state.devices as Device[]).some(device => device.reservation.intentId === completion.intentId
    && device.reservation.reservationId === completion.reservationId && device.enrolledAtMs === completion.completedAtMs
    && (completion.mode !== "fresh-recovery" || device.reservation.reservedAtMs >= anchorCreatedAtMs));
}

/** Consent invariants: a grant records its commit time and a bounded handle;
 * a withdrawal erases both while keeping the decision time for index ordering. */
function validLeaderboard(value: unknown, observedAtMs: number): value is LeaderboardState {
  const leaderboard = enrollmentSnapshot(value, ["consent", "consentedAtMs", "publicHandle", "changedAtMs"]);
  if (leaderboard === null || typeof leaderboard.consent !== "boolean"
    || !enrollmentTime(leaderboard.changedAtMs) || leaderboard.changedAtMs > observedAtMs) return false;
  if (leaderboard.consent === false) return leaderboard.consentedAtMs === null && leaderboard.publicHandle === null;
  return enrollmentTime(leaderboard.consentedAtMs) && leaderboard.consentedAtMs <= leaderboard.changedAtMs
    && leaderboardPublicHandle(leaderboard.publicHandle);
}
function consentViewOf(leaderboard: LeaderboardState): LeaderboardConsentViewV1 {
  return Object.freeze({ schemaVersion: 1, consent: leaderboard.consent,
    consentedAtMs: leaderboard.consentedAtMs, publicHandle: leaderboard.publicHandle });
}

function supersededGenesis(state: State, grant: EnrollmentReservation): boolean {
  return state.genesisCompletion?.mode === "fresh-recovery" && state.anchor.intentId === grant.intentId;
}

function receipt(device: Device): EnrollmentReceipt {
  return Object.freeze({ schemaVersion: 1, accountId: device.reservation.accountId, intentId: device.reservation.intentId,
    reservationId: device.reservation.reservationId, deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, namespaceVersion: 1 });
}
function view(device: Device): EnrollmentView {
  return Object.freeze({ receipt: receipt(device), deviceState: device.revokedAtMs === null ? "active" : "revoked" });
}

// workerd adds an own Symbol.dispose to object-valued RPC replies. Admit only
// that transport field here; input proofs and nested grants stay exact DTOs.
function rpcSnapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const disposal = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (disposal === undefined || !("value" in disposal) || typeof disposal.value !== "function") return null;
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

/** Only for replies from the owned Pairing RPC, including late timeout results. */
function disposeReply(value: unknown): void {
  try {
    if (value === null || typeof value !== "object") return;
    const disposal = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (disposal !== undefined && "value" in disposal && typeof disposal.value === "function") Reflect.apply(disposal.value, value, []);
  } catch { /* Disposal cannot widen or replace a failed authority check. */ }
}

/**
 * Dormant account-owned enrollment. Proofs resolve the real PairingIntent; caller
 * account IDs or reservation DTOs never select authority. Public upload stays closed.
 * Restore requires a separately fenced, qualified reconciliation procedure.
 */
export class AccountEnrollment extends DurableObject<Env> {
  #healthy = true;
  #historyAudited: "pending" | "passed" | "failed" = "pending";
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      ctx.storage.transactionSync(() => {
        if (this.#objects().length === 0) {
          ctx.storage.sql.exec(SCHEMA_SQL);
          ctx.storage.sql.exec("INSERT INTO account_enrollment (id, schema_version, revision, payload) VALUES (1, 2, 0, NULL)");
        }
        if (this.#objects().length === 1) {
          this.#schema(true);
          this.#migrate();
          const { state } = this.#stored(2);
          new AdmissionState(ctx.storage.sql).initialize(state);
          ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 3 WHERE id = 1");
        }
        this.#schema();
        this.#migrateFence();
        this.#migrateLeaderboard();
        new AdmissionState(ctx.storage.sql).auditControl(this.#stored(5).state);
        if (!this.#statsPresent() && this.#statsEnabled()) {
          new StatsState(ctx.storage.sql).initialize();
          ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 6 WHERE id = 1");
        }
        if (this.#statsPresent()) new StatsState(ctx.storage.sql).auditControl(this.#stored(5).state);
        this.#schema();
      });
    } catch { this.#healthy = false; }
  }

  #objects(): Record<string, SqlStorageValue>[] {
    return this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 16").toArray();
  }
  #schema(legacy = false): void {
    const objects = this.#objects();
    const withStats = !legacy && objects.some(object => object.name === "usage_stats_control");
    const expected: Record<string, string> = { account_enrollment: SCHEMA_SQL, ...(legacy ? {} : ADMISSION_SCHEMA), ...(withStats ? STATS_SCHEMA : {}) };
    if (!legacy) {
      const version = this.ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").toArray()[0]?.schema_version;
      if ((version === 6) !== withStats) throw new Error("storage_invalid");
    }
    if (!this.#healthy || objects.length !== Object.keys(expected).length || objects.some(object => object.type !== "table"
      || typeof object.name !== "string" || !Object.hasOwn(expected, object.name) || object.sql !== expected[object.name])) throw new Error("storage_invalid");
  }
  #generation(): string | null {
    const value: unknown = this.env.USAGE_ENROLLMENT_GENERATION;
    return enrollmentHex(value) ? value : null;
  }
  #migrate(): void {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1 || (row.schema_version !== 1 && row.schema_version !== 2)
      || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) throw new Error("storage_invalid");
    if (row.schema_version === 2) return;
    let payload: string | null = null;
    if (row.payload !== null) {
      if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) throw new Error("storage_invalid");
      const parsed: unknown = JSON.parse(row.payload);
      if (!validState(parsed, true, false, false) || !this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(parsed.accountId)))) throw new Error("storage_invalid");
      const origin = parsed.devices.find(device => device.reservation.intentId === parsed.anchor.intentId && device.reservation.reservationId === parsed.anchor.reservationId);
      const migrated: State = { ...parsed, genesisCompletion: origin === undefined ? null : {
        mode: "original", intentId: origin.reservation.intentId, reservationId: origin.reservation.reservationId, completedAtMs: origin.enrolledAtMs,
      } };
      if (!validState(migrated, false, false, false)) throw new Error("storage_invalid");
      payload = JSON.stringify(migrated);
      if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
    } else if (row.revision !== 0) throw new Error("storage_invalid");
    // Preserve all receipts, the exact namespace and the operation revision. An
    // older binary fails closed on schema 2; rollback must not strip this field.
    this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 2, payload = ? WHERE id = 1", payload);
  }
  /** Additive schema-3→4 migration: begin recording the restore epoch. A
   * pre-fence payload adopts the epoch on first fenced contact (`fenceEpoch`
   * stays `null`); a pending (null-payload) account records it at genesis. An
   * older binary fails closed on schema 4; rollback must not strip the field. */
  #migrateFence(): void {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1) throw new Error("storage_invalid");
    // Schema 4+ already carries the restore-epoch field; a later version's
    // stricter migration owns the fail-closed decision for future schemas.
    if (typeof row.schema_version === "number" && row.schema_version >= 4) return;
    if (row.schema_version !== 3) throw new Error("storage_invalid");
    let payload = row.payload;
    if (payload !== null) {
      if (typeof payload !== "string" || payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
      const parsed: unknown = JSON.parse(payload);
      if (!validState(parsed, false, false, false)) throw new Error("storage_invalid");
      const migrated: State = { ...parsed, fenceEpoch: null };
      if (!validState(migrated, false, true, false)) throw new Error("storage_invalid");
      payload = JSON.stringify(migrated);
      if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
    }
    this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 4, payload = ? WHERE id = 1", payload);
  }
  /** Additive schema-4→5 migration: begin recording leaderboard consent. Every
   * existing account starts unpublished (`consent: false`, never changed);
   * nothing is ever opted in by migration. An older binary fails closed on
   * schema 5; rollback must not strip the field. */
  #migrateLeaderboard(): void {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1) throw new Error("storage_invalid");
    if (row.schema_version === 5 || row.schema_version === 6) return;
    if (row.schema_version !== 4) throw new Error("storage_invalid");
    let payload = row.payload;
    if (payload !== null) {
      if (typeof payload !== "string" || payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
      const parsed: unknown = JSON.parse(payload);
      if (!validState(parsed, false, true, false)) throw new Error("storage_invalid");
      const migrated: State = { ...parsed, leaderboard: { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: 0 } };
      if (!validState(migrated)) throw new Error("storage_invalid");
      payload = JSON.stringify(migrated);
      if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
    }
    this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 5, payload = ? WHERE id = 1", payload);
  }
  #stored(version: 2 | 3 | 4 | 5): { revision: number; state: State | null } {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1 || (row.schema_version !== version && !(version === 5 && row.schema_version === 6)) || typeof row.revision !== "number"
      || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) throw new AdmissionFault();
    let state: State | null = null;
    if (row.payload !== null) {
      if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) throw new AdmissionFault();
      const parsed: unknown = JSON.parse(row.payload);
      // version < 4 rows predate the restore-epoch field; version < 5 rows
      // predate the consent field. Only the current schema admits both.
      if (!validState(parsed, false, version >= 4, version === 5) || !this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(parsed.accountId)))) throw new AdmissionFault();
      state = parsed;
    } else if (row.revision !== 0) throw new AdmissionFault();
    return { revision: row.revision, state };
  }
  #transaction<T>(operation: AdmissionObservation, run: (state: State | null, now: number) => { state: State | null; result: EnrollmentResult<T> }): EnrollmentResult<T> {
    try {
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        if (this.#generation() !== operation.generation) return err("recovery_required");
        const { revision, state } = this.#stored(5);
        if (state !== null && state.generation !== operation.generation) return err("recovery_required");
        const fence = operation.fence;
        if (fence !== null) {
          // A wiped-but-established account cannot silently re-run genesis, and a
          // recorded epoch that disagrees with the fence is a stale restore —
          // only an operator publish may reopen it. A `null` fenceEpoch is a
          // migrated pre-fence payload that adopts the authoritative epoch.
          if (state === null) { if (fence.established) return err("recovery_required"); }
          else if (state.fenceEpoch !== null && state.fenceEpoch !== fence.epoch) return err("recovery_required");
        }
        const admission = new AdmissionState(this.ctx.storage.sql), control = admission.control();
        const beforeDevices = new Set(state?.devices.map(device => device.deviceId) ?? []);
        const now = Date.now();
        if (!enrollmentTime(now) || now < operation.observed || now < control.observed || (state !== null && now < state.observedAtMs)) return err("clock_regressed");
        operation.observed = now;
        if (state !== null) state.observedAtMs = now;
        admission.observe(now);
        const outcome = run(state, now);
        if (outcome.state !== null) {
          // Pin the committed state to the epoch the lease observed so a later
          // restore to an older payload reads back a stale epoch and refuses.
          if (fence !== null) outcome.state.fenceEpoch = fence.epoch;
          if (!validState(outcome.state)) throw new Error("storage_invalid");
          const payload = JSON.stringify(outcome.state);
          if (payload.length > MAX_PAYLOAD) throw new Error("storage_invalid");
          for (const device of outcome.state.devices) if (!beforeDevices.has(device.deviceId)) admission.addDevice(device.deviceId);
          this.ctx.storage.sql.exec("UPDATE account_enrollment SET revision = ?, payload = ? WHERE id = 1", revision + 1, payload);
          operation.committed = true;
        }
        return outcome.result;
      });
    } catch (error) { return err(error instanceof AdmissionFault || error instanceof StatsFault ? error.code : "storage_invalid"); }
  }

  /** The Worker deployment version this account object is running under. */
  #workerVersion(): string | null {
    const value: unknown = this.env.USAGE_WORKER_VERSION;
    return enrollmentHex(value) ? value : null;
  }
  /** Best-effort read of the recorded restore epoch for the assertOpen epoch
   * match; the transaction re-checks the lease authoritatively, so this only
   * filters the fence's early refusal. */
  #fenceHint(): number {
    try { return this.#stored(5).state?.fenceEpoch ?? RESTORE_FENCE_GENESIS_EPOCH; }
    catch { return RESTORE_FENCE_GENESIS_EPOCH; }
  }
  /** The linear history audit, run once per object lifetime before the first
   * mutation rather than on every rehydration. Durable Objects are evicted
   * after seconds of idleness, so auditing in the constructor made every
   * cold read rescan the account's whole retained history. Nothing may commit
   * onto history this has not verified; reads are gated by the constant-cost
   * `auditControl` the constructor still runs. */
  #auditHistory(): EnrollmentError | null {
    if (this.#historyAudited === "passed") return null;
    // A refusal poisons the object rather than rescanning per retry, keeping
    // the scan bounded at one per lifetime exactly as the constructor was.
    if (this.#historyAudited === "failed") return "storage_invalid";
    try {
      const state = this.#stored(5).state;
      new AdmissionState(this.ctx.storage.sql).auditHistory(state);
      if (this.#statsPresent()) new StatsState(this.ctx.storage.sql).auditHistory(state);
    } catch {
      // Poison the object exactly as a failed constructor audit did, so no
      // later transaction on any path can commit onto history known bad.
      this.#historyAudited = "failed"; this.#healthy = false;
      return "storage_invalid";
    }
    this.#historyAudited = "passed";
    return null;
  }
  /** Acquire a provider-operation lease from the external restore fence. The
   * fence is a separate store; the returned epoch/established are authoritative
   * and cross-checked against durable state inside the transaction. */
  async #fenceAcquire(accountId: string, generation: string): Promise<EnrollmentResult<{ fence: FenceObservation; token: string }>> {
    const workerVersion = this.#workerVersion();
    if (workerVersion === null) return err("recovery_required");
    // Audited before the lease exists, so a refusal leaves nothing to release.
    const audited = this.#auditHistory();
    if (audited !== null) return err(audited);
    const stub = this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    const input = { accountId, generation, epoch: this.#fenceHint(), workerVersion, leaseMs: RESTORE_FENCE_LEASE_TTL_MS };
    let raw: unknown;
    try { raw = await stub.assertOpen(input); } catch { return err("storage_unavailable"); }
    try {
      const reply = rpcSnapshot(raw, ["ok", "value"]);
      // The nested lease carries no transport disposal marker; only the outer
      // reply does, so it is parsed with the plain exact-key snapshot.
      const lease = reply?.ok === true ? enrollmentSnapshot(reply.value, ["token", "epoch", "established", "deadlineMs"]) : null;
      if (lease !== null) {
        if (!enrollmentHex(lease.token) || typeof lease.epoch !== "number" || !Number.isSafeInteger(lease.epoch)
          || lease.epoch < RESTORE_FENCE_GENESIS_EPOCH || (lease.established !== true && lease.established !== false)
          || typeof lease.deadlineMs !== "number") return err("storage_unavailable");
        return ok({ fence: Object.freeze({ epoch: lease.epoch, established: lease.established }), token: lease.token });
      }
      const failure = rpcSnapshot(raw, ["ok", "error"]);
      if (failure?.ok === false) {
        const code = failure.error;
        return err(code === "recovery_required" || code === "clock_regressed" || code === "unauthorized" || code === "limit" ? code : "storage_invalid");
      }
      return err("storage_unavailable");
    } finally { disposeReply(raw); }
  }
  /** Release the lease with the exact commit outcome. A lost or failed release
   * leaves the lease to expire by TTL — it never masks the operation result,
   * and the recorded epoch remains authoritative. */
  async #fenceSettle(accountId: string, token: string | null, committed: boolean): Promise<void> {
    if (token === null) return;
    try {
      const raw: unknown = await this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId))
        .release({ accountId, token, committed });
      disposeReply(raw);
    } catch { /* A failed release leaves the lease to expire; the epoch record is authoritative. */ }
  }

  #closed(operation: Operation, live: boolean): EnrollmentError | null {
    const observed = this.#transaction(operation, (state, now) => ({ state, result: ok(now) }));
    if (!observed.ok) return observed.error;
    return live && observed.value >= operation.grant.expiresAtMs ? "expired" : null;
  }

  /** Dormant internal RPC. Authentication is the retained upload commitment;
   * fixed errors are not acceptance and public index.ts remains unavailable. */
  async admitBatch(input: unknown): Promise<EnrollmentResult<Uint8Array>> {
    // Decode the batch to owned bytes before the restore-fence lease await so a
    // later mutation of `input` cannot alter the admitted snapshot; the account
    // is derived from the owned batch, not a re-read of the request.
    const dto = enrollmentSnapshot(input, ["uploadSecret", "batch"]);
    if (dto === null || !enrollmentHex(dto.uploadSecret)) return err("invalid_input");
    const uploadSecret = dto.uploadSecret;
    let batch: AdmissionBatch;
    try { batch = ownedAdmissionBatch(dto.batch); } catch { return err("invalid_input"); }
    const accountId = batchAccount(batch);
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    const acquired = await this.#fenceAcquire(accountId, generation);
    if (!acquired.ok) return acquired;
    let committed = false;
    try {
      const admission = new AdmissionState(this.ctx.storage.sql);
      return await new AccountAdmission(this.env, admission, (observation, run) => {
        const result = this.#transaction(observation, (state, now) => {
          if (state && this.#statsPresent()) new StatsState(this.ctx.storage.sql).guardV1(batch, state);
          return { state, result: ok(run(state, now)) };
        });
        committed ||= observation.committed;
        return result;
      }).admit({ uploadSecret, batch }, acquired.value.fence);
    } finally { await this.#fenceSettle(accountId, acquired.value.token, committed); }
  }

  #statsEnabled(): boolean {
    return (this.env as Env & { AICHARTS_USAGE_STATS_ENABLED?: string }).AICHARTS_USAGE_STATS_ENABLED === "1";
  }
  #statsPresent(): boolean {
    return this.ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name = 'usage_stats_control' LIMIT 1").toArray().length === 1;
  }
  async admitStatsSnapshot(input: unknown): Promise<StatsResult<StatsReceipt>> {
    if (!this.#statsEnabled() || !this.#statsPresent()) return { ok: false, error: "storage_unavailable" };
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]);
    if (!dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    const request = parseStatsUpload(dto.request);
    if (!request) return { ok: false, error: "invalid_input" };
    const generation = this.#generation();
    if (generation === null || request.generation !== generation) return { ok: false, error: "recovery_required" };
    const acquired = await this.#fenceAcquire(request.accountId, generation);
    if (!acquired.ok) return { ok: false, error: acquired.error as StatsError };
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    try {
      return await new AccountStats(this.env, new StatsState(this.ctx.storage.sql), (seen, run) =>
        this.#transaction(seen, (state, now) => ({ state, result: ok(run(state, now)) }))).admit(request, dto.uploadSecret, observation);
    } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
  }
  async readStatsStatus(input: unknown): Promise<StatsResult<StatsStatus>> {
    if (!this.#statsEnabled() || !this.#statsPresent()) return { ok: false, error: "storage_unavailable" };
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]);
    if (!dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    const request = parseStatsStatusRequest(dto.request);
    if (!request) return { ok: false, error: "invalid_input" };
    const generation = this.#generation();
    if (generation === null || request.generation !== generation) return { ok: false, error: "recovery_required" };
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: null, committed: false };
    const scope = { accountId: request.accountId, sessionExpiresAtMs: 8_640_000_000_000_000 };
    return new AccountStats(this.env, new StatsState(this.ctx.storage.sql), (seen, run) =>
      this.#privateDaysSnapshot(scope, seen, state => run(state, seen.observed))).status(request, dto.uploadSecret, observation);
  }
  async abandonStatsSnapshot(input: unknown): Promise<StatsResult<StatsAbandonment>> {
    if (!this.#statsEnabled() || !this.#statsPresent()) return { ok: false, error: "storage_unavailable" };
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]);
    if (!dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    const request = parseStatsAbandonRequest(dto.request);
    if (!request) return { ok: false, error: "invalid_input" };
    const generation = this.#generation();
    if (generation === null || request.generation !== generation) return { ok: false, error: "recovery_required" };
    const acquired = await this.#fenceAcquire(request.accountId, generation);
    if (!acquired.ok) return { ok: false, error: acquired.error as StatsError };
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    try {
      return await new AccountStats(this.env, new StatsState(this.ctx.storage.sql), (seen, run) =>
        this.#transaction(seen, (state, now) => ({ state, result: ok(run(state, now)) }))).abandon(request, dto.uploadSecret, observation);
    } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
  }
  async readUsageStats(input: unknown): Promise<StatsResult<UsageStatsReport>> {
    const request = parseStatsQuery(input);
    if (request === null) return { ok: false, error: "invalid_input" };
    if (!this.#statsEnabled() || !this.#statsPresent()) return { ok: false, error: "not_started" };
    try {
      const generation = this.#generation(), observed = Date.now();
      if (generation === null) return { ok: false, error: "recovery_required" };
      const observation: AdmissionObservation = { generation, observed, fence: null, committed: false };
      const original = this.#privateDaysSnapshot(request, observation, state => Object.freeze({ ...state.anchor }));
      if (!original.ok) return { ok: false, error: original.error as StatsError };
      const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      const result = this.#privateDaysSnapshot(request, observation, state => {
        if (!external || !sameNamespaceAnchor(external, original.value) || !sameNamespaceAnchor(state.anchor, original.value)) throw new StatsFault("recovery_required");
        return new StatsState(this.ctx.storage.sql).read(state, request, observation.observed);
      });
      return result.ok ? result : { ok: false, error: result.error as StatsError };
    } catch { return { ok: false, error: "storage_unavailable" }; }
  }

  /** Unlike #transaction, this helper never advances clocks or enrollment
   * state. `checkQuarantine` stays true for admission-data reads; the consent
   * control plane opts out so a quarantined journal cannot hide or block a
   * withdrawal decision. */
  #privateDaysSnapshot<T>(request: Readonly<{ accountId: string; sessionExpiresAtMs: number }>, observation: AdmissionObservation,
    read: (state: State, admission: AdmissionState, control: AdmissionControl) => T, checkQuarantine = true): EnrollmentResult<T> {
    try {
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(request.accountId)))) return err("unauthorized");
        if (this.#generation() !== observation.generation) return err("recovery_required");
        const { state } = this.#stored(5);
        if (state === null) return err("not_enrolled");
        if (state.accountId !== request.accountId) return err("unauthorized");
        if (state.generation !== observation.generation) return err("recovery_required");
        if (state.phase !== "active") return err("not_enrolled");
        const admission = new AdmissionState(this.ctx.storage.sql), control = admission.control();
        if (checkQuarantine && control.quarantined) return err("recovery_required");
        const checkTime = (): EnrollmentError | null => {
          const now = Date.now();
          if (!enrollmentTime(now) || Object.is(now, -0) || now < observation.observed || now < control.observed || now < state.observedAtMs) return "clock_regressed";
          observation.observed = now;
          return now >= request.sessionExpiresAtMs ? "expired" : null;
        };
        const before = checkTime();
        if (before !== null) return err(before);
        const value = read(state, admission, control);
        const after = checkTime();
        if (after !== null) return err(after);
        if (this.#generation() !== observation.generation) return err("recovery_required");
        return ok(value);
      });
    } catch (error) { return err(error instanceof AdmissionFault || error instanceof StatsFault ? error.code : "storage_invalid"); }
  }

  /** Dormant trusted-coordinator RPC. The DTO establishes syntax, not user auth.
   * Future HTTP dispatch must verify workload identity and assert a live account. */
  async readImportedDays(input: unknown): Promise<EnrollmentResult<PrivateDaysV1>> {
    try {
      const request = parsePrivateDaysRequest(input);
      if (request === null) return err("invalid_input");
      const generation = this.#generation(), observed = Date.now();
      if (generation === null) return err("recovery_required");
      if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
      const observation: AdmissionObservation = { generation, observed, fence: null, committed: false };
      const original = this.#privateDaysSnapshot(request, observation, state => Object.freeze({ ...state.anchor }));
      if (!original.ok) return original;
      let external: NamespaceAnchor | null = null, unavailable = false;
      try { external = await readNamespaceAnchor(this.env.CONTROL, request.accountId); }
      catch { unavailable = true; }
      return this.#privateDaysSnapshot(request, observation, (state, admission, control) => {
        if (unavailable) throw new AdmissionFault("storage_unavailable");
        if (external === null || !sameNamespaceAnchor(external, original.value) || !sameNamespaceAnchor(state.anchor, original.value)) throw new AdmissionFault("recovery_required");
        return admission.readImportedDays(state, request, control);
      });
    } catch { return err("storage_unavailable"); }
  }

  /** Session-scoped consent read. The two-phase namespace check matches the
   * private-days snapshot so a stale restore cannot answer a wrong consent
   * state; consent itself is control-plane data, so the quarantine gate does
   * not apply and a withdrawal can never be hidden by admission integrity. */
  async readLeaderboardConsent(input: unknown): Promise<EnrollmentResult<LeaderboardConsentViewV1>> {
    try {
      const request = parseUsageConsentRequest(input);
      if (request === null || request.operation !== "status") return err("invalid_input");
      const generation = this.#generation(), observed = Date.now();
      if (generation === null) return err("recovery_required");
      if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
      const observation: AdmissionObservation = { generation, observed, fence: null, committed: false };
      const original = this.#privateDaysSnapshot(request, observation, state => Object.freeze({ ...state.anchor }), false);
      if (!original.ok) return original;
      let external: NamespaceAnchor | null = null, unavailable = false;
      try { external = await readNamespaceAnchor(this.env.CONTROL, request.accountId); }
      catch { unavailable = true; }
      return this.#privateDaysSnapshot(request, observation, (state) => {
        if (unavailable) throw new AdmissionFault("storage_unavailable");
        if (external === null || !sameNamespaceAnchor(external, original.value) || !sameNamespaceAnchor(state.anchor, original.value)) throw new AdmissionFault("recovery_required");
        return consentViewOf(state.leaderboard);
      }, false);
    } catch { return err("storage_unavailable"); }
  }

  /** Publish the committed consent decision to the materialized index. The
   * exact apply outcome is authoritative for the consent call's reply: a
   * failure means the publish is uncertain and must be retried or repaired by
   * the index's refresh-at-source. */
  async #publishLeaderboardConsent(accountId: string, view: LeaderboardConsentViewV1, eventAtMs: number): Promise<"published" | "handle_unavailable" | "publishing_full" | "unavailable"> {
    try {
      const raw: unknown = await this.env.PUBLIC_INDEX.getByName(LEADERBOARD_INDEX_NAME).applyConsent(Object.freeze({
        schemaVersion: 1, accountId, consent: view.consent, publicHandle: view.publicHandle,
        consentedAtMs: view.consentedAtMs, eventAtMs }));
      try {
        const reply = rpcSnapshot(raw, ["ok", "value"]);
        if (reply?.ok === true) return "published";
        const failure = rpcSnapshot(raw, ["ok", "error"]);
        if (failure?.ok === false && failure.error === "handle_unavailable") return "handle_unavailable";
        return failure?.ok === false && failure.error === "limit" ? "publishing_full" : "unavailable";
      } finally { disposeReply(raw); }
    } catch { return "unavailable"; }
  }

  /** Compensate only an explicit handle/capacity refusal, never an uncertain publish.
   * A newer user decision wins over this delayed restoration. */
  async #restoreLeaderboardConsent(accountId: string, generation: string,
    rejected: { view: LeaderboardConsentViewV1; eventAtMs: number }, previous: LeaderboardState): Promise<boolean> {
    const acquired = await this.#fenceAcquire(accountId, generation);
    if (!acquired.ok) return false;
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    let restored: { view: LeaderboardConsentViewV1; eventAtMs: number } | null = null;
    try {
      const result = this.#transaction(observation, (state, now) => {
        if (state === null || state.accountId !== accountId) return { state: null, result: err("not_enrolled") };
        const current = state.leaderboard;
        if (current.changedAtMs !== rejected.eventAtMs || current.consent !== rejected.view.consent
          || current.publicHandle !== rejected.view.publicHandle) return { state: null, result: ok(null) };
        // Retrying an earlier uncertain refusal may no longer have its prior
        // decision in memory. An unavailable handle remains unpublished.
        state.leaderboard = previous.consent && previous.publicHandle === rejected.view.publicHandle
          ? { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: now }
          : { ...previous, changedAtMs: now };
        return { state, result: ok({ view: consentViewOf(state.leaderboard), eventAtMs: now }) };
      });
      if (!result.ok) return false;
      restored = result.value;
    } finally { await this.#fenceSettle(accountId, acquired.value.token, observation.committed); }
    return restored === null || await this.#publishLeaderboardConsent(accountId, restored.view, restored.eventAtMs) === "published";
  }

  /** Durable delivery retry. A consent mutation arms this before committing,
   * so an index outage or lost response cannot strand a saved decision. The
   * latest stored decision is replayed; reads never perform this repair. */
  async alarm(): Promise<void> {
    try {
      const candidate = this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { state } = this.#stored(5);
        return state === null || state.phase !== "active" ? null : {
          accountId: state.accountId, generation: state.generation,
          view: consentViewOf(state.leaderboard), eventAtMs: state.leaderboard.changedAtMs,
        };
      });
      if (candidate === null) return;
      const current = await this.readLeaderboardConsent({ schemaVersion: 1, operation: "status",
        accountId: candidate.accountId, sessionExpiresAtMs: 8_640_000_000_000_000 });
      if (!current.ok) {
        if (current.error === "storage_unavailable" || current.error === "clock_regressed") throw new Error("consent_delivery_unavailable");
        // Closed restore fences or invalid storage need operator recovery;
        // polling them cannot repair authority and must not create busy work.
        return;
      }
      const unchanged = this.ctx.storage.transactionSync(() => {
        const { state } = this.#stored(5);
        return state !== null && state.leaderboard.changedAtMs === candidate.eventAtMs
          && state.generation === candidate.generation && state.leaderboard.consent === candidate.view.consent
          && state.leaderboard.publicHandle === candidate.view.publicHandle
          && state.leaderboard.consentedAtMs === candidate.view.consentedAtMs;
      });
      if (!unchanged) { await this.ctx.storage.setAlarm(Date.now() + 60_000); return; }
      const published = await this.#publishLeaderboardConsent(candidate.accountId, candidate.view, candidate.eventAtMs);
      if (published === "published") return;
      if ((published === "handle_unavailable" || published === "publishing_full") && await this.#restoreLeaderboardConsent(candidate.accountId,
        candidate.generation, candidate, { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: 0 })) return;
      throw new Error("consent_delivery_unavailable");
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "storage_invalid")) return;
      // Explicitly retain the retry after provider alarm retries are exhausted.
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      throw new Error("consent_delivery_unavailable");
    }
  }

  /** Fenced, idempotent consent write. The restore-fence lease is acquired and
   * settled exactly like other mutations; an unchanged decision performs no
   * write but still re-publishes, which repairs a previously lost apply. A
   * withdrawal commits `consent: false` and removes the member from the index. */
  async setLeaderboardConsent(input: unknown): Promise<EnrollmentResult<LeaderboardConsentViewV1>> {
    try {
      const request = parseUsageConsentRequest(input);
      if (request === null || request.operation !== "set") return err("invalid_input");
      const generation = this.#generation();
      if (generation === null) return err("recovery_required");
      if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(request.accountId)))) return err("unauthorized");
      const observed = Date.now();
      if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
      const acquired = await this.#fenceAcquire(request.accountId, generation);
      if (!acquired.ok) return acquired;
      const observation: AdmissionObservation = { generation, observed, fence: acquired.value.fence, committed: false };
      let committed: { view: LeaderboardConsentViewV1; eventAtMs: number };
      let previous: LeaderboardState | null = null;
      try {
        // Settle cannot cancel this alarm: an older request completing after a
        // newer one must not erase the newer decision's delivery retry.
        await this.ctx.storage.setAlarm(observed + 60_000);
        const result = this.#transaction<{ view: LeaderboardConsentViewV1; eventAtMs: number }>(observation, (state, now) => {
          if (state === null || state.accountId !== request.accountId) return { state, result: err(state === null ? "not_enrolled" : "unauthorized") };
          if (state.phase !== "active") return { state, result: err("not_enrolled") };
          if (now >= request.sessionExpiresAtMs) return { state, result: err("expired") };
          const current = state.leaderboard;
          previous = { ...current };
          const unchanged = current.consent === request.consent
            && current.publicHandle === request.publicHandle;
          // The index orders consent events by this timestamp. Never commit
          // a distinct decision under an already-used event key: the index
          // would acknowledge it as a replay without applying a withdrawal.
          if (!unchanged && now <= current.changedAtMs) return { state: null, result: err("clock_regressed") };
          if (request.consent === false) {
            if (current.consent === false) return { state: null, result: ok({ view: consentViewOf(current), eventAtMs: current.changedAtMs }) };
            state.leaderboard = { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: now };
            return { state, result: ok({ view: consentViewOf(state.leaderboard), eventAtMs: now }) };
          }
          if (current.consent === true && current.publicHandle === request.publicHandle) {
            return { state: null, result: ok({ view: consentViewOf(current), eventAtMs: current.changedAtMs }) };
          }
          state.leaderboard = { consent: true, consentedAtMs: current.consent ? current.consentedAtMs : now,
            publicHandle: request.publicHandle, changedAtMs: now };
          return { state, result: ok({ view: consentViewOf(state.leaderboard), eventAtMs: now }) };
        });
        if (!result.ok) return result;
        committed = result.value;
      } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
      const published = await this.#publishLeaderboardConsent(request.accountId, committed.view, committed.eventAtMs);
      if (published === "published") return ok(committed.view);
      if ((published === "handle_unavailable" || published === "publishing_full") && previous !== null
        && await this.#restoreLeaderboardConsent(request.accountId, generation, committed, previous)) return err(published);
      return err("storage_unavailable");
    } catch { return err("storage_unavailable"); }
  }

  /** Trusted internal projection for the materialized index only. The reply's
   * `accountId` exists solely so the index can match the member it queried; it
   * never enters the public snapshot. A `consent: false` reply is the index's
   * authoritative signal to remove a stale member. */
  async readLeaderboardProjection(input: unknown): Promise<EnrollmentResult<LeaderboardProjectionV1>> {
    try {
      const request = enrollmentSnapshot(input, ["schemaVersion", "accountId"]);
      if (request?.schemaVersion !== 1 || !enrollmentAccount(request.accountId)) return err("invalid_input");
      const accountId = request.accountId;
      const generation = this.#generation(), observed = Date.now();
      if (generation === null) return err("recovery_required");
      if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
      // These totals leave the account for the public index, so they are held
      // to the same verified history a mutation is. A dormant member is
      // re-verified on the index's schedule and never mutates, so nothing else
      // would audit it; this read is internal and rare enough to pay the scan.
      const audited = this.#auditHistory();
      if (audited !== null) return err(audited);
      const observation: AdmissionObservation = { generation, observed, fence: null, committed: false };
      // The projection is an internal coordinator read, not a user session;
      // the never-expiring session bound keeps the snapshot's expiry check inert.
      const scope = Object.freeze({ accountId, sessionExpiresAtMs: 8_640_000_000_000_000 });
      const original = this.#privateDaysSnapshot(scope, observation, state => Object.freeze({ ...state.anchor }), false);
      if (!original.ok) return original;
      let external: NamespaceAnchor | null = null, unavailable = false;
      try { external = await readNamespaceAnchor(this.env.CONTROL, accountId); }
      catch { unavailable = true; }
      return this.#privateDaysSnapshot(scope, observation, (state, admission, control) => {
        if (unavailable) throw new AdmissionFault("storage_unavailable");
        if (external === null || !sameNamespaceAnchor(external, original.value) || !sameNamespaceAnchor(state.anchor, original.value)) throw new AdmissionFault("recovery_required");
        const leaderboard = state.leaderboard;
        if (leaderboard.consent !== true) {
          return Object.freeze({ schemaVersion: 1 as const, accountId: state.accountId, consent: false as const });
        }
        if (control.quarantined) throw new AdmissionFault("recovery_required");
        // Corrections, tombstones and supersession are exactly the private-days
        // read path: the projection can decrease and never double-counts.
        const todayUtcDay = Math.floor(observation.observed / DAY_MS);
        const dayCount = Math.min(LEADERBOARD_WINDOW_DAYS, todayUtcDay + 1);
        const firstUtcDay = todayUtcDay - dayCount + 1;
        const windowRequest = parsePrivateDaysRequest({ schemaVersion: 1, accountId: state.accountId,
          sessionExpiresAtMs: scope.sessionExpiresAtMs, firstUtcDay, dayCount });
        if (windowRequest === null) throw new AdmissionFault("storage_invalid");
        if (this.#statsPresent() && new StatsState(this.ctx.storage.sql).hasCommittedSnapshot()) {
          const totals = new StatsState(this.ctx.storage.sql).leaderboard(state, { firstUtcDay, dayCount }, observation.observed);
          return Object.freeze({ schemaVersion: 1 as const, accountId: state.accountId, consent: true as const,
            consentedAtMs: leaderboard.consentedAtMs as number, publicHandle: leaderboard.publicHandle as string,
            ...totals, windowFirstUtcDay: firstUtcDay, windowUtcDays: dayCount });
        }
        const days = admission.readImportedDays(state, windowRequest, control);
        let observedTokens = 0n, usageRecords = 0;
        for (const day of days.days) {
          for (const provider of [day.codex, day.claudeCode, day.devin] as const) {
            observedTokens += BigInt(provider.observedAccountedTokens);
            usageRecords += provider.usageOccurrences;
          }
        }
        return Object.freeze({ schemaVersion: 1 as const, accountId: state.accountId, consent: true as const,
          consentedAtMs: leaderboard.consentedAtMs as number, publicHandle: leaderboard.publicHandle as string,
          observedTokens: observedTokens.toString(), usageRecords,
          windowFirstUtcDay: firstUtcDay, windowUtcDays: dayCount });
      }, false);
    } catch { return err("storage_unavailable"); }
  }

  async #operation(input: unknown, fenced: boolean): Promise<EnrollmentResult<Operation>> {
    const proof = parseEnrollmentProof(input);
    if (proof === null) return err("invalid_input");
    // Every operation here settles through #closed, which commits an observed
    // time and an enrollment revision, so the unfenced status path durably
    // writes too and must clear the same history audit the fence does.
    const audited = this.#auditHistory();
    if (audited !== null) return err(audited);
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    const before = Date.now();
    if (!enrollmentTime(before)) return err("clock_regressed");
    const raw: unknown = await enrollmentStorageCall<unknown>(this.env.PAIRINGS.getByName(proof.intentId).readEnrollmentReservation(proof), disposeReply);
    let grant: EnrollmentReservation | null;
    try {
      const envelope = rpcSnapshot(raw, ["ok", "value"]);
      grant = envelope?.ok === true ? parseEnrollmentReservation(envelope.value) : null;
      if (grant === null) {
        const failure = rpcSnapshot(raw, ["ok", "error"]);
        if (failure?.ok === false) {
          switch (failure.error) {
            case "unauthorized": case "not_reserved": case "recovery_required": case "clock_regressed": case "storage_invalid":
              return err(failure.error);
          }
        }
        return err("storage_unavailable");
      }
    } finally { disposeReply(raw); }
    if (grant.intentId !== proof.intentId || grant.recoveryGeneration !== generation) return err("recovery_required");
    if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(grant.accountId)))) return err("unauthorized");
    // Only mutating operations hold a provider-operation lease. Acquired once
    // the account is known; the caller releases it in a finally so a lost reply
    // still settles the drain barrier.
    let fence: FenceObservation | null = null, leaseToken: string | null = null;
    if (fenced) {
      const acquired = await this.#fenceAcquire(grant.accountId, generation);
      if (!acquired.ok) return acquired;
      fence = acquired.value.fence;
      leaseToken = acquired.value.token;
    }
    const operation: Operation = { proof, grant, generation, observed: Math.max(before, grant.reservedAtMs), fence, leaseToken, committed: false };
    const closed = this.#closed(operation, false);
    if (closed !== null) {
      if (leaseToken !== null) await this.#fenceSettle(grant.accountId, leaseToken, operation.committed);
      return err(closed);
    }
    return ok(operation);
  }

  #existing(state: State | null, grant: EnrollmentReservation): EnrollmentResult<Device | null> {
    if (state === null) return ok(null);
    if (state.accountId !== grant.accountId) return err("unauthorized");
    const existing = state.devices.find(device => device.reservation.intentId === grant.intentId);
    return existing === undefined ? ok(null) : sameGrant(existing.reservation, grant) ? ok(existing) : err("conflict");
  }

  async enroll(input: unknown): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const resolved = await this.#operation(input, true);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      try { return await this.#enrollOperation(operation); }
      finally { await this.#fenceSettle(operation.grant.accountId, operation.leaseToken, operation.committed); }
    } catch { return err("storage_unavailable"); }
  }

  async #enrollOperation(operation: Operation): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const { grant, generation } = operation;
      const observed = this.#transaction(operation, state => ({ state, result: this.#existing(state, grant) }));
      if (!observed.ok) return observed;
      // Exact committed readback is non-secret and cannot reactivate a device.
      if (observed.value !== null) return ok(view(observed.value));
      let closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      const before = this.#transaction(operation, state => ({ state, result: ok(state) }));
      if (!before.ok) return before;
      if (before.value === null) {
        const external = await readNamespaceAnchor(this.env.CONTROL, grant.accountId);
        closed = this.#closed(operation, true);
        if (closed !== null) return err(closed);
        if (external !== null) return err("recovery_required");
      }
      const prepared = this.#transaction(operation, (state, now) => {
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state === null) state = { accountId: grant.accountId, generation, observedAtMs: now, phase: "pending", fenceEpoch: null, devices: [], genesisCompletion: null,
          leaderboard: { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: 0 },
          anchor: { accountId: grant.accountId, generation, namespaceKey: enrollmentRandom(), intentId: grant.intentId,
            reservationId: grant.reservationId, createdAtMs: now } };
        if (state.accountId !== grant.accountId) return { state, result: err("unauthorized") };
        if (supersededGenesis(state, grant)) return { state, result: err("recovery_required") };
        if (state.phase === "pending" && (state.anchor.intentId !== grant.intentId || state.anchor.reservationId !== grant.reservationId)) return { state, result: err("recovery_required") };
        return { state, result: ok({ anchor: Object.freeze({ ...state.anchor }), phase: state.phase }) };
      });
      if (!prepared.ok) return prepared;
      if (prepared.value.phase === "pending") {
        try {
          await ensureNamespaceAnchor(this.env.CONTROL, prepared.value.anchor, () => this.#closed(operation, true) === null);
        } catch { return err(this.#closed(operation, true) ?? "storage_unavailable"); }
      } else {
        const external = await readNamespaceAnchor(this.env.CONTROL, grant.accountId);
        if (external === null || !sameNamespaceAnchor(external, prepared.value.anchor)) return err("recovery_required");
      }
      closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      const deviceId = deviceIdFor(grant);
      return this.#transaction<EnrollmentView>(operation, (state, now) => {
        if (state === null || !sameNamespaceAnchor(state.anchor, prepared.value.anchor)) return { state, result: err("recovery_required") };
        const existing = this.#existing(state, grant);
        if (!existing.ok) return { state, result: existing };
        if (existing.value !== null) return { state, result: ok(view(existing.value)) };
        if (supersededGenesis(state, grant)) return { state, result: err("recovery_required") };
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state.devices.length >= MAX_ENROLLED_DEVICES) return { state, result: err("limit") };
        if (state.devices.some(device => device.deviceId === deviceId)) return { state, result: err("conflict") };
        const device: Device = { reservation: grant, deviceId, enrolledAtMs: now, revokedAtMs: null };
        if (state.phase === "pending") state.genesisCompletion = { mode: "original", intentId: grant.intentId, reservationId: grant.reservationId, completedAtMs: now };
        state.devices.push(device);
        state.phase = "active";
        return { state, result: ok(view(device)) };
      });
    } catch { return err("storage_unavailable"); }
  }

  /** Explicit same-account fresh reservation may finish retained pending genesis.
   * It never adopts an orphan anchor, remints a namespace, or enrolls the expired
   * original credential. This is not a general backup/restore operation. */
  async recoverPendingEnrollment(input: unknown): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const resolved = await this.#operation(input, true);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      try { return await this.#recoverOperation(operation); }
      finally { await this.#fenceSettle(operation.grant.accountId, operation.leaseToken, operation.committed); }
    } catch { return err("storage_unavailable"); }
  }

  async #recoverOperation(operation: Operation): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const { grant } = operation;
      const prepared = this.#transaction<{ completed: EnrollmentView } | { anchor: NamespaceAnchor }>(operation, (state, now) => {
        if (state === null || state.accountId !== grant.accountId) return { state, result: err("recovery_required") };
        const existing = this.#existing(state, grant);
        if (!existing.ok) return { state, result: existing };
        // Exact recovery readback is non-secret, including after expiry/revocation.
        if (state.genesisCompletion?.mode === "fresh-recovery" && state.genesisCompletion.intentId === grant.intentId
          && state.genesisCompletion.reservationId === grant.reservationId && existing.value !== null) return { state, result: ok({ completed: view(existing.value) }) };
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state.phase !== "pending" || state.anchor.intentId === grant.intentId || grant.reservedAtMs < state.anchor.createdAtMs) return { state, result: err("recovery_required") };
        return { state, result: ok({ anchor: Object.freeze({ ...state.anchor }) }) };
      });
      if (!prepared.ok) return prepared;
      if ("completed" in prepared.value) return ok(prepared.value.completed);
      const original = prepared.value.anchor;
      try { await ensureNamespaceAnchor(this.env.CONTROL, original, () => this.#closed(operation, true) === null); }
      catch { return err(this.#closed(operation, true) ?? "storage_unavailable"); }
      const closed = this.#closed(operation, true);
      if (closed !== null) return err(closed);
      return this.#transaction<EnrollmentView>(operation, (state, now) => {
        if (state === null || !sameNamespaceAnchor(state.anchor, original)) return { state, result: err("recovery_required") };
        const existing = this.#existing(state, grant);
        if (!existing.ok) return { state, result: existing };
        if (state.genesisCompletion?.mode === "fresh-recovery" && state.genesisCompletion.intentId === grant.intentId
          && state.genesisCompletion.reservationId === grant.reservationId && existing.value !== null) return { state, result: ok(view(existing.value)) };
        if (now >= grant.expiresAtMs) return { state, result: err("expired") };
        if (state.phase !== "pending" || state.anchor.intentId === grant.intentId || grant.reservedAtMs < state.anchor.createdAtMs) return { state, result: err("recovery_required") };
        const device: Device = { reservation: grant, deviceId: deviceIdFor(grant), enrolledAtMs: now, revokedAtMs: null };
        state.devices.push(device);
        state.genesisCompletion = { mode: "fresh-recovery", intentId: grant.intentId, reservationId: grant.reservationId, completedAtMs: now };
        state.phase = "active";
        return { state, result: ok(view(device)) };
      });
    } catch { return err("storage_unavailable"); }
  }

  async namespaceForEnrollment(input: unknown): Promise<EnrollmentResult<Readonly<{
    schemaVersion: 1; namespaceVersion: 1; namespaceKey: string; receipt: EnrollmentReceipt;
  }>>> {
    try {
      const resolved = await this.#operation(input, true);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      try {
        let closed = this.#closed(operation, true);
        if (closed !== null) return err(closed);
        const found = this.#transaction<{ anchor: NamespaceAnchor }>(operation, state => {
          const existing = this.#existing(state, operation.grant);
          if (!existing.ok) return { state, result: existing };
          if (state === null || existing.value === null) return { state, result: err("not_enrolled") };
          if (existing.value.revokedAtMs !== null) return { state, result: err("revoked") };
          return { state, result: ok({ anchor: Object.freeze({ ...state.anchor }) }) };
        });
        if (!found.ok) return found;
        const external = await readNamespaceAnchor(this.env.CONTROL, operation.grant.accountId);
        if (external === null || !sameNamespaceAnchor(external, found.value.anchor)) return err("recovery_required");
        closed = this.#closed(operation, true);
        if (closed !== null) return err(closed);
        return this.#transaction<Readonly<{ schemaVersion: 1; namespaceVersion: 1; namespaceKey: string; receipt: EnrollmentReceipt }>>(operation, (state, now) => {
          const existing = this.#existing(state, operation.grant);
          if (!existing.ok) return { state, result: existing };
          if (state === null || existing.value === null || !sameNamespaceAnchor(state.anchor, found.value.anchor)) return { state, result: err("not_enrolled") };
          if (existing.value.revokedAtMs !== null) return { state, result: err("revoked") };
          if (now >= operation.grant.expiresAtMs) return { state, result: err("expired") };
          return { state, result: ok(Object.freeze({ schemaVersion: 1 as const, namespaceVersion: 1 as const,
            namespaceKey: state.anchor.namespaceKey, receipt: receipt(existing.value) })) };
        });
      } finally { await this.#fenceSettle(operation.grant.accountId, operation.leaseToken, operation.committed); }
    } catch { return err("storage_unavailable"); }
  }

  /** Trusted internal read of durable account control. This is intentionally
   * separate from namespaceForEnrollment: it exposes only reconciliation
   * metadata and device receipt state, never a namespace key or secret. */
  async readEnrollmentStatus(input: unknown): Promise<EnrollmentResult<EnrollmentStatus>> {
    try {
      const resolved = await this.#operation(input, false);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        if (this.#generation() !== operation.generation) return err("recovery_required");
        const { revision: stateRevision, state } = this.#stored(5);
        if (state === null || state.accountId !== operation.grant.accountId) return err("not_enrolled");
        const existing = this.#existing(state, operation.grant);
        if (!existing.ok) return existing;
        if (existing.value === null) return err("not_enrolled");
        const control = new AdmissionState(this.ctx.storage.sql).control();
        const now = Date.now();
        if (!enrollmentTime(now) || Object.is(now, -0) || now < operation.observed || now < state.observedAtMs || now < control.observed) return err("clock_regressed");
        if (control.quarantined) return err("recovery_required");
        return ok(Object.freeze({ schemaVersion: 1 as const, accountId: state.accountId, generation: state.generation,
          phase: state.phase, stateRevision, admissionRevision: control.revision,
          admissionCommittedAtMs: control.revision === 0 ? null : control.committed,
          admissionObservedAtMs: control.observed, headCount: control.heads, liveCount: control.live,
          quarantined: control.quarantined,
          devices: Object.freeze(state.devices.map(device => view(device))) }));
      });
    } catch (error) { return err(error instanceof AdmissionFault || error instanceof StatsFault ? error.code : "storage_invalid"); }
  }

  /** Exact original proof can revoke only its own existing device, never enroll one. */
  async revokeEnrollment(input: unknown): Promise<EnrollmentResult<EnrollmentView>> {
    try {
      const resolved = await this.#operation(input, true);
      if (!resolved.ok) return resolved;
      const operation = resolved.value;
      try {
        const { grant } = operation;
        return this.#transaction<EnrollmentView>(operation, (state, now) => {
          const existing = this.#existing(state, grant);
          if (!existing.ok) return { state, result: existing };
          if (existing.value === null) return { state, result: err("not_enrolled") };
          existing.value.revokedAtMs ??= now;
          if (this.#statsPresent()) new StatsState(this.ctx.storage.sql).revokeDevice(existing.value.deviceId);
          return { state, result: ok(view(existing.value)) };
        });
      } finally { await this.#fenceSettle(operation.grant.accountId, operation.leaseToken, operation.committed); }
    } catch { return err("storage_unavailable"); }
  }
}
