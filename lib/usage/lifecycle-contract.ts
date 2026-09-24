/** Account lifecycle contract (Phase 10): export, erase, device revocation,
 * writer transfer and publishing liveness. This module is the frozen HTTP/RPC
 * contract shared by the worker, the Next proxy and any UI. The browser-facing
 * route accepts only an operation body; `accountId` and `sessionExpiresAtMs`
 * are derived from the live server session, never from the caller.
 *
 * Every parser is exact-key, getter-free and bounded. Nothing here carries
 * authority: the worker re-derives every decision from durable account state. */
import { privateDaysSnapshot } from "./private-days-http-contract";
import { leaderboardPublicHandle } from "./leaderboard-contract";

export const USAGE_LIFECYCLE_HTTP_URL = "https://usage.aicharts.io/internal/usage/lifecycle";
export const USAGE_LIFECYCLE_PUBLIC_PATH = "/api/usage/lifecycle";
export const USAGE_LIFECYCLE_PUBLIC_URL = `https://aicharts.io${USAGE_LIFECYCLE_PUBLIC_PATH}`;
export const USAGE_LIFECYCLE_MEDIA = "application/json; charset=utf-8";
/** Worker request envelope (with session fields) and browser operation body. */
export const USAGE_LIFECYCLE_REQUEST_BYTES = 512;
export const USAGE_LIFECYCLE_PUBLIC_REQUEST_BYTES = 384;
/** One export page or any other reply. Pages are cut before this bound. */
export const USAGE_LIFECYCLE_RESPONSE_BYTES = 65_536;
export const LIFECYCLE_EXPORT_CONTRACT = "lifecycle-export-v1";
export const LIFECYCLE_STATUS_CONTRACT = "lifecycle-status-v1";
export const LIFECYCLE_RECLAMATION_CONTRACT = "reclamation-ledger-v1";
/** Rows per export page; a page is also cut when its encoding nears the byte bound. */
export const LIFECYCLE_EXPORT_PAGE_ITEMS = 64;
export const LIFECYCLE_EXPORT_PAGE_BYTES = 49_152;
export const LIFECYCLE_EXPORT_MAX_CURSOR_LENGTH = 96;
/** An unconfirmed erase request lapses after one day; confirmation is durable. */
export const LIFECYCLE_ERASE_REQUEST_TTL_MS = 86_400_000;
export const LIFECYCLE_ERASE_STEPS = 6;
export const LIFECYCLE_TRANSFER_TTL_MS = 3_600_000;
export const LIFECYCLE_MAX_TRANSFERS = 16;
export const LIFECYCLE_MAX_RECLAMATION_ENTRIES = 16;
export const LIFECYCLE_MAX_EXCLUSIONS = 32;
export const LIFECYCLE_MAX_TIME = 8_640_000_000_000_000;
export const LIFECYCLE_CLIENTS = Object.freeze(["codex", "claude-code", "devin"] as const);
export type LifecycleClient = typeof LIFECYCLE_CLIENTS[number];

const hex64 = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/u.test(value);
const account = (value: unknown): value is string => typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value);
const time = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= LIFECYCLE_MAX_TIME;
const count = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const ascii = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 1 && value.length <= max && /^[\x21-\x7e]+$/u.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 1 && value.length <= max && /^[\x20-\x7e]+$/u.test(value);
const isClient = (value: unknown): value is LifecycleClient => typeof value === "string" && (LIFECYCLE_CLIENTS as readonly string[]).includes(value);
function owned<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}
/** Plain JSON values only (finite numbers, ASCII-safe strings are checked at
 * encode time), bounded depth and width. Export row values pass through here. */
