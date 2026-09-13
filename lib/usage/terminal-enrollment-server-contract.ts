import { createHash } from "node:crypto";
import {
  decodeTerminalEnrollmentRequest, encodeTerminalEnrollmentRequest, TERMINAL_ENROLLMENT_ERRORS,
  TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES, TERMINAL_ENROLLMENT_MAX_TIME_MS,
  TERMINAL_ENROLLMENT_POLL_MS, TERMINAL_ENROLLMENT_TTL_MS,
  type TerminalEnrollmentRequest, type TerminalEnrollmentReservation, type TerminalEnrollmentReceipt,
  type TerminalEnrollmentResult,
} from "./terminal-enrollment-contract";

/** Server observations are not caller-retained context or permission to route.
 * Only the owned result of the selected authoritative RPC may enter this codec. */
export type TerminalEnrollmentServerObservation = Readonly<{ nowMs: number; recoveryGeneration: string }>;
export type TerminalReservationReadError = "invalid_input" | "not_initialized" | "unauthorized"
  | "storage_invalid" | "clock_regressed" | "not_reserved" | "recovery_required";
export type TerminalReservationRead = TerminalEnrollmentResult<TerminalEnrollmentReservation, TerminalReservationReadError>;
/** The success-only expiry belongs to the same owned validation as the bytes.
 * It lets transport retain a live acceptance fence without rereading raw RPCs. */
export type TerminalEnrollmentServerResponse = Readonly<{ bytes: Uint8Array<ArrayBuffer>; acceptBeforeMs: number | null }>;
const readErrors: readonly string[] = ["invalid_input", "not_initialized", "unauthorized", "storage_invalid",
  "clock_regressed", "not_reserved", "recovery_required"];
const reservationKeys = ["schemaVersion", "intentId", "accountId", "reservationId", "pollCommitment", "uploadCommitment",
  "recoveryGeneration", "reservedAtMs", "expiresAtMs"] as const;
const receiptKeys = ["schemaVersion", "accountId", "intentId", "reservationId", "deviceId", "enrolledAtMs", "namespaceVersion"] as const;
const states = ["pending", "browser-approved", "terminal-confirmed", "denied", "expired"];
const hex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
const account = (value: unknown): value is string => typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value)
  && value !== `acct_${"0".repeat(32)}`;
const time = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
  && !Object.is(value, -0) && value >= 0 && value <= TERMINAL_ENROLLMENT_MAX_TIME_MS;
