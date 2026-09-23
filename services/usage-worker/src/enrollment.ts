import { DurableObject } from "cloudflare:workers";
import { parseStatsQuery, parseStatsStatusRequest, parseStatsUpload, statsInteger, type StatsError, type StatsReceipt, type StatsResult, type StatsStatus } from "../../../lib/usage/stats-http-contract";
import { isStatsClient } from "../../../lib/usage/stats-registry";
import { parseStatsAbandonRequest, type StatsAbandonment } from "../../../lib/usage/stats-http-contract";
import type { UsageStatsReport } from "../../../lib/usage/stats-contract";
import { StatsState, StatsFault, STATS_SCHEMA } from "./stats-state";
import { AccountStats } from "./stats-admission";
import { createHash } from "node:crypto";
import { admissionHex, type AdmissionBatch } from "../../../lib/usage/admission";
import { uploadSecretCommitment } from "./pairing";
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
  #leaseEstablishment = new Set<string>();
  #canonicalWrites = new Map<string, Set<Promise<void>>>();
  /** Completed stats reads are pure in (range, stats revision, admission
   * revision); the memo only ever serves after every fencing guard passes.
   * Bounded to a few ranges, dies with the object, and holds no authority. */
  #statsReadMemo = new Map<string, UsageStatsReport>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Construction is read-only. Explicit maintenance or a registered mutation
    // owns initialization, upgrades and checkpoint writes.
  }

  #prepareFenced(accountId: string, generation: string, fence: FenceObservation): EnrollmentError | null {
    try {
      this.ctx.storage.transactionSync(() => {
        const before = this.#fencePreflight(accountId, generation);
        if (!before.ok) throw new AdmissionFault(before.error === "unauthorized" ? "unauthorized" : "recovery_required");
        if (before.value.epoch !== fence.epoch || (!before.value.established && fence.established)) throw new AdmissionFault("recovery_required");
        if (this.#objects().length === 0) {
          this.ctx.storage.sql.exec(SCHEMA_SQL);
          this.ctx.storage.sql.exec("INSERT INTO account_enrollment (id, schema_version, revision, payload) VALUES (1, 2, 0, NULL)");
        }
        if (this.#objects().length === 1) {
          this.#schema(true);
          this.#migrate();
          const { state } = this.#stored(2);
          new AdmissionState(this.ctx.storage.sql).initialize(state);
          this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 3 WHERE id = 1");
        }
        this.#migrateStatsRows();
        this.#migrateStatsOwnership();
        new AdmissionState(this.ctx.storage.sql).migrateCapacity();
        this.#schema();
        this.#migrateFence();
        this.#migrateLeaderboard();
        new AdmissionState(this.ctx.storage.sql).auditControl(this.#stored(5).state);
        if (!this.#statsPresent() && this.#statsEnabled()) {
          new StatsState(this.ctx.storage.sql).initialize();
          this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 8 WHERE id = 1");
        }
        if (this.#statsPresent()) new StatsState(this.ctx.storage.sql).auditControl(this.#stored(5).state);
        this.#schema();
        const audited = this.#auditHistory();
        if (audited !== null) throw new AdmissionFault(audited === "storage_invalid" ? "storage_invalid" : "recovery_required");
      });
      return null;
    } catch (error) { return error instanceof AdmissionFault ? error.code : "storage_invalid"; }
  }

  #objects(): Record<string, SqlStorageValue>[] {
    return this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 28").toArray();
  }
  #schema(legacy = false): void {
    const objects = this.#objects();
    const withStats = !legacy && objects.some(object => object.name === "usage_stats_control");
    const expected: Record<string, string> = { account_enrollment: SCHEMA_SQL, ...(legacy ? {} : ADMISSION_SCHEMA), ...(withStats ? STATS_SCHEMA : {}) };
    if (!legacy) {
      const version = this.ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").toArray()[0]?.schema_version;
      if ((version === 6 || version === 7 || version === 8) !== withStats) throw new Error("storage_invalid");
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
    if (row.schema_version === 5 || row.schema_version === 6 || row.schema_version === 7 || row.schema_version === 8) return;
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
  /** Additive schema-6→7 migration: install the derived stats read model. The
   * exploded tables carry no authority — they are populated from committed
   * projections at publish or explicit fenced maintenance. Runs before #schema because the exact-table check already
   * expects them once the stats schema is installed. */
  #migrateStatsRows(): void {
    const names = new Set(this.#objects().map(object => object.name));
    if (!names.has("usage_stats_control")) return;
    for (const name of ["usage_stats_day_meta", "usage_stats_day_rows"] as const)
      if (!names.has(name)) this.ctx.storage.sql.exec(STATS_SCHEMA[name]);
    const version = this.ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").toArray()[0]?.schema_version;
    if (version === 6) this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 7 WHERE id = 1");
  }
  #migrateStatsOwnership(): void {
    if (!this.#statsPresent()) return;
    const version = this.ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").one().schema_version;
    new StatsState(this.ctx.storage.sql).migrateOwnership(version);
    if (version === 7) this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 8 WHERE id = 1");
  }
  #stored(version: 2 | 3 | 4 | 5): { revision: number; state: State | null } {
    const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1 || (row.schema_version !== version && !(version === 5 && typeof row.schema_version === "number" && row.schema_version >= 6)) || typeof row.revision !== "number"
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
        if (fence === null) return err("recovery_required");
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
  /** Pure preflight admits existing legacy shapes only for a fenced upgrade.
   * It never converts absent or malformed authority into a genesis guess. */
  #fencePreflight(accountId: string, generation: string): EnrollmentResult<{ epoch: number; established: boolean }> {
    try {
      if (!this.#healthy || this.#generation() !== generation) return err("recovery_required");
      if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(accountId)))) return err("unauthorized");
      const objects = this.#objects();
      if (objects.length === 0) return ok({ epoch: RESTORE_FENCE_GENESIS_EPOCH, established: false });
      if (!objects.some(object => object.type === "table" && object.name === "account_enrollment" && object.sql === SCHEMA_SQL)) return err("storage_invalid");
      const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
      const row = rows[0];
      if (rows.length !== 1 || row.id !== 1 || typeof row.schema_version !== "number" || !Number.isInteger(row.schema_version)
        || row.schema_version < 1 || row.schema_version > 8 || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision)
        || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) return err("storage_invalid");
      if (row.payload === null) return row.revision === 0 ? ok({ epoch: RESTORE_FENCE_GENESIS_EPOCH, established: false }) : err("storage_invalid");
      if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) return err("storage_invalid");
      const state: unknown = JSON.parse(row.payload);
      if (!validState(state, row.schema_version === 1, row.schema_version >= 4, row.schema_version >= 5)) return err("storage_invalid");
      if (state.accountId !== accountId) return err("unauthorized");
      if (state.generation !== generation) return err("recovery_required");
      return ok({ epoch: state.fenceEpoch ?? RESTORE_FENCE_GENESIS_EPOCH, established: true });
    } catch { return err("storage_invalid"); }
  }
  /** Reject unauthenticated traffic before it can consume lifetime fence
   * attempts or trigger schema/checkpoint work. This reads validated retained
   * legacy payloads without upgrading them. Mutation-specific authentication,
   * revocation and namespace checks still run after acquisition and awaits. */
  async #preauthenticateUpload(accountId: string, deviceId: string, generation: string, secret: string): Promise<EnrollmentError | null> {
    const read = (): EnrollmentResult<{ intentId: string; commitment: string }> => {
      const checked = this.#fencePreflight(accountId, generation);
      if (!checked.ok) return checked;
      if (!checked.value.established) return err("not_enrolled");
      try {
        return this.ctx.storage.transactionSync(() => {
          const row = this.ctx.storage.sql.exec("SELECT schema_version, payload FROM account_enrollment WHERE id = 1").one();
          if (typeof row.payload !== "string" || typeof row.schema_version !== "number") return err("storage_invalid");
          const state: unknown = JSON.parse(row.payload);
          if (!validState(state, row.schema_version === 1, row.schema_version >= 4, row.schema_version >= 5)) return err("storage_invalid");
          if (state.phase !== "active") return err("not_enrolled");
          const device = state.devices.find(device => device.deviceId === deviceId);
          return device === undefined ? err("unauthorized") : ok({ intentId: device.reservation.intentId,
            commitment: device.reservation.uploadCommitment });
        });
      } catch { return err("storage_invalid"); }
    };
    const original = read();
    if (!original.ok) {
      if (original.error !== "not_enrolled") return original.error;
      const authority = await this.#readAuthority(accountId, generation);
      return authority ?? original.error;
    }
    const commitment = await uploadSecretCommitment(original.value.intentId, secret);
    if (!commitment.ok) return "unauthorized";
    const same = (left: string, right: string): boolean => {
      if (!enrollmentHex(left) || !enrollmentHex(right)) return false;
      let difference = 0;
      for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
      return difference === 0;
    };
    if (!same(commitment.value, original.value.commitment)) return "unauthorized";
    const current = read();
    if (!current.ok) return current.error;
    return current.value.intentId === original.value.intentId && same(current.value.commitment, commitment.value) ? null : "unauthorized";
  }
  /** The linear history audit, run once per object lifetime before the first
   * mutation rather than on every rehydration. Durable Objects are evicted
   * after seconds of idleness, so auditing in the constructor made every
   * cold read rescan the account's whole retained history. Nothing may commit
   * onto history this has not verified. Reads validate the current control and
   * external fence without advancing a checkpoint or running a migration. */
  #auditHistory(writeCheckpoint = true): EnrollmentError | null {
    if (this.#historyAudited === "passed") return null;
    // A refusal poisons the object rather than rescanning per retry, keeping
    // the scan bounded at one per lifetime exactly as the constructor was.
    if (this.#historyAudited === "failed") return "storage_invalid";
    try {
      const state = this.#stored(5).state;
      const admission = new AdmissionState(this.ctx.storage.sql);
      if (writeCheckpoint) admission.auditHistory(state); else admission.verifyHistory(state);
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
    const preflight = this.#fencePreflight(accountId, generation);
    if (!preflight.ok) return preflight;
    const stub = this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    // This ID belongs to one execution, not the retriable upload operation.
    // Concurrent exact uploads each retain their own outstanding holder.
    const input = { accountId, generation, epoch: preflight.value.epoch, workerVersion, leaseMs: RESTORE_FENCE_LEASE_TTL_MS, attemptId: enrollmentRandom() };
    let failure: EnrollmentError = "storage_unavailable";
    let uncertain = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: unknown;
      try {
        raw = await stub.assertOpen(input);
        const reply = rpcSnapshot(raw, ["ok", "value"]);
        const lease = reply?.ok === true ? enrollmentSnapshot(reply.value, ["token", "epoch", "established", "deadlineMs"]) : null;
        if (lease !== null && lease.token === input.attemptId && lease.epoch === input.epoch
          && (lease.established === true || lease.established === false) && enrollmentTime(lease.deadlineMs)) {
          const fence = Object.freeze({ epoch: input.epoch, established: lease.established });
          if (preflight.value.established) this.#leaseEstablishment.add(input.attemptId);
          const prepared = this.#prepareFenced(accountId, generation, fence);
          if (prepared !== null) {
            await this.#fenceSettle(accountId, input.attemptId, false);
            return err(prepared);
          }
          return ok({ fence, token: input.attemptId });
        }
        const rejected = rpcSnapshot(raw, ["ok", "error"]);
        if (rejected?.ok === false) {
          const code = rejected.error;
          failure = code === "recovery_required" || code === "clock_regressed" || code === "unauthorized" || code === "limit" ? code : "storage_invalid";
          if (!uncertain) return err(failure);
          break;
        }
        uncertain = true;
      } catch { uncertain = true; /* Read back the same durable attempt; never mint a replacement. */ }
      finally { disposeReply(raw); }
    }
    // No canonical continuation has been dispatched before this handoff.
    // Persist its terminal disposition so a delayed grant cannot appear behind
    // close/drain. If reconciliation is unavailable, report recovery_required;
    // any uncertain holder remains registered rather than being force-drained.
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: unknown;
      try {
        raw = await stub.cancelAcquire({ accountId, generation, epoch: input.epoch, workerVersion, attemptId: input.attemptId });
        const reply = rpcSnapshot(raw, ["ok", "value"]);
        if (reply?.ok === true && reply.value === null) return err(failure);
      } catch { /* Uncertain cancellation remains registered/fail-closed. */ }
      finally { disposeReply(raw); }
    }
    return err("recovery_required");
  }
  /** Each execution can dispatch only one fixed-key anchor write. The external
   * fence bounds simultaneous executions; completion deletes local custody.
   * If this object dies first, the durable holder stays unresolved. */
  #retainCanonicalWrite(token: string | null, pending: Promise<unknown>): void {
    if (token === null) throw new Error("unregistered_write");
    const writes = this.#canonicalWrites.get(token) ?? new Set<Promise<void>>();
    this.#canonicalWrites.set(token, writes);
    const tracked = new Promise<void>(resolve => { void pending.then(() => resolve(), () => resolve()); });
    writes.add(tracked);
    void tracked.then(() => {
      writes.delete(tracked);
      if (writes.size === 0) this.#canonicalWrites.delete(token);
    });
  }
  /** Called only after this execution's canonical continuations have ended.
   * Lost replies reconcile the same terminal decision. If storage remains
   * unavailable the holder remains registered; no timer may force drain. */
  async #fenceSettle(accountId: string, token: string | null, committed: boolean): Promise<void> {
    if (token === null) return;
    const writes = this.#canonicalWrites.get(token);
    if (writes !== undefined && writes.size > 0) {
      // Preserve the outward deadline while retaining custody of the actual
      // canonical provider operation. waitUntil is liveness support, not proof
      // of termination: process loss leaves the separate durable fence held.
      this.ctx.waitUntil(Promise.allSettled([...writes]).then(() => this.#fenceSettle(accountId, token, committed)));
      return;
    }
    const established = committed || this.#leaseEstablishment.has(token);
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: unknown;
      try {
        raw = await this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId)).release({ accountId, token, committed: established });
        const reply = rpcSnapshot(raw, ["ok", "value"]);
        if (reply?.ok === true && reply.value === null) { this.#leaseEstablishment.delete(token); return; }
      } catch { /* A retained holder requires reconciliation, never TTL deletion. */ }
      finally { disposeReply(raw); }
    }
    // Durable registration owns uncertain settlement, not unreachable local
    // bookkeeping. Lost replies must not grow this per-execution set forever.
    this.#leaseEstablishment.delete(token);
  }

  #closed(operation: Operation, live: boolean): EnrollmentError | null {
    if (operation.fence === null) {
      try {
        return this.ctx.storage.transactionSync(() => {
          if (this.#objects().length === 0) return "not_enrolled";
          this.#schema();
          if (this.#generation() !== operation.generation) return "recovery_required";
          const state = this.#stored(5).state;
          if (state === null) return "not_enrolled";
          if (state.accountId !== operation.grant.accountId || state.generation !== operation.generation) return "recovery_required";
          const control = new AdmissionState(this.ctx.storage.sql).auditControl(state);
          const now = Date.now();
          if (!enrollmentTime(now) || now < operation.observed || now < control.observed || now < state.observedAtMs) return "clock_regressed";
          operation.observed = now;
          return live && now >= operation.grant.expiresAtMs ? "expired" : null;
        });
      } catch { return "storage_invalid"; }
    }
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
    const authenticated = await this.#preauthenticateUpload(accountId, admissionHex(batch.deviceId), generation, uploadSecret);
    if (authenticated !== null) return err(authenticated);
    const acquired = await this.#fenceAcquire(accountId, generation);
    if (!acquired.ok) return acquired;
    let committed = false;
    try {
      const admission = new AdmissionState(this.ctx.storage.sql);
      return await new AccountAdmission(this.env, admission, (observation, run) => {
        const result = this.#transaction(observation, (state, now) => ({ state, result: ok(run(state, now)) }));
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
  /** Trusted coordinator maintenance, never dispatched by a read. The account,
   * generation and current schema/history define its idempotent target. A
   * from-zero scrub checks retained journal content rather than trusting the
   * colocated checkpoint; it is not proof of external backup completeness. */
  async maintainAccount(input: unknown): Promise<EnrollmentResult<{ schemaVersion: 1; admissionRevision: number; statsRevision: number | null; auditBasis: "from-zero" | "checkpoint-extension" }>> {
    const request = enrollmentSnapshot(input, ["schemaVersion", "accountId", "generation", "operation"]);
    if (request?.schemaVersion !== 1 || !enrollmentAccount(request.accountId) || !enrollmentHex(request.generation)
      || (request.operation !== "prepare" && request.operation !== "scrub")) return err("invalid_input");
    const accountId = request.accountId, generation = request.generation;
    const acquired = await this.#fenceAcquire(accountId, generation);
    if (!acquired.ok) return acquired;
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    try {
      const result = this.#transaction(observation, state => {
        const admission = new AdmissionState(this.ctx.storage.sql);
        admission.auditHistory(state, request.operation === "scrub");
        const stats = this.#statsPresent() ? new StatsState(this.ctx.storage.sql) : null;
        stats?.auditHistory(state);
        stats?.backfillRows(state);
        this.#statsReadMemo.clear();
        return { state, result: ok({ schemaVersion: 1 as const, admissionRevision: admission.control().revision,
          statsRevision: stats?.control().revision ?? null,
          auditBasis: request.operation === "scrub" ? "from-zero" as const : "checkpoint-extension" as const }) };
      });
      if (!result.ok && result.error === "storage_invalid") { this.#historyAudited = "failed"; this.#healthy = false; }
      return result;
    } finally { await this.#fenceSettle(accountId, acquired.value.token, observation.committed); }
  }
  /** Trusted live-account recovery. It neither grants a new device credential
   * nor claims that a successor ledger contains its predecessor's records. */
  async recoverStatsWriter(input: unknown): Promise<EnrollmentResult<{ writerDeviceId: string; ownershipRevision: number }>> {
    const request = enrollmentSnapshot(input, ["schemaVersion", "accountId", "sessionExpiresAtMs", "client", "previousDeviceId", "deviceId", "expectedRevision"]);
    if (request?.schemaVersion !== 1 || !enrollmentAccount(request.accountId) || !enrollmentTime(request.sessionExpiresAtMs)
      || !isStatsClient(request.client) || !enrollmentHex(request.previousDeviceId) || !enrollmentHex(request.deviceId)
      || !statsInteger(request.expectedRevision, 0, 999_999)) return err("invalid_input");
    if (!this.#statsEnabled()) return err("unavailable");
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    const accountId = request.accountId;
    const acquired = await this.#fenceAcquire(accountId, generation);
    if (!acquired.ok) return acquired;
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    try {
      const external = await readNamespaceAnchor(this.env.CONTROL, accountId);
      return this.#transaction(observation, (state, now) => {
        if (state === null || state.phase !== "active") return { state, result: err("not_enrolled") };
        if (state.accountId !== accountId) return { state, result: err("unauthorized") };
        if (now >= (request.sessionExpiresAtMs as number)) return { state, result: err("expired") };
        if (external === null || !sameNamespaceAnchor(external, state.anchor)) return { state, result: err("recovery_required") };
        const value = new StatsState(this.ctx.storage.sql).transferWriter(state, request.client as string, request.previousDeviceId as string,
          request.deviceId as string, request.expectedRevision as number, now);
        this.#statsReadMemo.clear();
        return { state, result: ok(value) };
      });
    } finally { await this.#fenceSettle(accountId, acquired.value.token, observation.committed); }
  }
  /** Pure external authority check. A read linearizes no later than its final
   * successful check; a close or epoch change during its awaits refuses it. */
  async #readAuthority(accountId: string, generation: string): Promise<EnrollmentError | null> {
    const local = this.#fencePreflight(accountId, generation);
    if (!local.ok) return local.error;
    let raw: unknown;
    try {
      raw = await this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId)).read({ accountId, generation });
      const reply = rpcSnapshot(raw, ["ok", "value"]);
      const failed = rpcSnapshot(raw, ["ok", "error"]);
      if (failed?.ok === false && (failed.error === "clock_regressed" || failed.error === "storage_invalid" || failed.error === "storage_unavailable")) return failed.error;
      const view = reply?.ok === true ? enrollmentSnapshot(reply.value, ["record", "inFlight", "observedAtMs"]) : null;
      if (view === null || !statsInteger(view.inFlight, 0, 64) || !enrollmentTime(view.observedAtMs)) return "recovery_required";
      if (view.record === null) return local.value.established ? "recovery_required" : null;
      const record = enrollmentSnapshot(view.record, ["schemaVersion", "accountId", "generation", "epoch", "workerVersion", "phase", "established", "updatedAtMs"]);
      return record?.schemaVersion === 1 && record.accountId === accountId && record.generation === generation
        && record.epoch === local.value.epoch && record.workerVersion === this.#workerVersion() && record.phase === "open"
        && enrollmentTime(record.updatedAtMs) && record.updatedAtMs <= view.observedAtMs
        && (record.established === false || (record.established === true && local.value.established)) ? null : "recovery_required";
    } catch { return "storage_unavailable"; }
    finally { disposeReply(raw); }
  }
  async #readFenced<T>(accountId: string, read: () => Promise<EnrollmentResult<T>>): Promise<EnrollmentResult<T>> {
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    const before = await this.#readAuthority(accountId, generation);
    if (before !== null) return err(before);
    const result = await read();
    const after = await this.#readAuthority(accountId, generation);
    return after === null ? result : err(after);
  }
  async admitStatsSnapshot(input: unknown): Promise<StatsResult<StatsReceipt>> {
    if (!this.#statsEnabled()) return { ok: false, error: "storage_unavailable" };
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]);
    if (!dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    const request = parseStatsUpload(dto.request);
    if (!request) return { ok: false, error: "invalid_input" };
    const generation = this.#generation();
    if (generation === null || request.generation !== generation) return { ok: false, error: "recovery_required" };
    const authenticated = await this.#preauthenticateUpload(request.accountId, request.deviceId, generation, dto.uploadSecret);
    if (authenticated !== null) return { ok: false, error: authenticated as StatsError };
    const acquired = await this.#fenceAcquire(request.accountId, generation);
    if (!acquired.ok) return { ok: false, error: acquired.error as StatsError };
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    try {
      return await new AccountStats(this.env, new StatsState(this.ctx.storage.sql), (seen, run) =>
        this.#transaction(seen, (state, now) => ({ state, result: ok(run(state, now)) }))).admit(request, dto.uploadSecret, observation);
    } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
  }
  async readStatsStatus(input: unknown): Promise<StatsResult<StatsStatus>> {
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]), request = dto && parseStatsStatusRequest(dto.request);
    if (!request) return { ok: false, error: "invalid_input" };
    return this.#readFenced(request.accountId, () => this.#readStatsStatus(input)) as Promise<StatsResult<StatsStatus>>;
  }
  async #readStatsStatus(input: unknown): Promise<StatsResult<StatsStatus>> {
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
    if (!this.#statsEnabled()) return { ok: false, error: "storage_unavailable" };
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]);
    if (!dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    const request = parseStatsAbandonRequest(dto.request);
    if (!request) return { ok: false, error: "invalid_input" };
    const generation = this.#generation();
    if (generation === null || request.generation !== generation) return { ok: false, error: "recovery_required" };
    const authenticated = await this.#preauthenticateUpload(request.accountId, request.deviceId, generation, dto.uploadSecret);
    if (authenticated !== null) return { ok: false, error: authenticated as StatsError };
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
    if (!request) return { ok: false, error: "invalid_input" };
    return this.#readFenced(request.accountId, () => this.#readUsageStats(input)) as Promise<StatsResult<UsageStatsReport>>;
  }
  async #readUsageStats(input: unknown): Promise<StatsResult<UsageStatsReport>> {
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
        return new StatsState(this.ctx.storage.sql).read(state, request, observation.observed, this.#statsReadMemo);
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
        if (this.#objects().length === 0) return err("not_enrolled");
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
    const request = parsePrivateDaysRequest(input);
    if (!request) return err("invalid_input");
    return this.#readFenced(request.accountId, () => this.#readImportedDays(input));
  }
  async #readImportedDays(input: unknown): Promise<EnrollmentResult<PrivateDaysV1>> {
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
    const request = parseUsageConsentRequest(input);
    if (!request || request.operation !== "status") return err("invalid_input");
    return this.#readFenced(request.accountId, () => this.#readLeaderboardConsent(input));
  }
  async #readLeaderboardConsent(input: unknown): Promise<EnrollmentResult<LeaderboardConsentViewV1>> {
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
      return restored === null || await this.#publishLeaderboardConsent(accountId, restored.view, restored.eventAtMs) === "published";
    } finally { await this.#fenceSettle(accountId, acquired.value.token, observation.committed); }
  }

  /** Durable delivery retry. A consent mutation arms this before committing,
   * so an index outage or lost response cannot strand a saved decision. The
   * latest stored decision is replayed; reads never perform this repair. */
  async alarm(): Promise<void> {
    let candidate: { accountId: string; generation: string; view: LeaderboardConsentViewV1; eventAtMs: number } | null;
    try {
      candidate = this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { state } = this.#stored(5);
        return state === null || state.phase !== "active" ? null : {
          accountId: state.accountId, generation: state.generation,
          view: consentViewOf(state.leaderboard), eventAtMs: state.leaderboard.changedAtMs,
        };
      });
    } catch { return; }
    if (candidate === null) return;
    const acquired = await this.#fenceAcquire(candidate.accountId, candidate.generation);
    if (!acquired.ok) return;
    try {
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
    } finally { await this.#fenceSettle(candidate.accountId, acquired.value.token, true); }
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
        const published = await this.#publishLeaderboardConsent(request.accountId, committed.view, committed.eventAtMs);
        if (published === "published") return ok(committed.view);
        if ((published === "handle_unavailable" || published === "publishing_full") && previous !== null
          && await this.#restoreLeaderboardConsent(request.accountId, generation, committed, previous)) return err(published);
        return err("storage_unavailable");
      } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
    } catch { return err("storage_unavailable"); }
  }

  /** Trusted internal projection for the materialized index only. The reply's
   * `accountId` exists solely so the index can match the member it queried; it
   * never enters the public snapshot. A `consent: false` reply is the index's
   * authoritative signal to remove a stale member. */
  async readLeaderboardProjection(input: unknown): Promise<EnrollmentResult<LeaderboardProjectionV1>> {
    const request = enrollmentSnapshot(input, ["schemaVersion", "accountId"]);
    if (request?.schemaVersion !== 1 || !enrollmentAccount(request.accountId)) return err("invalid_input");
    const result = await this.readLeaderboardDelivery(input);
    return result.ok ? ok(result.value.projection) : result;
  }
  async readLeaderboardDelivery(input: unknown): Promise<EnrollmentResult<{ schemaVersion: 1; accountId: string; eventAtMs: number; projection: LeaderboardProjectionV1 }>> {
    const request = enrollmentSnapshot(input, ["schemaVersion", "accountId"]);
    if (request?.schemaVersion !== 1 || !enrollmentAccount(request.accountId)) return err("invalid_input");
    return this.#readFenced(request.accountId, () => this.#readLeaderboardDelivery(input));
  }
  async #readLeaderboardDelivery(input: unknown): Promise<EnrollmentResult<{ schemaVersion: 1; accountId: string; eventAtMs: number; projection: LeaderboardProjectionV1 }>> {
    try {
      const request = enrollmentSnapshot(input, ["schemaVersion", "accountId"]);
      if (request?.schemaVersion !== 1 || !enrollmentAccount(request.accountId)) return err("invalid_input");
      const accountId = request.accountId;
      const generation = this.#generation(), observed = Date.now();
      if (generation === null) return err("recovery_required");
      if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
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
        const projection = (): LeaderboardProjectionV1 => {
        const leaderboard = state.leaderboard;
        if (leaderboard.consent !== true) {
          return Object.freeze({ schemaVersion: 1 as const, accountId: state.accountId, consent: false as const });
        }
        if (control.quarantined) throw new AdmissionFault("recovery_required");
        // Only an enrolled, current-schema numeric projection needs history
        // verification. Absent/legacy reads cannot poison later maintenance,
        // and withdrawn consent remains available despite numeric corruption.
        const audited = this.#auditHistory(false);
        if (audited !== null) throw new AdmissionFault(audited === "storage_invalid" ? "storage_invalid" : "recovery_required");
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
        };
        return { schemaVersion: 1 as const, accountId: state.accountId, eventAtMs: state.leaderboard.changedAtMs, projection: projection() };
      }, false);
    } catch { return err("storage_unavailable"); }
  }

  async #operation(input: unknown, fenced: boolean): Promise<EnrollmentResult<Operation>> {
    const proof = parseEnrollmentProof(input);
    if (proof === null) return err("invalid_input");
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
          await ensureNamespaceAnchor(this.env.CONTROL, prepared.value.anchor, () => this.#closed(operation, true) === null,
            pending => this.#retainCanonicalWrite(operation.leaseToken, pending));
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
      try { await ensureNamespaceAnchor(this.env.CONTROL, original, () => this.#closed(operation, true) === null,
        pending => this.#retainCanonicalWrite(operation.leaseToken, pending)); }
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
      return this.#readFenced(operation.grant.accountId, async () => this.ctx.storage.transactionSync(() => {
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
      }));
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