export type LifecycleJson = null | boolean | number | string | readonly LifecycleJson[] | Readonly<{ [key: string]: LifecycleJson }>;
export function lifecycleJson(value: unknown, depth = 0): LifecycleJson | null | undefined {
  if (depth > 8) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0) ? value : undefined;
  if (typeof value === "string") return value.length <= 65_536 ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > 4_096) return undefined;
    const items: LifecycleJson[] = [];
    for (const item of value as unknown[]) { const checked = lifecycleJson(item, depth + 1); if (checked === undefined) return undefined; items.push(checked); }
    return Object.freeze(items);
  }
  if (typeof value !== "object") return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length > 256) return undefined;
  const result: Record<string, LifecycleJson> = Object.create(null);
  for (const name of names) {
    if (typeof name !== "string" || !text(name, 128)) return undefined;
    const descriptor = descriptors[name];
    if (!("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    const checked = lifecycleJson(descriptor.value, depth + 1);
    if (checked === undefined) return undefined;
    result[name] = checked;
  }
  return Object.freeze(result);
}

/* ---------------------------------------------------------------- requests */
export type UsageLifecycleOperationInput =
  | Readonly<{ operation: "status" }>
  | Readonly<{ operation: "export"; cursor: string | null }>
  | Readonly<{ operation: "devices" }>
  | Readonly<{ operation: "revoke_device"; deviceId: string }>
  | Readonly<{ operation: "erase_request" }>
  | Readonly<{ operation: "erase_confirm"; token: string }>
  | Readonly<{ operation: "transfer_request"; client: LifecycleClient; fromDeviceId: string; toDeviceId: string }>
  | Readonly<{ operation: "transfer_grant"; transferId: string }>
  | Readonly<{ operation: "transfer_complete"; transferId: string }>;
export type UsageLifecycleOperation = UsageLifecycleOperationInput["operation"];
export const USAGE_LIFECYCLE_OPERATIONS: readonly UsageLifecycleOperation[] = Object.freeze(["status", "export", "devices", "revoke_device",
  "erase_request", "erase_confirm", "transfer_request", "transfer_grant", "transfer_complete"]);
/** Reads leave no durable trace; every other operation records intent first. */
export const USAGE_LIFECYCLE_READ_OPERATIONS: readonly UsageLifecycleOperation[] = Object.freeze(["status", "export", "devices"]);

export function parseUsageLifecycleOperation(value: unknown): UsageLifecycleOperationInput | null {
  const bare = privateDaysSnapshot(value, ["operation"]);
  if (bare !== null) {
    if (bare.operation === "status" || bare.operation === "devices" || bare.operation === "erase_request") return owned({ operation: bare.operation });
    return null;
  }
  const exported = privateDaysSnapshot(value, ["operation", "cursor"]);
  if (exported !== null) {
    if (exported.operation !== "export" || !(exported.cursor === null || ascii(exported.cursor, LIFECYCLE_EXPORT_MAX_CURSOR_LENGTH))) return null;
    return owned({ operation: "export", cursor: exported.cursor as string | null });
  }
  const revoke = privateDaysSnapshot(value, ["operation", "deviceId"]);
  if (revoke !== null) return revoke.operation === "revoke_device" && hex64(revoke.deviceId) ? owned({ operation: "revoke_device", deviceId: revoke.deviceId }) : null;
  const confirm = privateDaysSnapshot(value, ["operation", "token"]);
  if (confirm !== null) return confirm.operation === "erase_confirm" && hex64(confirm.token) ? owned({ operation: "erase_confirm", token: confirm.token }) : null;
  const transfer = privateDaysSnapshot(value, ["operation", "client", "fromDeviceId", "toDeviceId"]);
  if (transfer !== null) {
    if (transfer.operation !== "transfer_request" || !isClient(transfer.client) || !hex64(transfer.fromDeviceId) || !hex64(transfer.toDeviceId)
      || transfer.fromDeviceId === transfer.toDeviceId) return null;
    return owned({ operation: "transfer_request", client: transfer.client, fromDeviceId: transfer.fromDeviceId, toDeviceId: transfer.toDeviceId });
  }
  const staged = privateDaysSnapshot(value, ["operation", "transferId"]);
  if (staged !== null) {
    if ((staged.operation !== "transfer_grant" && staged.operation !== "transfer_complete") || !hex64(staged.transferId)) return null;
    return owned({ operation: staged.operation, transferId: staged.transferId });
  }
  return null;
}
export type UsageLifecycleRequestV1 = Readonly<{ schemaVersion: 1; accountId: string; sessionExpiresAtMs: number }> & UsageLifecycleOperationInput;
export function parseUsageLifecycleRequest(value: unknown): UsageLifecycleRequestV1 | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length < 4 || names.length > 8 || names.some(name => typeof name !== "string")) return null;
  const envelope: Record<string, unknown> = Object.create(null), operation: Record<string, unknown> = {};
  for (const name of names as string[]) {
    const descriptor = descriptors[name];
    if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
    if (name === "schemaVersion" || name === "accountId" || name === "sessionExpiresAtMs") envelope[name] = descriptor.value as unknown;
    else operation[name] = descriptor.value as unknown;
  }
  if (envelope.schemaVersion !== 1 || !account(envelope.accountId) || !time(envelope.sessionExpiresAtMs)) return null;
  const parsed = parseUsageLifecycleOperation(operation);
  if (parsed === null) return null;
  return owned({ schemaVersion: 1 as const, accountId: envelope.accountId, sessionExpiresAtMs: envelope.sessionExpiresAtMs, ...parsed }) as UsageLifecycleRequestV1;
}

