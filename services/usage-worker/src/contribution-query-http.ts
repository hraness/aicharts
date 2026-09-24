import { CONTRIBUTION_QUERY_URL, CONTRIBUTION_QUERY_REQUEST_BYTES, decodeContributionQuery, encodeContributionQueryResult,
  parseContributionQueryResult, type ContributionQueryError } from "../../../lib/usage/contribution-query";
import { statsHttpLength } from "../../../lib/usage/stats-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_STAGE_MS, PAIRING_HTTP_WORKER_MS,
  pairingHttpBearer, pairingHttpBody, pairingHttpFailure, pairingHttpResponse } from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";
import type { PairingHttpRequestLifetime, PairingHttpVerifier } from "./pairing-http";
import { enrollmentAccountName } from "./enrollment-contract";
import { rpcResultSnapshot } from "./rpc-result";

export interface ContributionQueryHttpEnvironment {
  readonly ACCOUNT_ENROLLMENTS: Readonly<{ getByName(name: string): Readonly<{ readContributionPage(input: unknown): Promise<unknown> }> }>;
}
export interface ContributionQueryHttpDependencies extends PairingHttpEffects { verifier: PairingHttpVerifier; }
const errorStatus = (error: ContributionQueryError): number => error === "invalid_input" ? 400
  : error === "unauthorized" || error === "expired" || error === "not_enrolled" ? 401
    : error === "snapshot_expired" || error === "limit" || error === "not_started" || error === "conflict" ? 409 : 503;

/** Workload identity precedes body consumption. The authenticated coordinator
 * supplies its live account assertion; an end-user cookie is never accepted. */
export function createContributionQueryHttpHandler(dependencies: ContributionQueryHttpDependencies) {
  let outstanding = 0;
  return async (request: Request, env: ContributionQueryHttpEnvironment, ctx: PairingHttpRequestLifetime): Promise<Response> => {
    let started: number, expected: number | null, token: string | null;
    try {
      started = dependencies.now();
      if (request.url !== CONTRIBUTION_QUERY_URL || request.method !== "POST" || request.headers.get("content-type") !== "application/json"
        || request.headers.get("accept") !== "application/json" || request.headers.has("content-encoding") || request.headers.has("cookie")) return pairingHttpFailure(400);
      expected = statsHttpLength(request.headers, CONTRIBUTION_QUERY_REQUEST_BYTES);
      token = pairingHttpBearer(request.headers.get("authorization"));
    } catch { return pairingHttpFailure(400); }
    if (token === null) return pairingHttpFailure(401);
    if (request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return pairingHttpFailure(503);
    outstanding++;
    let observed = started;
    const now = () => {
      const value = dependencies.now();
      if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value < observed || value > 8_640_000_000_000_000)
        throw new Error("contribution_query_clock");
      observed = value; return value;
    };
    return pairingHttpWork({ now, setTimeout: dependencies.setTimeout, clearTimeout: dependencies.clearTimeout }, PAIRING_HTTP_WORKER_MS,
      terminal => ctx.waitUntil(terminal), () => pairingHttpFailure(503), () => { outstanding--; }, async work => {
        const scope = dependencies.verifier.beginRequest(ctx); work.onStop(() => scope.finish());
        const verified = await scope.verify(token); work.guard();
        if (!verified.ok) return pairingHttpFailure(verified.error === "unauthorized" ? 401 : 503);
        let expiry: number | null = null;
        const guard = () => {
          work.guard();
          if (request.signal.aborted || !scope.isCurrent(verified.value) || (expiry !== null && now() >= expiry)) throw new Error("contribution_query_closed");
          work.guard();
        };
        guard();
        let body: Uint8Array;
        try { body = await pairingHttpBody(request.body, CONTRIBUTION_QUERY_REQUEST_BYTES, expected, work); }
        catch { guard(); return pairingHttpFailure(400); }
        guard();
        const query = decodeContributionQuery(body);
        if (!query) return pairingHttpFailure(400);
        expiry = query.sessionExpiresAtMs;
        if (now() >= expiry) return pairingHttpFailure(401);
        return work.stage(PAIRING_HTTP_STAGE_MS, async () => {
          guard();
          const rpc = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(query.accountId)).readContributionPage(query);
          const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => { void rpc.then(raw => resolve({ raw }), reject); });
          const snapshot = rpcResultSnapshot(boxed.raw);
          try {
            guard();
            if (!snapshot.envelope || !snapshot.dispose) return pairingHttpFailure(503);
            const result = parseContributionQueryResult(query, snapshot.envelope), bytes = result && encodeContributionQueryResult(query, result);
            if (!result || !bytes) return pairingHttpFailure(503);
            guard();
            const response = pairingHttpResponse(bytes, result.ok ? 200 : errorStatus(result.error));
            response.headers.set("content-length", String(bytes.byteLength)); return response;
          } finally { snapshot.dispose?.(); }
        });
      }, started);
  };
}
