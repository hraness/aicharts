import { contributionIdentity, type ContributionError } from "../../../lib/usage/contributions";
import { contributionHttpCap, contributionHttpResult, decodeContributionHttpRequest, encodeContributionHttpResult } from "../../../lib/usage/contributions-http-contract";
import { statsHttpLength } from "../../../lib/usage/stats-http-contract";
import { PAIRING_HTTP_CAPACITY, PAIRING_HTTP_STAGE_MS, PAIRING_HTTP_STAGE_MUTATION_MS, PAIRING_HTTP_WORKER_MS,
  pairingHttpBody, pairingHttpResponse } from "../../../lib/usage/pairing-http-contract";
import { pairingHttpWork, type PairingHttpEffects } from "../../../lib/usage/pairing-http-work";
import type { PairingHttpRequestLifetime } from "./pairing-http";
import { enrollmentAccountName } from "./enrollment-contract";
import { rpcResultSnapshot } from "./rpc-result";

export interface ContributionHttpEnvironment {
  readonly ACCOUNT_ENROLLMENTS: Readonly<{ getByName(name: string): Readonly<{
    activateContributions(input: unknown): Promise<unknown>;
    migrateContributions(input: unknown): Promise<unknown>;
    cancelContributionMigration(input: unknown): Promise<unknown>;
    grantContributionPopulation(input: unknown): Promise<unknown>;
    admitContributions(input: unknown): Promise<unknown>;
    abandonContributions(input: unknown): Promise<unknown>;
    cancelContributions(input: unknown): Promise<unknown>;
    readContributionStatus(input: unknown): Promise<unknown>;
    readContributionHeads(input: unknown): Promise<unknown>;
  }> }>;
}
function failure(error: ContributionError): Response {
  const status = error === "invalid_input" ? 400 : error === "unauthorized" || error === "not_enrolled" ? 401
    : ["revoked", "generation_conflict", "writer_conflict", "conflict", "population_conflict", "predecessor_conflict", "subject_deleted", "legacy_unresolved", "limit", "not_started"].includes(error) ? 409 : 503;
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 3, result: { ok: false, error } }));
  const response = pairingHttpResponse(bytes, status);
  response.headers.set("content-length", String(bytes.byteLength)); return response;
}
/** Device secret only. Route activation is independently gated by production.ts;
 * ownership, generation and restore fencing remain the account's authority. */
export function createContributionHttpHandler(effects: PairingHttpEffects) {
  let outstanding = 0;
  return async (request: Request, env: ContributionHttpEnvironment, ctx: PairingHttpRequestLifetime): Promise<Response> => {
    let started: number, cap: number, length: number | null, secret: string;
    try {
      started = effects.now();
      const bound = contributionHttpCap(request.url);
      if (bound === null || request.method !== "POST" || request.headers.get("content-type") !== "application/json"
        || request.headers.get("accept") !== "application/json" || request.headers.has("content-encoding") || request.headers.has("cookie"))
        return failure("invalid_input");
      cap = bound; length = statsHttpLength(request.headers, cap);
      const token = request.headers.get("authorization");
      if (!token?.startsWith("Bearer ") || !contributionIdentity(token.slice(7))) return failure("unauthorized");
      secret = token.slice(7);
    } catch { return failure("invalid_input"); }
    if (request.signal.aborted || outstanding >= PAIRING_HTTP_CAPACITY) return failure("storage_unavailable");
    outstanding++;
    return pairingHttpWork(effects, PAIRING_HTTP_WORKER_MS, terminal => ctx.waitUntil(terminal),
      () => failure("storage_unavailable"), () => { outstanding--; }, async work => {
        const guard = () => { work.guard(); if (request.signal.aborted) throw new Error("contribution_http_closed"); };
        let bytes: Uint8Array;
        try { bytes = await pairingHttpBody(request.body, cap, length, work); }
        catch { guard(); return failure("invalid_input"); }
        guard();
        const input = decodeContributionHttpRequest(request.url, bytes);
        if (!input) return failure("invalid_input");
        return work.stage(input.operation === "status" || input.operation === "heads" ? PAIRING_HTTP_STAGE_MS : PAIRING_HTTP_STAGE_MUTATION_MS, async () => {
          guard();
          const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(input.request.accountId));
          const dto = { uploadSecret: secret, request: input.request };
          const rpc = input.operation === "heads" ? stub.readContributionHeads(dto)
            : input.operation === "activate" ? stub.activateContributions(dto)
            : input.operation === "migrate" ? stub.migrateContributions(dto)
            : input.operation === "cancel-migration" ? stub.cancelContributionMigration(dto)
            : input.operation === "grant" ? stub.grantContributionPopulation(dto)
            : input.operation === "upload" ? stub.admitContributions(dto)
            : input.operation === "cancel" ? stub.cancelContributions(dto)
            : input.operation === "abandon" ? stub.abandonContributions(dto) : stub.readContributionStatus(dto);
          // Box the result to avoid treating an RPC object as a thenable.
          const boxed = await new Promise<{ raw: unknown }>((resolve, reject) => { void rpc.then(raw => resolve({ raw }), reject); });
          const snapshot = rpcResultSnapshot(boxed.raw);
          try {
            guard();
            if (!snapshot.envelope || !snapshot.dispose) return failure("storage_unavailable");
            const result = contributionHttpResult(input, snapshot.envelope);
            if (!result) return failure("storage_unavailable");
            if (!result.ok) return failure(result.error);
            const encoded = encodeContributionHttpResult(input, result);
            if (!encoded) return failure("storage_unavailable");
            const response = pairingHttpResponse(encoded);
            response.headers.set("content-length", String(encoded.byteLength)); return response;
          } finally { snapshot.dispose?.(); }
        });
      }, started);
  };
}
