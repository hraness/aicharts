import {
  decodeTerminalEnrollmentRequest, TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES, TERMINAL_ENROLLMENT_MEDIA, TERMINAL_ENROLLMENT_URL,
  type TerminalEnrollmentRequest,
} from "../../../lib/usage/terminal-enrollment-contract";
import { ownTerminalEnrollmentServerResponse, ownTerminalReservationRead } from "../../../lib/usage/terminal-enrollment-server-contract";
import { pairingHttpBody, PAIRING_HTTP_CAPACITY, PAIRING_HTTP_STAGE_MS, PAIRING_HTTP_WORKER_MS } from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";
import { enrollmentAccountName, enrollmentHex } from "./enrollment-contract";

export interface TerminalEnrollmentHttpLifetime { waitUntil(terminal: Promise<void>): void; }
export interface TerminalEnrollmentHttpEnvironment {
  readonly USAGE_ENROLLMENT_GENERATION: unknown;
  readonly PAIRINGS: Readonly<{ getByName(name: string): Readonly<{
    initialize(input: unknown): Promise<unknown>; poll(input: unknown): Promise<unknown>; confirm(input: unknown): Promise<unknown>;
    readEnrollmentReservation(input: unknown): Promise<unknown>; reserveEnrollment(input: unknown): Promise<unknown>;
  }> }>;
  readonly ACCOUNT_ENROLLMENTS: Readonly<{ getByName(name: string): Readonly<{
    enroll(input: unknown): Promise<unknown>; namespaceForEnrollment(input: unknown): Promise<unknown>;
  }> }>;
}
function response(bytes: Uint8Array<ArrayBuffer>, status = 200): Response {
  return new Response(new Uint8Array(bytes), { status, headers: {
    "content-type": TERMINAL_ENROLLMENT_MEDIA, "content-length": String(bytes.byteLength),
    "cache-control": "private, no-store", "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
  } });
}
function failure(status: 400 | 503): Response {
  const code = status === 400 ? "invalid_request" : "enrollment_unavailable";
  return response(new Uint8Array(new TextEncoder().encode(`{"schemaVersion":1,"error":{"code":"${code}"}}`)), status);
}
function requestLength(request: Request): number | null {
  if (request.url !== TERMINAL_ENROLLMENT_URL || request.method !== "POST"
    || request.headers.get("content-type") !== "application/json" || request.headers.get("accept") !== "application/json"
    || ["content-encoding", "transfer-encoding", "trailer", "cookie", "authorization", "origin"].some(name => request.headers.has(name))) return null;
  const value = request.headers.get("content-length");
  return value !== null && /^[1-9][0-9]{0,3}$/u.test(value) && Number(value) <= TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES ? Number(value) : null;
}
function rpcSnapshot(raw: unknown): { envelope: Record<string, unknown> | null; dispose: (() => void) | null } {
  let dispose: (() => void) | null = null;
  try {
    if (raw === null || typeof raw !== "object") return { envelope: null, dispose };
    const disposal = Object.getOwnPropertyDescriptor(raw, Symbol.dispose);
    if (disposal && "value" in disposal && typeof disposal.value === "function") {
      const method: (...args: unknown[]) => unknown = disposal.value; let disposed = false;
      dispose = () => { if (!disposed) { disposed = true; Reflect.apply(method, raw, []); } };
    }
    if (!dispose || Object.getPrototypeOf(raw) !== Object.prototype) return { envelope: null, dispose };
    const names = Reflect.ownKeys(raw), envelope: Record<string, unknown> = Object.create(null);
    if (names.length !== 3 || !names.includes(Symbol.dispose)) return { envelope: null, dispose };
    for (const name of names) {
      if (name === Symbol.dispose) continue;
      if (name !== "ok" && name !== "value" && name !== "error") return { envelope: null, dispose };
      const descriptor = Object.getOwnPropertyDescriptor(raw, name);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return { envelope: null, dispose };
      envelope[name] = descriptor.value as unknown;
    }
    return (envelope.ok === true && Object.hasOwn(envelope, "value")) || (envelope.ok === false && Object.hasOwn(envelope, "error"))
      ? { envelope, dispose } : { envelope: null, dispose };
  } catch { return { envelope: null, dispose }; }
}

/** Dormant factory: never imported by the default Worker. Proof verification and
 * durable authority remain in the selected DOs; this layer bounds transport work.
 * An outward timeout is uncertain, not cancellation of a durable operation. */