/* ----------------------------------------------------------------- replies */
export type UsageLifecycleError = "invalid_input" | "unauthorized" | "not_enrolled" | "expired" | "account_erased" | "device_revoked"
  | "conflict" | "recovery_required" | "storage_invalid" | "storage_unavailable" | "clock_regressed" | "limit" | "unavailable";
export const USAGE_LIFECYCLE_ERRORS: readonly UsageLifecycleError[] = Object.freeze(["invalid_input", "unauthorized", "not_enrolled", "expired",
  "account_erased", "device_revoked", "conflict", "recovery_required", "storage_invalid", "storage_unavailable", "clock_regressed", "limit", "unavailable"]);
export const isUsageLifecycleError = (value: unknown): value is UsageLifecycleError => typeof value === "string" && (USAGE_LIFECYCLE_ERRORS as readonly string[]).includes(value);

export type LifecycleDeviceViewV1 = Readonly<{ deviceId: string; enrolledAtMs: number; revokedAtMs: number | null; state: "active" | "revoked" }>;
export type LifecycleErasurePhase = "requested" | "confirmed" | "erased";
/** `step` counts durably completed erase steps out of `LIFECYCLE_ERASE_STEPS`:
 * 1 confirmed+source consent withdrawn, 2 public index membership removed,
 * 3 devices revoked, 4 reclamation ledger recorded, 5 account tables scrubbed,
 * 6 external erasure tombstone sealed. */
export type LifecycleErasureViewV1 = Readonly<{
  phase: LifecycleErasurePhase; step: number; stepCount: number; requestedAtMs: number; requestExpiresAtMs: number;
  confirmedAtMs: number | null; completedAtMs: number | null; sealed: boolean;
}>;
export type LifecycleTransferPhase = "requested" | "granted" | "completed" | "refused";
export type LifecycleTransferViewV1 = Readonly<{
  transferId: string; client: LifecycleClient; fromDeviceId: string; toDeviceId: string; phase: LifecycleTransferPhase;
  requestedAtMs: number; grantedAtMs: number | null; completedAtMs: number | null; expiresAtMs: number;
  expectedRevision: number | null; ownershipRevision: number | null; refusal: string | null;
}>;
/** `waitlist` is `null` when the account is not waiting; `waitlistKnown` is
 * false when the index could not be consulted (explicit missingness). */
export type LifecyclePublishingViewV1 = Readonly<{
  consent: boolean; publicHandle: string | null; member: boolean | null;
  waitlist: Readonly<{ position: number; total: number }> | null; waitlistKnown: boolean;
}>;
export type LifecycleStatusV1 = Readonly<{
  schemaVersion: 1; kind: "status"; contract: typeof LIFECYCLE_STATUS_CONTRACT; accountId: string; generation: string;
  phase: "active" | "erasing" | "erased"; stateRevision: number; devices: Readonly<{ active: number; revoked: number }>;
  erasure: LifecycleErasureViewV1 | null; transfers: readonly LifecycleTransferViewV1[]; publishing: LifecyclePublishingViewV1;
}>;
export type LifecycleDevicesV1 = Readonly<{ schemaVersion: 1; kind: "devices"; devices: readonly LifecycleDeviceViewV1[] }>;
export type LifecycleDeviceV1 = Readonly<{ schemaVersion: 1; kind: "device"; device: LifecycleDeviceViewV1 }>;
export type LifecycleEraseRequestV1 = Readonly<{ schemaVersion: 1; kind: "erase_request"; token: string; requestedAtMs: number; requestExpiresAtMs: number }>;
export type LifecycleEraseProgressV1 = Readonly<{ schemaVersion: 1; kind: "erase_progress"; erasure: LifecycleErasureViewV1 }>;
export type LifecycleTransferV1 = Readonly<{ schemaVersion: 1; kind: "transfer"; transfer: LifecycleTransferViewV1 }>;
export type LifecycleExportItemV1 = Readonly<{ surface: string; key: string; value: LifecycleJson }>;
export type LifecycleExportExclusionV1 = Readonly<{ surface: string; reason: string }>;
/** One export page. `cursor` resumes the next page; `null` ends the export.
 * `stateRevision`/`admissionRevision` let a reader detect concurrent change
 * and restart rather than trusting offsets across a mutation. */