const hash = (...parts: string[]): string => createHash("sha256").update(parts.join("\0"), "ascii").digest("hex");
function owned<T extends object>(fields: T): Readonly<T> {
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(fields)) result[key] = (fields as Record<string, unknown>)[key];
  return Object.freeze(result) as Readonly<T>;
}
function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const item = descriptors[key];
    if (!item || !("value" in item) || !item.enumerable) return null;
    result[key] = item.value as unknown;
  }
  return result;
}
function requestOf(input: unknown): TerminalEnrollmentRequest | null {
  // Reuse the frozen request boundary rather than duplicating its secret rules.
  const bytes = encodeTerminalEnrollmentRequest(input);
  if (!bytes.ok) return null;
  const decoded = decodeTerminalEnrollmentRequest(bytes.value);
  return decoded.ok ? decoded.value : null;
}
function observationOf(input: unknown): TerminalEnrollmentServerObservation | null {
  const value = snapshot(input, ["nowMs", "recoveryGeneration"]);
  return value && time(value.nowMs) && hex(value.recoveryGeneration)
    ? owned({ nowMs: value.nowMs, recoveryGeneration: value.recoveryGeneration }) : null;
}
function reservationOf(request: TerminalEnrollmentRequest, observation: TerminalEnrollmentServerObservation, input: unknown): TerminalEnrollmentReservation | null {
  if (!("uploadSecret" in request.input)) return null;
  const value = snapshot(input, reservationKeys), proof = request.input;
  if (!value || value.schemaVersion !== 1 || value.intentId !== proof.intentId || !account(value.accountId)
    || !hex(value.reservationId) || value.recoveryGeneration !== observation.recoveryGeneration
    || value.pollCommitment !== hash("aicharts:pairing:v1", "poll", proof.intentId, proof.pollSecret)
    || value.uploadCommitment !== hash("aicharts:pairing:v1", "upload", proof.intentId, proof.uploadSecret)
    || value.pollCommitment === value.uploadCommitment || !time(value.reservedAtMs) || !time(value.expiresAtMs)
    || value.reservedAtMs >= value.expiresAtMs || value.expiresAtMs - value.reservedAtMs > TERMINAL_ENROLLMENT_TTL_MS
    || value.reservedAtMs > observation.nowMs) return null;
  // PairingIntent audits the original pairing/authentication history. The
  // reservation can be auth-truncated: its expiry cannot reconstruct that history.
  return owned({ schemaVersion: 1, intentId: proof.intentId, accountId: value.accountId, reservationId: value.reservationId,
    pollCommitment: value.pollCommitment, uploadCommitment: value.uploadCommitment,
    recoveryGeneration: observation.recoveryGeneration, reservedAtMs: value.reservedAtMs, expiresAtMs: value.expiresAtMs });
}
function receiptOf(reservation: TerminalEnrollmentReservation, nowMs: number, input: unknown): TerminalEnrollmentReceipt | null {
  const value = snapshot(input, receiptKeys);
  if (!value || value.schemaVersion !== 1 || value.namespaceVersion !== 1 || value.accountId !== reservation.accountId
    || value.intentId !== reservation.intentId || value.reservationId !== reservation.reservationId
    || value.deviceId !== hash("aicharts:enrollment:v1", "device", reservation.accountId, reservation.intentId, reservation.reservationId)
    || !time(value.enrolledAtMs) || value.enrolledAtMs < reservation.reservedAtMs
    || value.enrolledAtMs >= reservation.expiresAtMs || value.enrolledAtMs > nowMs) return null;
  return owned({ schemaVersion: 1, accountId: reservation.accountId, intentId: reservation.intentId,
    reservationId: reservation.reservationId, deviceId: value.deviceId, enrolledAtMs: value.enrolledAtMs, namespaceVersion: 1 });
}

/** Existing-only read results, owned before their RPC disposal. Null means an
 * operational failure, never not_reserved and never permission to create. */
export function ownTerminalReservationRead(request: unknown, observation: unknown, rpcEnvelope: unknown): TerminalReservationRead | null {
  try {
    const checked = requestOf(request), observed = observationOf(observation);
    if (!checked || !("uploadSecret" in checked.input) || !observed) return null;
    const failure = snapshot(rpcEnvelope, ["ok", "error"]);
    if (failure) return failure.ok === false && typeof failure.error === "string" && readErrors.includes(failure.error)
      ? owned({ ok: false as const, error: failure.error as TerminalReservationReadError }) : null;
    const success = snapshot(rpcEnvelope, ["ok", "value"]);
    const value = success?.ok === true ? reservationOf(checked, observed, success.value) : null;
    return value ? owned({ ok: true as const, value }) : null;
  } catch { return null; }
}

