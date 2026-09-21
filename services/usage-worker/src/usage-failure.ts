import { pairingHttpFailure } from "../../../lib/usage/pairing-http-contract";
import { USAGE_FAILURE_HEADER, USAGE_FAILURE_STAGES, type UsageFailureStage } from "../../../lib/usage/usage-failure-contract";
export { USAGE_FAILURE_HEADER, type UsageFailureStage } from "../../../lib/usage/usage-failure-contract";

/** Optional trusted diagnostic only; it can never turn refusal into authority. */
export function verifierFailureStage(scope: Readonly<{ failureStage?: unknown }>): UsageFailureStage {
  try {
    const value = scope.failureStage;
    for (const stage of USAGE_FAILURE_STAGES) if (stage.startsWith("verifier_") && value === stage) return stage;
  } catch { /* A broken diagnostic getter leaves the original refusal intact. */ }
  return "verifier_fetch";
}

export function usageFailure(stage: UsageFailureStage): Response {
  const response = pairingHttpFailure(503);
  const headers = new Headers(response.headers);
  headers.set(USAGE_FAILURE_HEADER, stage);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
