/** Internal consent wire contract for the worker route. Canonical ASCII JSON,
 * exact-key envelopes, bounded bodies; fixed failure replies never reflect the
 * submitted decision. */
import { parseUsageConsentRequest, parseUsageConsentResult, USAGE_CONSENT_REQUEST_BYTES,
  USAGE_CONSENT_RESPONSE_BYTES, type UsageConsentRequestV1, type UsageConsentResult } from "./consent-contract";
import { privateDaysSnapshot } from "./private-days-http-contract";

export const USAGE_CONSENT_HTTP_URL = "https://usage.aicharts.io/internal/usage/consent";
export const USAGE_CONSENT_HTTP_REQUEST_BYTES = USAGE_CONSENT_REQUEST_BYTES;
export const USAGE_CONSENT_HTTP_RESPONSE_BYTES = USAGE_CONSENT_RESPONSE_BYTES;
export type UsageConsentQueryResult = UsageConsentResult;

function owned<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
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

export function encodeUsageConsentHttpRequest(value: unknown): Uint8Array<ArrayBuffer> | null {
  try { const request = parseUsageConsentRequest(value); return request === null ? null : encode(owned(request), USAGE_CONSENT_HTTP_REQUEST_BYTES); }
  catch { return null; }
}
export function decodeUsageConsentHttpRequest(value: unknown): UsageConsentRequestV1 | null {
  try {
    const text = textOf(value, USAGE_CONSENT_HTTP_REQUEST_BYTES); if (text === null) return null;
    const request = parseUsageConsentRequest(JSON.parse(text));
    return request !== null && JSON.stringify(owned(request)) === text ? request : null;
  } catch { return null; }
}
export function encodeUsageConsentHttpResponse(value: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    const result = parseUsageConsentResult(value);
    return result === null ? null : encode(owned({ schemaVersion: 1, result }), USAGE_CONSENT_HTTP_RESPONSE_BYTES);
  } catch { return null; }
}
export function decodeUsageConsentHttpResponse(value: unknown): UsageConsentQueryResult | null {
  try {
    const text = textOf(value, USAGE_CONSENT_HTTP_RESPONSE_BYTES); if (text === null) return null;
    const envelope = privateDaysSnapshot(JSON.parse(text), ["schemaVersion", "result"]);
    if (envelope?.schemaVersion !== 1) return null;
    const result = parseUsageConsentResult(envelope.result);
    return result !== null && JSON.stringify(owned({ schemaVersion: 1, result })) === text ? result : null;
  } catch { return null; }
}
