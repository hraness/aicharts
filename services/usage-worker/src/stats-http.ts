import { STATS_UPLOAD_URL, STATS_STATUS_URL, STATS_UPLOAD_BYTES, STATS_MEDIA, statsHex, statsJsonBytes, statsJsonValue,
  parseStatsUpload, parseStatsStatusRequest, parseStatsResult, parseStatsReceipt, parseStatsStatus, type StatsError } from "../../../lib/usage/stats-http-contract";
import { STATS_ABANDON_URL, STATS_ABANDON_BYTES, parseStatsAbandonRequest, parseStatsAbandonment } from "../../../lib/usage/stats-http-contract";
import { decodeStatsHttpRequest, encodeStatsHttpResponse, statsHttpLength,
  STATS_HTTP_REQUEST_BYTES, STATS_HTTP_URL } from "../../../lib/usage/stats-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_STAGE_MS, PAIRING_HTTP_WORKER_MS,
  pairingHttpBearer, pairingHttpBody, pairingHttpFailure, pairingHttpResponse } from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";
import type { PairingHttpRequestLifetime, PairingHttpVerifier } from "./pairing-http";
import { enrollmentAccountName } from "./enrollment-contract";

export interface StatsHttpEnvironment {
  readonly ACCOUNT_ENROLLMENTS: Readonly<{
    getByName(name: string): Readonly<{ readUsageStats(input: unknown): Promise<unknown> }>;
  }>;
}
export interface StatsHttpDependencies extends PairingHttpEffects { verifier: PairingHttpVerifier; }

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
export function createStatsHttpHandler(dependencies: StatsHttpDependencies) {
  const { verifier, now, setTimeout, clearTimeout } = dependencies;
  let outstanding = 0;
  return async (request: Request, env: StatsHttpEnvironment, ctx: PairingHttpRequestLifetime): Promise<Response> => {
    let startedAt: number, expected: number | null, token: string | null;
    try { startedAt = now(); } catch { return pairingHttpFailure(503); }
    try {
      if (request.url !== STATS_HTTP_URL || request.method !== "POST" || request.headers.get("content-type") !== "application/json"
        || request.headers.get("accept") !== "application/json" || request.headers.has("content-encoding") || request.headers.has("cookie")) return pairingHttpFailure(400);
      expected = statsHttpLength(request.headers, STATS_HTTP_REQUEST_BYTES);
      token = pairingHttpBearer(request.headers.get("authorization"));
    } catch { return pairingHttpFailure(400); }
    if (token === null) return pairingHttpFailure(401);
    if (request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return pairingHttpFailure(503);
    outstanding++;
    let observed = startedAt;
    const sample = () => {
      const current = now();
      if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) throw new Error("private_days_clock");
      observed = current; return current;
    };
    return pairingHttpWork({ now: sample, setTimeout, clearTimeout }, PAIRING_HTTP_WORKER_MS, terminal => { ctx.waitUntil(terminal); },
      () => pairingHttpFailure(503), () => { outstanding--; }, async work => {
        const scope = verifier.beginRequest(ctx); work.onStop(() => { scope.finish(); });
        const verified = await scope.verify(token); work.guard();
        if (!verified.ok) return pairingHttpFailure(verified.error === "unauthorized" ? 401 : 503);
        let expiry: number | null = null;
        const guard = () => {
          work.guard();
          if (request.signal.aborted || !scope.isCurrent(verified.value) || (expiry !== null && sample() >= expiry)) throw new Error("private_days_closed");
          work.guard();
        };
        guard();
        let bytes: Uint8Array;
        try { bytes = await pairingHttpBody(request.body, STATS_HTTP_REQUEST_BYTES, expected, work); }
        catch { guard(); return pairingHttpFailure(400); }
        guard();
        const query = decodeStatsHttpRequest(bytes);
        if (query === null) return pairingHttpFailure(400);
        expiry = query.sessionExpiresAtMs;
        const encoded = await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
          guard();
          // The account assertion came from the authenticated coordinator. The
          // owned ordinary projection is accepted by actual workerd RPC.
          const rpc = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(query.accountId)).readUsageStats(Object.freeze({
            schemaVersion: 2, accountId: query.accountId, sessionExpiresAtMs: query.sessionExpiresAtMs,
            firstUtcDay: query.firstUtcDay, dayCount: query.dayCount,
          }));
          const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => { void rpc.then(raw => { resolve({ raw }); }, reject); });
          const snapshot = rpcSnapshot(boxed.raw);
          try {
            guard();
            if (snapshot.envelope === null || snapshot.dispose === null) throw new Error("private_days_rpc");
            const response = encodeStatsHttpResponse(query, snapshot.envelope);
            if (response === null) throw new Error("private_days_rpc");
            guard(); return response;
          } finally { snapshot.dispose?.(); }
        });
        guard(); return pairingHttpResponse(encoded);
      }, startedAt);
  };
}

