import { createHash } from "node:crypto";

/** Dormant memory-only wire validation. Context is neither authentication nor a grant. */
export const TERMINAL_ENROLLMENT_URL = "https://usage.aicharts.io/v1/enrollment";
export const TERMINAL_ENROLLMENT_MEDIA = "application/json; charset=utf-8";
export const TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES = 1_024;
export const TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES = 2_048;
export const TERMINAL_ENROLLMENT_MAX_TIME_MS = 8_640_000_000_000_000;
export const TERMINAL_ENROLLMENT_TTL_MS = 600_000;
export const TERMINAL_ENROLLMENT_POLL_MS = 5_000;

export type TerminalEnrollmentResult<T, E extends string> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;
export type TerminalEnrollmentOperation = "initialize" | "poll" | "confirm" | "reserveEnrollment" | "enroll" | "namespaceForEnrollment";
export type TerminalEnrollmentProof = Readonly<{ intentId: string; pollSecret: string; uploadSecret: string }>;
export type TerminalEnrollmentRequest =
  | Readonly<{ schemaVersion: 1; operation: "initialize"; input: Readonly<{ intentId: string; pollSecret: string; uploadCommitment: string }> }>
  | Readonly<{ schemaVersion: 1; operation: "poll"; input: Readonly<{ intentId: string; pollSecret: string }> }>
  | Readonly<{ schemaVersion: 1; operation: "confirm"; input: Readonly<{ intentId: string; pollSecret: string; accountId: string }> }>
  | Readonly<{ schemaVersion: 1; operation: "reserveEnrollment" | "enroll" | "namespaceForEnrollment"; input: TerminalEnrollmentProof }>;
export type TerminalEnrollmentPairingView = Readonly<{
  state: "pending" | "browser-approved" | "terminal-confirmed" | "denied" | "expired";
  expiresAtMs: number; pollAfterMs: number; approvedAccountId: string | null;
}>;
export type TerminalEnrollmentReservation = Readonly<{
  schemaVersion: 1; intentId: string; accountId: string; reservationId: string;
  pollCommitment: string; uploadCommitment: string; recoveryGeneration: string; reservedAtMs: number; expiresAtMs: number;
}>;
export type TerminalEnrollmentReceipt = Readonly<{
  schemaVersion: 1; accountId: string; intentId: string; reservationId: string;
  deviceId: string; enrolledAtMs: number; namespaceVersion: 1;
}>;
export type TerminalEnrollmentView = Readonly<{ receipt: TerminalEnrollmentReceipt; deviceState: "active" | "revoked" }>;
export type TerminalEnrollmentNamespace = Readonly<{ schemaVersion: 1; namespaceVersion: 1; namespaceKey: string; receipt: TerminalEnrollmentReceipt }>;
/** The caller supplies its acceptance-time observation. Transport clock history
 * and monotonic deadlines remain separate custody, outside this pure codec. */
export type TerminalEnrollmentContext = Readonly<{
  nowMs: number; initializedExpiresAtMs: number | null; confirmedAccountId: string | null;
  reservation: TerminalEnrollmentReservation | null; enrollment: TerminalEnrollmentView | null;
}>;
export type TerminalEnrollmentPairingCommonError = "invalid_input" | "storage_invalid" | "clock_regressed";
/** Preserve the current authoritative EnrollmentError union, including failures
 * which the future adapter can receive while selecting the account owner. */
export type TerminalEnrollmentAccountError = "invalid_input" | "unavailable" | "unauthorized" | "not_reserved" | "not_enrolled"
  | "expired" | "conflict" | "recovery_required" | "revoked" | "storage_invalid" | "storage_unavailable" | "clock_regressed" | "limit";
export type TerminalEnrollmentResults = Readonly<{
  initialize: TerminalEnrollmentResult<Readonly<{ expiresAtMs: number }>, TerminalEnrollmentPairingCommonError | "conflict">;
  poll: TerminalEnrollmentResult<TerminalEnrollmentPairingView, TerminalEnrollmentPairingCommonError | "not_initialized" | "unauthorized" | "expired" | "throttled">;
  confirm: TerminalEnrollmentResult<TerminalEnrollmentPairingView, TerminalEnrollmentPairingCommonError | "not_initialized" | "unauthorized" | "expired" | "invalid_transition" | "authentication_not_fresh">;
  reserveEnrollment: TerminalEnrollmentResult<TerminalEnrollmentReservation, TerminalEnrollmentPairingCommonError | "not_initialized" | "unauthorized" | "expired" | "invalid_transition" | "recovery_required">;
  enroll: TerminalEnrollmentResult<Readonly<{ reservation: TerminalEnrollmentReservation; enrollment: TerminalEnrollmentView }>, TerminalEnrollmentAccountError>;
  namespaceForEnrollment: TerminalEnrollmentResult<Readonly<{ reservation: TerminalEnrollmentReservation; namespace: TerminalEnrollmentNamespace }>, TerminalEnrollmentAccountError>;
}>;
export type TerminalEnrollmentDomainResult = TerminalEnrollmentResults[TerminalEnrollmentOperation];