export type LifecycleExportPageV1 = Readonly<{
  schemaVersion: 1; kind: "export"; contract: typeof LIFECYCLE_EXPORT_CONTRACT; accountId: string; generation: string;
  exportedAtMs: number; stateRevision: number; admissionRevision: number; section: string;
  items: readonly LifecycleExportItemV1[]; cursor: string | null; excluded: readonly LifecycleExportExclusionV1[];
}>;
export type LifecycleReclamationEntryV1 = Readonly<{ bucket: "STAGING" | "CONTROL"; surface: string; prefix: string; objects: number | null; note: string }>;
/** Durable, bounded record of the R2 families an erased account owned. The
 * storage lane reclaims by prefix; the account never deletes objects itself. */
export type ReclamationLedgerV1 = Readonly<{
  schemaVersion: 1; contract: typeof LIFECYCLE_RECLAMATION_CONTRACT; accountId: string; generation: string; recordedAtMs: number;
  entries: readonly LifecycleReclamationEntryV1[];
}>;
export type UsageLifecycleValue = LifecycleStatusV1 | LifecycleDevicesV1 | LifecycleDeviceV1 | LifecycleEraseRequestV1
  | LifecycleEraseProgressV1 | LifecycleTransferV1 | LifecycleExportPageV1;
export type UsageLifecycleResult = Readonly<{ ok: true; value: UsageLifecycleValue }> | Readonly<{ ok: false; error: UsageLifecycleError }>;

