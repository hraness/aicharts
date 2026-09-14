/** Memory-only canonical DTOs. Validation neither authenticates nor dispatches. */
export const PAIRING_TRANSPORT_MAX_REQUEST_BYTES = 1_024;
export const PAIRING_TRANSPORT_MAX_RESPONSE_BYTES = 512;
export const PAIRING_TRANSPORT_MAX_TIME_MS = 8_640_000_000_000_000;

export type Result<T, E extends string> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;
export type PairingTransportOperation = "beginBrowserAttempt" | "recordVerifiedAuthentication" | "browserStatus" | "decideBrowser";
export type PairingTransportProof = Readonly<{ intentId: string; attemptId: string; browserNonce: string; contextToken: string }>;
export type PairingTransportRequest =
  | Readonly<{ schemaVersion: 1; operation: "beginBrowserAttempt"; input: Readonly<{ intentId: string; browserNonce: string }> }>
  | Readonly<{ schemaVersion: 1; operation: "recordVerifiedAuthentication"; input: PairingTransportProof & Readonly<{ accountId: string; authTimeMs: number; sessionExpiresAtMs: number }> }>
  | Readonly<{ schemaVersion: 1; operation: "browserStatus"; input: PairingTransportProof }>
  | Readonly<{ schemaVersion: 1; operation: "decideBrowser"; input: PairingTransportProof & Readonly<{ accountId: string; liveSessionExpiresAtMs: number; decision: "approve" | "deny" }> }>;
export type PairingTransportBeginValue = Readonly<{ attemptId: string; contextToken: string; startedAtMs: number; expiresAtMs: number }>;
export type PairingTransportBrowserValue = Readonly<{
  state: "pending" | "browser-approved" | "terminal-confirmed" | "denied" | "expired";
  expiresAtMs: number; accountId: string | null; authenticationExpiresAtMs: number | null;
}>;
export type PairingTransportCommonError = "invalid_input" | "not_initialized" | "unauthorized" | "storage_invalid" | "clock_regressed";
export type PairingTransportResults = Readonly<{
  beginBrowserAttempt: Result<PairingTransportBeginValue, PairingTransportCommonError | "expired" | "invalid_transition" | "attempt_limit">;
  recordVerifiedAuthentication: Result<Readonly<{ recorded: true }>, PairingTransportCommonError | "expired" | "invalid_transition" | "authentication_not_fresh" | "conflict">;
  browserStatus: Result<PairingTransportBrowserValue, PairingTransportCommonError>;
  decideBrowser: Result<PairingTransportBrowserValue, PairingTransportCommonError | "expired" | "invalid_transition" | "authentication_not_fresh">;
}>;
export type PairingTransportDomainResult = PairingTransportResults[PairingTransportOperation];

const proofKeys = ["intentId", "attemptId", "browserNonce", "contextToken"] as const;
const commonErrors: readonly string[] = ["invalid_input", "not_initialized", "unauthorized", "storage_invalid", "clock_regressed"];
const extraErrors: Readonly<Record<PairingTransportOperation, readonly string[]>> = Object.freeze({
  beginBrowserAttempt: Object.freeze(["expired", "invalid_transition", "attempt_limit"]),
  recordVerifiedAuthentication: Object.freeze(["expired", "invalid_transition", "authentication_not_fresh", "conflict"]),
  browserStatus: Object.freeze([]),
  decideBrowser: Object.freeze(["expired", "invalid_transition", "authentication_not_fresh"]),
});
const states: readonly string[] = ["pending", "browser-approved", "terminal-confirmed", "denied", "expired"];
const hex = (value: unknown): value is string => typeof value === "string" && value.length === 64
  && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
const account = (value: unknown): value is string => typeof value === "string" && value.length === 37 && /^acct_[0-9a-f]{32}$/u.test(value);
const time = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
  && !Object.is(value, -0) && value >= 0 && value <= PAIRING_TRANSPORT_MAX_TIME_MS;

/** Internal fields only: null prototypes keep inherited toJSON out of encoding. */
function owned<T extends object>(fields: T): Readonly<T> {
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(fields)) copy[key] = (fields as Record<string, unknown>)[key];
  return Object.freeze(copy) as Readonly<T>;
}
const good = <T>(value: T): Result<T, never> => owned({ ok: true as const, value });
const bad = <E extends string>(error: E): Result<never, E> => owned({ ok: false as const, error });