const pairingErrors = ["invalid_input", "storage_invalid", "clock_regressed"] as const;
const accountErrors = ["invalid_input", "unavailable", "unauthorized", "not_reserved", "not_enrolled", "expired", "conflict", "recovery_required", "revoked", "storage_invalid", "storage_unavailable", "clock_regressed", "limit"] as const;
export const TERMINAL_ENROLLMENT_ERRORS: Readonly<Record<TerminalEnrollmentOperation, readonly string[]>> = Object.freeze({
  initialize: Object.freeze([...pairingErrors, "conflict"]),
  poll: Object.freeze([...pairingErrors, "not_initialized", "unauthorized", "expired", "throttled"]),
  confirm: Object.freeze([...pairingErrors, "not_initialized", "unauthorized", "expired", "invalid_transition", "authentication_not_fresh"]),
  // Existing-only read consumes not_reserved before exactly one reserve call.
  reserveEnrollment: Object.freeze([...pairingErrors, "not_initialized", "unauthorized", "expired", "invalid_transition", "recovery_required"]),
  enroll: Object.freeze([...accountErrors]), namespaceForEnrollment: Object.freeze([...accountErrors]),
});
const reservationKeys = ["schemaVersion", "intentId", "accountId", "reservationId", "pollCommitment", "uploadCommitment", "recoveryGeneration", "reservedAtMs", "expiresAtMs"] as const;
const receiptKeys = ["schemaVersion", "accountId", "intentId", "reservationId", "deviceId", "enrolledAtMs", "namespaceVersion"] as const;
const states: readonly string[] = ["pending", "browser-approved", "terminal-confirmed", "denied", "expired"];
const hex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
const account = (value: unknown): value is string => typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value) && value !== `acct_${"0".repeat(32)}`;
const time = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)
  && value >= 0 && value <= TERMINAL_ENROLLMENT_MAX_TIME_MS;
const hash = (...parts: string[]): string => createHash("sha256").update(parts.join("\0"), "ascii").digest("hex");
const commitment = (role: "poll" | "upload", intentId: string, secret: string): string => hash("aicharts:pairing:v1", role, intentId, secret);

/** Only internally authored fields enter these null-prototype, frozen graphs. */
function owned<T extends object>(fields: T): Readonly<T> {
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(fields)) copy[key] = (fields as Record<string, unknown>)[key];
  return Object.freeze(copy) as Readonly<T>;
}
const good = <T>(value: T): TerminalEnrollmentResult<T, never> => owned({ ok: true as const, value });
const bad = <E extends string>(error: E): TerminalEnrollmentResult<never, E> => owned({ ok: false as const, error });
function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = descriptors[key];
    if (!field || !("value" in field) || !field.enumerable) return null;
    copy[key] = field.value as unknown;
  }
  return copy;
}

function requestOf(value: unknown): TerminalEnrollmentRequest | null {
  const envelope = snapshot(value, ["schemaVersion", "operation", "input"]);
  if (envelope?.schemaVersion !== 1) return null;
  const operation = envelope.operation;
  let extra: readonly string[];
  switch (operation) {
    case "initialize": extra = ["uploadCommitment"]; break;
    case "poll": extra = []; break;
    case "confirm": extra = ["accountId"]; break;
    case "reserveEnrollment": case "enroll": case "namespaceForEnrollment": extra = ["uploadSecret"]; break;
    default: return null;
  }
  const input = snapshot(envelope.input, ["intentId", "pollSecret", ...extra]);
  if (!input || !hex(input.intentId) || !hex(input.pollSecret)) return null;
  const proof = { intentId: input.intentId, pollSecret: input.pollSecret };
  if (operation === "initialize") {
    if (!hex(input.uploadCommitment) || input.uploadCommitment === commitment("poll", proof.intentId, proof.pollSecret)
      || input.uploadCommitment === commitment("upload", proof.intentId, proof.pollSecret)) return null;
    return owned({ schemaVersion: 1, operation, input: owned({ ...proof, uploadCommitment: input.uploadCommitment }) });
  }
  if (operation === "poll") return owned({ schemaVersion: 1, operation, input: owned(proof) });
  if (operation === "confirm") return account(input.accountId) ? owned({ schemaVersion: 1, operation, input: owned({ ...proof, accountId: input.accountId }) }) : null;
  if (!hex(input.uploadSecret) || input.uploadSecret === input.pollSecret) return null;
  return owned({ schemaVersion: 1, operation, input: owned({ ...proof, uploadSecret: input.uploadSecret }) });
}