export function parseLifecycleDeviceView(value: unknown): LifecycleDeviceViewV1 | null {
  const device = privateDaysSnapshot(value, ["deviceId", "enrolledAtMs", "revokedAtMs", "state"]);
  if (device === null || !hex64(device.deviceId) || !time(device.enrolledAtMs)) return null;
  if (device.revokedAtMs === null) return device.state === "active" ? owned({ deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, revokedAtMs: null, state: "active" as const }) : null;
  if (!time(device.revokedAtMs) || device.revokedAtMs < device.enrolledAtMs || device.state !== "revoked") return null;
  return owned({ deviceId: device.deviceId, enrolledAtMs: device.enrolledAtMs, revokedAtMs: device.revokedAtMs, state: "revoked" as const });
}
export function parseLifecycleErasureView(value: unknown): LifecycleErasureViewV1 | null {
  const erasure = privateDaysSnapshot(value, ["phase", "step", "stepCount", "requestedAtMs", "requestExpiresAtMs", "confirmedAtMs", "completedAtMs", "sealed"]);
  if (erasure === null || (erasure.phase !== "requested" && erasure.phase !== "confirmed" && erasure.phase !== "erased")
    || erasure.stepCount !== LIFECYCLE_ERASE_STEPS || !count(erasure.step, LIFECYCLE_ERASE_STEPS) || !time(erasure.requestedAtMs)
    || !time(erasure.requestExpiresAtMs) || erasure.requestExpiresAtMs < erasure.requestedAtMs || typeof erasure.sealed !== "boolean"
    || !(erasure.confirmedAtMs === null || (time(erasure.confirmedAtMs) && erasure.confirmedAtMs >= erasure.requestedAtMs))
    || !(erasure.completedAtMs === null || (time(erasure.completedAtMs) && erasure.confirmedAtMs !== null && erasure.completedAtMs >= erasure.confirmedAtMs))) return null;
  if ((erasure.phase === "requested") !== (erasure.confirmedAtMs === null) || (erasure.phase === "requested" && erasure.step !== 0)) return null;
  if ((erasure.phase === "erased") !== (erasure.step === LIFECYCLE_ERASE_STEPS && erasure.sealed === true)) return null;
  if (erasure.completedAtMs === null && erasure.step >= LIFECYCLE_ERASE_STEPS - 1) return null;
  return owned({ phase: erasure.phase, step: erasure.step, stepCount: LIFECYCLE_ERASE_STEPS, requestedAtMs: erasure.requestedAtMs,
    requestExpiresAtMs: erasure.requestExpiresAtMs, confirmedAtMs: erasure.confirmedAtMs as number | null,
    completedAtMs: erasure.completedAtMs as number | null, sealed: erasure.sealed });
}
export function parseLifecycleTransferView(value: unknown): LifecycleTransferViewV1 | null {
  const transfer = privateDaysSnapshot(value, ["transferId", "client", "fromDeviceId", "toDeviceId", "phase", "requestedAtMs", "grantedAtMs",
    "completedAtMs", "expiresAtMs", "expectedRevision", "ownershipRevision", "refusal"]);
  if (transfer === null || !hex64(transfer.transferId) || !isClient(transfer.client) || !hex64(transfer.fromDeviceId) || !hex64(transfer.toDeviceId)
    || transfer.fromDeviceId === transfer.toDeviceId || !time(transfer.requestedAtMs) || !time(transfer.expiresAtMs) || transfer.expiresAtMs < transfer.requestedAtMs
    || (transfer.phase !== "requested" && transfer.phase !== "granted" && transfer.phase !== "completed" && transfer.phase !== "refused")
    || !(transfer.grantedAtMs === null || (time(transfer.grantedAtMs) && transfer.grantedAtMs >= transfer.requestedAtMs))
    || !(transfer.completedAtMs === null || (time(transfer.completedAtMs) && transfer.grantedAtMs !== null && transfer.completedAtMs >= transfer.grantedAtMs))
    || !(transfer.expectedRevision === null || count(transfer.expectedRevision, 999_999))
    || !(transfer.ownershipRevision === null || count(transfer.ownershipRevision, 1_000_000))
    || !(transfer.refusal === null || text(transfer.refusal, 64))) return null;
  if ((transfer.phase === "requested") !== (transfer.grantedAtMs === null && transfer.phase !== "refused")
    || (transfer.phase === "completed") !== (transfer.completedAtMs !== null)
    || (transfer.phase === "refused") !== (transfer.refusal !== null)) return null;
  return owned({ transferId: transfer.transferId, client: transfer.client, fromDeviceId: transfer.fromDeviceId, toDeviceId: transfer.toDeviceId,
    phase: transfer.phase, requestedAtMs: transfer.requestedAtMs, grantedAtMs: transfer.grantedAtMs as number | null,
    completedAtMs: transfer.completedAtMs as number | null, expiresAtMs: transfer.expiresAtMs,
    expectedRevision: transfer.expectedRevision as number | null, ownershipRevision: transfer.ownershipRevision as number | null,
    refusal: transfer.refusal as string | null });
}
export function parseLifecyclePublishingView(value: unknown): LifecyclePublishingViewV1 | null {
  const publishing = privateDaysSnapshot(value, ["consent", "publicHandle", "member", "waitlist", "waitlistKnown"]);
  if (publishing === null || typeof publishing.consent !== "boolean" || typeof publishing.waitlistKnown !== "boolean"
    || !(publishing.member === null || typeof publishing.member === "boolean")) return null;
  if (publishing.consent ? !leaderboardPublicHandle(publishing.publicHandle) : publishing.publicHandle !== null) return null;
  let waitlist: Readonly<{ position: number; total: number }> | null = null;
  if (publishing.waitlist !== null) {
    const entry = privateDaysSnapshot(publishing.waitlist, ["position", "total"]);
    if (entry === null || !count(entry.position, 4_096) || !count(entry.total, 4_096) || entry.position < 1 || entry.position > entry.total) return null;
    waitlist = owned({ position: entry.position, total: entry.total });
  }
  if (waitlist !== null && (!publishing.waitlistKnown || !publishing.consent || publishing.member === true)) return null;
  return owned({ consent: publishing.consent, publicHandle: publishing.publicHandle as string | null, member: publishing.member as boolean | null,
    waitlist, waitlistKnown: publishing.waitlistKnown });
}
function parseArray<T>(value: unknown, max: number, parse: (item: unknown) => T | null): readonly T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items: T[] = [];
  for (const item of value as unknown[]) { const parsed = parse(item); if (parsed === null) return null; items.push(parsed); }
  return Object.freeze(items);
}
export function parseLifecycleStatus(value: unknown): LifecycleStatusV1 | null {
  const status = privateDaysSnapshot(value, ["schemaVersion", "kind", "contract", "accountId", "generation", "phase", "stateRevision", "devices", "erasure", "transfers", "publishing"]);
  if (status?.schemaVersion !== 1 || status.kind !== "status" || status.contract !== LIFECYCLE_STATUS_CONTRACT || !account(status.accountId)
    || !hex64(status.generation) || (status.phase !== "active" && status.phase !== "erasing" && status.phase !== "erased")
    || !count(status.stateRevision, Number.MAX_SAFE_INTEGER)) return null;
  const devices = privateDaysSnapshot(status.devices, ["active", "revoked"]);
  if (devices === null || !count(devices.active, 128) || !count(devices.revoked, 128) || devices.active + devices.revoked > 128) return null;
  const erasure = status.erasure === null ? null : parseLifecycleErasureView(status.erasure);
  if (status.erasure !== null && erasure === null) return null;
  if ((status.phase === "erased") !== (erasure?.phase === "erased") || (status.phase === "erasing") !== (erasure?.phase === "confirmed")) return null;
  const transfers = parseArray(status.transfers, LIFECYCLE_MAX_TRANSFERS, parseLifecycleTransferView);
  const publishing = parseLifecyclePublishingView(status.publishing);
  if (transfers === null || publishing === null) return null;
  return owned({ schemaVersion: 1 as const, kind: "status" as const, contract: LIFECYCLE_STATUS_CONTRACT, accountId: status.accountId,
    generation: status.generation, phase: status.phase, stateRevision: status.stateRevision,
    devices: owned({ active: devices.active, revoked: devices.revoked }), erasure, transfers, publishing });
}
export function parseLifecycleExportPage(value: unknown): LifecycleExportPageV1 | null {
  const page = privateDaysSnapshot(value, ["schemaVersion", "kind", "contract", "accountId", "generation", "exportedAtMs", "stateRevision",
    "admissionRevision", "section", "items", "cursor", "excluded"]);
  if (page?.schemaVersion !== 1 || page.kind !== "export" || page.contract !== LIFECYCLE_EXPORT_CONTRACT || !account(page.accountId)
    || !hex64(page.generation) || !time(page.exportedAtMs) || !count(page.stateRevision, Number.MAX_SAFE_INTEGER)
    || !count(page.admissionRevision, Number.MAX_SAFE_INTEGER) || !ascii(page.section, 64)
    || !(page.cursor === null || ascii(page.cursor, LIFECYCLE_EXPORT_MAX_CURSOR_LENGTH))) return null;
  const items = parseArray(page.items, LIFECYCLE_EXPORT_PAGE_ITEMS, item => {
    const entry = privateDaysSnapshot(item, ["surface", "key", "value"]);
    if (entry === null || !ascii(entry.surface, 64) || !ascii(entry.key, 256)) return null;
    const checked = lifecycleJson(entry.value);
    return checked === undefined ? null : owned({ surface: entry.surface, key: entry.key, value: checked });
  });
  const excluded = parseArray(page.excluded, LIFECYCLE_MAX_EXCLUSIONS, item => {
    const entry = privateDaysSnapshot(item, ["surface", "reason"]);
    return entry === null || !ascii(entry.surface, 96) || !text(entry.reason, 240) ? null : owned({ surface: entry.surface, reason: entry.reason });
  });
  if (items === null || excluded === null) return null;
  return owned({ schemaVersion: 1 as const, kind: "export" as const, contract: LIFECYCLE_EXPORT_CONTRACT, accountId: page.accountId,
    generation: page.generation, exportedAtMs: page.exportedAtMs, stateRevision: page.stateRevision, admissionRevision: page.admissionRevision,
    section: page.section, items, cursor: page.cursor as string | null, excluded });
}
export function parseReclamationLedger(value: unknown): ReclamationLedgerV1 | null {
  const ledger = privateDaysSnapshot(value, ["schemaVersion", "contract", "accountId", "generation", "recordedAtMs", "entries"]);
  if (ledger?.schemaVersion !== 1 || ledger.contract !== LIFECYCLE_RECLAMATION_CONTRACT || !account(ledger.accountId)
    || !hex64(ledger.generation) || !time(ledger.recordedAtMs)) return null;
  const entries = parseArray(ledger.entries, LIFECYCLE_MAX_RECLAMATION_ENTRIES, item => {
    const entry = privateDaysSnapshot(item, ["bucket", "surface", "prefix", "objects", "note"]);
    if (entry === null || (entry.bucket !== "STAGING" && entry.bucket !== "CONTROL") || !ascii(entry.surface, 96)
      || !ascii(entry.prefix, 256) || !(entry.objects === null || count(entry.objects, 100_000_000)) || !text(entry.note, 240)) return null;
    return owned({ bucket: entry.bucket as "STAGING" | "CONTROL", surface: entry.surface, prefix: entry.prefix, objects: entry.objects as number | null, note: entry.note });
  });
  return entries === null ? null : owned({ schemaVersion: 1 as const, contract: LIFECYCLE_RECLAMATION_CONTRACT, accountId: ledger.accountId,
    generation: ledger.generation, recordedAtMs: ledger.recordedAtMs, entries });
}
function kindOf(value: unknown): unknown {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}
export function parseUsageLifecycleValue(value: unknown): UsageLifecycleValue | null {
  const kind = kindOf(value);
  switch (kind) {
    case "status": return parseLifecycleStatus(value);
    case "export": return parseLifecycleExportPage(value);
    case "devices": {
      const devices = privateDaysSnapshot(value, ["schemaVersion", "kind", "devices"]);
      const items = devices?.schemaVersion === 1 ? parseArray(devices.devices, 128, parseLifecycleDeviceView) : null;
      return items === null ? null : owned({ schemaVersion: 1 as const, kind: "devices" as const, devices: items });
    }
    case "device": {
      const reply = privateDaysSnapshot(value, ["schemaVersion", "kind", "device"]);
      const device = reply?.schemaVersion === 1 ? parseLifecycleDeviceView(reply.device) : null;
      return device === null ? null : owned({ schemaVersion: 1 as const, kind: "device" as const, device });
    }
    case "erase_request": {
      const reply = privateDaysSnapshot(value, ["schemaVersion", "kind", "token", "requestedAtMs", "requestExpiresAtMs"]);
      if (reply?.schemaVersion !== 1 || !hex64(reply.token) || !time(reply.requestedAtMs) || !time(reply.requestExpiresAtMs)
        || reply.requestExpiresAtMs < reply.requestedAtMs) return null;
      return owned({ schemaVersion: 1 as const, kind: "erase_request" as const, token: reply.token, requestedAtMs: reply.requestedAtMs, requestExpiresAtMs: reply.requestExpiresAtMs });
    }
    case "erase_progress": {
      const reply = privateDaysSnapshot(value, ["schemaVersion", "kind", "erasure"]);
      const erasure = reply?.schemaVersion === 1 ? parseLifecycleErasureView(reply.erasure) : null;
      return erasure === null ? null : owned({ schemaVersion: 1 as const, kind: "erase_progress" as const, erasure });
    }
    case "transfer": {
      const reply = privateDaysSnapshot(value, ["schemaVersion", "kind", "transfer"]);
      const transfer = reply?.schemaVersion === 1 ? parseLifecycleTransferView(reply.transfer) : null;
      return transfer === null ? null : owned({ schemaVersion: 1 as const, kind: "transfer" as const, transfer });
    }
    default: return null;
  }
}
export function parseUsageLifecycleResult(value: unknown): UsageLifecycleResult | null {
  const success = privateDaysSnapshot(value, ["ok", "value"]);
  if (success !== null) {
    if (success.ok !== true) return null;
    const parsed = parseUsageLifecycleValue(success.value);
    return parsed === null ? null : owned({ ok: true as const, value: parsed });
  }
  const failure = privateDaysSnapshot(value, ["ok", "error"]);
  return failure?.ok === false && isUsageLifecycleError(failure.error) ? owned({ ok: false as const, error: failure.error }) : null;
}
/** Which operation a reply kind may answer; the transport refuses any other pairing. */
export function lifecycleReplyMatches(operation: UsageLifecycleOperation, value: UsageLifecycleValue): boolean {
  switch (operation) {
    case "status": return value.kind === "status";
    case "export": return value.kind === "export";
    case "devices": return value.kind === "devices";
    case "revoke_device": return value.kind === "device";
    case "erase_request": return value.kind === "erase_request";
    case "erase_confirm": return value.kind === "erase_progress";
    default: return value.kind === "transfer";
  }
}

