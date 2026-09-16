import { enrollmentAccount, enrollmentHex, enrollmentSnapshot, enrollmentTime } from "./enrollment-contract";

/** Operator restore-fence control contract. Fixed private URL over a service
 * binding; never a public route and never a generic RPC/lease proxy. The only
 * admitted operations are the operator-owned `read`, `close` and `publish`. */
export const FENCE_CONTROL_URL = "https://aicharts-usage-fence-control.invalid/v1/operation";
export const FENCE_CONTROL_REQUEST_BYTES = 1_024;
export const FENCE_CONTROL_REPLY_BYTES = 8_192;
export const FENCE_CONTROL_OPERATIONS = ["read", "close", "publish"] as const;
export type FenceControlOperation = typeof FENCE_CONTROL_OPERATIONS[number];

export const fenceControlAccount = enrollmentAccount;
export const fenceControlHex = enrollmentHex;
export const fenceControlTime = enrollmentTime;
export const fenceControlFields = enrollmentSnapshot;
/** Restore epochs are bounded ordinals; a bounded input can never ask the
 * fence to compare beyond its own monotonic range. */
export const fenceControlEpoch = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= 4_294_967_295;
const fenceControlInFlight = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= 64;

/** Non-secret authority view. The record is the fence's own account/generation
 * DTO; it carries no credential, namespace key or object content. */
export type FenceControlRecord = Readonly<{
  schemaVersion: 1; accountId: string; generation: string; epoch: number;
  workerVersion: string; phase: "open" | "closed"; established: boolean; updatedAtMs: number;
}>;
export type FenceControlView = Readonly<{ record: FenceControlRecord | null; inFlight: number; observedAtMs: number }>;
export type FenceControlRequest =
  Readonly<{ schemaVersion: 1; operation: "read"; accountId: string; generation: string }>
  | Readonly<{ schemaVersion: 1; operation: "close" | "publish"; accountId: string; generation: string; epoch: number; workerVersion: string }>;
export const FENCE_CONTROL_ERRORS = [
  "invalid_request", "method_not_allowed", "control_unavailable",
  "invalid_input", "unauthorized", "not_found", "recovery_required", "conflict",
  "expired", "storage_invalid", "storage_unavailable", "clock_regressed", "limit",
] as const;
export type FenceControlError = typeof FENCE_CONTROL_ERRORS[number];
export type FenceControlReply = Readonly<{ schemaVersion: 1; operation: FenceControlOperation; ok: true; value: FenceControlView }>
  | Readonly<{ schemaVersion: 1; ok: false; error: FenceControlError }>;
export const FENCE_CONTROL_ERROR_STATUS: Readonly<Record<FenceControlError, number>> = Object.freeze({
  invalid_request: 400, method_not_allowed: 405, control_unavailable: 503,
  invalid_input: 400, unauthorized: 403, not_found: 404, recovery_required: 409, conflict: 409,
  expired: 410, storage_invalid: 503, storage_unavailable: 503, clock_regressed: 503, limit: 429,
});

export function parseFenceControlRecord(value: unknown): FenceControlRecord | null {
  const record = enrollmentSnapshot(value, ["schemaVersion", "accountId", "generation", "epoch", "workerVersion", "phase", "established", "updatedAtMs"]);
  return record !== null && record.schemaVersion === 1 && fenceControlAccount(record.accountId) && fenceControlHex(record.generation)
    && fenceControlEpoch(record.epoch) && fenceControlHex(record.workerVersion) && (record.phase === "open" || record.phase === "closed")
    && (record.established === true || record.established === false) && fenceControlTime(record.updatedAtMs)
    ? Object.freeze({ schemaVersion: 1, accountId: record.accountId, generation: record.generation, epoch: record.epoch,
      workerVersion: record.workerVersion, phase: record.phase, established: record.established, updatedAtMs: record.updatedAtMs }) : null;
}

