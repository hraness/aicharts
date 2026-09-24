import { CONTRIBUTION_MAX_TIME } from "../../../lib/usage/contributions";
import type { ContributionProjectionStatus } from "./contribution-projection-state";
import { accountWorkKey, ACCOUNT_WORK_READY_DELAY_MS, type AccountWorkSnapshot, type AccountWorkRecord, type AccountWorkBlock } from "./account-work-state";

export type AccountWorkTarget = Readonly<{ key: string | null; readyAtMs: number | null }>;
export function accountProjectionWork(status: ContributionProjectionStatus, observedAtMs: number): AccountWorkTarget {
  const stage = status.staged;
  if (status.appliedLag === 0 && status.publishedLag === 0) return { key: null, readyAtMs: null };
  // Appending unrelated later source revisions must not renew a failed step's
  // retry allowance. Only an actual stage/apply/publication position change can.
  const key = accountWorkKey("projection", [status.accountId, status.generation, status.appliedRevision, status.publishedRevision,
    stage?.revision ?? null, stage?.phase ?? null, stage?.cursor ?? null]);
  const readyAtMs = status.appliedLag > 0
    ? observedAtMs <= CONTRIBUTION_MAX_TIME - ACCOUNT_WORK_READY_DELAY_MS ? observedAtMs + ACCOUNT_WORK_READY_DELAY_MS : null
    : status.nextPublicationAtMs;
  return { key, readyAtMs };
}
export function accountConsentWork(accountId: string, generation: string, decision: Readonly<{
  consent: boolean; publicHandle: string | null; consentedAtMs: number | null; changedAtMs: number;
}>, now: number): AccountWorkTarget {
  if (decision.changedAtMs === 0) return { key: null, readyAtMs: null };
  return { key: accountWorkKey("consent", [accountId, generation, decision.changedAtMs, String(decision.consent), decision.publicHandle, decision.consentedAtMs]),
    readyAtMs: now <= CONTRIBUTION_MAX_TIME - ACCOUNT_WORK_READY_DELAY_MS ? now + ACCOUNT_WORK_READY_DELAY_MS : null };
}
export function accountWorkDeadline(snapshot: AccountWorkSnapshot): number | null {
  const times = [accountWorkRecordDeadline(snapshot.consent), accountWorkRecordDeadline(snapshot.projection)].filter((value): value is number => value !== null);
  return times.length === 0 ? null : Math.min(...times);
}
export function accountWorkRecordDeadline(record: AccountWorkRecord): number | null {
  return record.flight === null ? record.nextAtMs : record.flight.watchAtMs;
}
export function accountWorkRefusal(error: string): AccountWorkBlock | null {
  return error === "limit" ? "capacity"
    : error === "clock_regressed" ? "clock_limit"
      : error === "storage_invalid" || error === "invalid_input" ? "invalid_state"
        : error === "storage_unavailable" || error === "conflict" ? null : "authority";
}