/* ------------------------------------------------------------ wire (ASCII) */
const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const byteLength = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const buffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const fixedLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const set = Uint8Array.prototype.set;
export function lifecycleTextOf(value: unknown, cap: number): string | null {
  if (tag.call(value) !== "Uint8Array") return null;
  const backing: unknown = buffer.call(value); fixedLength.call(backing);
  if (resizable?.call(backing) === true) return null;
  const size: number = byteLength.call(value);
  if (size < 1 || size > cap) return null;
  const bytes = new Uint8Array(size); set.call(bytes, value as Uint8Array);
  let text = "";
  for (const byte of bytes) { if (byte > 127) return null; text += String.fromCharCode(byte); }
  return text;
}
export function lifecycleEncode(value: object, cap: number): Uint8Array<ArrayBuffer> | null {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || text.length < 1 || text.length > cap) return null;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index); if (code > 127) return null; bytes[index] = code;
  }
  return bytes;
}
export function encodeUsageLifecycleHttpRequest(value: unknown): Uint8Array<ArrayBuffer> | null {
  try { const request = parseUsageLifecycleRequest(value); return request === null ? null : lifecycleEncode(request, USAGE_LIFECYCLE_REQUEST_BYTES); }
  catch { return null; }
}
export function decodeUsageLifecycleHttpRequest(value: unknown): UsageLifecycleRequestV1 | null {
  try {
    const text = lifecycleTextOf(value, USAGE_LIFECYCLE_REQUEST_BYTES); if (text === null) return null;
    const request = parseUsageLifecycleRequest(JSON.parse(text));
    return request !== null && JSON.stringify(request) === text ? request : null;
  } catch { return null; }
}
export function encodeUsageLifecycleHttpResponse(value: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    const result = parseUsageLifecycleResult(value);
    return result === null ? null : lifecycleEncode(owned({ schemaVersion: 1, result }), USAGE_LIFECYCLE_RESPONSE_BYTES);
  } catch { return null; }
}
export function decodeUsageLifecycleHttpResponse(value: unknown): UsageLifecycleResult | null {
  try {
    const text = lifecycleTextOf(value, USAGE_LIFECYCLE_RESPONSE_BYTES); if (text === null) return null;
    const envelope = privateDaysSnapshot(JSON.parse(text), ["schemaVersion", "result"]);
    if (envelope?.schemaVersion !== 1) return null;
    const result = parseUsageLifecycleResult(envelope.result);
    return result !== null && JSON.stringify(owned({ schemaVersion: 1, result })) === text ? result : null;
  } catch { return null; }
}

