import { encodeLeaderboardHttpResponse, leaderboardHttpFailure,
  LEADERBOARD_HTTP_URL } from "../../../lib/usage/leaderboard-http-contract";
import { LEADERBOARD_INDEX_NAME } from "../../../lib/usage/leaderboard-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_STAGE_MS, PAIRING_HTTP_WORKER_MS,
  PAIRING_HTTP_MEDIA } from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";
import type { PairingHttpRequestLifetime } from "./pairing-http";

export interface LeaderboardHttpEnvironment {
  readonly PUBLIC_INDEX: Readonly<{
    getByName(name: string): Readonly<{ read(input: unknown): Promise<unknown> }>;
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

function response(body: Uint8Array, status: number): Response {
  return new Response(new Uint8Array(body), { status, headers: {
    "content-type": PAIRING_HTTP_MEDIA,
    // The snapshot is anonymous public data; a short shared cache is correct.
    "cache-control": "public, max-age=60",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
  } });
}
const failure = (status: 400 | 503) => response(leaderboardHttpFailure(status === 400 ? "invalid_request" : "leaderboard_unavailable"), status);

/** Dormant public boundary. Unauthenticated by design: the only body it can
 * emit is the materialized snapshot, so no identity is verified or accepted.
 * The read itself never touches account objects — only the index's bounded
 * stale-subset refresh does. */
export function createLeaderboardHttpHandler(dependencies: PairingHttpEffects) {
  const { now, setTimeout, clearTimeout } = dependencies;
  let outstanding = 0;
  return async (request: Request, env: LeaderboardHttpEnvironment, ctx: PairingHttpRequestLifetime): Promise<Response> => {
    let startedAt: number;
    try { startedAt = now(); } catch { return failure(503); }
    try {
      if (request.url !== LEADERBOARD_HTTP_URL || request.method !== "GET"
        || request.headers.get("accept") !== "application/json" || request.headers.has("content-type")
        || request.headers.has("content-encoding") || request.headers.has("cookie")
        || request.headers.has("authorization") || request.body !== null) return failure(400);
    } catch { return failure(400); }
    if (request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return failure(503);
    outstanding++;
    let observed = startedAt;
    const sample = () => {
      const current = now();
      if (!Number.isSafeInteger(current) || Object.is(current, -0) || current < 0 || current < observed || current > 8_640_000_000_000_000) throw new Error("leaderboard_clock");
      observed = current; return current;
    };
    return pairingHttpWork({ now: sample, setTimeout, clearTimeout }, PAIRING_HTTP_WORKER_MS, terminal => { ctx.waitUntil(terminal); },
      () => failure(503), () => { outstanding--; }, async work => {
        const encoded = await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
          work.guard();
          const rpc = env.PUBLIC_INDEX.getByName(LEADERBOARD_INDEX_NAME).read(Object.freeze({ schemaVersion: 1 }));
          const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => { void rpc.then(raw => { resolve({ raw }); }, reject); });
          const snapshot = rpcSnapshot(boxed.raw);
          try {
            work.guard();
            if (snapshot.envelope === null || snapshot.dispose === null) throw new Error("leaderboard_rpc");
            const body = encodeLeaderboardHttpResponse(snapshot.envelope);
            if (body === null) throw new Error("leaderboard_rpc");
            work.guard(); return body;
          } finally { snapshot.dispose?.(); }
        });
        work.guard(); return response(encoded, 200);
      }, startedAt);
  };
}