function reservationOf(request: TerminalEnrollmentRequest, initializedExpiresAtMs: number, confirmedAccountId: string, nowMs: number, value: unknown): TerminalEnrollmentReservation | null {
  const item = snapshot(value, reservationKeys), proof = request.input;
  if (!item || item.schemaVersion !== 1 || item.intentId !== proof.intentId || item.accountId !== confirmedAccountId
    || !hex(item.reservationId) || item.pollCommitment !== commitment("poll", proof.intentId, proof.pollSecret)
    || !hex(item.uploadCommitment) || item.uploadCommitment === item.pollCommitment || !hex(item.recoveryGeneration)
    || !time(item.reservedAtMs) || !time(item.expiresAtMs) || item.reservedAtMs >= item.expiresAtMs
    || item.expiresAtMs - item.reservedAtMs > TERMINAL_ENROLLMENT_TTL_MS
    || item.reservedAtMs < initializedExpiresAtMs - TERMINAL_ENROLLMENT_TTL_MS || item.reservedAtMs > nowMs || item.expiresAtMs > initializedExpiresAtMs) return null;
  const expectedUpload = "uploadSecret" in proof ? commitment("upload", proof.intentId, proof.uploadSecret)
    : "uploadCommitment" in proof ? proof.uploadCommitment : null;
  if (expectedUpload !== null && item.uploadCommitment !== expectedUpload) return null;
  return owned({ schemaVersion: 1, intentId: proof.intentId, accountId: confirmedAccountId, reservationId: item.reservationId,
    pollCommitment: item.pollCommitment, uploadCommitment: item.uploadCommitment, recoveryGeneration: item.recoveryGeneration,
    reservedAtMs: item.reservedAtMs, expiresAtMs: item.expiresAtMs });
}
function receiptOf(reservation: TerminalEnrollmentReservation, nowMs: number, value: unknown): TerminalEnrollmentReceipt | null {
  const item = snapshot(value, receiptKeys);
  if (!item || item.schemaVersion !== 1 || item.namespaceVersion !== 1 || item.accountId !== reservation.accountId
    || item.intentId !== reservation.intentId || item.reservationId !== reservation.reservationId
    || item.deviceId !== hash("aicharts:enrollment:v1", "device", reservation.accountId, reservation.intentId, reservation.reservationId)
    || !time(item.enrolledAtMs) || item.enrolledAtMs < reservation.reservedAtMs || item.enrolledAtMs >= reservation.expiresAtMs || item.enrolledAtMs > nowMs) return null;
  return owned({ schemaVersion: 1, accountId: reservation.accountId, intentId: reservation.intentId, reservationId: reservation.reservationId,
    deviceId: item.deviceId, enrolledAtMs: item.enrolledAtMs, namespaceVersion: 1 });
}
function enrollmentOf(reservation: TerminalEnrollmentReservation, nowMs: number, value: unknown): TerminalEnrollmentView | null {
  const item = snapshot(value, ["receipt", "deviceState"]);
  if (!item || (item.deviceState !== "active" && item.deviceState !== "revoked")) return null;
  const receipt = receiptOf(reservation, nowMs, item.receipt);
  return receipt ? owned({ receipt, deviceState: item.deviceState }) : null;
}
const same = (left: object, right: object): boolean => JSON.stringify(left) === JSON.stringify(right);