/** No field getters. Reflection is not a hostile-JS/proxy resource sandbox. */
function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    copy[key] = descriptor.value as unknown;
  }
  return copy;
}

function requestOf(value: unknown): PairingTransportRequest | null {
  const envelope = snapshot(value, ["schemaVersion", "operation", "input"]);
  if (envelope === null || envelope.schemaVersion !== 1) return null;
  const operation = envelope.operation;
  if (operation === "beginBrowserAttempt") {
    const input = snapshot(envelope.input, ["intentId", "browserNonce"]);
    if (input === null || !hex(input.intentId) || !hex(input.browserNonce)) return null;
    return owned({ schemaVersion: 1, operation, input: owned({ intentId: input.intentId, browserNonce: input.browserNonce }) });
  }
  let extra: readonly string[];
  switch (operation) {
    case "recordVerifiedAuthentication": extra = ["accountId", "authTimeMs", "sessionExpiresAtMs"]; break;
    case "browserStatus": extra = []; break;
    case "decideBrowser": extra = ["accountId", "liveSessionExpiresAtMs", "decision"]; break;
    default: return null;
  }
  const input = snapshot(envelope.input, [...proofKeys, ...extra]);
  if (input === null || !hex(input.intentId) || !hex(input.attemptId) || !hex(input.browserNonce) || !hex(input.contextToken)) return null;
  const proof = { intentId: input.intentId, attemptId: input.attemptId, browserNonce: input.browserNonce, contextToken: input.contextToken };
  if (operation === "browserStatus") return owned({ schemaVersion: 1, operation, input: owned(proof) });
  if (!account(input.accountId)) return null;
  if (operation === "recordVerifiedAuthentication") {
    if (!time(input.authTimeMs) || input.authTimeMs % 1_000 !== 0 || !time(input.sessionExpiresAtMs)) return null;
    return owned({ schemaVersion: 1, operation, input: owned({ ...proof, accountId: input.accountId, authTimeMs: input.authTimeMs, sessionExpiresAtMs: input.sessionExpiresAtMs }) });
  }
  if (!time(input.liveSessionExpiresAtMs) || (input.decision !== "approve" && input.decision !== "deny")) return null;
  return owned({ schemaVersion: 1, operation, input: owned({ ...proof, accountId: input.accountId, liveSessionExpiresAtMs: input.liveSessionExpiresAtMs, decision: input.decision } as const) });
}

function resultOf(request: PairingTransportRequest, value: unknown): PairingTransportDomainResult | null {
  const failure = snapshot(value, ["ok", "error"]);
  if (failure !== null) {
    if (failure.ok !== false || typeof failure.error !== "string"
      || (!commonErrors.includes(failure.error) && !extraErrors[request.operation].includes(failure.error))) return null;
    return bad(failure.error) as PairingTransportDomainResult;
  }
  const success = snapshot(value, ["ok", "value"]);
  if (success === null || success.ok !== true) return null;
  if (request.operation === "beginBrowserAttempt") {
    const result = snapshot(success.value, ["attemptId", "contextToken", "startedAtMs", "expiresAtMs"]);
    if (result === null || !hex(result.attemptId) || !hex(result.contextToken) || !time(result.startedAtMs) || !time(result.expiresAtMs)
      || result.expiresAtMs <= result.startedAtMs || result.expiresAtMs - result.startedAtMs > 600_000) return null;
    return good(owned({ attemptId: result.attemptId, contextToken: result.contextToken, startedAtMs: result.startedAtMs, expiresAtMs: result.expiresAtMs }));
  }
  if (request.operation === "recordVerifiedAuthentication") {
    const result = snapshot(success.value, ["recorded"]);
    return result?.recorded === true ? good(owned({ recorded: true as const })) : null;
  }
  const result = snapshot(success.value, ["state", "expiresAtMs", "accountId", "authenticationExpiresAtMs"]);
  if (result === null || typeof result.state !== "string" || !states.includes(result.state) || !time(result.expiresAtMs)
    || !(result.accountId === null || account(result.accountId))
    || !(result.authenticationExpiresAtMs === null || time(result.authenticationExpiresAtMs))
    || (result.accountId === null) !== (result.authenticationExpiresAtMs === null)
    || ((result.state === "browser-approved" || result.state === "terminal-confirmed") && result.accountId === null)) return null;
  if (request.operation === "decideBrowser" && (result.accountId !== request.input.accountId
    || (request.input.decision === "approve" ? result.state !== "browser-approved" && result.state !== "terminal-confirmed" : result.state !== "denied"))) return null;
  return good(owned({ state: result.state as PairingTransportBrowserValue["state"], expiresAtMs: result.expiresAtMs,
    accountId: result.accountId, authenticationExpiresAtMs: result.authenticationExpiresAtMs }));
}

