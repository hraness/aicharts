/** Browser-facing `/api/usage/consent` contract. The POST body is exactly
 * `{consent, publicHandle}`; account identity is never accepted from input. */
import { parseLeaderboardConsentView, type LeaderboardConsentViewV1 } from "./leaderboard-contract";
import { parseUsageConsentDecision, type UsageConsentDecision } from "./consent-contract";
import { privateDaysSnapshot } from "./private-days-http-contract";

export const USAGE_CONSENT_PUBLIC_PATH = "/api/usage/consent";
export const USAGE_CONSENT_PUBLIC_URL = "https://aicharts.io/api/usage/consent";
export const USAGE_CONSENT_PUBLIC_MEDIA = "application/json; charset=utf-8";
export const USAGE_CONSENT_PUBLIC_REQUEST_BYTES = 128;
export const USAGE_CONSENT_PUBLIC_MAX_BYTES = 1_024;
export type UsageConsentPublicError = "invalid_request" | "authentication_required" | "request_rejected"
  | "method_not_allowed" | "unavailable" | "handle_unavailable" | "publishing_full";
export type UsageConsentPublicReply =
  | Readonly<{ schemaVersion: 1; state: "ready"; value: LeaderboardConsentViewV1 }>
  | Readonly<{ schemaVersion: 1; state: "not_enrolled" }>
  | Readonly<{ schemaVersion: 1; error: Readonly<{ code: UsageConsentPublicError }> }>;

function owned<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}
export function parseUsageConsentPublicReply(value: unknown): UsageConsentPublicReply | null {
  const error = privateDaysSnapshot(value, ["schemaVersion", "error"]);
  if (error?.schemaVersion === 1) {
    const nested = privateDaysSnapshot(error.error, ["code"]);
    if (nested?.code === "invalid_request" || nested?.code === "authentication_required"
      || nested?.code === "request_rejected" || nested?.code === "method_not_allowed"
      || nested?.code === "unavailable" || nested?.code === "handle_unavailable" || nested?.code === "publishing_full") {
      return owned({ schemaVersion: 1, error: owned({ code: nested.code as UsageConsentPublicError }) });
    }
  }
  const enrolled = privateDaysSnapshot(value, ["schemaVersion", "state", "value"]);
  if (enrolled?.schemaVersion === 1 && enrolled.state === "ready") {
    const view = parseLeaderboardConsentView(enrolled.value);
    if (view !== null) return owned({ schemaVersion: 1, state: "ready", value: view });
  }
  const declined = privateDaysSnapshot(value, ["schemaVersion", "state"]);
  if (declined?.schemaVersion === 1 && declined.state === "not_enrolled") {
    return owned({ schemaVersion: 1, state: "not_enrolled" });
  }
  return null;
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

/** Canonical browser decision body; `publicHandle` is `null` on withdrawal. */
export function encodeUsageConsentDecision(value: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    const decision = parseUsageConsentDecision(value);
    return decision === null ? null : encode(owned(decision), USAGE_CONSENT_PUBLIC_REQUEST_BYTES);
  } catch { return null; }
}
export function decodeUsageConsentDecision(value: unknown): UsageConsentDecision | null {
  try {
    const text = textOf(value, USAGE_CONSENT_PUBLIC_REQUEST_BYTES); if (text === null) return null;
    const decision = parseUsageConsentDecision(JSON.parse(text));
    return decision !== null && JSON.stringify(owned(decision)) === text ? decision : null;
  } catch { return null; }
}
export function encodeUsageConsentPublicReply(value: unknown): Uint8Array<ArrayBuffer> | null {
  try { const reply = parseUsageConsentPublicReply(value); return reply === null ? null : encode(owned(reply), USAGE_CONSENT_PUBLIC_MAX_BYTES); }
  catch { return null; }
}
export function decodeUsageConsentPublicReply(value: unknown): UsageConsentPublicReply | null {
  try {
    const text = textOf(value, USAGE_CONSENT_PUBLIC_MAX_BYTES); if (text === null) return null;
    return parseUsageConsentPublicReply(JSON.parse(text));
  } catch { return null; }
}
