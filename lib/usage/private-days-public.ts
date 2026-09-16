import { parsePrivateDaysValue, PRIVATE_DAYS_MAX_RESPONSE_BYTES, type PrivateDaysV1 } from "./private-days-contract";
import { parsePrivateDaysRange, privateDaysSnapshot, type PrivateDaysRange } from "./private-days-http-contract";

export type { PrivateDaysRange } from "./private-days-http-contract";

export const PRIVATE_DAYS_PUBLIC_PATH = "/api/usage/days";
export const PRIVATE_DAYS_PUBLIC_URL = `https://aicharts.io${PRIVATE_DAYS_PUBLIC_PATH}`;
export const PRIVATE_DAYS_PUBLIC_MEDIA = "application/json; charset=utf-8";
export const PRIVATE_DAYS_PUBLIC_MAX_BYTES = PRIVATE_DAYS_MAX_RESPONSE_BYTES;
export type PrivateDaysPublicError = "invalid_request" | "authentication_required" | "request_rejected" | "method_not_allowed" | "unavailable";
export type PrivateDaysPublicReply = Readonly<{ schemaVersion: 1; state: "ready"; value: PrivateDaysV1 }>
  | Readonly<{ schemaVersion: 1; state: "not_enrolled" }>
  | Readonly<{ schemaVersion: 1; error: Readonly<{ code: PrivateDaysPublicError }> }>;
const status = Object.freeze({ invalid_request: 400, authentication_required: 401, request_rejected: 403, method_not_allowed: 405, unavailable: 503 } as const);
export function privateDaysPublicStatus(body: PrivateDaysPublicReply): 200 | 400 | 401 | 403 | 405 | 503 {
  return "error" in body ? status[body.error.code] : 200;
}
function owned<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

/** Canonical UTC day integers preserve the existing policy range exactly. */
export function parsePrivateDaysPublicSearch(search: unknown): PrivateDaysRange | null {
  if (typeof search !== "string" || search.length > 45) return null;
  const match = /^\?firstUtcDay=(0|[1-9][0-9]{0,8})&dayCount=([1-9]|[12][0-9]|3[01])$/u.exec(search);
  return match === null || match[0] !== search ? null : parsePrivateDaysRange({ firstUtcDay: Number(match[1]), dayCount: Number(match[2]) });
}
export function privateDaysPublicPath(range: unknown): string | null {
  const checked = parsePrivateDaysRange(range);
  return checked === null ? null : `${PRIVATE_DAYS_PUBLIC_PATH}?firstUtcDay=${checked.firstUtcDay}&dayCount=${checked.dayCount}`;
}

export function parsePrivateDaysPublicReply(value: unknown, range?: unknown): PrivateDaysPublicReply | null {
  const error = privateDaysSnapshot(value, ["schemaVersion", "error"]);
  if (error?.schemaVersion === 1) {
    const detail = privateDaysSnapshot(error.error, ["code"]);
    if (typeof detail?.code !== "string" || !Object.hasOwn(status, detail.code)) return null;
    return owned({ schemaVersion: 1, error: owned({ code: detail.code as PrivateDaysPublicError }) });
  }
  const absent = privateDaysSnapshot(value, ["schemaVersion", "state"]);
  if (absent?.schemaVersion === 1 && absent.state === "not_enrolled") return owned({ schemaVersion: 1, state: "not_enrolled" });
  const ready = privateDaysSnapshot(value, ["schemaVersion", "state", "value"]), query = parsePrivateDaysRange(range);
  if (ready?.schemaVersion !== 1 || ready.state !== "ready" || query === null) return null;
  // Only syntax/range correlation is checked here. These fixed account/expiry
  // placeholders establish no authority and are never sent to a query service.
  const checked = parsePrivateDaysValue({ schemaVersion: 1, accountId: `acct_${"0".repeat(32)}`, sessionExpiresAtMs: 0,
    firstUtcDay: query.firstUtcDay, dayCount: query.dayCount }, ready.value);
  return checked === null ? null : owned({ schemaVersion: 1, state: "ready", value: checked });
}
function projection(body: PrivateDaysPublicReply): object {
  if (!("value" in body)) return body;
  const value = body.value;
  const days = value.days.map(day => owned({ utcDay: day.utcDay, codex: owned(day.codex), claudeCode: owned(day.claudeCode), devin: owned(day.devin) }));
  Object.setPrototypeOf(days, null);
  return owned({ schemaVersion: 1, state: "ready", value: owned({ schemaVersion: 1,
    measurementProfile: value.measurementProfile, coverage: value.coverage, journalRevision: value.journalRevision,
    journalCommittedAtMs: value.journalCommittedAtMs, firstUtcDay: value.firstUtcDay, days: Object.freeze(days) }) });
}
export function encodePrivateDaysPublicResponse(value: unknown, range?: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    const checked = parsePrivateDaysPublicReply(value, range);
    if (checked === null) return null;
    const text = JSON.stringify(projection(checked));
    if (text.length > PRIVATE_DAYS_PUBLIC_MAX_BYTES) return null;
    // Every accepted field is bounded ASCII, so UTF-8 length equals text length.
    return new TextEncoder().encode(text);
  } catch { return null; }
}

const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const length = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const backing = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const copyBytes = Uint8Array.prototype.set;
export function decodePrivateDaysPublicResponse(value: unknown, range: unknown): PrivateDaysPublicReply | null {
  try {
    if (tag.call(value) !== "Uint8Array") return null;
    const buffer: unknown = backing.call(value); bufferLength.call(buffer);
    if (resizable?.call(buffer) === true) return null;
    const size: number = length.call(value);
    if (size < 1 || size > PRIVATE_DAYS_PUBLIC_MAX_BYTES) return null;
    const copy = new Uint8Array(size); copyBytes.call(copy, value as Uint8Array);
    let text = "";
    for (const byte of copy) { if (byte > 127) return null; text += String.fromCharCode(byte); }
    const checked = parsePrivateDaysPublicReply(JSON.parse(text), range);
    return checked !== null && JSON.stringify(projection(checked)) === text ? checked : null;
  } catch { return null; }
}