// Intrinsic view access avoids caller-overridden byteLength/buffer/iterator/set.
const typedArrayPrototype: object = Object.getPrototypeOf(Uint8Array.prototype);
const viewTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const viewLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const setBytes = Uint8Array.prototype.set;

function copyBytes(value: unknown, cap: number): Uint8Array | null {
  if (viewTag.call(value) !== "Uint8Array") return null;
  const buffer: unknown = viewBuffer.call(value);
  // This intrinsic rejects SharedArrayBuffer. Resizable buffers are also refused.
  bufferLength.call(buffer);
  if (bufferResizable?.call(buffer) === true) return null;
  const length: number = viewLength.call(value);
  if (length < 1 || length > cap) return null;
  const copy = new Uint8Array(length);
  setBytes.call(copy, value as Uint8Array);
  return copy;
}

function ascii(bytes: Uint8Array): string | null {
  let text = "";
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] > 0x7f) return null;
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

/** Only owned null-prototype graphs with bounded scalar fields reach here. */
function encode(value: object, cap: number): Uint8Array | null {
  const text = JSON.stringify(value);
  if (text.length < 1 || text.length > cap) return null;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) return null;
    bytes[index] = code;
  }
  return bytes;
}

export function encodePairingTransportRequest(input: unknown): Result<Uint8Array, "invalid_request"> {
  try {
    const request = requestOf(input);
    const bytes = request === null ? null : encode(request, PAIRING_TRANSPORT_MAX_REQUEST_BYTES);
    return bytes === null ? bad("invalid_request") : good(bytes);
  } catch { return bad("invalid_request"); }
}

export function decodePairingTransportRequest(bytes: Uint8Array): Result<PairingTransportRequest, "invalid_request"> {
  try {
    const copy = copyBytes(bytes, PAIRING_TRANSPORT_MAX_REQUEST_BYTES);
    const text = copy === null ? null : ascii(copy);
    if (text === null) return bad("invalid_request");
    const request = requestOf(JSON.parse(text) as unknown);
    return request === null || JSON.stringify(request) !== text ? bad("invalid_request") : good(request);
  } catch { return bad("invalid_request"); }
}

export function encodePairingTransportResponse(request: unknown, result: unknown): Result<Uint8Array, "invalid_response"> {
  try {
    const checked = requestOf(request);
    if (checked === null) return bad("invalid_response");
    const domain = resultOf(checked, result);
    const bytes = domain === null ? null : encode(owned({ schemaVersion: 1, operation: checked.operation, result: domain }), PAIRING_TRANSPORT_MAX_RESPONSE_BYTES);
    return bytes === null ? bad("invalid_response") : good(bytes);
  } catch { return bad("invalid_response"); }
}

export function decodePairingTransportResponse(bytes: Uint8Array, request: unknown): Result<PairingTransportDomainResult, "invalid_response"> {
  try {
    const checked = requestOf(request);
    if (checked === null) return bad("invalid_response");
    const copy = copyBytes(bytes, PAIRING_TRANSPORT_MAX_RESPONSE_BYTES);
    const text = copy === null ? null : ascii(copy);
    if (text === null) return bad("invalid_response");
    const envelope = snapshot(JSON.parse(text) as unknown, ["schemaVersion", "operation", "result"]);
    if (envelope === null || envelope.schemaVersion !== 1 || envelope.operation !== checked.operation) return bad("invalid_response");
    const domain = resultOf(checked, envelope.result);
    if (domain === null || JSON.stringify(owned({ schemaVersion: 1, operation: checked.operation, result: domain })) !== text) return bad("invalid_response");
    return good(domain);
  } catch { return bad("invalid_response"); }
}
