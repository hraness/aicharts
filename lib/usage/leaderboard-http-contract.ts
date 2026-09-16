/** Public leaderboard wire contract for the worker route. The route is
 * unauthenticated by design and serves only the materialized snapshot; it
 * never scans account objects at request time. */
import { parseLeaderboardSnapshot, type LeaderboardSnapshotV1 } from "./leaderboard-contract";
import { privateDaysSnapshot } from "./private-days-http-contract";

export const LEADERBOARD_HTTP_URL = "https://usage.aicharts.io/v1/leaderboard";
export const LEADERBOARD_HTTP_RESPONSE_BYTES = 49_152;
export type LeaderboardQueryError = "invalid_input" | "unauthorized" | "recovery_required"
  | "clock_regressed" | "storage_invalid" | "storage_unavailable" | "limit";
export type LeaderboardQueryResult =
  | Readonly<{ ok: true; value: LeaderboardSnapshotV1 }>
  | Readonly<{ ok: false; error: LeaderboardQueryError }>;
const errors: readonly string[] = ["invalid_input", "unauthorized", "recovery_required", "clock_regressed",
  "storage_invalid", "storage_unavailable", "limit"];

function owned<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}
export function parseLeaderboardQueryResult(value: unknown): LeaderboardQueryResult | null {
  const failure = privateDaysSnapshot(value, ["ok", "error"]);
  if (failure?.ok === false && typeof failure.error === "string" && errors.includes(failure.error)) {
    return owned({ ok: false, error: failure.error as LeaderboardQueryError });
  }
  const success = privateDaysSnapshot(value, ["ok", "value"]);
  if (success?.ok !== true) return null;
  const snapshot = parseLeaderboardSnapshot(success.value);
  return snapshot === null ? null : owned({ ok: true, value: snapshot });
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

export function encodeLeaderboardHttpResponse(value: unknown): Uint8Array<ArrayBuffer> | null {
  try {
    const result = parseLeaderboardQueryResult(value);
    return result === null ? null : encode(owned({ schemaVersion: 1, result }), LEADERBOARD_HTTP_RESPONSE_BYTES);
  } catch { return null; }
}
export function decodeLeaderboardHttpResponse(value: unknown): LeaderboardQueryResult | null {
  try {
    const text = textOf(value, LEADERBOARD_HTTP_RESPONSE_BYTES); if (text === null) return null;
    const envelope = privateDaysSnapshot(JSON.parse(text), ["schemaVersion", "result"]);
    if (envelope?.schemaVersion !== 1) return null;
    const result = parseLeaderboardQueryResult(envelope.result);
    return result !== null && JSON.stringify(owned({ schemaVersion: 1, result })) === text ? result : null;
  } catch { return null; }
}
/** Fixed public failure replies; they never echo request or upstream detail. */
export function leaderboardHttpFailure(code: "invalid_request" | "leaderboard_unavailable"): Uint8Array<ArrayBuffer> {
  return encode(owned({ schemaVersion: 1, error: owned({ code }) }), 128)!;
}
