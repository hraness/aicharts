import {
  decodePairingTransportRequest, encodePairingTransportResponse, PAIRING_TRANSPORT_MAX_REQUEST_BYTES,
} from "../../../lib/usage/pairing-transport-contract";
import {
  PAIRING_HTTP_CAPACITY, PAIRING_HTTP_STAGE_MS, PAIRING_HTTP_URL, PAIRING_HTTP_WORKER_MS,
  pairingHttpBearer, pairingHttpBody, pairingHttpFailure, pairingHttpLength, pairingHttpResponse,
} from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";

export interface PairingHttpRequestLifetime { waitUntil(terminal: Promise<void>): void; }

/** Structural composition only: the opaque handle is never inspected or projected.
 * Keep browser ambient types out of the Worker graph; the unit graph proves that
 * the actual accepted verifier is assignable to this exact trusted port. */
export interface PairingHttpVerifier {
  beginRequest(ctx: PairingHttpRequestLifetime): Readonly<{
    verify(input: unknown): Promise<Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; error: "unauthorized" | "unavailable" }>>;
    isCurrent(handle: unknown): boolean;
    finish(): void;
  }>;
}
export interface PairingHttpDependencies extends PairingHttpEffects {
  verifier: PairingHttpVerifier;
}

/** Exactly the namespace operations this handler can select. The real Worker
 * binding is checked for assignability by the ordinary workerd contract test. */
export interface PairingHttpEnvironment {
  readonly PAIRINGS: Readonly<{
    getByName(name: string): Readonly<{
      beginBrowserAttempt(input: unknown): Promise<unknown>;
      recordVerifiedAuthentication(input: unknown): Promise<unknown>;
      browserStatus(input: unknown): Promise<unknown>;
      decideBrowser(input: unknown): Promise<unknown>;
    }>;
  }>;
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
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    const envelope: Record<string, unknown> = Object.create(null);
    for (const name of Reflect.ownKeys(descriptors)) {
      if (name === Symbol.dispose) continue;
      if (typeof name !== "string") return { envelope: null, dispose };
      const descriptor = descriptors[name];
      if (!("value" in descriptor) || descriptor.enumerable !== true) return { envelope: null, dispose };
      envelope[name] = descriptor.value as unknown;
    }
    return { envelope, dispose };
  } catch { return { envelope: null, dispose }; }
}

/** Unexported by the default Worker entrypoint; no namespace access before auth. */
export function createPairingHttpHandler(dependencies: PairingHttpDependencies) {
  const { verifier, now, setTimeout, clearTimeout } = dependencies;
  const effects = Object.freeze({ now, setTimeout, clearTimeout });
  let outstanding = 0;

  return async (request: Request, env: PairingHttpEnvironment, ctx: PairingHttpRequestLifetime): Promise<Response> => {
    let startedAt: number;
    try { startedAt = now(); } catch { return pairingHttpFailure(503); }
    let expected: number | null;
    let token: string | null;
    try {
      if (request.url !== PAIRING_HTTP_URL || request.method !== "POST" || request.headers.get("content-type") !== "application/json"
        || request.headers.get("accept") !== "application/json" || request.headers.has("content-encoding") || request.headers.has("cookie")) return pairingHttpFailure(400);
      expected = pairingHttpLength(request.headers, PAIRING_TRANSPORT_MAX_REQUEST_BYTES);
      token = pairingHttpBearer(request.headers.get("authorization"));
    } catch { return pairingHttpFailure(400); }
    if (token === null) return pairingHttpFailure(401);
    if (outstanding >= PAIRING_HTTP_CAPACITY) return pairingHttpFailure(503);
    outstanding++;

    return pairingHttpWork(effects, PAIRING_HTTP_WORKER_MS, terminal => { ctx.waitUntil(terminal); }, () => pairingHttpFailure(503), () => { outstanding--; }, async work => {
      const scope = verifier.beginRequest(ctx);
      work.onStop(() => { scope.finish(); });
      const verified = await scope.verify(token);
      work.guard();
      if (!verified.ok) return pairingHttpFailure(verified.error === "unauthorized" ? 401 : 503);
      let bytes: Uint8Array;
      try { bytes = await pairingHttpBody(request.body, PAIRING_TRANSPORT_MAX_REQUEST_BYTES, expected, work); }
      catch { work.guard(); return pairingHttpFailure(400); }
      const decoded = decodePairingTransportRequest(bytes);
      if (!decoded.ok) return pairingHttpFailure(400);
      const owned = decoded.value;
      const response = await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
        work.guard();
        if (!scope.isCurrent(verified.value)) throw new Error("pairing_http_rpc");
        // No await separates the final handle check, canonical selection and dispatch.
        const stub = env.PAIRINGS.getByName(owned.input.intentId);
        let rpc: Promise<unknown>;
        // workerd does not serialize the codec's null-prototype records. Project
        // only its checked primitive fields into ordinary frozen RPC arguments;
        // never pass caller objects or change the codec's owned representation.
        switch (owned.operation) {
          case "beginBrowserAttempt": rpc = stub.beginBrowserAttempt(Object.freeze({
            intentId: owned.input.intentId, browserNonce: owned.input.browserNonce,
          })); break;
          case "recordVerifiedAuthentication": rpc = stub.recordVerifiedAuthentication(Object.freeze({
            intentId: owned.input.intentId, attemptId: owned.input.attemptId,
            browserNonce: owned.input.browserNonce, contextToken: owned.input.contextToken,
            accountId: owned.input.accountId, authTimeMs: owned.input.authTimeMs,
            sessionExpiresAtMs: owned.input.sessionExpiresAtMs,
          })); break;
          case "browserStatus": rpc = stub.browserStatus(Object.freeze({
            intentId: owned.input.intentId, attemptId: owned.input.attemptId,
            browserNonce: owned.input.browserNonce, contextToken: owned.input.contextToken,
          })); break;
          case "decideBrowser": rpc = stub.decideBrowser(Object.freeze({
            intentId: owned.input.intentId, attemptId: owned.input.attemptId,
            browserNonce: owned.input.browserNonce, contextToken: owned.input.contextToken,
            accountId: owned.input.accountId, liveSessionExpiresAtMs: owned.input.liveSessionExpiresAtMs,
            decision: owned.input.decision,
          })); break;
        }
        // Box before native promise resolution can inspect the raw object's then.
        const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => {
          void rpc.then(raw => { resolve({ raw }); }, reject);
        });
        const snapshot = rpcSnapshot(boxed.raw);
        try {
          work.guard();
          if (!scope.isCurrent(verified.value) || snapshot.envelope === null || snapshot.dispose === null) throw new Error("pairing_http_rpc");
          const encoded = encodePairingTransportResponse(owned, snapshot.envelope);
          if (!encoded.ok) throw new Error("pairing_http_rpc");
          return encoded.value;
        } finally { snapshot.dispose?.(); }
      });
      work.guard();
      if (!scope.isCurrent(verified.value)) return pairingHttpFailure(503);
      return pairingHttpResponse(response);
    }, startedAt);
  };
}