export function parseFenceControlView(value: unknown): FenceControlView | null {
  const view = enrollmentSnapshot(value, ["record", "inFlight", "observedAtMs"]);
  if (view === null || !fenceControlInFlight(view.inFlight) || !fenceControlTime(view.observedAtMs)) return null;
  if (view.record === null) return Object.freeze({ record: null, inFlight: view.inFlight, observedAtMs: view.observedAtMs });
  const record = parseFenceControlRecord(view.record);
  return record === null ? null : Object.freeze({ record, inFlight: view.inFlight, observedAtMs: view.observedAtMs });
}

export function parseFenceControlRequest(value: unknown): FenceControlRequest | null {
  try {
    const operation = value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "operation") : undefined;
    if (!operation || !("value" in operation) || !(FENCE_CONTROL_OPERATIONS as readonly string[]).includes(String(operation.value))) return null;
    const name = operation.value as FenceControlOperation;
    const input = enrollmentSnapshot(value, name === "read"
      ? ["schemaVersion", "operation", "accountId", "generation"]
      : ["schemaVersion", "operation", "accountId", "generation", "epoch", "workerVersion"]);
    if (input === null || input.schemaVersion !== 1 || !fenceControlAccount(input.accountId) || !fenceControlHex(input.generation)) return null;
    if (name === "read") return Object.freeze({ schemaVersion: 1, operation: name, accountId: input.accountId, generation: input.generation });
    return fenceControlEpoch(input.epoch) && fenceControlHex(input.workerVersion)
      ? Object.freeze({ schemaVersion: 1, operation: name, accountId: input.accountId, generation: input.generation,
        epoch: input.epoch, workerVersion: input.workerVersion })
      : null;
  } catch { return null; }
}

export function parseFenceControlReply(request: FenceControlRequest, value: unknown): FenceControlReply | null {
  try {
    const failure = enrollmentSnapshot(value, ["schemaVersion", "ok", "error"]);
    if (failure?.schemaVersion === 1 && failure.ok === false && typeof failure.error === "string"
      && (FENCE_CONTROL_ERRORS as readonly string[]).includes(failure.error)) {
      return Object.freeze({ schemaVersion: 1, ok: false, error: failure.error as FenceControlError });
    }
    const input = enrollmentSnapshot(value, ["schemaVersion", "operation", "ok", "value"]);
    if (input === null || input.schemaVersion !== 1 || input.operation !== request.operation || input.ok !== true) return null;
    const view = parseFenceControlView(input.value);
    if (view === null) return null;
    const reply = { schemaVersion: 1 as const, operation: request.operation, ok: true as const, value: view };
    return encodeFenceControlJson(reply) ? Object.freeze(reply) : null;
  } catch { return null; }
}

/** Serialize only owned, bounded JSON trees, including null-prototype objects. */
export function encodeFenceControlJson(value: unknown, limit = FENCE_CONTROL_REPLY_BYTES): Uint8Array<ArrayBuffer> | null {
  try {
    let nodes = 0;
    const copy = (input: unknown, depth: number): unknown => {
      if (++nodes > 256 || depth > 8) throw new Error("invalid_fence_control_json");
      if (input === null || typeof input === "boolean" || (typeof input === "number" && fenceControlTime(input))
        || (typeof input === "string" && input.length <= limit)) return input;
      // No wire DTO carries an array; the encoder models that out of existence.
      if (typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_fence_control_json");
      const fields = Object.getOwnPropertyDescriptors(input);
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== null && prototype !== Object.prototype) throw new Error("invalid_fence_control_json");
      const output = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(fields)) {
        if (typeof key !== "string" || key === "toJSON" || !("value" in fields[key]) || !fields[key].enumerable) throw new Error("invalid_fence_control_json");
        Object.defineProperty(output, key, { value: copy(fields[key].value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return output;
    };
    const bytes = Uint8Array.from(new TextEncoder().encode(JSON.stringify(copy(value, 0))));
    return bytes.length <= limit ? bytes : null;
  } catch { return null; }
}
