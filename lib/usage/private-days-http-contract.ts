import { parsePrivateDaysRequest, parsePrivateDaysValue, PRIVATE_DAYS_MAX_RESPONSE_BYTES, type PrivateDaysRequestV1, type PrivateDaysV1 } from "./private-days-contract";

/** Planned internal target; no route or deployment is installed by this module. */
export const PRIVATE_DAYS_HTTP_URL = "https://usage.aicharts.io/internal/usage/days";
export const PRIVATE_DAYS_HTTP_REQUEST_BYTES = 256;
export const PRIVATE_DAYS_HTTP_RESPONSE_BYTES = PRIVATE_DAYS_MAX_RESPONSE_BYTES;
export type PrivateDaysRange = Readonly<{ firstUtcDay: number; dayCount: number }>;
export type PrivateDaysQueryError = "invalid_input" | "unauthorized" | "not_enrolled" | "expired"
  | "recovery_required" | "clock_regressed" | "storage_invalid" | "storage_unavailable";
export type PrivateDaysQueryResult = Readonly<{ ok: true; value: PrivateDaysV1 }> | Readonly<{ ok: false; error: PrivateDaysQueryError }>;
const errors: readonly string[] = ["invalid_input", "unauthorized", "not_enrolled", "expired", "recovery_required", "clock_regressed", "storage_invalid", "storage_unavailable"];

/** No getters; owned records serialize without inherited toJSON behavior. */
function owned<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}
export function privateDaysSnapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      result[key] = descriptor.value as unknown;
    }
    return result;
  } catch { return null; }
}

export function parsePrivateDaysRange(value: unknown): PrivateDaysRange | null {
  const range = privateDaysSnapshot(value, ["firstUtcDay", "dayCount"]);
  if (range === null) return null;
  const request = parsePrivateDaysRequest({ schemaVersion: 1, accountId: `acct_${"0".repeat(32)}`, sessionExpiresAtMs: 0, ...range });
  return request === null ? null : owned({ firstUtcDay: request.firstUtcDay, dayCount: request.dayCount });
}

function resultOf(request: PrivateDaysRequestV1, value: unknown): PrivateDaysQueryResult | null {
  const failure = privateDaysSnapshot(value, ["ok", "error"]);
  if (failure?.ok === false && typeof failure.error === "string" && errors.includes(failure.error)) {
    return owned({ ok: false, error: failure.error as PrivateDaysQueryError });
  }
  const success = privateDaysSnapshot(value, ["ok", "value"]);
  if (success?.ok !== true) return null;
  const checked = parsePrivateDaysValue(request, success.value);
  return checked === null ? null : owned({ ok: true, value: checked });
}

/** Serialization owns every level, including the array; returned DTO arrays stay ordinary. */
function responseProjection(result: PrivateDaysQueryResult): object {
  if (!result.ok) return owned({ schemaVersion: 1, result });
  const value = result.value;
  const days = value.days.map(day => owned({ utcDay: day.utcDay, codex: owned(day.codex), claudeCode: owned(day.claudeCode), devin: owned(day.devin) }));
  Object.setPrototypeOf(days, null);
  const projection = owned({ schemaVersion: 1, measurementProfile: value.measurementProfile, coverage: value.coverage,
    journalRevision: value.journalRevision, journalCommittedAtMs: value.journalCommittedAtMs,
    firstUtcDay: value.firstUtcDay, days: Object.freeze(days) });
  return owned({ schemaVersion: 1, result: owned({ ok: true, value: projection }) });
}

const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const length = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const buffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const fixedLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const set = Uint8Array.prototype.set;
function textOf(value: unknown, cap: number): string | null {
  if (tag.call(value) !== "Uint8Array") return null;
  const backing: unknown = buffer.call(value); fixedLength.call(backing);
  if (resizable?.call(backing) === true) return null;
  const size: number = length.call(value);
  if (size < 1 || size > cap) return null;
  const bytes = new Uint8Array(size); set.call(bytes, value as Uint8Array);
  let text = "";
  for (const byte of bytes) { if (byte > 127) return null; text += String.fromCharCode(byte); }
  return text;
}
function encode(value: object, cap: number): Uint8Array<ArrayBuffer> | null {
  const text = JSON.stringify(value);
  if (text.length < 1 || text.length > cap) return null;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index); if (code > 127) return null; bytes[index] = code;
  }
  return bytes;
}
export function encodePrivateDaysHttpRequest(value: unknown): Uint8Array<ArrayBuffer> | null {
  try { const request = parsePrivateDaysRequest(value); return request === null ? null : encode(owned(request), PRIVATE_DAYS_HTTP_REQUEST_BYTES); }
  catch { return null; }
}
export function decodePrivateDaysHttpRequest(value: unknown): PrivateDaysRequestV1 | null {
  try {
    const text = textOf(value, PRIVATE_DAYS_HTTP_REQUEST_BYTES); if (text === null) return null;
    const request = parsePrivateDaysRequest(JSON.parse(text));
    return request !== null && JSON.stringify(owned(request)) === text ? request : null;
  } catch { return null; }
}
export function encodePrivateDaysHttpResponse(request: unknown, value: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    const checked = parsePrivateDaysRequest(request); if (checked === null) return null;
    const result = resultOf(checked, value);
    return result === null ? null : encode(responseProjection(result), PRIVATE_DAYS_HTTP_RESPONSE_BYTES);
  } catch { return null; }
}
export function decodePrivateDaysHttpResponse(value: unknown, request: unknown): PrivateDaysQueryResult | null {
  try {
    const checked = parsePrivateDaysRequest(request), text = textOf(value, PRIVATE_DAYS_HTTP_RESPONSE_BYTES);
    if (checked === null || text === null) return null;
    const envelope = privateDaysSnapshot(JSON.parse(text), ["schemaVersion", "result"]);
    if (envelope?.schemaVersion !== 1) return null;
    const result = resultOf(checked, envelope.result);
    return result !== null && JSON.stringify(responseProjection(result)) === text ? result : null;
  } catch { return null; }
}

/** The 16 KiB response cap requires five decimal digits, unlike pairing's cap. */
export function privateDaysHttpLength(headers: Headers, cap: number): number | null {
  const text = headers.get("content-length");
  if (text === null) return null;
  if (text.length > 5 || !/^[1-9][0-9]*$/u.test(text) || Number(text) > cap) throw new Error("private_days_framing");
  return Number(text);
}