function resultOf(request: TerminalEnrollmentRequest, observation: TerminalEnrollmentServerObservation, input: unknown): Readonly<{ result: object; acceptBeforeMs: number | null }> | null {
  const failure = snapshot(input, ["ok", "error"]);
  if (failure) return failure.ok === false && typeof failure.error === "string" && TERMINAL_ENROLLMENT_ERRORS[request.operation].includes(failure.error)
    ? owned({ result: owned({ ok: false, error: failure.error }), acceptBeforeMs: null }) : null;
  const success = snapshot(input, ["ok", "value"]);
  if (success?.ok !== true) return null;
  let value: object | null, acceptBeforeMs: number | null = null;
  if (request.operation === "initialize") {
    const item = snapshot(success.value, ["expiresAtMs"]);
    value = item && time(item.expiresAtMs) && item.expiresAtMs >= TERMINAL_ENROLLMENT_TTL_MS
      && item.expiresAtMs - TERMINAL_ENROLLMENT_TTL_MS <= observation.nowMs ? owned({ expiresAtMs: item.expiresAtMs }) : null;
  } else if (request.operation === "poll" || request.operation === "confirm") {
    const item = snapshot(success.value, ["state", "expiresAtMs", "pollAfterMs", "approvedAccountId"]);
    if (!item || typeof item.state !== "string" || !states.includes(item.state) || !time(item.expiresAtMs)
      || item.expiresAtMs < TERMINAL_ENROLLMENT_TTL_MS || item.expiresAtMs - TERMINAL_ENROLLMENT_TTL_MS > observation.nowMs
      || !time(item.pollAfterMs) || item.pollAfterMs > TERMINAL_ENROLLMENT_POLL_MS) return null;
    const approved = item.state === "browser-approved" || item.state === "terminal-confirmed";
    if (approved ? !account(item.approvedAccountId) : item.approvedAccountId !== null) return null;
    if (request.operation === "poll" ? item.pollAfterMs !== TERMINAL_ENROLLMENT_POLL_MS
      : item.state !== "terminal-confirmed" || item.approvedAccountId !== request.input.accountId || observation.nowMs >= item.expiresAtMs) return null;
    if (request.operation === "confirm") acceptBeforeMs = item.expiresAtMs;
    value = owned({ state: item.state, expiresAtMs: item.expiresAtMs, pollAfterMs: item.pollAfterMs, approvedAccountId: item.approvedAccountId });
  } else {
    const pair = request.operation === "reserveEnrollment" ? null
      : snapshot(success.value, ["reservation", request.operation === "enroll" ? "enrollment" : "namespace"]);
    if (request.operation !== "reserveEnrollment" && !pair) return null;
    const reservation = reservationOf(request, observation, request.operation === "reserveEnrollment" ? success.value : pair!.reservation);
    if (!reservation) return null;
    if (request.operation === "reserveEnrollment") value = reservation;
    else if (request.operation === "enroll") {
      const item = snapshot(pair!.enrollment, ["receipt", "deviceState"]);
      if (!item || (item.deviceState !== "active" && item.deviceState !== "revoked")) return null;
      const receipt = receiptOf(reservation, observation.nowMs, item.receipt);
      value = receipt ? owned({ reservation, enrollment: owned({ receipt, deviceState: item.deviceState }) }) : null;
    } else {
      const item = snapshot(pair!.namespace, ["schemaVersion", "namespaceVersion", "namespaceKey", "receipt"]);
      if (!item || item.schemaVersion !== 1 || item.namespaceVersion !== 1 || !hex(item.namespaceKey)
        || observation.nowMs >= reservation.expiresAtMs) return null;
      acceptBeforeMs = reservation.expiresAtMs;
      const receipt = receiptOf(reservation, observation.nowMs, item.receipt);
      // The selected namespace RPC establishes current enrollment/revocation.
      // Client-retained receipt history remains an independent client check.
      value = receipt ? owned({ reservation, namespace: owned({ schemaVersion: 1, namespaceVersion: 1, namespaceKey: item.namespaceKey, receipt }) }) : null;
    }
  }
  return value ? owned({ result: owned({ ok: true, value }), acceptBeforeMs }) : null;
}

/** Exact frozen wire, validated from source results without manufacturing a
 * TerminalEnrollmentContext. All serialized nodes are newly owned records. */
export function ownTerminalEnrollmentServerResponse(request: unknown, observation: unknown, result: unknown): TerminalEnrollmentServerResponse | null {
  try {
    const checked = requestOf(request), observed = observationOf(observation);
    if (!checked || !observed) return null;
    const value = resultOf(checked, observed, result);
    if (!value) return null;
    const text = JSON.stringify(owned({ schemaVersion: 1, operation: checked.operation, intentId: checked.input.intentId, result: value.result }));
    if (text.length > TERMINAL_ENROLLMENT_MAX_RESPONSE_BYTES || /[^\x20-\x7e]/u.test(text)) return null;
    return owned({ bytes: new Uint8Array(new TextEncoder().encode(text)), acceptBeforeMs: value.acceptBeforeMs });
  } catch { return null; }
}

export function encodeTerminalEnrollmentServerResponse(request: unknown, observation: unknown, result: unknown): Uint8Array<ArrayBuffer> | null {
  return ownTerminalEnrollmentServerResponse(request, observation, result)?.bytes ?? null;
}