function contextOf(request: TerminalEnrollmentRequest, value: unknown): TerminalEnrollmentContext | null {
  const item = snapshot(value, ["nowMs", "initializedExpiresAtMs", "confirmedAccountId", "reservation", "enrollment"]);
  if (!item || !time(item.nowMs) || !(item.initializedExpiresAtMs === null || (time(item.initializedExpiresAtMs)
    && item.initializedExpiresAtMs >= TERMINAL_ENROLLMENT_TTL_MS && item.nowMs >= item.initializedExpiresAtMs - TERMINAL_ENROLLMENT_TTL_MS))
    || !(item.confirmedAccountId === null || account(item.confirmedAccountId))) return null;
  if (item.initializedExpiresAtMs === null && (item.confirmedAccountId !== null || item.reservation !== null || item.enrollment !== null)) return null;
  if (request.operation !== "initialize" && item.initializedExpiresAtMs === null) return null;
  if (request.operation === "confirm" && item.confirmedAccountId !== null && item.confirmedAccountId !== request.input.accountId) return null;
  const needsAccount = request.operation === "reserveEnrollment" || request.operation === "enroll" || request.operation === "namespaceForEnrollment";
  if (needsAccount && item.confirmedAccountId === null) return null;
  let reservation: TerminalEnrollmentReservation | null = null, enrollment: TerminalEnrollmentView | null = null;
  if (item.reservation !== null) {
    if (item.initializedExpiresAtMs === null || item.confirmedAccountId === null) return null;
    reservation = reservationOf(request, item.initializedExpiresAtMs, item.confirmedAccountId, item.nowMs, item.reservation);
    if (!reservation) return null;
  }
  if (item.enrollment !== null) {
    if (!reservation) return null;
    enrollment = enrollmentOf(reservation, item.nowMs, item.enrollment);
    if (!enrollment) return null;
  }
  if ((request.operation === "enroll" || request.operation === "namespaceForEnrollment") && !reservation) return null;
  if (request.operation === "namespaceForEnrollment" && !enrollment) return null;
  return owned({ nowMs: item.nowMs, initializedExpiresAtMs: item.initializedExpiresAtMs,
    confirmedAccountId: item.confirmedAccountId, reservation, enrollment });
}

function resultOf(request: TerminalEnrollmentRequest, context: TerminalEnrollmentContext, value: unknown): TerminalEnrollmentDomainResult | null {
  const failure = snapshot(value, ["ok", "error"]);
  if (failure) return failure.ok === false && typeof failure.error === "string" && TERMINAL_ENROLLMENT_ERRORS[request.operation].includes(failure.error)
    ? bad(failure.error) as TerminalEnrollmentDomainResult : null;
  const success = snapshot(value, ["ok", "value"]);
  if (success?.ok !== true) return null;
  if (request.operation === "initialize") {
    const item = snapshot(success.value, ["expiresAtMs"]);
    return item && time(item.expiresAtMs) && item.expiresAtMs >= TERMINAL_ENROLLMENT_TTL_MS
      && item.expiresAtMs - TERMINAL_ENROLLMENT_TTL_MS <= context.nowMs
      && (context.initializedExpiresAtMs === null || item.expiresAtMs === context.initializedExpiresAtMs)
      ? good(owned({ expiresAtMs: item.expiresAtMs })) : null;
  }
  if (request.operation === "poll" || request.operation === "confirm") {
    const item = snapshot(success.value, ["state", "expiresAtMs", "pollAfterMs", "approvedAccountId"]);
    if (!item || typeof item.state !== "string" || !states.includes(item.state) || item.expiresAtMs !== context.initializedExpiresAtMs
      || !time(item.pollAfterMs) || item.pollAfterMs > TERMINAL_ENROLLMENT_POLL_MS) return null;
    const approved = item.state === "browser-approved" || item.state === "terminal-confirmed";
    if (approved ? !account(item.approvedAccountId) || (context.confirmedAccountId !== null && item.approvedAccountId !== context.confirmedAccountId) : item.approvedAccountId !== null) return null;
    if (request.operation === "poll" ? item.pollAfterMs !== TERMINAL_ENROLLMENT_POLL_MS
      : item.state !== "terminal-confirmed" || item.approvedAccountId !== request.input.accountId || context.nowMs >= context.initializedExpiresAtMs!) return null;
    return good(owned({ state: item.state as TerminalEnrollmentPairingView["state"], expiresAtMs: item.expiresAtMs as number,
      pollAfterMs: item.pollAfterMs, approvedAccountId: item.approvedAccountId as string | null }));
  }
  const pair = request.operation === "reserveEnrollment" ? null : snapshot(success.value, ["reservation", request.operation === "enroll" ? "enrollment" : "namespace"]);
  if (request.operation !== "reserveEnrollment" && !pair) return null;
  const reservation = reservationOf(request, context.initializedExpiresAtMs!, context.confirmedAccountId!, context.nowMs,
    request.operation === "reserveEnrollment" ? success.value : pair!.reservation);
  if (!reservation || (context.reservation !== null && !same(reservation, context.reservation))) return null;
  if (request.operation === "reserveEnrollment") return good(reservation);
  if (request.operation === "enroll") {
    const enrollment = enrollmentOf(reservation, context.nowMs, pair!.enrollment);
    if (!enrollment || (context.enrollment !== null && (!same(enrollment.receipt, context.enrollment.receipt)
      || (context.enrollment.deviceState === "revoked" && enrollment.deviceState !== "revoked")))) return null;
    return good(owned({ reservation, enrollment }));
  }
  if (context.enrollment!.deviceState !== "active" || context.nowMs >= reservation.expiresAtMs || context.nowMs >= context.initializedExpiresAtMs!) return null;
  const item = snapshot(pair!.namespace, ["schemaVersion", "namespaceVersion", "namespaceKey", "receipt"]);
  if (!item || item.schemaVersion !== 1 || item.namespaceVersion !== 1 || !hex(item.namespaceKey)) return null;
  const receipt = receiptOf(reservation, context.nowMs, item.receipt);
  return receipt && same(receipt, context.enrollment!.receipt)
    ? good(owned({ reservation, namespace: owned({ schemaVersion: 1 as const, namespaceVersion: 1 as const, namespaceKey: item.namespaceKey, receipt }) })) : null;
}