// Device upload/status use the existing enrolled secret, never workload OIDC.
export interface StatsUploadHttpEnvironment {
  readonly ACCOUNT_ENROLLMENTS: Readonly<{
    getByName(name: string): Readonly<{
      admitStatsSnapshot(input: unknown): Promise<unknown>;
      readStatsStatus(input: unknown): Promise<unknown>;
      abandonStatsSnapshot(input: unknown): Promise<unknown>;
    }>;
  }>;
}
const deviceFailure = (error: StatsError): Response => {
  const status = error === "invalid_input" ? 400 : ["unauthorized", "not_enrolled"].includes(error) ? 401
    : ["conflict", "revoked", "limit", "takeover_required", "writer_conflict", "profile_superseded", "replacement_required"].includes(error) ? 409 : 503;
  const body = JSON.stringify({ schemaVersion: 2, result: { ok: false, error } });
  return new Response(body, { status, headers: {
    "content-length": String(new TextEncoder().encode(body).length),
    "content-type": STATS_MEDIA, "cache-control": "private, no-store", "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
  } });
};
export function createStatsUploadHttpHandler(dependencies: PairingHttpEffects) {
  let outstanding = 0;
  return async (request: Request, env: StatsUploadHttpEnvironment, ctx: PairingHttpRequestLifetime): Promise<Response> => {
    let started: number, length: number | null, secret: string;
    const statusQuery = request.url === STATS_STATUS_URL, abandon = request.url === STATS_ABANDON_URL;
    const cap = statusQuery ? STATS_HTTP_REQUEST_BYTES : abandon ? STATS_ABANDON_BYTES : STATS_UPLOAD_BYTES;
    try {
      started = dependencies.now();
      if ((!statusQuery && !abandon && request.url !== STATS_UPLOAD_URL) || request.method !== "POST"
        || request.headers.get("content-type") !== "application/json" || request.headers.get("accept") !== "application/json"
        || request.headers.has("content-encoding") || request.headers.has("cookie")) return deviceFailure("invalid_input");
      length = statsHttpLength(request.headers, cap);
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ") || !statsHex(authorization.slice(7)) || authorization.slice(7) === "0".repeat(64)) return deviceFailure("unauthorized");
      secret = authorization.slice(7);
    } catch { return deviceFailure("invalid_input"); }
    if (request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return deviceFailure("storage_unavailable");
    outstanding++;
    return pairingHttpWork(dependencies, PAIRING_HTTP_WORKER_MS, terminal => ctx.waitUntil(terminal),
      () => deviceFailure("storage_unavailable"), () => { outstanding--; }, async work => {
        const guard = () => { work.guard(); if (request.signal.aborted) throw new Error("stats_closed"); };
        let bytes: Uint8Array;
        try { bytes = await pairingHttpBody(request.body, cap, length, work); }
        catch { guard(); return deviceFailure("invalid_input"); }
        guard();
        const raw = statsJsonValue(bytes, cap);
        const input = statusQuery ? parseStatsStatusRequest(raw) : abandon ? parseStatsAbandonRequest(raw) : parseStatsUpload(raw);
        if (!input) return deviceFailure("invalid_input");
        return await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
          guard();
          const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(input.accountId));
          const rpc = statusQuery ? stub.readStatsStatus({ uploadSecret: secret, request: input })
            : abandon ? stub.abandonStatsSnapshot({ uploadSecret: secret, request: input }) : stub.admitStatsSnapshot({ uploadSecret: secret, request: input });
          const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => { void rpc.then(raw => resolve({ raw }), reject); });
          const response = rpcSnapshot(boxed.raw);
          try {
            guard();
            if (!response.envelope || !response.dispose) return deviceFailure("storage_unavailable");
            const result = statusQuery ? parseStatsResult(response.envelope, parseStatsStatus)
              : abandon ? parseStatsResult(response.envelope, parseStatsAbandonment) : parseStatsResult(response.envelope, parseStatsReceipt);
            if (!result) return deviceFailure("storage_unavailable");
            if (!result.ok) return deviceFailure(result.error);
            const encoded = statsJsonBytes({ schemaVersion: 2, result }, 2_048);
            if (!encoded) return deviceFailure("storage_unavailable");
            const reply = pairingHttpResponse(encoded);
            reply.headers.set("content-length", String(encoded.byteLength));
            return reply;
          } finally { response.dispose?.(); }
        });
      }, started);
  };
}
