import { MAX_ADMISSION_BATCH_BYTES } from "../../../lib/usage/admission";
import { pairingHttpBody } from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";
import { batchAccount, ownedAdmissionBatch, ownedAdmissionJournal } from "./admission-policy";
import { enrollmentAccountName, enrollmentHex } from "./enrollment-contract";

export const ADMISSION_HTTP_URL = "https://usage.aicharts.io/v1/batches";
export const ADMISSION_HTTP_BATCH_MEDIA = "application/vnd.aicharts.usage-batch-v1";
export const ADMISSION_HTTP_JOURNAL_MEDIA = "application/vnd.aicharts.usage-journal-v1";
export const ADMISSION_HTTP_CAPACITY = 8;
export const ADMISSION_HTTP_WORKER_MS = 15_000;
export const ADMISSION_HTTP_RPC_MS = 10_000;
export interface AdmissionHttpLifetime { waitUntil(terminal: Promise<void>): void; }
export interface AdmissionHttpEnvironment {
  readonly ACCOUNT_ENROLLMENTS: Readonly<{
    getByName(name: string): Readonly<{ admitBatch(input: unknown): Promise<unknown> }>;
  }>;
}

type FailureStatus = 400 | 401 | 409 | 503;
const codes = Object.freeze({ 400: "invalid_request", 401: "unauthorized_device", 409: "upload_blocked", 503: "upload_unavailable" });
function response(body: Uint8Array | string, status: number, media: string): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers: {
    "content-type": media, "cache-control": "private, no-store", "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
  } });
}
function failure(status: FailureStatus): Response {
  return response(`{"schemaVersion":1,"error":{"code":"${codes[status]}"}}`, status, "application/json; charset=utf-8");
}
function contentLength(headers: Headers): number | null {
  const text = headers.get("content-length");
  if (text === null) return null;
  // Admission batches need five digits; pairing's four-digit limit is unrelated.
  if (!/^[1-9][0-9]{0,4}$/u.test(text) || Number(text) > MAX_ADMISSION_BATCH_BYTES) throw new Error("admission_http_framing");
  return Number(text);
}
function rpcSnapshot(raw: unknown): { envelope: Record<string, unknown> | null; dispose: (() => void) | null } {
  let dispose: (() => void) | null = null;
  try {
    if (raw === null || typeof raw !== "object") return { envelope: null, dispose };
    const disposal = Object.getOwnPropertyDescriptor(raw, Symbol.dispose);
    if (disposal !== undefined && "value" in disposal && typeof disposal.value === "function") {
      const method: (...args: unknown[]) => unknown = disposal.value;
      dispose = () => { Reflect.apply(method, raw, []); };
    }
    if (dispose === null || Object.getPrototypeOf(raw) !== Object.prototype) return { envelope: null, dispose };
    const names = Reflect.ownKeys(raw);
    if (names.length !== 3 || !names.includes(Symbol.dispose)) return { envelope: null, dispose };
    const envelope: Record<string, unknown> = Object.create(null);
    for (const name of names) {
      if (name === Symbol.dispose) continue;
      if (name !== "ok" && name !== "value" && name !== "error") return { envelope: null, dispose };
      const descriptor = Object.getOwnPropertyDescriptor(raw, name);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return { envelope: null, dispose };
      envelope[name] = descriptor.value as unknown;
    }
    if (envelope.ok === true && Object.hasOwn(envelope, "value")) return { envelope, dispose };
    if (envelope.ok === false && Object.hasOwn(envelope, "error")) return { envelope, dispose };
    return { envelope: null, dispose };
  } catch { return { envelope: null, dispose }; }
}
function domainFailure(error: unknown): Response {
  switch (error) {
    case "invalid_input": return failure(400);
    case "unauthorized": case "not_enrolled": return failure(401);
    case "revoked": case "conflict": case "limit": case "profile_superseded": return failure(409);
    default: return failure(503);
  }
}

/** Dormant, fixed admission route. Syntax is checked before namespace access;
 * credential proof remains inside the DO and may follow durable observation.
 * An outward timeout is uncertain, not cancellation of a committed decision.
 * Per-isolate custody bounds are not fleet abuse/capacity qualification.
 * The production index routes to this factory only behind explicit activation
 * fences; its default state remains the fixed private 503. */
export function createAdmissionHttpHandler(dependencies: PairingHttpEffects) {
  const { now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;
  return async (request: Request, env: AdmissionHttpEnvironment, ctx: AdmissionHttpLifetime): Promise<Response> => {
    let startedAt: number, expected: number | null, secret: string;
    try { startedAt = now(); } catch { return failure(503); }
    try {
      if (request.url !== ADMISSION_HTTP_URL || request.method !== "POST"
        || request.headers.get("content-type") !== ADMISSION_HTTP_BATCH_MEDIA
        || request.headers.get("accept") !== ADMISSION_HTTP_JOURNAL_MEDIA
        || request.headers.has("content-encoding") || request.headers.has("cookie")) return failure(400);
      expected = contentLength(request.headers);
      const authorization = request.headers.get("authorization");
      if (authorization === null || !authorization.startsWith("Bearer ") || !enrollmentHex(authorization.slice(7))) return failure(401);
      secret = authorization.slice(7);
    } catch { return failure(400); }
    if (outstanding >= ADMISSION_HTTP_CAPACITY || request.signal.aborted) return failure(503);
    outstanding++;
    return pairingHttpWork(effects, ADMISSION_HTTP_WORKER_MS, terminal => { ctx.waitUntil(terminal); },
      () => failure(503), () => { outstanding--; }, async work => {
        const guard = () => { work.guard(); if (request.signal.aborted) throw new Error("admission_http_aborted"); };
        let bytes: Uint8Array;
        try { bytes = await pairingHttpBody(request.body, MAX_ADMISSION_BATCH_BYTES, expected, work); }
        catch { guard(); return failure(400); }
        guard();
        let batch;
        try { batch = ownedAdmissionBatch(bytes); } catch { return failure(400); }
        return await work.stage(ADMISSION_HTTP_RPC_MS, async () => {
          guard();
          const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(batchAccount(batch)));
          // Checked own-field ordinary records are required by actual workerd RPC.
          const rpc = stub.admitBatch(Object.freeze({ uploadSecret: secret, batch: new Uint8Array(batch.bytes) }));
          // Box raw replies before a native Promise can inspect their `then`.
          const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => {
            void rpc.then(raw => { resolve({ raw }); }, reject);
          });
          const snapshot = rpcSnapshot(boxed.raw);
          try {
            guard();
            if (snapshot.envelope === null || snapshot.dispose === null) return failure(503);
            if (snapshot.envelope.ok === false) return domainFailure(snapshot.envelope.error);
            // The owned canonical journal must bind every ordinal to this batch.
            // Staging receipts and arbitrary structurally valid journals cannot settle it.
            const journal = ownedAdmissionJournal(snapshot.envelope.value, batch);
            guard();
            return response(journal.bytes, 200, ADMISSION_HTTP_JOURNAL_MEDIA);
          } finally { snapshot.dispose?.(); }
        });
      }, startedAt);
  };
}
