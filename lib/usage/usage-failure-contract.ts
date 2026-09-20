/** Fixed, coarse 503 diagnostic stages shared by the Worker and its private
 * request-local readback. Values never contain provider, account or native data. */
export const USAGE_FAILURE_STAGES = [
  "router_gate", "router_exception", "request_clock", "request_capacity", "request_lifetime",
  "request_verify", "request_body", "request_decode", "request_guard", "request_timeout",
  "verifier_clock", "verifier_capacity", "verifier_cooldown", "verifier_fetch", "verifier_framing",
  "verifier_body", "verifier_keys", "verifier_import", "verifier_signature", "verifier_guard",
  "rpc_dispatch", "rpc_shape", "rpc_encode", "deadline", "unknown",
] as const;
export type UsageFailureStage = typeof USAGE_FAILURE_STAGES[number];
export const USAGE_FAILURE_HEADER = "x-aicharts-usage-failure";
