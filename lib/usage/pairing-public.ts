/** Browser-safe pairing projections. None of these values authenticates a caller. */
export const PAIRING_PAGE_PATH = "/usage/pairing";
export const PAIRING_PUBLIC_URL = "https://aicharts.io/api/usage/pairing";
export const PAIRING_START_URL = `${PAIRING_PUBLIC_URL}/start`;
export const PAIRING_PUBLIC_MEDIA = "application/json; charset=utf-8";
export const PAIRING_FORM_MEDIA = "application/x-www-form-urlencoded";
export const PAIRING_PUBLIC_MAX_BYTES = 512;
export const PAIRING_FORM_BYTES = 73;
export type PairingDecision = "approve" | "deny";
export type PairingApproval = Readonly<{
  schemaVersion: 1;
  state: "pending" | "browser-approved" | "terminal-confirmed" | "denied";
  accountId: string;
  expiresAtMs: number;
  csrfToken: string;
}>;
export type PairingPublicError = "USAGE_PAIRING_AUTH_REJECTED" | "USAGE_PAIRING_AUTH_UNAVAILABLE" | "USAGE_PAIRING_AUTH_FAILED";
export type PairingPublicReply = PairingApproval | Readonly<{ error: Readonly<{ code: PairingPublicError }>; schemaVersion: 1 }>;

export function pairingPublicToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
}
export function parsePairingFragment(value: unknown): string | null {
  if (typeof value !== "string" || value.length !== 74 || !value.startsWith("#intentId=")) return null;
  const intent = value.slice(10);
  return pairingPublicToken(intent) ? intent : null;
}
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const owned: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
      owned[key] = descriptor.value as unknown;
    }
    return owned;
  } catch { return null; }
}
export function parsePairingPublicReply(value: unknown): PairingPublicReply | null {
  const error = fields(value, ["error", "schemaVersion"]);
  if (error?.schemaVersion === 1) {
    const nested = fields(error.error, ["code"]);
    if (nested?.code === "USAGE_PAIRING_AUTH_REJECTED" || nested?.code === "USAGE_PAIRING_AUTH_UNAVAILABLE" || nested?.code === "USAGE_PAIRING_AUTH_FAILED") {
      return Object.freeze({ error: Object.freeze({ code: nested.code }), schemaVersion: 1 });
    }
  }
  const reply = fields(value, ["schemaVersion", "state", "accountId", "expiresAtMs", "csrfToken"]);
  if (reply?.schemaVersion !== 1 || (reply.state !== "pending" && reply.state !== "browser-approved" && reply.state !== "terminal-confirmed" && reply.state !== "denied")
    || typeof reply.accountId !== "string" || !/^acct_[0-9a-f]{32}$/u.test(reply.accountId)
    || typeof reply.expiresAtMs !== "number" || !Number.isSafeInteger(reply.expiresAtMs) || reply.expiresAtMs <= 0
    || reply.expiresAtMs > 8_640_000_000_000_000 || !pairingPublicToken(reply.csrfToken)) return null;
  return Object.freeze({ schemaVersion: 1, state: reply.state, accountId: reply.accountId, expiresAtMs: reply.expiresAtMs, csrfToken: reply.csrfToken });
}

/** Fixed primitive grammar avoids inherited JSON hooks at every level. */
export function encodePairingPublicReply(value: unknown): Uint8Array<ArrayBuffer> | null {
  const reply = parsePairingPublicReply(value);
  if (reply === null) return null;
  return new TextEncoder().encode("error" in reply
    ? `{"error":{"code":"${reply.error.code}"},"schemaVersion":1}`
    : `{"schemaVersion":1,"state":"${reply.state}","accountId":"${reply.accountId}","expiresAtMs":${reply.expiresAtMs},"csrfToken":"${reply.csrfToken}"}`);
}
const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const lengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const fixedLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const set = Uint8Array.prototype.set;
function text(bytes: Uint8Array, cap: number): string | null {
  try {
    if (tag.call(bytes) !== "Uint8Array") return null;
    const size = lengthOf.call(bytes) as number, buffer = bufferOf.call(bytes) as ArrayBuffer;
    fixedLength.call(buffer);
    if (resizable?.call(buffer) === true || size < 1 || size > cap) return null;
    const owned = new Uint8Array(size); set.call(owned, bytes);
    // The entire public grammar is ASCII. This also rejects BOM and UTF-8 aliases.
    for (const byte of owned) if (byte > 127) return null;
    return new TextDecoder().decode(owned);
  } catch { return null; }
}
export function parsePairingStartForm(bytes: Uint8Array): string | null {
  const body = text(bytes, PAIRING_FORM_BYTES);
  if (body === null || body.length !== PAIRING_FORM_BYTES || !body.startsWith("intentId=")) return null;
  const intent = body.slice(9);
  return pairingPublicToken(intent) ? intent : null;
}
export function decodePairingPublicReply(bytes: Uint8Array, status: number): PairingPublicReply | null {
  try {
    const body = text(bytes, PAIRING_PUBLIC_MAX_BYTES);
    if (body === null) return null;
    const value: unknown = JSON.parse(body), reply = parsePairingPublicReply(value);
    if (reply === null) return null;
    const canonical = encodePairingPublicReply(reply);
    if (canonical === null || new TextDecoder().decode(canonical) !== body) return null;
    if (!("error" in reply)) return status === 200 ? reply : null;
    return reply.error.code === "USAGE_PAIRING_AUTH_REJECTED"
      ? [400, 403, 405].includes(status) ? reply : null
      : status === 503 ? reply : null;
  } catch { return null; }
}
export function encodePairingDecision(decision: PairingDecision, csrfToken: string): string | null {
  return (decision === "approve" || decision === "deny") && pairingPublicToken(csrfToken)
    ? `{"decision":"${decision}","csrfToken":"${csrfToken}"}` : null;
}
export function parsePairingDecision(bytes: Uint8Array): Readonly<{ decision: PairingDecision; csrfToken: string }> | null {
  try {
    const body = text(bytes, PAIRING_PUBLIC_MAX_BYTES);
    if (body === null) return null;
    const parsed = fields(JSON.parse(body) as unknown, ["decision", "csrfToken"]);
    if (parsed === null || (parsed.decision !== "approve" && parsed.decision !== "deny") || !pairingPublicToken(parsed.csrfToken)
      || encodePairingDecision(parsed.decision, parsed.csrfToken) !== body) return null;
    return Object.freeze({ decision: parsed.decision, csrfToken: parsed.csrfToken });
  } catch { return null; }
}