/* ----------------------------------------------------- export enumeration */
/** Every account-scoped surface in costs.json is either exported by section
 * or listed here with its reason. `lifecycle-contract.test.ts` enforces that
 * the union covers the inventory, so a new surface cannot silently vanish. */
export const LIFECYCLE_EXPORT_SECTIONS: readonly string[] = Object.freeze([
  "account_enrollment", "usage_admission_control", "usage_admission_audit", "usage_admission_devices", "usage_admission_heads",
  "usage_admission_journal", "usage_admission_days", "usage_admission_pending",
  "usage_stats_control", "usage_stats_writers", "usage_stats_day_sources", "usage_stats_devices", "usage_stats_pending",
  "usage_stats_days", "usage_stats_day_meta", "usage_stats_day_rows",
  "usage_contribution_control", "usage_contribution_populations", "usage_contribution_heads", "usage_contribution_memberships",
  "usage_contribution_operations", "usage_contribution_devices",
  "usage_contribution_projection_control", "usage_contribution_projection_pending", "usage_contribution_projection_publications",
  "account_work", "usage_contribution_rebuild_jobs", "lifecycle",
]);
export const LIFECYCLE_EXPORT_EXCLUDED: readonly LifecycleExportExclusionV1[] = Object.freeze([
  owner("worker:account_enrollment#anchor.namespaceKey", "credential material; the namespace key is never exported"),
  owner("worker:pairing_state", "transient pairing intents are not account-owned records"),
  owner("worker:restore_fence", "operator authority record in the RestoreFence object; its phase is reported in lifecycle status"),
  owner("worker:fence_lease", "in-flight execution registration, not account content"),
  owner("worker:fence_attempt", "execution audit of the RestoreFence object, not account content"),
  owner("worker:leaderboard_index", "public index membership is derived from exported consent and reported in lifecycle status"),
  owner("r2:canonical-contribution-bodies", "content-addressed by the exported usage_contribution_heads rows; fetched through the contribution query route"),
  owner("r2:canonical-contribution-artifacts", "content-addressed journal artifacts keyed by the exported usage_contribution_operations rows"),
  owner("r2:canonical-contribution-index", "derived projection rebuilt from exported heads; keyed by the exported projection publications"),
  owner("r2:admission-batches-and-journals", "content-addressed by the exported usage_admission_journal rows"),
  owner("r2:stats-snapshots-and-receipts", "content-addressed by the exported usage_stats_days and usage_stats_day_sources rows"),
  owner("r2:enrollment-namespace-anchors", "mirror of the exported enrollment anchor metadata without the namespace key"),
  owner("r2:staged-measurements", "transient pre-admission staging with no account-owned durable content"),
]);
function owner(surface: string, reason: string): LifecycleExportExclusionV1 { return owned({ surface, reason }); }
