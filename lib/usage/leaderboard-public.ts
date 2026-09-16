/** Browser-facing `/api/leaderboard` reply contract. Public and
 * unauthenticated: the ready state carries only the materialized snapshot. */
import { parseLeaderboardSnapshot, LEADERBOARD_MAX_ENTRIES, type LeaderboardSnapshotV1 } from "./leaderboard-contract";
import { privateDaysSnapshot } from "./private-days-http-contract";

export const LEADERBOARD_PUBLIC_PATH = "/api/leaderboard";
export const LEADERBOARD_PUBLIC_URL = "https://aicharts.io/api/leaderboard";
export const LEADERBOARD_PUBLIC_MEDIA = "application/json; charset=utf-8";
export const LEADERBOARD_PUBLIC_MAX_BYTES = 49_152;
export { LEADERBOARD_MAX_ENTRIES };
export type LeaderboardPublicError = "invalid_request" | "method_not_allowed" | "request_rejected" | "unavailable";
export type LeaderboardPublicReply =
  | Readonly<{ schemaVersion: 1; state: "ready"; value: LeaderboardSnapshotV1 }>
  | Readonly<{ schemaVersion: 1; error: Readonly<{ code: LeaderboardPublicError }> }>;

function owned<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}
export function parseLeaderboardPublicReply(value: unknown): LeaderboardPublicReply | null {
  const error = privateDaysSnapshot(value, ["schemaVersion", "error"]);
  if (error?.schemaVersion === 1) {
    const nested = privateDaysSnapshot(error.error, ["code"]);
    if (nested?.code === "invalid_request" || nested?.code === "method_not_allowed"
      || nested?.code === "request_rejected" || nested?.code === "unavailable") {
      return owned({ schemaVersion: 1, error: owned({ code: nested.code as LeaderboardPublicError }) });
    }
  }
  const reply = privateDaysSnapshot(value, ["schemaVersion", "state", "value"]);
  if (reply?.schemaVersion !== 1 || reply.state !== "ready") return null;
  const snapshot = parseLeaderboardSnapshot(reply.value);
  return snapshot === null ? null : owned({ schemaVersion: 1, state: "ready", value: snapshot });
}

const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const length = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const buffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const fixedLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const set = Uint8Array.prototype.set;
export function leaderboardPublicText(value: unknown, cap: number): string | null {
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
export function encodeLeaderboardPublicReply(value: unknown): Uint8Array<ArrayBuffer> | null {
  try { const reply = parseLeaderboardPublicReply(value); return reply === null ? null : encode(owned(reply), LEADERBOARD_PUBLIC_MAX_BYTES); }
  catch { return null; }
}
export function decodeLeaderboardPublicReply(value: unknown): LeaderboardPublicReply | null {
  try {
    const text = leaderboardPublicText(value, LEADERBOARD_PUBLIC_MAX_BYTES); if (text === null) return null;
    return parseLeaderboardPublicReply(JSON.parse(text));
  } catch { return null; }
}
