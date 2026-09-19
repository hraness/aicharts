/** Authenticated private consent write contract. The browser-facing route only
 * accepts `{consent, publicHandle}`; `accountId` and `sessionExpiresAtMs` are
 * derived exclusively from the live server session before the worker call. */
import { leaderboardPublicHandle, parseLeaderboardConsentView, type LeaderboardConsentViewV1 } from "./leaderboard-contract";

export const USAGE_CONSENT_REQUEST_BYTES = 256;
export const USAGE_CONSENT_RESPONSE_BYTES = 1_024;
const MAX_TIME = 8_640_000_000_000_000;

function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const owned: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
      owned[key] = descriptor.value as unknown;
    }
    return owned;
  } catch { return null; }
}
function enrollmentTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
}
function enrollmentAccount(value: unknown): value is string {
  return typeof value === "string" && /^acct_[0-9a-f]{32}$/u.test(value);
}

/** The browser-owned consent decision. `publicHandle` must be a valid bounded
 * handle when granting and `null` when withdrawing. */
export type UsageConsentDecision = Readonly<{ consent: boolean; publicHandle: string | null }>;
export function parseUsageConsentDecision(value: unknown): UsageConsentDecision | null {
  const owned = snapshot(value, ["consent", "publicHandle"]);
  if (owned === null || typeof owned.consent !== "boolean") return null;
  if (owned.consent === false && owned.publicHandle !== null) return null;
  if (owned.consent === true && !leaderboardPublicHandle(owned.publicHandle)) return null;
  return Object.freeze({ consent: owned.consent, publicHandle: owned.publicHandle as string | null });
}

/** The worker-owned consent operation. `status` reads the recorded consent;
 * `set` commits the decision and applies it to the materialized index. */
export type UsageConsentRequestV1 =
  | Readonly<{ schemaVersion: 1; accountId: string; sessionExpiresAtMs: number; operation: "status" }>
  | Readonly<{ schemaVersion: 1; accountId: string; sessionExpiresAtMs: number; operation: "set"; consent: boolean; publicHandle: string | null }>;
export function parseUsageConsentRequest(value: unknown): UsageConsentRequestV1 | null {
  const status = snapshot(value, ["schemaVersion", "accountId", "sessionExpiresAtMs", "operation"]);
  if (status?.schemaVersion === 1 && status.operation === "status"
    && enrollmentAccount(status.accountId) && enrollmentTime(status.sessionExpiresAtMs)) {
    return Object.freeze({ schemaVersion: 1, accountId: status.accountId,
      sessionExpiresAtMs: status.sessionExpiresAtMs as number, operation: "status" });
  }
  const set = snapshot(value, ["schemaVersion", "accountId", "sessionExpiresAtMs", "operation", "consent", "publicHandle"]);
  if (set?.schemaVersion !== 1 || set.operation !== "set"
    || !enrollmentAccount(set.accountId) || !enrollmentTime(set.sessionExpiresAtMs)
    || typeof set.consent !== "boolean") return null;
  if (set.consent === false && set.publicHandle !== null) return null;
  if (set.consent === true && !leaderboardPublicHandle(set.publicHandle)) return null;
  return Object.freeze({ schemaVersion: 1, accountId: set.accountId,
    sessionExpiresAtMs: set.sessionExpiresAtMs as number, operation: "set",
    consent: set.consent, publicHandle: set.publicHandle as string | null });
}

/** Consent-domain errors reuse the private-days fixed code set. */
export type UsageConsentError =
  | "invalid_input" | "unauthorized" | "not_enrolled" | "expired"
  | "recovery_required" | "clock_regressed" | "storage_invalid" | "storage_unavailable" | "limit" | "handle_unavailable" | "publishing_full";
export type UsageConsentResult =
  | Readonly<{ ok: true; value: LeaderboardConsentViewV1 }>
  | Readonly<{ ok: false; error: UsageConsentError }>;
export function parseUsageConsentResult(value: unknown): UsageConsentResult | null {
  const success = snapshot(value, ["ok", "value"]);
  if (success?.ok === true) {
    const view = parseLeaderboardConsentView(success.value);
    return view === null ? null : Object.freeze({ ok: true, value: view });
  }
  const failure = snapshot(value, ["ok", "error"]);
  if (failure?.ok !== false || typeof failure.error !== "string") return null;
  const error = failure.error;
  if (error !== "invalid_input" && error !== "unauthorized" && error !== "not_enrolled" && error !== "expired"
    && error !== "recovery_required" && error !== "clock_regressed" && error !== "storage_invalid"
    && error !== "storage_unavailable" && error !== "limit" && error !== "handle_unavailable" && error !== "publishing_full") return null;
  return Object.freeze({ ok: false, error });
}

/** Index-apply wire shape: the enrolled object publishes the consent decision
 * to the materialized index. `eventAtMs` is the recorded decision time and
 * orders replays; it is internal only and never enters public output. */
export type LeaderboardConsentApplyV1 = Readonly<{
  schemaVersion: 1;
  accountId: string;
  consent: boolean;
  publicHandle: string | null;
  consentedAtMs: number | null;
  eventAtMs: number;
}>;
export function parseLeaderboardConsentApply(value: unknown): LeaderboardConsentApplyV1 | null {
  const owned = snapshot(value, ["schemaVersion", "accountId", "consent", "publicHandle", "consentedAtMs", "eventAtMs"]);
  if (owned?.schemaVersion !== 1 || !enrollmentAccount(owned.accountId)
    || typeof owned.consent !== "boolean" || !enrollmentTime(owned.eventAtMs)) return null;
  if (owned.consent === false) {
    if (owned.publicHandle !== null || owned.consentedAtMs !== null) return null;
  } else {
    if (!leaderboardPublicHandle(owned.publicHandle) || !enrollmentTime(owned.consentedAtMs)
      || (owned.consentedAtMs as number) > (owned.eventAtMs as number)) return null;
  }
  return Object.freeze({ schemaVersion: 1, accountId: owned.accountId, consent: owned.consent,
    publicHandle: owned.publicHandle as string | null, consentedAtMs: owned.consentedAtMs as number | null,
    eventAtMs: owned.eventAtMs as number });
}