// Intrinsic access rejects shared/resizable backing without invoking overrides.
const typed: object = Object.getPrototypeOf(Uint8Array.prototype);
const tagOf = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const lengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const fixedLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const set = Uint8Array.prototype.set;
function copyBytes(value: unknown, cap: number): Uint8Array<ArrayBuffer> | null {
  if (tagOf.call(value) !== "Uint8Array") return null;
  const buffer: unknown = bufferOf.call(value); fixedLength.call(buffer);
  if (resizable?.call(buffer) === true) return null;
  const length = lengthOf.call(value) as number;
  if (length < 1 || length > cap) return null;
  const bytes = new Uint8Array(length); set.call(bytes, value as Uint8Array); return bytes;
}
function ascii(bytes: Uint8Array): string | null {
  let text = "";
  for (const byte of bytes) { if (byte > 0x7f) return null; text += String.fromCharCode(byte); }
  return text;
}
/** Every nested value has been projected onto a fixed null-prototype schema. */
function encode(value: object, cap: number): Uint8Array<ArrayBuffer> | null {
  const text = JSON.stringify(value);
  if (text.length < 1 || text.length > cap) return null;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index); if (code > 0x7f) return null; bytes[index] = code;
  }
  return bytes;
}
function envelope(request: TerminalEnrollmentRequest, result: TerminalEnrollmentDomainResult) {
  return owned({ schemaVersion: 1 as const, operation: request.operation, intentId: request.input.intentId, result });
}

export function encodeTerminalEnrollmentRequest(input: unknown): TerminalEnrollmentResult<Uint8Array<ArrayBuffer>, "invalid_request"> {
  try {
    const request = requestOf(input), bytes = request && encode(request, TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES);
    return bytes ? good(bytes) : bad("invalid_request");
  } catch { return bad("invalid_request"); }
}
export function decodeTerminalEnrollmentRequest(input: unknown): TerminalEnrollmentResult<TerminalEnrollmentRequest, "invalid_request"> {
  try {
    const bytes = copyBytes(input, TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES), text = bytes && ascii(bytes);
    if (!text) return bad("invalid_request");
    const request = requestOf(JSON.parse(text) as unknown);
    return request && JSON.stringify(request) === text ? good(request) : bad("invalid_request");
  } catch { return bad("invalid_request"); }
}
export function encodeTerminalEnrollmentResponse(request: unknown, context: unknown, result: unknown): TerminalEnrollmentResult<Uint8Array<ArrayBuffer>, "invalid_response"> {
  try {
    const checked = requestOf(request), retained = checked && contextOf(checked, context), domain = checked && retained && resultOf(checked, retained, result);
    const bytes = checked && domain && encode(envelope(checked, domain), TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES);
    return bytes ? good(bytes) : bad("invalid_response");
  } catch { return bad("invalid_response"); }
}
export function decodeTerminalEnrollmentResponse(input: unknown, request: unknown, context: unknown): TerminalEnrollmentResult<TerminalEnrollmentDomainResult, "invalid_response"> {
  try {
    const checked = requestOf(request), retained = checked && contextOf(checked, context);
    if (!checked || !retained) return bad("invalid_response");
    const bytes = copyBytes(input, TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES), text = bytes && ascii(bytes);
    if (!text) return bad("invalid_response");
    const wire = snapshot(JSON.parse(text) as unknown, ["schemaVersion", "operation", "intentId", "result"]);
    if (!wire || wire.schemaVersion !== 1 || wire.operation !== checked.operation || wire.intentId !== checked.input.intentId) return bad("invalid_response");
    const domain = resultOf(checked, retained, wire.result);
    return domain && JSON.stringify(envelope(checked, domain)) === text ? good(domain) : bad("invalid_response");
  } catch { return bad("invalid_response"); }
}
