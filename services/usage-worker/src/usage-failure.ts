import { pairingHttpFailure } from "../../../lib/usage/pairing-http-contract";
import { USAGE_FAILURE_HEADER, type UsageFailureStage } from "../../../lib/usage/usage-failure-contract";
export { USAGE_FAILURE_HEADER, type UsageFailureStage } from "../../../lib/usage/usage-failure-contract";

export function usageFailure(stage: UsageFailureStage): Response {
  const response = pairingHttpFailure(503);
  const headers = new Headers(response.headers);
  headers.set(USAGE_FAILURE_HEADER, stage);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
