import { decodePrivateDaysHttpRequest, encodePrivateDaysHttpResponse, privateDaysHttpLength,
  PRIVATE_DAYS_HTTP_REQUEST_BYTES, PRIVATE_DAYS_HTTP_URL } from "../../../lib/usage/private-days-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_STAGE_MS, PAIRING_HTTP_WORKER_MS,
  pairingHttpBearer, pairingHttpBody, pairingHttpFailure, pairingHttpResponse } from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";
import type { PairingHttpRequestLifetime, PairingHttpVerifier } from "./pairing-http";
import { enrollmentAccountName } from "./enrollment-contract";
import { usageFailure, verifierFailureStage, type UsageFailureStage } from "./usage-failure";

export interface PrivateDaysHttpEnvironment {
  readonly ACCOUNT_ENROLLMENTS: Readonly<{
    getByName(name: string): Readonly<{ readImportedDays(input: unknown): Promise<unknown> }>;
  }>;
}
export interface PrivateDaysHttpDependencies extends PairingHttpEffects { verifier: PairingHttpVerifier; }

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
    return { envelope, dispose };
  } catch { return { envelope: null, dispose }; }
}

/** Dormant trusted-coordinator boundary. Workload verification precedes body
 * consumption and canonical account selection; it is not user authentication. */
export function createPrivateDaysHttpHandler(dependencies: PrivateDaysHttpDependencies) {
  const { verifier, now, setTimeout, clearTimeout } = dependencies;
  let outstanding = 0;
  return async (request: Request, env: PrivateDaysHttpEnvironment, ctx: PairingHttpRequestLifetime): Promise<Response> => {
    let startedAt: number, expected: number | null, token: string | null;
    let failureStage: UsageFailureStage = "unknown";
    try { startedAt = now(); } catch { return usageFailure("request_clock"); }
    try {
      if (request.url !== PRIVATE_DAYS_HTTP_URL || request.method !== "POST" || request.headers.get("content-type") !== "application/json"
        || request.headers.get("accept") !== "application/json" || request.headers.has("content-encoding") || request.headers.has("cookie")) return pairingHttpFailure(400);
      expected = privateDaysHttpLength(request.headers, PRIVATE_DAYS_HTTP_REQUEST_BYTES);
      token = pairingHttpBearer(request.headers.get("authorization"));
    } catch { return pairingHttpFailure(400); }
    if (token === null) return pairingHttpFailure(401);
    if (request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return usageFailure("request_capacity");
    outstanding++;
    let observed = startedAt;
    const sample = () => {
      const current = now();
      if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) throw new Error("private_days_clock");
      observed = current; return current;
    };
    return pairingHttpWork({ now: sample, setTimeout, clearTimeout }, PAIRING_HTTP_WORKER_MS, terminal => { ctx.waitUntil(terminal); },
      () => usageFailure(failureStage), () => { outstanding--; }, async work => {
        failureStage = "request_verify";
        const scope = verifier.beginRequest(ctx); work.onStop(() => { scope.finish(); });
        const verified = await scope.verify(token); work.guard();
        if (!verified.ok) return verified.error === "unauthorized" ? pairingHttpFailure(401) : usageFailure(verifierFailureStage(scope));
        let expiry: number | null = null;
        const guard = () => {
          work.guard();
          if (request.signal.aborted || !scope.isCurrent(verified.value) || (expiry !== null && sample() >= expiry)) throw new Error("private_days_closed");
          work.guard();
        };
        guard();
        let bytes: Uint8Array;
        failureStage = "request_body";
        try { bytes = await pairingHttpBody(request.body, PRIVATE_DAYS_HTTP_REQUEST_BYTES, expected, work); }
        catch { guard(); return pairingHttpFailure(400); }
        guard();
        failureStage = "request_decode";
        const query = decodePrivateDaysHttpRequest(bytes);
        if (query === null) return pairingHttpFailure(400);
        expiry = query.sessionExpiresAtMs;
        failureStage = "rpc_dispatch";
        const encoded = await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
          guard();
          // The account assertion came from the authenticated coordinator. The
          // owned ordinary projection is accepted by actual workerd RPC.
          const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(query.accountId));
          failureStage = "rpc_call";
          const rpc = stub.readImportedDays(Object.freeze({
            schemaVersion: 1, accountId: query.accountId, sessionExpiresAtMs: query.sessionExpiresAtMs,
            firstUtcDay: query.firstUtcDay, dayCount: query.dayCount,
          }));
          failureStage = "rpc_pending";
          const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => {
            void rpc.then(raw => { resolve({ raw }); }, error => { failureStage = "rpc_rejected"; reject(error); });
          });
          failureStage = "rpc_shape";
          const snapshot = rpcSnapshot(boxed.raw);
          try {
            guard();
            if (snapshot.envelope === null || snapshot.dispose === null) throw new Error("private_days_rpc");
            failureStage = "rpc_encode";
            const response = encodePrivateDaysHttpResponse(query, snapshot.envelope);
            if (response === null) throw new Error("private_days_rpc");
            guard(); return response;
          } finally { snapshot.dispose?.(); }
        });
        guard(); return pairingHttpResponse(encoded);
      }, startedAt);
  };
}
