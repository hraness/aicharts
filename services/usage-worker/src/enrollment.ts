import { DurableObject } from "cloudflare:workers";
import { parseStatsQuery, parseStatsStatusRequest, parseStatsUpload, statsInteger, type StatsError, type StatsReceipt, type StatsResult, type StatsStatus } from "../../../lib/usage/stats-http-contract";
import { parseStatsTotalsQuery, type StatsTotalsResult } from "../../../lib/usage/stats-totals-contract";
import { parseStatsAbandonRequest, type StatsAbandonment } from "../../../lib/usage/stats-http-contract";
import type { UsageStatsReport } from "../../../lib/usage/stats-contract";
import { StatsState, StatsFault, STATS_SCHEMA, statsHash, statsUploadText } from "./stats-state";
import { AccountStats } from "./stats-admission";
import { CONTRIBUTION_SCHEMA, ContributionState, type ContributionGrantReceipt } from "./contributions-state";
import { AccountContributions } from "./contributions-admission";
import { ContributionProjectionState, CONTRIBUTION_PROJECTION_SCHEMA } from "./contribution-projection-state";
import { AccountContributionProjection, type ContributionProjectionAdvanceResult } from "./contribution-projection";
import { AccountAlarm } from "./account-alarm";
import { AccountWorkState, ACCOUNT_WORK_SCHEMA, ACCOUNT_WORK_READY_DELAY_MS, ACCOUNT_WORK_DISPATCH_YIELD_MS, type AccountWorkAttempt,
  type AccountWorkAuthority, type AccountWorkKind, type AccountWorkSnapshot, type AccountWorkOutcome } from "./account-work-state";
import { accountConsentWork, accountProjectionWork, accountWorkDeadline, accountWorkRecordDeadline, accountWorkRefusal } from "./account-work";
import { parseContributionQuery, type ContributionQuery, type ContributionQueryError, type ContributionQueryResult } from "../../../lib/usage/contribution-query";
import { ContributionQueryFault, queryContributionPage } from "./contribution-query";
import { parseContributionHeadQuery, type ContributionHeadQueryResult } from "../../../lib/usage/contribution-head-query";
import { CONTRIBUTION_SCRUB_DEADLINE_MS, parseContributionScrubRequest, parseContributionScrubResult, type ContributionScrubResult, parseContributionScrubJobRequest, parseContributionScrubJobResult, type ContributionScrubJobResult } from "../../../lib/usage/contribution-scrub";
import { scrubContributionCell, scrubContributionJobCell } from "./contribution-scrub";
import { AccountContributionRebuild } from "./contribution-rebuild";
import { CONTRIBUTION_REBUILD_SCHEMA, ContributionRebuildFault, ContributionRebuildState } from "./contribution-rebuild-state";
import { CONTRIBUTION_REBUILD_DEADLINE_MS, isContributionRebuildError, parseContributionRebuildRequest,
  parseContributionRebuildReadRequest, parseContributionRebuildReceipt, type ContributionRebuildError,
  type ContributionRebuildResult, type ContributionRebuildStatusResult } from "../../../lib/usage/contribution-rebuild-contract";
import { parseContributionCancelRequest } from "../../../lib/usage/contribution-cancel";
import { ContributionFault, CONTRIBUTION_MAX_TIME, isContributionError, parseContributionBatch, parseContributionGrant, parseContributionActivationRequest,
  parseContributionMigrationRequest, type ContributionMigrationReceipt,
  parseContributionStatusRequest, parseContributionAbandonRequest, type ContributionError, type ContributionResult,
  type ContributionBatch, type ContributionTerminal, type ContributionStatus, type ContributionActivationReceipt } from "../../../lib/usage/contributions";
import { createHash, timingSafeEqual } from "node:crypto";
import { admissionHex, equalAdmissionBytes, type AdmissionBatch } from "../../../lib/usage/admission";
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
import { parseReclamationRequest, RECLAMATION_DEADLINE_MS, type ReclamationResult } from "../../../lib/usage/reclamation-contract";
import { AccountReclamation, reclamationErrorFrom } from "./reclamation";
import { ReclamationState, RECLAMATION_SCHEMA } from "./reclamation-state";
import {
  enrollmentAccount, enrollmentAccountName, enrollmentHex, enrollmentRandom,
  enrollmentSnapshot, enrollmentTime, parseEnrollmentProof, parseEnrollmentReservation,
  type EnrollmentProof, type EnrollmentReservation,
} from "./enrollment-contract";
import {
  ensureNamespaceAnchor, enrollmentStorageCall, namespaceAnchorKey, readNamespaceAnchor, sameNamespaceAnchor, type NamespaceAnchor,
} from "./namespace-anchor";
import {
  RESTORE_FENCE_GENESIS_EPOCH, RESTORE_FENCE_LEASE_TTL_MS, restoreFenceName,
  type FenceObservation,
} from "./restore-fence";
import {
  LIFECYCLE_CLIENTS, LIFECYCLE_ERASE_REQUEST_TTL_MS, LIFECYCLE_ERASE_STEPS, LIFECYCLE_EXPORT_CONTRACT, LIFECYCLE_EXPORT_EXCLUDED,
  LIFECYCLE_EXPORT_PAGE_BYTES, LIFECYCLE_EXPORT_PAGE_ITEMS, LIFECYCLE_EXPORT_SECTIONS, LIFECYCLE_MAX_TRANSFERS, LIFECYCLE_RECLAMATION_CONTRACT,
  LIFECYCLE_STATUS_CONTRACT, LIFECYCLE_TRANSFER_TTL_MS, isUsageLifecycleError, lifecycleJson, parseReclamationLedger, parseUsageLifecycleRequest,
  type LifecycleClient, type LifecycleDeviceV1, type LifecycleDeviceViewV1, type LifecycleDevicesV1, type LifecycleEraseProgressV1,
  type LifecycleEraseRequestV1, type LifecycleErasureViewV1, type LifecycleExportItemV1, type LifecycleExportPageV1, type LifecycleJson,
  type LifecyclePublishingViewV1, type LifecycleReclamationEntryV1, type LifecycleStatusV1, type LifecycleTransferPhase, type LifecycleTransferV1,
  type LifecycleTransferViewV1, type ReclamationLedgerV1, type UsageLifecycleError, type UsageLifecycleResult, type UsageLifecycleValue,
} from "../../../lib/usage/lifecycle-contract";
/** Rows per exported table; every account table is bounded well below this
 * by its own schema ceiling, so exceeding it is a storage invariant failure. */
const LIFECYCLE_EXPORT_MAX_ROWS = 300_000;

export type EnrollmentError = "invalid_input" | "unavailable" | "unauthorized" | "not_reserved" | "not_enrolled"
  | StatsError | ContributionError | ContributionQueryError | ContributionRebuildError | "expired" | "conflict" | "recovery_required" | "revoked" | "storage_invalid" | "storage_unavailable" | "clock_regressed" | "limit" | "handle_unavailable" | "publishing_full"
  | "account_erased" | "device_revoked";
export type EnrollmentResult<T> = { ok: true; value: T } | { ok: false; error: EnrollmentError };
/** Carries a fence-preflight refusal out of the fenced transaction; unlike the
 * storage-invariant faults its code is the refused operation's own reply. */
class FenceRefusal extends Error {
  constructor(readonly code: EnrollmentError) { super(code); }
}
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
/** Phase 10 lifecycle records, stored additively inside the enrollment payload
 * so no new table or object surface exists. `erasure` is the durable erase
 * intent: `token` is the confirmation secret, `step` the count of durably
 * completed erase steps (see `LifecycleErasureViewV1`), `ledger` the
 * reclamation record written at step 4. Transfers are a bounded history of
 * writer transfers between this account's devices. */