export function createTerminalEnrollmentHttpHandler(dependencies: PairingHttpEffects) {
  const { now, setTimeout, clearTimeout } = dependencies;
  let outstanding = 0;
  return async (request: Request, env: TerminalEnrollmentHttpEnvironment, ctx: TerminalEnrollmentHttpLifetime): Promise<Response> => {
    let startedAt: number, expected: number | null, generation: unknown;
    try { startedAt = now(); } catch { return failure(503); }
    try { expected = requestLength(request); } catch { return failure(400); }
    if (expected === null) return failure(400);
    try { generation = env.USAGE_ENROLLMENT_GENERATION; } catch { return failure(503); }
    if (!enrollmentHex(generation) || request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return failure(503);
    const capturedGeneration = generation;
    let observedAt = startedAt, acceptBeforeMs: number | null = null;
    // The work owner's final guard also samples this fence, closing the small
    // asynchronous gap between the handler body and outward response delivery.
    const sample = () => {
      if (env.USAGE_ENROLLMENT_GENERATION !== capturedGeneration || request.signal.aborted) throw new Error("enrollment_http_closed");
      const value = now();
      if (env.USAGE_ENROLLMENT_GENERATION !== capturedGeneration || request.signal.aborted
        || (acceptBeforeMs !== null && value >= acceptBeforeMs)) throw new Error("enrollment_http_closed");
      observedAt = value; return value;
    };
    outstanding++;
    return pairingHttpWork({ now: sample, setTimeout, clearTimeout }, PAIRING_HTTP_WORKER_MS,
      terminal => { ctx.waitUntil(terminal); }, () => failure(503), () => { outstanding--; }, async work => {
        const observation = () => { work.guard(); return Object.freeze({ nowMs: observedAt, recoveryGeneration: capturedGeneration }); };
        async function rpc<T>(dispatch: () => Promise<unknown>, own: (raw: Record<string, unknown>) => T | null): Promise<T> {
          return await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
            work.guard();
            const pending = dispatch();
            // A box prevents Promise resolution from touching a raw reply's then.
            const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => {
              void pending.then(raw => { resolve({ raw }); }, reject);
            });
            const snapshot = rpcSnapshot(boxed.raw);
            try {
              work.guard();
              if (!snapshot.envelope || !snapshot.dispose) throw new Error("enrollment_http_rpc");
              const value = own(snapshot.envelope);
              if (value === null) throw new Error("enrollment_http_rpc");
              work.guard(); return value;
            } finally { snapshot.dispose?.(); }
          });
        }
        let bytes: Uint8Array;
        try { bytes = await pairingHttpBody(request.body, TERMINAL_ENROLLMENT_MAX_REQUEST_BYTES, expected, work); }
        catch { work.guard(); return failure(400); }
        work.guard();
        const decoded = decodeTerminalEnrollmentRequest(bytes);
        if (!decoded.ok) return failure(400);
        const owned: TerminalEnrollmentRequest = decoded.value;
        const encode = (result: unknown) => {
          const checked = ownTerminalEnrollmentServerResponse(owned, observation(), result);
          if (checked === null) return null;
          acceptBeforeMs = checked.acceptBeforeMs;
          return checked.bytes;
        };
        let encoded: Uint8Array<ArrayBuffer> | null;
        // workerd requires ordinary RPC input records. Only checked primitives
        // cross this boundary; no retained context or reservation is forwarded.
        switch (owned.operation) {
          case "initialize": encoded = await rpc(() => env.PAIRINGS.getByName(owned.input.intentId).initialize(Object.freeze({
            intentId: owned.input.intentId, pollSecret: owned.input.pollSecret, uploadCommitment: owned.input.uploadCommitment,
          })), encode); break;
          case "poll": encoded = await rpc(() => env.PAIRINGS.getByName(owned.input.intentId).poll(Object.freeze({
            intentId: owned.input.intentId, pollSecret: owned.input.pollSecret,
          })), encode); break;
          case "confirm": encoded = await rpc(() => env.PAIRINGS.getByName(owned.input.intentId).confirm(Object.freeze({
            intentId: owned.input.intentId, pollSecret: owned.input.pollSecret, accountId: owned.input.accountId,
          })), encode); break;
          default: {
            const proof = Object.freeze({ intentId: owned.input.intentId, pollSecret: owned.input.pollSecret, uploadSecret: owned.input.uploadSecret });
            const read = await rpc(() => env.PAIRINGS.getByName(proof.intentId).readEnrollmentReservation(proof),
              result => ownTerminalReservationRead(owned, observation(), result));
            if (!read.ok) {
              if (owned.operation === "reserveEnrollment" && read.error === "not_reserved") {
                encoded = await rpc(() => env.PAIRINGS.getByName(proof.intentId).reserveEnrollment(proof), encode);
              } else {
                // Mirror AccountEnrollment's preliminary read mapping only for
                // checked reachable errors. Unknown RPC outcomes never enter it.
                const error = owned.operation !== "reserveEnrollment" && (read.error === "invalid_input" || read.error === "not_initialized")
                  ? "storage_unavailable" : read.error;
                encoded = encode({ ok: false, error });
              }
            } else if (owned.operation === "reserveEnrollment") encoded = encode(read);
            else {
              const reservation = read.value;
              encoded = await rpc(() => {
                const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(reservation.accountId));
                return owned.operation === "enroll" ? stub.enroll(proof) : stub.namespaceForEnrollment(proof);
              }, result => encode(result.ok === true ? { ok: true, value: owned.operation === "enroll"
                ? { reservation, enrollment: result.value } : { reservation, namespace: result.value } } : result));
            }
          }
        }
        work.guard();
        return encoded ? response(encoded) : failure(503);
      }, startedAt);
  };
}
