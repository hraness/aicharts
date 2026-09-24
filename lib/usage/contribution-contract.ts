/** Hash-free wire vocabulary shared by private clients and server kernels. */
export const CONTRIBUTION_MAX_OPERATIONS = 1_000_000;
export const contributionHex = (value: unknown, width = 64): value is string => typeof value === "string"
  && value.length === width && /^[0-9a-f]+$/u.test(value);
export const contributionIdentity = (value: unknown, width = 64): value is string => contributionHex(value, width) && value !== "0".repeat(width);
export const contributionAccount = (value: unknown): value is string => typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value);
export type ContributionError = "invalid_input" | "unauthorized" | "not_enrolled" | "revoked" | "generation_conflict" | "writer_conflict"
  | "conflict" | "population_conflict" | "predecessor_conflict" | "subject_deleted" | "limit" | "clock_regressed"
  | "storage_invalid" | "storage_unavailable" | "recovery_required" | "not_started" | "legacy_unresolved";
export type ContributionResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ContributionError }>;
export const CONTRIBUTION_ERRORS: readonly ContributionError[] = Object.freeze(["invalid_input", "unauthorized", "not_enrolled", "revoked", "generation_conflict",
  "writer_conflict", "conflict", "population_conflict", "predecessor_conflict", "subject_deleted", "limit", "clock_regressed", "storage_invalid",
  "storage_unavailable", "recovery_required", "not_started", "legacy_unresolved"]);
export const isContributionError = (value: unknown): value is ContributionError => typeof value === "string" && CONTRIBUTION_ERRORS.includes(value as ContributionError);