type LifecycleErasure = {
  token: string; requestedAtMs: number; requestExpiresAtMs: number; confirmedAtMs: number | null; step: number;
  completedAtMs: number | null; sealed: boolean; ledger: ReclamationLedgerV1 | null;
};
type LifecycleTransfer = {
  transferId: string; client: LifecycleClient; fromDeviceId: string; toDeviceId: string; phase: LifecycleTransferPhase;
  requestedAtMs: number; grantedAtMs: number | null; completedAtMs: number | null; expiresAtMs: number;
  expectedRevision: number | null; ownershipRevision: number | null; refusal: string | null;
};
type LifecycleState = { erasure: LifecycleErasure | null; transfers: LifecycleTransfer[] };
type State = {
  accountId: string; generation: string; observedAtMs: number; phase: "pending" | "active";
  // The restore epoch this state last committed under. `null` marks a
  // migrated pre-fence payload that adopts the authoritative epoch on first
  // fenced contact; a real epoch must match the fence's or the account is
  // stale (restored) and must refuse recovery_required.
  fenceEpoch: number | null; anchor: NamespaceAnchor; devices: Device[]; genesisCompletion: GenesisCompletion | null;
  leaderboard: LeaderboardState;
  // Absent on every payload written before Phase 10; present only once a
  // lifecycle operation committed. Absence is exactly "no lifecycle record".
  lifecycle?: LifecycleState;
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
  const withLifecycle = leaderboard && value !== null && typeof value === "object" && Object.hasOwn(value, "lifecycle");
  const state = enrollmentSnapshot(value, ["accountId", "generation", "observedAtMs", "phase", ...(fence ? ["fenceEpoch"] : []), "anchor", "devices", ...(legacy ? [] : ["genesisCompletion"]), ...(leaderboard ? ["leaderboard"] : []), ...(withLifecycle ? ["lifecycle"] : [])]);
  if (state === null || !enrollmentAccount(state.accountId) || !enrollmentHex(state.generation) || !enrollmentTime(state.observedAtMs)
    || (state.phase !== "pending" && state.phase !== "active") || !Array.isArray(state.devices)
    || state.devices.length > MAX_ENROLLED_DEVICES || (state.phase === "pending") !== (state.devices.length === 0)) return false;
  if (fence && !(state.fenceEpoch === null || (typeof state.fenceEpoch === "number" && Number.isSafeInteger(state.fenceEpoch) && state.fenceEpoch >= 0))) return false;
  if (leaderboard && !validLeaderboard(state.leaderboard, state.observedAtMs)) return false;
  if (withLifecycle && !validLifecycle(state.lifecycle, state)) return false;
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

/** Lifecycle invariants. Erasure: `step` 0 exactly while unconfirmed; a
 * confirmed erasure has withdrawn source consent; from step 3 every device is
 * revoked; `completedAtMs` exists exactly from step 5; `sealed` exactly at
 * step 6. Transfers: bounded, unique ids, devices of this account, ordered
 * times, at most one live transfer per client. */
function validLifecycle(value: unknown, owner: Record<string, unknown>): value is LifecycleState {
  const lifecycle = enrollmentSnapshot(value, ["erasure", "transfers"]);
  if (lifecycle === null || !Array.isArray(lifecycle.transfers) || lifecycle.transfers.length > LIFECYCLE_MAX_TRANSFERS) return false;
  const observedAtMs = owner.observedAtMs as number;
  const devices = Array.isArray(owner.devices) ? owner.devices as unknown[] : [];
  const deviceOf = (id: unknown): Record<string, unknown> | null => {
    if (!enrollmentHex(id)) return null;
    const found = devices.find(raw => enrollmentSnapshot(raw, ["reservation", "deviceId", "enrolledAtMs", "revokedAtMs"])?.deviceId === id);
    return found === undefined ? null : found as Record<string, unknown>;
  };
  if (lifecycle.erasure !== null) {
    const erasure = enrollmentSnapshot(lifecycle.erasure, ["token", "requestedAtMs", "requestExpiresAtMs", "confirmedAtMs", "step", "completedAtMs", "sealed", "ledger"]);
    if (erasure === null || !enrollmentHex(erasure.token) || !enrollmentTime(erasure.requestedAtMs) || erasure.requestedAtMs > observedAtMs
      || !enrollmentTime(erasure.requestExpiresAtMs) || erasure.requestExpiresAtMs <= erasure.requestedAtMs
      || typeof erasure.step !== "number" || !Number.isInteger(erasure.step) || erasure.step < 0 || erasure.step > LIFECYCLE_ERASE_STEPS
      || typeof erasure.sealed !== "boolean") return false;
    if (erasure.confirmedAtMs === null) {
      if (erasure.step !== 0 || erasure.completedAtMs !== null || erasure.sealed || erasure.ledger !== null) return false;
    } else {
      if (!enrollmentTime(erasure.confirmedAtMs) || erasure.confirmedAtMs < erasure.requestedAtMs || erasure.confirmedAtMs > observedAtMs || erasure.step < 1) return false;
      const leaderboard = enrollmentSnapshot(owner.leaderboard, ["consent", "consentedAtMs", "publicHandle", "changedAtMs"]);
      if (leaderboard === null || leaderboard.consent !== false) return false;
      if (erasure.step >= 3 && devices.some(raw => (raw as Record<string, unknown>).revokedAtMs === null)) return false;
      if ((erasure.step >= 4) !== (erasure.ledger !== null)) return false;
      if (erasure.ledger !== null) {
        const ledger = parseReclamationLedger(erasure.ledger);
        if (ledger === null || ledger.accountId !== owner.accountId || ledger.generation !== owner.generation || ledger.recordedAtMs > observedAtMs) return false;
      }
      if ((erasure.step >= 5) !== (erasure.completedAtMs !== null)) return false;
      if (erasure.completedAtMs !== null && (!enrollmentTime(erasure.completedAtMs) || erasure.completedAtMs < erasure.confirmedAtMs || erasure.completedAtMs > observedAtMs)) return false;
      if ((erasure.step === LIFECYCLE_ERASE_STEPS) !== erasure.sealed) return false;
    }
  }
  const ids = new Set<string>(), live = new Set<string>();
  for (const raw of lifecycle.transfers as unknown[]) {
    const transfer = enrollmentSnapshot(raw, ["transferId", "client", "fromDeviceId", "toDeviceId", "phase", "requestedAtMs", "grantedAtMs",
      "completedAtMs", "expiresAtMs", "expectedRevision", "ownershipRevision", "refusal"]);
    if (transfer === null || !enrollmentHex(transfer.transferId) || ids.has(transfer.transferId)
      || !(LIFECYCLE_CLIENTS as readonly unknown[]).includes(transfer.client) || deviceOf(transfer.fromDeviceId) === null
      || deviceOf(transfer.toDeviceId) === null || transfer.fromDeviceId === transfer.toDeviceId
      || (transfer.phase !== "requested" && transfer.phase !== "granted" && transfer.phase !== "completed" && transfer.phase !== "refused")
      || !enrollmentTime(transfer.requestedAtMs) || transfer.requestedAtMs > observedAtMs
      || !enrollmentTime(transfer.expiresAtMs) || transfer.expiresAtMs <= transfer.requestedAtMs
      || !(transfer.grantedAtMs === null || (enrollmentTime(transfer.grantedAtMs) && transfer.grantedAtMs >= transfer.requestedAtMs && transfer.grantedAtMs <= observedAtMs))
      || !(transfer.completedAtMs === null || (enrollmentTime(transfer.completedAtMs) && transfer.grantedAtMs !== null && transfer.completedAtMs >= (transfer.grantedAtMs as number) && transfer.completedAtMs <= observedAtMs))
      || !(transfer.expectedRevision === null || (typeof transfer.expectedRevision === "number" && Number.isSafeInteger(transfer.expectedRevision) && transfer.expectedRevision >= 0))
      || !(transfer.ownershipRevision === null || (typeof transfer.ownershipRevision === "number" && Number.isSafeInteger(transfer.ownershipRevision) && transfer.ownershipRevision >= 0))
      || !(transfer.refusal === null || (typeof transfer.refusal === "string" && transfer.refusal.length > 0 && transfer.refusal.length <= 64))) return false;
    if ((transfer.phase === "requested") !== (transfer.grantedAtMs === null && transfer.refusal === null)) return false;
    if ((transfer.phase === "completed") !== (transfer.completedAtMs !== null)) return false;
    if ((transfer.phase === "refused") !== (transfer.refusal !== null)) return false;
    if (transfer.phase === "granted" && (transfer.grantedAtMs === null || transfer.expectedRevision === null)) return false;
    if (transfer.phase === "completed" && transfer.grantedAtMs === null) return false;
    if (transfer.phase === "requested" || transfer.phase === "granted") {
      if (live.has(transfer.client as string)) return false;
      live.add(transfer.client as string);
    }
    ids.add(transfer.transferId);
  }
  return true;
}
const erasureConfirmed = (state: State): boolean => state.lifecycle?.erasure?.confirmedAtMs != null;

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
  #accountWorkFlights = new Map<AccountWorkKind, object>();
  #contributionRebuildFlight: object | null = null;
  /** Completed stats reads are pure in (range, stats revision, admission
   * revision); the memo only ever serves after every fencing guard passes.
   * Bounded to a few ranges, dies with the object, and holds no authority. */
  #statsReadMemo = new Map<string, UsageStatsReport>();
  readonly #accountAlarm: AccountAlarm;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#accountAlarm = new AccountAlarm(ctx.storage);
    // Construction is read-only. Explicit maintenance or a registered mutation
    // owns initialization, upgrades and checkpoint writes.
  }

  #prepareFenced(accountId: string, generation: string, fence: FenceObservation, allowErased = false): EnrollmentError | null {
    try {
      this.ctx.storage.transactionSync(() => {
        const before = this.#fencePreflight(accountId, generation, allowErased);
        if (!before.ok) throw new FenceRefusal(before.error === "unauthorized" ? "unauthorized" : before.error === "account_erased" ? "account_erased" : "recovery_required");
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
        new AdmissionState(this.ctx.storage.sql).migrateCapacity();
        this.#migrateStatsPartition();
        this.#schema();
        this.#migrateFence();
        this.#migrateLeaderboard();
        new AdmissionState(this.ctx.storage.sql).auditControl(this.#stored(5).state);
        // An erased account never regrows the optional stats tables it scrubbed.
        if (!this.#statsPresent() && this.#statsEnabled() && !this.#erasureConfirmedStored()) {
          new StatsState(this.ctx.storage.sql).initialize();
          this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 8 WHERE id = 1");
        }
        if (this.#statsPresent()) new StatsState(this.ctx.storage.sql).auditControl(this.#stored(5).state);
        if (this.#contributionsPresent()) {
          const state = this.#stored(5).state;
          const control = new ContributionState(this.ctx.storage).control();
          if (state === null || state.phase !== "active" || control.accountId !== state.accountId
            || control.generation !== state.generation) throw new AdmissionFault("storage_invalid");
        }
        if (this.#contributionProjectionPresent()) new ContributionProjectionState(this.ctx.storage).status(Date.now());
        if (this.#accountWorkPresent()) {
          const state = this.#stored(5).state;
          if (!state) throw new ContributionFault("storage_invalid");
          new AccountWorkState(this.ctx.storage).snapshot(this.#workAuthority(state, Date.now()));
        }
        if (this.#contributionRebuildPresent()) {
          const state = this.#stored(5).state;
          for (const job of new ContributionRebuildState(this.ctx.storage).inventory())
            if (!state || job.receipt.accountId !== state.accountId || job.receipt.generation !== state.generation)
              throw new ContributionRebuildFault("storage_invalid");
        }
        this.#schema();
        const audited = this.#auditHistory();
        if (audited !== null) throw new AdmissionFault(audited === "storage_invalid" ? "storage_invalid" : "recovery_required");
        // Bounded automatic work: each registered mutation advances the v1 day
        // totals span by span, at most eight spans and a quarter second of its
        // own budget, until they cover the whole retained journal. The wall
        // clock here is the monotonic one: the account's own observation clock
        // must not be consumed by maintenance.
        const admission = new AdmissionState(this.ctx.storage.sql), state = this.#stored(5).state, started = performance.now();
        let spans = 0;
        while (!admission.advanceDayTotals(state).complete && ++spans < 8 && performance.now() - started < 250) { /* next span */ }
      });
      return null;
    } catch (error) { return error instanceof FenceRefusal || error instanceof AdmissionFault || error instanceof ContributionFault || error instanceof ContributionRebuildFault ? error.code : "storage_invalid"; }
  }
  /** True once the stored payload carries a confirmed erasure. Reads the
   * current schema-5+ row only; legacy rows cannot carry a lifecycle record. */
  #erasureConfirmedStored(): boolean {
    try { const state = this.#stored(5).state; return state !== null && erasureConfirmed(state); } catch { return false; }
  }

  #objects(): Record<string, SqlStorageValue>[] {
    return this.ctx.storage.sql.exec("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' LIMIT 30").toArray();
  }
  #schema(legacy = false): void {
    const objects = this.#objects();
    const withStats = !legacy && objects.some(object => object.name === "usage_stats_control");
    const withContributions = !legacy && objects.some(object => object.name === "usage_contribution_control");
    const withProjection = !legacy && objects.some(object => object.name === "usage_contribution_projection_control");
    const withWork = !legacy && objects.some(object => object.name === "account_work");
    const withRebuild = !legacy && objects.some(object => object.name === "usage_contribution_rebuild_jobs");
    // The reclamation ledger is created only by the flag-gated reclamation
    // record path (never in production while the flag stays unset); it is
    // tied to table presence, not to a schema version, so it stays additive.
    const withReclamation = withRebuild && objects.some(object => object.name === "usage_reclamation_ledger");
    const expected: Record<string, string> = { account_enrollment: SCHEMA_SQL, ...(legacy ? {} : ADMISSION_SCHEMA),
      ...(withStats ? STATS_SCHEMA : {}), ...(withContributions ? CONTRIBUTION_SCHEMA : {}), ...(withProjection ? CONTRIBUTION_PROJECTION_SCHEMA : {}),
      ...(withWork ? ACCOUNT_WORK_SCHEMA : {}), ...(withRebuild ? CONTRIBUTION_REBUILD_SCHEMA : {}), ...(withReclamation ? RECLAMATION_SCHEMA : {}) };
    if (!legacy) {
      const version = this.ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").toArray()[0]?.schema_version;
      if ((version === 6 || version === 7 || version === 8 || version === 9 || version === 10 || version === 11 || version === 12 || version === 13) !== withStats
        || (version === 9 || version === 10 || version === 11 || version === 12 || version === 13) !== withContributions
        || (version === 10 || version === 11 || version === 12 || version === 13) !== withProjection
        || (version === 11 || version === 12 || version === 13) !== withWork || (version === 13) !== withRebuild) throw new Error("storage_invalid");
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
    if (row.schema_version === 5 || row.schema_version === 6 || row.schema_version === 7 || row.schema_version === 8 || row.schema_version === 9 || row.schema_version === 10 || row.schema_version === 11 || row.schema_version === 12 || row.schema_version === 13) return;
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
    // Version six stores predate the exploded read model; the partition
    // rebuild below creates every derived table, so only the ladder advances.
    const version = this.ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").toArray()[0]?.schema_version;
    if (version === 6) this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 7 WHERE id = 1");
  }
  /** Ownership by (client, day) became ownership by (client, day, device).
   * The rebuild keeps every retained day under the device that published it
   * and removes the retired single-writer tables; the version ladder is
   * unchanged because the stats tables are recognised by their exact DDL. */
  #migrateStatsPartition(): void {
    if (!this.#statsPresent()) return;
    const version = this.ctx.storage.sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").one().schema_version;
    new StatsState(this.ctx.storage.sql).migratePartition();
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
          if (this.#accountWorkPresent()) this.#syncAccountWork(outcome.state, now);
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
    } catch (error) { return err(error instanceof AdmissionFault || error instanceof StatsFault || error instanceof ContributionFault
      || error instanceof ContributionRebuildFault ? error.code : "storage_invalid"); }
  }

  /** The Worker deployment version this account object is running under. */
  #workerVersion(): string | null {
    const value: unknown = this.env.USAGE_WORKER_VERSION;
    return enrollmentHex(value) ? value : null;
  }
  /** Pure preflight admits existing legacy shapes only for a fenced upgrade.
   * It never converts absent or malformed authority into a genesis guess. */
  #fencePreflight(accountId: string, generation: string, allowErased = false): EnrollmentResult<{ epoch: number; established: boolean }> {
    try {
      if (!this.#healthy || this.#generation() !== generation) return err("recovery_required");
      if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(accountId)))) return err("unauthorized");
      const objects = this.#objects();
      if (objects.length === 0) return ok({ epoch: RESTORE_FENCE_GENESIS_EPOCH, established: false });
      if (!objects.some(object => object.type === "table" && object.name === "account_enrollment" && object.sql === SCHEMA_SQL)) return err("storage_invalid");
      const rows = this.ctx.storage.sql.exec("SELECT id, schema_version, revision, payload FROM account_enrollment LIMIT 2").toArray();
      const row = rows[0];
      if (rows.length !== 1 || row.id !== 1 || typeof row.schema_version !== "number" || !Number.isInteger(row.schema_version)
        || row.schema_version < 1 || row.schema_version > 13 || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision)
        || row.revision < 0 || row.revision >= Number.MAX_SAFE_INTEGER) return err("storage_invalid");
      if (row.payload === null) return row.revision === 0 ? ok({ epoch: RESTORE_FENCE_GENESIS_EPOCH, established: false }) : err("storage_invalid");
      if (typeof row.payload !== "string" || row.payload.length > MAX_PAYLOAD || row.revision === 0) return err("storage_invalid");
      const state: unknown = JSON.parse(row.payload);
      if (!validState(state, row.schema_version === 1, row.schema_version >= 4, row.schema_version >= 5)) return err("storage_invalid");
      if (state.accountId !== accountId) return err("unauthorized");
      if (state.generation !== generation) return err("recovery_required");
      // The durable erasure tombstone: every ordinary path refuses a confirmed
      // erasure. Only lifecycle status/export and erase resumption pass it.
      if (!allowErased && erasureConfirmed(state)) return err("account_erased");
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
  async #fenceAcquire(accountId: string, generation: string, admitted: () => boolean = () => true, allowErased = false): Promise<EnrollmentResult<{ fence: FenceObservation; token: string }>> {
    if (!admitted()) return err("storage_unavailable");
    const workerVersion = this.#workerVersion();
    if (workerVersion === null) return err("recovery_required");
    const preflight = this.#fencePreflight(accountId, generation, allowErased);
    if (!preflight.ok) return preflight;
    const stub = this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId));
    // This ID belongs to one execution, not the retriable upload operation.
    // Concurrent exact uploads each retain their own outstanding holder.
    const input = { accountId, generation, epoch: preflight.value.epoch, workerVersion, leaseMs: RESTORE_FENCE_LEASE_TTL_MS, attemptId: enrollmentRandom() };
    let failure: EnrollmentError = "storage_unavailable";
    let uncertain = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!admitted()) break;
      let raw: unknown;
      try {
        raw = await stub.assertOpen(input);
        const reply = rpcSnapshot(raw, ["ok", "value"]);
        const lease = reply?.ok === true ? enrollmentSnapshot(reply.value, ["token", "epoch", "established", "deadlineMs"]) : null;
        if (lease !== null && lease.token === input.attemptId && lease.epoch === input.epoch
          && (lease.established === true || lease.established === false) && enrollmentTime(lease.deadlineMs)) {
          const fence = Object.freeze({ epoch: input.epoch, established: lease.established });
          if (preflight.value.established) this.#leaseEstablishment.add(input.attemptId);
          // A bounded caller can retire while acquisition is held. Settle the
          // exact grant without preparing or reading its canonical storage.
          if (!admitted()) {
            await this.#fenceSettle(accountId, input.attemptId, false);
            return err("storage_unavailable");
          }
          const prepared = this.#prepareFenced(accountId, generation, fence, allowErased);
          if (prepared !== null) {
            await this.#fenceSettle(accountId, input.attemptId, false);
            return err(prepared);
          }
          return ok({ fence, token: input.attemptId });
        }
        const rejected = rpcSnapshot(raw, ["ok", "error"]);
        if (rejected?.ok === false) {
          const code = rejected.error;
          failure = code === "recovery_required" || code === "clock_regressed" || code === "unauthorized" || code === "limit" || code === "account_erased" ? code : "storage_invalid";
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
  /** Each caller bounds and reserves its provider writes before dispatch. The
   * external fence retains actual anchor or diagnostic-index I/O; completion
   * removes local custody. Eviction leaves the durable holder unresolved. */
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
      // canonical provider operation. Durable Objects' waitUntil does not extend
      // lifetime: process loss leaves the separate durable fence held.
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
        const result = this.#transaction(observation, (state, now) => {
          // Every continuation is guarded inside the committing transaction:
          // an activation during an R2 await cannot revive a legacy writer.
          if (this.#contributionsActive()) {
            if (!state || state.phase !== "active") throw new AdmissionFault("not_enrolled");
            const settled = admission.progress(batch.deviceId, state);
            if (!settled.batch || !settled.journal || !equalAdmissionBytes(settled.batch.bytes, batch.bytes))
              throw new AdmissionFault("profile_superseded");
          }
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
  #contributionsPresent(): boolean {
    return this.ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name = 'usage_contribution_control' LIMIT 1").toArray().length === 1;
  }
  #contributionProjectionPresent(): boolean {
    return this.ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name = 'usage_contribution_projection_control' LIMIT 1").toArray().length === 1;
  }
  #contributionRebuildPresent(): boolean {
    return this.ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='usage_contribution_rebuild_jobs' LIMIT 1").toArray().length === 1;
  }
  #contributionsEnabled(): boolean {
    return this.#statsEnabled() && (this.env as Env & { AICHARTS_USAGE_CONTRIBUTIONS_ENABLED?: string }).AICHARTS_USAGE_CONTRIBUTIONS_ENABLED === "1";
  }
  #contributionsActive(): boolean {
    return this.#contributionsPresent() && new ContributionState(this.ctx.storage).control().phase === "active";
  }
  #accountWorkPresent(): boolean {
    return this.ctx.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name='account_work' LIMIT 1").toArray().length === 1;
  }
  #workAuthority(state: State, now: number): AccountWorkAuthority {
    return { accountId: state.accountId, generation: state.generation, observedAtMs: now, active: state.phase === "active" };
  }
  /** Only a registered mutation may add the bounded maintenance metadata.
   * The source commit, initial empty projection and work identity are atomic. */
  #syncAccountWork(state: State, now: number, resume?: AccountWorkKind): AccountWorkSnapshot | null {
    if (!this.#contributionsActive()) return null;
    const projection = new ContributionProjectionState(this.ctx.storage);
    if (!this.#contributionProjectionPresent()) {
      projection.initialize(state.accountId, state.generation);
      this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version=10 WHERE id=1");
    }
    const authority = this.#workAuthority(state, now), work = new AccountWorkState(this.ctx.storage);
    if (!this.#accountWorkPresent()) {
      work.initialize(authority);
      this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version=11 WHERE id=1");
    }
    const consent = accountConsentWork(state.accountId, state.generation, state.leaderboard, now);
    work.reconcile("consent", consent.key, consent.readyAtMs, authority, resume === "consent" && !this.#accountWorkFlights.has("consent"));
    const target = accountProjectionWork(projection.status(now), now);
    work.reconcile("projection", target.key, target.readyAtMs, authority, resume === "projection" && !this.#accountWorkFlights.has("projection"));
    return work.snapshot(authority);
  }
  #workRun<T>(observation: AdmissionObservation, run: (state: State, now: number) => T): T {
    const result = this.#transaction(observation, (state, now) => {
      if (!state || state.phase !== "active") throw new ContributionFault("not_enrolled");
      return { state, result: ok(run(state, now)) };
    });
    if (!result.ok) throw new ContributionFault(this.#contributionError(result.error));
    return result.value;
  }
  async #armAccountWork(observation: AdmissionObservation, target?: number): Promise<void> {
    const now = this.#workRun(observation, (_state, now) => now);
    const deadline = target ?? now + ACCOUNT_WORK_READY_DELAY_MS;
    if (!enrollmentTime(deadline) || deadline > CONTRIBUTION_MAX_TIME) throw new ContributionFault("clock_regressed");
    await this.#accountAlarm.arm(deadline, () => { this.#workRun(observation, () => {}); });
  }
  async #rearmAccountWork(observation: AdmissionObservation): Promise<void> {
    const deadline = this.#workRun(observation, (state, now) => {
      const work = this.#syncAccountWork(state, now);
      if (!work) return null;
      // A disabled canonical feature cannot create background provider work;
      // consent delivery remains independent of that feature's activation.
      return this.#contributionsEnabled() ? accountWorkDeadline(work) : accountWorkRecordDeadline(work.consent);
    });
    if (deadline !== null) await this.#armAccountWork(observation, deadline);
  }
  async #advanceContributionProjection(observation: AdmissionObservation, request: { schemaVersion: 3; accountId: string; generation: string }): Promise<ContributionProjectionAdvanceResult> {
    const projection = new ContributionProjectionState(this.ctx.storage);
    return new AccountContributionProjection(this.env, projection, (seen, action) => this.#transaction(seen, (state, now) => {
      if (!state || state.phase !== "active") throw new ContributionFault("not_enrolled");
      if (state.accountId !== request.accountId || state.generation !== request.generation) throw new ContributionFault("unauthorized");
      if (!this.#contributionsActive()) throw new ContributionFault("not_started");
      this.#syncAccountWork(state, now);
      const value = action(state, now);
      this.#syncAccountWork(state, now);
      return { state, result: ok(value) };
    }), () => this.#armAccountWork(observation)).advance(request, observation);
  }
  /** Called synchronously inside the same transaction as activation. Control
   * counters alone cannot hide a retained head, tombstone, journal or flight. */
  #legacyContributionStateIsEmpty(): boolean {
    const owner = this.#stored(5).state;
    if (!owner || owner.phase !== "active" || !this.#statsPresent()) return false;
    const legacy = new AdmissionState(this.ctx.storage.sql), first = legacy.control();
    const stats = new StatsState(this.ctx.storage.sql), second = stats.control();
    if (first.quarantined || first.revision !== 0 || first.heads !== 0 || first.live !== 0 || first.committed !== 0
      || legacy.pending(owner) !== null || second.quarantined || second.revision !== 0 || second.immutableBytes !== 0
      || stats.pendings().length !== 0 || stats.hasCommittedSnapshot()) return false;
    for (const table of ["usage_admission_heads", "usage_admission_journal", "usage_stats_days", "usage_stats_devices"] as const) {
      if (this.ctx.storage.sql.exec(`SELECT 1 FROM ${table} LIMIT 1`).toArray().length !== 0) return false;
    }
    return true;
  }

  async #contributionMutation<R extends Pick<ContributionBatch, "accountId" | "generation" | "deviceId">, T>(
    input: unknown, parse: (value: unknown) => R | null, initialize: boolean,
    run: (service: AccountContributions, request: R, secret: string, observation: AdmissionObservation) => Promise<ContributionResult<T>>,
    afterAction?: (source: ContributionState, request: R) => void,
  ): Promise<ContributionResult<T>> {
    if (!this.#contributionsEnabled()) return { ok: false, error: "storage_unavailable" };
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]);
    if (!dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    const request = parse(dto.request);
    if (!request) return { ok: false, error: "invalid_input" };
    const generation = this.#generation();
    if (generation === null || request.generation !== generation) return { ok: false, error: "recovery_required" };
    const authenticated = await this.#preauthenticateUpload(request.accountId, request.deviceId, generation, dto.uploadSecret);
    if (authenticated !== null) return { ok: false, error: this.#contributionError(authenticated) };
    const acquired = await this.#fenceAcquire(request.accountId, generation);
    if (!acquired.ok) return { ok: false, error: this.#contributionError(acquired.error) };
    const observation: AdmissionObservation = { generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    try {
      await this.#armAccountWork(observation);
      const contribution = new ContributionState(this.ctx.storage);
      const service = new AccountContributions(this.env, contribution, (seen, action) => this.#transaction(seen, (state, now) => {
        if (!state || state.phase !== "active") throw new ContributionFault("not_enrolled");
        if (state.accountId !== request.accountId || state.generation !== request.generation) throw new ContributionFault("unauthorized");
        if (!this.#contributionsPresent()) {
          if (!initialize) throw new ContributionFault("not_started");
          contribution.initialize(state.accountId, state.generation);
          this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version = 9 WHERE id = 1");
        }
        const value = action(state, now);
        this.#syncAccountWork(state, now);
        afterAction?.(contribution, request);
        return { state, result: ok(value) };
      }), () => this.#armAccountWork(observation));
      const result = await run(service, request, dto.uploadSecret, observation);
      await this.#rearmAccountWork(observation);
      return result;
    } catch (cause) { return { ok: false, error: cause instanceof ContributionFault ? cause.code : "storage_unavailable" }; }
    finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
  }
  #contributionError(error: EnrollmentError): ContributionError {
    return isContributionError(error) ? error : "storage_unavailable";
  }
  async activateContributions(input: unknown): Promise<ContributionResult<ContributionActivationReceipt>> {
    return this.#contributionMutation(input, parseContributionActivationRequest, true,
      (service, request, secret, seen) => service.activate(request, secret, seen, () => this.#legacyContributionStateIsEmpty()));
  }
  async migrateContributions(input: unknown): Promise<ContributionResult<ContributionMigrationReceipt>> {
    return this.#contributionMutation(input, parseContributionMigrationRequest, true,
      (service, request, secret, seen) => service.migrate(request, secret, seen));
  }
  async cancelContributionMigration(input: unknown): Promise<ContributionResult<ContributionTerminal>> {
    return this.#contributionMutation(input, parseContributionMigrationRequest, false,
      (service, request, secret, seen) => service.cancelMigration(request, secret, seen));
  }
  async grantContributionPopulation(input: unknown): Promise<ContributionResult<ContributionGrantReceipt>> {
    return this.#contributionMutation(input, parseContributionGrant, true, (service, request, secret, seen) => service.grant(request, secret, seen));
  }
  async admitContributions(input: unknown): Promise<ContributionResult<ContributionTerminal>> {
    return this.#contributionMutation(input, parseContributionBatch, false, (service, request, secret, seen) => service.admit(request, secret, seen));
  }
  async abandonContributions(input: unknown): Promise<ContributionResult<ContributionTerminal>> {
    return this.#contributionMutation(input, parseContributionAbandonRequest, false, (service, request, secret, seen) => service.abandon(request, secret, seen));
  }
  async cancelContributions(input: unknown): Promise<ContributionResult<ContributionTerminal>> {
    return this.#contributionMutation(input, parseContributionCancelRequest, false,
      (service, request, secret, seen) => service.cancel(request, secret, seen), (source, request) => {
        const operation = source.operation(request.batch.operationId);
        // The tagged no-reservation terminal is admitted only by the new
        // reader. Upgrade in the same SQL transaction as its first creation;
        // older binaries must refuse rather than reinterpret its metadata.
        if (operation?.kind === "batch" && operation.outcome === "abandoned" && operation.intent.deltaManifestHash === null)
          this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version=12 WHERE id=1 AND schema_version=11");
      });
  }
  async readContributionStatus(input: unknown): Promise<ContributionResult<ContributionStatus>> {
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]), request = dto && parseContributionStatusRequest(dto.request);
    if (!request || !dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "storage_unavailable" };
    const generation = this.#generation();
    if (generation === null || generation !== request.generation) return { ok: false, error: "recovery_required" };
    const uploadSecret = dto.uploadSecret;
    const result = await this.#readFenced(request.accountId, async () => {
      if (!this.#contributionsPresent()) return err("not_started");
      const scope = { accountId: request.accountId, sessionExpiresAtMs: 8_640_000_000_000_000 };
      const observation: AdmissionObservation = { generation, observed: Date.now(), fence: null, committed: false };
      return new AccountContributions(this.env, new ContributionState(this.ctx.storage), (seen, action) =>
        this.#privateDaysSnapshot(scope, seen, state => action(state, seen.observed))).status(request, uploadSecret, observation);
    });
    return result.ok ? result : { ok: false, error: this.#contributionError(result.error) };
  }
  /** Device-private canonical references. The head query cannot initialize
   * projections, repair memberships, arm alarms or advance stored clocks. */
  async readContributionHeads(input: unknown): Promise<ContributionHeadQueryResult> {
    const dto = enrollmentSnapshot(input, ["uploadSecret", "request"]), request = dto && parseContributionHeadQuery(dto.request);
    if (!request || !dto || !enrollmentHex(dto.uploadSecret)) return { ok: false, error: "invalid_input" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "storage_unavailable" };
    const generation = this.#generation();
    if (generation === null || generation !== request.generation) return { ok: false, error: "recovery_required" };
    const secret = dto.uploadSecret;
    const result = await this.#readFenced(request.accountId, async () => {
      if (!this.#contributionsPresent()) return err("not_started");
      const scope = { accountId: request.accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME };
      const observation: AdmissionObservation = { generation, observed: Date.now(), fence: null, committed: false };
      return new AccountContributions(this.env, new ContributionState(this.ctx.storage), (seen, action) =>
        this.#privateDaysSnapshot(scope, seen, state => action(state, seen.observed))).heads(request, secret, observation);
    });
    return result.ok ? result : { ok: false, error: this.#contributionError(result.error) };
  }
  /** Explicit trusted-coordinator maintenance. Each invocation advances at most
   * one bounded chunk or empty revision; reads never dispatch this work. */
  async advanceContributionProjection(input: unknown): Promise<ContributionProjectionAdvanceResult> {
    const raw = enrollmentSnapshot(input, ["schemaVersion", "accountId", "generation"]);
    if (raw?.schemaVersion !== 3 || !enrollmentAccount(raw.accountId) || !enrollmentHex(raw.generation))
      return { ok: false, error: "invalid_input", status: null };
    const request = { schemaVersion: 3 as const, accountId: raw.accountId, generation: raw.generation };
    if (!this.#contributionsEnabled()) return { ok: false, error: "storage_unavailable", status: null };
    if (this.#generation() !== request.generation) return { ok: false, error: "recovery_required", status: null };
    if (this.#accountWorkFlights.has("projection")) return { ok: false, error: "conflict", status: null };
    const acquired = await this.#fenceAcquire(request.accountId, request.generation);
    if (!acquired.ok) return { ok: false, error: this.#contributionError(acquired.error), status: null };
    const observation: AdmissionObservation = { generation: request.generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    let marker: object | null = null;
    try {
      if (this.#accountWorkFlights.has("projection")) throw new ContributionFault("conflict");
      await this.#armAccountWork(observation);
      const attempt = this.#workRun(observation, (state, now) => {
        if (this.#accountWorkFlights.has("projection")) throw new ContributionFault("conflict");
        if (this.#syncAccountWork(state, now, "projection") === null) throw new ContributionFault("not_started");
        const claimed = new AccountWorkState(this.ctx.storage).claim("projection", this.#workAuthority(state, now), "explicit");
        marker = claimed ?? Object.freeze({}); this.#accountWorkFlights.set("projection", marker); return claimed;
      });
      const result = await this.#advanceContributionProjection(observation, request);
      if (attempt !== null) {
        await this.#armAccountWork(observation);
        const outcome: AccountWorkOutcome = !result.ok ? { kind: "refuse", reason: accountWorkRefusal(result.error) }
          : result.value.appliedLag === 0 && result.value.publishedLag > 0
            ? { kind: "defer", readyAtMs: result.value.nextPublicationAtMs } : { kind: "progress" };
        this.#workRun(observation, (state, now) => new AccountWorkState(this.ctx.storage).complete(attempt, outcome, this.#workAuthority(state, now)));
      }
      if (this.#accountWorkFlights.get("projection") === marker) this.#accountWorkFlights.delete("projection");
      await this.#rearmAccountWork(observation);
      return result;
    } catch (cause) { return { ok: false, error: cause instanceof ContributionFault ? cause.code : "storage_unavailable", status: null }; }
    finally {
      if (marker !== null && this.#accountWorkFlights.get("projection") === marker) this.#accountWorkFlights.delete("projection");
      await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed);
    }
  }
  /** Trusted maintenance read. Unresolved dispatches remain visible after an
   * eviction; this read cannot resume work or release restore custody. */
  async readContributionWork(input: unknown): Promise<ContributionResult<AccountWorkSnapshot>> {
    const raw = enrollmentSnapshot(input, ["schemaVersion", "accountId", "generation"]);
    if (raw?.schemaVersion !== 3 || !enrollmentAccount(raw.accountId) || !enrollmentHex(raw.generation)) return { ok: false, error: "invalid_input" };
    const accountId = raw.accountId, generation = raw.generation;
    if (this.#generation() !== generation) return { ok: false, error: "recovery_required" };
    const result = await this.#readFenced(accountId, async () => {
      if (!this.#accountWorkPresent()) return err("not_started");
      const observation: AdmissionObservation = { generation, observed: Date.now(), fence: null, committed: false };
      return this.#privateDaysSnapshot({ accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME }, observation,
        state => new AccountWorkState(this.ctx.storage).snapshot(this.#workAuthority(state, observation.observed)));
    });
    return result.ok ? result : { ok: false, error: this.#contributionError(result.error) };
  }
  /** Account-private, trusted-coordinator read. A retained SQL publication is
   * required even if the corresponding immutable objects still exist. */
  async readContributionPage(input: unknown): Promise<ContributionQueryResult> {
    const request = parseContributionQuery(input);
    if (!request) return { ok: false, error: "invalid_input" };
    const result = await this.#readFenced(request.accountId, () => this.#readContributionPage(request));
    return result.ok ? result : { ok: false, error: result.error === "expired" || result.error === "snapshot_expired"
      ? result.error : this.#contributionError(result.error) };
  }
  /** Trusted coordinator diagnostic; no public route or repair authority.
   * Qualifies one cell against current canonical heads. The entire invocation,
   * including external authority checks, has one nonrenewable deadline. */
  async scrubContributionCell(input: unknown): Promise<ContributionScrubResult> {
    const request = parseContributionScrubRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "not_started" };
    if (this.#generation() !== request.generation) return { ok: false, error: "recovery_required" };
    let retired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + CONTRIBUTION_SCRUB_DEADLINE_MS, expired = Object.freeze({});
    const live = () => { if (retired || performance.now() >= deadline) throw expired; };
    const run = async (): Promise<ContributionScrubResult> => {
      live();
      const before = await this.#readAuthority(request.accountId, request.generation);
      live();
      if (before !== null) return { ok: false, error: this.#contributionError(before) };
      if (!this.#contributionsPresent() || !this.#contributionProjectionPresent()) return { ok: false, error: "not_started" };
      const scope = { accountId: request.accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME };
      const observation: AdmissionObservation = { generation: request.generation, observed: Date.now(), fence: null, committed: false };
      const original = this.#privateDaysSnapshot(scope, observation, state => Object.freeze({ ...state.anchor }));
      if (!original.ok) return { ok: false, error: this.#contributionError(original.error) };
      const firstAnchor = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      live();
      if (!firstAnchor || !sameNamespaceAnchor(firstAnchor, original.value)) return { ok: false, error: "recovery_required" };
      const observe = () => {
        // The backend invokes this before SQL and after each object await.
        // An expired outer invocation cannot continue its private reads.
        live();
        const current = this.#privateDaysSnapshot(scope, observation, state => {
          if (!sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
          return Object.freeze({ accountId: state.accountId, generation: state.generation,
            active: state.phase === "active", observedAtMs: observation.observed });
        });
        if (!current.ok) throw new ContributionFault(this.#contributionError(current.error));
        return current.value;
      };
      const canonical = new ContributionState(this.ctx.storage), projection = new ContributionProjectionState(this.ctx.storage);
      observe();
      const originalRoot = JSON.stringify(projection.control().publishedRoot);
      const checked = await scrubContributionCell(this.env.STAGING, request, canonical, projection, observe);
      live();
      const lastAnchor = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      live();
      if (!lastAnchor || !sameNamespaceAnchor(lastAnchor, original.value)) return { ok: false, error: "recovery_required" };
      const after = await this.#readAuthority(request.accountId, request.generation);
      live();
      if (after !== null) return { ok: false, error: this.#contributionError(after) };
      observe();
      if (checked.ok) {
        // Canonical progress during the outer authority awaits invalidates the
        // receipt even if the original immutable objects are still readable.
        const source = canonical.control(), control = projection.control();
        if (source.accountId !== request.accountId || control.accountId !== request.accountId
          || source.generation !== request.generation || control.generation !== request.generation
          || source.phase !== "active" || source.legacySeal !== null) throw new ContributionFault("recovery_required");
        if (source.revision !== request.expectedRevision || source.headCount !== checked.value.checkedHeads
          || control.appliedRevision !== request.expectedRevision || control.publishedRevision !== request.expectedRevision
          || control.source !== null || projection.pending() !== null
          || (control.publishedRoot?.hash ?? null) !== checked.value.rootHash
          || JSON.stringify(control.publishedRoot) !== originalRoot) throw new ContributionFault("conflict");
        const publication = projection.publication(request.expectedRevision, observation.observed);
        if (publication.expiresAtMs !== null || JSON.stringify(publication.root) !== JSON.stringify(control.publishedRoot))
          throw new ContributionFault("storage_invalid");
      }
      return parseContributionScrubResult(request, checked) ?? { ok: false, error: "storage_invalid" };
    };
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { retired = true; reject(expired); }, CONTRIBUTION_SCRUB_DEADLINE_MS);
      });
      const result = await Promise.race([run(), timeout]);
      live();
      return result;
    } catch (cause) {
      return { ok: false, error: cause === expired ? "deadline" : cause instanceof ContributionFault ? cause.code : "storage_unavailable" };
    } finally { retired = true; clearTimeout(timer); }
  }
  /** A caller timeout retires all canonical continuations. Cleanup still owns
   * its exact fence token; neither the timer nor waitUntil can drain a pending
   * provider write or prove execution survived eviction. */
  async #boundedContributionRebuild<T>(run: (live: () => void) => Promise<
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ContributionRebuildError }>>): Promise<
      Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ContributionRebuildError }>> {
    let retired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + CONTRIBUTION_REBUILD_DEADLINE_MS, expired = Object.freeze({});
    const live = () => { if (retired || performance.now() >= deadline) throw expired; };
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { retired = true; reject(expired); }, CONTRIBUTION_REBUILD_DEADLINE_MS);
      });
      const running = run(live);
      this.ctx.waitUntil(running.then(() => {}, () => {}));
      const result = await Promise.race([running, timeout]);
      live(); return result;
    } catch (cause) {
      return { ok: false, error: cause === expired ? "deadline" : cause instanceof ContributionRebuildFault ? cause.code
        : cause instanceof ContributionFault ? cause.code : "storage_unavailable" };
    } finally { retired = true; clearTimeout(timer); }
  }
  /** Trusted, explicit diagnostic maintenance. This never publishes its
   * scratch root or schedules a new background work class. */
  async executeContributionRebuild(input: unknown): Promise<ContributionRebuildResult> {
    const request = parseContributionRebuildRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "not_started" };
    if (this.#generation() !== request.generation) return { ok: false, error: "recovery_required" };
    if (this.#contributionRebuildFlight !== null) return { ok: false, error: "conflict" };
    const marker = Object.freeze({}); this.#contributionRebuildFlight = marker;
    return this.#boundedContributionRebuild(async live => {
      try {
        const admitted = () => { try { live(); return true; } catch { return false; } };
        const acquired = await this.#fenceAcquire(request.accountId, request.generation, admitted);
        if (!acquired.ok) { live(); return { ok: false, error: this.#contributionError(acquired.error) }; }
        const observation: AdmissionObservation = { generation: request.generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
        try {
          live();
          const scope = { accountId: request.accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME };
          const original = this.#privateDaysSnapshot(scope, observation, state => Object.freeze({ ...state.anchor }));
          if (!original.ok) return { ok: false, error: this.#contributionError(original.error) };
          const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
          live();
          if (!external || !sameNamespaceAnchor(external, original.value)) throw new ContributionFault("recovery_required");
          // The helper's own storage timeout may precede the provider result.
          // Retain the raw put, rather than that timeout wrapper, as custody.
          const bucket = new Proxy(this.env.STAGING, { get: (target, property) => {
            const method: unknown = Reflect.get(target, property, target);
            if ((property === "get" || property === "put") && typeof method === "function") return (...args: unknown[]) => {
              live();
              const pending = Reflect.apply(method, target, args) as Promise<unknown>;
              if (property === "put") this.#retainCanonicalWrite(acquired.value.token, pending);
              return pending.then(value => {
                try { live(); } catch (cause) {
                  if (property === "get" && value && typeof value === "object" && "body" in value
                    && value.body instanceof ReadableStream) void value.body.cancel().catch(() => undefined);
                  throw cause;
                }
                return value;
              });
            };
            return typeof method === "function" ? method.bind(target) : method;
          } });
          const rebuild = new ContributionRebuildState(this.ctx.storage);
          const previous = this.#privateDaysSnapshot(scope, observation, () =>
            this.#contributionRebuildPresent() ? rebuild.status(request.jobId) : null);
          if (!previous.ok) return { ok: false, error: this.#contributionError(previous.error) };
          const prior = previous.value?.receipt;
          const retained = prior !== undefined && (request.action === "begin" ? prior.sourceRevision === request.expectedRevision
            : prior.version === request.expectedVersion + 1 && prior.action === request.action && prior.expectedVersion === request.expectedVersion);
          const service = new AccountContributionRebuild({ STAGING: bucket }, rebuild, (seen, action) => {
            // Check before entering #transaction, which advances stored clocks.
            live();
            return this.#transaction(seen, (state, now) => {
              live();
              if (!state || state.phase !== "active") throw new ContributionFault("not_enrolled");
              if (state.accountId !== request.accountId || state.generation !== request.generation
                || !sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
              if (!this.#contributionsActive() || !this.#contributionProjectionPresent() || !this.#accountWorkPresent())
                throw new ContributionFault("not_started");
              if (!this.#contributionRebuildPresent()) {
                if (request.action !== "begin") throw new ContributionFault("not_started");
                rebuild.initialize();
                this.ctx.storage.sql.exec("UPDATE account_enrollment SET schema_version=13 WHERE id=1 AND schema_version IN (11,12)");
              }
              const value = action(state, now);
              live(); return { state, result: ok(value) };
            });
          });
          const result = await service.execute(request, observation);
          live();
          const last = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
          live();
          if (!last || !sameNamespaceAnchor(last, original.value)) throw new ContributionFault("recovery_required");
          const authority = await this.#readAuthority(request.accountId, request.generation);
          live();
          if (authority !== null) return { ok: false, error: this.#contributionError(authority) };
          const current = this.#privateDaysSnapshot(scope, observation, state => {
            if (!sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
            if (result.ok && request.action !== "abort" && !retained) {
              const source = new ContributionState(this.ctx.storage).control(), projection = new ContributionProjectionState(this.ctx.storage);
              const control = projection.control(), receipt = result.value;
              if (source.accountId !== request.accountId || source.generation !== request.generation || source.phase !== "active"
                || source.legacySeal !== null) throw new ContributionFault("recovery_required");
              if (source.revision !== receipt.sourceRevision || source.headCount !== receipt.headCount
                || JSON.stringify(control.publishedRoot) !== JSON.stringify(receipt.publishedRoot)
                || JSON.stringify(control.appliedRoot) !== JSON.stringify(receipt.publishedRoot)) throw new ContributionFault("conflict");
              if (source.pendingOperation !== null || control.source !== null || projection.pending() !== null
                || control.appliedRevision !== receipt.sourceRevision || control.publishedRevision !== receipt.sourceRevision)
                throw new ContributionRebuildFault("not_caught_up");
              const publication = projection.publication(receipt.sourceRevision, observation.observed);
              if (publication.expiresAtMs !== null || JSON.stringify(publication.root) !== JSON.stringify(receipt.publishedRoot))
                throw new ContributionFault("conflict");
            }
          });
          if (!current.ok) return { ok: false, error: isContributionRebuildError(current.error) ? current.error : "storage_unavailable" };
          if (!result.ok) return { ok: false, error: isContributionRebuildError(result.error) ? result.error : "storage_invalid" };
          const receipt = parseContributionRebuildReceipt(result.value);
          return receipt && receipt.accountId === request.accountId && receipt.generation === request.generation
            && receipt.jobId === request.jobId && receipt.action === request.action && receipt.expectedVersion === request.expectedVersion
            ? { ok: true, value: receipt } : { ok: false, error: "storage_invalid" };
        } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
      } finally { if (this.#contributionRebuildFlight === marker) this.#contributionRebuildFlight = null; }
    });
  }
  /** SELECT-only diagnostic status. Missing jobs stay missing; source drift or
   * a retained pending step cannot cause initialization, abort or recovery. */
  async readContributionRebuild(input: unknown): Promise<ContributionRebuildStatusResult> {
    const request = parseContributionRebuildReadRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "not_started" };
    if (this.#generation() !== request.generation) return { ok: false, error: "recovery_required" };
    return this.#boundedContributionRebuild(async live => {
      live();
      const before = await this.#readAuthority(request.accountId, request.generation);
      live();
      if (before !== null) return { ok: false, error: this.#contributionError(before) };
      const scope = { accountId: request.accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME };
      const observation: AdmissionObservation = { generation: request.generation, observed: Date.now(), fence: null, committed: false };
      const original = this.#privateDaysSnapshot(scope, observation, state => Object.freeze({ ...state.anchor }));
      if (!original.ok) return { ok: false, error: this.#contributionError(original.error) };
      const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      live();
      if (!external || !sameNamespaceAnchor(external, original.value)) throw new ContributionFault("recovery_required");
      const read = () => {
        live();
        return this.#privateDaysSnapshot(scope, observation, state => {
          if (!sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
          if (!this.#contributionRebuildPresent()) return null;
          const value = new ContributionRebuildState(this.ctx.storage).status(request.jobId);
          if (value && (value.receipt.accountId !== request.accountId || value.receipt.generation !== request.generation))
            throw new ContributionFault("storage_invalid");
          if (value && value.receipt.completedAtMs > observation.observed) throw new ContributionFault("clock_regressed");
          return value;
        });
      };
      const first = read();
      if (!first.ok) return { ok: false, error: this.#contributionError(first.error) };
      const last = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      live();
      if (!last || !sameNamespaceAnchor(last, original.value)) throw new ContributionFault("recovery_required");
      const after = await this.#readAuthority(request.accountId, request.generation);
      live();
      if (after !== null) return { ok: false, error: this.#contributionError(after) };
      const current = read();
      return current.ok ? current : { ok: false, error: this.#contributionError(current.error) };
    });
  }
  async #readContributionPage(request: ContributionQuery): Promise<ContributionQueryResult> {
    if (!this.#contributionsEnabled() || !this.#contributionProjectionPresent()) return { ok: false, error: "not_started" };
    try {
      const generation = this.#generation();
      if (generation === null) return { ok: false, error: "recovery_required" };
      const observation: AdmissionObservation = { generation, observed: Date.now(), fence: null, committed: false };
      const original = this.#privateDaysSnapshot(request, observation, state => Object.freeze({ ...state.anchor }));
      if (!original.ok) return { ok: false, error: original.error === "expired" ? "expired" : this.#contributionError(original.error) };
      const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      return await queryContributionPage(this.env.STAGING, request, revision => {
        const result = this.#privateDaysSnapshot(request, observation, state => {
          if (!external || !sameNamespaceAnchor(external, original.value) || !sameNamespaceAnchor(state.anchor, original.value))
            throw new ContributionQueryFault("recovery_required");
          const projection = new ContributionProjectionState(this.ctx.storage), status = projection.status(observation.observed);
          let publication;
          try { publication = projection.publication(revision ?? status.publishedRevision, observation.observed); }
          catch (error) {
            if (error instanceof ContributionFault && (error.code === "conflict" || error.code === "invalid_input")) throw new ContributionQueryFault("snapshot_expired");
            throw error;
          }
          const source = new ContributionState(this.ctx.storage).control();
          return Object.freeze({ accountId: state.accountId, generation: state.generation, sourceRevision: status.sourceRevision,
            latestAppliedRevision: status.appliedRevision, latestPublishedRevision: status.publishedRevision, revision: publication.revision, root: publication.root,
            unresolvedLegacyBodies: source.legacySeal?.v2BodyCount ?? 0, observedAtMs: observation.observed });
        });
        if (!result.ok) throw new ContributionQueryFault(result.error === "expired" || result.error === "snapshot_expired"
          ? result.error : this.#contributionError(result.error));
        return result.value;
      });
    } catch (error) {
      return { ok: false, error: error instanceof ContributionFault || error instanceof ContributionQueryFault ? error.code : "storage_unavailable" };
    }
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
        while (!admission.advanceDayTotals(state).complete) { /* bounded by the journal revision cap */ }
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
  /** Pure external authority check. A read linearizes no later than its final
   * successful check; a close or epoch change during its awaits refuses it. */
  async #readAuthority(accountId: string, generation: string, allowErased = false): Promise<EnrollmentError | null> {
    const local = this.#fencePreflight(accountId, generation, allowErased);
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
      // A sealed external tombstone refuses every ordinary read even when the
      // local payload was restored from a pre-erasure snapshot.
      if (record?.phase === "erased" && !allowErased) return "account_erased";
      return record?.schemaVersion === 1 && record.accountId === accountId && record.generation === generation
        && record.epoch === local.value.epoch && record.workerVersion === this.#workerVersion() && (record.phase === "open" || record.phase === "erased")
        && enrollmentTime(record.updatedAtMs) && record.updatedAtMs <= view.observedAtMs
        && (record.established === false || (record.established === true && local.value.established)) ? null : "recovery_required";
    } catch { return "storage_unavailable"; }
    finally { disposeReply(raw); }
  }
  async #readFenced<T>(accountId: string, read: () => Promise<EnrollmentResult<T>>, allowErased = false): Promise<EnrollmentResult<T>> {
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    const before = await this.#readAuthority(accountId, generation, allowErased);
    if (before !== null) return err(before);
    const result = await read();
    const after = await this.#readAuthority(accountId, generation, allowErased);
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
      const stats = new StatsState(this.ctx.storage.sql), bodyHash = statsHash(statsUploadText(request));
      return await new AccountStats(this.env, stats, (seen, run) =>
        this.#transaction(seen, (state, now) => {
          if (this.#contributionsActive()) {
            const receipt = stats.progress(request.deviceId).receipt;
            if (!receipt || receipt.bodyHash !== bodyHash || receipt.operationId !== request.operationId || receipt.sequence !== request.sequence)
              throw new StatsFault("profile_superseded");
          }
          return { state, result: ok(run(state, now)) };
        })).admit(request, dto.uploadSecret, observation);
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
      const stats = new StatsState(this.ctx.storage.sql);
      return await new AccountStats(this.env, stats, (seen, run) =>
        this.#transaction(seen, (state, now) => {
          if (this.#contributionsActive()) {
            const progress = stats.progress(request.deviceId), receipt = progress.receipt;
            const committed = receipt?.bodyHash === request.bodyHash && receipt.operationId === request.operationId
              && receipt.sequence === request.sequence && receipt.revision === request.expectedRevision + 1;
            const abandoned = progress.sequence === request.sequence - 1 && stats.control().revision > request.expectedRevision;
            if (!committed && !abandoned) throw new StatsFault("profile_superseded");
          }
          return { state, result: ok(run(state, now)) };
        })).abandon(request, dto.uploadSecret, observation);
    } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
  }
  async readUsageStats(input: unknown): Promise<StatsResult<UsageStatsReport>> {
    const request = parseStatsQuery(input);
    if (!request) return { ok: false, error: "invalid_input" };
    return this.#readFenced(request.accountId, () => this.#readUsageStats(input)) as Promise<StatsResult<UsageStatsReport>>;
  }
  /** Lifetime totals for the private dashboard: every device's snapshot days
   * plus retained v1 day totals no snapshot from that device covers. */
  async readUsageTotals(input: unknown): Promise<StatsTotalsResult> {
    const request = parseStatsTotalsQuery(input);
    if (!request) return { ok: false, error: "invalid_input" };
    return this.#readFenced(request.accountId, () => this.#readUsageTotals(input)) as Promise<StatsTotalsResult>;
  }
  async #readUsageTotals(input: unknown): Promise<StatsTotalsResult> {
    const request = parseStatsTotalsQuery(input);
    if (request === null) return { ok: false, error: "invalid_input" };
    if (!this.#statsEnabled() || !this.#statsPresent()) return { ok: false, error: "storage_unavailable" };
    try {
      const generation = this.#generation(), observed = Date.now();
      if (generation === null) return { ok: false, error: "recovery_required" };
      const observation: AdmissionObservation = { generation, observed, fence: null, committed: false };
      const original = this.#privateDaysSnapshot(request, observation, state => Object.freeze({ ...state.anchor }));
      if (!original.ok) return { ok: false, error: original.error as StatsTotalsResult extends { ok: false; error: infer E } ? E : never };
      const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      const result = this.#privateDaysSnapshot(request, observation, state => {
        if (!external || !sameNamespaceAnchor(external, original.value) || !sameNamespaceAnchor(state.anchor, original.value)) throw new StatsFault("recovery_required");
        return new StatsState(this.ctx.storage.sql).totals(state, observation.observed);
      });
      return result.ok ? result : { ok: false, error: result.error as StatsTotalsResult extends { ok: false; error: infer E } ? E : never };
    } catch { return { ok: false, error: "storage_unavailable" }; }
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
    } catch (error) { return err(error instanceof AdmissionFault || error instanceof StatsFault || error instanceof ContributionFault
      || error instanceof ContributionQueryFault || error instanceof ContributionRebuildFault ? error.code : "storage_invalid"); }
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
  #acknowledgeConsent(observation: AdmissionObservation, view: LeaderboardConsentViewV1, eventAtMs: number): void {
    this.#workRun(observation, (state, now) => {
      if (!this.#accountWorkPresent()) return;
      const target = accountConsentWork(state.accountId, state.generation, { ...view, changedAtMs: eventAtMs }, now);
      if (target.key !== null) new AccountWorkState(this.ctx.storage).acknowledgeConsent(target.key, this.#workAuthority(state, now));
    });
  }

  async #deliverConsentWork(observation: AdmissionObservation, attempt: AccountWorkAttempt): Promise<AccountWorkOutcome> {
    const candidate = this.#workRun(observation, (state, now) => {
      const target = accountConsentWork(state.accountId, state.generation, state.leaderboard, now);
      if (target.key !== attempt.key) return null;
      return { accountId: state.accountId, generation: state.generation, view: consentViewOf(state.leaderboard), eventAtMs: state.leaderboard.changedAtMs };
    });
    if (!candidate) return { kind: "progress" };
    const result = await this.#publishLeaderboardConsent(candidate.accountId, candidate.view, candidate.eventAtMs);
    if (result === "published") return { kind: "acknowledge" };
    if ((result === "handle_unavailable" || result === "publishing_full") && await this.#restoreLeaderboardConsent(candidate.accountId,
      candidate.generation, candidate, { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: 0 })) return { kind: "progress" };
    return { kind: "refuse", reason: result === "unavailable" ? null : "publishing_refused" };
  }
  async #deliverProjectionWork(observation: AdmissionObservation, attempt: AccountWorkAttempt): Promise<AccountWorkOutcome> {
    const result = await this.#advanceContributionProjection(observation, {
      schemaVersion: 3, accountId: attempt.accountId, generation: attempt.generation,
    });
    if (!result.ok) return { kind: "refuse", reason: accountWorkRefusal(result.error) };
    return result.value.appliedLag === 0 && result.value.publishedLag > 0
      ? { kind: "defer", readyAtMs: result.value.nextPublicationAtMs } : { kind: "progress" };
  }
  async #runAccountWork(observation: AdmissionObservation, attempt: AccountWorkAttempt): Promise<void> {
    try {
      let outcome: AccountWorkOutcome;
      try { outcome = await (attempt.kind === "consent" ? this.#deliverConsentWork(observation, attempt) : this.#deliverProjectionWork(observation, attempt)); }
      catch (cause) { outcome = { kind: "refuse", reason: accountWorkRefusal(cause instanceof ContributionFault ? cause.code : "storage_unavailable") }; }
      // A yielded handler has no provider retry left after its watchdog. Never
      // expose pending retry work before a fresh wake is durable. A failed arm
      // preserves the explicit unresolved flight for maintenance to reconcile.
      await this.#armAccountWork(observation);
      this.#workRun(observation, (state, now) =>
        new AccountWorkState(this.ctx.storage).complete(attempt, outcome, this.#workAuthority(state, now)));
    } finally {
      // A class becomes eligible independently of the other class's provider
      // call. Failed persistence leaves its durable flight for reconciliation.
      if (this.#accountWorkFlights.get(attempt.kind) === attempt) this.#accountWorkFlights.delete(attempt.kind);
      await this.#rearmAccountWork(observation);
    }
  }
  /** One due attempt per class. Both start before either is awaited, so an
   * unavailable public index cannot prevent a numeric projection from starting.
   * A bounded yield releases only the handler. The independent durable flight
   * watchdog and execution registration survive every unfinished continuation. */
  async #accountWorkAlarm(): Promise<void> {
    const candidate = this.ctx.storage.transactionSync(() => {
      this.#schema(); const { state } = this.#stored(5);
      return state?.phase === "active" ? { accountId: state.accountId, generation: state.generation } : null;
    });
    if (!candidate) return;
    const acquired = await this.#fenceAcquire(candidate.accountId, candidate.generation);
    if (!acquired.ok) {
      if (acquired.error === "unavailable" || acquired.error === "storage_unavailable") throw new Error("account_work_authority_unavailable");
      return;
    }
    const observation: AdmissionObservation = { generation: candidate.generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
    let delegated = false;
    let jobsFinished = false, settlement: Promise<void> | null = null;
    let finishHandler!: () => void;
    const handlerFinished = new Promise<void>(resolve => { finishHandler = resolve; });
    try {
      const due = this.#workRun(observation, (state, now) => {
        if (!this.#syncAccountWork(state, now)) return null;
        const work = new AccountWorkState(this.ctx.storage), authority = this.#workAuthority(state, now);
        for (const kind of ["consent", "projection"] as const) work.watch(kind, authority);
        const snapshot = work.snapshot(authority);
        return (["consent", "projection"] as const).filter(kind => (kind === "consent" || this.#contributionsEnabled())
          && !this.#accountWorkFlights.has(kind) && snapshot[kind].flight === null
          && snapshot[kind].nextAtMs !== null && snapshot[kind].nextAtMs! <= now);
      });
      if (!due || due.length === 0) { await this.#rearmAccountWork(observation); return; }
      // This wake is durable before claim. A crash immediately after claim
      // retains a bounded retry; the next handler observes its future deadline.
      await this.#armAccountWork(observation);
      const attempts = this.#workRun(observation, (state, now) => {
        const work = new AccountWorkState(this.ctx.storage), authority = this.#workAuthority(state, now);
        return due.flatMap(kind => { const attempt = work.claim(kind, authority); return attempt ? [attempt] : []; });
      });
      for (const attempt of attempts) this.#accountWorkFlights.set(attempt.kind, attempt);
      // Establish the shared settlement owner before yielding. Neither a timer
      // nor waitUntil can release this lease or attest to provider completion.
      const completion = Promise.allSettled(attempts.map(attempt => this.#runAccountWork(observation, attempt)))
        .then(results => { jobsFinished = true; return results; });
      settlement = completion.then(async () => {
        await handlerFinished;
        await this.#fenceSettle(candidate.accountId, acquired.value.token, observation.committed);
      });
      // Unexpected settlement failure retains the durable holder. Attach the
      // rejection handler now, including when the alarm returns before I/O.
      void settlement.catch(() => {});
      delegated = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const results = await Promise.race([completion, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ACCOUNT_WORK_DISPATCH_YIELD_MS); })]);
        if (results !== null) {
          const failure = results.find(result => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        }
        // If the initial preclaim wake was consumed, this preserves the single
        // future watchdog. Once it fires, an unresolved class never busy-polls.
        if (results === null) await this.#rearmAccountWork(observation);
      } finally { if (timer !== undefined) clearTimeout(timer); }
    } catch (cause) {
      // Invalid or closed authority cannot be repaired by background polling.
      // Transient storage failures retain the provider's bounded alarm retries.
      if (!(cause instanceof ContributionFault) || accountWorkRefusal(cause.code) === null) throw cause;
    } finally {
      finishHandler();
      if (!delegated) await this.#fenceSettle(candidate.accountId, acquired.value.token, observation.committed);
      else if (jobsFinished) await settlement;
    }
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
      await this.#armAccountWork(observation);
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
        this.#syncAccountWork(state, now);
        return { state, result: ok({ view: consentViewOf(state.leaderboard), eventAtMs: now }) };
      });
      if (!result.ok) return false;
      restored = result.value;
      if (restored === null) return true;
      const published = await this.#publishLeaderboardConsent(accountId, restored.view, restored.eventAtMs) === "published";
      if (published) this.#acknowledgeConsent(observation, restored.view, restored.eventAtMs);
      if (this.#accountWorkPresent()) await this.#rearmAccountWork(observation);
      return published;
    } finally { await this.#fenceSettle(accountId, acquired.value.token, observation.committed); }
  }

  /** Durable delivery retry. A consent mutation arms this before committing,
   * so an index outage or lost response cannot strand a saved decision. The
   * latest stored decision is replayed; reads never perform this repair. */
  async alarm(): Promise<void> {
    if (this.#accountWorkPresent()) { await this.#accountWorkAlarm(); return; }
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
      if (!unchanged) { await this.#accountAlarm.arm(Date.now() + 60_000, () => {}); return; }
      const published = await this.#publishLeaderboardConsent(candidate.accountId, candidate.view, candidate.eventAtMs);
      if (published === "published") return;
      if ((published === "handle_unavailable" || published === "publishing_full") && await this.#restoreLeaderboardConsent(candidate.accountId,
        candidate.generation, candidate, { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: 0 })) return;
      throw new Error("consent_delivery_unavailable");
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "storage_invalid")) return;
      // Explicitly retain the retry after provider alarm retries are exhausted.
      await this.#accountAlarm.arm(Date.now() + 60_000, () => {});
      throw new Error("consent_delivery_unavailable");
    } finally { await this.#fenceSettle(candidate.accountId, acquired.value.token, true); }
  }

  /** Fenced, idempotent consent write. The restore-fence lease is acquired and
   * settled exactly like other mutations; an unchanged decision retains its
   * event identity and re-publishes, repairing a previously lost apply. A
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
        await this.#armAccountWork(observation, observed + 60_000);
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
        this.#workRun(observation, (state, now) => this.#syncAccountWork(state, now, "consent"));
        const published = await this.#publishLeaderboardConsent(request.accountId, committed.view, committed.eventAtMs);
        if (published === "published") {
          this.#acknowledgeConsent(observation, committed.view, committed.eventAtMs);
          if (this.#accountWorkPresent()) await this.#rearmAccountWork(observation);
          return ok(committed.view);
        }
        if ((published === "handle_unavailable" || published === "publishing_full") && previous !== null
          && await this.#restoreLeaderboardConsent(request.accountId, generation, committed, previous)) return err(published);
        if (this.#accountWorkPresent()) await this.#rearmAccountWork(observation);
        return err("storage_unavailable");
      } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
    } catch (cause) { return err(cause instanceof ContributionFault ? cause.code : "storage_unavailable"); }
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
    // The index may read an erasing/erased source: it reads back as withdrawn
    // (M6 Erase), which is how the index removes membership and never revives it.
    return this.#readFenced(request.accountId, () => this.#readLeaderboardDelivery(input), true);
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
        if (leaderboard.consent !== true || erasureConfirmed(state)) {
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

  /* -------------------------------------------------- Phase 10 lifecycle */
  /** Account-session lifecycle operations: status, export, device list and
   * revocation, two-step erase and ordered writer transfer. Reads pass the
   * erasure tombstone so an erased account can still prove its state; every
   * mutation acquires the restore fence, records durable intent before any
   * effect, and is idempotent under retry. The reply vocabulary is the frozen
   * `lifecycle-contract` so the HTTP handler never sees internal codes. */
  async lifecycle(input: unknown): Promise<UsageLifecycleResult> {
    const request = parseUsageLifecycleRequest(input);
    if (request === null) return { ok: false, error: "invalid_input" };
    let result: EnrollmentResult<UsageLifecycleValue>;
    try {
      switch (request.operation) {
        case "status": result = await this.#lifecycleStatus(request); break;
        case "export": result = await this.#lifecycleExport(request, request.cursor); break;
        case "devices": result = await this.#lifecycleDevices(request); break;
        case "revoke_device": result = await this.#lifecycleRevoke(request, request.deviceId); break;
        case "erase_request": result = await this.#lifecycleEraseRequest(request); break;
        case "erase_confirm": result = await this.#lifecycleEraseConfirm(request, request.token); break;
        case "transfer_request": result = await this.#lifecycleTransferRequest(request, request.client, request.fromDeviceId, request.toDeviceId); break;
        case "transfer_grant": result = await this.#lifecycleTransferGrant(request, request.transferId); break;
        default: result = await this.#lifecycleTransferComplete(request, request.transferId); break;
      }
    } catch { result = err("storage_unavailable"); }
    return result.ok ? result : { ok: false, error: lifecycleError(result.error) };
  }
  /** Fenced read that tolerates the erasure tombstone. Pending accounts and
   * absent state read as not_enrolled exactly like the consent route. */
  async #lifecycleRead<T>(scope: LifecycleScope, read: (state: State, revision: number, admission: AdmissionState, control: AdmissionControl, now: number) => T): Promise<EnrollmentResult<T>> {
    // Status and export stay readable after erasure only while the local
    // payload itself reflects the confirmed erasure. A restored pre-erasure
    // payload under a sealed fence tombstone refuses like every other read.
    let allowErased = false;
    try { allowErased = this.ctx.storage.transactionSync(() => { const { state } = this.#stored(5); return state !== null && erasureConfirmed(state); }); }
    catch { allowErased = false; }
    return this.#readFenced(scope.accountId, async () => {
      const generation = this.#generation(), observed = Date.now();
      if (generation === null) return err("recovery_required");
      if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
      const observation: AdmissionObservation = { generation, observed, fence: null, committed: false };
      return this.#privateDaysSnapshot(scope, observation, (state, admission, control) =>
        read(state, this.#stored(5).revision, admission, control, observation.observed), false);
    }, allowErased);
  }
  /** Fenced mutation on a live (non-erased) active account with an unexpired
   * session. `run` sees the fenced state and the transaction clock. */
  async #lifecycleMutation<T>(scope: LifecycleScope, run: (state: State, now: number) => { state: State | null; result: EnrollmentResult<T> }): Promise<EnrollmentResult<T>> {
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(scope.accountId)))) return err("unauthorized");
    const observed = Date.now();
    if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
    const acquired = await this.#fenceAcquire(scope.accountId, generation);
    if (!acquired.ok) return acquired;
    const observation: AdmissionObservation = { generation, observed, fence: acquired.value.fence, committed: false };
    try {
      return this.#transaction<T>(observation, (state, now) => {
        if (state === null || state.accountId !== scope.accountId) return { state: null, result: err(state === null ? "not_enrolled" : "unauthorized") };
        if (state.phase !== "active") return { state: null, result: err("not_enrolled") };
        if (erasureConfirmed(state)) return { state: null, result: err("account_erased") };
        if (now >= scope.sessionExpiresAtMs) return { state: null, result: err("expired") };
        return run(state, now);
      });
    } finally { await this.#fenceSettle(scope.accountId, acquired.value.token, observation.committed); }
  }
  async #lifecycleStatus(scope: LifecycleScope): Promise<EnrollmentResult<LifecycleStatusV1>> {
    const local = await this.#lifecycleRead(scope, (state, revision) => lifecycleStatusOf(state, revision));
    if (!local.ok) return local;
    const status = local.value;
    // Index membership is best-effort context, never authority: an
    // unavailable index reports `waitlistKnown: false` rather than a guess.
    const membership = await this.#lifecycleMembership(scope.accountId);
    if (membership === null) return local;
    const publishing: LifecyclePublishingViewV1 = Object.freeze({ consent: status.publishing.consent, publicHandle: status.publishing.publicHandle,
      member: membership.member, waitlist: status.publishing.consent && !membership.member ? membership.waitlist : null, waitlistKnown: true });
    return ok(Object.freeze({ ...status, publishing }));
  }
  async #lifecycleMembership(accountId: string): Promise<Readonly<{ member: boolean; waitlist: Readonly<{ position: number; total: number }> | null }> | null> {
    let raw: unknown;
    try {
      raw = await this.env.PUBLIC_INDEX.getByName(LEADERBOARD_INDEX_NAME).readMembership({ schemaVersion: 1, accountId });
      const reply = rpcSnapshot(raw, ["ok", "value"]);
      const view = reply?.ok === true ? enrollmentSnapshot(reply.value, ["schemaVersion", "member", "waitlist"]) : null;
      if (view?.schemaVersion !== 1 || typeof view.member !== "boolean") return null;
      if (view.waitlist === null) return Object.freeze({ member: view.member, waitlist: null });
      const waitlist = enrollmentSnapshot(view.waitlist, ["position", "total"]);
      if (waitlist === null || !statsInteger(waitlist.position, 1, 4_096) || !statsInteger(waitlist.total, 1, 4_096) || waitlist.position > waitlist.total) return null;
      return Object.freeze({ member: view.member, waitlist: Object.freeze({ position: waitlist.position, total: waitlist.total }) });
    } catch { return null; }
    finally { disposeReply(raw); }
  }
  async #lifecycleDevices(scope: LifecycleScope): Promise<EnrollmentResult<LifecycleDevicesV1>> {
    return this.#lifecycleRead(scope, state => Object.freeze({ schemaVersion: 1 as const, kind: "devices" as const,
      devices: Object.freeze(state.devices.map(lifecycleDeviceOf)) }));
  }
  /** Lossless bounded export (`lifecycle-export-v1`): one section per page
   * step, rows in primary-key order, positional cursor `<section>:<offset>`.
   * The page carries the state and admission revisions so a consumer can
   * detect a mutation between pages and restart. */
  async #lifecycleExport(scope: LifecycleScope, cursor: string | null): Promise<EnrollmentResult<LifecycleExportPageV1>> {
    const position = parseExportCursor(cursor);
    if (position === null) return err("invalid_input");
    return this.#lifecycleRead(scope, (state, revision, _admission, control, now) => {
      let { section, offset } = position;
      let items = exportSectionItems(this.ctx.storage.sql, LIFECYCLE_EXPORT_SECTIONS[section], state, revision);
      while (offset >= items.length) {
        if (++section >= LIFECYCLE_EXPORT_SECTIONS.length) throw new AdmissionFault("invalid_input");
        offset = 0;
        items = exportSectionItems(this.ctx.storage.sql, LIFECYCLE_EXPORT_SECTIONS[section], state, revision);
      }
      const page: LifecycleExportItemV1[] = [];
      let bytes = 0;
      for (let index = offset; index < items.length && page.length < LIFECYCLE_EXPORT_PAGE_ITEMS; index++) {
        const item = items[index], size = new TextEncoder().encode(JSON.stringify(item)).length;
        if (page.length > 0 && bytes + size > LIFECYCLE_EXPORT_PAGE_BYTES) break;
        page.push(item); bytes += size;
      }
      const next = offset + page.length < items.length ? `${section}:${offset + page.length}`
        : section + 1 < LIFECYCLE_EXPORT_SECTIONS.length ? `${section + 1}:0` : null;
      return Object.freeze({ schemaVersion: 1 as const, kind: "export" as const, contract: LIFECYCLE_EXPORT_CONTRACT, accountId: state.accountId,
        generation: state.generation, exportedAtMs: now, stateRevision: revision, admissionRevision: control.revision,
        section: LIFECYCLE_EXPORT_SECTIONS[section], items: Object.freeze(page), cursor: next, excluded: LIFECYCLE_EXPORT_EXCLUDED });
    });
  }
  /** Any enrolled device of the account can be revoked by an account session.
   * Historical facts stay: the device row keeps its enrollment and gains a
   * revocation time; live transfers naming it as successor are refused. */
  async #lifecycleRevoke(scope: LifecycleScope, deviceId: string): Promise<EnrollmentResult<LifecycleDeviceV1>> {
    return this.#lifecycleMutation(scope, (state, now) => {
      const device = state.devices.find(candidate => candidate.deviceId === deviceId);
      if (device === undefined) return { state: null, result: err("not_enrolled") };
      if (device.revokedAtMs !== null) return { state: null, result: ok(Object.freeze({ schemaVersion: 1 as const, kind: "device" as const, device: lifecycleDeviceOf(device) })) };
      device.revokedAtMs = now;
      if (this.#statsPresent()) new StatsState(this.ctx.storage.sql).revokeDevice(deviceId);
      for (const transfer of state.lifecycle?.transfers ?? []) {
        if (transfer.toDeviceId === deviceId && (transfer.phase === "requested" || transfer.phase === "granted")) refuseTransfer(transfer, "successor_revoked");
      }
      return { state, result: ok(Object.freeze({ schemaVersion: 1 as const, kind: "device" as const, device: lifecycleDeviceOf(device) })) };
    });
  }
  /** Step one of erase: a durable intent with a confirmation token. An
   * unexpired unconfirmed request is returned again rather than replaced. */
  async #lifecycleEraseRequest(scope: LifecycleScope): Promise<EnrollmentResult<LifecycleEraseRequestV1>> {
    return this.#lifecycleMutation(scope, (state, now) => {
      const existing = state.lifecycle?.erasure ?? null;
      if (existing !== null && existing.confirmedAtMs === null && now < existing.requestExpiresAtMs) {
        return { state: null, result: ok(Object.freeze({ schemaVersion: 1 as const, kind: "erase_request" as const, token: existing.token,
          requestedAtMs: existing.requestedAtMs, requestExpiresAtMs: existing.requestExpiresAtMs })) };
      }
      const erasure: LifecycleErasure = { token: enrollmentRandom(), requestedAtMs: now, requestExpiresAtMs: now + LIFECYCLE_ERASE_REQUEST_TTL_MS,
        confirmedAtMs: null, step: 0, completedAtMs: null, sealed: false, ledger: null };
      state.lifecycle = { erasure, transfers: state.lifecycle?.transfers ?? [] };
      return { state, result: ok(Object.freeze({ schemaVersion: 1 as const, kind: "erase_request" as const, token: erasure.token,
        requestedAtMs: erasure.requestedAtMs, requestExpiresAtMs: erasure.requestExpiresAtMs })) };
    });
  }
  /** Step two of erase: bounded, resumable execution. Each step commits its
   * own durable progress so an interrupted erase resumes at the same step:
   * 1 confirm and withdraw source consent, 2 remove index membership,
   * 3 revoke every device, 4 record the R2 reclamation ledger, 5 scrub the
   * SQL surfaces (the enrollment row stays as the tombstone), 6 seal the
   * external fence. Order matters: the public index is withdrawn before any
   * other effect (M6 apply order), and the fence seal is last so a restored
   * older payload refuses instead of reviving. */
  async #lifecycleEraseConfirm(scope: LifecycleScope, token: string): Promise<EnrollmentResult<LifecycleEraseProgressV1>> {
    const generation = this.#generation();
    if (generation === null) return err("recovery_required");
    if (!this.ctx.id.equals(this.env.ACCOUNT_ENROLLMENTS.idFromName(enrollmentAccountName(scope.accountId)))) return err("unauthorized");
    const sealed = await this.#lifecycleSealed(scope, generation, token);
    if (sealed !== null) return sealed;
    const observed = Date.now();
    if (!enrollmentTime(observed) || Object.is(observed, -0)) return err("clock_regressed");
    const acquired = await this.#fenceAcquire(scope.accountId, generation, () => true, true);
    if (!acquired.ok) return acquired;
    const observation: AdmissionObservation = { generation, observed, fence: acquired.value.fence, committed: false };
    const progress = (erasure: LifecycleErasure): EnrollmentResult<LifecycleEraseProgressV1> =>
      ok(Object.freeze({ schemaVersion: 1 as const, kind: "erase_progress" as const, erasure: lifecycleErasureOf(erasure) }));
    const step = (expected: number | null, apply: (state: State, erasure: LifecycleErasure, now: number) => EnrollmentError | null): EnrollmentResult<{ erasure: LifecycleErasure; eventAtMs: number }> =>
      this.#transaction(observation, (state, now) => {
        if (state === null || state.accountId !== scope.accountId) return { state: null, result: err(state === null ? "not_enrolled" : "unauthorized") };
        if (state.phase !== "active") return { state: null, result: err("not_enrolled") };
        const erasure = state.lifecycle?.erasure ?? null;
        if (erasure === null) return { state: null, result: err("conflict") };
        if (!sameToken(erasure.token, token)) return { state: null, result: err("unauthorized") };
        if (now >= scope.sessionExpiresAtMs || (erasure.confirmedAtMs === null && now >= erasure.requestExpiresAtMs)) return { state: null, result: err("expired") };
        const snapshot = (): { erasure: LifecycleErasure; eventAtMs: number } => ({ erasure: { ...erasure, ledger: erasure.ledger }, eventAtMs: state.leaderboard.changedAtMs });
        if (expected === null || erasure.step !== expected) return { state: null, result: ok(snapshot()) };
        const refused = apply(state, erasure, now);
        return refused === null ? { state, result: ok(snapshot()) } : { state: null, result: err(refused) };
      });
    try {
      for (let round = 0; round <= LIFECYCLE_ERASE_STEPS; round++) {
        const current = step(null, () => null);
        if (!current.ok) return current;
        const erasure = current.value.erasure;
        let advanced: EnrollmentResult<{ erasure: LifecycleErasure; eventAtMs: number }>;
        switch (erasure.step) {
          case 0:
            advanced = step(0, (state, record, now) => {
              if (state.leaderboard.consent && now <= state.leaderboard.changedAtMs) return "clock_regressed";
              if (state.leaderboard.consent) state.leaderboard = { consent: false, consentedAtMs: null, publicHandle: null, changedAtMs: now };
              record.confirmedAtMs = now; record.step = 1;
              return null;
            });
            break;
          case 1: {
            const withdrawal: LeaderboardConsentViewV1 = Object.freeze({ schemaVersion: 1, consent: false, consentedAtMs: null, publicHandle: null });
            const published = await this.#publishLeaderboardConsent(scope.accountId, withdrawal, current.value.eventAtMs);
            if (published !== "published") return err("storage_unavailable");
            this.#acknowledgeConsent(observation, withdrawal, current.value.eventAtMs);
            advanced = step(1, (_state, record) => { record.step = 2; return null; });
            break;
          }
          case 2:
            advanced = step(2, (state, record, now) => {
              for (const device of state.devices) {
                if (device.revokedAtMs === null) { device.revokedAtMs = now; if (this.#statsPresent()) new StatsState(this.ctx.storage.sql).revokeDevice(device.deviceId); }
              }
              for (const transfer of state.lifecycle?.transfers ?? []) if (transfer.phase === "requested" || transfer.phase === "granted") refuseTransfer(transfer, "account_erased");
              record.step = 3;
              return null;
            });
            break;
          case 3:
            advanced = step(3, (state, record, now) => { record.ledger = reclamationLedgerOf(state, now); record.step = 4; return null; });
            break;
          case 4:
            advanced = step(4, (state, record, now) => {
              const sql = this.ctx.storage.sql;
              for (const name of [...Object.keys(CONTRIBUTION_REBUILD_SCHEMA), ...Object.keys(ACCOUNT_WORK_SCHEMA), ...Object.keys(CONTRIBUTION_PROJECTION_SCHEMA),
                ...Object.keys(CONTRIBUTION_SCHEMA), ...Object.keys(STATS_SCHEMA), ...Object.keys(ADMISSION_SCHEMA)]) sql.exec(`DROP TABLE IF EXISTS ${name}`);
              new AdmissionState(sql).initialize(state);
              sql.exec("UPDATE account_enrollment SET schema_version = 5 WHERE id = 1");
              this.#statsReadMemo.clear();
              record.completedAtMs = now; record.step = 5;
              return null;
            });
            break;
          case 5: {
            const erased = await this.#lifecycleSealFence(scope.accountId, generation, observation.fence?.epoch ?? RESTORE_FENCE_GENESIS_EPOCH);
            if (!erased) return err("storage_unavailable");
            advanced = step(5, (_state, record) => { record.step = LIFECYCLE_ERASE_STEPS; record.sealed = true; return null; });
            break;
          }
          default: return progress(erasure);
        }
        if (!advanced.ok) return advanced;
      }
      return err("limit");
    } finally { await this.#fenceSettle(scope.accountId, acquired.value.token, observation.committed); }
  }
  /** Tombstone-first resumption. A sealed fence refuses every lease, so an
   * erasure whose local seal (step 6) was lost after the external seal
   * finalizes from the tombstone itself; a fully sealed erasure replies
   * without touching the fence at all. */
  async #lifecycleSealed(scope: LifecycleScope, generation: string, token: string): Promise<EnrollmentResult<LifecycleEraseProgressV1> | null> {
    let local: { revision: number; state: State } | null;
    try {
      local = this.ctx.storage.transactionSync(() => {
        if (this.#objects().length === 0) return null;
        this.#schema();
        const { revision, state } = this.#stored(5);
        return state === null ? null : { revision, state };
      });
    } catch { return null; }
    if (local === null) return null;
    const { state } = local, erasure = state.lifecycle?.erasure ?? null;
    if (state.accountId !== scope.accountId || state.generation !== generation || erasure === null || erasure.step < LIFECYCLE_ERASE_STEPS - 1 || !sameToken(erasure.token, token)) return null;
    const now = Date.now();
    if (!enrollmentTime(now) || Object.is(now, -0)) return err("clock_regressed");
    if (now >= scope.sessionExpiresAtMs) return err("expired");
    if (erasure.step === LIFECYCLE_ERASE_STEPS) return ok(Object.freeze({ schemaVersion: 1 as const, kind: "erase_progress" as const, erasure: lifecycleErasureOf(erasure) }));
    let raw: unknown;
    try {
      raw = await this.env.RESTORE_FENCES.getByName(restoreFenceName(scope.accountId)).read({ accountId: scope.accountId, generation });
      const reply = rpcSnapshot(raw, ["ok", "value"]);
      const view = reply?.ok === true ? enrollmentSnapshot(reply.value, ["record", "inFlight", "observedAtMs"]) : null;
      const record = view === null ? null : enrollmentSnapshot(view.record, ["schemaVersion", "accountId", "generation", "epoch", "workerVersion", "phase", "established", "updatedAtMs"]);
      if (record?.phase !== "erased" || record.accountId !== scope.accountId || record.generation !== generation) return null;
    } catch { return null; }
    finally { disposeReply(raw); }
    try {
      return this.ctx.storage.transactionSync(() => {
        this.#schema();
        const { revision, state: current } = this.#stored(5);
        const record = current?.lifecycle?.erasure ?? null;
        if (current === null || record === null || !sameToken(record.token, token) || record.step !== LIFECYCLE_ERASE_STEPS - 1) throw new AdmissionFault("recovery_required");
        record.step = LIFECYCLE_ERASE_STEPS; record.sealed = true;
        if (!validState(current)) throw new AdmissionFault("storage_invalid");
        const payload = JSON.stringify(current);
        if (payload.length > MAX_PAYLOAD) throw new AdmissionFault("storage_invalid");
        this.ctx.storage.sql.exec("UPDATE account_enrollment SET revision = ?, payload = ? WHERE id = 1", revision + 1, payload);
        return ok(Object.freeze({ schemaVersion: 1 as const, kind: "erase_progress" as const, erasure: lifecycleErasureOf(record) }));
      });
    } catch (error) { return err(error instanceof AdmissionFault ? error.code : "storage_invalid"); }
  }
  async #lifecycleSealFence(accountId: string, generation: string, epoch: number): Promise<boolean> {
    const workerVersion = this.#workerVersion();
    if (workerVersion === null) return false;
    let raw: unknown;
    try {
      raw = await this.env.RESTORE_FENCES.getByName(restoreFenceName(accountId)).erase({ accountId, generation, epoch, workerVersion });
      const reply = rpcSnapshot(raw, ["ok", "value"]);
      const view = reply?.ok === true ? enrollmentSnapshot(reply.value, ["record", "inFlight", "observedAtMs"]) : null;
      const record = view === null ? null : enrollmentSnapshot(view.record, ["schemaVersion", "accountId", "generation", "epoch", "workerVersion", "phase", "established", "updatedAtMs"]);
      return record?.phase === "erased" && record.accountId === accountId && record.generation === generation;
    } catch { return false; }
    finally { disposeReply(raw); }
  }
  /** Transfer request: the account session records the intent to move one
   * client's writer authority from an active predecessor to an active
   * successor. A revoked predecessor cannot originate a transfer, and one
   * live transfer per client bounds concurrency. */
  async #lifecycleTransferRequest(scope: LifecycleScope, client: LifecycleClient, fromDeviceId: string, toDeviceId: string): Promise<EnrollmentResult<LifecycleTransferV1>> {
    if (fromDeviceId === toDeviceId) return err("invalid_input");
    return this.#lifecycleMutation(scope, (state, now) => {
      const from = state.devices.find(device => device.deviceId === fromDeviceId), to = state.devices.find(device => device.deviceId === toDeviceId);
      if (from === undefined || to === undefined) return { state: null, result: err("not_enrolled") };
      if (from.revokedAtMs !== null || to.revokedAtMs !== null) return { state: null, result: err("device_revoked") };
      const transfers = state.lifecycle?.transfers ?? [];
      for (const transfer of transfers) if ((transfer.phase === "requested" || transfer.phase === "granted") && now >= transfer.expiresAtMs) refuseTransfer(transfer, "expired");
      const live = transfers.find(transfer => transfer.client === client && (transfer.phase === "requested" || transfer.phase === "granted"));
      if (live !== undefined) {
        if (live.fromDeviceId === fromDeviceId && live.toDeviceId === toDeviceId) return { state, result: ok(lifecycleTransferReply(live)) };
        return { state, result: err("conflict") };
      }
      while (transfers.length >= LIFECYCLE_MAX_TRANSFERS) {
        const oldest = transfers.map((transfer, index) => ({ transfer, index })).filter(entry => entry.transfer.phase === "completed" || entry.transfer.phase === "refused")
          .sort((a, b) => a.transfer.requestedAtMs - b.transfer.requestedAtMs)[0];
        if (oldest === undefined) return { state, result: err("limit") };
        transfers.splice(oldest.index, 1);
      }
      const transfer: LifecycleTransfer = { transferId: enrollmentRandom(), client, fromDeviceId, toDeviceId, phase: "requested", requestedAtMs: now,
        grantedAtMs: null, completedAtMs: null, expiresAtMs: now + LIFECYCLE_TRANSFER_TTL_MS, expectedRevision: null, ownershipRevision: null, refusal: null };
      transfers.push(transfer);
      state.lifecycle = { erasure: state.lifecycle?.erasure ?? null, transfers };
      return { state, result: ok(lifecycleTransferReply(transfer)) };
    });
  }
  /** Transfer grant: the ordered control decision. It revokes the predecessor
   * (so the predecessor can never write after the decision) and pins the
   * stats revision the completion must observe. */
  async #lifecycleTransferGrant(scope: LifecycleScope, transferId: string): Promise<EnrollmentResult<LifecycleTransferV1>> {
    return this.#lifecycleMutation(scope, (state, now) => {
      const transfer = state.lifecycle?.transfers.find(candidate => candidate.transferId === transferId);
      if (transfer === undefined) return { state: null, result: err("conflict") };
      if (transfer.phase === "granted" || transfer.phase === "completed") return { state: null, result: ok(lifecycleTransferReply(transfer)) };
      if (transfer.phase === "refused") return { state: null, result: err("conflict") };
      if (now >= transfer.expiresAtMs) { refuseTransfer(transfer, "expired"); return { state, result: err("expired") }; }
      const to = state.devices.find(device => device.deviceId === transfer.toDeviceId);
      if (to === undefined || to.revokedAtMs !== null) { refuseTransfer(transfer, "successor_revoked"); return { state, result: err("device_revoked") }; }
      if (!this.#statsPresent()) return { state: null, result: err("unavailable") };
      const from = state.devices.find(device => device.deviceId === transfer.fromDeviceId);
      if (from === undefined) return { state: null, result: err("storage_invalid") };
      const stats = new StatsState(this.ctx.storage.sql);
      if (from.revokedAtMs === null) { from.revokedAtMs = now; stats.revokeDevice(from.deviceId); }
      transfer.phase = "granted"; transfer.grantedAtMs = now; transfer.expectedRevision = stats.control().revision;
      return { state, result: ok(lifecycleTransferReply(transfer)) };
    });
  }
  /** Transfer completion applies the granted decision to the stats writer
   * table under the pinned revision. Deterministic refusals are recorded on
   * the transfer; transient faults leave it granted for retry. */
  async #lifecycleTransferComplete(scope: LifecycleScope, transferId: string): Promise<EnrollmentResult<LifecycleTransferV1>> {
    return this.#lifecycleMutation(scope, (state, now) => {
      const transfer = state.lifecycle?.transfers.find(candidate => candidate.transferId === transferId);
      if (transfer === undefined) return { state: null, result: err("conflict") };
      if (transfer.phase === "completed") return { state: null, result: ok(lifecycleTransferReply(transfer)) };
      if (transfer.phase !== "granted" || transfer.expectedRevision === null) return { state: null, result: err("conflict") };
      if (now >= transfer.expiresAtMs) { refuseTransfer(transfer, "expired"); return { state, result: err("expired") }; }
      if (!this.#statsPresent()) return { state: null, result: err("unavailable") };
      if (this.#contributionsActive()) return { state: null, result: err("conflict") };
      try {
        const applied = new StatsState(this.ctx.storage.sql).transferWriter(state, transfer.client, transfer.fromDeviceId, transfer.toDeviceId, transfer.expectedRevision, now);
        this.#statsReadMemo.clear();
        transfer.phase = "completed"; transfer.completedAtMs = now; transfer.ownershipRevision = applied.ownershipRevision;
        return { state, result: ok(lifecycleTransferReply(transfer)) };
      } catch (error) {
        if (error instanceof StatsFault && (error.code === "writer_conflict" || error.code === "unauthorized" || error.code === "conflict")) {
          refuseTransfer(transfer, error.code);
          return { state, result: err(error.code === "unauthorized" ? "device_revoked" : "conflict") };
        }
        throw error;
      }
    });
  }

  /** Separately reviewed repair cutover for a fully compared rebuild job. It
   * accepts only an explicit `publish` request, shares the rebuild flight slot,
   * performs no object I/O, and commits the receipt transition together with
   * the projection compare-and-swap in one fenced SQL transaction. After the
   * step both frontiers, the control roots and the non-expiring publication
   * must equal the receipt's verified scratch root at the unchanged source
   * revision, or the reply is refused as `conflict`. Implemented, not
   * live-qualified: the contributions flag stays off in every deployment. */
  async publishContributionRebuild(input: unknown): Promise<ContributionRebuildResult> {
    const request = parseContributionRebuildRequest(input);
    if (!request || request.action !== "publish") return { ok: false, error: "invalid_input" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "not_started" };
    if (this.#generation() !== request.generation) return { ok: false, error: "recovery_required" };
    if (this.#contributionRebuildFlight !== null) return { ok: false, error: "conflict" };
    const marker = Object.freeze({}); this.#contributionRebuildFlight = marker;
    return this.#boundedContributionRebuild(async live => {
      try {
        const admitted = () => { try { live(); return true; } catch { return false; } };
        const acquired = await this.#fenceAcquire(request.accountId, request.generation, admitted);
        if (!acquired.ok) { live(); return { ok: false, error: this.#contributionError(acquired.error) }; }
        const observation: AdmissionObservation = { generation: request.generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
        try {
          live();
          const scope = { accountId: request.accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME };
          const original = this.#privateDaysSnapshot(scope, observation, state => Object.freeze({ ...state.anchor }));
          if (!original.ok) return { ok: false, error: this.#contributionError(original.error) };
          const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
          live();
          if (!external || !sameNamespaceAnchor(external, original.value)) throw new ContributionFault("recovery_required");
          const rebuild = new ContributionRebuildState(this.ctx.storage);
          const previous = this.#privateDaysSnapshot(scope, observation, () =>
            this.#contributionRebuildPresent() ? rebuild.status(request.jobId) : null);
          if (!previous.ok) return { ok: false, error: this.#contributionError(previous.error) };
          const prior = previous.value?.receipt;
          const retained = prior !== undefined && prior.version === request.expectedVersion + 1 && prior.action === "publish"
            && prior.expectedVersion === request.expectedVersion;
          const service = new AccountContributionRebuild({ STAGING: this.env.STAGING }, rebuild, (seen, action) => {
            live();
            return this.#transaction(seen, (state, now) => {
              live();
              if (!state || state.phase !== "active") throw new ContributionFault("not_enrolled");
              if (state.accountId !== request.accountId || state.generation !== request.generation
                || !sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
              if (!this.#contributionsActive() || !this.#contributionProjectionPresent() || !this.#accountWorkPresent()
                || !this.#contributionRebuildPresent()) throw new ContributionFault("not_started");
              const value = action(state, now);
              live(); return { state, result: ok(value) };
            });
          });
          const result = service.publish(request, observation);
          live();
          const last = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
          live();
          if (!last || !sameNamespaceAnchor(last, original.value)) throw new ContributionFault("recovery_required");
          const authority = await this.#readAuthority(request.accountId, request.generation);
          live();
          if (authority !== null) return { ok: false, error: this.#contributionError(authority) };
          const current = this.#privateDaysSnapshot(scope, observation, state => {
            if (!sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
            if (result.ok && !retained) {
              const source = new ContributionState(this.ctx.storage).control(), projection = new ContributionProjectionState(this.ctx.storage);
              const control = projection.control(), receipt = result.value;
              if (source.accountId !== request.accountId || source.generation !== request.generation || source.phase !== "active"
                || source.legacySeal !== null) throw new ContributionFault("recovery_required");
              if (source.revision !== receipt.sourceRevision || source.headCount !== receipt.headCount || receipt.phase !== "published"
                || JSON.stringify(control.publishedRoot) !== JSON.stringify(receipt.scratchRoot)
                || JSON.stringify(control.appliedRoot) !== JSON.stringify(receipt.scratchRoot)) throw new ContributionFault("conflict");
              if (source.pendingOperation !== null || control.source !== null || projection.pending() !== null
                || control.appliedRevision !== receipt.sourceRevision || control.publishedRevision !== receipt.sourceRevision)
                throw new ContributionRebuildFault("not_caught_up");
              const publication = projection.publication(receipt.sourceRevision, observation.observed);
              if (publication.expiresAtMs !== null || JSON.stringify(publication.root) !== JSON.stringify(receipt.scratchRoot))
                throw new ContributionFault("conflict");
            }
          });
          if (!current.ok) return { ok: false, error: isContributionRebuildError(current.error) ? current.error : "storage_unavailable" };
          if (!result.ok) return { ok: false, error: isContributionRebuildError(result.error) ? result.error : "storage_invalid" };
          const receipt = parseContributionRebuildReceipt(result.value);
          return receipt && receipt.accountId === request.accountId && receipt.generation === request.generation
            && receipt.jobId === request.jobId && receipt.action === "publish" && receipt.expectedVersion === request.expectedVersion
            ? { ok: true, value: receipt } : { ok: false, error: "storage_invalid" };
        } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
      } finally { if (this.#contributionRebuildFlight === marker) this.#contributionRebuildFlight = null; }
    });
  }

  /** Trusted coordinator diagnostic for accounts above the single-cell head
   * envelope (plan 6.3): one cell of a rebuild job's verified scratch root
   * against the job's pinned published root. No public route, no repair
   * authority, no source reads; the job's own bounded, resumable head walk is
   * the whole-account evidence. The invocation shares the single-cell scrub's
   * nonrenewable deadline and authority fencing. Implemented, not
   * live-qualified: the contributions flag stays off in every deployment. */
  async scrubContributionJobCell(input: unknown): Promise<ContributionScrubJobResult> {
    const request = parseContributionScrubJobRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "not_started" };
    if (this.#generation() !== request.generation) return { ok: false, error: "recovery_required" };
    let retired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + CONTRIBUTION_SCRUB_DEADLINE_MS, expired = Object.freeze({});
    const live = () => { if (retired || performance.now() >= deadline) throw expired; };
    const run = async (): Promise<ContributionScrubJobResult> => {
      live();
      const before = await this.#readAuthority(request.accountId, request.generation);
      live();
      if (before !== null) return { ok: false, error: this.#contributionError(before) };
      if (!this.#contributionsPresent() || !this.#contributionProjectionPresent() || !this.#contributionRebuildPresent()) return { ok: false, error: "not_started" };
      const scope = { accountId: request.accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME };
      const observation: AdmissionObservation = { generation: request.generation, observed: Date.now(), fence: null, committed: false };
      const original = this.#privateDaysSnapshot(scope, observation, state => Object.freeze({ ...state.anchor }));
      if (!original.ok) return { ok: false, error: this.#contributionError(original.error) };
      const firstAnchor = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      live();
      if (!firstAnchor || !sameNamespaceAnchor(firstAnchor, original.value)) return { ok: false, error: "recovery_required" };
      const observe = () => {
        live();
        const current = this.#privateDaysSnapshot(scope, observation, state => {
          if (!sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
          return Object.freeze({ accountId: state.accountId, generation: state.generation,
            active: state.phase === "active", observedAtMs: observation.observed });
        });
        if (!current.ok) throw new ContributionFault(this.#contributionError(current.error));
        return current.value;
      };
      const rebuild = new ContributionRebuildState(this.ctx.storage);
      const authority = observe();
      const originalStatus = JSON.stringify(rebuild.status(request.jobId, authority));
      const checked = await scrubContributionJobCell(this.env.STAGING, request, rebuild, observe);
      live();
      const lastAnchor = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
      live();
      if (!lastAnchor || !sameNamespaceAnchor(lastAnchor, original.value)) return { ok: false, error: "recovery_required" };
      const after = await this.#readAuthority(request.accountId, request.generation);
      live();
      if (after !== null) return { ok: false, error: this.#contributionError(after) };
      const final = observe();
      if (checked.ok) {
        // Any job, source or projection movement during the outer authority
        // awaits invalidates the receipt even though the roots stay readable.
        const status = rebuild.status(request.jobId, final);
        if (status === null || status.readiness !== "ready" || status.pending || status.receipt.version !== request.expectedVersion
          || status.receipt.sourceRevision !== request.expectedRevision || (status.receipt.scratchRoot?.hash ?? null) !== checked.value.scratchRootHash
          || (status.receipt.publishedRoot?.hash ?? null) !== checked.value.rootHash || JSON.stringify(status) !== originalStatus) throw new ContributionFault("conflict");
      }
      return parseContributionScrubJobResult(request, checked) ?? { ok: false, error: "storage_invalid" };
    };
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { retired = true; reject(expired); }, CONTRIBUTION_SCRUB_DEADLINE_MS);
      });
      const result = await Promise.race([run(), timeout]);
      live();
      return result;
    } catch (cause) {
      return { ok: false, error: cause === expired ? "deadline" : cause instanceof ContributionFault ? cause.code : "storage_unavailable" };
    } finally { retired = true; clearTimeout(timer); }
  }
  /** Physical reclamation (plan 6.4): record, step or read the durable
   * `reclamation-ledger-v1`. Disabled by default: the exact
   * `AICHARTS_USAGE_RECLAMATION_ENABLED === "1"` capability stays unset in every
   * deployment, so every action, including reads, refuses `disabled`. When
   * enabled, a step shares the rebuild single-flight marker, runs under the
   * restore fence and namespace anchor, re-walks every reference inside the
   * account transaction and deletes only quiescent, horizon-expired,
   * unreferenced objects. Implemented, not live-qualified. */
  async executeReclamation(input: unknown): Promise<ReclamationResult> {
    const request = parseReclamationRequest(input);
    if (!request) return { ok: false, error: "invalid_input" };
    const enabled = (this.env as Env & { AICHARTS_USAGE_RECLAMATION_ENABLED?: unknown }).AICHARTS_USAGE_RECLAMATION_ENABLED === "1";
    if (!enabled) return { ok: false, error: "disabled" };
    if (!this.#contributionsEnabled()) return { ok: false, error: "not_started" };
    if (this.#generation() !== request.generation) return { ok: false, error: "recovery_required" };
    // The step holds both the rebuild and the projection flight markers from its
    // verification transaction through the provider delete, so no stage can
    // re-reference a node between the reference re-check and the delete.
    if (this.#contributionRebuildFlight !== null || this.#accountWorkFlights.has("projection")) return { ok: false, error: "conflict" };
    const marker = Object.freeze({}); this.#contributionRebuildFlight = marker; this.#accountWorkFlights.set("projection", marker);
    let retired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + RECLAMATION_DEADLINE_MS, expired = Object.freeze({});
    const live = () => { if (retired || performance.now() >= deadline) throw expired; };
    const refuse = (error: EnrollmentError): ReclamationResult => ({ ok: false, error: reclamationErrorFrom(this.#contributionError(error)) });
    const run = async (): Promise<ReclamationResult> => {
      const admitted = () => { try { live(); return true; } catch { return false; } };
      const acquired = await this.#fenceAcquire(request.accountId, request.generation, admitted);
      if (!acquired.ok) { live(); return refuse(acquired.error); }
      const observation: AdmissionObservation = { generation: request.generation, observed: Date.now(), fence: acquired.value.fence, committed: false };
      try {
        live();
        const scope = { accountId: request.accountId, sessionExpiresAtMs: CONTRIBUTION_MAX_TIME };
        const original = this.#privateDaysSnapshot(scope, observation, state => Object.freeze({ ...state.anchor }));
        if (!original.ok) return refuse(original.error);
        const external = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
        live();
        if (!external || !sameNamespaceAnchor(external, original.value)) return { ok: false, error: "recovery_required" };
        if (!this.#contributionsPresent() || !this.#contributionProjectionPresent() || !this.#accountWorkPresent() || !this.#contributionRebuildPresent())
          return { ok: false, error: "not_started" };
        const ledger = new ReclamationState(this.ctx.storage);
        const service = new AccountReclamation({ STAGING: this.env.STAGING }, ledger, (seen, action) => {
          live();
          return this.#transaction(seen, (state, now) => {
            live();
            if (!state || state.phase !== "active") throw new ContributionFault("not_enrolled");
            if (state.accountId !== request.accountId || state.generation !== request.generation
              || !sameNamespaceAnchor(state.anchor, original.value)) throw new ContributionFault("recovery_required");
            if (!this.#contributionsActive() || !this.#contributionProjectionPresent() || !this.#accountWorkPresent() || !this.#contributionRebuildPresent())
              throw new ContributionFault("not_started");
            if (!ReclamationState.present(this.ctx.storage)) {
              // Only an explicit record creates the ledger; steps and reads
              // never initialize storage.
              if (request.action !== "record") throw new ContributionFault("not_started");
              ledger.initialize();
            }
            const value = action(state, now);
            live(); return { state, result: ok(value) };
          });
        }, { enabled });
        const result = await service.execute(request, observation);
        live();
        const last = await readNamespaceAnchor(this.env.CONTROL, request.accountId);
        live();
        if (!last || !sameNamespaceAnchor(last, original.value)) return { ok: false, error: "recovery_required" };
        const authority = await this.#readAuthority(request.accountId, request.generation);
        live();
        if (authority !== null) return refuse(authority);
        return result;
      } finally { await this.#fenceSettle(request.accountId, acquired.value.token, observation.committed); }
    };
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { retired = true; reject(expired); }, RECLAMATION_DEADLINE_MS);
      });
      const running = run();
      this.ctx.waitUntil(running.then(() => {}, () => {}));
      const result = await Promise.race([running, timeout]);
      live(); return result;
    } catch (cause) {
      return { ok: false, error: cause === expired ? "deadline" : cause instanceof ContributionFault ? reclamationErrorFrom(cause.code) : "storage_unavailable" };
    } finally {
      retired = true; clearTimeout(timer);
      if (this.#contributionRebuildFlight === marker) this.#contributionRebuildFlight = null;
      if (this.#accountWorkFlights.get("projection") === marker) this.#accountWorkFlights.delete("projection");
    }
  }
}

/* ------------------------------------------------ Phase 10 lifecycle helpers */
type LifecycleScope = Readonly<{ accountId: string; sessionExpiresAtMs: number }>;
function sameToken(stored: string, offered: string): boolean {
  const a = new TextEncoder().encode(stored), b = new TextEncoder().encode(offered);
  return a.length === b.length && timingSafeEqual(a, b);
}
function lifecycleError(code: EnrollmentError): UsageLifecycleError {
  if (isUsageLifecycleError(code)) return code;
  if (code === "revoked") return "device_revoked";
  if (code === "not_reserved") return "not_enrolled";
  if (code === "writer_conflict" || code === "handle_unavailable" || code === "publishing_full") return "conflict";
  return "unavailable";
}
function refuseTransfer(transfer: LifecycleTransfer, refusal: string): void {
  transfer.phase = "refused"; transfer.refusal = refusal;
}
function lifecycleDeviceOf(device: Device): LifecycleDeviceViewV1 {
  return Object.freeze({ deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, revokedAtMs: device.revokedAtMs,
    state: device.revokedAtMs === null ? "active" as const : "revoked" as const });
}
function lifecycleErasureOf(erasure: LifecycleErasure): LifecycleErasureViewV1 {
  return Object.freeze({ phase: erasure.confirmedAtMs === null ? "requested" as const : erasure.step === LIFECYCLE_ERASE_STEPS && erasure.sealed ? "erased" as const : "confirmed" as const,
    step: erasure.step, stepCount: LIFECYCLE_ERASE_STEPS, requestedAtMs: erasure.requestedAtMs, requestExpiresAtMs: erasure.requestExpiresAtMs,
    confirmedAtMs: erasure.confirmedAtMs, completedAtMs: erasure.completedAtMs, sealed: erasure.sealed });
}
function lifecycleTransferOf(transfer: LifecycleTransfer): LifecycleTransferViewV1 {
  return Object.freeze({ transferId: transfer.transferId, client: transfer.client, fromDeviceId: transfer.fromDeviceId, toDeviceId: transfer.toDeviceId,
    phase: transfer.phase, requestedAtMs: transfer.requestedAtMs, grantedAtMs: transfer.grantedAtMs, completedAtMs: transfer.completedAtMs,
    expiresAtMs: transfer.expiresAtMs, expectedRevision: transfer.expectedRevision, ownershipRevision: transfer.ownershipRevision, refusal: transfer.refusal });
}
function lifecycleTransferReply(transfer: LifecycleTransfer): LifecycleTransferV1 {
  return Object.freeze({ schemaVersion: 1 as const, kind: "transfer" as const, transfer: lifecycleTransferOf(transfer) });
}
function lifecycleStatusOf(state: State, revision: number): LifecycleStatusV1 {
  const erasure = state.lifecycle?.erasure ?? null, view = erasure === null ? null : lifecycleErasureOf(erasure);
  return Object.freeze({ schemaVersion: 1 as const, kind: "status" as const, contract: LIFECYCLE_STATUS_CONTRACT, accountId: state.accountId,
    generation: state.generation, phase: view?.phase === "erased" ? "erased" as const : view?.phase === "confirmed" ? "erasing" as const : "active" as const,
    stateRevision: revision,
    devices: Object.freeze({ active: state.devices.filter(device => device.revokedAtMs === null).length, revoked: state.devices.filter(device => device.revokedAtMs !== null).length }),
    erasure: view, transfers: Object.freeze((state.lifecycle?.transfers ?? []).map(lifecycleTransferOf)),
    publishing: Object.freeze({ consent: state.leaderboard.consent, publicHandle: state.leaderboard.publicHandle, member: null, waitlist: null, waitlistKnown: false }) });
}
/** The durable reclamation contract (`reclamation-ledger-v1`) consumed by the
 * storage lane. Objects are recorded by prefix, never deleted here; counts are
 * unknown at record time because listing is provider I/O outside the fence. */
function reclamationLedgerOf(state: State, now: number): ReclamationLedgerV1 {
  const accountId = state.accountId, generation = state.generation, accountHex = accountId.slice(5);
  const entry = (bucket: "STAGING" | "CONTROL", surface: string, prefix: string, note: string): LifecycleReclamationEntryV1 => Object.freeze({ bucket, surface, prefix, objects: null, note });
  return Object.freeze({ schemaVersion: 1 as const, contract: LIFECYCLE_RECLAMATION_CONTRACT, accountId, generation, recordedAtMs: now, entries: Object.freeze([
    entry("CONTROL", "r2:enrollment-namespace-anchors", namespaceAnchorKey(accountId), "exact key; delete last so stale writers keep refusing on anchor mismatch"),
    entry("STAGING", "r2:admission-batches-and-journals", `usage-admission/v1/${accountHex}/${generation}/batches/`, "content-addressed batch objects of this generation"),
    entry("CONTROL", "r2:admission-batches-and-journals", `usage-admission/v1/${accountHex}/${generation}/journal/`, "journal receipts of this generation"),
    entry("STAGING", "r2:stats-snapshots-and-receipts", `usage-stats/v2/${accountId}/${generation}/snapshots/`, "stats snapshot bodies of this generation"),
    entry("CONTROL", "r2:stats-snapshots-and-receipts", `usage-stats/v2/${accountId}/${generation}/receipts/`, "stats receipts of this generation"),
    entry("STAGING", "r2:canonical-contribution-bodies", `usage-contributions/v3/${accountId}/`, "contribution bodies; includes the artifacts/ sub-prefix listed separately"),
    entry("STAGING", "r2:canonical-contribution-artifacts", `usage-contributions/v3/${accountId}/artifacts/`, "journal artifacts (sub-prefix of the bodies entry)"),
    entry("STAGING", "r2:canonical-contribution-index", `usage-projections/v3/${accountId}/${generation}/`, "derived projection nodes of this generation"),
  ]) });
}
function parseExportCursor(cursor: string | null): { section: number; offset: number } | null {
  if (cursor === null) return { section: 0, offset: 0 };
  const match = /^([0-9]{1,2}):([0-9]{1,9})$/.exec(cursor);
  if (match === null) return null;
  const section = Number(match[1]), offset = Number(match[2]);
  if (String(section) !== match[1] || String(offset) !== match[2] || section >= LIFECYCLE_EXPORT_SECTIONS.length) return null;
  return { section, offset };
}
function exportValue(value: unknown): LifecycleJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new AdmissionFault("storage_invalid"); return value; }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof ArrayBuffer) return Object.freeze({ $bytes: Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("") });
  if (ArrayBuffer.isView(value)) return Object.freeze({ $bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), byte => byte.toString(16).padStart(2, "0")).join("") });
  const checked = lifecycleJson(value);
  if (checked === undefined) throw new AdmissionFault("storage_invalid");
  return checked;
}
function exportRow(row: Record<string, SqlStorageValue>): LifecycleJson {
  const value: Record<string, LifecycleJson> = {};
  for (const key of Object.keys(row).sort()) value[key] = exportValue(row[key]);
  return Object.freeze(value);
}
const exportItem = (surface: string, key: string, value: LifecycleJson): LifecycleExportItemV1 => Object.freeze({ surface, key, value });
/** Every item of one export section: a `table` header, then rows. Composed
 * sections (`account_enrollment`, `lifecycle`) publish the parsed payload
 * minus credential material; table sections publish raw rows in primary-key
 * order, so the export is lossless for every account-owned SQL surface. */
function exportSectionItems(sql: SqlStorage, section: string, state: State, revision: number): LifecycleExportItemV1[] {
  const header = (present: boolean, rows: number) => exportItem(section, "table", Object.freeze({ present, rows }));
  if (section === "account_enrollment") {
    const schemaVersion = exportValue(sql.exec("SELECT schema_version FROM account_enrollment WHERE id = 1").one().schema_version);
    const anchor = { accountId: state.anchor.accountId, intentId: state.anchor.intentId, reservationId: state.anchor.reservationId,
      generation: state.anchor.generation, createdAtMs: state.anchor.createdAtMs };
    const values: LifecycleJson[] = [
      Object.freeze({ schemaVersion, revision, accountId: state.accountId, generation: state.generation, observedAtMs: state.observedAtMs, phase: state.phase,
        fenceEpoch: state.fenceEpoch, genesisCompletion: exportValue(state.genesisCompletion), leaderboard: exportValue(state.leaderboard) }),
      exportValue(anchor),
      ...state.devices.map(device => exportValue({ deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, revokedAtMs: device.revokedAtMs, reservation: device.reservation })),
    ];
    const keys = ["state", "anchor", ...state.devices.map((_device, index) => `device:${index}`)];
    return [header(true, values.length), ...values.map((value, index) => exportItem(section, keys[index], value))];
  }
  if (section === "lifecycle") {
    const erasure = state.lifecycle?.erasure ?? null, transfers = state.lifecycle?.transfers ?? [];
    const values: LifecycleJson[] = [erasure === null ? null : exportValue({ ...lifecycleErasureOf(erasure), ledger: erasure.ledger }),
      ...transfers.map(transfer => exportValue(lifecycleTransferOf(transfer)))];
    const keys = ["erasure", ...transfers.map((_transfer, index) => `transfer:${index}`)];
    return [header(state.lifecycle !== undefined, values.length), ...values.map((value, index) => exportItem(section, keys[index], value))];
  }
  if (!(LIFECYCLE_EXPORT_SECTIONS as readonly string[]).includes(section)) throw new AdmissionFault("storage_invalid");
  const present = sql.exec("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1", section).toArray().length === 1;
  if (!present) return [header(false, 0)];
  const rows = sql.exec(`SELECT * FROM ${section} LIMIT ${LIFECYCLE_EXPORT_MAX_ROWS + 1}`).toArray();
  if (rows.length > LIFECYCLE_EXPORT_MAX_ROWS) throw new AdmissionFault("limit");
  return [header(true, rows.length), ...rows.map((row, index) => exportItem(section, `row:${index}`, exportRow(row)))];
}
