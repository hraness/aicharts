import "server-only";

export const PRIVATE_DAYS_DIAGNOSTIC_BYTES = 768;
const routes = ["method", "aborted", "configuration", "url", "origin", "framing", "range", "query", "post_query", "projection", "exception"] as const;
const stages = ["not_started", "availability", "input", "context", "capacity", "lifetime", "session_start", "session_read", "query", "encode", "worker_dispatch", "worker_framing", "worker_length", "worker_body", "worker_decode", "complete"] as const;
const reasons = ["none", "configuration", "input", "context_missing", "context_invalid", "capacity", "registration", "timeout", "clock", "guard", "session", "query", "encode", "worker_fetch", "status", "url", "redirect", "media", "encoding", "location", "cookie", "length", "body", "decode", "interrupted"] as const;
const sessions = ["not_started", "pending", "authenticated", "authentication_required", "unavailable", "malformed"] as const;
const domains = ["not_checked", "success", "invalid_input", "unauthorized", "not_enrolled", "expired", "recovery_required", "clock_regressed", "storage_invalid", "storage_unavailable", "malformed"] as const;
const outcomes = ["ready", "not_enrolled", "authentication_required", "unavailable", "method_not_allowed", "invalid_request", "request_rejected"] as const;
type Member<T extends readonly string[]> = T[number];
export type PrivateDaysDiagnosticSink = (line: string) => void;
export interface PrivateDaysDiagnostic {
  route(stage: Member<typeof routes>): void;
  step(stage: Member<typeof stages>): void;
  fail(reason: Member<typeof reasons>): void;
  session(outcome: unknown, attempted: unknown): void;
  attempted(value: unknown): void;
  dispatched(): void;
  status(value: unknown): void;
  domain(value: unknown): void;
  closeTransport(reason?: Member<typeof reasons>): void;
  finish(outcome: Member<typeof outcomes>): void;
}
function allowed<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

/** Fixed scalars only. The sink receives no request, account, exception or DTO.
 * Transport closure fences late work separately from final route projection. */
export function createPrivateDaysDiagnostic(sink?: PrivateDaysDiagnosticSink): PrivateDaysDiagnostic {
  let sealed = false, transportClosed = false;
  const event = { event: "usage_private_days_read_v1", routeStage: "method" as Member<typeof routes>,
    transportStage: "not_started" as Member<typeof stages>, transportFailure: "none" as Member<typeof reasons>,
    sessionOutcome: "not_started" as Member<typeof sessions>, accountsAttempted: null as boolean | null,
    workerDispatched: false, workerStatus: null as number | null,
    workerDomain: "not_checked" as Member<typeof domains>, publicOutcome: "unavailable" as Member<typeof outcomes> };
  const open = () => !sealed && !transportClosed;
  const fail = (reason: unknown) => {
    if (open() && event.transportFailure === "none" && allowed(reasons, reason)) event.transportFailure = reason;
  };
  return Object.freeze<PrivateDaysDiagnostic>({
    route(stage) { if (!sealed && allowed(routes, stage)) event.routeStage = stage; },
    step(stage) { if (open() && allowed(stages, stage)) event.transportStage = stage; },
    fail,
    session(outcome, attempted) {
      if (!open()) return;
      event.sessionOutcome = allowed(sessions, outcome) ? outcome : "malformed";
      event.accountsAttempted = typeof attempted === "boolean" ? attempted : null;
    },
    attempted(value) { if (open() && typeof value === "boolean") event.accountsAttempted = value; },
    dispatched() { if (open()) event.workerDispatched = true; },
    status(value) { if (open() && typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) event.workerStatus = value; },
    domain(value) { if (open()) event.workerDomain = allowed(domains, value) ? value : "malformed"; },
    closeTransport(reason) { if (reason !== undefined) fail(reason); transportClosed = true; },
    finish(outcome) {
      if (sealed) return;
      sealed = true; transportClosed = true;
      event.publicOutcome = allowed(outcomes, outcome) ? outcome : "unavailable";
      try {
        const line = JSON.stringify(event);
        // Every admitted string is ASCII; length is the exact UTF-8 byte size.
        if (line.length <= PRIVATE_DAYS_DIAGNOSTIC_BYTES) sink?.(line);
      } catch { /* Diagnostics must never change the public result. */ }
    },
  });
}

/** Provider-managed runtime logs; no app queue, retry, persistent IDs or TTL. */
export function emitPrivateDaysDiagnostic(line: string): void { console.warn(line); }
